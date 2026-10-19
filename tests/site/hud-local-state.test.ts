import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
// @ts-expect-error Browser module is intentionally plain JS.
import { createLocalHudState } from '../../apps/web/public/hud/local-state.js';
// @ts-expect-error Browser module is intentionally plain JS.
import { createHudContextBridge } from '../../apps/web/public/hud/context.js';
// @ts-expect-error Browser module is intentionally plain JS.
import { createDemoProvider, DEMO_SOURCE } from '../../apps/web/public/hud/demo-provider.js';

type Json = Record<string, any>;
const scope = { origin: 'https://synthetic.example.test', instanceId: 'synthetic-instance', kind: 'owner',
  ownerId: 'synthetic-owner', agentId: 'synthetic-agent', ...DEMO_SOURCE };
function storage() {
  const values = new Map<string, string>([['unrelated.preference', 'keep']]), writes: string[] = [];
  return { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { writes.push(key); values.set(key, value); },
    removeItem() { assert.fail('Demo state must not remove storage namespaces'); },
    clear() { assert.fail('Demo state must not clear browser storage'); } };
}
function session(identity: Json | null = null) {
  let value = identity; const listeners = new Set<() => void>();
  return { hudContext: () => value, subscribe(listener: () => void) { listeners.add(listener); listener(); return () => listeners.delete(listener); },
    update(next: Json | null) { value = next; for (const listener of listeners) listener(); }, get subscribers() { return listeners.size; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('human demo views and read/hide/undo survive reconstruction without persisting source content or sharing mutable snapshots', () => {
  const backing = storage(), first = createLocalHudState({ storage: backing }); first.setContext(scope);
  const lease = first.lease();
  assert.equal(first.inventory(lease, { category: 'artwork', query: '纪念', selectedId: 'item-2', scrollTop: 315 }), true);
  assert.equal(first.mailView(lease, { channel: 'private', read: 'unread', pending: true, selectedId: 'private-2', scrollTop: 260 }), true);
  assert.equal(first.markRead(lease, 'private', 'private-1'), true); first.markRead(lease, 'private', 'private-1');
  assert.equal(first.hideMessage(lease, 'private', 'private-2'), true);
  assert.equal(first.mailView(lease, { channel: 'world', read: 'read', selectedId: 'world-1', scrollTop: 120 }), true);
  assert.equal(first.markRead(lease, 'world', 'world-1'), true);
  const before = first.snapshot(); assert.deepEqual(before.state.mail.readIds.private, ['private-1']);
  assert.equal(before.state.mail.selectedIds.private, '', 'Hiding the selected row clears only its selection');
  assert.equal(before.state.mail.filters.private.pending, true); assert.equal('pending' in before.state.mail.filters.world, false);
  const second = createLocalHudState({ storage: backing }); second.setContext(scope);
  assert.deepEqual(second.snapshot().state, before.state); assert.equal(second.snapshot().persistence, 'saved');
  assert.equal(second.restoreMessage(second.lease(), 'private', 'private-2'), true);
  second.markRead(second.lease(), 'private', 'private-1', false);
  const third = createLocalHudState({ storage: backing }); third.setContext(scope);
  assert.deepEqual(third.snapshot().state.mail.hiddenIds.private, []); assert.deepEqual(third.snapshot().state.mail.readIds.private, []);
  assert.deepEqual(third.snapshot().state.mail.readIds.world, ['world-1']);
  assert.deepEqual(third.snapshot().state.inventory, before.state.inventory);
  const exposed = third.snapshot(); exposed.state.inventory.query = 'external mutation'; exposed.scope.ownerId = 'other';
  assert.equal(third.snapshot().state.inventory.query, '纪念'); assert.equal(third.snapshot().scope.ownerId, scope.ownerId);
  const unsubscribe = third.subscribe((value: Json) => { value.state.inventory.selectedId = 'listener mutation'; });
  assert.equal(third.snapshot().state.inventory.selectedId, 'item-2'); unsubscribe();
  const raw = JSON.parse(backing.values.get(backing.writes[0]!)!);
  assert.deepEqual(Object.keys(raw).sort(), ['format', 'scope', 'state']);
  assert.deepEqual(Object.keys(raw.state).sort(), ['inventory', 'mail']);
  assert.equal(first.inventory(lease, { query: 'allowed', runtimeToken: 'must-not-store' }), false);
  assert.equal(JSON.stringify([...backing.values]).includes('must-not-store'), false);
  assert.equal(backing.values.get('unrelated.preference'), 'keep');
});

test('every origin/instance/identity/source axis isolates persisted views and null or disposed contexts reject old leases', () => {
  const backing = storage(), state = createLocalHudState({ storage: backing }); state.setContext(scope);
  const originalLease = state.lease(); state.markRead(originalLease, 'private', 'message-a');
  const originalKey = backing.writes[0]!;
  const variants = [{ origin: 'https://other.example.test' }, { instanceId: 'other-instance' }, { ownerId: 'other-owner' },
    { agentId: 'other-agent' }, { sourceId: 'other-source' }, { sourceVersion: '3' }, { kind: 'guest', ownerId: '', agentId: '' }];
  for (const change of variants) {
    state.setContext({ ...scope, ...change }); assert.deepEqual(state.snapshot().state.mail.readIds.private, []);
    assert.equal(state.markRead(originalLease, 'private', 'stale-write'), false);
    state.markRead(state.lease(), 'world', 'own-context');
  }
  assert.equal(new Set(backing.writes).size, variants.length + 1);
  state.setContext(scope); assert.deepEqual(state.snapshot().state.mail.readIds.private, ['message-a']);
  assert.deepEqual(state.snapshot().state.mail.readIds.world, []);
  const current = state.lease(); state.setContext({ ...scope }); assert.deepEqual(state.lease(), current, 'The same scope keeps the live view lease');
  const saved = backing.values.get(originalKey); state.setContext(null);
  assert.equal(state.snapshot().scope, null); assert.deepEqual(state.snapshot().state.mail.readIds.private, []);
  assert.equal(state.hideMessage(current, 'private', 'message-a'), false);
  assert.equal(backing.values.get(originalKey), saved, 'Losing authentication does not destroy another persisted namespace');
  state.setContext(scope); assert.equal(state.markRead(current, 'private', 'replayed-after-return'), false, 'Returning to a key does not revive an old generation');
  assert.deepEqual(state.snapshot().state.mail.readIds.private, ['message-a']);
  state.dispose(); assert.equal(state.snapshot().scope, null); assert.equal(state.inventory(state.lease(), { query: 'after dispose' }), false);
  assert.equal(backing.values.get('unrelated.preference'), 'keep');
});

test('malformed or unavailable storage and invalid mutations have a bounded local-only fallback', () => {
  const backing = storage(), seed = createLocalHudState({ storage: backing }); seed.setContext(scope); seed.markRead(seed.lease(), 'private', 'known');
  const key = backing.writes[0]!;
  for (const raw of ['{broken', 'x'.repeat(65537), JSON.stringify({ format: 'wrong', scope, state: {} }), JSON.stringify({ format: 'connet-hud-demo-v1', scope: { ...scope, ownerId: 'other' }, state: { inventory: { query: 'cross-owner' } } })]) {
    backing.values.set(key, raw); const state = createLocalHudState({ storage: backing }); state.setContext(scope);
    assert.equal(state.snapshot().state.inventory.query, ''); assert.deepEqual(state.snapshot().state.mail.readIds.private, []);
    assert.equal(backing.values.get(key), raw, 'Reading corrupt data does not rewrite or delete it');
  }
  backing.values.set(key, JSON.stringify({ format: 'connet-hud-demo-v1', scope, state: {
    inventory: { category: 'unknown', query: 'x'.repeat(101), scrollTop: 9e9, body: 'must-not-copy' },
    mail: { filters: { world: { read: 'unread', pending: true } }, readIds: { private: ['known', 'known', null, 'bad\nref'] },
      hiddenIds: { private: ['hidden'] }, agentCursor: 'must-not-copy' }, ownerSession: 'must-not-copy' } }));
  const recovered = createLocalHudState({ storage: backing }); recovered.setContext(scope);
  const cleaned = recovered.snapshot().state; assert.equal(cleaned.inventory.category, 'all'); assert.equal(cleaned.inventory.query, ''); assert.equal(cleaned.inventory.scrollTop, 1_000_000);
  assert.deepEqual(cleaned.mail.readIds.private, ['known']); assert.equal('pending' in cleaned.mail.filters.world, false); assert.equal(JSON.stringify(cleaned).includes('must-not-copy'), false);
  const before = JSON.stringify(cleaned), writes = backing.writes.length, lease = recovered.lease();
  assert.equal(recovered.inventory(lease, { scrollTop: -1 }), false); assert.equal(recovered.mailView(lease, { channel: 'world', pending: true }), false);
  assert.equal(recovered.mailView(lease, { read: 'unread', agentCursor: 'forbidden' }), false); assert.equal(recovered.markRead(lease, 'private', 'bad\nref'), false);
  assert.equal(JSON.stringify(recovered.snapshot().state), before); assert.equal(backing.writes.length, writes);
  const unavailable = createLocalHudState({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } } });
  unavailable.setContext(scope); assert.equal(unavailable.markRead(unavailable.lease(), 'private', 'memory-only'), true);
  assert.deepEqual(unavailable.snapshot().state.mail.readIds.private, ['memory-only']); assert.equal(unavailable.snapshot().persistence, 'memory');
  unavailable.setContext({ ...scope, agentId: 'other' }); assert.deepEqual(unavailable.snapshot().state.mail.readIds.private, []);
});

test('the real context bridge uses the latest verified identity, rejects late disposal and keeps human preferences separate from source records', async t => {
  const records = JSON.parse(readFileSync(new URL('../../apps/web/public/hud/demo-fixtures.json', import.meta.url), 'utf8'));
  const original = JSON.stringify(records), fetches: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, options: Json = {}) => {
    fetches.push(String(input)); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response(JSON.stringify(records), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const provider = createDemoProvider(), loaded = await provider.load(); assert(loaded);
  assert.equal(loaded.sourceId, DEMO_SOURCE.sourceId); assert.equal(loaded.sourceVersion, DEMO_SOURCE.sourceVersion);
  const identity = session({ kind: 'owner', ownerId: 'owner-a', agentId: 'agent-a', email: 'must-not-project', sessionToken: 'must-not-project' });
  const read = deferred<Json>(); let reads = 0;
  const bridge = createHudContextBridge(identity, { origin: scope.origin, ...DEMO_SOURCE, readInstance: () => { reads++; return read.promise; } });
  const local = createLocalHudState({ storage: storage() }), phases: string[] = [];
  bridge.subscribe((value: Json) => { phases.push(value.phase); local.setContext(value.scope); });
  t.after(() => bridge.dispose()); const loading = bridge.load(); void bridge.load(); await Promise.resolve(); assert.equal(reads, 1);
  identity.update({ kind: 'owner', ownerId: 'owner-b', agentId: 'agent-b' }); read.resolve({ instanceId: 'real-capability-instance' }); await loading;
  assert.equal(bridge.snapshot().phase, 'ready'); assert.equal(bridge.snapshot().scope.ownerId, 'owner-b');
  assert.equal(bridge.snapshot().scope.instanceId, 'real-capability-instance');
  identity.update({ kind: 'owner', ownerId: 'owner-a', agentId: 'agent-a', email: 'must-not-project', sessionToken: 'must-not-project' });
  assert.equal(bridge.snapshot().scope.ownerId, 'owner-a'); assert.equal(JSON.stringify(bridge.snapshot()).includes('must-not-project'), false);
  identity.update({ kind: 'owner', ownerId: 'owner-b', agentId: 'agent-b' });
  const lease = local.lease(), message = loaded.messages[0].id;
  local.markRead(lease, 'private', message); local.hideMessage(lease, 'private', message);
  assert.equal(JSON.stringify(loaded), original); assert.equal((await provider.load()), loaded); assert.equal(fetches.length, 1, 'Local human read/hide triggers no network or Agent cursor write');
  identity.update(null); assert.equal(bridge.snapshot().phase, 'pending'); assert.equal(local.snapshot().scope, null); assert.equal(local.markRead(lease, 'private', message), false);
  identity.update({ kind: 'guest', ownerId: '', agentId: '' }); assert.equal(bridge.snapshot().scope.kind, 'guest'); assert.deepEqual(local.snapshot().state.mail.readIds.private, []);
  identity.update({ kind: 'owner', ownerId: 'owner-b', agentId: 'agent-b' }); assert.deepEqual(local.snapshot().state.mail.readIds.private, [message]);
  const late = deferred<Json>(), disposed = createHudContextBridge(identity, { origin: scope.origin, ...DEMO_SOURCE, readInstance: () => late.promise });
  const waiting = disposed.load(); disposed.dispose(); late.resolve({ instanceId: 'too-late' }); await waiting;
  assert.equal(disposed.snapshot().scope, null); assert.equal(disposed.snapshot().phase, 'pending');
  const failed = createHudContextBridge(identity, { origin: scope.origin, ...DEMO_SOURCE, readInstance: () => ({ instanceId: '' }) });
  await failed.load(); assert.equal(failed.snapshot().phase, 'error'); assert.equal(failed.snapshot().scope, null); failed.dispose();
  assert(phases.includes('loading') && phases.includes('pending') && phases.includes('ready'));
  const invalidSource = createDemoProvider(); records.sourceVersion = 'wrong'; assert.equal(await invalidSource.load(), null);
});
