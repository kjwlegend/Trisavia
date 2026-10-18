import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import { createM1Service } from '../../apps/platform/application/m1-service.ts';
import { M1_TABLES, type JsonObject } from '../../apps/platform/contracts/store.ts';
import { M1Error } from '../../apps/platform/domains/common/errors.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { registerM1Routes } from '../../apps/platform/transport/http/m1-routes.ts';

const op = () => randomUUID();
const token = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
const rejects = (code: string, work: () => unknown) => assert.throws(work, (error) => error instanceof M1Error && error.code === code);
const selector = (agentId: string, profile: JsonObject) => ({ agentId, operationId: op(), expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion });

function fixture(t: TestContext, fields: JsonObject = { displayName: 'Synthetic resident', avatar: { template: 'basic', color: 'blue' }, bio: 'Public biography', interests: ['maps'] }) {
  const store = openM1Store({ databasePath: ':memory:', instanceId: 'crud-instance', recoveryEpoch: 'crud-epoch' });
  t.after(() => store.close());
  const service = createM1Service(store), call = service.invoke;
  const ownerId = randomUUID(), sessionToken = token();
  call('registerOwner', { operationId: op(), attemptId: ownerId, username: 'Crud_Owner', email: 'crud@example.test', password: 'synthetic private password', sessionToken, recoveryToken: token(), credentialsSaved: true });
  const inviteToken = token(); call('issueInvite', { operationId: op(), inviteToken }, sessionToken);
  const runtimeToken = token(), registration = call('register', { operationId: op(), attemptId: randomUUID(), runtimeToken, continuationToken: token(), inviteToken });
  const agentId = registration.agentId as string;
  let profile = call('readProfile', { agentId }, runtimeToken);
  profile = call('saveDraft', { ...selector(agentId, profile), fields }, runtimeToken);
  profile = call('publishProfile', selector(agentId, profile), runtimeToken);
  const member = call('join', { operationId: op(), agentId, expectedVersion: 1, expectedProfileVersion: profile.version }, runtimeToken);
  return { store, call, service, ownerId, sessionToken, runtimeToken, agentId, profile, member };
}
type Fixture = ReturnType<typeof fixture>;
function policy(f: Fixture, mode: string, lockedFields: string[]) {
  const profile = f.call('readProfile', { agentId: f.agentId }, f.sessionToken);
  return f.call('profilePolicy', { ...selector(f.agentId, profile), mode, lockedFields }, f.sessionToken);
}

test('draft deletion removes explicit keys, omitted fields stay intact and the public snapshot is independent', (t) => {
  const f = fixture(t);
  const emptied = f.call('saveDraft', { ...selector(f.agentId, f.profile), fields: { bio: '', interests: [] } }, f.runtimeToken);
  assert.equal((emptied.draft as JsonObject).bio, ''); assert.deepEqual((emptied.draft as JsonObject).interests, []);
  assert.equal((emptied.draft as JsonObject).displayName, 'Synthetic resident');
  const mixed = f.call('saveDraft', { ...selector(f.agentId, emptied), fields: { bio: 'Replacement' }, removeFields: ['interests'] }, f.runtimeToken);
  assert.equal((mixed.draft as JsonObject).bio, 'Replacement'); assert.equal(Object.hasOwn(mixed.draft as JsonObject, 'interests'), false);
  const input = { ...selector(f.agentId, mixed), fields: {}, removeFields: ['bio', 'interests'] };
  const removed = f.call('saveDraft', input, f.runtimeToken);
  assert.deepEqual(removed.draft, { displayName: 'Synthetic resident', avatar: { template: 'basic', color: 'blue' } }); assert.deepEqual(removed.published, f.profile.published);
  assert.equal(removed.publishedVersion, f.profile.publishedVersion); assert.equal(removed.confirmationSource, 'runtime_declaration');
  assert.deepEqual(f.call('saveDraft', input, f.runtimeToken), removed);
  const published = f.call('publishProfile', selector(f.agentId, removed), f.runtimeToken);
  assert.deepEqual(published.published, removed.draft);
});

