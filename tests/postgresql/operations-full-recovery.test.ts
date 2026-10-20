import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { exportLegacySnapshot, importLegacySnapshot } from '../../apps/platform/infrastructure/postgresql/legacy-codec.ts';
import { migratePostgres } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { archiveWal, backupRuntime, restoreDrill, stopRestoreDrill, type RestoreDrill } from '../../scripts/postgresql/backup.ts';
import { createIsolatedDatabase, dropIsolatedDatabase } from '../../scripts/postgresql/database.ts';
import { recoveryEvidence } from '../../scripts/postgresql/recovery-evidence.ts';
import { privateFile, readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';
import { compareSnapshots, historicalDocumentEvidence, readSqliteSnapshot, sha256 } from '../../scripts/postgresql/sqlite-snapshot.ts';

test('the full converted23-table source restores every formal typed column/child row, metadata, historical canonical document and paired identity', { timeout: 180_000 }, async () => {
  const runtimeFile = process.env.M1_PG_RUNTIME_FILE, sourceFile = process.env.M1_PG_SQLITE_COPY, identityFile = process.env.M1_PG_IDENTITY_COPY;
  if (!runtimeFile || !sourceFile || !identityFile) throw new Error('Explicit private isolated runtime and copied source/identity are required');
  const config = await readRuntime(runtimeFile), input = await readSqliteSnapshot(sourceFile, identityFile);
  const parent = resolve('outputs/postgresql/full-recovery'); await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, 'run-')), target = await createIsolatedDatabase(config, `connet_rehearsal_${randomUUID().replaceAll('-', '')}`, join(directory, 'connections'));
  const options = { connectionString: (await requirePrivateFile(join(target.privateConnections, 'migration-database-url'))).trim(), instanceId: input.snapshot.instance.instance_id, recoveryEpoch: input.snapshot.instance.recovery_epoch };
  const appConfig = join(directory, 'application.env'); await privateFile(appConfig, 'M1_EMAIL_MODE=experience\n'); let drill: RestoreDrill | undefined;
  try {
    await migratePostgres(options); await importLegacySnapshot(options, input.snapshot);
    assert.equal(compareSnapshots(input.snapshot, await exportLegacySnapshot(options)).matched, true);
    const source = await recoveryEvidence(config, target.database), paired = JSON.parse(await requirePrivateFile(identityFile));
    assert.deepEqual(source.identity, { instance_id: paired.instanceId, recovery_epoch: paired.recoveryEpoch, writes_enabled: false });
    assert.deepEqual(source.documents.map(({ storedDocumentTextSha256, ...document }) => document).sort((a, b) => a.id.localeCompare(b.id)), historicalDocumentEvidence(input.snapshot).sort((a, b) => a.id.localeCompare(b.id)));
    const backup = await backupRuntime(config, join(directory, 'backup'), { database: target.database, identityFile, applicationConfigFile: appConfig }); await archiveWal(config, backup.directory);
    assert.deepEqual(await recoveryEvidence(config, target.database), source, 'The source typed target was quiescent throughout the backup cutoff');
    drill = await restoreDrill(config, backup.directory);
    const recovered = await recoveryEvidence(config, target.database, drill.container);
    assert.deepEqual(recovered, source, 'Every typed business/child/metadata row and canonical text/digest matches the imported baseline');
    assert((await readFile(join(backup.directory, 'private-config/identity.json'))).equals(await readFile(identityFile)));
    await privateFile(join(directory, 'verification.private.json'), JSON.stringify({ format: 'connet-full-pg-recovery-evidence-v1',
      sourceCommit: '7b748ab94ff944e3c54f98b8a112d0a3a7727791', sourceMeaning: 'reviewed schema6 copy already prepared to catalog4; not a later fresh cutoff',
      sourceDatabaseSha256: input.evidence.databaseSha256, sourceIdentitySha256: input.evidence.identitySha256,
      legacyTables: 23, legacyRows: Object.values(input.snapshot.tables).reduce((n, rows) => n + rows.length, 0),
      source, recovered, backupManifest: backup.manifest, allColumnsAndRowsMatched: true, identityFileSha256: sha256(await readFile(identityFile)),
      network: 'none', hostPorts: [], sourceWrittenByTool: false, formalConnetUntouched: true }, null, 2) + '\n');
    console.log(JSON.stringify({ evidence: join(directory, 'verification.private.json'), typedTables: source.tables.length, historicalDocuments: source.documents.length, matched: true }));
  } finally {
    if (drill) await stopRestoreDrill(config, drill, true);
    await dropIsolatedDatabase(config, target.privateConnections);
  }
});
