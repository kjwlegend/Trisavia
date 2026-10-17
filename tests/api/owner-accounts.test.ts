import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { buildApp } from '../../apps/platform/app.ts';
import { createM1Service, type M1Action, type M1Options } from '../../apps/platform/application/m1-service.ts';
import { accountFields, email, username } from '../../apps/platform/domains/access/account-identifiers.ts';
import { M1Error } from '../../apps/platform/domains/common/errors.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import type { JsonObject } from '../../apps/platform/contracts/store.ts';

const proof = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
const op = () => randomUUID();
const password = 'synthetic account password 123';
const identity = { instanceId: 'account-test-instance', recoveryEpoch: 'account-test-epoch' };
const error = (code: string, work: () => unknown) => assert.throws(work, (value) => value instanceof M1Error && value.code === code);
const str = (value: JsonObject, key: string) => { assert.equal(typeof value[key], 'string'); return value[key] as string; };
function fixture(t: TestContext, options: M1Options = {}, databasePath = ':memory:') {
  const store = openM1Store({ ...identity, databasePath });
  t.after(() => store.close());
  const service = createM1Service(store, { now: () => 1_000_000, ...options });
  return { store, service, call: service.invoke };
}
type Fixture = ReturnType<typeof fixture>;
function account(f: Fixture, fields: Partial<{ username: string; email: string }> = {}) {
  const input = { operationId: op(), attemptId: randomUUID(), username: `User_${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true, ...fields };
  const result = f.call('registerOwner', input);
  return { input, result, ownerId: str(result, 'ownerId'), sessionToken: input.sessionToken, recoveryToken: input.recoveryToken };
}
function agent(f: Fixture, inviteToken?: string) {
  const input = { operationId: op(), attemptId: randomUUID(), runtimeToken: proof(), continuationToken: proof(), ...(inviteToken ? { inviteToken } : {}) };
  const result = f.call('register', input);
  return { input, result, agentId: str(result, 'agentId'), ownerId: str(result, 'ownerId') };
}
type Agent = ReturnType<typeof agent>;
function handoff(f: Fixture, resident: Agent) {
  const handoffToken = proof();
  const result = f.call('issueHandoff', { operationId: op(), expectedGeneration: 0, handoffToken }, resident.input.continuationToken);
  return { handoffToken, generation: result.generation as number };
}
function setup(f: Fixture, resident: Agent) {
  const source = handoff(f, resident), setupToken = proof();
  f.call('exchangeSetup', { operationId: op(), setupToken }, source.handoffToken);
  return { ...source, setupToken };
}
function managedAccount(f: Fixture) {
  const resident = agent(f), material = setup(f, resident);
  const sessionToken = proof(), recoveryToken = proof();
  const username = `Setup_${randomUUID().slice(0, 8)}`, email = `${randomUUID()}@example.test`;
  f.call('completeSetup', { operationId: op(), username, email, password, sessionToken, recoveryToken, credentialsSaved: true }, material.setupToken);
  return { ...resident, username, email, sessionToken, recoveryToken };
}
function receipt(f: Fixture, operationId: string, scope: string, action: string, token: string) {
  return f.call('receipt', { operationId, scope, action }, token);
}
function login(f: Fixture, identifier: string, secret = password) {
  const input = { operationId: op(), identifier, password: secret, sessionToken: proof() };
  return { input, result: f.call('login', input) };
}
function recover(f: Fixture, token: string) {
  const input = { operationId: op(), password: 'synthetic replacement password 456', recoveryToken: proof(), sessionToken: proof(), credentialsSaved: true };
  return { input, result: f.call('recover', input, token) };
}

test('account identifiers implement exact ASCII username normalization and common email grammar', () => {
  assert.deepEqual(username('  ＡＢ_１２  '), { username: 'AB_12', usernameKey: 'ab_12' });
  for (const value of ['ab', '__', 'A'.repeat(32)]) assert.equal(username(value).username, value);
  for (const value of ['中文', 'Ab中文', 'a', 'a'.repeat(33), 'a b', 'a@b', 'a-b', '😀x', 'éx']) error('invalid_request', () => username(value));
  assert.deepEqual(email(' User.Name+Tag@Example.TEST '), { email: 'User.Name+Tag@Example.TEST', emailKey: 'user.name+tag@example.test' });
  for (const value of ["a!#$%&'*+-/=?^_`{|}~b@example.test", 'x@a-b.example', 'a@123.example']) assert.equal(email(value).emailKey, value);
  for (const value of ['x', 'a@@example.test', 'a@localhost', '.a@example.test', 'a.@example.test', 'a..b@example.test', 'a b@example.test', '名字@example.test', 'a@-x.test', 'a@x-.test', 'a@x.123', 'a@x..test', 'a'.repeat(65) + '@example.test', 'a@' + 'x'.repeat(64) + '.test', 'a@' + Array(4).fill('x'.repeat(63)).join('.')]) error('invalid_request', () => email(value));
  assert.notEqual(email('a.b+tag@example.test').emailKey, email('ab@example.test').emailKey);
  assert.equal(accountFields('Ab', 'a@example.test').emailVerified, false);
});

