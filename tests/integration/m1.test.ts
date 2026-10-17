import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../../apps/platform/app.ts';
import {
  buildLocalSummary, newAgentMaterial, newCredential, newOperationId,
  readPrivateState, saveNewPrivateState,
} from '../../scripts/m1-client.ts';
import type { AgentMaterial } from '../../scripts/m1-client.ts';

interface Registration {
  agentId: string; ownerId: string; managementStatus: 'pending_setup' | 'managed';
  operationId: string; registrationAttemptId: string;
}
interface Agent extends Registration, AgentMaterial {}
interface Profile {
  agentId: string; version: number; policyVersion: number;
  mode: string; lockedFields: string[]; published: Record<string, unknown> | null;
  publishedVersion: number;
}
interface Membership {
  agentId: string; version: number; state: 'not_joined' | 'joined' | 'left';
  ownerPaused: boolean; ownerPauseVersion: number;
  platformRestricted: boolean; platformVersion: number;
}
interface Owner {
  ownerId: string; username: string; email: string; sessionToken: string; recoveryToken: string; password: string;
  initialHandoffToken: string; setupToken: string;
}
interface Result<T> { status: number; body: T }

function receiptUrl(operationId: string, scope: string, action: string): string {
  return `/v1/operations/${encodeURIComponent(operationId)}?${new URLSearchParams({ scope, action })}`;
}

function fixture(t: TestContext) {
  let now = Date.UTC(2026, 9, 14, 12);
  const app = buildApp({ instanceId: 'm1-integration', recoveryEpoch: 'epoch-1', clock: () => now });
  t.after(async () => { await app.close(); });
  return { app, advance: (milliseconds: number) => { now += milliseconds; } };
}

async function request<T>(app: FastifyInstance, method: HTTPMethods, url: string,
  payload?: Record<string, unknown>, bearer?: string): Promise<Result<T>> {
  const response = await app.inject({ method, url,
    ...(payload === undefined ? {} : { payload }),
    ...(bearer === undefined ? {} : { headers: { authorization: `Bearer ${bearer}` } }),
  });
  let body: T;
  try { body = response.json<T>(); } catch { throw new Error(`Invalid JSON response for ${method} ${url}`); }
  return { status: response.statusCode, body };
}
async function ok<T>(app: FastifyInstance, method: HTTPMethods, url: string,
  payload?: Record<string, unknown>, bearer?: string): Promise<T> {
  const result = await request<T>(app, method, url, payload, bearer);
  assert.equal(result.status, 200, `Expected successful HTTP status at ${method} ${url}`);
  noSecrets(result.body, [bearer, ...Object.entries(payload ?? {})
    .filter(([key]) => /token|password/i.test(key)).map(([, value]) => typeof value === 'string' ? value : undefined)]
    .filter((value): value is string => value !== undefined));
  if (method !== 'GET') {
    const receipt = result.body as Record<string, unknown>;
    assert.equal(receipt.outcome, 'committed', 'Successful writes require a committed receipt');
    assert.equal(typeof receipt.receiptId, 'string', 'Successful writes require a receipt reference');
  }
  return result.body;
}
async function rejected(app: FastifyInstance, method: HTTPMethods, url: string,
  payload?: Record<string, unknown>, bearer?: string): Promise<string> {
  const result = await request<{ error: { code: string } }>(app, method, url, payload, bearer);
  assert(result.status >= 400 && result.status < 500, `Expected rejected HTTP status at ${method} ${url}; got ${result.status}`);
  assert.equal(typeof result.body.error?.code, 'string', 'Rejection must have a stable error code');
  noSecrets(result.body, [bearer, ...Object.entries(payload ?? {})
    .filter(([key]) => /token|password/i.test(key)).map(([, value]) => typeof value === 'string' ? value : undefined)]
    .filter((value): value is string => value !== undefined));
  return result.body.error.code;
}
function noSecrets(value: unknown, secrets: string[]) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    assert(!serialized.includes(secret), 'Secret must not appear in the response or summary');
    const separator = secret.indexOf('.');
    if (separator >= 0) assert(!serialized.includes(secret.slice(separator + 1)), 'Credential secret must not appear separately');
  }
}
async function register(app: FastifyInstance, inviteToken?: string): Promise<Agent> {
  const material = newAgentMaterial();
  const operationId = newOperationId();
  const result = await ok<Registration>(app, 'POST', '/v1/registrations', {
    ...material, operationId, ...(inviteToken ? { inviteToken } : {}),
  });
  assert.equal(result.registrationAttemptId, material.attemptId);
  noSecrets(result, [material.runtimeToken, material.continuationToken]);
  return { ...result, ...material };
}
async function manage(app: FastifyInstance, agent: Agent): Promise<Owner> {
  const initialHandoffToken = newCredential('handoff');
  const handoff = await ok<{ handoffId: string }>(app, 'POST', '/v1/agent/self/handoffs', {
    operationId: newOperationId(), expectedGeneration: 0, handoffToken: initialHandoffToken,
  }, agent.continuationToken);
  const setupToken = newCredential('setup');
  await ok(app, 'POST', '/v1/owner-setups', { operationId: newOperationId(), setupToken }, initialHandoffToken);
  const sessionToken = newCredential('session');
  const recoveryToken = newCredential('recovery');
  const password = newCredential('password');
  const username = `Owner_${randomUUID().slice(0, 8)}`, email = `${randomUUID()}@example.test`;
  await ok(app, 'POST', '/v1/owner/setup/complete', {
    operationId: newOperationId(), username, email, password, recoveryToken, sessionToken, credentialsSaved: true,
  }, setupToken);
  assert.equal(typeof handoff.handoffId, 'string');
  return { ownerId: agent.ownerId, username, email, sessionToken, recoveryToken, password, initialHandoffToken, setupToken };
}
async function profile(app: FastifyInstance, agent: Agent, bearer = agent.runtimeToken): Promise<Profile> {
  return ok(app, 'GET', `/v1/agents/${agent.agentId}/profile`, undefined, bearer);
}
async function membership(app: FastifyInstance, agent: Agent, bearer = agent.runtimeToken): Promise<Membership> {
  return ok(app, 'GET', `/v1/agents/${agent.agentId}/membership`, undefined, bearer);
}
async function publish(app: FastifyInstance, agent: Agent, name = 'Synthetic Resident') {
  const current = await profile(app, agent);
  const draft = await ok<Profile>(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
    operationId: newOperationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion,
    fields: { displayName: name, avatar: { template: 'basic', color: 'olive' } },
  }, agent.runtimeToken);
  return ok<Profile>(app, 'POST', `/v1/agents/${agent.agentId}/profile/publish`, {
    operationId: newOperationId(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion,
  }, agent.runtimeToken);
}
async function joinWorld(app: FastifyInstance, agent: Agent) {
  const current = await membership(app, agent);
  const currentProfile = await profile(app, agent);
  return ok<Membership>(app, 'POST', `/v1/agents/${agent.agentId}/membership/join`, {
    operationId: newOperationId(), expectedVersion: current.version, expectedProfileVersion: currentProfile.version,
  }, agent.runtimeToken);
}

