import { chmod, copyFile, lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareSnapshots, comparisonJson, historicalDocumentEvidence, readSqliteSnapshot, sha256 } from './sqlite-snapshot.ts';
import { privateFile, requirePrivateFile, secureDirectory } from './runtime.ts';

/** Audited legacy ready/close is an explicit offline operation on a NEW copy. */
export async function prepareLegacyCatalog(source: string, identityFile: string, legacySource: string, output: string) {
  const manifestFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../ops/postgresql/legacy-7b-bootstrap.manifest.json');
  const sourceManifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { commit: string; files: Record<string, string> };
  if (sourceManifest.commit !== '7b748ab94ff944e3c54f98b8a112d0a3a7727791' || !Object.keys(sourceManifest.files).length) throw new Error('Frozen bootstrap manifest is required');
  for (const [path, digest] of Object.entries(sourceManifest.files)) {
    const absolute = join(resolve(legacySource), path), info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || sha256(await readFile(absolute)) !== digest) throw new Error('Legacy bootstrap source does not match the reviewed Git manifest');
  }
  const before = await readSqliteSnapshot(source, identityFile), originalBytes = await readFile(source), identityText = await requirePrivateFile(identityFile);
  const directory = await secureDirectory(output), database = join(directory, 'catalog4.sqlite'), identity = join(directory, 'identity.json');
  await privateFile(database, ''); await copyFile(source, database); await chmod(database, 0o600); await privateFile(identity, identityText);
  const from = (path: string) => pathToFileURL(join(resolve(legacySource), path)).href;
  const { buildApp } = await import(from('apps/platform/app.ts'));
  const { loadBackendConfig } = await import(from('apps/platform/configuration/backend-config.ts'));
  const app = buildApp(loadBackendConfig({ M1_DATABASE_PATH: database, M1_IDENTITY_PATH: identity, M1_EMAIL_MODE: 'experience', M1_HOST: '127.0.0.1', M1_PORT: '0' }));
  try { await app.ready(); } finally { await app.close(); }
  const after = await readSqliteSnapshot(database, identity), nonCatalog = structuredClone(after.snapshot);
  nonCatalog.tables.perception_catalog = before.snapshot.tables.perception_catalog;
  const comparison = compareSnapshots(before.snapshot, nonCatalog);
  if (!comparison.matched) throw new Error('Offline catalog preparation changed a non-catalog row or migration/instance metadata');
  const oldRows = new Map(before.snapshot.tables.perception_catalog.map(row => [row.id, row]));
  const rows = new Map(after.snapshot.tables.perception_catalog.map(row => [row.id, row]));
  for (const [id, row] of oldRows) if (id !== 'current' && comparisonJson(row) !== comparisonJson(rows.get(id))) throw new Error('An existing immutable catalog row changed or disappeared');
  const current = rows.get('current'), previous = oldRows.get('current');
  if (!previous || current?.data.schemaVersion !== 4 || !Number.isSafeInteger(current.data.guideVersion)
    || current.data.guideVersion !== Number(previous.data.guideVersion) + (previous.data.schemaVersion === 4 ? 0 : 1)) throw new Error('Exact schema4 catalog readiness was not established');
  const added = [...rows.values()].filter(row => !oldRows.has(row.id));
  if (added.some(row => !/^schema:.+:4$/.test(row.id) && !new RegExp(`^guide:[^:]+:${current.data.guideVersion}$`).test(row.id) && !/^catalog-revision:/.test(row.id))) throw new Error('An unexpected catalog row was added');
  const documents = historicalDocumentEvidence(after.snapshot);
  if (!(await readFile(source)).equals(originalBytes) || await readFile(identityFile, 'utf8') !== identityText) throw new Error('Provided catalog source changed');
  const manifest = join(directory, 'catalog-preparation-manifest.private.json');
  await privateFile(manifest, JSON.stringify({ format: 'connet-offline-catalog-preparation-v1', legacyCommit: sourceManifest.commit,
    sourceSha256: sha256(originalBytes), identitySha256: sha256(identityText), targetSha256: after.evidence.databaseSha256,
    originalCatalogRowsPreservedExceptCurrent: oldRows.size - 1, nonCatalogComparison: comparison,
    previous: { schemaVersion: previous.data.schemaVersion, guideVersion: previous.data.guideVersion },
    current: { schemaVersion: current.data.schemaVersion, guideVersion: current.data.guideVersion }, addedIds: added.map(row => row.id),
    documents, listenerStarted: false, seeded: false, authenticatedRequestSent: false, sourceWrittenByTool: false }, null, 2) + '\n');
  return { database, identity, manifest, schemaVersion: 4, guideVersion: current.data.guideVersion };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, identity, legacy, output, ...extra] = process.argv.slice(2);
  (async () => { if (!source || !identity || !legacy || !output || extra.length) throw new Error('Usage: prepare-catalog.ts SCHEMA6_COPY PAIRED_IDENTITY REVIEWED_7B_ARCHIVE NEW_PRIVATE_DIRECTORY'); return prepareLegacyCatalog(source, identity, legacy, output); })()
    .then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('postgresql_catalog_preparation_failed: source not opened writable; no target published\n'); process.exitCode = 1; });
}
