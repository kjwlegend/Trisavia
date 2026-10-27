import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapWorld, createWorldService } from '../../apps/platform/application/world-service.ts';
import { createDeterministicScheduler } from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import { DEFAULT_WORLD_RULES, assertCell } from '../../apps/platform/domains/world/rules.ts';
import { CURRENT_IDLE_LIFE_POLICY } from '../../apps/platform/domains/world/idle-life.ts';
import type { GridPoint, WorldRuleset } from '../../apps/platform/domains/world/types.ts';
import { coreFixture } from './runtime-fixture.ts';

const distance = (a: GridPoint, b: GridPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
async function fixture() {
  const f = coreFixture(), a = f.addAgent('idle-agent'), service = createWorldService(f.identity);
  await f.store.transaction(ctx => bootstrapWorld(ctx));
  await f.store.transaction(ctx => service.execute(ctx, a, f.key(a, 'world.avatar.create'), { worldId: 'default', expectedRulesetVersion: 1 }));
  const scheduler = createDeterministicScheduler({ store: f.store, workerId: 'idle-test', batchLimit: 2, handlers: [
    { kind: 'world.idle.step', version: 1, run: service.handleIdleTask }, { kind: 'world.movement.step', version: 1, run: service.handleTask }
  ] });
  const avatar = () => [...f.state.avatars.values()][0]!;
  const idle = () => [...f.state.tasks.values()].find(task => task.kind === 'world.idle.step')!;
  async function tick() { f.now = Math.max(f.now, idle().dueAt); return scheduler.runDue(); }
  return { f, a, service, scheduler, avatar, idle, tick };
}

test('new Avatars disperse over current walkable cells; repeated create and re-entry preserve identity and location', async () => {
  const f = coreFixture(), service = createWorldService(f.identity), rules: WorldRuleset = structuredClone(DEFAULT_WORLD_RULES);
  rules.blocked = [{ x: 15, y: 15 }, { x: 0, y: 15 }];
  rules.places = [{ id: 'commons', bounds: { left: 0, top: 0, right: 14, bottom: 15 }, access: 'members', capacity: null }, { id: 'closed', bounds: { left: 15, top: 0, right: 15, bottom: 14 }, access: 'closed', capacity: null }];
  await f.store.transaction(ctx => bootstrapWorld(ctx, rules));
  for (let index = 0; index < 8; index++) {
    const agent = f.addAgent('new-' + index);
    const created = await f.store.transaction(ctx => service.execute(ctx, agent, f.key(agent, 'world.avatar.create'), { worldId: 'default', expectedRulesetVersion: 1 }));
    assert.equal(created.outcome, 'committed');
  }
  const avatars = [...f.state.avatars.values()], positions = new Set(avatars.map(avatar => JSON.stringify(avatar.position)));
  assert.equal(positions.size, avatars.length); for (const avatar of avatars) assertCell(rules, avatar.position);
  assert.ok(avatars.some(avatar => distance(avatar.position, rules.spawn) >= 10));
  const agent = f.addAgent('new-0'), before = structuredClone(avatars[0]!);
  const again = await f.store.transaction(ctx => service.execute(ctx, agent, f.key(agent, 'world.avatar.create'), { worldId: 'default', expectedRulesetVersion: 1 }));
  assert.equal(again.result.changed, false);
  await f.store.transaction(ctx => service.execute(ctx, agent, f.key(agent, 'world.avatar.leave'), { worldId: 'default', expectedVersion: before.version }));
  await f.store.transaction(ctx => service.execute(ctx, agent, f.key(agent, 'world.avatar.create'), { worldId: 'default', expectedRulesetVersion: 1 }));
  const restored = await f.world.getAvatar('default', 'new-0');
  assert.equal(restored!.id, before.id); assert.deepEqual(restored!.position, before.position); assert.equal(f.state.tasks.size, 8);
});

test('no browser or Agent reads drive idle rules: one authoritative cell per due execution, finite rest, bounded persisted rows', async () => {
  const x = await fixture(), { f, avatar, idle, tick, scheduler } = x;
  const initial = structuredClone(avatar()), events = f.state.events.length, outbox = f.state.outbox.size;
  assert.equal((await scheduler.runDue()).claimed, 0); assert.deepEqual(avatar(), initial);
  f.now = idle().dueAt + 3_600_000; await tick();
  assert.equal(distance(avatar().position, initial.position), 1); assert.equal(avatar().version, initial.version + 1);
  assert.equal(f.state.worlds.get('default')!.revision, 3);
  let foundRest = false;
  for (let index = 0; index < 100; index++) {
    const before = structuredClone(avatar());
    if (idle().dueAt - f.now >= CURRENT_IDLE_LIFE_POLICY.minRestMs) {
      foundRest = true; f.now = idle().dueAt - 1; assert.equal((await scheduler.runDue()).claimed, 0); assert.deepEqual(avatar(), before);
    }
    await tick(); assert.equal(distance(avatar().position, before.position), 1); assert.equal(avatar().version, before.version + 1);
    assert.ok(idle().dueAt >= f.now + CURRENT_IDLE_LIFE_POLICY.stepIntervalMs);
  }
  assert.ok(foundRest); assert.equal(f.state.tasks.size, 1); assert.equal(f.state.movements.size, 0); assert.equal(f.state.events.length, events); assert.equal(f.state.outbox.size, outbox);
  assert.equal(idle().state, 'pending'); assert.equal(idle().attempts, 0); await scheduler.close();
});

test('explicit movement wins over an in-flight idle route, and explicit arrival or stop receives a real pause', async () => {
  for (const stop of [false, true]) {
    const x = await fixture(), { f, a, service, scheduler, avatar, idle, tick } = x;
    await tick();
    const before = structuredClone(avatar()), next = { x: before.position.x === 15 ? 14 : before.position.x + 1, y: before.position.y };
    const result = await f.store.transaction(ctx => service.execute(ctx, a, f.key(a, 'world.avatar.move'), { worldId: 'default', expectedVersion: before.version, expectedRulesetVersion: 1, expectedTopologyVersion: 1, path: [next] }));
    assert.equal(result.outcome, 'committed'); const movementId = String(result.result.movementId);
    if (stop) {
      const stopped = await f.store.transaction(ctx => service.execute(ctx, a, f.key(a, 'world.movement.stop'), { worldId: 'default', movementId, expectedVersion: 1 }));
      assert.equal(stopped.result.state, 'stopped');
    } else { f.now = Math.max(f.now,f.state.movements.get(movementId)!.nextDueAt!); await scheduler.runDue(); assert.deepEqual(avatar().position, next); }
    const explicit = f.state.movements.get(movementId)!, endPosition = structuredClone(avatar().position);
    while (idle().dueAt < explicit.updatedAt + CURRENT_IDLE_LIFE_POLICY.minRestMs) { await tick(); assert.deepEqual(avatar().position, endPosition); }
    f.now = explicit.updatedAt + CURRENT_IDLE_LIFE_POLICY.minRestMs - 1; await scheduler.runDue(); assert.deepEqual(avatar().position, endPosition);
    let resumed = false;
    for (let index = 0; index < 4; index++) { await tick(); if (distance(avatar().position, endPosition) > 0) { resumed = true; break; } }
    assert.ok(resumed); await scheduler.close();
  }
});

test('pause, restriction, membership exit and revoked runtime stop idle steps; resume abandons the old route', async () => {
  for (const mode of ['paused', 'restricted', 'left', 'revoked']) {
    const x = await fixture(), { f, tick, avatar, scheduler, idle } = x; await tick(); const before = structuredClone(avatar());
    if (mode === 'paused') f.membership('idle-agent', { ownerPaused: true, ownerPauseVersion: 2 });
    if (mode === 'restricted') f.membership('idle-agent', { platformRestricted: true, platformVersion: 2 });
    if (mode === 'left') f.membership('idle-agent', { state: 'left', sharingGeneration: 2 });
    if (mode === 'revoked') f.state.participants.set('idle-agent', { ...f.state.participants.get('idle-agent')!, runtimeActive: false });
    await tick(); assert.deepEqual(avatar(), before); assert.deepEqual(idle().payload.path, []);
    f.membership('idle-agent', { ownerPaused: false, platformRestricted: false, state: 'joined' }); f.state.participants.set('idle-agent', { ...f.state.participants.get('idle-agent')!, runtimeActive: true });
    await tick(); assert.equal(distance(avatar().position, before.position), 1); await scheduler.close();
  }
});

test('restart reuses persisted idle state and stale leases cannot move an Avatar', async () => {
  const x = await fixture(), { f, service, avatar, idle, scheduler, tick } = x;
  await tick(); const taskId = idle().taskId, before = structuredClone(avatar()); await scheduler.close();
  await f.store.transaction(ctx => service.ensureIdleLife(ctx));
  assert.deepEqual(avatar(), before); assert.equal(f.state.tasks.size, 1); assert.equal(idle().taskId, taskId);
  f.now = idle().dueAt;
  const abandoned = (await f.context.tasks.claimDue({ now: f.now, workerId: 'old', leaseMs: 10, limit: 1, kinds: ['world.idle.step'] }))[0]!;
  f.now += 10; const restarted = createWorldService(f.identity);
  const current = (await f.context.tasks.claimDue({ now: f.now, workerId: 'new', leaseMs: 1000, limit: 1, kinds: ['world.idle.step'] }))[0]!;
  await assert.rejects(f.store.transaction(ctx => restarted.handleIdleTask(ctx, abandoned)), { code: 'lease_lost' });
  await f.store.transaction(async ctx => { const next = await restarted.handleIdleTask(ctx, current); await ctx.tasks.recurIdle(current.lease!, { now: ctx.now(), ...next.idle }); });
  assert.equal(distance(avatar().position, before.position), 1); assert.equal(f.state.tasks.size, 1);
});

test('an idle step rechecks qualification at commit and rolls its authoritative position back if permission changes', async () => {
  const { f, service, avatar, idle, scheduler } = await fixture(); await scheduler.close(); f.now = idle().dueAt;
  const task = (await f.context.tasks.claimDue({ now: f.now, workerId: 'guard', leaseMs: 1000, limit: 1, kinds: ['world.idle.step'] }))[0]!, before = structuredClone(avatar());
  await assert.rejects(f.store.transaction(async ctx => { const next = await service.handleIdleTask(ctx, task); await ctx.tasks.recurIdle(task.lease!, { now: ctx.now(), ...next.idle }); f.membership('idle-agent', { ownerPaused: true, ownerPauseVersion: 2 }); }), { code: 'participation_paused' });
  assert.deepEqual(avatar(), before);
});

test('legacy overlapping Avatars acquire tasks without relocation and only separate through real logical steps', async () => {
  const { f, service, a, scheduler, avatar } = await fixture();
  const b = f.addAgent('idle-neighbor');
  await f.store.transaction(ctx => service.execute(ctx, b, f.key(b, 'world.avatar.create'), { worldId: 'default', expectedRulesetVersion: 1 }));
  await scheduler.close();
  for (const value of f.state.avatars.values()) { value.position = { x: 0, y: 0 }; value.placeId = 'commons'; }
  f.state.tasks.clear(); const before = structuredClone([...f.state.avatars.values()]);
  await f.store.transaction(ctx => service.ensureIdleLife(ctx)); assert.deepEqual([...f.state.avatars.values()], before);
  const next = createDeterministicScheduler({ store: f.store, workerId: 'legacy-rules', batchLimit: 1, handlers: [{ kind: 'world.idle.step', version: 1, run: service.handleIdleTask }] });
  f.now = Math.max(...[...f.state.tasks.values()].map(task => task.dueAt)); await next.runDue();
  const values = [...f.state.avatars.values()]; assert.equal(values.reduce((sum, value) => sum + distance(value.position, { x: 0, y: 0 }), 0), 1);
  assert.equal(new Set(values.map(value => JSON.stringify(value.position))).size, 2); assert.equal(values.find(value => value.agentId === 'idle-agent')!.id, before.find(value => value.agentId === 'idle-agent')!.id);
  assert.equal(f.state.tasks.size, 2); assert.ok(a); assert.ok(avatar()); await next.close();
});