test('INT-01: independent owners; registration, local configuration and join precede owner access', async t => {
  const { app } = fixture(t);
  const capabilities = await ok<{ apiVersion: string; instanceId: string; scheduling: boolean }>(app, 'GET', '/v1/capabilities');
  assert.equal(capabilities.apiVersion, 'v1');
  assert.equal(capabilities.instanceId, 'm1-integration');
  assert.equal(capabilities.scheduling, false);
  const catalog = await ok<{ version: number }>(app, 'GET', '/v1/avatar-catalog');
  assert.equal(catalog.version, 1);
  const directory = await mkdtemp(join(tmpdir(), 'm1-private-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'agent.json');
  const material = newAgentMaterial();
  await saveNewPrivateState(path, { ...material, registrationOperationId: newOperationId(), instanceId: 'm1-integration', apiVersion: 'v1', documentationVersion: 'v1' });
  const state = await readPrivateState(path);
  const registration = await ok<Registration>(app, 'POST', '/v1/registrations', {
    operationId: state.registrationOperationId, attemptId: state.attemptId, runtimeToken: state.runtimeToken, continuationToken: state.continuationToken,
  });
  const a1 = { ...registration, ...material };
  const b1 = await register(app);
  assert.notEqual(a1.agentId, b1.agentId);
  assert.notEqual(a1.ownerId, b1.ownerId);
  assert.equal(a1.managementStatus, 'pending_setup');
  const resumed = await ok<Registration>(app, 'GET', `/v1/registration-attempts/${state.attemptId}`, undefined, state.continuationToken);
  assert.equal(resumed.agentId, a1.agentId);
  await publish(app, a1);
  const joined = await joinWorld(app, a1);
  assert.equal(joined.state, 'joined');
  const handoff = await ok<{ generation: number }>(app, 'POST', '/v1/agent/self/handoffs', {
    operationId: newOperationId(), expectedGeneration: 0, handoffToken: newCredential('handoff'),
  }, a1.continuationToken);
  const declared = await ok<{ deliveryStatus: 'client_declared_delivered' }>(app, 'POST', '/v1/agent/self/delivery-declarations', {
    operationId: newOperationId(), generation: handoff.generation,
  }, a1.runtimeToken);
  const summary = buildLocalSummary({ instanceId: state.instanceId, agentId: a1.agentId,
    ownerId: a1.ownerId, operationId: a1.operationId, managementStatus: 'pending_setup',
    deliveryStatus: declared.deliveryStatus, localStateReread: true, profilePublished: true, membershipState: joined.state });
  assert.equal(summary.registration, 'completed');
  assert.equal(summary.local_setup, 'completed');
  assert.equal(summary.schedule_configuration, 'not_configured');
  assert.equal(summary.periodic_run_verification, 'not_verified');
  assert.equal(summary.managementStatus, 'pending_setup');
  noSecrets(summary, [a1.runtimeToken, a1.continuationToken]);
  await chmod(path, 0o644);
  await assert.rejects(readPrivateState(path), /private regular file/);
});

test('INT-02: discarded registration response and concurrent retries resolve one resident', async t => {
  const { app } = fixture(t);
  const material = newAgentMaterial();
  const payload = { ...material, operationId: newOperationId() };
  await ok(app, 'POST', '/v1/registrations', payload); // Deliberately discard a successful response.
  const repeated = await Promise.all(Array.from({ length: 4 }, () => ok<Registration>(app, 'POST', '/v1/registrations', payload)));
  const recovered = await ok<Registration>(app, 'GET', `/v1/registration-attempts/${material.attemptId}`, undefined, material.continuationToken);
  assert.equal(new Set(repeated.map(value => value.agentId)).size, 1);
  for (const result of repeated) assert.equal(result.agentId, recovered.agentId);
  assert.equal(await rejected(app, 'POST', '/v1/registrations', { ...payload, operationId: newOperationId() }), 'idempotency_payload_mismatch');
  assert.equal((await ok<Registration>(app, 'GET', `/v1/registration-attempts/${material.attemptId}`, undefined, material.continuationToken)).agentId, recovered.agentId);
});

test('INT-03: changed registration payload conflicts and public identifiers grant no access', async t => {
  const { app } = fixture(t);
  const agent = await register(app);
  await rejected(app, 'POST', '/v1/registrations', {
    operationId: newOperationId(), attemptId: agent.attemptId,
    runtimeToken: newCredential('changed'), continuationToken: agent.continuationToken,
  });
  for (const bearer of [undefined, agent.agentId, agent.ownerId, agent.attemptId]) {
    await rejected(app, 'GET', `/v1/registration-attempts/${agent.attemptId}`, undefined, bearer);
    await rejected(app, 'GET', `/v1/owner/agents/${agent.agentId}`, undefined, bearer);
  }
  const unchanged = await ok<Registration>(app, 'GET', '/v1/agent/self', undefined, agent.runtimeToken);
  assert.equal(unchanged.agentId, agent.agentId);
});

test('INT-04: handoff preview is read-only and renewal invalidates the prior generation', async t => {
  const { app, advance } = fixture(t);
  const agent = await register(app);
  const oldToken = newCredential('handoff');
  const old = await ok<{ handoffId: string; generation: number }>(app, 'POST', '/v1/agent/self/handoffs', {
    operationId: newOperationId(), expectedGeneration: 0, handoffToken: oldToken,
  }, agent.continuationToken);
  await ok(app, 'GET', `/v1/owner-handoffs/${old.handoffId}`, undefined, oldToken);
  await ok(app, 'GET', `/v1/owner-handoffs/${old.handoffId}`, undefined, oldToken);
  const nextToken = newCredential('handoff');
  const next = await ok<{ handoffId: string; generation: number }>(app, 'POST', '/v1/agent/self/handoffs', {
    operationId: newOperationId(), expectedGeneration: old.generation, handoffToken: nextToken,
  }, agent.continuationToken);
  await rejected(app, 'POST', '/v1/owner-setups', { operationId: newOperationId(), setupToken: newCredential('setup') }, oldToken);
  await ok(app, 'POST', '/v1/owner-setups', { operationId: newOperationId(), setupToken: newCredential('setup') }, nextToken);
  advance(15 * 60 * 1000 + 1);
  await rejected(app, 'GET', `/v1/owner-handoffs/${next.handoffId}`, undefined, nextToken);
  await ok(app, 'POST', '/v1/agent/self/handoffs', {
    operationId: newOperationId(), expectedGeneration: next.generation, handoffToken: newCredential('handoff'),
  }, agent.continuationToken);
});

test('INT-05: setup is restricted; complete response can be lost after independent proofs were saved', async t => {
  const { app } = fixture(t);
  const agent = await register(app);
  const handoffToken = newCredential('handoff');
  await ok(app, 'POST', '/v1/agent/self/handoffs', { operationId: newOperationId(), expectedGeneration: 0, handoffToken }, agent.continuationToken);
  const setupToken = newCredential('setup');
  await ok(app, 'POST', '/v1/owner-setups', { operationId: newOperationId(), setupToken }, handoffToken);
  await ok(app, 'GET', '/v1/owner/setup', undefined, setupToken); // The exchange response could have been lost.
  await rejected(app, 'GET', '/v1/owner/agents', undefined, setupToken);
  await rejected(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken: newCredential('invite') }, setupToken);
  const sessionToken = newCredential('session');
  const payload = { operationId: newOperationId(), username: 'Integration_Owner', email: 'integration-owner@example.test', password: newCredential('password'), recoveryToken: newCredential('recovery'), sessionToken, credentialsSaved: true };
  await ok(app, 'POST', '/v1/owner/setup/complete', payload, setupToken); // Discard completion response.
  await ok(app, 'GET', '/v1/owner/agents', undefined, sessionToken);
  await ok(app, 'GET', receiptUrl(payload.operationId, `setup:${setupToken.split('.')[0]}`, 'completeSetup'), undefined, sessionToken);
  await rejected(app, 'POST', '/v1/owner/setup/complete', { ...payload, operationId: newOperationId(), sessionToken: newCredential('session') }, setupToken);
  await rejected(app, 'POST', '/v1/agent/self/handoffs', { operationId: newOperationId(), expectedGeneration: 1, handoffToken: newCredential('handoff') }, agent.continuationToken);
});

test('INT-06: later login and lost recovery response use saved next-generation proofs', async t => {
  const { app, advance } = fixture(t);
  const agent = await register(app);
  const owner = await manage(app, agent);
  const freshSession = newCredential('session');
  await ok(app, 'POST', '/v1/owner/sessions', { operationId: newOperationId(), identifier: owner.username, password: owner.password, sessionToken: freshSession });
  await ok(app, 'GET', `/v1/owner/agents/${agent.agentId}`, undefined, freshSession);
  await rejected(app, 'POST', '/v1/owner/sessions', { operationId: newOperationId(), identifier: owner.email, password: newCredential('incorrect'), sessionToken: newCredential('session') });
  await rejected(app, 'GET', '/v1/owner/agents', undefined, agent.runtimeToken);
  const unusedInvite = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken: unusedInvite }, freshSession);
  const recoveryPayload = { operationId: newOperationId(), password: newCredential('password'),
    recoveryToken: newCredential('recovery'), sessionToken: newCredential('session'), credentialsSaved: true };
  await ok(app, 'POST', '/v1/owner/recoveries', recoveryPayload, owner.recoveryToken); // Deliberately discard response.
  await ok(app, 'GET', receiptUrl(recoveryPayload.operationId, `owner:${owner.ownerId}`, 'recover'), undefined, recoveryPayload.sessionToken);
  await rejected(app, 'POST', '/v1/owner/recoveries', recoveryPayload, owner.recoveryToken);
  await rejected(app, 'GET', '/v1/owner/agents', undefined, freshSession);
  await rejected(app, 'POST', '/v1/registrations', { operationId: newOperationId(), ...newAgentMaterial(), inviteToken: unusedInvite });
  assert.equal((await ok<Registration>(app, 'GET', '/v1/agent/self', undefined, agent.runtimeToken)).agentId, agent.agentId);
  await ok(app, 'GET', `/v1/owner/agents/${agent.agentId}`, undefined, recoveryPayload.sessionToken);
  advance(12 * 60 * 60 * 1000 + 1);
  await rejected(app, 'GET', '/v1/owner/agents', undefined, recoveryPayload.sessionToken);
  const laterSession = newCredential('session');
  await ok(app, 'POST', '/v1/owner/sessions', { operationId: newOperationId(), identifier: owner.email,
    password: recoveryPayload.password, sessionToken: laterSession });
  await ok(app, 'GET', `/v1/owner/agents/${agent.agentId}`, undefined, laterSession);
});

