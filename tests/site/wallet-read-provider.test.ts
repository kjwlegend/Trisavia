import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Production browser module is intentionally plain JavaScript.
import { createWalletReadProvider } from '../../apps/web/public/hud/wallet-read-provider.js';

type Json = Record<string, any>;
type Context = { authenticated: boolean; selectedAgentId: string; observationRevision: number };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const value = (agentId: string, balance: number) => ({ protocolVersion: 1, instanceId: 'isolated-instance', permissionVersion: 'current-scope',
  data: { agentRef: { moduleId: 'profiles', type: 'profiles.agent@1', id: agentId }, accountVersion: 1,
    currency: { code: 'star_coin', displayName: '星币', scale: 0 }, balance, dataMode: 'platform', source: { kind: 'account_initialization' },
    initializationSource: 'registration', initializedAt: 1, asOf: 2 } });

// Only the constrained session and already-validated discovery seam are fakes.
// No HTTP server/success response is replaced in the browser stories.
function fixture() {
  let context: Context = { authenticated: true, selectedAgentId: 'agent-a', observationRevision: 1 };
  const changes = new Set<(next: Context) => void>(), scopes = new Set<(key: string, state: Json) => void>();
  let read: (selected: string, signal: AbortSignal) => Promise<Json> = async selected => value(selected, 0);
  let prepare: (signal: AbortSignal) => Promise<Json>;
  const inputSchema = { id: 'wallet.query-input', version: 4 };
  const metadata = { instanceId: 'isolated-instance', capabilities: { walletApi: { protocolVersion: 1, readOnly: true,
    query: { operationId: 'wallet-query', method: 'POST', path: '/v1/wallet/query' } } },
    documents: new Map([[JSON.stringify(['schema', inputSchema]), { properties: { agentRef: { type: 'object' } } }]]),
    catalog: { operations: [{ id: 'wallet-query', path: '/v1/wallet/query', method: 'POST', inputSchema }] } };
  prepare = async () => metadata;
  const session = { snapshot: () => structuredClone(context),
    subscribe(listener: (next: Context) => void) { changes.add(listener); listener(structuredClone(context)); return () => changes.delete(listener); },
    readWallet({ signal }: { signal: AbortSignal }) { return read(context.selectedAgentId, signal); } };
  const directory = { prepareOperation: (_operation: string, _module: string, { signal }: { signal: AbortSignal }) => prepare(signal),
    subscribe(listener: (key: string, state: Json) => void) { scopes.add(listener); return () => scopes.delete(listener); },
    invalidatePrivate(error: Json) { for (const listener of scopes) listener('holdings', { phase: error.status === 401 ? 'session' : 'denied', errorCode: error.code }); } };
  const provider = createWalletReadProvider(session, directory);
  return { provider, metadata,
    read(next: typeof read) { read = next; }, prepare(next: typeof prepare) { prepare = next; },
    change(next: Partial<Context>) { context = { ...context, ...next, observationRevision: context.observationRevision + 1 }; for (const listener of changes) listener(structuredClone(context)); },
    scope(key: string, state: Json) { for (const listener of scopes) listener(key, state); } };
}

test('wallet consumer distinguishes a validated persistent zero from absent, invalid or failed data and cancels hidden loading work', { timeout: 5_000 }, async () => {
  const f = fixture();
  try {
    await f.provider.load(); assert.equal(f.provider.snapshot().phase, 'ready'); assert.equal(f.provider.snapshot().data.balance, 0);
    const detached = f.provider.snapshot(); detached.data.balance = 999; assert.equal(f.provider.snapshot().data.balance, 0);
    f.read(async () => { throw Object.assign(new Error('wallet_not_initialized'), { code: 'wallet_not_initialized', status: 409 }); });
    await f.provider.load(); assert.equal(f.provider.snapshot().phase, 'not_initialized'); assert.equal(f.provider.snapshot().data, null);
    f.read(async selected => { const response: Json = value(selected, 0); delete response.data.balance; return response; });
    await f.provider.load(); assert.equal(f.provider.snapshot().phase, 'error'); assert.equal(f.provider.snapshot().data, null);
    const pending = deferred<Json>(), entered = deferred<void>(); let readCalls = 0;
    f.prepare(async () => { entered.resolve(); return pending.promise; }); f.read(async selected => { readCalls++; return value(selected, 0); });
    const loading = f.provider.load(); await entered.promise; f.provider.cancel(); pending.resolve(f.metadata); await loading;
    assert.equal(readCalls, 0, 'A closed wallet surface must not start a query after late discovery');
    assert.equal(f.provider.snapshot().data, null);
  } finally { f.provider.dispose(); }
});

test('wallet consumer clears values on subject/auth changes and ignores previous-subject or disposed late results', { timeout: 5_000 }, async () => {
  const f = fixture(), old = deferred<Json>(), entered = deferred<void>();
  try {
    f.read(async selected => { assert.equal(selected, 'agent-a'); entered.resolve(); return old.promise; });
    const first = f.provider.load(); await entered.promise;
    f.change({ selectedAgentId: 'agent-b' }); assert.equal(f.provider.snapshot().data, null);
    f.read(async selected => value(selected, 42)); await f.provider.load(); old.resolve(value('agent-a', 17)); await first;
    assert.equal(f.provider.snapshot().data.agentRef.id, 'agent-b'); assert.equal(f.provider.snapshot().data.balance, 42);
    f.scope('messages', { phase: 'denied', errorCode: 'target_not_accessible' }); assert.equal(f.provider.snapshot().data, null);
    f.change({ authenticated: false, selectedAgentId: '' }); await f.provider.load(); assert.equal(f.provider.snapshot().phase, 'session');
    assert.equal(f.provider.snapshot().data, null);
    f.change({ authenticated: true, selectedAgentId: 'agent-b' });
    const late = deferred<Json>(), reading = deferred<void>(); f.read(async () => { reading.resolve(); return late.promise; });
    const pending = f.provider.load(); await reading.promise; f.provider.dispose(); late.resolve(value('agent-b', 99)); await pending;
    assert.equal(f.provider.snapshot().data, null);
  } finally { f.provider.dispose(); }
});
