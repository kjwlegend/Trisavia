import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { migratePostgres } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { openPostgresStore, setPostgresWriteGate } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { createIsolatedDatabase, dropIsolatedDatabase } from '../../scripts/postgresql/database.ts';
import { grantApplicationPermissions } from '../../scripts/postgresql/permissions.ts';
import { readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';

test('real connet_app opens/reads behind a closed gate, cannot modify maintenance metadata or DDL, and writes business/child rows only after explicit maintenance enable', async t => {
  const runtimeFile = process.env.M1_PG_RUNTIME_FILE; if (!runtimeFile) throw new Error('A private isolated PostgreSQL runtime configuration is required');
  const config = await readRuntime(runtimeFile), directory = await mkdtemp(join(tmpdir(), 'connet-pg-role-'));
  const target = await createIsolatedDatabase(config, `connet_test_${randomUUID().replaceAll('-', '')}`, join(directory, 'private'));
  t.after(async () => { try { await dropIsolatedDatabase(config, target.privateConnections); } finally { await rm(directory, { recursive: true, force: true }); } });
  const identity = { instanceId: `permission-${randomUUID()}`, recoveryEpoch: 'isolated-permission-epoch' },
    maintenance = { ...identity, connectionString: (await requirePrivateFile(join(target.privateConnections, 'migration-database-url'))).trim() },
    application = { ...identity, connectionString: (await requirePrivateFile(join(target.privateConnections, 'application-database-url'))).trim() };
  await migratePostgres(maintenance); await grantApplicationPermissions(config, target.database);
  const store = await openPostgresStore(application), admin = new Pool({ connectionString: maintenance.connectionString, max: 1 }), app = new Pool({ connectionString: application.connectionString, max: 1 });
  const guard = async () => (await admin.query('SELECT instance_id,recovery_epoch,writes_enabled,write_generation FROM platform.instance_state')).rows;
  try {
    assert.deepEqual(await store.read(async tx => tx.find('agents')), []); const before = await guard(); let called = false;
    await assert.rejects(store.transaction(async () => { called = true; }), { code: 'unavailable' }); assert.equal(called, false); assert.deepEqual(await guard(), before);
    for (const sql of [
      'CREATE TABLE iam.must_not_create(id text)', 'ALTER TABLE iam.agents ADD COLUMN must_not_add text',
      'UPDATE platform.module_migrations SET name=name', 'DELETE FROM platform.legacy_schema_migrations',
      'UPDATE platform.instance_state SET writes_enabled=true', "UPDATE platform.instance_state SET instance_id='wrong'", "UPDATE platform.instance_state SET recovery_epoch='wrong'",
      'INSERT INTO platform.instance_state(singleton,instance_id,recovery_epoch) VALUES(2,\'wrong\',\'wrong\')', 'DELETE FROM platform.instance_state',
    ]) await assert.rejects(app.query(sql), { code: '42501' }, 'Application role must not gain maintenance powers');
    await assert.rejects(setPostgresWriteGate(application, { enabled: true })); assert.deepEqual(await guard(), before);
    await setPostgresWriteGate(maintenance, { enabled: true });
    const profile = { displayName: '隔离权限测试角色', avatar: { template: 'basic', color: 'olive' }, bio: '', interests: [] };
    await store.transaction(async tx => {
      await tx.insert('agents', { id: 'isolated-agent', version: 1, data: { runtimeVersion: 1, runtimeActive: true, createdAt: Date.now() } });
      await tx.insert('profiles', { id: 'isolated-agent', version: 1, data: { agentId: 'isolated-agent', policyVersion: 1, publishedVersion: 1, mode: 'agent_autonomous', confirmationSource: 'platform_default', lockedFields: [], draft: profile, published: profile } });
    });
    const loaded = await store.read(async tx => tx.get('profiles', 'isolated-agent')); assert.deepEqual(loaded?.data.published, profile);
    assert.equal((await app.query("SELECT count(*)::integer n FROM profiles.profile_contents WHERE parent_id='isolated-agent'")).rows[0]?.n, 2);
    await setPostgresWriteGate(maintenance, { enabled: false }); const closed = await guard();
    await assert.rejects(store.transaction(async tx => tx.remove('agents', 'isolated-agent', 1)), { code: 'unavailable' }); assert.deepEqual(await guard(), closed);
    assert.equal((await store.read(async tx => tx.get('agents', 'isolated-agent')))?.id, 'isolated-agent');
  } finally { await app.end(); await admin.end(); await store.close(); }
});
