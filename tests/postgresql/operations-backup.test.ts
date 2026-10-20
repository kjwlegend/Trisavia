import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { migratePostgres } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { archiveWal, backupRuntime, restoreDrill, stopRestoreDrill, type RestoreDrill } from '../../scripts/postgresql/backup.ts';
import { createIsolatedDatabase, dropIsolatedDatabase } from '../../scripts/postgresql/database.ts';
import { docker, readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';

test('a verified private basebackup plus later archived WAL restores both commits into a new network-isolated cluster', async () => {
  const runtimeFile = process.env.M1_PG_RUNTIME_FILE; if (!runtimeFile) throw new Error('Explicit isolated PostgreSQL runtime is required');
  const config = await readRuntime(runtimeFile), parent = resolve('outputs/postgresql/backup-tests');
  // Colima shares the repository, while macOS /var/folders temporary directories may not be mounted in its VM.
  await mkdir(parent, { recursive: true, mode: 0o700 }); const directory = await mkdtemp(join(parent, 'connet-backup-drill-'));
  const target = await createIsolatedDatabase(config, `connet_test_${randomUUID().replaceAll('-', '')}`, join(directory, 'connections'));
  const identity = { instanceId: `backup-${randomUUID()}`, recoveryEpoch: `epoch-${randomUUID()}` }, identityFile = join(directory, 'identity.json'), applicationConfigFile = join(directory, 'application.env');
  const connectionString = (await requirePrivateFile(join(target.privateConnections, 'migration-database-url'))).trim(); let drill: RestoreDrill | undefined;
  await writeFile(identityFile, JSON.stringify({ version: 1, ...identity }), { mode: 0o600 }); await writeFile(applicationConfigFile, 'M1_EMAIL_MODE=experience\n', { mode: 0o600 });
  try {
    await migratePostgres({ connectionString, ...identity }); const pool = new Pool({ connectionString, max: 1 });
    try { await pool.query("CREATE TABLE public.recovery_probe(id integer PRIMARY KEY,body text NOT NULL); INSERT INTO public.recovery_probe VALUES(1,'before-basebackup')"); }
    finally { await pool.end(); }
    const backup = await backupRuntime(config, join(directory, 'backup'), { database: target.database, identityFile, applicationConfigFile });
    const late = new Pool({ connectionString, max: 1 }); try { await late.query("INSERT INTO public.recovery_probe VALUES(2,'committed-after-basebackup')"); } finally { await late.end(); }
    const wal = await archiveWal(config, backup.directory); assert(wal.files.some(file => file.name === wal.throughFile));
    drill = await restoreDrill(config, backup.directory);
    const restored = JSON.parse((await docker(['exec', drill.container, 'psql', '-X', '-U', 'postgres', '-d', target.database, '-Atqc', 'SELECT json_agg(recovery_probe ORDER BY id) FROM public.recovery_probe'])).trim());
    assert.deepEqual(restored, [{ id: 1, body: 'before-basebackup' }, { id: 2, body: 'committed-after-basebackup' }]);
    const observed = JSON.parse(await docker(['inspect', drill.container, '--format', '{{json .HostConfig}}']));
    assert.equal(observed.NetworkMode, 'none'); assert.equal(Object.keys(observed.PortBindings ?? {}).length, 0);
    const manifest = JSON.parse(await requirePrivateFile(backup.manifest)); assert.equal(manifest.basebackupVerified, true); assert.equal(manifest.pairedIdentityIncluded, true); assert.equal(manifest.roleGlobalsIncluded, true); assert.equal(manifest.applicationConfigurationIncluded, true);
    assert((await readFile(join(backup.directory, 'private-config/identity.json'))).equals(await readFile(identityFile)));
    for (const file of ['backup-manifest.private.json', 'globals.private.sql', 'private-config/admin-password', 'private-config/identity.json']) assert.equal((await stat(join(backup.directory, file))).mode & 0o777, 0o600);
  } finally {
    if (drill) await stopRestoreDrill(config, drill, true);
    await dropIsolatedDatabase(config, target.privateConnections); await rm(directory, { recursive: true, force: true });
  }
});
