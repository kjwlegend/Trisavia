import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import { createM1Service, type M1Action } from '../../apps/platform/application/m1-service.ts';
import { M1_TABLES, type JsonObject, type M1Store, type M1Transaction } from '../../apps/platform/contracts/store.ts';
import { M1Error } from '../../apps/platform/domains/common/errors.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { registerM1Routes } from '../../apps/platform/transport/http/m1-routes.ts';

const op = () => randomUUID();
const token = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
const identity = { instanceId: 'assistance-test', recoveryEpoch: 'assistance-epoch' };
const rejects = (code: string, work: () => unknown) => assert.throws(work, (error) => error instanceof M1Error && error.code === code);
const snapshot = (store: M1Store) => store.read((tx) => JSON.stringify(M1_TABLES.map((table) => tx.find(table))));
function noSecrets(value: unknown, materials: string[]) {
  const serialized = JSON.stringify(value);
  for (const material of materials) assert.equal(serialized.includes(material) || serialized.includes(material.split('.')[1] ?? material), false, 'Secret material must not enter storage or a safe projection');
}
function fixture(t: TestContext, databasePath = ':memory:') {
  const store = openM1Store({ ...identity, databasePath }); t.after(() => store.close());
  let clock = 1_000_000;
  const service = createM1Service(store, { now: () => clock, recoveryRequestTtlMs: 1000 });
  const call = service.invoke;
  const ownerId = op(), sessionToken = token(), recoveryToken = token();
  call('registerOwner', { operationId: op(), attemptId: ownerId, username: `Owner_${ownerId.slice(0, 8)}`, email: `${ownerId}@example.test`, password: 'synthetic original password', sessionToken, recoveryToken, credentialsSaved: true });
  function agent() {
    const inviteToken = token(); call('issueInvite', { operationId: op(), inviteToken }, sessionToken);
    const runtimeToken = token(), registration = call('register', { operationId: op(), attemptId: op(), runtimeToken, continuationToken: token(), inviteToken });
    return { agentId: registration.agentId as string, runtimeToken };
  }
  const current = agent();
  const assistanceToken = token(), createInput = { operationId: op(), assistanceToken };
  const create = () => call('createRecoveryRequest', createInput, current.runtimeToken);
  const recoverInput = () => ({ operationId: op(), password: 'synthetic replacement password', recoveryToken: token(), sessionToken: token(), credentialsSaved: true, assistanceToken });
  return { store, service, call, ownerId, sessionToken, recoveryToken, ...current, assistanceToken, createInput, create, recoverInput, agent, advance: () => { clock += 1001; } };
}

test('assistance derives its owner from binding, rejects target selectors and remains separate from participation', (t) => {
  const f = fixture(t), snapshotBefore = snapshot(f.store);
  for (const selector of [{ ownerId: f.ownerId }, { email: 'someone@example.test' }, { agentId: f.agentId }]) rejects('invalid_request', () => f.call('createRecoveryRequest', { ...f.createInput, ...selector }, f.runtimeToken));
  assert.equal(snapshot(f.store) === snapshotBefore, true);
  const unbound = token(); f.call('register', { operationId: op(), attemptId: op(), runtimeToken: unbound, continuationToken: token() });
  rejects('owner_setup_required', () => f.call('createRecoveryRequest', { operationId: op(), assistanceToken: token() }, unbound));
  f.store.transaction((tx) => { const member = tx.get('memberships', f.agentId)!; tx.update('memberships', { ...member, version: member.version + 1, data: { ...member.data, ownerPaused: true, platformRestricted: true } }, member.version); });
  const before = f.call('self', {}, f.runtimeToken);
  assert.equal(((before.effectiveActions as JsonObject).createRecoveryRequest as JsonObject).allowed, true);
  assert.deepEqual(((before.effectiveActions as JsonObject).cancelRecoveryRequest as JsonObject).blockedBy, ['recovery_request_closed']);
  const request = f.create(); assert.equal(request.status, 'pending'); assert.equal(request.expiresAt, 1_001_000);
  assert.equal(Object.hasOwn(request, 'ownerId'), false); assert.equal(Object.hasOwn(request, 'url'), false);
  const after = f.call('self', {}, f.runtimeToken);
  assert.deepEqual(after.membership, before.membership); assert.equal((after.profile as JsonObject).published, null);
  assert.deepEqual(((after.effectiveActions as JsonObject).createRecoveryRequest as JsonObject).blockedBy, ['recovery_request_pending']);
  assert.equal(((after.effectiveActions as JsonObject).cancelRecoveryRequest as JsonObject).allowed, true);
});

