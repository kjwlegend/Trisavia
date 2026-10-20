import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateFile, secureDirectory } from './runtime.ts';

/** Cross-version fixture only: pass an immutable git archive of the stated old commit. */
export async function createLegacyPaginationFixture(oldSource: string, output: string) {
  const directory = await secureDirectory(output), source = resolve(oldSource), from = (file: string) => pathToFileURL(join(source, file)).href;
  const { buildApp } = await import(from('apps/platform/app.ts'));
  const { loadBackendConfig } = await import(from('apps/platform/configuration/backend-config.ts'));
  const { injectApi, ownerFixture, agentFixture } = await import(from('scripts/agent-manager-qa-fixture.ts'));
  const config = loadBackendConfig({ M1_EMAIL_MODE: 'experience', M1_DATABASE_PATH: join(directory, 'source.sqlite'), M1_IDENTITY_PATH: join(directory, 'identity.json') }, directory), app = buildApp(config);
  const persist = async (value: unknown) => privateFile(join(directory, `prepared-${randomUUID()}.private.json`), JSON.stringify(value) + '\n');
  try {
    await app.ready(); const api = injectApi(app), owner = await ownerFixture(api, 'PgPage', persist), agent = await agentFixture(api, owner, '隔离跨库分页角色', 'blue', persist);
    const collections = ['worlds', 'modules', 'types', 'sources', 'categories', 'skills', 'operations'], flatten = (data: Record<string, unknown[]>) => collections.flatMap(collection => data[collection]!.map(entry => ({ collection, entry })));
    const expected: unknown[] = []; let token = '';
    do { const response = await api('GET', `/perception/discovery?limit=50${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, undefined, agent.runtimeToken);
      assert.equal(response.status, 200); expected.push(...flatten(response.body.data)); token = response.body.data.nextPageToken || '';
    } while (token);
    const first = await api('GET', '/perception/discovery?limit=1', undefined, agent.runtimeToken); assert.equal(first.status, 200); assert.equal(first.body.data.complete, false); assert.equal(typeof first.body.data.nextPageToken, 'string');
    const fixture = join(directory, 'pagination-fixture.private.json');
    await privateFile(fixture, JSON.stringify({ format: 'connet-legacy-discovery-fixture-v1', sourceCommit: '7b748ab94ff944e3c54f98b8a112d0a3a7727791',
      database: config.databasePath, identity: join(directory, 'identity.json'), runtimeToken: agent.runtimeToken, first: first.body.data, expected }) + '\n');
    return { fixture, expectedEntries: expected.length, originalPageLimit: 1 };
  } finally { await app.close(); await chmod(join(directory, 'source.sqlite'), 0o600); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, out, ...extra] = process.argv.slice(2);
  (async () => { if (!source || !out || extra.length) throw new Error('Usage: legacy-pagination-fixture.ts IMMUTABLE_7B_SOURCE_ARCHIVE NEW_PRIVATE_OUTPUT'); return createLegacyPaginationFixture(source, out); })()
    .then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(() => { process.stderr.write('postgresql_legacy_pagination_fixture_failed\n'); process.exitCode = 1; });
}
