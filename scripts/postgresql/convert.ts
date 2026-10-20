import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { migratePostgres } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { exportLegacySnapshot, importLegacySnapshot } from '../../apps/platform/infrastructure/postgresql/legacy-codec.ts';
import { compareSnapshots, historicalDocumentEvidence, readSqliteSnapshot } from './sqlite-snapshot.ts';
import { privateFile, requirePrivateFile, secureDirectory } from './runtime.ts';

export async function convert(args: string[]): Promise<{ manifest: string; tables: number; rows: number; matched: true }> {
  const [database, identity, connectionFile, output, cutover, ...extra] = args;
  if (!database || !identity || !connectionFile || !output || extra.length || cutover !== undefined && cutover !== '--cutover') throw new Error('Usage: convert.ts SQLITE_COPY IDENTITY_COPY MIGRATION_URL_FILE NEW_PRIVATE_OUTPUT [--cutover]');
  const directory = await secureDirectory(output), startedAt = Date.now();
  try {
    const source = await readSqliteSnapshot(database, identity), documents = historicalDocumentEvidence(source.snapshot);
    const connectionString = (await requirePrivateFile(connectionFile)).trim(), url = new URL(connectionString);
    if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !/^\/connet_(?:rehearsal|test)[a-z0-9_]+$/.test(url.pathname) && !(cutover === '--cutover' && url.pathname === '/connet')) throw new Error('An explicit isolated target is required; connet requires the separate cutover intent');
    const options = { connectionString, instanceId: source.snapshot.instance.instance_id, recoveryEpoch: source.snapshot.instance.recovery_epoch };
    // This is a restricted temporary export, never an application shadow table.
    await privateFile(join(directory, 'source.snapshot.private.json'), JSON.stringify(source.snapshot) + '\n');
    await privateFile(join(directory, 'source-evidence.private.json'), JSON.stringify({ ...source.evidence, documents, node: process.version, icu: process.versions.icu, unicode: process.versions.unicode }, null, 2) + '\n');
    await migratePostgres(options);
    const pool = new Pool({ connectionString, max: 1 });
    try { const guard = await pool.query('SELECT writes_enabled FROM platform.instance_state WHERE singleton=1');
      if (guard.rows[0]?.writes_enabled !== false) throw new Error('The target business write gate must remain closed during conversion');
    } finally { await pool.end(); }
    const imported = await importLegacySnapshot(options, source.snapshot), restored = await exportLegacySnapshot(options);
    const comparison = compareSnapshots(source.snapshot, restored), targetDocuments = historicalDocumentEvidence(restored);
    const manifest = join(directory, 'conversion-manifest.private.json');
    await privateFile(manifest, JSON.stringify({ format: 'connet-sqlite6-postgresql-conversion-v1', status: comparison.matched ? 'validated-not-published' : 'quarantined',
      startedAt, completedAt: Date.now(), elapsedMs: Date.now() - startedAt, node: process.version, icu: process.versions.icu,
      source: { database, identity, ...source.evidence }, target: { host: url.hostname, port: url.port, database: url.pathname.slice(1), businessWritesEnabled: false },
      imported, comparison, documents: targetDocuments }, null, 2) + '\n');
    if (!comparison.matched) throw new Error('Target reconciliation failed; keep this target quarantined');
    return { manifest, ...imported, matched: true };
  } catch (error) {
    await privateFile(join(directory, 'conversion-failure.private.json'), JSON.stringify({ status: 'not-published', at: Date.now(),
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'conversion_failed', sourceWrittenByTool: false }) + '\n');
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  convert(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('postgresql_conversion_failed: no target published; inspect the private failure manifest\n'); process.exitCode = 1; });
}
