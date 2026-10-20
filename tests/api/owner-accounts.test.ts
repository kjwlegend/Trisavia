import { testStoreOptions } from './postgresql-fixture.ts';
import { openPostgresStore } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { testApplication as buildApp } from './postgresql-fixture.ts';
import { createM1Service, type M1Action, type M1Options } from '../../apps/platform/application/m1-service.ts';
import { accountFields, email, username } from '../../apps/platform/domains/access/account-identifiers.ts';
import { M1Error } from '../../apps/platform/domains/common/errors.ts';
import { openTestStore } from './postgresql-fixture.ts';
import type { JsonObject } from '../../apps/platform/contracts/store.ts';
const proof = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
const op = () => randomUUID();
const password = 'synthetic account password 123';
const identity = { instanceId: 'account-test-instance', recoveryEpoch: 'account-test-epoch' };
const error = async (code: string, work: () => unknown) => await assert.rejects(async () => await work(), (value) => value instanceof M1Error && value.code === code);
const str = (value: JsonObject, key: string) => { assert.equal(typeof value[key], 'string'); return value[key] as string; };
async function fixture(t: TestContext, options: M1Options = {}, databasePath = ':memory:') {
    const store = await openTestStore({ ...identity, databasePath });
    t.after(async () => await store.close());
    const service = createM1Service(store, { now: () => 1000000, ...options });
    return { store, service, call: service.invoke };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function account(f: Fixture, fields: Partial<{
    username: string;
    email: string;
}> = {}) {
    const input = { operationId: op(), attemptId: randomUUID(), username: `User_${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true, ...fields };
    const result = await f.call('registerOwner', input);
    return { input, result, ownerId: str(result, 'ownerId'), sessionToken: input.sessionToken, recoveryToken: input.recoveryToken };
}
async function agent(f: Fixture, inviteToken?: string) {
    const input = { operationId: op(), attemptId: randomUUID(), runtimeToken: proof(), continuationToken: proof(), ...(inviteToken ? { inviteToken } : {}) };
    const result = await f.call('register', input);
    return { input, result, agentId: str(result, 'agentId'), ownerId: str(result, 'ownerId') };
}
type Agent = Awaited<ReturnType<typeof agent>>;
async function handoff(f: Fixture, resident: Agent) {
    const handoffToken = proof();
    const result = await f.call('issueHandoff', { operationId: op(), expectedGeneration: 0, handoffToken }, resident.input.continuationToken);
    return { handoffToken, generation: result.generation as number };
}
async function setup(f: Fixture, resident: Agent) {
    const source = await handoff(f, resident), setupToken = proof();
    await f.call('exchangeSetup', { operationId: op(), setupToken }, source.handoffToken);
    return { ...source, setupToken };
}
async function managedAccount(f: Fixture) {
    const resident = await agent(f), material = await setup(f, resident);
    const sessionToken = proof(), recoveryToken = proof();
    const username = `Setup_${randomUUID().slice(0, 8)}`, email = `${randomUUID()}@example.test`;
    await f.call('completeSetup', { operationId: op(), username, email, password, sessionToken, recoveryToken, credentialsSaved: true }, material.setupToken);
    return { ...resident, username, email, sessionToken, recoveryToken };
}
async function receipt(f: Fixture, operationId: string, scope: string, action: string, token: string) {
    return await f.call('receipt', { operationId, scope, action }, token);
}
async function login(f: Fixture, identifier: string, secret = password) {
    const input = { operationId: op(), identifier, password: secret, sessionToken: proof() };
    return { input, result: await f.call('login', input) };
}
async function recover(f: Fixture, token: string) {
    const input = { operationId: op(), password: 'synthetic replacement password 456', recoveryToken: proof(), sessionToken: proof(), credentialsSaved: true };
    return { input, result: await f.call('recover', input, token) };
}
await test('account identifiers implement exact ASCII username normalization and common email grammar', async () => {
    assert.deepEqual(username('  ＡＢ_１２  '), { username: 'AB_12', usernameKey: 'ab_12' });
    for (const value of ['ab', '__', 'A'.repeat(32)])
        assert.equal(username(value).username, value);
    for (const value of ['中文', 'Ab中文', 'a', 'a'.repeat(33), 'a b', 'a@b', 'a-b', '😀x', 'éx'])
        await error('invalid_request', () => username(value));
    assert.deepEqual(email(' User.Name+Tag@Example.TEST '), { email: 'User.Name+Tag@Example.TEST', emailKey: 'user.name+tag@example.test' });
    for (const value of ["a!#$%&'*+-/=?^_`{|}~b@example.test", 'x@a-b.example', 'a@123.example'])
        assert.equal(email(value).emailKey, value);
    for (const value of ['x', 'a@@example.test', 'a@localhost', '.a@example.test', 'a.@example.test', 'a..b@example.test', 'a b@example.test', '名字@example.test', 'a@-x.test', 'a@x-.test', 'a@x.123', 'a@x..test', 'a'.repeat(65) + '@example.test', 'a@' + 'x'.repeat(64) + '.test', 'a@' + Array(4).fill('x'.repeat(63)).join('.')])
        await error('invalid_request', () => email(value));
    assert.notEqual(email('a.b+tag@example.test').emailKey, email('ab@example.test').emailKey);
    assert.equal(accountFields('Ab', 'a@example.test').emailVerified, false);
});
await test('V01/V07: independent signup is atomic, resumable by pre-saved session and starts with no Agent', async (t) => {
    const f = await fixture(t);
    const input = { operationId: op(), attemptId: randomUUID(), username: 'New_User', email: 'New@Example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true };
    await error('authentication_failed', async () => await receipt(f, input.operationId, `owner-registration:${input.attemptId}`, 'registerOwner', input.sessionToken));
    await error('invalid_request', async () => await f.call('registerOwner', { ...input, credentialsSaved: false }));
    assert.equal(await f.store.read(async (tx) => (await tx.find('owners')).length), 0);
    const result = await f.call('registerOwner', input);
    assert.equal(result.ownerId, input.attemptId);
    assert.deepEqual(await f.call('registerOwner', input), result);
    assert.deepEqual(await receipt(f, input.operationId, `owner-registration:${input.attemptId}`, 'registerOwner', input.sessionToken), result);
    await error('idempotency_payload_mismatch', async () => await f.call('registerOwner', { ...input, username: 'Changed' }));
    await error('account_id_conflict', async () => await f.call('registerOwner', { ...input, operationId: op() }));
    await error('authentication_failed', async () => await f.call('registerOwner', { ...input, sessionToken: proof() }));
    assert.deepEqual((await f.call('listAgents', {}, input.sessionToken)).agents, []);
    const privateAccount = await f.call('readAccount', {}, input.sessionToken);
    assert.equal(privateAccount.username, 'New_User');
    assert.equal(privateAccount.email, 'New@Example.test');
    assert.equal(privateAccount.emailVerified, false);
    assert.equal(JSON.stringify(result).includes('New@Example.test'), false);
    assert.equal(await f.store.read(async (tx) => (await tx.find('owners')).length), 1);
    assert.equal(await f.store.read(async (tx) => (await tx.find('credentials')).length), 2);
    assert.equal(await f.store.read(async (tx) => (await tx.find('facts')).length), 1);
});
await test('V01: username and email login share identity; UUID login is rejected and receipt scope is known before login', async (t) => {
    const f = await fixture(t), owner = await account(f, { username: 'English_12', email: 'My.User+Tag@Example.test' });
    for (const value of [' english_12 ', 'ＥＮＧＬＩＳＨ_１２', ' MY.USER+TAG@EXAMPLE.TEST ']) {
        const current = await login(f, value);
        assert.equal(current.result.ownerId, owner.ownerId);
        assert.deepEqual(await receipt(f, current.input.operationId, `owner-login:${current.input.sessionToken.split('.')[0]}`, 'login', current.input.sessionToken), current.result);
        assert.deepEqual(await f.call('login', current.input), current.result);
    }
    for (const identifier of [owner.ownerId, 'unknown_user', 'unknown@example.test', '中文', 'a@bad'])
        await error('authentication_failed', async () => await login(f, identifier));
    await error('authentication_failed', async () => await login(f, owner.input.username, 'incorrect password 123'));
    const oldInput = { operationId: op(), ownerId: owner.ownerId, password, sessionToken: proof() };
    await error('invalid_request', async () => await f.call('login', oldInput));
    await error('invalid_request', async () => await f.call('login', { ...oldInput, identifier: owner.input.username }));
});
await test('V06: conflicts and invalid fields never leave owner credentials or claim a known owner ID', async (t) => {
    const f = await fixture(t), first = await account(f, { username: 'Same_12', email: 'same@example.test' });
    const sizes = async () => await f.store.read(async (tx) => await Promise.all((['owners', 'credentials', 'operations', 'facts'] as const).map(async (table) => (await tx.find(table)).length)));
    const before = await sizes();
    for (const [fields, code] of [
        [{ username: 'ＳＡＭＥ_１２' }, 'username_unavailable'], [{ email: ' SAME@EXAMPLE.TEST ' }, 'email_unavailable'],
        [{ username: '中文' }, 'invalid_request'], [{ username: 'Mixed中文' }, 'invalid_request'], [{ email: 'bad' }, 'invalid_request'],
    ] as const)
        await error(code, async () => await account(f, fields));
    assert.deepEqual(await sizes(), before);
    const unbound = await agent(f);
    await error('account_id_conflict', async () => await f.call('registerOwner', { ...first.input, attemptId: unbound.ownerId, operationId: op() }));
    assert.equal(await f.store.read(async (tx) => (await tx.get('owners', unbound.ownerId))?.data.status), 'pending_setup');
    assert.equal(await f.store.read(async (tx) => (await tx.find('bindings', { agentId: unbound.agentId })).length), 0);
    await error('invalid_request', async () => await f.call('registerOwner', { ...first.input, attemptId: 'not-a-uuid' }));
});
await test('independent owner creation has a configurable cap without partial credentials', async (t) => {
    const f = await fixture(t, { ownerRegistrationLimit: 1 });
    await account(f);
    await error('quota_exceeded', async () => await account(f));
    assert.equal(await f.store.read(async (tx) => (await tx.find('owners')).length), 1);
    assert.equal(await f.store.read(async (tx) => (await tx.find('credentials')).length), 2);
});
await test('V02: initial setup creates a named account and binds atomically; uniqueness failures preserve the setup', async (t) => {
    const f = await fixture(t), occupied = await account(f, { username: 'Occupied', email: 'occupied@example.test' });
    const resident = await agent(f), material = await setup(f, resident);
    const input = { operationId: op(), username: 'ＯＣＣＵＰＩＥＤ', email: 'new@example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true };
    const { username: _name, email: _email, ...withoutAccount } = input;
    await error('invalid_request', async () => await f.call('completeSetup', withoutAccount, material.setupToken));
    await error('invalid_request', async () => await f.call('completeSetup', { ...input, username: 'Available', email: undefined }, material.setupToken));
    await error('username_unavailable', async () => await f.call('completeSetup', input, material.setupToken));
    await error('email_unavailable', async () => await f.call('completeSetup', { ...input, username: 'Available', email: occupied.input.email }, material.setupToken));
    await error('invalid_request', async () => await f.call('completeSetup', { ...input, username: undefined }, material.setupToken));
    assert.equal((await f.call('readSetup', {}, material.setupToken)).status, 'restricted_setup');
    assert.equal(await f.store.read(async (tx) => (await tx.get('owners', resident.ownerId))?.data.status), 'pending_setup');
    assert.equal(await f.store.read(async (tx) => (await tx.find('bindings', { agentId: resident.agentId })).length), 0);
    const accepted = { ...input, operationId: op(), username: 'Available' };
    const result = await f.call('completeSetup', accepted, material.setupToken);
    assert.equal(result.ownerId, resident.ownerId);
    assert.equal(result.accountComplete, true);
    assert.equal((await login(f, 'available')).result.ownerId, resident.ownerId);
    assert.deepEqual(await receipt(f, accepted.operationId, `setup:${material.setupToken.split('.')[0]}`, 'completeSetup', accepted.sessionToken), result);
    assert.equal((await f.call('self', {}, resident.input.runtimeToken)).agentId, resident.agentId);
    assert.equal((await f.call('readAccount', {}, accepted.sessionToken)).email, 'new@example.test');
});
await test('new account recovery keeps username, email, bindings and runtime while rotating management proofs', async (t) => {
    const f = await fixture(t), owner = await managedAccount(f), empty = await account(f);
    for (const current of [owner, { ...empty, username: empty.input.username, email: empty.input.email }]) {
        const recovered = await recover(f, current.recoveryToken);
        const details = await f.call('readAccount', {}, recovered.input.sessionToken);
        assert.equal(details.ownerId, current.ownerId);
        assert.equal(details.username, current.username);
        assert.equal(details.email, current.email);
        assert.equal(details.emailVerified, false);
        assert.equal((await login(f, current.username, recovered.input.password)).result.ownerId, current.ownerId);
        assert.equal((await login(f, current.email, recovered.input.password)).result.ownerId, current.ownerId);
        await error('authentication_failed', async () => await login(f, current.username));
        await error('authentication_failed', async () => await f.call('readAccount', {}, current.sessionToken));
        assert.equal((await f.call('readRecovery', {}, recovered.input.recoveryToken)).ownerId, current.ownerId);
        assert.deepEqual(await receipt(f, recovered.input.operationId, `owner:${current.ownerId}`, 'recover', recovered.input.sessionToken), recovered.result);
        if ('agentId' in current) {
            assert.equal(((await f.call('listAgents', {}, recovered.input.sessionToken)).agents as JsonObject[])[0]?.agentId, current.agentId);
            assert.equal((await f.call('self', {}, current.input.runtimeToken)).agentId, current.agentId);
        }
        else
            assert.deepEqual((await f.call('listAgents', {}, recovered.input.sessionToken)).agents, []);
    }
});
await test('removed account completion and UUID login HTTP paths fail closed without changing a new account', async (t) => {
    const app = await buildApp();
    t.after(async () => await app.close());
    const input = { operationId: op(), attemptId: randomUUID(), username: 'Only_New', email: 'only-new@example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true };
    assert.equal((await app.inject({ method: 'POST', url: '/v1/owner/accounts', payload: input })).statusCode, 200);
    const before = await app.inject({ url: '/v1/owner/account', headers: { authorization: `Bearer ${input.sessionToken}` } });
    const completion = await app.inject({ method: 'PUT', url: '/v1/owner/account', headers: { authorization: `Bearer ${input.sessionToken}` }, payload: { operationId: op(), expectedVersion: 1, username: 'Overwrite', email: 'overwrite@example.test' } });
    assert.equal(completion.statusCode, 404);
    const rejected = await app.inject({ method: 'POST', url: '/v1/owner/sessions', payload: { operationId: op(), ownerId: input.attemptId, password, sessionToken: proof() } });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error.code, 'invalid_request');
    const after = await app.inject({ url: '/v1/owner/account', headers: { authorization: `Bearer ${input.sessionToken}` } });
    assert.equal(before.json().username, after.json().username);
    assert.equal(before.json().email, after.json().email);
});
await test('V03/V07: claiming a handoff requires both capabilities and retains runtime, continuation and initial history', async (t) => {
    const f = await fixture(t), owner = await account(f), stranger = await account(f), resident = await agent(f), material = await handoff(f, resident);
    await f.call('declareDelivery', { operationId: op(), generation: material.generation }, resident.input.runtimeToken);
    const before = await f.call('self', {}, resident.input.runtimeToken);
    const accountBefore = await f.store.read(async (tx) => (await tx.get('owners', owner.ownerId))!);
    const input = { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, handoffToken: material.handoffToken };
    assert.equal((await f.call('previewHandoff', { handoffId: material.handoffToken.split('.')[0] }, material.handoffToken)).agentId, resident.agentId);
    await error('authentication_failed', async () => await f.call('claimAgent', input));
    await error('invalid_request', async () => await f.call('claimAgent', { ...input, setupToken: proof() }, owner.sessionToken));
    await error('target_not_accessible', async () => await f.call('claimAgent', { ...input, agentId: randomUUID() }, owner.sessionToken));
    await error('generation_conflict', async () => await f.call('claimAgent', { ...input, expectedGeneration: material.generation + 1 }, owner.sessionToken));
    assert.deepEqual((await f.call('listAgents', {}, owner.sessionToken)).agents, []);
    const result = await f.call('claimAgent', input, owner.sessionToken);
    assert.deepEqual(await f.call('claimAgent', input, owner.sessionToken), result);
    assert.deepEqual(await receipt(f, input.operationId, `owner:${owner.ownerId}`, 'claimAgent', owner.sessionToken), result);
    await error('idempotency_payload_mismatch', async () => await f.call('claimAgent', { ...input, agentId: randomUUID() }, owner.sessionToken));
    await error('target_not_accessible', async () => await receipt(f, input.operationId, `owner:${owner.ownerId}`, 'claimAgent', stranger.sessionToken));
    await error('authentication_failed', async () => await f.call('claimAgent', input, stranger.sessionToken));
    await error('authentication_failed', async () => await f.call('previewHandoff', { handoffId: material.handoffToken.split('.')[0] }, material.handoffToken));
    assert.equal(await f.store.read(async (tx) => (await tx.get('owners', resident.ownerId))?.data.status), 'claimed');
    assert.equal(await f.store.read(async (tx) => (await tx.find('bindings', { agentId: resident.agentId, active: true })).length), 1);
    const current = await f.call('self', {}, resident.input.runtimeToken);
    for (const key of ['agentId', 'instanceId', 'runtimeVersion'])
        assert.equal(current[key], before[key]);
    assert.equal(current.ownerId, owner.ownerId);
    assert.deepEqual(current.profile, before.profile);
    assert.deepEqual(current.membership, before.membership);
    const history = current.management as JsonObject, original = before.management as JsonObject;
    assert.equal(history.generation, original.generation);
    assert.equal(history.generatedAt, original.generatedAt);
    assert.equal(history.deliveryDeclaredAt, original.deliveryDeclaredAt);
    assert.equal(history.managementStatus, 'managed');
    const registration = await f.call('registrationResult', { attemptId: resident.input.attemptId }, resident.input.continuationToken);
    assert.equal(registration.agentId, resident.agentId);
    assert.equal(registration.ownerId, owner.ownerId);
    assert.deepEqual(await receipt(f, resident.input.operationId, `registration:${resident.input.attemptId}`, 'register', resident.input.continuationToken), resident.result);
    await error('target_not_accessible', async () => await receipt(f, input.operationId, `owner:${owner.ownerId}`, 'claimAgent', resident.input.continuationToken));
    for (const [action, body] of [['issueHandoff', { operationId: op(), expectedGeneration: 1, handoffToken: proof() }], ['readAccount', {}], ['self', {}], ['exchangeSetup', { operationId: op(), setupToken: proof() }]] as const)
        await error('insufficient_scope', async () => await f.call(action, body, resident.input.continuationToken));
    const accountAfter = await f.store.read(async (tx) => (await tx.get('owners', owner.ownerId))!);
    assert.equal(JSON.stringify(accountBefore) === JSON.stringify(accountAfter), true, 'Claiming does not alter the existing account password or recovery');
    assert.equal((await f.call('readRecovery', {}, owner.recoveryToken)).ownerId, owner.ownerId);
});
await test('V03: an already exchanged setup can be claimed by a named account; prior Agents stay bound', async (t) => {
    const f = await fixture(t), owner = await managedAccount(f), resident = await agent(f), material = await setup(f, resident);
    const input = { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, setupToken: material.setupToken };
    await f.call('claimAgent', input, owner.sessionToken);
    assert.deepEqual((await f.call('claimAgent', input, owner.sessionToken)).agentId, resident.agentId);
    const ids = ((await f.call('listAgents', {}, owner.sessionToken)).agents as JsonObject[]).map((row) => row.agentId).sort();
    assert.deepEqual(ids, [owner.agentId, resident.agentId].sort());
    assert.equal((await f.call('readAccount', {}, owner.sessionToken)).accountComplete, true);
    await error('authentication_failed', async () => await f.call('readSetup', {}, material.setupToken));
    assert.equal((await f.call('registrationResult', { attemptId: resident.input.attemptId }, resident.input.runtimeToken)).ownerId, owner.ownerId);
});
await test('expired, replaced and quota-rejected handoffs cannot partially bind or consume a valid replacement', async (t) => {
    let time = 1000000;
    const f = await fixture(t, { now: () => time, handoffTtlMs: 5, maxAgentsPerOwner: 1 });
    const owner = await managedAccount(f), resident = await agent(f), material = await handoff(f, resident);
    const input = { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, handoffToken: material.handoffToken };
    time += 6;
    await error('authentication_failed', async () => await f.call('claimAgent', input, owner.sessionToken));
    const replacement = proof();
    await f.call('issueHandoff', { operationId: op(), expectedGeneration: 1, handoffToken: replacement }, resident.input.continuationToken);
    await error('generation_conflict', async () => await f.call('claimAgent', { ...input, handoffToken: replacement }, owner.sessionToken));
    await error('quota_exceeded', async () => await f.call('claimAgent', { ...input, expectedGeneration: 2, handoffToken: replacement }, owner.sessionToken));
    assert.equal((await f.call('previewHandoff', { handoffId: replacement.split('.')[0] }, replacement)).generation, 2);
    assert.equal(await f.store.read(async (tx) => (await tx.find('bindings', { agentId: resident.agentId })).length), 0);
    assert.equal((await f.call('self', {}, resident.input.runtimeToken)).runtimeVersion, 1);
});
await test('V08/V09: empty accounts invite independent Agents, while only private account reads disclose email', async (t) => {
    const f = await fixture(t), owner = await account(f, { username: 'Private_User', email: 'only-private@example.test' });
    const projections: JsonObject[] = [owner.result];
    for (let count = 0; count < 2; count++) {
        const inviteToken = proof();
        projections.push(await f.call('issueInvite', { operationId: op(), inviteToken }, owner.sessionToken));
        const resident = await agent(f, inviteToken);
        projections.push(resident.result, await f.call('self', {}, resident.input.runtimeToken), await f.call('registrationResult', { attemptId: resident.input.attemptId }, resident.input.continuationToken));
        await error('insufficient_scope', async () => await f.call('readAccount', {}, resident.input.runtimeToken));
        await error('insufficient_scope', async () => await f.call('readAccount', {}, resident.input.continuationToken));
    }
    projections.push(await f.call('listAgents', {}, owner.sessionToken), await f.call('listInvites', {}, owner.sessionToken));
    for (const value of projections) {
        assert.equal(JSON.stringify(value).includes(owner.input.email), false);
        assert.equal(JSON.stringify(value).includes(owner.input.username), false);
    }
    const agents = (await f.call('listAgents', {}, owner.sessionToken)).agents as JsonObject[];
    assert.equal(agents.length, 2);
    assert.notEqual(agents[0]?.agentId, agents[1]?.agentId);
    const app = await buildApp();
    t.after(async () => await app.close());
    const signed = await app.inject({ method: 'POST', url: '/v1/owner/accounts', payload: { ...owner.input, attemptId: randomUUID(), operationId: op(), sessionToken: proof(), recoveryToken: proof() } });
    assert.equal(signed.statusCode, 200);
    assert.equal(signed.body.includes(owner.input.email), false);
    const anonymous = await app.inject({ url: '/v1/owner/account' });
    assert.equal(anonymous.statusCode, 401);
    const rejected = await app.inject({ method: 'POST', url: '/v1/owner/sessions', payload: { operationId: op(), identifier: owner.input.email, password: 'wrong password value 123', sessionToken: proof() } });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.body.includes(owner.input.email), false);
});
type ConcurrentCommand = {
    action: M1Action;
    input: JsonObject;
    token?: string;
};
async function compete(databasePath: string, commands: ConcurrentCommand[]) {
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
for (const field of ['username', 'email'] as const)
    await test(`V06: concurrent ${field} signup has one winner and no partial account`, { timeout: 15000 }, async (t) => {
        const directory = mkdtempSync(join(tmpdir(), 'm1-account-concurrent-'));
        t.after(() => rmSync(directory, { recursive: true, force: true }));
        const databasePath = join(directory, 'test.sqlite');
        const f = await fixture(t, {}, databasePath);
        await f.store.close();
        const commands = [0, 1].map((index): ConcurrentCommand => ({ action: 'registerOwner', input: { operationId: op(), attemptId: randomUUID(), username: field === 'username' ? (index ? 'ＳＡＭＥ_１２' : 'same_12') : `Different_${index}`, email: field === 'email' ? (index ? ' SAME@EXAMPLE.TEST ' : 'same@example.test') : `different${index}@example.test`, password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true } }));
        const outcomes = await compete(databasePath, commands);
        assert.equal(outcomes.filter((value) => value.result).length, 1);
        assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), [`${field}_unavailable`]);
        const current = await openTestStore({ ...identity, databasePath });
        t.after(async () => await current.close());
        await current.read(async (tx) => { assert.equal((await tx.find('owners')).length, 1); assert.equal((await tx.find('credentials')).length, 2); assert.equal((await tx.find('operations')).length, 1); assert.equal((await tx.find('facts')).length, 1); assert.equal((await tx.find('bindings')).length, 0); });
    });
for (const field of ['username', 'email'] as const)
    await test(`V06: concurrent initial setup ${field} uniqueness has one winner and preserves the losing capability`, { timeout: 15000 }, async (t) => {
        const directory = mkdtempSync(join(tmpdir(), 'm1-setup-concurrent-'));
        t.after(() => rmSync(directory, { recursive: true, force: true }));
        const databasePath = join(directory, 'test.sqlite'), f = await fixture(t, {}, databasePath);
        const residents = [await agent(f), await agent(f)], materials = await Promise.all(residents.map(async (resident) => await setup(f, resident)));
        const operations = await f.store.read(async (tx) => (await tx.find('operations')).length);
        await f.store.close();
        const commands = materials.map((material, index): ConcurrentCommand => ({ action: 'completeSetup', input: { operationId: op(), username: field === 'username' ? (index ? 'ＳＡＭＥ_１２' : 'same_12') : `Different_${index}`, email: field === 'email' ? (index ? ' SAME@EXAMPLE.TEST ' : 'same@example.test') : `different${index}@example.test`, password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true }, token: material.setupToken }));
        const outcomes = await compete(databasePath, commands);
        assert.equal(outcomes.filter((value) => value.result).length, 1);
        assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), [`${field}_unavailable`]);
        const current = await openTestStore({ ...identity, databasePath });
        t.after(async () => await current.close());
        const service = createM1Service(current, { now: () => 1000000 });
        await current.read(async (tx) => {
            assert.equal((await tx.find('owners')).length, 2);
            assert.equal((await tx.find('bindings', { active: true })).length, 1);
            assert.equal((await tx.find('owners', { status: 'active' })).length, 1);
            assert.equal((await tx.find('owners', { status: 'pending_setup' })).length, 1);
            assert.equal((await tx.find('operations')).length, operations + 1);
        });
        for (const [index, outcome] of outcomes.entries())
            if (outcome.code)
                assert.equal((await service.invoke('readSetup', {}, materials[index]!.setupToken)).status, 'restricted_setup');
        for (const resident of residents)
            assert.equal((await service.invoke('self', {}, resident.input.runtimeToken)).agentId, resident.agentId);
    });
