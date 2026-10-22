import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createWorldDatabase, dropWorldTestDatabase } from '../../scripts/world-core-database.ts';
import { prepareWorldCoreDatabase } from '../../scripts/world-core-prepare.ts';
import { readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';
import { openRuntimeStore } from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { setPostgresWriteGate } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { createDeterministicScheduler } from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
const code = (value: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === value);

test('isolated PostgreSQL idle recurrence reuses one fenced task and preserves one-shot immutability and app-role limits', async () => {
  const runtimeFile = process.env.WORLD_CORE_TEST_RUNTIME; assert.ok(runtimeFile, 'Explicit private local runtime required');
  const config = await readRuntime(runtimeFile), directory = await mkdtemp(join(tmpdir(), 'world-idle-pg-'));
  const database = 'world_core_b_idle_20261022_' + randomBytes(4).toString('hex'), identity = { instanceId: 'instance_' + randomUUID(), recoveryEpoch: 'epoch_' + randomUUID() };
  let connections: string | undefined, runtime: Awaited<ReturnType<typeof openRuntimeStore>> | undefined, pool: Pool | undefined;
  try {
    connections = (await createWorldDatabase(config, database, join(directory, 'connections'))).privateConnections;
    await prepareWorldCoreDatabase(config, connections, identity);
    console.info(JSON.stringify({ database, created: true, migrated: true }));
    const migration = { connectionString: (await requirePrivateFile(join(connections, 'migration-database-url'))).trim(), ...identity };
    let now = 1800000000000;
    const application = { connectionString: (await requirePrivateFile(join(connections, 'application-database-url'))).trim(), ...identity, now: () => now };
    runtime = await openRuntimeStore(application); pool = new Pool({ connectionString: application.connectionString, max: 1 });
    await assert.rejects(pool.query('CREATE TABLE runtime.unauthorized_idle_probe(id integer)'), code('42501'));
    await assert.rejects(pool.query('UPDATE platform.instance_state SET writes_enabled=true'), code('42501'));
    await setPostgresWriteGate(migration, { enabled: true });
    await runtime.transaction(async ctx => {
      await ctx.tasks.advanceGeneration('world', 0);
      await ctx.tasks.schedule({ taskId: 'idle-one', domain: 'world', kind: 'world.idle.step', handlerVersion: 1, dedupeKey: 'idle-one', target: { type: 'avatar', id: 'fixture-avatar', version: 1 }, timeKind: 'utc', dueAt: now, generation: 1, maxAttempts: 2, payloadVersion: 1, payload: { count: 0 } });
      await ctx.tasks.schedule({ taskId: 'explicit-one', domain: 'world', kind: 'world.movement.step', handlerVersion: 1, dedupeKey: 'explicit-one', target: { type: 'movement', id: 'fixture-movement', version: 1 }, timeKind: 'utc', dueAt: now, generation: 1, maxAttempts: 2, payloadVersion: 1, payload: {} });
    });
    const old = (await runtime.transaction(ctx => ctx.tasks.claimDue({ now, workerId: 'old', leaseMs: 10, limit: 1, kinds: ['world.idle.step'] })))[0]!;
    now += 11;
    const scheduler = createDeterministicScheduler({ store: runtime, workerId: 'replacement', leaseMs: 1000, handlers: [{ kind: 'world.idle.step', version: 1, run: async (_ctx, task) => ({ idle: { dueAt: now + 4000, payload: { count: Number(task.payload.count) + 1 } } }) }] });
    try { for (let index = 0; index < 20; index++) { assert.equal((await scheduler.runDue()).completed, 1); now += 4000; } } finally { await scheduler.close(); }
    await assert.rejects(runtime.transaction(ctx => ctx.tasks.recurIdle(old.lease!, { now, dueAt: now + 4000, payload: {} })), code('lease_lost'));
    const current = await runtime.read(ctx => ctx.tasks.get('idle-one'));
    assert.equal(current!.payload.count, 20); assert.equal(current!.attempts, 0); assert.equal(current!.fence, 21);
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM runtime.tasks')).rows[0].total, 2);
    await assert.rejects(pool.query("UPDATE runtime.tasks SET version=version+1,payload='{}'::jsonb WHERE task_id='idle-one'"), code('23514'));
    await assert.rejects(pool.query("UPDATE runtime.tasks SET version=version+1,due_at=due_at+4000 WHERE task_id='explicit-one'"), code('23514'));
    const explicit = (await runtime.transaction(ctx => ctx.tasks.claimDue({ now, workerId: 'explicit', leaseMs: 1000, limit: 1, kinds: ['world.movement.step'] })))[0]!;
    await assert.rejects(runtime.transaction(ctx => ctx.tasks.recurIdle(explicit.lease!, { now, dueAt: now + 4000, payload: {} })), code('invalid_usage'));
    await runtime.transaction(ctx => ctx.tasks.complete(explicit.lease!, now));
    assert.equal((await runtime.read(ctx => ctx.tasks.get('explicit-one')))!.state, 'completed');
    console.info(JSON.stringify({ database, recurrence: 20, idleRows: 1, staleLeaseRejected: true, oldTaskImmutable: true, appRoleLimited: true }));
  } finally {
    await pool?.end(); await runtime?.close();
    if (connections) { await dropWorldTestDatabase(config, connections); console.info(JSON.stringify({ database, closed: true, dropped: true })); }
    await rm(directory, { recursive: true, force: true });
  }
});