test('INT-07: one owner manages two agents with a single-use invite and independent credentials', async t => {
  const { app } = fixture(t);
  const a1 = await register(app);
  const owner = await manage(app, a1);
  const inviteToken = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, owner.sessionToken);
  const a2 = await register(app, inviteToken);
  assert.equal(a2.ownerId, owner.ownerId);
  assert.notEqual(a2.agentId, a1.agentId);
  const self = await ok<Registration>(app, 'GET', '/v1/agent/self', undefined, a2.runtimeToken);
  assert.equal(self.agentId, a2.agentId);
  await rejected(app, 'GET', '/v1/owner/agents', undefined, a2.runtimeToken);
  await rejected(app, 'GET', `/v1/agents/${a1.agentId}/profile`, undefined, a2.runtimeToken);
  await ok(app, 'GET', `/v1/owner/agents/${a2.agentId}`, undefined, owner.sessionToken);
  await rejected(app, 'POST', '/v1/registrations', { operationId: newOperationId(), ...newAgentMaterial(), inviteToken });
});

test('INT-08: invitation expiry, revocation, contention and lost-response continuation are bounded', async t => {
  const { app, advance } = fixture(t);
  const a1 = await register(app);
  const owner = await manage(app, a1);
  const inviteToken = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, owner.sessionToken);
  const payloads = [0, 1].map(() => ({ operationId: newOperationId(), ...newAgentMaterial(), inviteToken }));
  const results = await Promise.all(payloads.map(payload => request<Registration>(app, 'POST', '/v1/registrations', payload)));
  assert.equal(results.filter(value => value.status >= 200 && value.status < 300).length, 1);
  const successIndex = results.findIndex(value => value.status >= 200 && value.status < 300);
  const successfulPayload = payloads[successIndex]!;
  const recovered = await ok<Registration>(app, 'GET', `/v1/registration-attempts/${successfulPayload.attemptId}`, undefined, successfulPayload.continuationToken);
  const retry = await ok<Registration>(app, 'POST', '/v1/registrations', successfulPayload);
  assert.equal(recovered.agentId, retry.agentId);
  const revokedToken = newCredential('invite');
  const revoked = await ok<{ inviteId: string; version: number }>(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken: revokedToken }, owner.sessionToken);
  await ok(app, 'POST', `/v1/owner/agent-invites/${revoked.inviteId}/revoke`, { operationId: newOperationId(), expectedVersion: revoked.version }, owner.sessionToken);
  await rejected(app, 'POST', '/v1/registrations', { operationId: newOperationId(), ...newAgentMaterial(), inviteToken: revokedToken });
  const expiredToken = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken: expiredToken }, owner.sessionToken);
  advance(24 * 60 * 60 * 1000 + 1);
  await rejected(app, 'POST', '/v1/registrations', { operationId: newOperationId(), ...newAgentMaterial(), inviteToken: expiredToken });
});