test('removeFields rejects duplicates, unknown fields, null, conflicting sets and omitted fields objects without writing', (t) => {
  const f = fixture(t);
  const commands = [
    { fields: {}, removeFields: ['bio', 'bio'] }, { fields: {}, removeFields: ['unknown'] },
    { fields: {}, removeFields: ['displayName'] }, { fields: {}, removeFields: ['avatar'] },
    { fields: {}, removeFields: null }, { fields: {}, removeFields: 'bio' }, { fields: { bio: null } },
    { fields: { bio: '' }, removeFields: ['bio'] }, { removeFields: ['bio'] },
  ];
  const before = f.store.read((tx) => ({ facts: tx.find('facts').length, operations: tx.find('operations').length }));
  for (const command of commands) rejects('invalid_request', () => f.call('saveDraft', { ...selector(f.agentId, f.profile), ...command }, f.runtimeToken));
  assert.deepEqual(f.call('readProfile', { agentId: f.agentId }, f.runtimeToken), Object.fromEntries(Object.entries(f.profile).filter(([key]) => !['operationId', 'outcome', 'receiptId', 'serverTime'].includes(key))));
  assert.deepEqual(f.store.read((tx) => ({ facts: tx.find('facts').length, operations: tx.find('operations').length })), before);
});

test('draft removal obeys current owner locks, policy/version checks and the authenticated Agent target', (t) => {
  const f = fixture(t), locked = policy(f, 'agent_autonomous', ['bio']);
  rejects('field_locked', () => f.call('saveDraft', { ...selector(f.agentId, locked), fields: {}, removeFields: ['bio'] }, f.runtimeToken));
  rejects('version_conflict', () => f.call('saveDraft', { ...selector(f.agentId, f.profile), fields: {}, removeFields: ['bio'] }, f.runtimeToken));
  rejects('version_conflict', () => f.call('saveDraft', { ...selector(f.agentId, locked), expectedPolicyVersion: 1, fields: {}, removeFields: ['bio'] }, f.runtimeToken));
  const other = token(); f.call('register', { operationId: op(), attemptId: randomUUID(), runtimeToken: other, continuationToken: token() });
  rejects('target_not_accessible', () => f.call('saveDraft', { ...selector(f.agentId, locked), fields: {}, removeFields: ['bio'] }, other));
  const owner = f.call('saveDraft', { ...selector(f.agentId, locked), fields: {}, removeFields: ['bio'] }, f.sessionToken);
  assert.equal(Object.hasOwn(owner.draft as JsonObject, 'bio'), false);
  assert.equal((owner.published as JsonObject).bio, 'Public biography');
});

test('unpublish returns an exact receipt and hides only the public projection; new no-op commands preserve the profile version', async (t) => {
  const f = fixture(t), app = Fastify({ logger: false }); registerM1Routes(app, f.service); t.after(() => app.close());
  const url = `/v1/public/agents/${f.agentId}`;
  assert.equal((await app.inject({ url })).statusCode, 200);
  const beforeAgent = f.call('self', {}, f.runtimeToken), beforeBindings = f.store.read((tx) => tx.find('bindings', { agentId: f.agentId }));
  const input = selector(f.agentId, f.profile);
  const response = await app.inject({ method: 'POST', url: `/v1/agents/${f.agentId}/profile/unpublish`, headers: { authorization: `Bearer ${f.runtimeToken}` }, payload: { operationId: input.operationId, expectedVersion: input.expectedVersion, expectedPolicyVersion: input.expectedPolicyVersion } });
  assert.equal(response.statusCode, 200); const withdrawn = response.json();
  assert.equal(withdrawn.changed, true); assert.equal(withdrawn.version, Number(f.profile.version) + 1);
  assert.equal(withdrawn.published, null); assert.equal(withdrawn.confirmationSource, null); assert.equal(withdrawn.publishedVersion, f.profile.publishedVersion); assert.deepEqual(withdrawn.draft, f.profile.draft);
  assert.deepEqual(f.call('unpublishProfile', input, f.runtimeToken), withdrawn);
  const receipt = { operationId: input.operationId, scope: `agent:${f.agentId}`, action: 'unpublishProfile' };
  assert.deepEqual(f.call('receipt', receipt, f.runtimeToken), withdrawn);
  assert.equal((await app.inject({ url })).statusCode, 404);
  const afterAgent = f.call('self', {}, f.runtimeToken);
  for (const field of ['agentId', 'ownerId', 'instanceId', 'runtimeVersion']) assert.equal(afterAgent[field], beforeAgent[field]);
  assert.deepEqual(afterAgent.membership, beforeAgent.membership);
  assert.deepEqual(f.store.read((tx) => tx.find('bindings', { agentId: f.agentId })), beforeBindings);
  const noOpInput = selector(f.agentId, withdrawn), noOp = f.call('unpublishProfile', noOpInput, f.runtimeToken);
  assert.equal(noOp.changed, false); assert.equal(noOp.version, withdrawn.version);
  assert.deepEqual(f.call('unpublishProfile', noOpInput, f.runtimeToken), noOp);
  const facts = f.store.read((tx) => tx.find('facts', { action: 'unpublishProfile' }));
  assert.equal(facts.length, 2); assert.equal(facts.find((row) => row.data.operationId === input.operationId)?.data.changed, true); assert.equal(facts.find((row) => row.data.operationId === noOpInput.operationId)?.data.changed, false);
  rejects('version_conflict', () => f.call('unpublishProfile', { ...input, operationId: op() }, f.runtimeToken));
  rejects('version_conflict', () => f.call('unpublishProfile', { ...noOpInput, operationId: op(), expectedPolicyVersion: 999 }, f.runtimeToken));
});

