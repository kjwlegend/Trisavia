import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { buildApp, type BuildAppOptions } from '../../apps/platform/app.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { seedWs02DemoData } from '../../apps/platform/application/perception-seed.ts';
import { agentFixture, injectApi, ownerFixture, type Json } from '../../scripts/agent-manager-qa-fixture.ts';

export interface Ref { moduleId: string; type: string; id: string }
export const refKey = (ref: Ref) => JSON.stringify([ref.moduleId, ref.type, ref.id]);
export const requestBase = (channel = 'world', extra: Json = {}) => ({
  protocolVersion: 1, channel, consumerId: 'isolated-http-consumer', purpose: 'agent-perception', ...extra,
});

// All actors use real M1 registration/account/invitation APIs. Direct store
// changes below are explicit isolated source/revocation/fault fixtures only.
export async function fixture(t: TestContext, perception: BuildAppOptions['perception'] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ws02-http-')); await chmod(directory, 0o700);
  const options = { databasePath: join(directory, 'test.sqlite'),
    instanceId: `instance_${randomUUID()}`, recoveryEpoch: `epoch_${randomUUID()}`,
    email: { mode: 'experience' as const }, perception };
  let now = Date.UTC(2026, 9, 20, 0, 0, 0);
  let app = buildApp({ ...options, clock: () => now });
  t.after(async () => { try { await app.close(); } finally { await rm(directory, { recursive: true, force: true }); } });
  const m1 = (...args: Parameters<ReturnType<typeof injectApi>>) => injectApi(app)(...args);
  const owner = await ownerFixture(m1, 'WS2A');
  const a = await agentFixture(m1, owner, '合成感知甲', 'blue');
  const sibling = await agentFixture(m1, owner, '合成感知乙', 'coral');
  const otherOwner = await ownerFixture(m1, 'WS2B');
  const b = await agentFixture(m1, otherOwner, '另主感知丙', 'cream');
  const storage = <T>(work: (store: ReturnType<typeof openM1Store>) => T): T => {
    const store = openM1Store(options); try { return work(store); } finally { store.close(); }
  };
  const manifest: Json = storage(store => seedWs02DemoData(store, { actorId: 'isolated-test-administrator', now: () => now }));
  async function call(method: 'GET' | 'POST' | 'PUT', path: string, body?: Json, token: string | null = a.runtimeToken) {
    const response = await app.inject({ method, url: `/v1/perception${path}`,
      ...(body ? { payload: body } : {}), ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
    const envelope = response.json() as Json;
    assert.equal(envelope.protocolVersion, 1); assert.equal(typeof envelope.requestId, 'string');
    if (response.statusCode === 200) assert.equal(envelope.instanceId, options.instanceId);
    return { status: response.statusCode, envelope, data: envelope.data as Json, error: envelope.error as Json };
  }
  async function read(method: 'GET' | 'POST' | 'PUT', path: string, body?: Json, token: string = a.runtimeToken) {
    const response = await call(method, path, body, token);
    assert.equal(response.status, 200, `${method} ${path}: ${response.error?.code ?? 'unexpected_status'}`);
    return response.data;
  }
  const overview = (token = a.runtimeToken, extra: Json = {}) => read('POST', '/overview', {
    protocolVersion: 1, consumerId: 'isolated-http-consumer', purpose: 'agent-perception', ...extra,
  }, token);
  const metric = (data: Json, categoryId: string, metricId: string) => {
    const section = data.sections.find((item: Json) => item.categoryId === categoryId);
    assert(section, `Expected requested section ${categoryId}`);
    const value = section.metrics.find((item: Json) => item.metricId === metricId);
    assert(value, `Expected declared metric ${metricId}`); return value as Json;
  };
  async function unread(token = a.runtimeToken) {
    return metric(await overview(token, { categoryIds: ['notifications'] }), 'notifications', 'unconfirmed');
  }
  const queryState = (ref: Ref, token = a.runtimeToken) => read('POST', '/agent-read-state/query', { protocolVersion: 1, ref }, token);
  async function listAll(input: Json, token = a.runtimeToken) {
    const records: Json[] = [], pages: Json[] = []; let pageToken: string | undefined;
    for (let n = 0; n < 128; n++) {
      const page = await read('POST', '/list', { ...input, ...(pageToken ? { pageToken } : {}) }, token);
      pages.push(page); records.push(...page.records); assert.equal(page.checkpoint, null);
      if (page.complete) { assert.equal(page.nextPageToken, null); return { records, pages }; }
      assert.equal(typeof page.nextPageToken, 'string'); assert.notEqual(page.nextPageToken, pageToken); pageToken = page.nextPageToken;
    }
    assert.fail('A bounded list did not terminate');
  }
  async function detail(ref: Ref, channel = 'inbox', token = a.runtimeToken, extra: Json = {}) {
    const segments: Json[] = []; let contentToken: string | undefined, version: number | undefined;
    for (let n = 0; n < 128; n++) {
      const part = await read('POST', '/detail', { ...requestBase(channel, { purpose: 'agent-inspect' }), ref,
        ...extra, ...(contentToken ? { contentToken } : {}) }, token);
      segments.push(part); assert.equal(refKey(part.ref), refKey(ref));
      if (version === undefined) version = part.version; else assert.equal(part.version, version);
      if (part.contentComplete) { assert.equal(part.nextContentToken, null); return { segments, final: part }; }
      assert.equal(part.completionToken == null, true, 'Partial content cannot grant confirmation');
      assert.equal(typeof part.nextContentToken, 'string'); assert.notEqual(part.nextContentToken, contentToken); contentToken = part.nextContentToken;
    }
    assert.fail('A bounded detail did not terminate');
  }
  return { directory, options, owner, otherOwner, a, sibling, b, manifest, m1, storage, call, read, overview, metric, unread, queryState, listAll, detail,
    advance(milliseconds: number) { now += milliseconds; },
    async restart() { await app.close(); app = buildApp({ ...options, clock: () => now }); },
  };
}