test('V01/V07: independent signup is atomic, resumable by pre-saved session and starts with no Agent', (t) => {
  const f = fixture(t);
  const input = { operationId: op(), attemptId: randomUUID(), username: 'New_User', email: 'New@Example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true };
  error('authentication_failed', () => receipt(f, input.operationId, `owner-registration:${input.attemptId}`, 'registerOwner', input.sessionToken));
  error('invalid_request', () => f.call('registerOwner', { ...input, credentialsSaved: false }));
  assert.equal(f.store.read((tx) => tx.find('owners').length), 0);
  const result = f.call('registerOwner', input);
  assert.equal(result.ownerId, input.attemptId);
  assert.deepEqual(f.call('registerOwner', input), result);
  assert.deepEqual(receipt(f, input.operationId, `owner-registration:${input.attemptId}`, 'registerOwner', input.sessionToken), result);
  error('idempotency_payload_mismatch', () => f.call('registerOwner', { ...input, username: 'Changed' }));
  error('account_id_conflict', () => f.call('registerOwner', { ...input, operationId: op() }));
  error('authentication_failed', () => f.call('registerOwner', { ...input, sessionToken: proof() }));
  assert.deepEqual(f.call('listAgents', {}, input.sessionToken).agents, []);
  const privateAccount = f.call('readAccount', {}, input.sessionToken);
  assert.equal(privateAccount.username, 'New_User'); assert.equal(privateAccount.email, 'New@Example.test'); assert.equal(privateAccount.emailVerified, false);
  assert.equal(JSON.stringify(result).includes('New@Example.test'), false);
  assert.equal(f.store.read((tx) => tx.find('owners').length), 1);
  assert.equal(f.store.read((tx) => tx.find('credentials').length), 2);
  assert.equal(f.store.read((tx) => tx.find('facts').length), 1);
});

test('V01: username and email login share identity; UUID login is rejected and receipt scope is known before login', (t) => {
  const f = fixture(t), owner = account(f, { username: 'English_12', email: 'My.User+Tag@Example.test' });
  for (const value of [' english_12 ', 'ＥＮＧＬＩＳＨ_１２', ' MY.USER+TAG@EXAMPLE.TEST ']) {
    const current = login(f, value);
    assert.equal(current.result.ownerId, owner.ownerId);
    assert.deepEqual(receipt(f, current.input.operationId, `owner-login:${current.input.sessionToken.split('.')[0]}`, 'login', current.input.sessionToken), current.result);
    assert.deepEqual(f.call('login', current.input), current.result);
  }
  for (const identifier of [owner.ownerId, 'unknown_user', 'unknown@example.test', '中文', 'a@bad']) error('authentication_failed', () => login(f, identifier));
  error('authentication_failed', () => login(f, owner.input.username, 'incorrect password 123'));
  const oldInput = { operationId: op(), ownerId: owner.ownerId, password, sessionToken: proof() };
  error('invalid_request', () => f.call('login', oldInput));
  error('invalid_request', () => f.call('login', { ...oldInput, identifier: owner.input.username }));
});

test('V06: conflicts and invalid fields never leave owner credentials or claim a known owner ID', (t) => {
  const f = fixture(t), first = account(f, { username: 'Same_12', email: 'same@example.test' });
  const sizes = () => f.store.read((tx) => (['owners', 'credentials', 'operations', 'facts'] as const).map((table) => tx.find(table).length));
  const before = sizes();
  for (const [fields, code] of [
    [{ username: 'ＳＡＭＥ_１２' }, 'username_unavailable'], [{ email: ' SAME@EXAMPLE.TEST ' }, 'email_unavailable'],
    [{ username: '中文' }, 'invalid_request'], [{ username: 'Mixed中文' }, 'invalid_request'], [{ email: 'bad' }, 'invalid_request'],
  ] as const) error(code, () => account(f, fields));
  assert.deepEqual(sizes(), before);
  const unbound = agent(f);
  error('account_id_conflict', () => f.call('registerOwner', { ...first.input, attemptId: unbound.ownerId, operationId: op() }));
  assert.equal(f.store.read((tx) => tx.get('owners', unbound.ownerId)?.data.status), 'pending_setup');
  assert.equal(f.store.read((tx) => tx.find('bindings', { agentId: unbound.agentId }).length), 0);
  error('invalid_request', () => f.call('registerOwner', { ...first.input, attemptId: 'not-a-uuid' }));
});

test('independent owner creation has a configurable cap without partial credentials', (t) => {
  const f = fixture(t, { ownerRegistrationLimit: 1 }); account(f);
  error('quota_exceeded', () => account(f));
  assert.equal(f.store.read((tx) => tx.find('owners').length), 1);
  assert.equal(f.store.read((tx) => tx.find('credentials').length), 2);
});

test('V02: initial setup creates a named account and binds atomically; uniqueness failures preserve the setup', (t) => {
  const f = fixture(t), occupied = account(f, { username: 'Occupied', email: 'occupied@example.test' });
  const resident = agent(f), material = setup(f, resident);
  const input = { operationId: op(), username: 'ＯＣＣＵＰＩＥＤ', email: 'new@example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true };
  const { username: _name, email: _email, ...withoutAccount } = input;
  error('invalid_request', () => f.call('completeSetup', withoutAccount, material.setupToken));
  error('invalid_request', () => f.call('completeSetup', { ...input, username: 'Available', email: undefined }, material.setupToken));
  error('username_unavailable', () => f.call('completeSetup', input, material.setupToken));
  error('email_unavailable', () => f.call('completeSetup', { ...input, username: 'Available', email: occupied.input.email }, material.setupToken));
  error('invalid_request', () => f.call('completeSetup', { ...input, username: undefined }, material.setupToken));
  assert.equal(f.call('readSetup', {}, material.setupToken).status, 'restricted_setup');
  assert.equal(f.store.read((tx) => tx.get('owners', resident.ownerId)?.data.status), 'pending_setup');
  assert.equal(f.store.read((tx) => tx.find('bindings', { agentId: resident.agentId }).length), 0);
  const accepted = { ...input, operationId: op(), username: 'Available' };
  const result = f.call('completeSetup', accepted, material.setupToken);
  assert.equal(result.ownerId, resident.ownerId); assert.equal(result.accountComplete, true);
  assert.equal(login(f, 'available').result.ownerId, resident.ownerId);
  assert.deepEqual(receipt(f, accepted.operationId, `setup:${material.setupToken.split('.')[0]}`, 'completeSetup', accepted.sessionToken), result);
  assert.equal(f.call('self', {}, resident.input.runtimeToken).agentId, resident.agentId);
  assert.equal(f.call('readAccount', {}, accepted.sessionToken).email, 'new@example.test');
});

test('new account recovery keeps username, email, bindings and runtime while rotating management proofs', (t) => {
  const f = fixture(t), owner = managedAccount(f), empty = account(f);
  for (const current of [owner, { ...empty, username: empty.input.username, email: empty.input.email }]) {
    const recovered = recover(f, current.recoveryToken);
    const details = f.call('readAccount', {}, recovered.input.sessionToken);
    assert.equal(details.ownerId, current.ownerId); assert.equal(details.username, current.username); assert.equal(details.email, current.email); assert.equal(details.emailVerified, false);
    assert.equal(login(f, current.username, recovered.input.password).result.ownerId, current.ownerId);
    assert.equal(login(f, current.email, recovered.input.password).result.ownerId, current.ownerId);
    error('authentication_failed', () => login(f, current.username));
    error('authentication_failed', () => f.call('readAccount', {}, current.sessionToken));
    assert.equal(f.call('readRecovery', {}, recovered.input.recoveryToken).ownerId, current.ownerId);
    assert.deepEqual(receipt(f, recovered.input.operationId, `owner:${current.ownerId}`, 'recover', recovered.input.sessionToken), recovered.result);
    if ('agentId' in current) {
      assert.equal((f.call('listAgents', {}, recovered.input.sessionToken).agents as JsonObject[])[0]?.agentId, current.agentId);
      assert.equal(f.call('self', {}, current.input.runtimeToken).agentId, current.agentId);
    } else assert.deepEqual(f.call('listAgents', {}, recovered.input.sessionToken).agents, []);
  }
});

test('removed account completion and UUID login HTTP paths fail closed without changing a new account', async (t) => {
  const app = buildApp(); t.after(() => app.close());
  const input = { operationId: op(), attemptId: randomUUID(), username: 'Only_New', email: 'only-new@example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/owner/accounts', payload: input })).statusCode, 200);
  const before = await app.inject({ url: '/v1/owner/account', headers: { authorization: `Bearer ${input.sessionToken}` } });
  const completion = await app.inject({ method: 'PUT', url: '/v1/owner/account', headers: { authorization: `Bearer ${input.sessionToken}` }, payload: { operationId: op(), expectedVersion: 1, username: 'Overwrite', email: 'overwrite@example.test' } });
  assert.equal(completion.statusCode, 404);
  const rejected = await app.inject({ method: 'POST', url: '/v1/owner/sessions', payload: { operationId: op(), ownerId: input.attemptId, password, sessionToken: proof() } });
  assert.equal(rejected.statusCode, 400); assert.equal(rejected.json().error.code, 'invalid_request');
  const after = await app.inject({ url: '/v1/owner/account', headers: { authorization: `Bearer ${input.sessionToken}` } });
  assert.equal(before.json().username, after.json().username); assert.equal(before.json().email, after.json().email);
});