test('INT-09: owner list and explicit target reads stay correlated across delayed selection', async t => {
  const { app } = fixture(t);
  const a1 = await register(app);
  const owner = await manage(app, a1);
  const inviteToken = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, owner.sessionToken);
  const a2 = await register(app, inviteToken);
  const list = await ok<unknown>(app, 'GET', '/v1/owner/agents', undefined, owner.sessionToken);
  const serialized = JSON.stringify(list);
  assert(serialized.includes(a1.agentId) && serialized.includes(a2.agentId), 'Both authorized identities must appear');
  noSecrets(list, [a1.runtimeToken, a1.continuationToken, a2.runtimeToken, a2.continuationToken, owner.password, owner.recoveryToken]);
  const late = profile(app, a1, owner.sessionToken);
  const current = await profile(app, a2, owner.sessionToken);
  assert.equal(current.agentId, a2.agentId);
  assert.equal((await late).agentId, a1.agentId);
});

test('INT-10: another owner cannot read or mutate a different target', async t => {
  const { app } = fixture(t);
  const a1 = await register(app);
  const o1 = await manage(app, a1);
  const inviteToken = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, o1.sessionToken);
  const a2 = await register(app, inviteToken);
  const b1 = await register(app);
  const o2 = await manage(app, b1);
  const before = await profile(app, a1);
  await rejected(app, 'GET', `/v1/owner/agents/${a1.agentId}`, undefined, o2.sessionToken);
  await rejected(app, 'GET', `/v1/agents/${a1.agentId}/profile`, undefined, o2.sessionToken);
  await rejected(app, 'GET', `/v1/owner/agents/${a2.agentId}`, undefined, o2.sessionToken);
  await rejected(app, 'PUT', `/v1/owner/agents/${a1.agentId}/profile-policy`, { operationId: newOperationId(), expectedVersion: before.version, expectedPolicyVersion: before.policyVersion, mode: 'agent_autonomous', lockedFields: [] }, o2.sessionToken);
  await rejected(app, 'POST', `/v1/owner/agents/${a1.agentId}/runtime-access/revoke`, { operationId: newOperationId(), expectedVersion: 1 }, o2.sessionToken);
  const list = await ok<unknown>(app, 'GET', '/v1/owner/agents', undefined, o2.sessionToken);
  assert(!JSON.stringify(list).includes(a1.agentId), 'Other owner identity must not enter the list');
  assert(!JSON.stringify(list).includes(a2.agentId), 'Other owner second identity must not enter the list');
  const o1List = await ok<{ agents: Array<{ agentId: string }> }>(app, 'GET', '/v1/owner/agents', undefined, o1.sessionToken);
  assert.deepEqual(o1List.agents.map(value => value.agentId).sort(), [a1.agentId, a2.agentId].sort());
  assert.equal((await profile(app, a1, o1.sessionToken)).version, before.version);
});

