import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { prepareSqliteCopy } from '../../scripts/postgresql/prepare-sqlite.ts';
import { readSqliteSnapshot } from '../../scripts/postgresql/sqlite-snapshot.ts';

test('offline preparation upgrades only a new schema5 copy, retaining original business rows, identity and exact migration history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'connet-offline-prepare-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'stopped.sqlite'), identity = join(directory, 'identity.json'), db = new DatabaseSync(source);
  migrateDatabase(db, migrations.slice(0, 5)); db.prepare('INSERT INTO instance_state VALUES(1,?,?)').run('preparation-instance', 'preparation-epoch');
  db.prepare('INSERT INTO agents VALUES(?,?,?)').run('synthetic-agent', 1, JSON.stringify({ status: 'active', generation: 1 }));
  db.prepare('INSERT INTO facts VALUES(?,?,?)').run('untouched-fact', 2, JSON.stringify({ action: 'synthetic', zero: 0, nullable: null, negative: false }));
  const history = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(); db.close(); await chmod(source, 0o600);
  await writeFile(identity, JSON.stringify({ version: 1, instanceId: 'preparation-instance', recoveryEpoch: 'preparation-epoch' }), { mode: 0o600 });
  const bytes = await readFile(source), identityBytes = await readFile(identity);
  const result = await prepareSqliteCopy(source, identity, join(directory, 'prepared')), checked = await readSqliteSnapshot(result.database, result.identity);
  assert.equal(result.sourceVersion, 5); assert.equal(result.targetVersion, 6); assert.deepEqual(checked.snapshot.migrations.slice(0, 5), history);
  assert.deepEqual(checked.snapshot.tables.facts[0]?.data, { action: 'synthetic', zero: 0, nullable: null, negative: false });
  assert.equal(checked.snapshot.tables.wallet_accounts.length, 1); assert.equal(checked.snapshot.tables.wallet_accounts[0]?.data.balance, 0);
  assert((await readFile(source)).equals(bytes)); assert((await readFile(identity)).equals(identityBytes));
  await assert.rejects(prepareSqliteCopy(source, identity, join(directory, 'prepared')), /exist|EEXIST/i);
  const second = await prepareSqliteCopy(result.database, result.identity, join(directory, 'already-six'));
  assert.equal(second.sourceVersion, 6); assert.deepEqual((await readSqliteSnapshot(second.database, second.identity)).snapshot, checked.snapshot);
});