test('V03/V07: claiming a handoff requires both capabilities and retains runtime, continuation and initial history', (t) => {
  const f = fixture(t), owner = account(f), stranger = account(f), resident = agent(f), material = handoff(f, resident);
  f.call('declareDelivery', { operationId: op(), generation: material.generation }, resident.input.runtimeToken);
  const before = f.call('self', {}, resident.input.runtimeToken);
  const accountBefore = f.store.read((tx) => tx.get('owners', owner.ownerId)!);
  const input = { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, handoffToken: material.handoffToken };
  assert.equal(f.call('previewHandoff', { handoffId: material.handoffToken.split('.')[0] }, material.handoffToken).agentId, resident.agentId);
  error('authentication_failed', () => f.call('claimAgent', input));
  error('invalid_request', () => f.call('claimAgent', { ...input, setupToken: proof() }, owner.sessionToken));
  error('target_not_accessible', () => f.call('claimAgent', { ...input, agentId: randomUUID() }, owner.sessionToken));
  error('generation_conflict', () => f.call('claimAgent', { ...input, expectedGeneration: material.generation + 1 }, owner.sessionToken));
  assert.deepEqual(f.call('listAgents', {}, owner.sessionToken).agents, []);
  const result = f.call('claimAgent', input, owner.sessionToken);
  assert.deepEqual(f.call('claimAgent', input, owner.sessionToken), result);
  assert.deepEqual(receipt(f, input.operationId, `owner:${owner.ownerId}`, 'claimAgent', owner.sessionToken), result);
  error('idempotency_payload_mismatch', () => f.call('claimAgent', { ...input, agentId: randomUUID() }, owner.sessionToken));
  error('target_not_accessible', () => receipt(f, input.operationId, `owner:${owner.ownerId}`, 'claimAgent', stranger.sessionToken));
  error('authentication_failed', () => f.call('claimAgent', input, stranger.sessionToken));
  error('authentication_failed', () => f.call('previewHandoff', { handoffId: material.handoffToken.split('.')[0] }, material.handoffToken));
  assert.equal(f.store.read((tx) => tx.get('owners', resident.ownerId)?.data.status), 'claimed');
  assert.equal(f.store.read((tx) => tx.find('bindings', { agentId: resident.agentId, active: true }).length), 1);
  const current = f.call('self', {}, resident.input.runtimeToken);
  for (const key of ['agentId', 'instanceId', 'runtimeVersion']) assert.equal(current[key], before[key]);
  assert.equal(current.ownerId, owner.ownerId);
  assert.deepEqual(current.profile, before.profile); assert.deepEqual(current.membership, before.membership);
  const history = current.management as JsonObject, original = before.management as JsonObject;
  assert.equal(history.generation, original.generation); assert.equal(history.generatedAt, original.generatedAt); assert.equal(history.deliveryDeclaredAt, original.deliveryDeclaredAt); assert.equal(history.managementStatus, 'managed');
  const registration = f.call('registrationResult', { attemptId: resident.input.attemptId }, resident.input.continuationToken);
  assert.equal(registration.agentId, resident.agentId); assert.equal(registration.ownerId, owner.ownerId);
  assert.deepEqual(receipt(f, resident.input.operationId, `registration:${resident.input.attemptId}`, 'register', resident.input.continuationToken), resident.result);
  error('target_not_accessible', () => receipt(f, input.operationId, `owner:${owner.ownerId}`, 'claimAgent', resident.input.continuationToken));
  for (const [action, body] of [['issueHandoff', { operationId: op(), expectedGeneration: 1, handoffToken: proof() }], ['readAccount', {}], ['self', {}], ['exchangeSetup', { operationId: op(), setupToken: proof() }]] as const) error('insufficient_scope', () => f.call(action, body, resident.input.continuationToken));
  const accountAfter = f.store.read((tx) => tx.get('owners', owner.ownerId)!);
  assert.equal(JSON.stringify(accountBefore) === JSON.stringify(accountAfter), true, 'Claiming does not alter the existing account password or recovery');
  assert.equal(f.call('readRecovery', {}, owner.recoveryToken).ownerId, owner.ownerId);
});

