import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { docker, privateFile, readRuntime, requirePrivateFile, secureDirectory, type RuntimeConfig } from './runtime.ts';

export function checkedIsolatedDatabase(name: string): string {
  if (!/^connet_(?:storage|application|rehearsal|test)[a-z0-9_]{0,40}$/.test(name)) throw new Error('An isolated connet storage/application/rehearsal/test database name is required');
  return name;
}
export async function createIsolatedDatabase(config: RuntimeConfig, name: string, directory: string): Promise<{ database: string; privateConnections: string }> {
  checkedIsolatedDatabase(name); const out = await secureDirectory(directory);
  // Fresh name only: PostgreSQL rejects an existing database; never DROP here.
  await docker(['exec', '-i', `${config.project}-server`, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
    { input: `CREATE DATABASE "${name}" OWNER connet_migrator TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8';\nREVOKE ALL ON DATABASE "${name}" FROM PUBLIC;\nGRANT CONNECT ON DATABASE "${name}" TO connet_app, connet_backup;\n` });
  for (const kind of ['migration', 'application', 'backup']) {
    const original = JSON.parse(await requirePrivateFile(join(config.privateDir, `${kind}-connection.json`))) as { host: string; port: number; user: string; password: string };
    await privateFile(join(out, `${kind}-connection.json`), JSON.stringify({ ...original, database: name }) + '\n');
    await privateFile(join(out, `${kind}-database-url`), `postgresql://${original.user}:${original.password}@${original.host}:${original.port}/${name}\n`);
  }
  return { database: name, privateConnections: out };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, name, out, ...extra] = process.argv.slice(2);
  (async () => { if (!file || !name || !out || extra.length) throw new Error('Usage: database.ts RUNTIME_JSON NEW_DATABASE NEW_PRIVATE_DIRECTORY');
    return createIsolatedDatabase(await readRuntime(file), name, out);
  })().then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('postgresql_isolated_database_failed\n'); process.exitCode = 1; });
}
