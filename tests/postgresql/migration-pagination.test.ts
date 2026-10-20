import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../../apps/platform/app.ts';
import { importLegacySnapshot } from '../../apps/platform/infrastructure/postgresql/legacy-codec.ts';
import { migratePostgres } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { setPostgresWriteGate } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { createIsolatedDatabase, dropIsolatedDatabase } from '../../scripts/postgresql/database.ts';
import { grantApplicationPermissions } from '../../scripts/postgresql/permissions.ts';
import { readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';
import { readSqliteSnapshot } from '../../scripts/postgresql/sqlite-snapshot.ts';

test('an actual frozen SQLite discovery token continues after conversion with the original runtime and exact order; new PostgreSQL pages also complete', async t => {
  const runtimeFile = process.env.M1_PG_RUNTIME_FILE, fixtureFile = process.env.M1_PG_LEGACY_PAGINATION_FIXTURE;
  if (!runtimeFile || !fixtureFile) throw new Error('Explicit private runtime and frozen7b synthetic pagination fixture are required');
  const fixture = JSON.parse(await requirePrivateFile(fixtureFile)); assert.equal(fixture.format, 'connet-legacy-discovery-fixture-v1'); assert.equal(fixture.sourceCommit, '7b748ab94ff944e3c54f98b8a112d0a3a7727791');
  const source = await readSqliteSnapshot(fixture.database, fixture.identity), config = await readRuntime(runtimeFile), directory = await mkdtemp(join(tmpdir(), 'connet-pg-page-'));
  const target = await createIsolatedDatabase(config, `connet_test_${randomUUID().replaceAll('-', '')}`, join(directory, 'private'));
  t.after(async () => { try { await dropIsolatedDatabase(config, target.privateConnections); } finally { await rm(directory, { recursive: true, force: true }); } });
  const identity = { instanceId: source.snapshot.instance.instance_id, recoveryEpoch: source.snapshot.instance.recovery_epoch },
    maintenance = { ...identity, connectionString: (await requirePrivateFile(join(target.privateConnections, 'migration-database-url'))).trim() };
  await migratePostgres(maintenance); await importLegacySnapshot(maintenance, source.snapshot); await grantApplicationPermissions(config, target.database);
  await setPostgresWriteGate(maintenance, { enabled: true });
  const app = await buildApp({ ...identity, connectionString: (await requirePrivateFile(join(target.privateConnections, 'application-database-url'))).trim() });
  const collections = ['worlds', 'modules', 'types', 'sources', 'categories', 'skills', 'operations'];
  const flatten = (data: Record<string, any>) => collections.flatMap(collection => data[collection].map((entry: unknown) => ({ collection, entry })));
  async function finish(initial?: Record<string, any>) {
    const entries = initial ? flatten(initial) : []; let token = initial?.nextPageToken ?? '', complete = initial?.complete ?? false, pages = 0;
    while (!complete) {
      assert(pages++ < 200); const response = await app.inject({ method: 'GET', url: `/v1/perception/discovery?limit=1${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, headers: { authorization: `Bearer ${fixture.runtimeToken}` } });
      assert.equal(response.statusCode, 200, 'The original token must remain an authorized, valid continuation'); const data = response.json().data;
      entries.push(...flatten(data)); token = data.nextPageToken ?? ''; complete = data.complete; assert(complete || token);
    }
    return entries;
  }
  try { assert.deepEqual(await finish(fixture.first), fixture.expected); assert.deepEqual(await finish(), fixture.expected); }
  finally { await app.close(); }
});