test('creation has one effective pending request, independent material, safe exact receipts and read isolation', (t) => {
  const f = fixture(t), request = f.create();
  assert.deepEqual(f.create(), request);
  assert.deepEqual(f.call('receipt', { operationId: f.createInput.operationId, scope: `agent:${f.agentId}`, action: 'createRecoveryRequest' }, f.runtimeToken), request);
  rejects('recovery_request_pending', () => f.call('createRecoveryRequest', { operationId: op(), assistanceToken: token() }, f.runtimeToken));
  const sibling = f.agent();
  rejects('target_not_accessible', () => f.call('readRecoveryRequest', { requestId: request.requestId }, sibling.runtimeToken));
  rejects('target_not_accessible', () => f.call('receipt', { operationId: f.createInput.operationId, scope: `agent:${f.agentId}`, action: 'createRecoveryRequest' }, sibling.runtimeToken));
  const before = snapshot(f.store);
  assert.equal(f.call('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken).status, 'pending');
  assert.equal(f.call('recoveryAssistance', {}, f.assistanceToken).ownerId, f.ownerId);
  assert.equal(f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, f.recoveryToken).status, 'pending');
  assert.equal(snapshot(f.store) === before, true, 'Context verification and status reads must be read-only');
  noSecrets(snapshot(f.store), [f.runtimeToken, f.sessionToken, f.recoveryToken, f.assistanceToken]);
  noSecrets(request, [f.assistanceToken]);
});

test('context and runtime never replace independent owner recovery, and wrong owner proof cannot switch targets', (t) => {
  const f = fixture(t); f.create();
  const input = f.recoverInput(), before = snapshot(f.store);
  rejects('insufficient_scope', () => f.call('recover', input, f.assistanceToken));
  rejects('insufficient_scope', () => f.call('recover', input, f.runtimeToken));
  rejects('insufficient_scope', () => f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, f.sessionToken));
  const otherRecovery = token();
  f.call('registerOwner', { operationId: op(), attemptId: op(), username: 'Other_Owner', email: 'other@example.test', password: 'synthetic other password', sessionToken: token(), recoveryToken: otherRecovery, credentialsSaved: true });
  const afterOther = snapshot(f.store);
  for (const action of ['verifyRecoveryRequest', 'rejectRecoveryRequest', 'recover'] as const) rejects('target_not_accessible', () => f.call(action, action === 'recover' ? input : { assistanceToken: f.assistanceToken, ...(action === 'rejectRecoveryRequest' ? { operationId: op(), expectedVersion: 1 } : {}) }, otherRecovery));
  assert.equal(snapshot(f.store) === afterOther, true);
  assert.equal(before.length > 0, true);
});

