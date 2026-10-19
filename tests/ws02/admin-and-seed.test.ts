import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { M1_TABLES } from '../../apps/platform/contracts/store.ts';
import { publishPerceptionGuide, updatePerceptionDemoObject } from '../../apps/platform/application/perception-admin.ts';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { runSeed } from '../../scripts/ws02-demo-data.ts';
import type { Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, requestBase, type Ref } from './helpers.ts';

test('administrative publications require a fresh catalog revision and persist one exact original receipt and fact', async t => {
  const f = await fixture(t), first = await f.read('GET', '/discovery?limit=50'), original = await f.read('GET', '/guides/world?version=1');
  const invalid = { operationId: randomUUID(), actorId: 'isolated-administrator', expectedCatalogRevision: first.catalogRevision,
    revision: first.catalogRevision, guideVersion: 2, guideText: 'A genuinely changed guide must have a discoverable revision.' };
  assert.throws(() => f.storage(store => publishPerceptionGuide(store, invalid)), { code: 'version_conflict' });
  assert.equal((await f.read('GET', '/discovery?limit=50')).catalogRevision, first.catalogRevision);
  assert.equal((await f.call('GET', '/guides/world?version=2')).status, 404);
  const input = { ...invalid, operationId: randomUUID(), revision: 'audited-catalog-2' };
  const published = f.storage(store => publishPerceptionGuide(store, input));
  assert.deepEqual(f.storage(store => publishPerceptionGuide(store, input)), published);
  assert.throws(() => f.storage(store => publishPerceptionGuide(store, { ...input, guideText: 'Changed payload on the same operation is forbidden.' })),
    { code: 'operation_id_conflict' });
  const current = await f.read('GET', '/discovery?limit=50');
  assert.notEqual(current.catalogRevision, first.catalogRevision); assert.notEqual(current.skillCatalogRevision, first.skillCatalogRevision);
  assert.deepEqual(await f.read('GET', '/guides/world?version=1'), original);
  assert.equal((await f.read('GET', '/guides/world?version=2')).version, 2);
  assert.equal(f.storage(store => store.read(tx => tx.find('perception_access', { operationId: input.operationId }).length)), 1);
  const items = await f.listAll(requestBase('world', { categoryId: 'items', limit: 5 })), ref = items.records[0]!.ref as Ref;
  const update = { operationId: randomUUID(), actorId: 'isolated-administrator', expectedVersion: items.records[0]!.version, ref,
    body: 'An actual administrative demo-source revision, not an Agent action.' };
  const edited = f.storage(store => updatePerceptionDemoObject(store, update));
  assert.deepEqual(f.storage(store => updatePerceptionDemoObject(store, update)), edited);
  assert.equal(edited.version, update.expectedVersion + 1);
  assert.equal((await f.detail(ref, 'world')).final.version, edited.version);
  assert.equal(f.storage(store => store.read(tx => tx.find('perception_access', { operationId: update.operationId }).length)), 1);
  const human = await f.read('GET', '/discovery?limit=50', undefined, f.owner.sessionToken);
  for (const directory of [current, human]) {
    assert(!directory.operations.some((row: Json) => ['updateDemoObject', 'publishGuide', 'seedWs02DemoData'].includes(row.id)),
      'Local administrative functions do not become runtime or owner HTTP authority');
  }
});

test('seed rejects mismatched identity and invalid operator before any writable migration or recovery-epoch change', async t => {
  const f = await fixture(t), path = join(f.directory, 'unseeded-schema4.sqlite'), paired = join(f.directory, 'paired.identity.json');
  const source = new DatabaseSync(f.options.databasePath, { readOnly: true }), copy = new DatabaseSync(path);
  const tables = M1_TABLES.filter(table => !table.startsWith('perception_'));
  try {
    migrateDatabase(copy, migrations.slice(0, 4));
    copy.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON');
    copy.prepare('INSERT INTO instance_state(singleton,instance_id,recovery_epoch) VALUES(1,?,?)').run(f.options.instanceId, f.options.recoveryEpoch);
    for (const table of tables) {
      const insert = copy.prepare(`INSERT INTO ${table}(id,version,data) VALUES(?,?,?)`);
      for (const row of source.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()) insert.run(row.id!, row.version!, row.data!);
    }
    copy.exec('COMMIT');
  } finally { source.close(); copy.close(); }
  const identity = { version: 1, instanceId: f.options.instanceId, recoveryEpoch: f.options.recoveryEpoch };
  await writeFile(paired, JSON.stringify(identity), { mode: 0o600 });
  const wrongInstance = join(f.directory, 'wrong-instance.identity.json'), wrongEpoch = join(f.directory, 'wrong-epoch.identity.json');
  await writeFile(wrongInstance, JSON.stringify({ ...identity, instanceId: `instance_${randomUUID()}` }), { mode: 0o600 });
  await writeFile(wrongEpoch, JSON.stringify({ ...identity, recoveryEpoch: `epoch_${randomUUID()}` }), { mode: 0o600 });
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const snapshot = () => {
    const database = new DatabaseSync(path, { readOnly: true });
    try { return digest({ identity: database.prepare('SELECT * FROM instance_state').all(),
      migrations: database.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
      tables: Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()])) }); }
    finally { database.close(); }
  };
  const bytes = await readFile(path), rows = snapshot(), identityBytes = await readFile(paired);
  for (const [index, selected, operator] of [
    [0, wrongInstance, 'isolated-administrator'], [1, wrongEpoch, 'isolated-administrator'],
    [2, paired, null], [3, paired, 'invalid operator!'],
  ] as const) {
    const manifest = join(f.directory, `must-not-exist-${index}.json`);
    await assert.rejects(runSeed(['--database', path, '--identity', selected, '--manifest', manifest,
      ...(operator ? ['--operator', operator] : [])]));
    assert((await readFile(path)).equals(bytes), 'Rejected seed must leave the schema-4 database bytes unchanged');
    assert.equal(snapshot(), rows, 'Rejected seed must preserve all legacy rows, schema history and the paired epoch');
    assert((await readFile(paired)).equals(identityBytes), 'Rejected seed must not rewrite the paired identity');
    await assert.rejects(stat(manifest), { code: 'ENOENT' });
  }
});
