// Isolated offline QA data only. Run from the fixed candidate with --out NEW_DIR.
// No listener, real user database, public origin, or email provider is used.
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildApp } from '../apps/platform/app.ts';
import { loadBackendConfig } from '../apps/platform/configuration/backend-config.ts';
import { openPostgresStore } from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { seedWs02DemoData } from '../apps/platform/application/perception-seed.ts';
import { agentFixture, injectApi, ownerFixture, type Json } from './agent-manager-qa-fixture.ts';

async function savePrivate(path: string, value: unknown) {
  const temporary = `${path}.pending`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export async function generateWs02QaFixture(output: string,target:{connectionFile:string;identityPath:string}) {
  if (!isAbsolute(output)) throw new Error('output_must_be_absolute');
  const directory = resolve(output);
  if (directory === dirname(directory)) throw new Error('output_must_be_new_directory');
  const parent = await realpath(dirname(directory));
  if (parent !== dirname(directory)) throw new Error('output_parent_must_be_canonical');
  // Non-recursive creation intentionally refuses an existing directory/file.
  await mkdir(directory, { mode: 0o700 });
  const config = loadBackendConfig({ M1_EMAIL_MODE: 'experience', M1_PORT: '0',
    M1_POSTGRES_CONNECTION_FILE: target.connectionFile,
    M1_IDENTITY_PATH: target.identityPath }, directory);
  const privatePath = join(directory, 'fixture.private.json');
  const state: Json = { format: 'connet-ws02-qa-v1', instanceId: config.instanceId,
    owners: [], agents: [], prepared: [] };
  const persist = () => savePrivate(privatePath, state);
  await persist();
  const app = await buildApp(config);
  try {
    const api = injectApi(app);
    for (const [label, names] of [
      ['A', ['感知测试甲', '感知测试乙']], ['B', ['另一主人测试丙']], ['Empty', []],
    ] as const) {
      const owner = await ownerFixture(api, `P${label}`, async candidate => {
        state.prepared.push({ kind: 'owner', ...candidate }); await persist();
      });
      state.owners.push(owner); await persist();
      for (const [index, name] of names.entries()) {
        const agent = await agentFixture(api, owner, name, index ? 'coral' : 'blue', async candidate => {
          state.prepared.push({ kind: 'agent', ...candidate }); await persist();
        });
        state.agents.push(agent); await persist();
      }
    }
  } finally { await app.close(); }
  const store = await openPostgresStore(config);
  let manifest;
  try { manifest = await seedWs02DemoData(store, { actorId: 'ws02-isolated-qa-administrator' }); }
  finally { await store.close(); }
  const manifestPath = join(directory, 'seed-manifest.private.json');
  await savePrivate(manifestPath, manifest);
  state.seedManifestPath = manifestPath; state.status = 'prepared'; await persist();
  return { directory, privatePath, manifestPath, instanceId: config.instanceId,
    owners: state.owners.length, agents: state.agents.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 6 || args[0] !== '--out' || !args[1] || args[2] !== '--connection' || !args[3] || args[4] !== '--identity' || !args[5]) throw new Error('usage');
    // Stdout contains paths, a public instance identifier and counts only.
    const result = await generateWs02QaFixture(args[1],{connectionFile:args[3]!,identityPath:args[5]!});
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write('ws02_fixture_failed: use --out NEW_PRIVATE_DIR --connection EXISTING_PRIVATE_PG_FILE --identity PAIRED_IDENTITY\n');
    process.exitCode = 1;
  }
}
