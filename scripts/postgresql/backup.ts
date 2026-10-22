import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { docker, dockerContext, privateFile, readRuntime, requirePrivateFile, secureDirectory, type RuntimeConfig } from './runtime.ts';
import { parseUniqueJson, sha256 } from './sqlite-snapshot.ts';
import { copyWalArchive, listWalArchives, syncDirectory, verifyBackupWal, type WalArchiveFile } from './wal-archive.ts';

async function privateTree(path: string): Promise<void> {
  const info = await lstat(path); if (info.isSymbolicLink()) throw new Error('External tablespaces/symlinks require an explicitly reviewed backup mapping');
  await chmod(path, info.isDirectory() ? 0o700 : 0o600); if (info.isDirectory()) for (const name of await readdir(path)) await privateTree(join(path, name));
}
async function dockerToPrivateFile(args: string[], path: string): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try { await new Promise<void>((done, reject) => {
    const child = spawn('docker', ['--context', dockerContext, ...args], { stdio: ['ignore', file.fd, 'pipe'] });
    child.stderr?.resume(); child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(new Error(`Database backup command failed (exit ${code})`)));
  }); } finally { await file.close(); }
}
const query = async (config: RuntimeConfig, sql: string): Promise<string> => (await docker(['exec', `${config.project}-server`, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atqc', sql])).trim();

/** Explicit operator action, not an Agent schedule. Copies only completed archive files. */
export async function archiveWal(config: RuntimeConfig, output: string): Promise<{ throughFile: string; files: WalArchiveFile[] }> {
  const throughFile = await query(config, 'SELECT pg_walfile_name(pg_current_wal_insert_lsn())'); await query(config, 'SELECT pg_switch_wal()');
  const deadline = Date.now() + 30_000; let archived = false;
  while (Date.now() < deadline) { const last = await query(config, "SELECT COALESCE(last_archived_wal,'') FROM pg_stat_archiver"); if (last >= throughFile) { archived = true; break; } await setTimeout(250); }
  if (!archived) throw new Error('Required WAL segment was not archived before the deadline');
  const stage = await secureDirectory(join(resolve(output), `wal-transfer-${randomUUID()}`)), destination = join(resolve(output), 'wal-archive');
  await mkdir(destination, { mode: 0o700, recursive: true });
  await docker(['cp', `${config.project}-server:/var/lib/postgresql/wal-archive/.`, stage]); await privateTree(stage);
  try {
    for (const file of await listWalArchives(stage)) await copyWalArchive(join(stage,file.archiveFile),join(destination,file.archiveFile),file);
  } finally { await rm(stage, { recursive: true, force: true }); }
  const files=await listWalArchives(destination),manifestPath=join(resolve(output),'backup-manifest.private.json');
  // Later explicit archive transfers extend the same backup's authenticated
  // artifact list. Historical v1 raw-only manifests remain valid.
  let prior:string|undefined;
  try{prior=await requirePrivateFile(manifestPath);}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}
  if(prior){
    const manifest=JSON.parse(prior);if(!['connet-pg-physical-backup-v1','connet-pg-physical-backup-v2'].includes(manifest.format)||manifest.project!==config.project||manifest.context!==config.context||manifest.image!==config.image)throw new Error('Backup archive identity mismatch');
    await verifyBackupWal(destination,manifest.wal.files);
    const temporary=manifestPath+'.'+randomUUID()+'.tmp';
    try{await privateFile(temporary,JSON.stringify({...manifest,format:files.some(file=>file.format==='gzip')?'connet-pg-physical-backup-v2':manifest.format,wal:{throughFile,files},walUpdatedAt:Date.now()},null,2)+'\n');const handle=await open(temporary,'r');try{await handle.sync();}finally{await handle.close();}await rename(temporary,manifestPath);await syncDirectory(dirname(manifestPath));}
    finally{await rm(temporary,{force:true});}
  }
  return { throughFile, files };
}
export interface BackupOptions { identityFile?: string; applicationConfigFile?: string; database?: string }
export async function backupRuntime(config: RuntimeConfig, output: string, options: BackupOptions = {}): Promise<{ directory: string; manifest: string }> {
  const directory = await secureDirectory(output), temp = `/tmp/connet-base-${randomUUID()}`, startedAt = Date.now();
  const database = options.database ?? 'connet';
  if (!/^connet(?:_(?:rehearsal|test)[a-z0-9_]+)?$/.test(database)) throw new Error('An explicit connet backup target is required');
  const supplemental: { name: string; sha256: string }[] = [], configDirectory = join(directory, 'private-config'); await mkdir(configDirectory, { mode: 0o700 });
  async function retain(name: string, path: string, secret = true) {
    const bytes = secret ? Buffer.from(await requirePrivateFile(path)) : await readFile(path);
    await privateFile(join(configDirectory, name), bytes.toString('utf8')); supplemental.push({ name, sha256: sha256(bytes) });
  }
  for (const name of ['runtime.json', 'compose.env', 'admin-password', 'migration-password', 'application-password', 'backup-password']) await retain(name, join(config.privateDir, name));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  for (const [name, path] of [['compose.yaml', 'ops/postgresql/compose.yaml'], ['postgresql.conf', 'ops/postgresql/postgresql.conf'], ['10-roles.sh', 'ops/postgresql/init/10-roles.sh'],['archive-command.sh','ops/postgresql/archive/command.sh'],['archive-restore.sh','ops/postgresql/archive/restore.sh']]) await retain(name!, join(root, path!), false);
  if (options.identityFile) {
    const identity = parseUniqueJson(await requirePrivateFile(options.identityFile)) as Record<string, unknown>;
    const observed = JSON.parse((await docker(['exec', `${config.project}-server`, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-Atqc', 'SELECT json_build_object(\'instanceId\',instance_id,\'recoveryEpoch\',recovery_epoch) FROM platform.instance_state WHERE singleton=1'])).trim()) as Record<string, unknown>;
    if (identity.version !== 1 || identity.instanceId !== observed.instanceId || identity.recoveryEpoch !== observed.recoveryEpoch) throw new Error('Backup database and paired identity mismatch');
    await retain('identity.json', options.identityFile);
  }
  if (options.applicationConfigFile) await retain('application.env', options.applicationConfigFile);
  await docker(['exec', '-u', 'postgres', `${config.project}-server`, 'pg_basebackup', '-U', 'connet_backup', '-D', temp, '--format=plain', '--wal-method=stream', '--checkpoint=fast', '--manifest-checksums=SHA256', '--no-password']);
  await docker(['exec', '-u', 'postgres', `${config.project}-server`, 'pg_verifybackup', temp]);
  const base = join(directory, 'basebackup'); await mkdir(base, { mode: 0o700 }); await docker(['cp', `${config.project}-server:${temp}/.`, base]); await privateTree(base);
  await docker(['exec', '-u', 'postgres', `${config.project}-server`, 'rm', '-rf', '--', temp]);
  await dockerToPrivateFile(['exec', `${config.project}-server`, 'pg_dump', '-U', 'connet_backup', '-d', database, '--format=custom'], join(directory, 'connet.dump'));
  await dockerToPrivateFile(['exec', `${config.project}-server`, 'pg_dumpall', '-U', 'postgres', '--globals-only'], join(directory, 'globals.private.sql'));
  const wal = await archiveWal(config, directory), manifest = join(directory, 'backup-manifest.private.json');
  await privateFile(manifest, JSON.stringify({ format: 'connet-pg-physical-backup-v2', image: config.image, context: config.context, project: config.project,
    startedAt, completedAt: Date.now(), basebackupVerified: true, dataDirectory: '/var/lib/postgresql/18/docker', wal,
    database, supplemental, pairedIdentityIncluded: Boolean(options.identityFile), applicationConfigurationIncluded: Boolean(options.applicationConfigFile),
    roleGlobalsIncluded: true, rpoRto: 'not-established' }, null, 2) + '\n');
  return { directory, manifest };
}
export interface RestoreDrill { container: string; volume: string; project: string; id: string }
/** Restores a new isolated, network-disabled cluster; never mounts the running data volume. */
export async function restoreDrill(config: RuntimeConfig, backup: string): Promise<RestoreDrill> {
  const directory = resolve(backup), manifest = JSON.parse(await requirePrivateFile(join(directory, 'backup-manifest.private.json'))) as { format: string; image: string;wal:{files:{name:string;sha256:string;archiveFile?:string}[]} };
  if (!['connet-pg-physical-backup-v1','connet-pg-physical-backup-v2'].includes(manifest.format) || manifest.image !== config.image || /[,\r\n]/.test(directory)) throw new Error('A matching private physical backup is required');
  if(manifest.format==='connet-pg-physical-backup-v1'&&manifest.wal.files.some(file=>(file.archiveFile??file.name).endsWith('.gz')))throw new Error('Compressed backup archives require the version 2 manifest');
  await verifyBackupWal(join(directory,'wal-archive'),manifest.wal.files);
  await docker(['run', '--rm', '--network', 'none', '--mount', `type=bind,source=${directory},target=/backup,readonly`, config.image, 'pg_verifybackup', '/backup/basebackup']);
  const id = randomUUID(), container = `${config.project}-restore-${id}`, volume = `${container}-data`, labels = ['--label', `io.connet.project=${config.project}`, '--label', 'io.connet.purpose=restore-drill', '--label', `io.connet.drill=${id}`];
  await privateFile(join(directory, `restore-drill-${id}.private.json`), JSON.stringify({ format: 'connet-pg-restore-drill-v1', container, volume, project: config.project, id, sourceVolumeMounted: false, network: 'none', at: Date.now() }) + '\n');
  await docker(['volume', 'create', ...labels, volume]);
  await docker(['run', '--rm', '--network', 'none', '--mount', `type=volume,source=${volume},target=/restore`, '--mount', `type=bind,source=${directory},target=/backup,readonly`, config.image,
    'sh', '-ec', 'mkdir -p /restore/18/docker /restore/restore-wal; cp -a /backup/basebackup/. /restore/18/docker/; cp -a /backup/wal-archive/. /restore/restore-wal/; touch /restore/18/docker/recovery.signal; chown -R postgres:postgres /restore; chmod 700 /restore/18/docker /restore/restore-wal']);
  const restoreHelper=fileURLToPath(new URL('../../ops/postgresql/archive/restore.sh',import.meta.url));if(/[,\r\n]/.test(restoreHelper))throw new Error('Invalid restore helper path');
  await docker(['run', '-d', '--name', container, ...labels, '--network', 'none', '--mount', `type=volume,source=${volume},target=/var/lib/postgresql`,'--mount',`type=bind,source=${restoreHelper},target=/etc/postgresql/archive/restore.sh,readonly`, config.image, 'postgres',
    '-c', "listen_addresses=", '-c', 'archive_mode=off', '-c', 'restore_command=sh /etc/postgresql/archive/restore.sh %f %p /var/lib/postgresql/restore-wal']);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { const state = await docker(['exec', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atqc', 'SELECT pg_is_in_recovery()']);
      if (state.trim() === 'f') return { container, volume, project: config.project, id };
    } catch { /* Only this new restore is still starting; no source retries/writes. */ }
    await setTimeout(250);
  }
  throw new Error(`Isolated restore was not ready; retain ${container} and its volume for diagnosis`);
}
export async function stopRestoreDrill(config: RuntimeConfig, drill: RestoreDrill, removeDisposableVolume = false): Promise<void> {
  if (drill.project !== config.project || drill.container !== `${config.project}-restore-${drill.id}` || drill.volume !== `${drill.container}-data`) throw new Error('Restore identity mismatch');
  const labels = JSON.parse(await docker(['inspect', drill.container, '--format', '{{json .Config.Labels}}'])) as Record<string, string>;
  if (labels['io.connet.project'] !== config.project || labels['io.connet.purpose'] !== 'restore-drill' || labels['io.connet.drill'] !== drill.id) throw new Error('Restore ownership mismatch');
  await docker(['stop', '--time', '60', drill.container]);
  if (removeDisposableVolume) { const volume = JSON.parse(await docker(['volume', 'inspect', drill.volume, '--format', '{{json .Labels}}'])) as Record<string, string>;
    if (volume['io.connet.drill'] !== drill.id || volume['io.connet.project'] !== config.project) throw new Error('Restore volume ownership mismatch');
    await docker(['rm', drill.container]); await docker(['volume', 'rm', drill.volume]); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, file, output, identityFile, applicationConfigFile, ...extra] = process.argv.slice(2);
  (async () => { if (!file || !output || extra.length) throw new Error('Usage: backup.ts backup RUNTIME_JSON NEW_OUTPUT PAIRED_IDENTITY PRIVATE_APPLICATION_ENV | archive|restore-drill RUNTIME_JSON BACKUP');
    const config = await readRuntime(file); if (action === 'backup') { if (!identityFile || !applicationConfigFile) throw new Error('Final backups require paired identity and application configuration'); return backupRuntime(config, output, { identityFile, applicationConfigFile }); }
    if (identityFile || applicationConfigFile) throw new Error('Unexpected backup argument'); if (action === 'archive') return archiveWal(config, output); if (action === 'restore-drill') return restoreDrill(config, output); throw new Error('Unknown backup action');
  })().then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('postgresql_backup_failed: inspect private artifacts; source data was not replaced\n'); process.exitCode = 1; });
}