test('assisted recovery rotates owner proofs atomically, preserves runtime and records true completion readable after restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'assistance-restart-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'm1.sqlite'), f = fixture(t, databasePath), request = f.create(), input = f.recoverInput();
  const before = f.call('self', {}, f.runtimeToken), bindings = f.store.read((tx) => tx.find('bindings'));
  const result = f.call('recover', input, f.recoveryToken);
  assert.equal(result.requestId, request.requestId);
  const committedRequest = f.store.read((tx) => tx.get('recovery_requests', request.requestId as string))!;
  assert.equal(committedRequest.data.completionOperationId, input.operationId);
  assert.equal(f.store.read((tx) => tx.find('facts', { action: 'recover', operationId: input.operationId })).length, 1);
  rejects('authentication_failed', () => f.call('readRecovery', {}, f.recoveryToken));
  rejects('authentication_failed', () => f.call('listAgents', {}, f.sessionToken));
  assert.deepEqual(f.call('receipt', { operationId: input.operationId, scope: `owner:${f.ownerId}`, action: 'recover' }, input.sessionToken), result);
  rejects('target_not_accessible', () => f.call('receipt', { operationId: input.operationId, scope: `owner:${f.ownerId}`, action: 'recover' }, f.runtimeToken));
  const after = f.call('self', {}, f.runtimeToken);
  for (const field of ['agentId', 'ownerId', 'runtimeVersion', 'profile', 'membership']) assert.deepEqual(after[field], before[field]);
  assert.deepEqual(f.store.read((tx) => tx.find('bindings')), bindings);
  assert.equal(f.call('recoveryAssistance', {}, f.assistanceToken).status, 'completed');
  assert.equal(f.call('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken).status, 'completed');
  rejects('recovery_request_closed', () => f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, input.recoveryToken));
  f.store.close(); const reopened = openM1Store({ ...identity, databasePath }); t.after(() => reopened.close());
  const again = createM1Service(reopened, { now: () => 1_000_000 }).invoke;
  assert.equal(again('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken).status, 'completed');
  assert.deepEqual(again('receipt', { operationId: input.operationId, scope: `owner:${f.ownerId}`, action: 'recover' }, input.sessionToken), result);
  noSecrets(snapshot(reopened), [f.assistanceToken, input.sessionToken, input.recoveryToken, input.password]);
});

test('cancel and owner rejection retain safe terminal state and exact receipts; recovery proof reads only its rejection receipt', (t) => {
  const f = fixture(t), first = f.create();
  rejects('version_conflict', () => f.call('cancelRecoveryRequest', { requestId: first.requestId, expectedVersion: 9, operationId: op() }, f.runtimeToken));
  const cancelInput = { requestId: first.requestId, expectedVersion: 1, operationId: op() };
  const cancelled = f.call('cancelRecoveryRequest', cancelInput, f.runtimeToken);
  assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(f.call('cancelRecoveryRequest', cancelInput, f.runtimeToken), cancelled);
  rejects('recovery_request_closed', () => f.call('recover', f.recoverInput(), f.recoveryToken));
  const assistanceToken = token(), second = f.call('createRecoveryRequest', { operationId: op(), assistanceToken }, f.runtimeToken);
  const rejectInput = { operationId: op(), expectedVersion: second.version, assistanceToken };
  const rejected = f.call('rejectRecoveryRequest', rejectInput, f.recoveryToken);
  assert.equal(rejected.status, 'cancelled'); assert.deepEqual(f.call('rejectRecoveryRequest', rejectInput, f.recoveryToken), rejected);
  const key = { operationId: rejectInput.operationId, scope: `owner:${f.ownerId}`, action: 'rejectRecoveryRequest' };
  assert.deepEqual(f.call('receipt', key, f.recoveryToken), rejected); assert.deepEqual(f.call('receipt', key, f.sessionToken), rejected);
  rejects('target_not_accessible', () => f.call('receipt', { ...key, action: 'createRecoveryRequest', operationId: f.createInput.operationId, scope: `agent:${f.agentId}` }, f.recoveryToken));
  const nextToken = token(), next = f.call('createRecoveryRequest', { operationId: op(), assistanceToken: nextToken }, f.runtimeToken);
  assert.equal(f.call('rejectRecoveryRequest', { operationId: op(), expectedVersion: next.version, assistanceToken: nextToken }, f.sessionToken).status, 'cancelled');
});

test('TTL, runtime generation, binding changes and other recovery channels invalidate pending requests without fabricating completion', (t) => {
  for (const invalidate of ['ttl', 'runtime', 'binding', 'other-recovery'] as const) {
    const f = fixture(t), request = f.create(); let activeRuntime = f.runtimeToken, activeRecovery = f.recoveryToken;
    if (invalidate === 'ttl') f.advance();
    if (invalidate === 'runtime') { activeRuntime = token(); f.call('replaceRuntime', { agentId: f.agentId, expectedVersion: 1, operationId: op(), runtimeToken: activeRuntime }, f.sessionToken); rejects('authentication_failed', () => f.call('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken)); }
    if (invalidate === 'binding') f.store.transaction((tx) => { const binding = tx.find('bindings', { agentId: f.agentId, active: true })[0]!; tx.update('bindings', { ...binding, version: binding.version + 1, data: { ...binding.data, active: false } }, binding.version); });
    if (invalidate === 'other-recovery') { const input = f.recoverInput(); activeRecovery = input.recoveryToken; const { assistanceToken: _context, ...standalone } = input; f.call('recover', standalone, f.recoveryToken); }
    assert.equal(f.call('readRecoveryRequest', { requestId: request.requestId }, activeRuntime).status, 'expired', invalidate);
    rejects('recovery_request_expired', () => f.call('recoveryAssistance', {}, f.assistanceToken));
    rejects('recovery_request_expired', () => f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, activeRecovery));
    const input = f.recoverInput(); rejects('recovery_request_expired', () => f.call('recover', input, activeRecovery));
    assert.equal(f.store.read((tx) => tx.get('recovery_requests', request.requestId as string))?.data.status, 'pending');
  }
});

test('expired requests free the pending slot but credential secrets cannot be reused across purposes', (t) => {
  const f = fixture(t), request = f.create(); f.advance();
  rejects('credential_conflict', () => f.call('createRecoveryRequest', { operationId: op(), assistanceToken: `${op()}.${f.runtimeToken.split('.')[1]}` }, f.runtimeToken));
  const next = f.call('createRecoveryRequest', { operationId: op(), assistanceToken: token() }, f.runtimeToken);
  assert.equal(next.status, 'pending'); assert.equal(next.requestId !== request.requestId, true);
});

test('failures after request creation or assisted recovery mutations roll back credentials, state, facts and receipts', (t) => {
  const f = fixture(t); let failAt = 'create';
  const failing: M1Store = { instanceId: f.store.instanceId, recoveryEpoch: f.store.recoveryEpoch, close() {}, read: (work) => f.store.read(work), transaction: (work) => f.store.transaction((tx) => work(new Proxy(tx, { get(target, key) { if (key === 'insert') return (table: string, row: unknown) => { if (table === 'facts') throw new Error(`Injected ${failAt} rollback`); return tx.insert(table as Parameters<M1Transaction['insert']>[0], row as Parameters<M1Transaction['insert']>[1]); }; return Reflect.get(target, key); } }))) };
  const call = createM1Service(failing, { now: () => 1_000_000 }).invoke;
  const before = snapshot(f.store); assert.throws(() => call('createRecoveryRequest', f.createInput, f.runtimeToken), /Injected/); assert.equal(snapshot(f.store) === before, true);
  f.create(); failAt = 'recover'; const pending = snapshot(f.store); assert.throws(() => call('recover', f.recoverInput(), f.recoveryToken), /Injected/); assert.equal(snapshot(f.store) === pending, true);
  assert.equal(f.call('readRecovery', {}, f.recoveryToken).status, 'recovery_available');
});

test('real HTTP assistance endpoints keep strict bodies, safe errors and context-only scope', async (t) => {
  const f = fixture(t), app = Fastify({ logger: false }); registerM1Routes(app, f.service); t.after(() => app.close());
  const invoke = (url: string, proof: string, payload?: JsonObject) => app.inject({ method: payload ? 'POST' : 'GET', url, headers: { authorization: `Bearer ${proof}` }, ...(payload ? { payload } : {}) });
  const created = await invoke('/v1/agent/self/owner-recovery-requests', f.runtimeToken, f.createInput); assert.equal(created.statusCode, 200);
  const context = await invoke('/v1/owner/recovery-assistance', f.assistanceToken); assert.equal(context.statusCode, 200); assert.equal(context.json().ownerId, f.ownerId);
  const verified = await invoke('/v1/owner/recovery-assistance/verify', f.recoveryToken, { assistanceToken: f.assistanceToken }); assert.equal(verified.statusCode, 200);
  const wrongScope = await invoke('/v1/owner/recoveries', f.assistanceToken, f.recoverInput()); assert.equal(wrongScope.statusCode, 403); assert.equal(wrongScope.json().error.code, 'insufficient_scope');
  const invalid = await invoke('/v1/agent/self/owner-recovery-requests', f.runtimeToken, { ...f.createInput, email: 'private@example.test' }); assert.equal(invalid.statusCode, 400);
  noSecrets([created.json(), context.json(), verified.json(), wrongScope.json(), invalid.json()], [f.assistanceToken, f.recoveryToken, f.runtimeToken, f.sessionToken, 'private@example.test']);
});

async function race(databasePath: string, commands: { action: M1Action; input: JsonObject; token: string }[]) {
  const source = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {openM1Store}=await import(workerData.storage);const {createM1Service}=await import(workerData.service);const store=openM1Store({...workerData.identity,databasePath:workerData.databasePath,busyTimeoutMs:3000});const service=createM1Service(store,{now:()=>1000000});parentPort.postMessage('ready');parentPort.once('message',()=>{try{parentPort.postMessage({result:service.invoke(workerData.command.action,workerData.command.input,workerData.command.token)});}catch(error){parentPort.postMessage({code:error.code||'unexpected'});}finally{store.close();parentPort.close();}});})();`;
  const workers = commands.map((command) => new Worker(source, { eval: true, workerData: { command, databasePath, identity, storage: new URL('../../apps/platform/infrastructure/relational/sqlite-store.ts', import.meta.url).href, service: new URL('../../apps/platform/application/m1-service.ts', import.meta.url).href } }));
  try { await Promise.all(workers.map((worker) => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); })));
    const results = workers.map((worker) => new Promise<{ result?: JsonObject; code?: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
    workers.forEach((worker) => worker.postMessage('start')); return await Promise.all(results);
  } finally { await Promise.all(workers.map((worker) => worker.terminate())); }
}

test('independent SQLite connections serialize creation and cancel-versus-recovery to one valid terminal outcome', { timeout: 15_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'assistance-race-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'm1.sqlite'), f = fixture(t, databasePath);
  const creates = await race(databasePath, [f.createInput, { operationId: op(), assistanceToken: token() }].map((input) => ({ action: 'createRecoveryRequest', input, token: f.runtimeToken })));
  assert.equal(creates.filter((entry) => entry.result).length, 1); assert.equal(creates.filter((entry) => entry.code === 'recovery_request_pending').length, 1);
  const winning = creates.find((entry) => entry.result)?.result!;
  // For the terminal race use a fresh known context after cancelling the winning creation.
  f.call('cancelRecoveryRequest', { operationId: op(), requestId: winning.requestId!, expectedVersion: 1 }, f.runtimeToken);
  const nextToken = token(), next = f.call('createRecoveryRequest', { operationId: op(), assistanceToken: nextToken }, f.runtimeToken), recover = { ...f.recoverInput(), assistanceToken: nextToken };
  const results = await race(databasePath, [{ action: 'cancelRecoveryRequest', input: { operationId: op(), requestId: next.requestId!, expectedVersion: 1 }, token: f.runtimeToken }, { action: 'recover', input: recover, token: f.recoveryToken }]);
  assert.equal(results.filter((entry) => entry.result).length, 1); assert.equal(results.filter((entry) => entry.code === 'recovery_request_closed').length, 1);
  const status = f.call('readRecoveryRequest', { requestId: next.requestId }, f.runtimeToken).status;
  assert.equal(status === 'cancelled' || status === 'completed', true);
  assert.equal(f.store.read((tx) => tx.find('facts', { action: 'recover' })).length, status === 'completed' ? 1 : 0);
  noSecrets(results, [nextToken, recover.sessionToken, recover.recoveryToken]);
});
