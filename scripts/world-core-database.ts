import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { docker, privateFile, readRuntime, requirePrivateFile, secureDirectory, type RuntimeConfig } from './postgresql/runtime.ts';

export function checkedWorldDatabase(name: string): string {
  if (!/^world_core_[abc]_[a-z0-9_]{1,38}$/.test(name) && name !== 'world_core_integration_20261021') throw new Error('An explicit isolated World author or TD candidate database name is required');
  return name;
}
export async function createWorldDatabase(config: RuntimeConfig, name: string, directory: string, creator:'a'|'b'|'c'|'td'='b'): Promise<{ database: string; privateConnections: string }> {
  checkedWorldDatabase(name);if(creator==='td'?name!=='world_core_integration_20261021':!name.startsWith('world_core_'+creator+'_'))throw new Error('Database prefix must match its explicit creator'); const out = await secureDirectory(directory);
  // Fresh name only: PostgreSQL rejects an existing database; never DROP here.
  await docker(['exec', '-i', `${config.project}-server`, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
    { input: `CREATE DATABASE "${name}" OWNER connet_migrator TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8';\nREVOKE ALL ON DATABASE "${name}" FROM PUBLIC;\nGRANT CONNECT ON DATABASE "${name}" TO connet_app, connet_backup;\n` });
  const identity = JSON.parse((await docker(['exec', `${config.project}-server`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atqc',
    `SELECT json_build_object('oid',oid::bigint,'owner',pg_get_userbyid(datdba)) FROM pg_database WHERE datname='${name}'`])).trim()) as { oid: number; owner: string };
  if (!Number.isSafeInteger(identity.oid) || identity.owner !== 'connet_migrator') throw new Error('Created test database identity did not match');
  await privateFile(join(out, 'created-database.json'), JSON.stringify({ format: 'world-core-isolated-pg-database-v1', database: name, oid: identity.oid,
    owner: identity.owner, creator, project: config.project, context: config.context }) + '\n');
  for (const kind of ['migration', 'application', 'backup']) {
    const original = JSON.parse(await requirePrivateFile(join(config.privateDir, `${kind}-connection.json`))) as { host: string; port: number; user: string; password: string };
    await privateFile(join(out, `${kind}-connection.json`), JSON.stringify({ ...original, database: name }) + '\n');
    await privateFile(join(out, `${kind}-database-url`), `postgresql://${original.user}:${original.password}@${original.host}:${original.port}/${name}\n`);
  }
  return { database: name, privateConnections: out };
}
/** Drop only an explicitly created isolated target after its pool has closed. No FORCE. */
export async function dropWorldTestDatabase(config: RuntimeConfig, privateConnections: string, creator:'a'|'b'|'c'='b'): Promise<void> {
  const manifest = JSON.parse(await requirePrivateFile(join(privateConnections, 'created-database.json'))) as {
    format: string; database: string; oid: number; owner: string; creator:string; project: string; context: string };
  checkedWorldDatabase(manifest.database);
  if(manifest.creator!==creator||!manifest.database.startsWith('world_core_'+creator+'_'))throw new Error('Automatic test cleanup requires the same explicit creator and prefix');
  if (manifest.format !== 'world-core-isolated-pg-database-v1' || manifest.project !== config.project || manifest.context !== config.context
    || manifest.owner !== 'connet_migrator' || !Number.isSafeInteger(manifest.oid)) throw new Error('Isolated database manifest mismatch');
  const expected = `${manifest.oid}|${manifest.owner}`;
  const actual = (await docker(['exec', `${config.project}-server`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atqc',
    `SELECT oid::text||'|'||pg_get_userbyid(datdba) FROM pg_database WHERE datname='${manifest.database}'`])).trim();
  if (actual !== expected) throw new Error('Isolated database identity changed; refusing to drop');
  await docker(['exec', `${config.project}-server`, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', `DROP DATABASE "${manifest.database}"`]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, name, out, creator, ...extra] = process.argv.slice(2);
  (async () => { if (!file || !name || !out || !creator || !['a','b','c','td'].includes(creator) || extra.length) throw new Error('Usage: world-core-database.ts RUNTIME_JSON NEW_DATABASE NEW_PRIVATE_DIRECTORY CREATOR(a|b|c|td)');
    return createWorldDatabase(await readRuntime(file), name, out,creator as 'a'|'b'|'c'|'td');
  })().then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('world_core_isolated_database_failed\n'); process.exitCode = 1; });
}
