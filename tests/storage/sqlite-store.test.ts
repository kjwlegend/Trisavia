import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { StorageError, type M1Table, type ExactFilters } from '../../apps/platform/contracts/store.ts';

const options = { instanceId: 'instance-test', recoveryEpoch: 'epoch-test' };
const row = (id: string, data: Record<string, any> = {}, version = 1) => ({ id, version, data });
const storageCode = (code: StorageError['code']) => (error: unknown) => error instanceof StorageError && error.code === code;

function diskPath(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'agents-era-storage-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'm1.sqlite');
}

function memoryStore(t: TestContext) {
  const store = openM1Store({ ...options, databasePath: ':memory:' });
  t.after(() => store.close());
  return store;
}

test('disk restart keeps identity, facts and receipts; instance identity is pinned', (t) => {
  const databasePath = diskPath(t);
  const store = openM1Store({ ...options, databasePath });
  store.transaction((tx) => {
    tx.insert('agents', row('a1', { name: 'Agent' }));
    tx.insert('registrations', row('attempt1', { agentId: 'a1', payloadHash: 'hash' }));
    tx.insert('facts', row('fact1', { agentId: 'a1', type: 'registered' }));
    tx.insert('operations', row('receipt1', {
      scope: 'registration:attempt1', action: 'register', operationId: 'op1', epoch: options.recoveryEpoch,
    }));
  });
  store.close();
  const reopened = openM1Store({ ...options, databasePath, recoveryEpoch: 'epoch-new' });
  assert.equal(reopened.instanceId, options.instanceId);
  assert.equal(reopened.recoveryEpoch, 'epoch-new');
  assert.equal(reopened.read((tx) => tx.get('agents', 'a1'))?.data.name, 'Agent');
  assert.equal(reopened.read((tx) => tx.get('registrations', 'attempt1'))?.data.agentId, 'a1');
  assert.equal(reopened.read((tx) => tx.find('operations', {})).length, 1);
  assert.equal(reopened.read((tx) => tx.find('facts', {})).length, 1);
  reopened.close();
  assert.throws(() => openM1Store({ ...options, databasePath, instanceId: 'other-instance' }), /another instance/);
});

test('epoch changes fence both read and write scopes on an already open connection', (t) => {
  const databasePath = diskPath(t);
  const original = openM1Store({ ...options, databasePath });
  original.transaction((tx) => tx.insert('agents', row('existing')));
  const current = openM1Store({ ...options, databasePath, recoveryEpoch: 'epoch-next' });
  t.after(() => { original.close(); current.close(); });
  let callbackInvoked = false;
  assert.throws(() => original.read(() => { callbackInvoked = true; }), storageCode('conflict'));
  assert.throws(() => original.transaction((tx) => {
    callbackInvoked = true;
    tx.insert('agents', row('stale-write'));
  }), storageCode('conflict'));
  assert.equal(callbackInvoked, false);
  assert.equal(current.read((tx) => tx.get('agents', 'existing'))?.id, 'existing');
  current.transaction((tx) => tx.insert('agents', row('current-write')));
  assert.deepEqual(current.read((tx) => tx.find('agents')).map((value) => value.id), ['current-write', 'existing']);
});

test('throwing a transaction callback rolls back every table', (t) => {
  const store = memoryStore(t);
  assert.throws(() => store.transaction((tx) => {
    tx.insert('agents', row('a1'));
    tx.insert('facts', row('f1'));
    throw new Error('injected before receipt');
  }), /injected/);
  assert.equal(store.read((tx) => tx.get('agents', 'a1')), undefined);
  assert.equal(store.read((tx) => tx.get('facts', 'f1')), undefined);
  store.transaction((tx) => tx.insert('agents', row('a1')));
});

test('async callbacks are rejected and their pre-await changes are rolled back', async (t) => {
  const store = memoryStore(t);
  let escaped: any;
  assert.throws(() => store.transaction(async (tx) => {
    escaped = tx;
    tx.insert('agents', row('a1'));
    await Promise.resolve();
    tx.insert('agents', row('late'));
  }), /synchronous/);
  await Promise.resolve();
  assert.equal(store.read((tx) => tx.find('agents', {})).length, 0);
  assert.throws(() => escaped.get('agents', 'a1'), /no longer active/);
  assert.throws(() => store.read(async () => 1), /synchronous/);
});

test('read sessions cannot write; expired sessions and nested scopes are rejected', (t) => {
  const store = memoryStore(t);
  let escaped: any;
  store.read((reader) => {
    escaped = reader;
    assert.equal('insert' in reader, false);
    assert.throws(() => store.transaction(() => undefined), /Nested/);
    assert.throws(() => store.close(), /active/);
  });
  assert.throws(() => escaped.find('agents', {}), /no longer active/);
  assert.throws(() => store.transaction((tx) => {
    tx.insert('agents', row('a1'));
    store.read(() => undefined);
  }), /Nested/);
  assert.equal(store.read((tx) => tx.get('agents', 'a1')), undefined);
});

