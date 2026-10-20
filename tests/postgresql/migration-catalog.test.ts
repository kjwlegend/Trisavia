import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildApp } from '../../apps/platform/app.ts';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { canonicalDocument } from '../../apps/platform/domains/perception/protocol.ts';
import { convert } from '../../scripts/postgresql/convert.ts';
import { createIsolatedDatabase, dropIsolatedDatabase } from '../../scripts/postgresql/database.ts';
import { grantApplicationPermissions } from '../../scripts/postgresql/permissions.ts';
import { prepareLegacyCatalog } from '../../scripts/postgresql/prepare-catalog.ts';
import { prepareSqliteCopy } from '../../scripts/postgresql/prepare-sqlite.ts';
import { readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';
import { comparisonJson, readSqliteSnapshot, sha256 } from '../../scripts/postgresql/sqlite-snapshot.ts';

test('fresh schema5/catalog3 cutoff prepares audited catalog4 on new copies then passes real app closed-gate PostgreSQL readiness', async () => {
  const runtimeFile = process.env.M1_PG_RUNTIME_FILE, legacySource = process.env.M1_PG_LEGACY_SOURCE;
  if (!runtimeFile || !legacySource) throw new Error('Explicit isolated runtime and immutable reviewed7b archive are required');
  const directory = await mkdtemp(join(tmpdir(), 'connet-catalog-preparation-')), config = await readRuntime(runtimeFile);
  const source = join(directory, 'stopped.sqlite'), identityFile = join(directory, 'identity.json'), identity = { instanceId: `catalog-${randomUUID()}`, recoveryEpoch: `epoch-${randomUUID()}` };
  const db = new DatabaseSync(source); migrateDatabase(db, migrations.slice(0, 5)); db.prepare('INSERT INTO instance_state VALUES(1,?,?)').run(identity.instanceId, identity.recoveryEpoch);
  const insert = db.prepare('INSERT INTO perception_catalog VALUES(?,?,?)');
  insert.run('current', 3, JSON.stringify({ catalogRevision: 'isolated-original-3', skillCatalogRevision: 'skills-isolated-original-3', schemaVersion: 3, guideVersion: 3, sourceStates: {}, seedObjectIds: [] }));
  for (const [id, document] of [['guide:world:3', { text: '独立旧说明正文' }], ['schema:isolated-preserved:3', { type: 'string', description: '不可覆盖旧文档' }]] as const)
    insert.run(id, 1, JSON.stringify({ document, digest: sha256(canonicalDocument(document)) }));
  db.prepare('INSERT INTO facts VALUES(?,?,?)').run('original-fact', 1, JSON.stringify({ action: 'isolated-original', changed: false })); db.close(); await chmod(source, 0o600);
  await writeFile(identityFile, JSON.stringify({ version: 1, ...identity }), { mode: 0o600 }); const original = await readFile(source), originalIdentity = await readFile(identityFile);
  const target = await createIsolatedDatabase(config, `connet_rehearsal_${randomUUID().replaceAll('-', '')}`, join(directory, 'connections'));
  try {
    const prepared = await prepareSqliteCopy(source, identityFile, join(directory, 'schema6'));
    const before = await readSqliteSnapshot(prepared.database, prepared.identity);
    const ready = await prepareLegacyCatalog(prepared.database, prepared.identity, legacySource, join(directory, 'catalog4'));
    assert.equal(ready.schemaVersion, 4); assert.equal(ready.guideVersion, 4);
    const after = await readSqliteSnapshot(ready.database, ready.identity);
    for (const row of before.snapshot.tables.perception_catalog.filter(row => row.id !== 'current')) assert.equal(comparisonJson(after.snapshot.tables.perception_catalog.find(candidate => candidate.id === row.id)), comparisonJson(row));
    assert.equal(after.snapshot.tables.perception_objects.length, 0, 'Offline catalog preparation did not seed content');
    const converted = await convert([ready.database, ready.identity, join(target.privateConnections, 'migration-database-url'), join(directory, 'converted')]); assert.equal(converted.matched, true);
    await grantApplicationPermissions(config, target.database);
    const app = await buildApp({ ...identity, connectionString: (await requirePrivateFile(join(target.privateConnections, 'application-database-url'))).trim() });
    try { await app.ready(); const health = await app.inject({ method: 'GET', url: '/health' }); assert.equal(health.statusCode, 200); assert.equal(health.json().status, 'ok'); }
    finally { await app.close(); }
    assert((await readFile(source)).equals(original)); assert((await readFile(identityFile)).equals(originalIdentity));
  } finally { await dropIsolatedDatabase(config, target.privateConnections); await rm(directory, { recursive: true, force: true }); }
});