test('V03: an already exchanged setup can be claimed by a named account; prior Agents stay bound', (t) => {
  const f = fixture(t), owner = managedAccount(f), resident = agent(f), material = setup(f, resident);
  const input = { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, setupToken: material.setupToken };
  f.call('claimAgent', input, owner.sessionToken);
  assert.deepEqual(f.call('claimAgent', input, owner.sessionToken).agentId, resident.agentId);
  const ids = (f.call('listAgents', {}, owner.sessionToken).agents as JsonObject[]).map((row) => row.agentId).sort();
  assert.deepEqual(ids, [owner.agentId, resident.agentId].sort());
  assert.equal(f.call('readAccount', {}, owner.sessionToken).accountComplete, true);
  error('authentication_failed', () => f.call('readSetup', {}, material.setupToken));
  assert.equal(f.call('registrationResult', { attemptId: resident.input.attemptId }, resident.input.runtimeToken).ownerId, owner.ownerId);
});

test('expired, replaced and quota-rejected handoffs cannot partially bind or consume a valid replacement', (t) => {
  let time = 1_000_000;
  const f = fixture(t, { now: () => time, handoffTtlMs: 5, maxAgentsPerOwner: 1 });
  const owner = managedAccount(f), resident = agent(f), material = handoff(f, resident);
  const input = { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, handoffToken: material.handoffToken };
  time += 6;
  error('authentication_failed', () => f.call('claimAgent', input, owner.sessionToken));
  const replacement = proof();
  f.call('issueHandoff', { operationId: op(), expectedGeneration: 1, handoffToken: replacement }, resident.input.continuationToken);
  error('generation_conflict', () => f.call('claimAgent', { ...input, handoffToken: replacement }, owner.sessionToken));
  error('quota_exceeded', () => f.call('claimAgent', { ...input, expectedGeneration: 2, handoffToken: replacement }, owner.sessionToken));
  assert.equal(f.call('previewHandoff', { handoffId: replacement.split('.')[0] }, replacement).generation, 2);
  assert.equal(f.store.read((tx) => tx.find('bindings', { agentId: resident.agentId }).length), 0);
  assert.equal(f.call('self', {}, resident.input.runtimeToken).runtimeVersion, 1);
});

