import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { StorageError } from '../../apps/platform/contracts/store.ts';
const identity = { instanceId: 'migration-test', recoveryEpoch: 'migration-epoch' };
const conflict = (error: unknown) => error instanceof StorageError && error.code === 'conflict';
function path(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'm1-assistance-migration-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'test.sqlite');
}
function seed(database: DatabaseSync) {
  database.prepare('INSERT INTO instance_state VALUES(1,?,?)').run(identity.instanceId, identity.recoveryEpoch);
  for (const [table, id, data] of [
    ['agents', 'original-agent', { runtimeVersion: 1, runtimeActive: true }],
    ['owners', 'original-owner', { status: 'active', usernameKey: 'original', emailKey: 'original@example.test', authVersion: 1 }],
    ['credentials', 'original-runtime', { agentId: 'original-agent', fingerprint: 'synthetic-hash', kind: 'runtime', active: true }],
    ['bindings', 'original-binding', { agentId: 'original-agent', ownerId: 'original-owner', active: true }],
    ['profiles', 'original-agent', { agentId: 'original-agent', draft: { displayName: 'Original', bio: 'Original draft' }, published: { displayName: 'Original published' }, lockedFields: ['bio'] }],
    ['registrations', 'original-attempt', { agentId: 'original-agent', ownerId: 'original-owner', runtimeCredentialId: 'original-runtime' }],
    ['operations', 'original-operation', { scope: 'agent:original-agent', action: 'saveDraft', operationId: 'original-operation', epoch: identity.recoveryEpoch, result: { version: 1 } }],
    ['facts', 'original-fact', { action: 'saveDraft', agentId: 'original-agent' }],
    ['memberships', 'original-agent', { agentId: 'original-agent', worldId: 'default', state: 'joined', ownerPaused: true }],
  ] as const) database.prepare(`INSERT INTO ${table}(id,version,data) VALUES(?,1,?)`).run(id, JSON.stringify(data));
}
function originalRows(database: DatabaseSync) {
  return JSON.stringify(['agents', 'owners', 'credentials', 'bindings', 'profiles', 'memberships', 'registrations', 'operations', 'facts'].map((table) => database.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()));
}
for (const version of [1, 2]) test(`append-only migration3 upgrades a synthetic v${version} database without changing original identity, bindings, credentials or profile bytes`, (t) => {
  const databasePath = path(t), database = new DatabaseSync(databasePath); migrateDatabase(database, migrations.slice(0, version)); seed(database);
  const before = originalRows(database), history = database.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all(); database.close();
  const store = openM1Store({ ...identity, databasePath });
  assert.equal(store.read((tx) => tx.find('recovery_requests')).length, 0); assert.equal(store.read((tx) => tx.get('bindings', 'original-binding'))?.data.active, true); store.close();
  const after = new DatabaseSync(databasePath); assert.equal(originalRows(after) === before, true);
  assert.deepEqual(after.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version LIMIT ?').all(version), history);
  assert.equal(after.prepare('SELECT count(*) AS count FROM schema_migrations').get()?.count, 3);
  // A binary that knows only old definitions refuses an unknown later migration.
  assert.throws(() => migrateDatabase(after, migrations.slice(0, 2)), conflict); after.close();
  const reopened = openM1Store({ ...identity, databasePath }); assert.equal(reopened.read((tx) => tx.get('profiles', 'original-agent'))?.data.published !== null, true); reopened.close();
});

test('failed migration3 rolls back its table and marker; a corrected upgrade succeeds and reopens', (t) => {
  const databasePath = path(t), database = new DatabaseSync(databasePath); migrateDatabase(database, migrations.slice(0, 2)); seed(database); const before = originalRows(database);
  const migration = migrations[2]!;
  assert.throws(() => migrateDatabase(database, [...migrations.slice(0, 2), { ...migration, sql: `${migration.sql}\nTHIS IS INVALID SQL;` }]));
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name='recovery_requests'").get(), undefined);
  assert.equal(database.prepare('SELECT count(*) AS count FROM schema_migrations').get()?.count, 2); assert.equal(originalRows(database) === before, true); database.close();
  const store = openM1Store({ ...identity, databasePath }); assert.equal(store.read((tx) => tx.find('recovery_requests')).length, 0);
  assert.throws(() => store.transaction((tx) => {
    tx.insert('credentials', { id: 'context', version: 1, data: { fingerprint: 'independent-context-hash', agentId: 'original-agent', ownerId: 'original-owner' } });
    tx.insert('recovery_requests', { id: 'context', version: 1, data: { agentId: 'original-agent', ownerId: 'original-owner', contextCredentialId: 'context', status: 'pending' } });
    throw new Error('Injected request rollback');
  }), /Injected request rollback/);
  assert.equal(store.read((tx) => tx.get('credentials', 'context')), undefined); assert.equal(store.read((tx) => tx.find('recovery_requests')).length, 0); store.close();
  const reopened = openM1Store({ ...identity, databasePath }); assert.equal(reopened.read((tx) => tx.find('recovery_requests')).length, 0); reopened.close();
});