test('INT-11: revoking A2 runtime does not revoke A1 or the owner management session', async t => {
  const { app } = fixture(t);
  const a1 = await register(app);
  const owner = await manage(app, a1);
  const inviteToken = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, owner.sessionToken);
  const a2 = await register(app, inviteToken);
  await ok(app, 'POST', `/v1/owner/agents/${a2.agentId}/runtime-access/revoke`, { operationId: newOperationId(), expectedVersion: 1 }, owner.sessionToken);
  await rejected(app, 'GET', '/v1/agent/self', undefined, a2.runtimeToken);
  assert.equal((await ok<Registration>(app, 'GET', '/v1/agent/self', undefined, a1.runtimeToken)).agentId, a1.agentId);
  await ok(app, 'GET', `/v1/owner/agents/${a2.agentId}`, undefined, owner.sessionToken);
  const nextRuntime = newCredential('runtime');
  const replacement = await ok<{ runtimeVersion: number }>(app, 'POST', `/v1/owner/agents/${a2.agentId}/runtime-access/replace`, {
    operationId: newOperationId(), expectedVersion: 2, runtimeToken: nextRuntime,
  }, owner.sessionToken);
  assert.equal(replacement.runtimeVersion, 3);
  assert.equal((await ok<Registration>(app, 'GET', '/v1/agent/self', undefined, nextRuntime)).agentId, a2.agentId);
  await rejected(app, 'GET', '/v1/agent/self', undefined, a2.runtimeToken);
  assert.equal((await ok<Registration>(app, 'GET', '/v1/agent/self', undefined, a1.runtimeToken)).agentId, a1.agentId);
});