test('V08/V09: empty accounts invite independent Agents, while only private account reads disclose email', async (t) => {
  const f = fixture(t), owner = account(f, { username: 'Private_User', email: 'only-private@example.test' });
  const projections: JsonObject[] = [owner.result];
  for (let count = 0; count < 2; count++) {
    const inviteToken = proof();
    projections.push(f.call('issueInvite', { operationId: op(), inviteToken }, owner.sessionToken));
    const resident = agent(f, inviteToken);
    projections.push(resident.result, f.call('self', {}, resident.input.runtimeToken), f.call('registrationResult', { attemptId: resident.input.attemptId }, resident.input.continuationToken));
    error('insufficient_scope', () => f.call('readAccount', {}, resident.input.runtimeToken));
    error('insufficient_scope', () => f.call('readAccount', {}, resident.input.continuationToken));
  }
  projections.push(f.call('listAgents', {}, owner.sessionToken), f.call('listInvites', {}, owner.sessionToken));
  for (const value of projections) {
    assert.equal(JSON.stringify(value).includes(owner.input.email), false);
    assert.equal(JSON.stringify(value).includes(owner.input.username), false);
  }
  const agents = f.call('listAgents', {}, owner.sessionToken).agents as JsonObject[];
  assert.equal(agents.length, 2); assert.notEqual(agents[0]?.agentId, agents[1]?.agentId);
  const app = buildApp(); t.after(() => app.close());
  const signed = await app.inject({ method: 'POST', url: '/v1/owner/accounts', payload: { ...owner.input, attemptId: randomUUID(), operationId: op(), sessionToken: proof(), recoveryToken: proof() } });
  assert.equal(signed.statusCode, 200);
  assert.equal(signed.body.includes(owner.input.email), false);
  const anonymous = await app.inject({ url: '/v1/owner/account' }); assert.equal(anonymous.statusCode, 401);
  const rejected = await app.inject({ method: 'POST', url: '/v1/owner/sessions', payload: { operationId: op(), identifier: owner.input.email, password: 'wrong password value 123', sessionToken: proof() } });
  assert.equal(rejected.statusCode, 401); assert.equal(rejected.body.includes(owner.input.email), false);
});

