import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
// @ts-expect-error The actual HUD consumer is intentionally a browser JS module.
import { createWorldReadProvider } from '../../apps/web/public/hud/world-read-provider.js';

type Json = Record<string, any>;
type SessionState = { authenticated: boolean; selectedAgentId: string; observationRevision: number };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const envelope = (data: Json, permissionVersion = 'permission-current') => ({ protocolVersion: 1, instanceId: 'synthetic-instance', permissionVersion, data });
const record = (id: string) => ({ ref: { moduleId: 'mailbox', type: 'mailbox.message@1', id }, version: 1, summary: { title: id }, detailAvailable: true });

// The only fake is the controller's constrained transport/session boundary.
// Tests call the production provider; permission decisions and DOM behavior are
// deliberately left to the real-HTTP/browser checks and independent review.
function fixture() {
  let state: SessionState = { authenticated: true, selectedAgentId: 'synthetic-agent-a', observationRevision: 1 };
  const listeners = new Set<(value: SessionState) => void>(), calls: { operation: string; input: Json; signal?: AbortSignal }[] = [];
  let work: (operation: string, input: Json, signal?: AbortSignal) => Promise<Json> = async operation => {
    throw new Error(`Unexpected test transport operation: ${operation}`);
  };
  const schema = { id: 'test.input', version: 3 }, output = { id: 'test.output', version: 3 };
  const sources = ['holdings', 'direct-mail', 'demo-items', 'demo-announcements', 'demo-events', 'platform-publications'].map(sourceId => ({ sourceId, state: 'enabled' }));
  const catalog = { catalogRevision: 'test-catalog', skillCatalogRevision: 'test-skills', worlds: [], types: [], skills: [], sources,
    categories: [
      { categoryId: 'holdings', channel: 'inventory', sourceIds: ['holdings'] },
      { categoryId: 'notifications', channel: 'inbox', sourceIds: ['direct-mail'] },
      { categoryId: 'items', channel: 'world', sourceIds: ['demo-items'] },
      { categoryId: 'announcements', channel: 'world', sourceIds: ['demo-announcements'] },
      { categoryId: 'events', channel: 'world', sourceIds: ['demo-events', 'platform-publications'] },
    ], modules: ['inventory', 'mailbox', 'items', 'world'].map(moduleId => ({ moduleId, usageGuide: { moduleId, version: 3 } })),
    operations: ['list', 'detail'].map(id => ({ id, method: 'POST', path: `/v1/perception/${id}`, inputSchema: schema, outputSchema: output })),
    complete: true, nextPageToken: null };
  const session = {
    snapshot: () => structuredClone(state),
    subscribe(listener: (value: SessionState) => void) { listeners.add(listener); listener(structuredClone(state)); return () => listeners.delete(listener); },
    async readPerception(operation: string, input: Json, { signal }: { signal?: AbortSignal }) {
      calls.push({ operation, input: structuredClone(input), ...(signal ? { signal } : {}) });
      if (operation === 'capabilities') return work(operation, input, signal).catch(error => {
        if (error.message !== 'use-default-capabilities') throw error;
        return { instanceId: 'synthetic-instance', perception: true, perceptionApi: { protocolVersion: 1,
          catalogRevision: catalog.catalogRevision, skillCatalogRevision: catalog.skillCatalogRevision,
          ownerObservation: { agentRefRequired: true, inventory: true, inbox: 'source-authorized' } } };
      });
      if (operation === 'discovery') return envelope(structuredClone(catalog));
      if (operation === 'guide' || operation === 'schema') {
        const document = operation === 'schema' ? { type: 'object', properties: { agentRef: { type: 'object' } } } : { manual: true };
        const canonicalDocument = JSON.stringify(document), digest = createHash('sha256').update(canonicalDocument).digest('hex');
        return envelope({ document, canonicalDocument, digest, version: 3 });
      }
      return work(operation, input, signal);
    },
  };
  const provider = createWorldReadProvider(session);
  return { provider, calls, catalog,
    transport(next: typeof work) { work = async (operation, input, signal) => operation === 'capabilities'
      ? Promise.reject(new Error('use-default-capabilities')) : next(operation, input, signal); },
    rawTransport(next: typeof work) { work = next; },
    change(next: Partial<typeof state>) { state = { ...state, ...next, observationRevision: state.observationRevision + 1 }; for (const listener of listeners) listener(structuredClone(state)); },
  };
}

