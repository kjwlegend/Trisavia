import { randomUUID } from 'node:crypto';
import type { CommandKey, CommandReceipt, RuntimeEvent, RuntimeReadContext, RuntimeTransaction } from '../contracts/runtime-store.ts';
import type { JsonObject } from '../contracts/store.ts';
import type { IdentityAccess, Principal } from '../domains/access/public.ts';
import { fail, M1Error, object, version } from '../domains/common/errors.ts';
import { identifier } from '../domains/interaction/rules.ts';
import { commitRuntimeCommandIn, hashRuntimeRequest } from '../domains/runtime/command.ts';
import { WORLD_REPOSITORY } from '../domains/world/repository.ts';
import { assertCell, assertRuleset, containingPlace, DEFAULT_WORLD_RULES, validatePath } from '../domains/world/rules.ts';
import type { GridPoint, WorldAvatar, WorldRuleset } from '../domains/world/types.ts';

/** Explicit maintenance initialization. Opening the store or serving HTTP never seeds a world. */
export async function bootstrapWorld(context: RuntimeTransaction, rules: WorldRuleset = structuredClone(DEFAULT_WORLD_RULES)): Promise<void> {
  assertRuleset(rules); identifier(rules.worldId, 'worldId');
  await context.repository(WORLD_REPOSITORY).initialize({ worldId: rules.worldId, active: true, rulesetVersion: rules.version, revision: 1 }, rules);
  if (await context.tasks.currentGeneration('world') === 0) await context.tasks.advanceGeneration('world', 0);
}
export async function verifyWorldReadiness(context: RuntimeReadContext, worldId = 'default'): Promise<void> {
  const repository = context.repository(WORLD_REPOSITORY), world = await repository.getWorld(worldId);
  if (!world?.active) fail('world_not_available', 503, 'World has not been initialized');
  const rules = await repository.getRuleset(worldId, world.rulesetVersion);
  if (!rules || await context.tasks.currentGeneration('world') < 1) fail('world_not_available', 503, 'World rules or task generation are unavailable');
  assertRuleset(rules);
}
const actions = ['world.avatar.create', 'world.avatar.move', 'world.avatar.leave'];
export function createWorldService(identity: IdentityAccess<RuntimeReadContext>) {
  async function authorize(context: RuntimeReadContext, principal: Principal): Promise<string> {
    if (principal.kind !== 'agent') fail('agent_identity_required', 403, 'This action requires the Agent identity');
    await identity.authorizeAgent(context, principal, principal.agentId); return principal.agentId;
  }
  async function participation(context: RuntimeReadContext, agentId: string, worldId: string, writing: boolean): Promise<void> {
    const current = await identity.readParticipation(context, agentId);
    if (!current.runtimeActive || current.membership.state !== 'joined' || current.membership.worldId !== worldId) fail('world_not_accessible', 403, 'Current world participation is required');
    if (current.membership.platformRestricted) fail('platform_restricted', 403, 'World participation is restricted');
    if (writing && current.membership.ownerPaused) fail('participation_paused', 403, 'Agent participation is paused');
  }
  async function rulesFor(context: RuntimeReadContext, worldId: string) {
    const repository = context.repository(WORLD_REPOSITORY), world = await repository.getWorld(worldId);
    if (!world?.active) fail('world_not_accessible', 404, 'World is not available');
    const rules = await repository.getRuleset(worldId, world.rulesetVersion);
    if (!rules) fail('world_not_available', 503, 'World rules are unavailable'); return { world, rules };
  }
  async function fact(context: RuntimeTransaction, key: CommandKey, avatar: WorldAvatar, kind: string, worldRevision: number): Promise<string[]> {
    const eventId = randomUUID(), generation = await context.tasks.currentGeneration('world');
    await context.events.append({ eventId, domain: 'world', kind, schemaVersion: 1, subject: { type: 'avatar', id: avatar.id, version: avatar.version },
      worldId: avatar.worldId, actor: key.principal, source: 'external_agent', occurredAt: context.now(), causationId: key.commandId, correlationId: key.commandId,
      audience: { kind: 'public', agentIds: [] }, payload: { avatarId: avatar.id, agentId: avatar.agentId, worldId: avatar.worldId, avatarVersion: avatar.version,
        worldRevision, rulesetVersion: avatar.rulesetVersion, position: { x: avatar.position.x, y: avatar.position.y }, placeId: avatar.placeId, status: avatar.status } });
    await context.outbox.enqueue({ outboxId: randomUUID(), eventId, consumerId: 'world-projection', dedupeKey: eventId, generation, dueAt: context.now(), maxAttempts: 5 });
    return [eventId];
  }
  async function capacity(context: RuntimeTransaction, rules: WorldRuleset, cells: GridPoint[], agentId: string): Promise<void> {
    const repository = context.repository(WORLD_REPOSITORY), checked = new Set<string>();
    for (const cell of cells) {
      const place = containingPlace(rules, cell);
      if (place && place.capacity !== null && !checked.has(place.id)) {
        checked.add(place.id);
        if (await repository.countAtPlace(rules.worldId, place.id, agentId) >= place.capacity) fail('place_capacity_reached', 409, 'The place is at capacity');
      }
    }
  }
  async function execute(context: RuntimeTransaction, principal: Principal, key: CommandKey, input: JsonObject): Promise<CommandReceipt> {
    if (key.domain !== 'world' || !actions.includes(key.action) || principal.kind !== 'agent' || key.principal.kind !== 'agent' || key.principal.id !== principal.agentId) fail('invalid_request', 400, 'Invalid world command identity');
    const keys = key.action === 'world.avatar.create' ? ['worldId', 'expectedRulesetVersion'] : key.action === 'world.avatar.move'
      ? ['worldId', 'expectedVersion', 'expectedRulesetVersion', 'expectedTopologyVersion', 'path'] : ['worldId', 'expectedVersion'];
    const request = object(input, keys), worldId = identifier(request.worldId, 'worldId');
    return commitRuntimeCommandIn(context, { key, requestHash: hashRuntimeRequest(input), authorize: async current => { await participation(current, await authorize(current, principal), worldId, false); },
      classifyRejection: error => error instanceof M1Error && error.statusCode < 500 ? { outcome: error.statusCode === 409 ? 'conflict' : error.statusCode === 410 ? 'expired' : 'rejected', result: { code: error.code } } : undefined,
      handle: async current => {
        const agentId = principal.agentId, repository = current.repository(WORLD_REPOSITORY);
        await participation(current, agentId, worldId, true);
        const locked = await repository.lockWorld(worldId); if (!locked?.active) fail('world_not_accessible', 404, 'World is not available');
        const { world, rules } = await rulesFor(current, worldId), old = await repository.getAvatar(worldId, agentId), now = current.now();
        let avatar: WorldAvatar, kind: string;
        if (key.action === 'world.avatar.create') {
          if (version(request.expectedRulesetVersion, 'expectedRulesetVersion') !== rules.version) fail('version_conflict', 409, 'World rules have changed');
          if (old && old.status !== 'left') return { result: avatarResult(old, world.revision, false), eventIds: [] };
          assertCell(rules, rules.spawn); await capacity(current, rules, [rules.spawn], agentId);
          avatar = { id: old?.id ?? randomUUID(), worldId, agentId, version: old ? old.version + 1 : 1, status: 'idle', position: { ...rules.spawn },
            placeId: containingPlace(rules, rules.spawn)?.id ?? null, rulesetVersion: rules.version, createdAt: old?.createdAt ?? now, updatedAt: now }; kind = 'world.avatar.created';
        } else {
          if (!old || old.status === 'left') fail('avatar_not_found', 404, 'Avatar is not available');
          if (version(request.expectedVersion) !== old.version) fail('version_conflict', 409, 'Avatar has changed');
          if (key.action === 'world.avatar.leave') { avatar = { ...old, version: old.version + 1, status: 'left', placeId: null, updatedAt: now }; kind = 'world.avatar.left'; }
          else {
            if (version(request.expectedRulesetVersion, 'expectedRulesetVersion') !== rules.version || version(request.expectedTopologyVersion, 'expectedTopologyVersion') !== rules.topologyVersion) fail('version_conflict', 409, 'World rules have changed');
            const path = validatePath(rules, old.position, request.path); await capacity(current, rules, path, agentId); const destination = path.at(-1)!;
            avatar = { ...old, version: old.version + 1, position: { ...destination }, placeId: containingPlace(rules, destination)?.id ?? null, rulesetVersion: rules.version, status: 'idle', updatedAt: now }; kind = 'world.avatar.moved';
          }
        }
        await repository.saveAvatar(avatar, old?.version ?? null); const revision = await repository.advanceRevision(worldId, world.revision);
        return { result: avatarResult(avatar, revision, true), eventIds: await fact(current, key, avatar, kind, revision) };
      } });
  }
  async function readAvatar(context: RuntimeReadContext, principal: Principal, worldId: string, agentId?: string) {
    const actor = await authorize(context, principal); await participation(context, actor, worldId, false);
    const target = agentId ?? actor; await participation(context, target, worldId, false);
    const { world } = await rulesFor(context, worldId), avatar = await context.repository(WORLD_REPOSITORY).getAvatar(worldId, target);
    if (!avatar || avatar.status === 'left') fail('avatar_not_found', 404, 'Avatar is not available');
    return { worldId, worldRevision: world.revision, asOf: context.now(), avatar: structuredClone(avatar) };
  }
  return { execute, readAvatar,
    async authorizeReceipt(context: RuntimeReadContext, principal: Principal, receipt: CommandReceipt) {
      const actor = await authorize(context, principal);
      if (receipt.key.domain !== 'world' || receipt.key.principal.kind !== 'agent' || receipt.key.principal.id !== actor || !actions.includes(receipt.key.action)) fail('target_not_accessible', 404, 'Receipt is not accessible');
      // Failed submissions contain no world position or other target data.
      if (typeof receipt.result.worldId === 'string') await participation(context, actor, receipt.result.worldId, false);
    },
    async authorizeEvent(context: RuntimeReadContext, principal: Principal, event: RuntimeEvent) {
      const actor = await authorize(context, principal); if (event.domain !== 'world' || !event.worldId) fail('target_not_accessible', 404, 'Event is not accessible');
      await participation(context, actor, event.worldId, false);
      if (typeof event.payload.agentId !== 'string') fail('target_not_accessible', 404, 'Event is not accessible');
      await participation(context, event.payload.agentId, event.worldId, false);
    },
    async readRules(context: RuntimeReadContext, principal: Principal, worldId: string) { const actor = await authorize(context, principal); await participation(context, actor, worldId, false); const { world, rules } = await rulesFor(context, worldId); return { world: structuredClone(world), rules: structuredClone(rules), asOf: context.now() }; },
    async readScene(context: RuntimeReadContext, principal: Principal, worldId: string, options: { afterAgentId?: string; limit?: number } = {}) {
      const actor = await authorize(context, principal); await participation(context, actor, worldId, false); const limit = options.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('invalid_request', 400, 'Invalid scene limit');
      const { world } = await rulesFor(context, worldId), candidates = await context.repository(WORLD_REPOSITORY).listAvatars(worldId, { ...options, limit }); const avatars: WorldAvatar[] = [];
      for (const avatar of candidates) {
        const status = await identity.readParticipation(context, avatar.agentId);
        if (avatar.status !== 'left' && status.runtimeActive && status.membership.state === 'joined' && !status.membership.platformRestricted && status.membership.worldId === worldId) avatars.push(structuredClone(avatar));
      }
      return { worldId, worldRevision: world.revision, asOf: context.now(), scope: 'world', avatars, complete: candidates.length < limit, nextAfterAgentId: candidates.length === limit ? candidates.at(-1)!.agentId : null };
    } };
}
function avatarResult(avatar: WorldAvatar, worldRevision: number, changed: boolean): JsonObject {
  return { worldId: avatar.worldId, avatarId: avatar.id, agentId: avatar.agentId, version: avatar.version, status: avatar.status,
    position: { x: avatar.position.x, y: avatar.position.y }, placeId: avatar.placeId, rulesetVersion: avatar.rulesetVersion, worldRevision, changed };
}