test('unpublish keeps publish authorization: owner modes, owner pause, published field locks and platform restriction', (t) => {
  const f = fixture(t);
  for (const mode of ['owner_specified', 'proposal_required']) {
    const profile = policy(f, mode, []);
    rejects('confirmation_required', () => f.call('unpublishProfile', selector(f.agentId, profile), f.runtimeToken));
  }
  let profile = policy(f, 'agent_autonomous', ['bio']);
  assert.throws(() => f.call('unpublishProfile', selector(f.agentId, profile), f.runtimeToken), (error) => error instanceof M1Error && error.code === 'field_locked' && error.message === 'Owner locked a published field');
  profile = f.call('unpublishProfile', selector(f.agentId, profile), f.sessionToken);
  assert.equal(profile.changed, true);
  // Required authorization still applies to already-unpublished no-ops.
  profile = policy(f, 'owner_specified', []);
  rejects('confirmation_required', () => f.call('unpublishProfile', selector(f.agentId, profile), f.runtimeToken));
  profile = policy(f, 'agent_autonomous', []);
  f.call('participation', { operationId: op(), agentId: f.agentId, expectedVersion: f.member.version, paused: true }, f.sessionToken);
  rejects('participation_paused', () => f.call('unpublishProfile', selector(f.agentId, profile), f.runtimeToken));
  assert.equal(f.call('unpublishProfile', selector(f.agentId, profile), f.sessionToken).changed, false);
  f.store.transaction((tx) => { const row = tx.get('memberships', f.agentId)!; tx.update('memberships', { ...row, version: row.version + 1, data: { ...row.data, platformRestricted: true } }, row.version); });
  rejects('platform_restricted', () => f.call('unpublishProfile', selector(f.agentId, profile), f.sessionToken));
});

test('an absent locked field does not block unpublish, but a revoked runtime cannot commit a previously read request', (t) => {
  const f = fixture(t, { displayName: 'Minimal', avatar: { template: 'basic', color: 'cream' } });
  let profile = policy(f, 'agent_autonomous', ['bio']);
  profile = f.call('unpublishProfile', selector(f.agentId, profile), f.runtimeToken);
  assert.equal(profile.changed, true);
  const pending = selector(f.agentId, profile);
  f.call('revokeRuntime', { operationId: op(), agentId: f.agentId, expectedVersion: 1 }, f.sessionToken);
  rejects('authentication_failed', () => f.call('unpublishProfile', pending, f.runtimeToken));
  assert.equal(f.call('unpublishProfile', selector(f.agentId, profile), f.sessionToken).changed, false);
});

