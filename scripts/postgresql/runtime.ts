import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const imageTag = 'postgres:18.6-trixie';
export const profile = 'agents-era-pg';
export const dockerContext = 'colima-agents-era-pg';
export const composeFile = fileURLToPath(new URL('../../ops/postgresql/compose.yaml', import.meta.url));
export interface RuntimeConfig { format: 'connet-postgresql-local-v1'; context: string; project: string; host: '127.0.0.1'; port: number; privateDir: string; image: string }
export function checkedProject(value: string): string {
  if (!/^agents-era-pg(?:-[a-z0-9][a-z0-9-]{0,40})?$/.test(value)) throw new Error('Use an explicit agents-era-pg project name');
  return value;
}
export function checkedImage(value: string): string {
  if (!/^postgres:18\.6-trixie@sha256:[a-f0-9]{64}$/.test(value)) throw new Error('An exact PostgreSQL 18.6-trixie RepoDigest is required');
  return value;
}
export async function privateFile(path: string, value: string): Promise<void> { await writeFile(path, value, { mode: 0o600, flag: 'wx' }); }
export async function secureDirectory(path: string): Promise<string> {
  const absolute = resolve(path); if (/[\r\n$#]/.test(absolute)) throw new Error('The private directory must be a literal dotenv-compatible path');
  await mkdir(absolute, { mode: 0o700 }); return realpath(absolute);
}
export async function requirePrivateFile(path: string): Promise<string> {
  const info = await stat(path); if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Configuration and secret files must be private regular files (0600)');
  return readFile(path, 'utf8');
}
export async function ensureAvailablePort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [8789, 8799, 8801, 8787, 8846, 18892].includes(port)) throw new Error('Use an allowed, explicit unprivileged PostgreSQL port');
  await new Promise<void>((done, reject) => { const server = createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : done())); });
}
/** No shell interpolation; passwords are never command arguments or returned output. */
export async function run(command: string, args: string[], options: { input?: string; output?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on('data', (data: Buffer) => output.push(data)); child.stderr.on('data', (data: Buffer) => errors.push(data));
    child.once('error', reject); child.once('close', code => code === 0 ? done(Buffer.concat(output).toString('utf8')) : reject(new Error(`${command} failed (exit ${code}); inspect the local runtime. ${options.output ? Buffer.concat(errors).toString('utf8').slice(-2000) : ''}`)));
    child.stdin.on('error', () => {}); child.stdin.end(options.input);
  });
}
export async function docker(args: string[], options: Parameters<typeof run>[2] = {}): Promise<string> { return run('docker', ['--context', dockerContext, ...args], options); }
export async function readRuntime(path: string): Promise<RuntimeConfig> {
  const config = JSON.parse(await requirePrivateFile(path)) as RuntimeConfig;
  if (config.format !== 'connet-postgresql-local-v1' || config.context !== dockerContext || config.host !== '127.0.0.1') throw new Error('Invalid local PostgreSQL runtime configuration');
  checkedProject(config.project); checkedImage(config.image);
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid PostgreSQL port');
  if (await realpath(dirname(resolve(path))) !== await realpath(config.privateDir)) throw new Error('Private configuration and secrets must share the same directory');
  return config;
}
export function composeEnvironment(config: RuntimeConfig, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  checkedProject(config.project); checkedImage(config.image);
  const env = { ...inherited };
  // A caller's shell is never an alternate source of Compose resource identity.
  for (const key of Object.keys(env)) if (key.startsWith('COMPOSE_') || key === 'DOCKER_HOST' || key === 'DOCKER_CONTEXT') delete env[key];
  return { ...env, DOCKER_CONTEXT: dockerContext, CONNET_PG_PROJECT: config.project, CONNET_PG_IMAGE: config.image,
    CONNET_PG_PORT: String(config.port), CONNET_PG_PRIVATE_DIR: config.privateDir };
}
export async function compose(config: RuntimeConfig, args: string[], inherited: NodeJS.ProcessEnv = process.env): Promise<string> {
  return docker(['compose', '--env-file', join(config.privateDir, 'compose.env'), '--file', composeFile, '--project-name', config.project, ...args], { output: true, env: composeEnvironment(config, inherited) });
}
export interface ContainerObservation {
  Name: string; Image: string;
  Config: { Image: string; Labels: Record<string, string> };
  State: { Running: boolean; Health?: { Status: string } };
  HostConfig: { PortBindings: Record<string, { HostIp: string; HostPort: string }[] | null> };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
  Mounts: { Type: string; Name?: string; Source: string; Destination: string; RW: boolean }[];
}
/** Actual Docker inspect values are compared, never reported as configuration facts. */
export function runtimeObservation(config: RuntimeConfig, container: ContainerObservation, expectedImageId: string) {
  const expected = { container: `${config.project}-server`, image: config.image, imageId: expectedImageId, project: config.project,
    ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(config.port) }] }, volume: `${config.project}-data`, privateDir: config.privateDir };
  const observed = { container: container.Name.replace(/^\//, ''), image: container.Config.Image, imageId: container.Image,
    project: container.Config.Labels['com.docker.compose.project'], service: container.Config.Labels['com.docker.compose.service'],
    ports: container.HostConfig.PortBindings, activePorts: container.NetworkSettings.Ports,
    volume: container.Mounts.find(mount => mount.Destination === '/var/lib/postgresql')?.Name,
    secretSources: Object.fromEntries(container.Mounts.filter(mount => mount.Destination.startsWith('/run/secrets/')).map(mount => [mount.Destination.split('/').at(-1), mount.Source])) };
  const mismatches: string[] = [];
  for (const key of ['container', 'image', 'imageId', 'project', 'volume'] as const) if (observed[key] !== expected[key]) mismatches.push(key);
  if (observed.service !== 'postgres') mismatches.push('service');
  if (JSON.stringify(observed.ports) !== JSON.stringify(expected.ports)) mismatches.push('ports');
  for (const kind of ['admin', 'migration', 'application', 'backup']) {
    const mount = container.Mounts.find(value => value.Destination === `/run/secrets/${kind}-password`);
    if (!mount || mount.Type !== 'bind' || mount.RW || mount.Source !== join(config.privateDir, `${kind}-password`)) mismatches.push(`${kind}-secret`);
  }
  const volume = container.Mounts.find(mount => mount.Destination === '/var/lib/postgresql');
  if (!volume || volume.Type !== 'volume' || !volume.RW) mismatches.push('data-mount');
  return { context: dockerContext, expected, observed, matches: mismatches.length === 0, mismatches,
    running: container.State.Running, health: container.State.Health?.Status ?? null };
}
export async function initializeRuntime(path: string, project: string, port: number, image: string): Promise<string> {
  checkedProject(project); checkedImage(image); await ensureAvailablePort(port);
  const privateDir = await secureDirectory(path);
  const config: RuntimeConfig = { format: 'connet-postgresql-local-v1', context: dockerContext, project, port, host: '127.0.0.1', privateDir, image };
  for (const [kind, user] of [['admin', 'postgres'], ['migration', 'connet_migrator'], ['application', 'connet_app'], ['backup', 'connet_backup']]) {
    const password = randomBytes(36).toString('base64url'); await privateFile(join(privateDir, `${kind}-password`), password);
    const database = kind === 'admin' ? 'postgres' : 'connet';
    await privateFile(join(privateDir, `${kind}-connection.json`), JSON.stringify({ host: '127.0.0.1', port, database, user, password }) + '\n');
    await privateFile(join(privateDir, `${kind}-database-url`), `postgresql://${user}:${password}@127.0.0.1:${port}/${database}\n`);
  }
  await privateFile(join(privateDir, 'compose.env'), `CONNET_PG_PROJECT=${project}\nCONNET_PG_PORT=${port}\nCONNET_PG_IMAGE=${image}\nCONNET_PG_PRIVATE_DIR=${privateDir}\n`);
  const file = join(privateDir, 'runtime.json'); await privateFile(file, JSON.stringify(config, null, 2) + '\n'); return file;
}