test('CAS rejects stale and missing rows and requires one version increment', (t) => {
  const store = memoryStore(t);
  store.transaction((tx) => tx.insert('agents', row('a1', { name: 'before' })));
  store.transaction((tx) => tx.update('agents', row('a1', { name: 'after' }, 2), 1));
  assert.equal(store.transaction((tx) => tx.update('agents', row('a1', {}, 2), 1)), false);
  assert.equal(store.transaction((tx) => tx.update('agents', row('missing', {}, 2), 1)), false);
  assert.throws(() => store.transaction((tx) => tx.update('agents', row('a1', {}, 4), 2)), /advance one/);
  assert.deepEqual(store.read((tx) => tx.get('agents', 'a1')), row('a1', { name: 'after' }, 2));
});

test('attempt IDs, fingerprints, active agent bindings and command keys are unique', (t) => {
  const store = memoryStore(t);
  store.transaction((tx) => {
    tx.insert('agents', row('a1'));
    tx.insert('owners', row('o1'));
    tx.insert('owners', row('o2'));
    tx.insert('registrations', row('attempt1', { agentId: 'a1' }));
    tx.insert('credentials', row('c1', { agentId: 'a1', fingerprint: 'fingerprint1' }));
    tx.insert('bindings', row('b1', { agentId: 'a1', ownerId: 'o1', active: true }));
    tx.insert('operations', row('op1', { scope: 'agent:a1', action: 'join', operationId: 'command1', epoch: 'e1' }));
  });
  for (const [table, value] of [
    ['registrations', row('attempt1', { agentId: 'a1', payloadHash: 'different' })],
    ['credentials', row('c2', { fingerprint: 'fingerprint1' })],
    ['bindings', row('b2', { agentId: 'a1', ownerId: 'o2', active: true })],
    ['operations', row('op2', { scope: 'agent:a1', action: 'join', operationId: 'command1', epoch: 'e1' })],
  ] as const) {
    assert.throws(() => store.transaction((tx) => tx.insert(table, value)), storageCode('constraint'));
  }
  store.transaction((tx) => {
    tx.insert('bindings', row('historical', { agentId: 'a1', ownerId: 'o2', active: false }));
    tx.insert('operations', row('different-epoch', { scope: 'agent:a1', action: 'join', operationId: 'command1', epoch: 'e2' }));
  });
  assert.throws(() => store.transaction((tx) => tx.update('bindings',
    row('historical', { agentId: 'a1', ownerId: 'o2', active: true }, 2), 1)), storageCode('constraint'));
  store.transaction((tx) => {
    assert.equal(tx.update('bindings', row('b1', { agentId: 'a1', ownerId: 'o1', active: false }, 2), 1), true);
    assert.equal(tx.update('bindings', row('historical', { agentId: 'a1', ownerId: 'o2', active: true }, 2), 1), true);
  });
});

test('foreign keys reject orphan references; profile and world membership remain unique', (t) => {
  const store = memoryStore(t);
  assert.throws(() => store.transaction((tx) => tx.insert('profiles', row('p1', { agentId: 'missing' }))), storageCode('constraint'));
  store.transaction((tx) => {
    tx.insert('agents', row('a1'));
    tx.insert('profiles', row('p1', { agentId: 'a1' }));
    tx.insert('memberships', row('m1', { agentId: 'a1', worldId: 'w1' }));
    tx.insert('memberships', row('m2', { agentId: 'a1', worldId: 'w2' }));
  });
  assert.throws(() => store.transaction((tx) => tx.insert('profiles', row('p2', { agentId: 'a1' }))), storageCode('constraint'));
  assert.throws(() => store.transaction((tx) => tx.insert('memberships', row('m3', { agentId: 'a1', worldId: 'w1' }))), storageCode('constraint'));
});

test('independent connections serialize writes and recover after a busy result', (t) => {
  const databasePath = diskPath(t);
  const first = openM1Store({ ...options, databasePath });
  const second = openM1Store({ ...options, databasePath, busyTimeoutMs: 5 });
  t.after(() => { first.close(); second.close(); });
  first.transaction((tx) => {
    tx.insert('agents', row('a1'));
    assert.throws(() => second.transaction((other) => other.insert('agents', row('a2'))), storageCode('busy'));
    assert.equal(second.read((other) => other.get('agents', 'a1')), undefined);
  });
  second.transaction((tx) => tx.insert('agents', row('a2')));
  assert.equal(first.read((tx) => tx.find('agents', {})).length, 2);
});

test('read callbacks see a fixed snapshot while a second connection commits', (t) => {
  const databasePath = diskPath(t);
  const first = openM1Store({ ...options, databasePath });
  const second = openM1Store({ ...options, databasePath });
  t.after(() => { first.close(); second.close(); });
  first.read((tx) => {
    assert.equal(tx.find('agents', {}).length, 0);
    second.transaction((other) => other.insert('agents', row('a1')));
    assert.equal(tx.find('agents', {}).length, 0);
  });
  assert.equal(first.read((tx) => tx.find('agents', {})).length, 1);
});