await test('concurrent setup submissions activate one named owner and the original saved session resolves the result', { timeout: 15000 }, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'm1-same-setup-concurrent-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const databasePath = join(directory, 'test.sqlite'), f = await fixture(t, {}, databasePath), resident = await agent(f), material = await setup(f, resident);
    const input = { operationId: op(), username: 'Only_One', email: 'only-one@example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true };
    await f.store.close();
    const command: ConcurrentCommand = { action: 'completeSetup', input, token: material.setupToken };
    const outcomes = await compete(databasePath, [command, command]);
    assert.equal(outcomes.filter((value) => value.result).length, 1);
    assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), ['authentication_failed']);
    const current = await openTestStore({ ...identity, databasePath });
    t.after(async () => await current.close());
    const service = createM1Service(current, { now: () => 1000000 });
    assert.equal((await service.invoke('receipt', { operationId: input.operationId, scope: `setup:${material.setupToken.split('.')[0]}`, action: 'completeSetup' }, input.sessionToken)).ownerId, resident.ownerId);
    assert.equal(await current.read(async (tx) => (await tx.find('bindings', { agentId: resident.agentId, active: true })).length), 1);
});
await test('V03/V06: two concurrent authenticated owners cannot claim the same initial capability', { timeout: 15000 }, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'm1-claim-concurrent-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const databasePath = join(directory, 'test.sqlite'), f = await fixture(t, {}, databasePath);
    const owners = [await account(f), await account(f)], resident = await agent(f), material = await handoff(f, resident);
    await f.store.close();
    const outcomes = await compete(databasePath, owners.map((owner) => ({ action: 'claimAgent', input: { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, handoffToken: material.handoffToken }, token: owner.sessionToken })));
    assert.equal(outcomes.filter((value) => value.result).length, 1);
    assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), ['authentication_failed']);
    const current = await openTestStore({ ...identity, databasePath });
    t.after(async () => await current.close());
    const service = createM1Service(current, { now: () => 1000000 });
    assert.equal(await current.read(async (tx) => (await tx.find('bindings', { agentId: resident.agentId, active: true })).length), 1);
    assert.equal((await service.invoke('self', {}, resident.input.runtimeToken)).agentId, resident.agentId);
    assert.equal((await service.invoke('registrationResult', { attemptId: resident.input.attemptId }, resident.input.continuationToken)).agentId, resident.agentId);
});
