import { testStoreOptions } from './postgresql-fixture.ts';
import { openPostgresStore } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
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
import { openTestStore } from './postgresql-fixture.ts';
import { registerM1Routes } from '../../apps/platform/transport/http/m1-routes.ts';
const op = () => randomUUID();
const token = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
const identity = { instanceId: 'assistance-test', recoveryEpoch: 'assistance-epoch' };
const rejects = async (code: string, work: () => unknown) => await assert.rejects(async () => await work(), (error) => error instanceof M1Error && error.code === code);
const snapshot = async (store: M1Store) => await store.read(async (tx) => JSON.stringify(await Promise.all(M1_TABLES.map(async (table) => await tx.find(table)))));
function noSecrets(value: unknown, materials: string[]) {
    const serialized = JSON.stringify(value);
    for (const material of materials)
        assert.equal(serialized.includes(material) || serialized.includes(material.split('.')[1] ?? material), false, 'Secret material must not enter storage or a safe projection');
}
async function fixture(t: TestContext, databasePath = ':memory:') {
    const store = await openTestStore({ ...identity, databasePath });
    t.after(async () => await store.close());
    let clock = 1000000;
    const service = createM1Service(store, { now: () => clock, recoveryRequestTtlMs: 1000 });
    const call = service.invoke;
    const ownerId = op(), sessionToken = token(), recoveryToken = token();
    await call('registerOwner', { operationId: op(), attemptId: ownerId, username: `Owner_${ownerId.slice(0, 8)}`, email: `${ownerId}@example.test`, password: 'synthetic original password', sessionToken, recoveryToken, credentialsSaved: true });
    async function agent() {
        const inviteToken = token();
        await call('issueInvite', { operationId: op(), inviteToken }, sessionToken);
        const runtimeToken = token(), registration = await call('register', { operationId: op(), attemptId: op(), runtimeToken, continuationToken: token(), inviteToken });
        return { agentId: registration.agentId as string, runtimeToken };
    }
    const current = await agent();
    const assistanceToken = token(), createInput = { operationId: op(), assistanceToken };
    const create = async () => await call('createRecoveryRequest', createInput, current.runtimeToken);
    const recoverInput = () => ({ operationId: op(), password: 'synthetic replacement password', recoveryToken: token(), sessionToken: token(), credentialsSaved: true, assistanceToken });
    return { store, service, call, ownerId, sessionToken, recoveryToken, ...current, assistanceToken, createInput, create, recoverInput, agent, advance: () => { clock += 1001; } };
}
await test('assistance derives its owner from binding, rejects target selectors and remains separate from participation', async (t) => {
    const f = await fixture(t), snapshotBefore = await snapshot(f.store);
    for (const selector of [{ ownerId: f.ownerId }, { email: 'someone@example.test' }, { agentId: f.agentId }])
        await rejects('invalid_request', async () => await f.call('createRecoveryRequest', { ...f.createInput, ...selector }, f.runtimeToken));
    assert.equal(await snapshot(f.store) === snapshotBefore, true);
    const unbound = token();
    await f.call('register', { operationId: op(), attemptId: op(), runtimeToken: unbound, continuationToken: token() });
    await rejects('owner_setup_required', async () => await f.call('createRecoveryRequest', { operationId: op(), assistanceToken: token() }, unbound));
    await f.store.transaction(async (tx) => { const member = (await tx.get('memberships', f.agentId))!; await tx.update('memberships', { ...member, version: member.version + 1, data: { ...member.data, ownerPaused: true, platformRestricted: true } }, member.version); });
    const before = await f.call('self', {}, f.runtimeToken);
    assert.equal(((before.effectiveActions as JsonObject).createRecoveryRequest as JsonObject).allowed, true);
    assert.deepEqual(((before.effectiveActions as JsonObject).cancelRecoveryRequest as JsonObject).blockedBy, ['recovery_request_closed']);
    const request = await f.create();
    assert.equal(request.status, 'pending');
    assert.equal(request.expiresAt, 1001000);
    assert.equal(Object.hasOwn(request, 'ownerId'), false);
    assert.equal(Object.hasOwn(request, 'url'), false);
    const after = await f.call('self', {}, f.runtimeToken);
    assert.deepEqual(after.membership, before.membership);
    assert.equal((after.profile as JsonObject).published, null);
    assert.deepEqual(((after.effectiveActions as JsonObject).createRecoveryRequest as JsonObject).blockedBy, ['recovery_request_pending']);
    assert.equal(((after.effectiveActions as JsonObject).cancelRecoveryRequest as JsonObject).allowed, true);
});
await test('creation has one effective pending request, independent material, safe exact receipts and read isolation', async (t) => {
    const f = await fixture(t), request = await f.create();
    assert.deepEqual(await f.create(), request);
    assert.deepEqual(await f.call('receipt', { operationId: f.createInput.operationId, scope: `agent:${f.agentId}`, action: 'createRecoveryRequest' }, f.runtimeToken), request);
    await rejects('recovery_request_pending', async () => await f.call('createRecoveryRequest', { operationId: op(), assistanceToken: token() }, f.runtimeToken));
    const sibling = await f.agent();
    await rejects('target_not_accessible', async () => await f.call('readRecoveryRequest', { requestId: request.requestId }, sibling.runtimeToken));
    await rejects('target_not_accessible', async () => await f.call('receipt', { operationId: f.createInput.operationId, scope: `agent:${f.agentId}`, action: 'createRecoveryRequest' }, sibling.runtimeToken));
    const before = await snapshot(f.store);
    assert.equal((await f.call('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken)).status, 'pending');
    assert.equal((await f.call('recoveryAssistance', {}, f.assistanceToken)).ownerId, f.ownerId);
    assert.equal((await f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, f.recoveryToken)).status, 'pending');
    assert.equal(await snapshot(f.store) === before, true, 'Context verification and status reads must be read-only');
    noSecrets(await snapshot(f.store), [f.runtimeToken, f.sessionToken, f.recoveryToken, f.assistanceToken]);
    noSecrets(request, [f.assistanceToken]);
});
await test('context and runtime never replace independent owner recovery, and wrong owner proof cannot switch targets', async (t) => {
    const f = await fixture(t);
    await f.create();
    const input = f.recoverInput(), before = await snapshot(f.store);
    await rejects('insufficient_scope', async () => await f.call('recover', input, f.assistanceToken));
    await rejects('insufficient_scope', async () => await f.call('recover', input, f.runtimeToken));
    await rejects('insufficient_scope', async () => await f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, f.sessionToken));
    const otherRecovery = token();
    await f.call('registerOwner', { operationId: op(), attemptId: op(), username: 'Other_Owner', email: 'other@example.test', password: 'synthetic other password', sessionToken: token(), recoveryToken: otherRecovery, credentialsSaved: true });
    const afterOther = await snapshot(f.store);
    for (const action of ['verifyRecoveryRequest', 'rejectRecoveryRequest', 'recover'] as const)
        await rejects('target_not_accessible', async () => await f.call(action, action === 'recover' ? input : { assistanceToken: f.assistanceToken, ...(action === 'rejectRecoveryRequest' ? { operationId: op(), expectedVersion: 1 } : {}) }, otherRecovery));
    assert.equal(await snapshot(f.store) === afterOther, true);
    assert.equal(before.length > 0, true);
});
await test('assisted recovery rotates owner proofs atomically, preserves runtime and records true completion readable after restart', async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'assistance-restart-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const databasePath = join(directory, 'm1.sqlite'), f = await fixture(t, databasePath), request = await f.create(), input = f.recoverInput();
    const before = await f.call('self', {}, f.runtimeToken), bindings = await f.store.read(async (tx) => await tx.find('bindings'));
    const result = await f.call('recover', input, f.recoveryToken);
    assert.equal(result.requestId, request.requestId);
    const committedRequest = (await f.store.read(async (tx) => await tx.get('recovery_requests', request.requestId as string)))!;
    assert.equal(committedRequest.data.completionOperationId, input.operationId);
    assert.equal((await f.store.read(async (tx) => await tx.find('facts', { action: 'recover', operationId: input.operationId }))).length, 1);
    await rejects('authentication_failed', async () => await f.call('readRecovery', {}, f.recoveryToken));
    await rejects('authentication_failed', async () => await f.call('listAgents', {}, f.sessionToken));
    assert.deepEqual(await f.call('receipt', { operationId: input.operationId, scope: `owner:${f.ownerId}`, action: 'recover' }, input.sessionToken), result);
    await rejects('target_not_accessible', async () => await f.call('receipt', { operationId: input.operationId, scope: `owner:${f.ownerId}`, action: 'recover' }, f.runtimeToken));
    const after = await f.call('self', {}, f.runtimeToken);
    for (const field of ['agentId', 'ownerId', 'runtimeVersion', 'profile', 'membership'])
        assert.deepEqual(after[field], before[field]);
    assert.deepEqual(await f.store.read(async (tx) => await tx.find('bindings')), bindings);
    assert.equal((await f.call('recoveryAssistance', {}, f.assistanceToken)).status, 'completed');
    assert.equal((await f.call('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken)).status, 'completed');
    await rejects('recovery_request_closed', async () => await f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, input.recoveryToken));
    await f.store.close();
    const reopened = await openTestStore({ ...identity, databasePath });
    t.after(async () => await reopened.close());
    const again = createM1Service(reopened, { now: () => 1000000 }).invoke;
    assert.equal((await again('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken)).status, 'completed');
    assert.deepEqual(await again('receipt', { operationId: input.operationId, scope: `owner:${f.ownerId}`, action: 'recover' }, input.sessionToken), result);
    noSecrets(await snapshot(reopened), [f.assistanceToken, input.sessionToken, input.recoveryToken, input.password]);
});
await test('cancel and owner rejection retain safe terminal state and exact receipts; recovery proof reads only its rejection receipt', async (t) => {
    const f = await fixture(t), first = await f.create();
    await rejects('version_conflict', async () => await f.call('cancelRecoveryRequest', { requestId: first.requestId, expectedVersion: 9, operationId: op() }, f.runtimeToken));
    const cancelInput = { requestId: first.requestId, expectedVersion: 1, operationId: op() };
    const cancelled = await f.call('cancelRecoveryRequest', cancelInput, f.runtimeToken);
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(await f.call('cancelRecoveryRequest', cancelInput, f.runtimeToken), cancelled);
    await rejects('recovery_request_closed', async () => await f.call('recover', f.recoverInput(), f.recoveryToken));
    const assistanceToken = token(), second = await f.call('createRecoveryRequest', { operationId: op(), assistanceToken }, f.runtimeToken);
    const rejectInput = { operationId: op(), expectedVersion: second.version, assistanceToken };
    const rejected = await f.call('rejectRecoveryRequest', rejectInput, f.recoveryToken);
    assert.equal(rejected.status, 'cancelled');
    assert.deepEqual(await f.call('rejectRecoveryRequest', rejectInput, f.recoveryToken), rejected);
    const key = { operationId: rejectInput.operationId, scope: `owner:${f.ownerId}`, action: 'rejectRecoveryRequest' };
    assert.deepEqual(await f.call('receipt', key, f.recoveryToken), rejected);
    assert.deepEqual(await f.call('receipt', key, f.sessionToken), rejected);
    await rejects('target_not_accessible', async () => await f.call('receipt', { ...key, action: 'createRecoveryRequest', operationId: f.createInput.operationId, scope: `agent:${f.agentId}` }, f.recoveryToken));
    const nextToken = token(), next = await f.call('createRecoveryRequest', { operationId: op(), assistanceToken: nextToken }, f.runtimeToken);
    assert.equal((await f.call('rejectRecoveryRequest', { operationId: op(), expectedVersion: next.version, assistanceToken: nextToken }, f.sessionToken)).status, 'cancelled');
});
await test('TTL, runtime generation, binding changes and other recovery channels invalidate pending requests without fabricating completion', async (t) => {
    for (const invalidate of ['ttl', 'runtime', 'binding', 'other-recovery'] as const) {
        const f = await fixture(t), request = await f.create();
        let activeRuntime = f.runtimeToken, activeRecovery = f.recoveryToken;
        if (invalidate === 'ttl')
            f.advance();
        if (invalidate === 'runtime') {
            activeRuntime = token();
            await f.call('replaceRuntime', { agentId: f.agentId, expectedVersion: 1, operationId: op(), runtimeToken: activeRuntime }, f.sessionToken);
            await rejects('authentication_failed', async () => await f.call('readRecoveryRequest', { requestId: request.requestId }, f.runtimeToken));
        }
        if (invalidate === 'binding')
            await f.store.transaction(async (tx) => { const binding = (await tx.find('bindings', { agentId: f.agentId, active: true }))[0]!; await tx.update('bindings', { ...binding, version: binding.version + 1, data: { ...binding.data, active: false } }, binding.version); });
        if (invalidate === 'other-recovery') {
            const input = f.recoverInput();
            activeRecovery = input.recoveryToken;
            const { assistanceToken: _context, ...standalone } = input;
            await f.call('recover', standalone, f.recoveryToken);
        }
        assert.equal((await f.call('readRecoveryRequest', { requestId: request.requestId }, activeRuntime)).status, 'expired', invalidate);
        await rejects('recovery_request_expired', async () => await f.call('recoveryAssistance', {}, f.assistanceToken));
        await rejects('recovery_request_expired', async () => await f.call('verifyRecoveryRequest', { assistanceToken: f.assistanceToken }, activeRecovery));
        const input = f.recoverInput();
        await rejects('recovery_request_expired', async () => await f.call('recover', input, activeRecovery));
        assert.equal((await f.store.read(async (tx) => await tx.get('recovery_requests', request.requestId as string)))?.data.status, 'pending');
    }
});
await test('expired requests free the pending slot but credential secrets cannot be reused across purposes', async (t) => {
    const f = await fixture(t), request = await f.create();
    f.advance();
    await rejects('credential_conflict', async () => await f.call('createRecoveryRequest', { operationId: op(), assistanceToken: `${op()}.${f.runtimeToken.split('.')[1]}` }, f.runtimeToken));
    const next = await f.call('createRecoveryRequest', { operationId: op(), assistanceToken: token() }, f.runtimeToken);
    assert.equal(next.status, 'pending');
    assert.equal(next.requestId !== request.requestId, true);
});
await test('failures after request creation or assisted recovery mutations roll back credentials, state, facts and receipts', async (t) => {
    const f = await fixture(t);
    let failAt = 'create';
    const failing: M1Store = { instanceId: f.store.instanceId, recoveryEpoch: f.store.recoveryEpoch, async close() { }, read: async (work) => await f.store.read(work), transaction: async (work) => await f.store.transaction(async (tx) => await work(new Proxy(tx, { get(target, key) {
                if (key === 'insert')
                    return async (table: string, row: unknown) => {
                        if (table === 'facts')
                            throw new Error(`Injected ${failAt} rollback`);
                        return await tx.insert(table as Parameters<M1Transaction['insert']>[0], row as Parameters<M1Transaction['insert']>[1]);
                    };
                return Reflect.get(target, key);
            } }))) };
    const call = createM1Service(failing, { now: () => 1000000 }).invoke;
    const before = await snapshot(f.store);
    await assert.rejects(async () => await call('createRecoveryRequest', f.createInput, f.runtimeToken), /Injected/);
    assert.equal(await snapshot(f.store) === before, true);
    await f.create();
    failAt = 'recover';
    const pending = await snapshot(f.store);
    await assert.rejects(async () => await call('recover', f.recoverInput(), f.recoveryToken), /Injected/);
    assert.equal(await snapshot(f.store) === pending, true);
    assert.equal((await f.call('readRecovery', {}, f.recoveryToken)).status, 'recovery_available');
});
await test('real HTTP assistance endpoints keep strict bodies, safe errors and context-only scope', async (t) => {
    const f = await fixture(t), app = Fastify({ logger: false });
    registerM1Routes(app, f.service);
    t.after(async () => await app.close());
    const invoke = async (url: string, proof: string, payload?: JsonObject) => await app.inject({ method: payload ? 'POST' : 'GET', url, headers: { authorization: `Bearer ${proof}` }, ...(payload ? { payload } : {}) });
    const created = await invoke('/v1/agent/self/owner-recovery-requests', f.runtimeToken, f.createInput);
    assert.equal(created.statusCode, 200);
    const context = await invoke('/v1/owner/recovery-assistance', f.assistanceToken);
    assert.equal(context.statusCode, 200);
    assert.equal(context.json().ownerId, f.ownerId);
    const verified = await invoke('/v1/owner/recovery-assistance/verify', f.recoveryToken, { assistanceToken: f.assistanceToken });
    assert.equal(verified.statusCode, 200);
    const wrongScope = await invoke('/v1/owner/recoveries', f.assistanceToken, f.recoverInput());
    assert.equal(wrongScope.statusCode, 403);
    assert.equal(wrongScope.json().error.code, 'insufficient_scope');
    const invalid = await invoke('/v1/agent/self/owner-recovery-requests', f.runtimeToken, { ...f.createInput, email: 'private@example.test' });
    assert.equal(invalid.statusCode, 400);
    noSecrets([created.json(), context.json(), verified.json(), wrongScope.json(), invalid.json()], [f.assistanceToken, f.recoveryToken, f.runtimeToken, f.sessionToken, 'private@example.test']);
});
async function race(databasePath: string, commands: {
    action: M1Action;
    input: JsonObject;
    token: string;
}[]) {
    const options = await testStoreOptions(databasePath), stores = await Promise.all(commands.map(async () => await openPostgresStore(options)));
    try {
        return await Promise.all(stores.map(async (store, index) => { const command = commands[index]!; try {
            return { result: await createM1Service(store, { now: () => 1000000 }).invoke(command.action, command.input, command.token) };
        }
        catch (error) {
            return { code: error instanceof Error && 'code' in error ? String(error.code) : 'unexpected' };
        } }));
    }
    finally {
        await Promise.all(stores.map(async (store) => await store.close()));
    }
}
await test('independent PostgreSQL pools serialize creation and cancel-versus-recovery to one valid terminal outcome', { timeout: 15000 }, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'assistance-race-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const databasePath = join(directory, 'm1.sqlite'), f = await fixture(t, databasePath);
    const creates = await race(databasePath, [f.createInput, { operationId: op(), assistanceToken: token() }].map((input) => ({ action: 'createRecoveryRequest', input, token: f.runtimeToken })));
    assert.equal(creates.filter((entry) => entry.result).length, 1);
    assert.equal(creates.filter((entry) => entry.code === 'recovery_request_pending').length, 1);
    const winning = creates.find((entry) => entry.result)?.result!;
    // For the terminal race use a fresh known context after cancelling the winning creation.
    await f.call('cancelRecoveryRequest', { operationId: op(), requestId: winning.requestId!, expectedVersion: 1 }, f.runtimeToken);
    const nextToken = token(), next = await f.call('createRecoveryRequest', { operationId: op(), assistanceToken: nextToken }, f.runtimeToken), recover = { ...f.recoverInput(), assistanceToken: nextToken };
    const results = await race(databasePath, [{ action: 'cancelRecoveryRequest', input: { operationId: op(), requestId: next.requestId!, expectedVersion: 1 }, token: f.runtimeToken }, { action: 'recover', input: recover, token: f.recoveryToken }]);
    assert.equal(results.filter((entry) => entry.result).length, 1);
    assert.equal(results.filter((entry) => entry.code === 'recovery_request_closed').length, 1);
    const status = (await f.call('readRecoveryRequest', { requestId: next.requestId }, f.runtimeToken)).status;
    assert.equal(status === 'cancelled' || status === 'completed', true);
    assert.equal((await f.store.read(async (tx) => await tx.find('facts', { action: 'recover' }))).length, status === 'completed' ? 1 : 0);
    noSecrets(results, [nextToken, recover.sessionToken, recover.recoveryToken]);
});