test('the real owner provider retains only explicitly partial pages and clears data on denied/no-Agent contexts', async () => {
  const f = fixture();
  try {
    f.transport(async (_operation, input) => {
      if (input.pageToken) throw Object.assign(new Error('source_unavailable'), { code: 'source_unavailable', status: 503 });
      return envelope({ channel: 'inbox', categoryId: 'notifications', records: [record('authorized-message')], complete: false, nextPageToken: 'next-page' });
    });
    await f.provider.load('notifications'); await f.provider.load('notifications', { more: true });
    const partial = f.provider.snapshot('notifications');
    assert.equal(partial.phase, 'partial'); assert.equal(partial.complete, false); assert.equal(partial.records[0].ref.id, 'authorized-message');
    f.transport(async () => { throw Object.assign(new Error('insufficient_scope'), { code: 'insufficient_scope', status: 403 }); });
    await f.provider.load('notifications'); assert.equal(f.provider.snapshot('notifications').phase, 'denied');
    assert.deepEqual(f.provider.snapshot('notifications').records, []);
    f.change({ selectedAgentId: '' }); await f.provider.load('holdings');
    assert.equal(f.provider.snapshot('holdings').phase, 'no_agent');
    f.transport(async () => envelope({ channel: 'world', categoryId: 'items', records: [], complete: true, nextPageToken: null }));
    await f.provider.load('items'); assert.equal(f.provider.snapshot('items').phase, 'ready'); assert.equal(f.provider.snapshot('items').complete, true);
  } finally { f.provider.dispose(); }
});

test('closing cancels actual provider work before discovery and old subject/list completions cannot repopulate a new context', async () => {
  const f = fixture(), cap = deferred<Json>(), entered = deferred<void>();
  try {
    f.rawTransport(async operation => { assert.equal(operation, 'capabilities'); entered.resolve(); return cap.promise; });
    const pending = f.provider.load('holdings'); await entered.promise; f.provider.cancel('holdings');
    assert.equal(f.calls[0]!.signal?.aborted, true);
    cap.resolve({ perception: true, instanceId: 'synthetic-instance', perceptionApi: { protocolVersion: 1 } });
    await pending; assert.deepEqual(f.calls.map(call => call.operation), ['capabilities'], 'A hidden panel cannot start discovery/list/detail after a late capability response');
    assert.deepEqual(f.provider.snapshot('holdings').records, []);
    const delayed = deferred<Json>(), listEntered = deferred<void>();
    f.transport(async () => { listEntered.resolve(); return delayed.promise; });
    const old = f.provider.load('notifications'); await listEntered.promise;
    f.change({ selectedAgentId: 'synthetic-agent-b' }); assert.deepEqual(f.provider.snapshot('notifications').records, []);
    f.transport(async () => envelope({ channel: 'inbox', categoryId: 'notifications', records: [record('current-b')], complete: true, nextPageToken: null }));
    await f.provider.load('notifications');
    delayed.resolve(envelope({ channel: 'inbox', categoryId: 'notifications', records: [record('old-a')], complete: true, nextPageToken: null }));
    await old; assert.deepEqual(f.provider.snapshot('notifications').records.map((row: Json) => row.ref.id), ['current-b']);
    f.change({ authenticated: false, selectedAgentId: '' });
    assert.equal(f.provider.snapshot('notifications').phase, 'session'); assert.deepEqual(f.provider.snapshot('notifications').records, []);
  } finally { f.provider.dispose(); }
});

test('the production detail consumer assembles exact same-version segments and rejects revision or subject changes without publishing a partial body', async () => {
  const f = fixture(), target = record('segmented');
  const part = (input: Json, version = 1) => envelope({ ref: target.ref, version, readSessionId: 'one-read',
    content: { text: input.contentToken ? '后半' : '前半' }, segment: { unit: 'utf16-code-units', start: input.contentToken ? 2 : 0,
      end: input.contentToken ? 4 : 2, total: 4 }, contentComplete: Boolean(input.contentToken), nextContentToken: input.contentToken ? null : 'body-next' });
  try {
    f.transport(async (_operation, input) => part(input));
    assert.equal((await f.provider.detail('notifications', target)).content.text, '前半后半');
    assert.deepEqual(f.calls.filter(call => call.operation === 'detail').map(call => call.input.knownVersion), [1, 1]);
    f.transport(async (_operation, input) => part(input, input.contentToken ? 2 : 1));
    await assert.rejects(f.provider.detail('notifications', target), (error: Json) => error.code === 'content_changed');
    const continuation = deferred<Json>(), entered = deferred<void>();
    f.transport(async (_operation, input) => { if (!input.contentToken) return part(input); entered.resolve(); return continuation.promise; });
    const old = f.provider.detail('notifications', target); await entered.promise;
    f.change({ selectedAgentId: 'synthetic-agent-b' }); continuation.resolve(part({ contentToken: 'body-next' }));
    await assert.rejects(old, (error: Error) => error.name === 'AbortError');
    assert.equal(f.calls.some(call => /confirm|reader-state/.test(call.operation)), false);
  } finally { f.provider.dispose(); }
});
