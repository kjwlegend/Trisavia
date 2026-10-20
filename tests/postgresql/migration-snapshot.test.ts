import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { migrateDatabase } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { canonicalDocument } from '../../apps/platform/domains/perception/protocol.ts';
import { compareSnapshots, historicalDocumentEvidence, parseUniqueJson, readSqliteSnapshot } from '../../scripts/postgresql/sqlite-snapshot.ts';

async function source(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'connet-pg-source-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'source.sqlite'), identity = join(directory, 'identity.json'), db = new DatabaseSync(database);
  migrateDatabase(db); db.prepare('INSERT INTO instance_state VALUES(1,?,?)').run('isolated-instance', 'isolated-epoch');
  db.prepare('INSERT INTO facts VALUES(?,?,?)').run('preserve-types', 3, JSON.stringify({ action: 'isolated-fixture', time: 0, changed: false, actor: null }));
  const document = { title: '正文与旧 Unicode 键保全', 'é': '原始内容', nested: { '中': 0, 'ä': false } }, digest = createHash('sha256').update(canonicalDocument(document)).digest('hex');
  db.prepare('INSERT INTO perception_catalog VALUES(?,?,?)').run('guide:isolated:1', 1, JSON.stringify({ document, digest })); db.close(); await chmod(database, 0o600);
  await writeFile(identity, JSON.stringify({ version: 1, instanceId: 'isolated-instance', recoveryEpoch: 'isolated-epoch' }), { mode: 0o600 });
  return { database, identity };
}
test('read-only source export validates all23 tables and original six checksums, preserves types/history/digests and leaves bytes unchanged', async t => {
  const f = await source(t), before = await readFile(f.database), identity = await readFile(f.identity), result = await readSqliteSnapshot(f.database, f.identity);
  assert.equal(Object.keys(result.snapshot.tables).length, 21); assert.equal(result.snapshot.migrations.length, 6);
  assert.deepEqual(result.snapshot.tables.facts[0], { id: 'preserve-types', version: 3, data: { action: 'isolated-fixture', time: 0, changed: false, actor: null } });
  assert.equal(historicalDocumentEvidence(result.snapshot).length, 1); assert((await readFile(f.database)).equals(before)); assert((await readFile(f.identity)).equals(identity));
  const changed = structuredClone(result.snapshot); changed.tables.facts[0]!.data.changed = null;
  const comparison = compareSnapshots(result.snapshot, changed); assert.equal(comparison.matched, false);
  assert.deepEqual(comparison.differences, [{ table: 'facts', id: 'preserve-types', reason: 'row_mismatch' }]);
  assert.equal(compareSnapshots(result.snapshot, structuredClone(result.snapshot)).matched, true);
  changed.tables.perception_catalog[0]!.data.digest = '0'.repeat(64); assert.throws(() => historicalDocumentEvidence(changed));
});
test('unmapped source table, mismatched identity and duplicate raw JSON keys block preparation without modifying the source', async t => {
  const f = await source(t); await writeFile(f.identity, JSON.stringify({ version: 1, instanceId: 'foreign-instance', recoveryEpoch: 'isolated-epoch' }), { mode: 0o600 });
  const before = await readFile(f.database); await assert.rejects(readSqliteSnapshot(f.database, f.identity), /identity/); assert((await readFile(f.database)).equals(before));
  await writeFile(f.identity, JSON.stringify({ version: 1, instanceId: 'isolated-instance', recoveryEpoch: 'isolated-epoch' }), { mode: 0o600 });
  const db = new DatabaseSync(f.database); db.prepare('UPDATE facts SET data=? WHERE id=?').run('{"action":"first","action":"second"}', 'preserve-types'); db.close();
  await assert.rejects(readSqliteSnapshot(f.database, f.identity), /Duplicate source JSON key/);
  const extra = new DatabaseSync(f.database); extra.exec('CREATE TABLE unexpected_source(id TEXT)'); extra.close();
  await assert.rejects(readSqliteSnapshot(f.database, f.identity), /exact frozen schema6 source table set/);
});
test('raw JSON duplicate detection compares decoded keys at every depth without rejecting ordinary body text', () => {
  for (const value of ['{"key":1,"key":2}', '{"x":1,"\\u0078":2}', '[{"nested":{"k":1,"k":2}}]']) assert.throws(() => parseUniqueJson(value), /Duplicate source JSON key/);
  const valid = { text: 'A literal "key": and bracket } remain body text', list: [null, 0, false, { '中': '内容' }] };
  assert.deepEqual(parseUniqueJson(JSON.stringify(valid)), valid);
});
