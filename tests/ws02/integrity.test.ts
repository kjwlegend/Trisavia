import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildApp } from '../../apps/platform/app.ts';
import { M1_TABLES } from '../../apps/platform/contracts/store.ts';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { injectApi, ok, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, requestBase, type Ref } from './helpers.ts';

const inbox = () => requestBase('inbox', { categoryId: 'notifications', selection: 'unconfirmed', limit: 5 });
const confirm = (ref: Ref, final: Json) => ({ protocolVersion: 1, operationId: randomUUID(), ref,
  contentVersion: final.version, completionToken: final.completionToken });

test('a synthesized schema-4 copy migrates without changing M1 identity, binding, row contents or the original runtime proof', async t => {
  const f = await fixture(t), legacyPath = join(f.directory, 'legacy-schema-4.sqlite');
  const original = new DatabaseSync(f.options.databasePath, { readOnly: true }), legacy = new DatabaseSync(legacyPath);
  const tables = M1_TABLES.filter(table => !table.startsWith('perception_')&&!['wallet_accounts','mailbox_messages','mailbox_receipts'].includes(table));
  const rows = new Map(tables.map(table => [table, original.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()]));
  const identity = original.prepare('SELECT * FROM instance_state').get(); assert(identity); original.close();
  try {
    migrateDatabase(legacy, migrations.slice(0, 4));
    legacy.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON');
    legacy.prepare('INSERT INTO instance_state(singleton,instance_id,recovery_epoch) VALUES(1,?,?)').run(f.options.instanceId, f.options.recoveryEpoch);
    for (const [table, records] of rows) {
      const insert = legacy.prepare(`INSERT INTO ${table}(id,version,data) VALUES(?,?,?)`);
      for (const record of records) insert.run(record.id!, record.version!, record.data!);
    }
    legacy.exec('COMMIT');
    assert.equal(legacy.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version, 4);
  } finally { legacy.close(); }
  // This is an explicit synthetic legacy copy, not a user's database or a
  // claim that the original schema-4 binary was executed here.
  const app = buildApp({ ...f.options, databasePath: legacyPath, clock: () => Date.UTC(2026, 9, 20) });
  try {
    await app.ready();
    const migrated = new DatabaseSync(legacyPath, { readOnly: true });
    try {
      const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
      for (const [table, before] of rows) assert.equal(hash(migrated.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()), hash(before), `Migration preserves existing ${table} records`);
      assert.deepEqual(migrated.prepare('SELECT * FROM instance_state').get(), identity);
      assert.equal(migrated.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version, 6);
      assert.equal(migrated.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
    } finally { migrated.close(); }
    const api = injectApi(app), self = await ok(api, 'GET', '/agent/self', undefined, f.a.runtimeToken);
    assert.equal(self.agentId, f.a.agentId); assert.equal(self.ownerId, f.owner.ownerId); assert.equal(self.instanceId, f.options.instanceId);
    const list = await ok(api, 'GET', '/owner/agents', undefined, f.owner.sessionToken);
    assert.equal(list.agents.length, 2);
  } finally { await app.close(); }
});

test('real SQLite write faults roll back confirmation state, operation receipt and fact together before a successful same-key retry', async t => {
  const f = await fixture(t), first = await f.read('POST', '/list', inbox());
  const failAccess = new DatabaseSync(f.options.databasePath);
  try { failAccess.exec("CREATE TRIGGER isolated_fail BEFORE INSERT ON perception_access BEGIN SELECT RAISE(ABORT,'isolated-write-fault'); END"); }
  finally { failAccess.close(); }
  const deniedRead = await f.call('POST', '/overview', { protocolVersion: 1, consumerId: 'isolated-http-consumer', purpose: 'agent-perception' });
  assert(deniedRead.status >= 500, 'Required access persistence cannot fail silently while content is returned successfully');
  const removeAccess = new DatabaseSync(f.options.databasePath); try { removeAccess.exec('DROP TRIGGER isolated_fail'); } finally { removeAccess.close(); }
  assert.equal((await f.unread()).count.value, 30);
  for (const [index, table] of ['operations', 'facts'].entries()) {
    const ref = first.records[index].ref as Ref, content = await f.detail(ref), input = confirm(ref, content.final);
    const before = await f.queryState(ref), database = new DatabaseSync(f.options.databasePath);
    try { database.exec(`CREATE TRIGGER isolated_fail BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'isolated-write-fault'); END`); }
    finally { database.close(); }
    const failed = await f.call('PUT', '/agent-read-state', input);
    assert(failed.status >= 500, 'The real transaction cannot return success after a required write fails');
    const remove = new DatabaseSync(f.options.databasePath); try { remove.exec('DROP TRIGGER isolated_fail'); } finally { remove.close(); }
    assert.equal(f.storage(store => store.read(tx => tx.find('operations', { operationId: input.operationId }).length)), 0);
    assert.equal(f.storage(store => store.read(tx => tx.find('facts', { operationId: input.operationId }).length)), 0);
    assert.deepEqual(await f.queryState(ref), before);
    const committed = await f.read('PUT', '/agent-read-state', input); assert.equal(committed.changed, true);
    assert.deepEqual(await f.read('PUT', '/agent-read-state', input), committed);
    assert.equal(f.storage(store => store.read(tx => tx.find('operations', { operationId: input.operationId }).length)), 1);
    assert.equal(f.storage(store => store.read(tx => tx.find('facts', { operationId: input.operationId }).length)), 1);
  }
  assert.equal((await f.unread()).count.value, 28);
});

test('failed confirmation keys remain failures and altered retries cannot consume a different completed body', async t => {
  const f = await fixture(t), first = await f.read('POST', '/list', inbox()), ref = first.records[0].ref as Ref;
  const wrongAgent = await f.detail(ref, 'inbox', f.sibling.runtimeToken), input = confirm(ref, wrongAgent.final);
  const rejected = await f.call('PUT', '/agent-read-state', input);
  assert(rejected.status >= 400 && rejected.status < 500);
  assert.equal((await f.queryState(ref)).confirmedContentVersion, null); assert.equal((await f.unread()).count.value, 30);
  const correct = await f.detail(ref), repeated = await f.call('PUT', '/agent-read-state', input);
  assert.equal(repeated.status, rejected.status);
  assert(JSON.stringify(repeated.error) === JSON.stringify(rejected.error), 'The same failed operation key replays the original safe error');
  const receiptPath = `/operations/${input.operationId}?${new URLSearchParams({ scope: `perception-agent:${f.a.agentId}`, action: 'confirmAgentRead' })}`;
  const failedReceipt = await f.m1('GET', receiptPath, undefined, f.a.runtimeToken);
  assert.equal(failedReceipt.status, rejected.status); assert.equal(failedReceipt.body.error.code, rejected.error.code);
  assert.equal((await f.m1('GET', receiptPath, undefined, f.b.runtimeToken)).status, 404);
  const altered = await f.call('PUT', '/agent-read-state', { ...input, completionToken: correct.final.completionToken });
  assert.equal(altered.status, 409); assert.equal(altered.error.code, 'operation_id_conflict');
  const successful = await f.read('PUT', '/agent-read-state', { ...input, operationId: randomUUID(), completionToken: correct.final.completionToken });
  assert.equal(successful.changed, true); assert.equal((await f.unread()).count.value, 29);
});
