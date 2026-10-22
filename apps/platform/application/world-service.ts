import {assertWorldActionAllowed} from '../domains/access/world-action-policy.ts';
import { randomUUID } from 'node:crypto';
import type { CommandKey, CommandReceipt, IdleTaskRecurrence, RuntimeEvent, RuntimeReadContext, RuntimeTask, RuntimeTransaction } from '../contracts/runtime-store.ts';
import type { JsonObject } from '../contracts/store.ts';
import type { IdentityAccess, Principal, PublicAgentView } from '../domains/access/public.ts';
import { fail, M1Error, object, version } from '../domains/common/errors.ts';
import { identifier } from '../domains/interaction/rules.ts';
import { commitRuntimeCommandIn, hashRuntimeRequest } from '../domains/runtime/command.ts';
import { createWorldCursor } from '../domains/world/cursor.ts';
import { WORLD_REPOSITORY } from '../domains/world/repository.ts';
import { assertCell, assertRuleset, containingPlace, DEFAULT_WORLD_RULES, validatePath } from '../domains/world/rules.ts';
import { MOVEMENT_POLICY_V1, type GridPoint, type WorldAvatar, type WorldMovement, type WorldRuleset } from '../domains/world/types.ts';
import { IDLE_LIFE_POLICY_V1, idlePath, idleSeed, spawnCandidates } from '../domains/world/idle-life.ts';

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
const actions = ['world.avatar.create', 'world.avatar.move', 'world.avatar.leave', 'world.movement.stop'];
export function createWorldService(identity: IdentityAccess<RuntimeReadContext>) {
  const cursors = createWorldCursor();
  async function authorize(context: RuntimeReadContext, principal: Principal): Promise<string> {
    if (principal.kind !== 'agent') fail('agent_identity_required', 403, 'This action requires the Agent identity');
    await identity.authorizeAgent(context, principal, principal.agentId); return principal.agentId;
  }
  async function participation(context: RuntimeReadContext, agentId: string, worldId: string, writing: boolean): Promise<void> {
    const current = await identity.readParticipation(context, agentId);
    if (!current.runtimeActive || current.membership.state !== 'joined' || current.membership.worldId !== worldId) fail('world_not_accessible', 403, 'Current world participation is required');
    if (current.membership.platformRestricted) fail('platform_restricted', 403, 'World participation is restricted');
    if (writing) assertWorldActionAllowed(current.actionPolicy, 'world.avatar.move');
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
      worldId: avatar.worldId, actor: key.principal, source: key.principal.kind === 'system' ? 'rules' : 'external_agent', occurredAt: context.now(), causationId: key.commandId, correlationId: key.commandId,
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
  async function commitPosition(context: RuntimeTransaction, rules: WorldRuleset, avatar: WorldAvatar, cell: GridPoint, source:'explicit'|'idle'='idle',movementId:string|null=null): Promise<WorldAvatar> {
    const destination = validatePath(rules, avatar.position, [cell])[0]!;
    await capacity(context, rules, [destination], avatar.agentId);
    const next = { ...avatar, version: avatar.version + 1, position: { ...destination }, placeId: containingPlace(rules, destination)?.id ?? null, rulesetVersion: rules.version, updatedAt: context.now(),motion:{segmentId:avatar.id+':'+(avatar.version+1),movementId,source,from:{...avatar.position},to:{...destination},startedAt:context.now(),arriveAt:context.now()+(source==='explicit'?MOVEMENT_POLICY_V1.stepIntervalMs:IDLE_LIFE_POLICY_V1.stepIntervalMs),rulesetVersion:rules.version,topologyVersion:rules.topologyVersion,status:'committed' as const} };
    await context.repository(WORLD_REPOSITORY).saveAvatar(next, avatar.version); return next;
  }
  const restMs = (avatar: WorldAvatar) => IDLE_LIFE_POLICY_V1.minRestMs + idleSeed(avatar.id + ':' + avatar.version) % IDLE_LIFE_POLICY_V1.restJitterMs;
  async function ensureIdleTask(context: RuntimeTransaction, avatar: WorldAvatar): Promise<void> {
    const generation = await context.tasks.currentGeneration('world'), taskId = 'world-idle:' + avatar.id + ':' + generation;
    if (await context.tasks.get(taskId)) return;
    await context.tasks.schedule({ taskId, domain: 'world', kind: 'world.idle.step', handlerVersion: 1, dedupeKey: taskId,
      target: { type: 'avatar', id: avatar.id, version: 1 }, timeKind: 'utc', dueAt: context.now() + restMs(avatar), generation, maxAttempts: 5, payloadVersion: 1,
      payload: { worldId: avatar.worldId, agentId: avatar.agentId, path: [], avatarVersion: avatar.version, qualification: '', explicitStamp: '' } });
  }
  /** Bounded discovery only; no identity creation, position change, model, or browser dependency. */
  async function ensureIdleLife(context: RuntimeTransaction, worldId = 'default', afterAgentId?: string): Promise<string | undefined> {
    const repository = context.repository(WORLD_REPOSITORY);
    const world = await repository.lockWorld(worldId); if (!world?.active) return;
    const avatars = await repository.listAvatars(worldId, { ...(afterAgentId ? { afterAgentId } : {}), limit: IDLE_LIFE_POLICY_V1.scanBatch });
    for (const avatar of avatars) await ensureIdleTask(context, avatar);
    return avatars.length === IDLE_LIFE_POLICY_V1.scanBatch ? avatars.at(-1)!.agentId : undefined;
  }
  /** Current state is the fact: reuse one task and never append idle movement/event/outbox history. */
  async function handleIdleTask(context: RuntimeTransaction, scheduled: RuntimeTask): Promise<IdleTaskRecurrence> {
    if (!scheduled.lease) fail('invalid_task', 400, 'Idle rules require a current lease');
    const task = await context.tasks.assertLease(scheduled.lease, context.now());
    if (task.domain !== 'world' || task.kind !== 'world.idle.step' || task.target.type !== 'avatar' || task.handlerVersion !== 1 || task.payloadVersion !== 1) fail('invalid_task', 400, 'Unsupported idle task');
    const payload = task.payload, worldId = identifier(payload.worldId, 'worldId'), agentId = identifier(payload.agentId, 'agentId');
    const repository = context.repository(WORLD_REPOSITORY), world = await repository.lockWorld(worldId), avatar = await repository.getAvatar(worldId, agentId), now = context.now();
    const again = (delay: number, next: JsonObject): IdleTaskRecurrence => ({ idle: { dueAt: now + delay, payload: next } });
    const rest = (explicitStamp = String(payload.explicitStamp ?? ''), delay = avatar ? restMs(avatar) : 30000) => again(delay, { worldId, agentId, path: [], avatarVersion: avatar?.version ?? 1, qualification: '', explicitStamp });
    if (!world?.active || !avatar || avatar.id !== task.target.id || avatar.status !== 'idle') return rest();
    try { assertWorldActionAllowed((await identity.readParticipation(context, agentId)).actionPolicy, 'world.idle.step'); await participation(context, agentId, worldId, true); } catch (error) { if (error instanceof M1Error && error.statusCode < 500) return rest(); throw error; }
    const status = await identity.readParticipation(context, agentId);
    const qualification = [context.recoveryEpoch, status.runtimeVersion, status.membership.ownerPauseVersion, status.membership.platformVersion, status.membership.sharingGeneration, status.actionPolicy.version].join(':');
    const explicit = await repository.getLatestMovement(worldId, agentId), explicitStamp = explicit ? explicit.id + ':' + explicit.version : '';
    if (await repository.getActiveMovement(worldId, agentId)) return rest(explicitStamp);
    // A deliberate stop or arrival earns a full pause, even if its Avatar version did not change.
    if (explicit && now < explicit.updatedAt + restMs(avatar)) return rest(explicitStamp, Math.max(1000, explicit.updatedAt + restMs(avatar) - now));
    if (payload.explicitStamp !== explicitStamp || payload.avatarVersion !== avatar.version) return rest(explicitStamp);
    const { rules } = await rulesFor(context, worldId);
    let path: GridPoint[];
    if (!Array.isArray(payload.path) || payload.path.length > IDLE_LIFE_POLICY_V1.maxPathLength) fail('invalid_task', 400, 'Invalid bounded idle path');
    if (payload.path.length) {
      if (payload.qualification !== qualification || payload.rulesetVersion !== rules.version || payload.topologyVersion !== rules.topologyVersion) return rest(explicitStamp);
      path = payload.path as unknown as GridPoint[];
    } else {
      const neighbors = await repository.listAvatars(worldId, { limit: 100 });
      path = idlePath(rules, avatar.position, neighbors.filter(other => other.agentId !== agentId).map(other => other.position), idleSeed(avatar.id + ':' + avatar.version));
      if (!path.length) return rest(explicitStamp);
    }
    const step = path[0]!;
    const neighbors = await repository.listAvatars(worldId, { limit: 100 });
    if (neighbors.some(other => other.agentId !== agentId && other.position.x === step.x && other.position.y === step.y)) return rest(explicitStamp);
    context.validateBeforeCommit(async latest => {
      await participation(latest, agentId, worldId, true); const fresh = await identity.readParticipation(latest, agentId), current = await rulesFor(latest, worldId);
      if ([latest.recoveryEpoch, fresh.runtimeVersion, fresh.membership.ownerPauseVersion, fresh.membership.platformVersion, fresh.membership.sharingGeneration, fresh.actionPolicy.version].join(':') !== qualification
        || current.rules.version !== rules.version || current.rules.topologyVersion !== rules.topologyVersion) fail('world_qualification_changed', 409, 'Idle qualification changed before commit');
    });
    let next: WorldAvatar;
    try { next = await commitPosition(context, rules, avatar, step); } catch (error) { if (error instanceof M1Error && error.statusCode < 500) return rest(explicitStamp); throw error; }
    await repository.advanceRevision(worldId, world.revision);
    return again(path.length > 1 ? IDLE_LIFE_POLICY_V1.stepIntervalMs : restMs(next), { worldId, agentId, path: path.slice(1) as unknown as JsonObject[], avatarVersion: next.version,
      qualification, rulesetVersion: rules.version, topologyVersion: rules.topologyVersion, explicitStamp });
  }
  async function scheduleStep(context: RuntimeTransaction, movement: WorldMovement, actionPolicyVersion: number): Promise<void> {
    if (movement.nextDueAt === null) return;
    await context.tasks.schedule({ taskId: randomUUID(), domain: 'world', kind: 'world.movement.step', handlerVersion: 1, dedupeKey: movement.id + ':' + movement.version,
      target: { type: 'movement', id: movement.id, version: movement.version }, timeKind: 'utc', dueAt: movement.nextDueAt,
      generation: await context.tasks.currentGeneration('world'), maxAttempts: 5, payloadVersion: 1, payload: { actionPolicyVersion } });
  }
  async function movementFact(context: RuntimeTransaction, key: CommandKey, movement: WorldMovement, revision: number): Promise<string[]> {
    const eventId = randomUUID(); await context.events.append({ eventId, domain: 'world', kind: 'world.movement.' + movement.state, schemaVersion: 1,
      subject: { type: 'movement', id: movement.id, version: movement.version }, worldId: movement.worldId, actor: key.principal,
      source: key.principal.kind === 'system' ? 'rules' : 'external_agent', occurredAt: context.now(), causationId: key.commandId, correlationId: movement.commandId,
      audience: { kind: 'agents', agentIds: [movement.agentId] }, payload: movementResult(movement, revision) });
    await context.outbox.enqueue({ outboxId: randomUUID(), eventId, consumerId: 'world-projection', dedupeKey: eventId, generation: await context.tasks.currentGeneration('world'), dueAt: context.now(), maxAttempts: 5 }); return [eventId];
  }
  function currentPlanRules(movement:WorldMovement,rules:WorldRuleset):boolean {
    if(movement.rulesetVersion===rules.version&&movement.topologyVersion===rules.topologyVersion)return true;
    return movement.rulesetVersion===1&&movement.topologyVersion===1&&rules.version===2&&rules.topologyVersion===2&&rules.mapManifest?.mapId==='pixel-town-v2'
      &&movement.path.slice(movement.nextStep).every(cell=>cell.x>=0&&cell.x<=15&&cell.y>=0&&cell.y<=15);
  }
  async function handleTask(context: RuntimeTransaction, scheduled: RuntimeTask): Promise<void> {
    if (!scheduled.lease) fail('invalid_task', 400, 'World movement requires a current lease');
    const task = await context.tasks.assertLease(scheduled.lease, context.now());
    if (task.domain !== 'world' || task.kind !== 'world.movement.step' || task.target.type !== 'movement' || task.handlerVersion !== 1 || task.payloadVersion !== 1) fail('invalid_task', 400, 'Unsupported World task');
    const repository = context.repository(WORLD_REPOSITORY), movement = await repository.getMovement(task.target.id);
    if (!movement || movement.version !== task.target.version || !['pending', 'running'].includes(movement.state)) return;
    const world = await repository.lockWorld(movement.worldId); if (!world) fail('world_not_available', 503, 'World is not available');
    const key: CommandKey = { domain: 'world', action: task.kind, commandId: task.taskId, principal: { kind: 'system', id: 'world-rules' }, recoveryEpoch: context.recoveryEpoch };
    let rules: WorldRuleset, avatar: WorldAvatar, destination: GridPoint;
    try {
      await participation(context, movement.agentId, movement.worldId, true);
      const status = await identity.readParticipation(context, movement.agentId), q = movement.qualification;
      if (movement.recoveryEpoch !== context.recoveryEpoch || status.runtimeVersion !== q.runtimeVersion || status.membership.ownerPauseVersion !== q.ownerPauseVersion
        || status.membership.platformVersion !== q.platformVersion || status.membership.sharingGeneration !== q.sharingGeneration || status.actionPolicy.version !== (task.payload.actionPolicyVersion ?? 0)) fail('movement_qualification_changed', 409, 'Movement qualification has changed');
      const current = await rulesFor(context, movement.worldId); rules = current.rules;
      if (!currentPlanRules(movement,rules) || movement.policyVersion !== MOVEMENT_POLICY_V1.version || movement.stepIntervalMs !== MOVEMENT_POLICY_V1.stepIntervalMs) fail('movement_rules_changed', 409, 'Movement rules have changed');
      const existing = await repository.getAvatar(movement.worldId, movement.agentId); if (!existing || existing.id !== movement.avatarId || existing.status !== 'idle' || existing.version !== movement.expectedAvatarVersion) fail('movement_avatar_changed', 409, 'Avatar has changed'); avatar = existing;
      const cell = movement.path[movement.nextStep]; if (!cell || movement.nextDueAt === null || task.dueAt !== movement.nextDueAt || context.now() < movement.nextDueAt) fail('movement_plan_invalid', 409, 'Movement plan is not executable');
      destination = validatePath(rules, avatar.position, [cell])[0]!; await capacity(context, rules, [destination], movement.agentId);
      context.validateBeforeCommit(async latest => {
        await participation(latest, movement.agentId, movement.worldId, true); const fresh = await identity.readParticipation(latest, movement.agentId), q = movement.qualification;
        const current = await rulesFor(latest, movement.worldId);
        if (fresh.runtimeVersion !== q.runtimeVersion || fresh.membership.ownerPauseVersion !== q.ownerPauseVersion || fresh.membership.platformVersion !== q.platformVersion
          || fresh.membership.sharingGeneration !== q.sharingGeneration || fresh.actionPolicy.version !== (task.payload.actionPolicyVersion ?? 0) || current.rules.version !== rules.version || current.rules.topologyVersion !== rules.topologyVersion || !currentPlanRules(movement,current.rules)) fail('world_qualification_changed', 409, 'Movement qualification changed before commit');
      });
    } catch (error) {
      if (!(error instanceof M1Error) || error.statusCode >= 500) throw error;
      const next = stopped(movement, context.now(), error.code); await repository.saveMovement(next, movement.version); const revision = await repository.advanceRevision(movement.worldId, world.revision); await movementFact(context, key, next, revision); return;
    }
    const now = context.now(), nextAvatar = await commitPosition(context, rules, avatar, destination,'explicit',movement.id);
    const finished = movement.nextStep + 1 === movement.path.length;
    const next: WorldMovement = { ...movement, version: movement.version + 1, state: finished ? 'completed' : 'running', nextStep: movement.nextStep + 1,
      expectedAvatarVersion: nextAvatar.version, updatedAt: now, nextDueAt: finished ? null : now + movement.stepIntervalMs, completedAt: finished ? now : null };
    await repository.saveMovement(next, movement.version); await scheduleStep(context, next, Number(task.payload.actionPolicyVersion ?? 0));
    const revision = await repository.advanceRevision(movement.worldId, world.revision); await fact(context, key, nextAvatar, 'world.avatar.moved', revision); await movementFact(context, key, next, revision);
    // Controlled scheduler completes the same lease only after this handler's writes succeed.
  }
  async function projectedAvatar(context:RuntimeReadContext,avatar:WorldAvatar):Promise<WorldAvatar>{
    const status=await identity.readParticipation(context,avatar.agentId),motion=avatar.motion;
    if(!motion||status.membership.ownerPaused||status.membership.platformRestricted||status.actionPolicy.mode!=='autonomous')return {...structuredClone(avatar),motion:null};
    const latest=await context.repository(WORLD_REPOSITORY).getLatestMovement(avatar.worldId,avatar.agentId);
    const cancelled=latest?.state==='stopped'&&latest.updatedAt>=motion.startedAt;
    return {...structuredClone(avatar),motion:cancelled?null:structuredClone(motion)};
  }
  async function mapProjection(context:RuntimeReadContext,worldId:string,npcs=false){const {world,rules}=await rulesFor(context,worldId);return {worldId,worldRevision:world.revision,rulesetVersion:rules.version,topologyVersion:rules.topologyVersion,...(npcs?{npcs:structuredClone(rules.mapManifest?.npcs??[])}:{manifest:structuredClone(rules.mapManifest??null)}),asOf:context.now()};}
  async function sceneProjection(context: RuntimeReadContext, worldId: string, observer: string, options: { cursor?: string; limit?: number } = {}) {
      const limit = options.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || options.cursor !== undefined && typeof options.cursor !== 'string') fail('invalid_request', 400, 'Invalid scene query');
      const scope = { instanceId: context.instanceId, recoveryEpoch: context.recoveryEpoch, worldId, agentId: observer, limit };
      let after = options.cursor === undefined ? undefined : cursors.decode(options.cursor, scope, context.now()), complete = false, scanned = 0;
      const { world,rules } = await rulesFor(context, worldId), avatars: (WorldAvatar & { profile: PublicAgentView })[] = [], repository = context.repository(WORLD_REPOSITORY);
      while (avatars.length < limit && scanned < 500 && !complete) {
        const batchSize = Math.min(50, 500 - scanned), candidates = await repository.listAvatars(worldId, { ...(after ? { afterAgentId: after } : {}), limit: batchSize });
        if (!candidates.length) { complete = true; break; }
        for (let index = 0; index < candidates.length; index++) {
          const avatar = candidates[index]!; after = avatar.agentId; scanned++;
          try { await participation(context, avatar.agentId, worldId, false); const profile = await identity.readPublicAgent(context, avatar.agentId); if (avatar.status !== 'left' && profile) avatars.push({ ...await projectedAvatar(context,avatar), profile: {...structuredClone(profile),appearance:resolveAppearance(profile.appearance,{avatarId:avatar.id})!} }); }
          catch (error) { if (!(error instanceof M1Error) || error.statusCode >= 500) throw error; }
          if (avatars.length === limit) { complete = index === candidates.length - 1 && candidates.length < batchSize; break; }
        }
        if (avatars.length < limit && candidates.length < batchSize) complete = true;
      }
      return { worldId, worldRevision: world.revision, asOf: context.now(), scope: 'world', avatars,npcs:structuredClone(rules.mapManifest?.npcs??[]), complete, nextCursor: !complete && after ? cursors.encode(after, scope, context.now()) : null };
  }
  async function execute(context: RuntimeTransaction, principal: Principal, key: CommandKey, input: JsonObject): Promise<CommandReceipt> {
    if (key.domain !== 'world' || !actions.includes(key.action) || principal.kind !== 'agent' || key.principal.kind !== 'agent' || key.principal.id !== principal.agentId) fail('invalid_request', 400, 'Invalid world command identity');
    const keys = key.action === 'world.avatar.create' ? ['worldId', 'expectedRulesetVersion'] : key.action === 'world.avatar.move'
      ? ['worldId', 'expectedVersion', 'expectedRulesetVersion', 'expectedTopologyVersion', 'path'] : key.action === 'world.movement.stop' ? ['worldId', 'movementId', 'expectedVersion'] : ['worldId', 'expectedVersion'];
    const request = object(input, keys), worldId = identifier(request.worldId, 'worldId');
    return commitRuntimeCommandIn(context, { key, requestHash: hashRuntimeRequest(input), authorize: async current => {
      await participation(current, await authorize(current, principal), worldId, false);
      current.validateBeforeCommit(async latest => { await participation(latest, await authorize(latest, principal), worldId, false); });
    },
      classifyRejection: error => error instanceof M1Error && error.statusCode < 500 ? { outcome: error.statusCode === 409 ? 'conflict' : error.statusCode === 410 ? 'expired' : 'rejected', result: { code: error.code } } : undefined,
      handle: async current => {
        const agentId = principal.agentId, repository = current.repository(WORLD_REPOSITORY);
        await participation(current, agentId, worldId, key.action !== 'world.movement.stop');
        const qualification = await identity.readParticipation(current, agentId);
        assertWorldActionAllowed(qualification.actionPolicy, key.action);
        current.validateBeforeCommit(async latest => {
          await participation(latest, agentId, worldId, key.action !== 'world.movement.stop');
          const fresh = await identity.readParticipation(latest, agentId);
          assertWorldActionAllowed(fresh.actionPolicy, key.action);
          if (fresh.runtimeVersion !== qualification.runtimeVersion || fresh.membership.ownerPauseVersion !== qualification.membership.ownerPauseVersion
            || fresh.membership.platformVersion !== qualification.membership.platformVersion || fresh.membership.sharingGeneration !== qualification.membership.sharingGeneration || fresh.actionPolicy.version !== qualification.actionPolicy.version) fail('world_qualification_changed', 409, 'World qualification changed before commit');
        });
        const locked = await repository.lockWorld(worldId); if (!locked?.active) fail('world_not_accessible', 404, 'World is not available');
        const { world, rules } = await rulesFor(current, worldId), old = await repository.getAvatar(worldId, agentId), now = current.now();
        if (key.action === 'world.movement.stop') {
          const movement = await repository.getMovement(identifier(request.movementId, 'movementId'));
          if (!movement || movement.agentId !== agentId || movement.worldId !== worldId) fail('movement_not_found', 404, 'Movement is not available');
          if (version(request.expectedVersion) !== movement.version) fail('version_conflict', 409, 'Movement has changed');
          if (!['pending', 'running'].includes(movement.state)) return { result: movementResult(movement, world.revision), eventIds: [] };
          const next = stopped(movement, now, 'agent_stopped'); await repository.saveMovement(next, movement.version);
          const revision = await repository.advanceRevision(worldId, world.revision); return { result: movementResult(next, revision), eventIds: await movementFact(current, key, next, revision) };
        }
        let avatar: WorldAvatar, kind: string;
        if (key.action === 'world.avatar.create') {
          if (version(request.expectedRulesetVersion, 'expectedRulesetVersion') !== rules.version) fail('version_conflict', 409, 'World rules have changed');
          if (old && old.status !== 'left') return { result: avatarResult(old, world.revision, false), eventIds: [] };
          let spawn = old?.position;
          if (!spawn) {
            const occupied = (await repository.listAvatars(worldId, { limit: 100 })).map(other => other.position);
            for (const candidate of spawnCandidates(rules, occupied, idleSeed(agentId))) {
              try { await capacity(current, rules, [candidate], agentId); spawn = candidate; break; }
              catch (error) { if (!(error instanceof M1Error) || error.code !== 'place_capacity_reached') throw error; }
            }
          }
          if (!spawn) fail('place_capacity_reached', 409, 'No accessible spawn is available');
          assertCell(rules, spawn); await capacity(current, rules, [spawn], agentId);
          avatar = { id: old?.id ?? randomUUID(), worldId, agentId, version: old ? old.version + 1 : 1, status: 'idle', position: { ...spawn },
            placeId: containingPlace(rules, spawn)?.id ?? null, rulesetVersion: rules.version, createdAt: old?.createdAt ?? now, updatedAt: now,motion:null }; kind = 'world.avatar.created';
        } else {
          if (!old || old.status === 'left') fail('avatar_not_found', 404, 'Avatar is not available');
          if (version(request.expectedVersion) !== old.version) fail('version_conflict', 409, 'Avatar has changed');
          if (key.action === 'world.avatar.leave') { const active = await repository.getActiveMovement(worldId, agentId); if (active) await repository.saveMovement(stopped(active, now, 'avatar_left'), active.version); avatar = { ...old, version: old.version + 1, status: 'left', placeId: null, updatedAt: now,motion:null }; kind = 'world.avatar.left'; }
          else {
            if (version(request.expectedRulesetVersion, 'expectedRulesetVersion') !== rules.version || version(request.expectedTopologyVersion, 'expectedTopologyVersion') !== rules.topologyVersion) fail('version_conflict', 409, 'World rules have changed');
            if (await repository.getActiveMovement(worldId, agentId)) fail('movement_in_progress', 409, 'The Avatar already has an active movement');
            const path = validatePath(rules, old.position, request.path); await capacity(current, rules, path, agentId);
            const status = await identity.readParticipation(current, agentId);
            const movement: WorldMovement = { id: randomUUID(), worldId, agentId, avatarId: old.id, version: 1, state: 'pending', origin: { ...old.position }, path,
              nextStep: 0, expectedAvatarVersion: old.version, rulesetVersion: rules.version, topologyVersion: rules.topologyVersion, policyVersion: MOVEMENT_POLICY_V1.version,
              stepIntervalMs: MOVEMENT_POLICY_V1.stepIntervalMs, createdAt: now, updatedAt: now, nextDueAt: now + MOVEMENT_POLICY_V1.stepIntervalMs, completedAt: null, stoppedCode: null,
              commandId: key.commandId, recoveryEpoch: current.recoveryEpoch, qualification: { runtimeVersion: status.runtimeVersion, ownerPauseVersion: status.membership.ownerPauseVersion,
                platformVersion: status.membership.platformVersion, sharingGeneration: status.membership.sharingGeneration } };
            await repository.saveMovement(movement, null); await scheduleStep(current, movement, status.actionPolicy.version); const revision = await repository.advanceRevision(worldId, world.revision);
            return { result: movementResult(movement, revision), eventIds: await movementFact(current, key, movement, revision) };
          }
        }
        await repository.saveAvatar(avatar, old?.version ?? null); if (avatar.status === 'idle') await ensureIdleTask(current, avatar); const revision = await repository.advanceRevision(worldId, world.revision);
        return { result: avatarResult(avatar, revision, true), eventIds: await fact(current, key, avatar, kind, revision) };
      } });
  }
  async function readAvatar(context: RuntimeReadContext, principal: Principal, worldId: string, agentId?: string) {
    const actor = await authorize(context, principal); await participation(context, actor, worldId, false);
    const target = agentId ?? actor;
    try { await participation(context, target, worldId, false); if (target !== actor && !await identity.readPublicAgent(context, target)) fail('avatar_not_found', 404, 'Avatar is not available'); } catch (error) { if (error instanceof M1Error && [403, 404].includes(error.statusCode)) fail('avatar_not_found', 404, 'Avatar is not available'); throw error; }
    const { world } = await rulesFor(context, worldId), avatar = await context.repository(WORLD_REPOSITORY).getAvatar(worldId, target);
    if (!avatar || avatar.status === 'left') fail('avatar_not_found', 404, 'Avatar is not available');
    return { worldId, worldRevision: world.revision, asOf: context.now(), avatar: await projectedAvatar(context,avatar) };
  }
  return { execute, readAvatar, handleTask, handleIdleTask, ensureIdleLife,
    async readMapManifest(context:RuntimeReadContext,principal:Principal,worldId:string){await participation(context,await authorize(context,principal),worldId,false);return mapProjection(context,worldId);},
    async readNpcs(context:RuntimeReadContext,principal:Principal,worldId:string){await participation(context,await authorize(context,principal),worldId,false);return mapProjection(context,worldId,true);},
    async readPublicMapManifest(context:RuntimeReadContext,worldId:string){return mapProjection(context,worldId);},
    async readPublicNpcs(context:RuntimeReadContext,worldId:string){return mapProjection(context,worldId,true);},
    async readMovement(context: RuntimeReadContext, principal: Principal, worldId: string, movementId?: string): Promise<JsonObject> {
      const actor = await authorize(context, principal); await participation(context, actor, worldId, false); const { world } = await rulesFor(context, worldId), repository = context.repository(WORLD_REPOSITORY);
      const movement = movementId === undefined ? await repository.getActiveMovement(worldId, actor) : await repository.getMovement(identifier(movementId, 'movementId'));
      if (!movement || movement.agentId !== actor || movement.worldId !== worldId) fail('movement_not_found', 404, 'Movement is not available');
      return { ...movementResult(movement, world.revision), asOf: context.now() };
    },
    async authorizeReceipt(context: RuntimeReadContext, principal: Principal, receipt: CommandReceipt) {
      const actor = await authorize(context, principal);
      if (receipt.key.domain !== 'world' || receipt.key.principal.kind !== 'agent' || receipt.key.principal.id !== actor || !actions.includes(receipt.key.action)) fail('target_not_accessible', 404, 'Receipt is not accessible');
      // Failed submissions contain no world position or other target data.
      if (typeof receipt.result.worldId === 'string') await participation(context, actor, receipt.result.worldId, false);
    },
    async authorizeEvent(context: RuntimeReadContext, principal: Principal, event: RuntimeEvent) {
      const actor = await authorize(context, principal); if (event.domain !== 'world' || !event.worldId) fail('target_not_accessible', 404, 'Event is not accessible');
      await participation(context, actor, event.worldId, false);
      if (event.subject.type === 'movement' && !event.audience.agentIds.includes(actor)) fail('target_not_accessible', 404, 'Event is not accessible');
      if (typeof event.payload.agentId !== 'string') fail('target_not_accessible', 404, 'Event is not accessible');
      try {
        await participation(context, event.payload.agentId, event.worldId, false);
        if (!await identity.readPublicAgent(context, event.payload.agentId)) fail('target_not_accessible', 404, 'Event is not accessible');
      } catch (error) {
        if (error instanceof M1Error && [403, 404].includes(error.statusCode)) fail('target_not_accessible', 404, 'Event is not accessible');
        throw error;
      }
    },
    async readRules(context: RuntimeReadContext, principal: Principal, worldId: string) { const actor = await authorize(context, principal); await participation(context, actor, worldId, false); const { world, rules } = await rulesFor(context, worldId); return { world: structuredClone(world), rules: structuredClone(rules), asOf: context.now() }; },
    async readScene(context: RuntimeReadContext, principal: Principal, worldId: string, options: { cursor?: string; limit?: number } = {}) {
      const actor = await authorize(context, principal); await participation(context, actor, worldId, false); return sceneProjection(context, worldId, 'agent:' + actor, options);
    },
    async readPublicScene(context: RuntimeReadContext, worldId: string, options: { cursor?: string; limit?: number } = {}) { return sceneProjection(context, worldId, 'public-world-observer', options); },
    async readPublicRules(context: RuntimeReadContext, worldId: string) { const { world, rules } = await rulesFor(context, worldId); return { world: structuredClone(world), rules: structuredClone(rules), asOf: context.now() }; }
  };
}
function avatarResult(avatar: WorldAvatar, worldRevision: number, changed: boolean): JsonObject {
  return { worldId: avatar.worldId, avatarId: avatar.id, agentId: avatar.agentId, version: avatar.version, status: avatar.status,
    position: { x: avatar.position.x, y: avatar.position.y }, placeId: avatar.placeId, rulesetVersion: avatar.rulesetVersion, worldRevision, changed };
}

function stopped(movement: WorldMovement, now: number, code: string): WorldMovement {
  return { ...movement, version: movement.version + 1, state: 'stopped', updatedAt: now, nextDueAt: null, stoppedCode: code };
}
function movementResult(movement: WorldMovement, worldRevision: number): JsonObject {
  return { movementId: movement.id, worldId: movement.worldId, agentId: movement.agentId, avatarId: movement.avatarId, version: movement.version,
    state: movement.state, nextStep: movement.nextStep, pathLength: movement.path.length, nextDueAt: movement.nextDueAt, completedAt: movement.completedAt,
    stoppedCode: movement.stoppedCode, policyVersion: movement.policyVersion, stepIntervalMs: movement.stepIntervalMs, avatarVersion: movement.expectedAvatarVersion, worldRevision };
}
import {resolveAppearance} from '../domains/profile/appearance.ts';