test('capabilities describes only registered canonical foundation routes, actor scopes and required versions', async (t) => {
  const f = fixture(t), app = Fastify({ logger: false }); registerM1Routes(app, f.service); t.after(() => app.close());
  const response = await app.inject({ url: '/v1/capabilities' }); assert.equal(response.statusCode, 200);
  const capabilities = response.json();
  assert.equal(capabilities.ownerRecovery, true); assert.equal(capabilities.scheduling, false); assert.equal(capabilities.perception, false); assert.equal(capabilities.interaction, false);
  assert.equal(capabilities.operations.length, 13);
  const actions = new Set<string>();
  for (const operation of capabilities.operations) {
    assert.equal(actions.has(operation.action), false); actions.add(operation.action);
    assert.equal(app.hasRoute({ method: operation.method, url: operation.path }), true);
  }
  const removal = capabilities.operations.find((operation: JsonObject) => operation.action === 'saveDraft');
  assert.deepEqual(removal.actors, ['runtime', 'owner_session']);
  assert.deepEqual(removal.receiptScopes, { runtime: 'agent:{agentId}', owner_session: 'owner:{ownerId}' });
  assert.deepEqual(removal.requiredVersions, ['expectedVersion', 'expectedPolicyVersion']);
  assert.deepEqual(capabilities.operations.find((operation: JsonObject) => operation.action === 'join').requiredVersions, ['expectedVersion', 'expectedProfileVersion']);
  assert.equal(response.body.includes(f.runtimeToken), false); assert.equal(response.body.includes('crud@example.test'), false);
});

test('self effective actions reuse current publication and participation checks without writing or authorizing cached requests', (t) => {
  const f = fixture(t);
  const snapshot = () => f.store.read((tx) => JSON.stringify(M1_TABLES.map((table) => tx.find(table))));
  const before = snapshot();
  const initial = f.call('self', {}, f.runtimeToken).effectiveActions as Record<string, JsonObject>;
  assert.equal(initial.publishProfile?.allowed, true); assert.equal(initial.unpublishProfile?.allowed, true);
  assert.equal(snapshot() === before, true, 'Reading effective actions must not write a fact, receipt or business state');
  const profile = policy(f, 'owner_specified', ['bio']);
  const current = f.call('self', {}, f.runtimeToken).effectiveActions as Record<string, JsonObject>;
  assert.deepEqual(current.publishProfile?.blockedBy, ['confirmation_required']); assert.deepEqual(current.unpublishProfile?.blockedBy, ['confirmation_required']);
  assert.deepEqual(current.saveDraft?.removableFields, ['interests']); assert.equal((current.saveDraft?.writableFields as string[]).includes('bio'), false);
  rejects('confirmation_required', () => f.call('unpublishProfile', selector(f.agentId, profile), f.runtimeToken));
  f.call('participation', { operationId: op(), agentId: f.agentId, expectedVersion: f.member.version, paused: true }, f.sessionToken);
  const paused = f.call('self', {}, f.runtimeToken).effectiveActions as Record<string, JsonObject>;
  for (const action of ['saveDraft', 'publishProfile', 'unpublishProfile', 'join']) assert.deepEqual(paused[action]?.blockedBy, ['participation_paused']);
  assert.equal(paused.leave?.allowed, true); assert.equal(paused.readProfile?.allowed, true);
  const other = token(); const otherAgent = f.call('register', { operationId: op(), attemptId: randomUUID(), runtimeToken: other, continuationToken: token() }).agentId;
  const isolated = f.call('self', {}, other).effectiveActions as Record<string, JsonObject>;
  assert.deepEqual(isolated.publishProfile?.blockedBy, ['profile_validation_failed']); assert.deepEqual(isolated.join?.blockedBy, ['admission_requirements_unmet']);
  rejects('target_not_accessible', () => f.call('readProfile', { agentId: otherAgent }, f.runtimeToken));
  f.store.transaction((tx) => { const row = tx.get('memberships', f.agentId)!; tx.update('memberships', { ...row, version: row.version + 1, data: { ...row.data, ownerPaused: false, platformRestricted: true } }, row.version); });
  const restricted = f.call('self', {}, f.runtimeToken).effectiveActions as Record<string, JsonObject>;
  assert.deepEqual(restricted.saveDraft?.blockedBy, ['platform_restricted']); assert.equal(restricted.leave?.allowed, true);
  const replacement = token(); f.call('replaceRuntime', { operationId: op(), agentId: f.agentId, expectedVersion: 1, runtimeToken: replacement }, f.sessionToken);
  rejects('authentication_failed', () => f.call('self', {}, f.runtimeToken));
  assert.equal(f.call('self', {}, replacement).runtimeVersion, 2);
});
