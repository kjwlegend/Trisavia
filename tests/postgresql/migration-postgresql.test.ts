import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Pool } from 'pg';
import { migratePostgres } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { exportLegacySnapshot, importLegacySnapshot } from '../../apps/platform/infrastructure/postgresql/legacy-codec.ts';
import { createIsolatedDatabase, dropIsolatedDatabase } from '../../scripts/postgresql/database.ts';
import { readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';
import { compareSnapshots, historicalDocumentEvidence, readSqliteSnapshot } from '../../scripts/postgresql/sqlite-snapshot.ts';

async function target(t: TestContext) {
  const runtimeFile = process.env.M1_PG_RUNTIME_FILE, sourceFile = process.env.M1_PG_SQLITE_COPY, identityFile = process.env.M1_PG_IDENTITY_COPY;
  if (!runtimeFile || !sourceFile || !identityFile) throw new Error('Explicit private isolated PostgreSQL runtime and copied SQLite/identity paths are required');
  const runtime = await readRuntime(runtimeFile), input = await readSqliteSnapshot(sourceFile, identityFile), directory = await mkdtemp(join(tmpdir(), 'connet-pg-import-'));
  const created = await createIsolatedDatabase(runtime, `connet_rehearsal_${randomUUID().replaceAll('-', '')}`, join(directory, 'private'));
  t.after(async () => { try { await dropIsolatedDatabase(runtime, created.privateConnections); } finally { await rm(directory, { recursive: true, force: true }); } });
  const connectionString = (await requirePrivateFile(join(created.privateConnections, 'migration-database-url'))).trim();
  const options = { connectionString, instanceId: input.snapshot.instance.instance_id, recoveryEpoch: input.snapshot.instance.recovery_epoch };
  await migratePostgres(options);
  return { input, sourceFile, identityFile, options };
}
test('real PostgreSQL imports every frozen source row/history/digest into a new gated target and rejects target reuse without changing it', async t => {
  const f = await target(t), before = await readFile(f.sourceFile), identity = await readFile(f.identityFile);
  const result = await importLegacySnapshot(f.options, f.input.snapshot); assert.equal(result.tables, 23);
  const exported = await exportLegacySnapshot(f.options), comparison = compareSnapshots(f.input.snapshot, exported);
  assert.equal(comparison.matched, true, JSON.stringify(comparison.differences));
  assert.deepEqual(historicalDocumentEvidence(exported), historicalDocumentEvidence(f.input.snapshot));
  await assert.rejects(importLegacySnapshot(f.options, f.input.snapshot), { code: 'conflict' });
  assert.equal(compareSnapshots(f.input.snapshot, await exportLegacySnapshot(f.options)).matched, true);
  const pool = new Pool({ connectionString: f.options.connectionString, max: 1 });
  try { assert.equal((await pool.query('SELECT writes_enabled FROM platform.instance_state WHERE singleton=1')).rows[0]?.writes_enabled, false); } finally { await pool.end(); }
  assert((await readFile(f.sourceFile)).equals(before)); assert((await readFile(f.identityFile)).equals(identity));
});
test('unknown source catalog kind and unknown fields reject the complete import before any business row or legacy history is committed', async t => {
  const f = await target(t), unknown = structuredClone(f.input.snapshot);
  unknown.tables.perception_catalog.push({ id: 'isolated-unmapped-kind', version: 1, data: { kind: 'unmapped-fixture-kind' } });
  await assert.rejects(importLegacySnapshot(f.options, unknown), { code: 'invalid_usage' });
  const field = structuredClone(f.input.snapshot); assert(field.tables.agents[0]); field.tables.agents[0].data.unmappedFixtureField = true;
  await assert.rejects(importLegacySnapshot(f.options, field), { code: 'invalid_usage' });
  const after = await exportLegacySnapshot(f.options); assert.equal(after.migrations.length, 0);
  assert.equal(Object.values(after.tables).reduce((count, rows) => count + rows.length, 0), 0);
});
test('a real late SQL insert fault rolls back earlier source rows and legacy history instead of publishing a partial conversion', async t => {
  const f = await target(t), pool = new Pool({ connectionString: f.options.connectionString, max: 1 });
  try { await pool.query(`CREATE FUNCTION platform.isolated_import_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated import failure'; END $$;
    CREATE TRIGGER isolated_import_fault BEFORE INSERT ON perception.documents FOR EACH ROW EXECUTE FUNCTION platform.isolated_import_fault()`); } finally { await pool.end(); }
  await assert.rejects(importLegacySnapshot(f.options, f.input.snapshot), { code: 'P0001' });
  const after = await exportLegacySnapshot(f.options); assert.equal(after.migrations.length, 0);
  assert.equal(Object.values(after.tables).reduce((count, rows) => count + rows.length, 0), 0);
});