test('INT-12: initial proofs stay invalid after owner binding and revocation blocks a prepared write', async t => {
  const { app } = fixture(t);
  const agent = await register(app);
  const owner = await manage(app, agent);
  await rejected(app, 'POST', '/v1/owner-setups', { operationId: newOperationId(), setupToken: newCredential('setup') }, owner.initialHandoffToken);
  await rejected(app, 'GET', `/v1/registration-attempts/${agent.attemptId}`, undefined, agent.continuationToken);
  const current = await profile(app, agent);
  await ok(app, 'POST', `/v1/owner/agents/${agent.agentId}/runtime-access/revoke`, { operationId: newOperationId(), expectedVersion: 1 }, owner.sessionToken);
  await rejected(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
    operationId: newOperationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion,
    fields: { displayName: 'Must not commit', avatar: { template: 'basic', color: 'blue' } },
  }, agent.runtimeToken);
  assert.equal((await profile(app, agent, owner.sessionToken)).version, current.version);
});

test('INT-13: basic catalog and three profile modes preserve publication authorization', async t => {
  const { app } = fixture(t);
  const agent = await register(app);
  const current = await profile(app, agent);
  assert.equal(current.mode, 'agent_autonomous');
  await rejected(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
    operationId: newOperationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion,
    fields: { displayName: 'Synthetic', avatar: { template: 'unavailable', color: 'unsupported' } },
  }, agent.runtimeToken);
  assert.equal((await profile(app, agent)).version, current.version);
  const published = await publish(app, agent, 'owner');
  assert.equal(published.published?.displayName, 'owner');
  await rejected(app, 'GET', '/v1/owner/agents', undefined, agent.runtimeToken);
  const owner = await manage(app, agent);
  for (const mode of ['owner_specified', 'proposal_required']) {
    const before = await profile(app, agent);
    const policy = await ok<Profile>(app, 'PUT', `/v1/owner/agents/${agent.agentId}/profile-policy`, {
      operationId: newOperationId(), expectedVersion: before.version, expectedPolicyVersion: before.policyVersion,
      mode, lockedFields: [],
    }, owner.sessionToken);
    const draft = await ok<Profile>(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
      operationId: newOperationId(), expectedVersion: policy.version, expectedPolicyVersion: policy.policyVersion,
      fields: { displayName: mode, avatar: { template: 'basic', color: 'cream' } },
    }, agent.runtimeToken);
    assert.equal(await rejected(app, 'POST', `/v1/agents/${agent.agentId}/profile/publish`, {
      operationId: newOperationId(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion,
    }, agent.runtimeToken), 'confirmation_required');
    const confirmed = await ok<Profile>(app, 'POST', `/v1/agents/${agent.agentId}/profile/publish`, {
      operationId: newOperationId(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion,
    }, owner.sessionToken);
    assert.equal(confirmed.published?.displayName, mode);
  }
});