type ConcurrentCommand = { action: M1Action; input: JsonObject; token?: string };
async function compete(databasePath: string, commands: ConcurrentCommand[]) {
  const source = `const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{const {openM1Store}=await import(workerData.storage);const {createM1Service}=await import(workerData.service);
    const store=openM1Store({...workerData.identity,databasePath:workerData.databasePath,busyTimeoutMs:3000});
    const service=createM1Service(store,{now:()=>1000000});parentPort.postMessage({ready:true});
    parentPort.once('message',()=>{try{parentPort.postMessage({result:service.invoke(workerData.command.action,workerData.command.input,workerData.command.token)});}catch(error){parentPort.postMessage({code:error.code||'unexpected'});}finally{store.close();parentPort.close();}});
    })().catch(()=>{parentPort.postMessage({code:'worker_start_failed'});parentPort.close();});`;
  const workers = commands.map((command) => new Worker(source, { eval: true, workerData: { command, databasePath, identity, storage: new URL('../../apps/platform/infrastructure/relational/sqlite-store.ts', import.meta.url).href, service: new URL('../../apps/platform/application/m1-service.ts', import.meta.url).href } }));
  try {
    await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => { worker.once('message', (message) => message.ready ? resolve() : reject(new Error('Concurrent worker failed to initialize'))); worker.once('error', () => reject(new Error('Concurrent worker failed'))); })));
    const completed = workers.map((worker) => new Promise<{ result?: JsonObject; code?: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', () => reject(new Error('Concurrent worker failed'))); }));
    workers.forEach((worker) => worker.postMessage('go'));
    return await Promise.all(completed);
  } finally { await Promise.all(workers.map((worker) => worker.terminate())); }
}

for (const field of ['username', 'email'] as const) test(`V06: concurrent ${field} signup has one winner and no partial account`, { timeout: 15_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'm1-account-concurrent-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'test.sqlite');
  const f = fixture(t, {}, databasePath); f.store.close();
  const commands = [0, 1].map((index): ConcurrentCommand => ({ action: 'registerOwner', input: { operationId: op(), attemptId: randomUUID(), username: field === 'username' ? (index ? 'ＳＡＭＥ_１２' : 'same_12') : `Different_${index}`, email: field === 'email' ? (index ? ' SAME@EXAMPLE.TEST ' : 'same@example.test') : `different${index}@example.test`, password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true } }));
  const outcomes = await compete(databasePath, commands);
  assert.equal(outcomes.filter((value) => value.result).length, 1);
  assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), [`${field}_unavailable`]);
  const current = openM1Store({ ...identity, databasePath }); t.after(() => current.close());
  current.read((tx) => { assert.equal(tx.find('owners').length, 1); assert.equal(tx.find('credentials').length, 2); assert.equal(tx.find('operations').length, 1); assert.equal(tx.find('facts').length, 1); assert.equal(tx.find('bindings').length, 0); });
});