test('competing attempt retries cannot commit a second resident or partial facts', (t) => {
  const databasePath = diskPath(t);
  const first = openM1Store({ ...options, databasePath });
  const second = openM1Store({ ...options, databasePath, busyTimeoutMs: 5 });
  t.after(() => { first.close(); second.close(); });
  const competingWrite = () => second.transaction((tx) => {
    tx.insert('agents', row('losing-agent'));
    tx.insert('facts', row('losing-fact'));
    tx.insert('registrations', row('same-attempt', { agentId: 'losing-agent' }));
  });
  first.transaction((tx) => {
    tx.insert('agents', row('winning-agent'));
    tx.insert('registrations', row('same-attempt', { agentId: 'winning-agent' }));
    assert.throws(competingWrite, storageCode('busy'));
  });
  assert.throws(competingWrite, storageCode('constraint'));
  assert.deepEqual(second.read((tx) => tx.find('agents')).map((value) => value.id), ['winning-agent']);
  assert.equal(second.read((tx) => tx.find('facts')).length, 0);
  assert.equal(second.read((tx) => tx.get('registrations', 'same-attempt'))?.data.agentId, 'winning-agent');
});

test('exact filters preserve null, missing fields, booleans and literal keys', (t) => {
  const store = memoryStore(t);
  store.transaction((tx) => {
    tx.insert('agents', row('a1', { flag: true, value: null, array: [1, 'x'], 'x.y': 'literal' }));
    tx.insert('agents', row('a2', { flag: 1, array: [1, 'x'] }));
  });
  assert.deepEqual(store.read((tx) => tx.find('agents', { flag: true })).map((r) => r.id), ['a1']);
  assert.equal(store.read((tx) => tx.find('agents', { value: null })).length, 1);
  assert.throws(() => store.read((tx) => tx.find('agents', { array: [1, 'x'] } as unknown as ExactFilters)), storageCode('invalid_usage'));
  assert.equal(store.read((tx) => tx.find('agents', { 'x.y': 'literal' })).length, 1);
  assert.equal(store.read((tx) => tx.find('agents', { "x'); DROP TABLE agents; --": 'x' })).length, 0);
});

test('bad table names, invalid JSON, versions and incomplete unique keys are rejected', (t) => {
  const store = memoryStore(t);
  assert.throws(() => store.read((tx) => tx.find('agents; DROP TABLE agents' as M1Table, {})), /Unknown/);
  for (const value of [row('', {}), row('x', {}, 0), row('x', { value: undefined }), row('x', { value: Infinity })]) {
    assert.throws(() => store.transaction((tx) => tx.insert('agents', value)));
  }
  assert.throws(() => store.transaction((tx) => tx.insert('credentials', row('c1'))), storageCode('constraint'));
  assert.throws(() => store.transaction((tx) => tx.insert('operations', row('op1'))), storageCode('constraint'));
  const data: any = {};
  data.circular = data;
  assert.throws(() => store.transaction((tx) => tx.insert('agents', row('a1', data))), /JSON/);
  store.close();
  store.close();
  assert.throws(() => store.read(() => 1), /closed/);
});

test('migration history is verified on reopen and rejects tampering', (t) => {
  const databasePath = diskPath(t);
  openM1Store({ ...options, databasePath }).close();
  const database = new DatabaseSync(databasePath);
  database.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('changed');
  database.close();
  assert.throws(() => openM1Store({ ...options, databasePath }), /migration history/);
});

test('failed schema upgrade rolls back its DDL and migration marker', () => {
  const database = new DatabaseSync(':memory:');
  try {
    migrateDatabase(database);
    assert.throws(() => migrateDatabase(database, [...migrations, {
      version: migrations.length + 1, name: 'injected_failure', sql: 'CREATE TABLE temporary_upgrade(id TEXT); INVALID SQL;',
    }]));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'temporary_upgrade'").get()?.count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count, migrations.length);
    migrateDatabase(database);
  } finally {
    database.close();
  }
});

test('normalized account keys stay unique after reopen and conflicts roll back all transaction writes', (t) => {
  const databasePath = diskPath(t), store = openM1Store({ ...options, databasePath });
  store.transaction((tx) => {
    tx.insert('owners', row('pending-owner', { status: 'pending_setup' }));
    tx.insert('owners', row('new-account', { username: 'First', usernameKey: 'first', email: 'first@example.test', emailKey: 'first@example.test' }));
  });
  store.close();
  const reopened = openM1Store({ ...options, databasePath }); t.after(() => reopened.close());
  for (const duplicate of [{ usernameKey: 'first', emailKey: 'other@example.test' }, { usernameKey: 'other', emailKey: 'first@example.test' }]) {
    assert.throws(() => reopened.transaction((tx) => {
      tx.insert('facts', row('must-rollback'));
      tx.insert('owners', row('duplicate', duplicate));
    }), storageCode('constraint'));
  }
  assert.equal(reopened.read((tx) => tx.find('owners')).length, 2);
  assert.equal(reopened.read((tx) => tx.get('facts', 'must-rollback')), undefined);
  assert.equal(reopened.read((tx) => tx.get('owners', 'duplicate')), undefined);
});