test('INT-14: locked fields and stale profile versions do not overwrite the published profile', async t => {
  const { app } = fixture(t);
  const agent = await register(app);
  const published = await publish(app, agent, 'Original');
  const owner = await manage(app, agent);
  await ok(app, 'PUT', `/v1/owner/agents/${agent.agentId}/profile-policy`, {
    operationId: newOperationId(), expectedVersion: published.version, expectedPolicyVersion: published.policyVersion,
    mode: 'agent_autonomous', lockedFields: ['displayName'],
  }, owner.sessionToken);
  const locked = await profile(app, agent);
  await rejected(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
    operationId: newOperationId(), expectedVersion: locked.version, expectedPolicyVersion: locked.policyVersion,
    fields: { displayName: 'Overwrite', avatar: { template: 'basic', color: 'olive' } },
  }, agent.runtimeToken);
  await rejected(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
    operationId: newOperationId(), expectedVersion: published.version, expectedPolicyVersion: published.policyVersion,
    fields: { displayName: 'Original', avatar: { template: 'basic', color: 'blue' } },
  }, agent.runtimeToken);
  assert.equal((await profile(app, agent)).published?.displayName, 'Original');
});

test('INT-16: receipt queries distinguish shared operation IDs across Agents, actions and actor scopes', async t => {
  const { app } = fixture(t);
  const a1 = await register(app); const owner = await manage(app, a1);
  const inviteToken = newCredential('invite');
  await ok(app, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, owner.sessionToken);
  const a2 = await register(app, inviteToken);
  const foreign = await manage(app, await register(app));
  const sharedId = newOperationId();
  const drafts: Profile[] = [];
  for (const agent of [a1, a2]) {
    drafts.push(await ok<Profile>(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
      operationId: sharedId, expectedVersion: 1, expectedPolicyVersion: 1,
      fields: { displayName: agent.agentId, avatar: { template: 'basic', color: 'olive' } },
    }, agent.runtimeToken));
  }
  const published = await ok<Profile>(app, 'POST', `/v1/agents/${a1.agentId}/profile/publish`, {
    operationId: sharedId, expectedVersion: drafts[0]!.version, expectedPolicyVersion: 1,
  }, a1.runtimeToken);
  const ownerDraft = await ok<Profile>(app, 'PUT', `/v1/agents/${a1.agentId}/profile/draft`, {
    operationId: sharedId, expectedVersion: published.version, expectedPolicyVersion: 1, fields: { bio: 'Owner edit' },
  }, owner.sessionToken);
  const cases = [
    { scope: `agent:${a1.agentId}`, action: 'saveDraft', result: drafts[0]! },
    { scope: `agent:${a2.agentId}`, action: 'saveDraft', result: drafts[1]! },
    { scope: `agent:${a1.agentId}`, action: 'publishProfile', result: published },
    { scope: `owner:${owner.ownerId}`, action: 'saveDraft', result: ownerDraft },
  ];
  for (const { scope, action, result } of cases) {
    assert.deepEqual(await ok(app, 'GET', receiptUrl(sharedId, scope, action), undefined, owner.sessionToken), result);
  }
  const a1Url = receiptUrl(sharedId, `agent:${a1.agentId}`, 'saveDraft');
  assert.deepEqual(await ok(app, 'GET', a1Url, undefined, a1.runtimeToken), drafts[0]);
  for (const bearer of [foreign.sessionToken, a2.runtimeToken]) {
    const response = await request<{ error: { code: string } }>(app, 'GET', a1Url, undefined, bearer);
    assert.equal(response.status, 404); assert.equal(response.body.error.code, 'target_not_accessible');
  }
  for (const [url, bearer] of [
    [receiptUrl(sharedId, `owner:${owner.ownerId}`, 'saveDraft'), a1.runtimeToken],
    [receiptUrl(sharedId, `agent:${a2.agentId}`, 'publishProfile'), owner.sessionToken],
  ]) {
    const response = await request<{ error: { code: string } }>(app, 'GET', url!, undefined, bearer);
    assert.equal(response.status, 404); assert.equal(response.body.error.code, 'target_not_accessible');
  }
});