for (const field of ['username', 'email'] as const) test(`V06: concurrent initial setup ${field} uniqueness has one winner and preserves the losing capability`, { timeout: 15_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'm1-setup-concurrent-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'test.sqlite'), f = fixture(t, {}, databasePath);
  const residents = [agent(f), agent(f)], materials = residents.map((resident) => setup(f, resident));
  const operations = f.store.read((tx) => tx.find('operations').length); f.store.close();
  const commands = materials.map((material, index): ConcurrentCommand => ({ action: 'completeSetup', input: { operationId: op(), username: field === 'username' ? (index ? 'ＳＡＭＥ_１２' : 'same_12') : `Different_${index}`, email: field === 'email' ? (index ? ' SAME@EXAMPLE.TEST ' : 'same@example.test') : `different${index}@example.test`, password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true }, token: material.setupToken }));
  const outcomes = await compete(databasePath, commands);
  assert.equal(outcomes.filter((value) => value.result).length, 1);
  assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), [`${field}_unavailable`]);
  const current = openM1Store({ ...identity, databasePath }); t.after(() => current.close());
  const service = createM1Service(current, { now: () => 1_000_000 });
  current.read((tx) => {
    assert.equal(tx.find('owners').length, 2); assert.equal(tx.find('bindings', { active: true }).length, 1);
    assert.equal(tx.find('owners', { status: 'active' }).length, 1); assert.equal(tx.find('owners', { status: 'pending_setup' }).length, 1);
    assert.equal(tx.find('operations').length, operations + 1);
  });
  for (const [index, outcome] of outcomes.entries()) if (outcome.code) assert.equal(service.invoke('readSetup', {}, materials[index]!.setupToken).status, 'restricted_setup');
  for (const resident of residents) assert.equal(service.invoke('self', {}, resident.input.runtimeToken).agentId, resident.agentId);
});

test('concurrent setup submissions activate one named owner and the original saved session resolves the result', { timeout: 15_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'm1-same-setup-concurrent-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'test.sqlite'), f = fixture(t, {}, databasePath), resident = agent(f), material = setup(f, resident);
  const input = { operationId: op(), username: 'Only_One', email: 'only-one@example.test', password, sessionToken: proof(), recoveryToken: proof(), credentialsSaved: true }; f.store.close();
  const command: ConcurrentCommand = { action: 'completeSetup', input, token: material.setupToken };
  const outcomes = await compete(databasePath, [command, command]);
  assert.equal(outcomes.filter((value) => value.result).length, 1);
  assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), ['authentication_failed']);
  const current = openM1Store({ ...identity, databasePath }); t.after(() => current.close());
  const service = createM1Service(current, { now: () => 1_000_000 });
  assert.equal(service.invoke('receipt', { operationId: input.operationId, scope: `setup:${material.setupToken.split('.')[0]}`, action: 'completeSetup' }, input.sessionToken).ownerId, resident.ownerId);
  assert.equal(current.read((tx) => tx.find('bindings', { agentId: resident.agentId, active: true }).length), 1);
});

test('V03/V06: two concurrent authenticated owners cannot claim the same initial capability', { timeout: 15_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'm1-claim-concurrent-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'test.sqlite'), f = fixture(t, {}, databasePath);
  const owners = [account(f), account(f)], resident = agent(f), material = handoff(f, resident);
  f.store.close();
  const outcomes = await compete(databasePath, owners.map((owner) => ({ action: 'claimAgent', input: { operationId: op(), agentId: resident.agentId, expectedGeneration: material.generation, handoffToken: material.handoffToken }, token: owner.sessionToken })));
  assert.equal(outcomes.filter((value) => value.result).length, 1);
  assert.deepEqual(outcomes.filter((value) => value.code).map((value) => value.code), ['authentication_failed']);
  const current = openM1Store({ ...identity, databasePath }); t.after(() => current.close());
  const service = createM1Service(current, { now: () => 1_000_000 });
  assert.equal(current.read((tx) => tx.find('bindings', { agentId: resident.agentId, active: true }).length), 1);
  assert.equal(service.invoke('self', {}, resident.input.runtimeToken).agentId, resident.agentId);
  assert.equal(service.invoke('registrationResult', { attemptId: resident.input.attemptId }, resident.input.continuationToken).agentId, resident.agentId);
});
