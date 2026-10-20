import { copyFile, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { M1_TABLES } from '../../apps/platform/contracts/store.ts';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { comparisonJson, parseUniqueJson, readSqliteSnapshot, sha256 } from './sqlite-snapshot.ts';
import { privateFile, requirePrivateFile, secureDirectory } from './runtime.ts';

/** Upgrade only a NEW copied file; never open the provided stopped source writable. */
export async function prepareSqliteCopy(source: string, identityFile: string, output: string) {
  const directory = await secureDirectory(output), sourceBytes = await readFile(source), identityBytes = await requirePrivateFile(identityFile), identity = parseUniqueJson(identityBytes) as { instanceId: string; recoveryEpoch: string; version: number };
  const readonly = new DatabaseSync(source, { readOnly: true });
  const legacyTables = M1_TABLES.filter(table => !['wallet_accounts', 'mailbox_messages', 'mailbox_receipts'].includes(table));
  let before: Record<string, string>, sourceVersion: number, originalHistory: unknown[];
  try {
    readonly.exec('PRAGMA query_only=ON; BEGIN');
    const history = readonly.prepare('SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version').all(); sourceVersion = history.length; originalHistory = history;
    if (![5, 6].includes(sourceVersion) || history.some((row, index) => row.version !== index + 1 || row.name !== migrations[index]?.name || row.checksum !== sha256(migrations[index]!.sql))) throw new Error('A frozen schema5/6 stopped copy is required');
    const state = readonly.prepare('SELECT instance_id,recovery_epoch FROM instance_state WHERE singleton=1').get();
    if (identity.version !== 1 || state?.instance_id !== identity.instanceId || state?.recovery_epoch !== identity.recoveryEpoch) throw new Error('Stopped copy and identity mismatch');
    before = Object.fromEntries(legacyTables.map(table => [table, sha256(comparisonJson(readonly.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()))]));
  } finally { readonly.close(); }
  const database = join(directory, 'schema6.sqlite'), pairedIdentity = join(directory, 'identity.json');
  await privateFile(database, ''); await copyFile(source, database); await chmod(database, 0o600); await privateFile(pairedIdentity, identityBytes);
  const copy = new DatabaseSync(database);
  try { migrateDatabase(copy); } finally { copy.close(); }
  const checked = await readSqliteSnapshot(database, pairedIdentity), inspect = new DatabaseSync(database, { readOnly: true });
  try {
    for (const table of legacyTables) if (before[table] !== sha256(comparisonJson(inspect.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()))) throw new Error('An original business row changed during offline schema6 preparation');
    const retainedHistory = inspect.prepare('SELECT version,name,checksum,applied_at FROM schema_migrations WHERE version<=? ORDER BY version').all(sourceVersion);
    if (comparisonJson(retainedHistory) !== comparisonJson(originalHistory)) throw new Error('Original migration history changed during preparation');
  } finally { inspect.close(); }
  if (!(await readFile(source)).equals(sourceBytes) || await readFile(identityFile, 'utf8') !== identityBytes) throw new Error('Provided stopped source changed during preparation');
  const manifest = join(directory, 'preparation-manifest.private.json');
  await privateFile(manifest, JSON.stringify({ format: 'connet-sqlite6-preparation-v1', sourceVersion, targetVersion: 6, sourceSha256: sha256(sourceBytes),
    identitySha256: sha256(identityBytes), originalHistorySha256: sha256(comparisonJson(originalHistory)), original18BusinessTableHashes: before, targetSha256: checked.evidence.databaseSha256, sourceWrittenByTool: false }, null, 2) + '\n');
  return { database, identity: pairedIdentity, manifest, sourceVersion, targetVersion: 6 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, identity, output, ...extra] = process.argv.slice(2);
  (async () => { if (!source || !identity || !output || extra.length) throw new Error('Usage: prepare-sqlite.ts STOPPED_CONSISTENT_COPY PAIRED_IDENTITY NEW_PRIVATE_DIRECTORY'); return prepareSqliteCopy(source, identity, output); })()
    .then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('postgresql_source_preparation_failed: stopped source was not opened writable\n'); process.exitCode = 1; });
}