test('INT-17: unscoped or ambiguous receipt queries fail safely without changing other routes', async t => {
  const { app } = fixture(t);
  const agent = await register(app); const owner = await manage(app, agent);
  const path = `/v1/operations/${agent.operationId}`;
  const selectors = new URLSearchParams({ scope: `registration:${agent.attemptId}`, action: 'register' });
  assert.equal((await ok<Registration>(app, 'GET', `${path}?${selectors}`, undefined, owner.sessionToken)).agentId, agent.agentId);
  for (const url of [
    path,
    `${path}?action=register`,
    `${path}?scope=registration%3A${agent.attemptId}`,
    `${path}?scope=&action=register`,
    `${path}?${selectors}&scope=agent%3A${agent.agentId}`,
    `${path}?${selectors}&action=saveDraft`,
    `${path}?${selectors}&agentId=${agent.agentId}`,
    `${path}?${selectors}&operationId=${newOperationId()}`,
    `/v1/agent/self?${selectors}`,
  ]) {
    const response = await request<{ error: { code: string } }>(app, 'GET', url, undefined, owner.sessionToken);
    assert.equal(response.status, 400); assert.equal(response.body.error.code, 'invalid_request');
  }
  const anonymous = await request<{ error: { code: string } }>(app, 'GET', `${path}?${selectors}`);
  assert.equal(anonymous.status, 401); assert.equal(anonymous.body.error.code, 'authentication_failed');
  const locator = await request<{ error: { code: string } }>(app, 'GET', `${path}?${selectors}`, undefined, agent.agentId);
  assert.equal(locator.status, 401); assert.equal(locator.body.error.code, 'authentication_failed');
  const bodySelectors = await request<{ error: { code: string } }>(app, 'GET', `${path}?${selectors}`, { scope: 'other', action: 'register' }, owner.sessionToken);
  assert.equal(bodySelectors.status, 400); assert.equal(bodySelectors.body.error.code, 'invalid_request');
});

test('INT-15: joined, owner-paused and left states remain independent and rejoin preserves identity', async t => {
  const { app } = fixture(t);
  const agent = await register(app);
  await publish(app, agent);
  await joinWorld(app, agent);
  const owner = await manage(app, agent);
  const before = await membership(app, agent);
  await ok(app, 'PUT', `/v1/owner/agents/${agent.agentId}/participation`, {
    operationId: newOperationId(), expectedVersion: before.version, paused: true,
  }, owner.sessionToken);
  const paused = await membership(app, agent);
  assert.equal(paused.state, 'joined');
  assert.equal(paused.ownerPaused, true);
  assert.equal(paused.platformRestricted, false);
  const currentProfile = await profile(app, agent);
  await rejected(app, 'PUT', `/v1/agents/${agent.agentId}/profile/draft`, {
    operationId: newOperationId(), expectedVersion: currentProfile.version, expectedPolicyVersion: currentProfile.policyVersion,
    fields: { displayName: 'Blocked', avatar: { template: 'basic', color: 'olive' } },
  }, agent.runtimeToken);
  const left = await ok<Membership>(app, 'POST', `/v1/agents/${agent.agentId}/membership/leave`, { operationId: newOperationId(), expectedVersion: paused.version }, agent.runtimeToken);
  assert.equal(left.state, 'left');
  assert.equal(left.ownerPaused, true);
  await rejected(app, 'POST', `/v1/agents/${agent.agentId}/membership/join`, {
    operationId: newOperationId(), expectedVersion: left.version, expectedProfileVersion: currentProfile.version,
  }, agent.runtimeToken);
  await ok(app, 'PUT', `/v1/owner/agents/${agent.agentId}/participation`, {
    operationId: newOperationId(), expectedVersion: left.version, paused: false,
  }, owner.sessionToken);
  const rejoined = await joinWorld(app, agent);
  assert.equal(rejoined.agentId, agent.agentId);
  assert.equal(rejoined.state, 'joined');
});
