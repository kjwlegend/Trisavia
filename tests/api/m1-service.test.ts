import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { createM1Service } from "../../apps/platform/application/m1-service.ts";
import type { JsonObject, M1Store } from "../../apps/platform/contracts/store.ts";
import { M1_TABLES } from "../../apps/platform/contracts/store.ts";
import { M1Error } from "../../apps/platform/domains/common/errors.ts";
import { openM1Store } from "../../apps/platform/infrastructure/relational/sqlite-store.ts";
import { registerM1Routes } from "../../apps/platform/transport/http/m1-routes.ts";

const operationId = () => randomUUID();
const token = () => `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
const string = (data: JsonObject, key: string) => {
  assert.equal(typeof data[key], "string");
  return data[key] as string;
};

function fixture(options: Parameters<typeof createM1Service>[1] = {}) {
  const store = openM1Store({ databasePath: ":memory:", instanceId: "test-instance", recoveryEpoch: "epoch-1" });
  let time = 1_000_000;
  const service = createM1Service(store, { now: () => time, ...options });
  return { store, service, tick: (delta: number) => { time += delta; } };
}
type Fixture = ReturnType<typeof fixture>;

function registration(f: Fixture, inviteToken?: string) {
  const input = { operationId: operationId(), attemptId: randomUUID(), runtimeToken: token(), continuationToken: token(), ...(inviteToken ? { inviteToken } : {}) };
  const result = f.service.invoke("register", input);
  return { input, result, agentId: string(result, "agentId"), ownerId: string(result, "ownerId") };
}
type Registration = ReturnType<typeof registration>;

function setup(f: Fixture, agent: Registration) {
  const handoffToken = token();
  const handoff = f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 0, handoffToken }, agent.input.continuationToken);
  const setupToken = token();
  f.service.invoke("exchangeSetup", { operationId: operationId(), setupToken }, handoffToken);
  const sessionToken = token();
  const recoveryToken = token();
  const password = "test-owner-password-123";
  const input = { operationId: operationId(), username: `Owner_${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password, recoveryToken, sessionToken, credentialsSaved: true };
  const result = f.service.invoke("completeSetup", input, setupToken);
  return { sessionToken, recoveryToken, password, result, input, setupToken, handoffToken, handoff };
}

function publish(f: Fixture, agent: Registration, proof = agent.input.runtimeToken) {
  const prior = f.service.invoke("readProfile", { agentId: agent.agentId }, proof);
  const draft = f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: prior.version, expectedPolicyVersion: prior.policyVersion, fields: { displayName: "岚", avatar: { template: "basic", color: "olive" } } }, proof);
  return f.service.invoke("publishProfile", { operationId: operationId(), agentId: agent.agentId, expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion }, proof);
}

function error(code: string, work: () => unknown) {
  assert.throws(work, (failure: unknown) => failure instanceof M1Error && failure.code === code);
}

test("registration response loss, proof isolation and changed-attempt payload preserve one identity", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = registration(f);
  assert.deepEqual(f.service.invoke("register", agent.input), agent.result);
  assert.equal(f.store.read((tx) => tx.find("agents").length), 1);
  error("idempotency_payload_mismatch", () => f.service.invoke("register", { ...agent.input, runtimeToken: token() }));
  error("idempotency_payload_mismatch", () => f.service.invoke("register", { ...agent.input, operationId: operationId(), runtimeToken: token() }));
  error("authentication_failed", () => f.service.invoke("registrationResult", { attemptId: agent.input.attemptId }, token()));
  const result = f.service.invoke("registrationResult", { attemptId: agent.input.attemptId }, agent.input.continuationToken);
  assert.equal(result.agentId, agent.agentId);
  assert.equal(f.service.invoke("self", {}, agent.input.runtimeToken).agentId, agent.agentId);
  error("insufficient_scope", () => f.service.invoke("listAgents", {}, agent.input.runtimeToken));
  error("authentication_failed", () => f.service.invoke("self", {}, agent.agentId));
});

test("Agent can publish, join and summarize before any owner management visit", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = registration(f);
  const profile = publish(f, agent);
  const joined = f.service.invoke("join", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 1, expectedProfileVersion: profile.version }, agent.input.runtimeToken);
  assert.equal(joined.state, "joined");
  const current = f.service.invoke("self", {}, agent.input.runtimeToken);
  assert.equal((current.membership as JsonObject).state, "joined");
  assert.equal(f.store.read((tx) => tx.get("owners", agent.ownerId)?.data.status), "pending_setup");
  assert.equal(f.store.read((tx) => tx.find("bindings").length), 0);
});

test("preview is non-consuming; refresh supersedes expired handoff and setup; binding closes every initial proof", (t) => {
  const f = fixture({ handoffTtlMs: 50 }); t.after(() => f.store.close());
  const agent = registration(f);
  const first = token();
  const handoff = f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 0, handoffToken: first }, agent.input.continuationToken);
  const preview = () => f.service.invoke("previewHandoff", { handoffId: string(handoff, "handoffId") }, first);
  assert.deepEqual(preview(), preview());
  f.tick(51);
  error("authentication_failed", preview);
  const second = token();
  f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 1, handoffToken: second }, agent.input.continuationToken);
  const oldSetup = token();
  f.service.invoke("exchangeSetup", { operationId: operationId(), setupToken: oldSetup }, second);
  const third = token();
  f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 2, handoffToken: third }, agent.input.continuationToken);
  error("authentication_failed", () => f.service.invoke("readSetup", {}, oldSetup));
  const setupToken = token();
  f.service.invoke("exchangeSetup", { operationId: operationId(), setupToken }, third);
  error("insufficient_scope", () => f.service.invoke("managedAgent", { agentId: agent.agentId }, setupToken));
  const sessionToken = token();
  const completeId = operationId();
  const complete = f.service.invoke("completeSetup", { operationId: completeId, username: "Independent_Owner", email: "independent@example.test", password: "independent-owner-password", recoveryToken: token(), sessionToken, credentialsSaved: true }, setupToken);
  const completeQuery = { operationId: completeId, scope: `setup:${setupToken.split(".")[0]}`, action: "completeSetup" };
  for (const proof of [first, second, third, oldSetup, setupToken, agent.input.continuationToken]) error("authentication_failed", () => f.service.invoke("receipt", completeQuery, proof));
  assert.deepEqual(f.service.invoke("receipt", completeQuery, sessionToken), complete);
  error("target_not_accessible", () => f.service.invoke("receipt", completeQuery, agent.input.runtimeToken));
  assert.equal(f.service.invoke("registrationResult", { attemptId: agent.input.attemptId }, agent.input.runtimeToken).managementStatus, "managed");
  assert.equal(f.store.read((tx) => tx.find("bindings", { agentId: agent.agentId, active: true }).length), 1);
});

test("one-use invite creates A2 under O1, response loss resumes A2 and another owner cannot alter targets", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const a1 = registration(f); const owner = setup(f, a1);
  const foreign = registration(f); const foreignOwner = setup(f, foreign);
  const inviteToken = token();
  f.service.invoke("issueInvite", { operationId: operationId(), inviteToken }, owner.sessionToken);
  const a2 = registration(f, inviteToken);
  assert.equal(a2.ownerId, a1.ownerId);
  assert.notEqual(a2.agentId, a1.agentId);
  assert.deepEqual(f.service.invoke("register", a2.input), a2.result);
  assert.equal(f.service.invoke("registrationResult", { attemptId: a2.input.attemptId }, a2.input.continuationToken).agentId, a2.agentId);
  error("authentication_failed", () => registration(f, inviteToken));
  assert.equal((f.service.invoke("listAgents", {}, owner.sessionToken).agents as JsonObject[]).length, 2);
  error("target_not_accessible", () => f.service.invoke("managedAgent", { agentId: a2.agentId }, foreignOwner.sessionToken));
  error("target_not_accessible", () => f.service.invoke("readProfile", { agentId: a1.agentId }, a2.input.runtimeToken));
  const revoked = token();
  const issued = f.service.invoke("issueInvite", { operationId: operationId(), inviteToken: revoked }, owner.sessionToken);
  f.service.invoke("revokeInvite", { operationId: operationId(), inviteId: issued.inviteId, expectedVersion: issued.version }, owner.sessionToken);
  const count = f.store.read((tx) => tx.find("agents").length);
  error("authentication_failed", () => registration(f, revoked));
  assert.equal(f.store.read((tx) => tx.find("agents").length), count);
});

test("receipt lookup separates shared operation IDs by Agent, actor scope and action without widening access", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const a1 = registration(f); const owner = setup(f, a1);
  const inviteToken = token();
  f.service.invoke("issueInvite", { operationId: operationId(), inviteToken }, owner.sessionToken);
  const a2 = registration(f, inviteToken);
  const foreign = setup(f, registration(f));
  const sharedId = operationId();
  const drafts = [a1, a2].map((agent) => f.service.invoke("saveDraft", {
    operationId: sharedId, agentId: agent.agentId, expectedVersion: 1, expectedPolicyVersion: 1,
    fields: { displayName: agent.agentId, avatar: { template: "basic", color: "olive" } },
  }, agent.input.runtimeToken));
  assert.notEqual(drafts[0]!.receiptId, drafts[1]!.receiptId);
  const published = f.service.invoke("publishProfile", {
    operationId: sharedId, agentId: a1.agentId, expectedVersion: drafts[0]!.version, expectedPolicyVersion: 1,
  }, a1.input.runtimeToken);
  const ownerDraft = f.service.invoke("saveDraft", {
    operationId: sharedId, agentId: a1.agentId, expectedVersion: published.version, expectedPolicyVersion: 1,
    fields: { bio: "Owner edit" },
  }, owner.sessionToken);
  const cases = [
    { scope: `agent:${a1.agentId}`, action: "saveDraft", result: drafts[0]! },
    { scope: `agent:${a2.agentId}`, action: "saveDraft", result: drafts[1]! },
    { scope: `agent:${a1.agentId}`, action: "publishProfile", result: published },
    { scope: `owner:${a1.ownerId}`, action: "saveDraft", result: ownerDraft },
  ];
  for (const { scope, action, result } of cases) {
    assert.deepEqual(f.service.invoke("receipt", { operationId: sharedId, scope, action }, owner.sessionToken), result);
  }
  const a1Query = { operationId: sharedId, scope: `agent:${a1.agentId}`, action: "saveDraft" };
  assert.deepEqual(f.service.invoke("receipt", a1Query, a1.input.runtimeToken), drafts[0]);
  error("target_not_accessible", () => f.service.invoke("receipt", a1Query, foreign.sessionToken));
  error("target_not_accessible", () => f.service.invoke("receipt", a1Query, a2.input.runtimeToken));
  error("target_not_accessible", () => f.service.invoke("receipt", { ...a1Query, scope: `owner:${a1.ownerId}` }, a1.input.runtimeToken));
  error("target_not_accessible", () => f.service.invoke("receipt", { ...a1Query, scope: `agent:${a2.agentId}`, action: "publishProfile" }, owner.sessionToken));
  error("invalid_request", () => f.service.invoke("receipt", { operationId: sharedId }, owner.sessionToken));
  error("invalid_request", () => f.service.invoke("receipt", { operationId: sharedId, scope: a1Query.scope }, owner.sessionToken));
  error("invalid_request", () => f.service.invoke("receipt", { operationId: sharedId, action: a1Query.action }, owner.sessionToken));
});

test("profile versions and owner field locks block stale drafts and publication", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = registration(f); const published = publish(f, agent); const owner = setup(f, agent);
  const draft = f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: published.version, expectedPolicyVersion: published.policyVersion, fields: { displayName: "stale proposal" } }, agent.input.runtimeToken);
  const policy = f.service.invoke("profilePolicy", { operationId: operationId(), agentId: agent.agentId, expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion, mode: "agent_autonomous", lockedFields: ["displayName"] }, owner.sessionToken);
  error("version_conflict", () => f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion, fields: { bio: "later" } }, agent.input.runtimeToken));
  error("field_locked", () => f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: policy.version, expectedPolicyVersion: policy.policyVersion, fields: { displayName: "override" } }, agent.input.runtimeToken));
  error("field_locked", () => f.service.invoke("publishProfile", { operationId: operationId(), agentId: agent.agentId, expectedVersion: policy.version, expectedPolicyVersion: policy.policyVersion }, agent.input.runtimeToken));
  assert.equal((f.service.invoke("readProfile", { agentId: agent.agentId }, owner.sessionToken).published as JsonObject).displayName, "岚");
});

test("pause, member state, platform gate and runtime generations remain independent", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = registration(f); const profile = publish(f, agent); const owner = setup(f, agent);
  let membership = f.service.invoke("join", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 1, expectedProfileVersion: profile.version }, agent.input.runtimeToken);
  membership = f.service.invoke("participation", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version, paused: true }, owner.sessionToken);
  assert.equal(membership.state, "joined");
  error("participation_paused", () => f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion, fields: { bio: "blocked" } }, agent.input.runtimeToken));
  membership = f.service.invoke("leave", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version }, agent.input.runtimeToken);
  assert.equal(membership.state, "left"); assert.equal(membership.ownerPaused, true);
  f.store.transaction((tx) => { const row = tx.get("memberships", agent.agentId)!; tx.update("memberships", { ...row, version: row.version + 1, data: { ...row.data, platformRestricted: true, platformVersion: 2 } }, row.version); });
  membership = f.service.invoke("readMembership", { agentId: agent.agentId }, owner.sessionToken);
  membership = f.service.invoke("participation", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version, paused: false }, owner.sessionToken);
  assert.equal(membership.platformRestricted, true);
  error("platform_restricted", () => f.service.invoke("join", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version, expectedProfileVersion: profile.version }, agent.input.runtimeToken));
  f.service.invoke("revokeRuntime", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 1 }, owner.sessionToken);
  error("authentication_failed", () => f.service.invoke("self", {}, agent.input.runtimeToken));
  const next = token();
  f.service.invoke("replaceRuntime", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 2, runtimeToken: next }, owner.sessionToken);
  const current = f.service.invoke("self", {}, next);
  assert.equal(current.runtimeVersion, 3); assert.equal((current.membership as JsonObject).state, "left"); assert.equal((current.membership as JsonObject).platformRestricted, true);
});

test("recovery activates pre-saved successors, closes old management and invites, and preserves runtime", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = registration(f); const owner = setup(f, agent);
  const inviteToken = token(); f.service.invoke("issueInvite", { operationId: operationId(), inviteToken }, owner.sessionToken);
  const nextSession = token(); const nextRecovery = token(); const recoveryOperation = operationId();
  const result = f.service.invoke("recover", { operationId: recoveryOperation, password: "next-password-for-owner", recoveryToken: nextRecovery, sessionToken: nextSession, credentialsSaved: true }, owner.recoveryToken);
  assert.deepEqual(f.service.invoke("receipt", { operationId: recoveryOperation, scope: `owner:${agent.ownerId}`, action: "recover" }, nextSession), result);
  error("authentication_failed", () => f.service.invoke("listAgents", {}, owner.sessionToken));
  error("authentication_failed", () => f.service.invoke("recover", { operationId: operationId() }, owner.recoveryToken));
  error("authentication_failed", () => registration(f, inviteToken));
  error("authentication_failed", () => f.service.invoke("login", { operationId: operationId(), identifier: owner.input.username, password: owner.password, sessionToken: token() }));
  f.service.invoke("login", { operationId: operationId(), identifier: owner.input.username, password: "next-password-for-owner", sessionToken: token() });
  assert.equal(f.service.invoke("self", {}, agent.input.runtimeToken).agentId, agent.agentId);
});

test("copied old authorization state cannot authenticate into a new recovery epoch", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = registration(f); const owner = setup(f, agent);
  const restored: M1Store = { instanceId: f.store.instanceId, recoveryEpoch: "epoch-restored", read: f.store.read.bind(f.store), transaction: f.store.transaction.bind(f.store), close() {} };
  const service = createM1Service(restored);
  error("restore_access_unsupported", () => service.invoke("self", {}, agent.input.runtimeToken));
  error("restore_access_unsupported", () => service.invoke("login", { operationId: operationId(), identifier: owner.input.username, password: owner.password, sessionToken: token() }));
  assert.equal(f.store.read((tx) => tx.get("agents", agent.agentId)?.id), agent.agentId);
});

test("secret reuse rolls back the complete registration and durable data contains only verifiers", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const reused = token();
  error("credential_conflict", () => f.service.invoke("register", { operationId: operationId(), attemptId: randomUUID(), runtimeToken: reused, continuationToken: reused }));
  assert.equal(f.store.read((tx) => tx.find("agents").length), 0);
  assert.equal(f.store.read((tx) => tx.find("owners").length), 0);
  const agent = registration(f); const owner = setup(f, agent);
  const durable = f.store.read((tx) => JSON.stringify(M1_TABLES.map((table) => tx.find(table))));
  for (const secret of [agent.input.runtimeToken, agent.input.continuationToken, owner.sessionToken, owner.recoveryToken, owner.handoffToken, owner.setupToken, owner.password]) {
    assert.equal(durable.includes(secret), false);
    if (secret.includes(".")) assert.equal(durable.includes(secret.split(".")[1]!), false);
  }
});

test("HTTP validation and parser failures are safe; registration creation quota is enforced", async (t) => {
  const f = fixture({ registrationLimit: 1 }); t.after(() => f.store.close());
  const app = Fastify({ logger: false }); registerM1Routes(app, f.service); t.after(() => app.close());
  const marker = token();
  const invalid = await app.inject({ method: "POST", url: "/v1/registrations", headers: { "content-type": "application/json" }, payload: `{"runtimeToken":"${marker}",` });
  assert.equal(invalid.statusCode, 400); assert.equal(invalid.json().error.code, "invalid_request"); assert.equal(invalid.body.includes(marker), false);
  const oversized = await app.inject({ method: "POST", url: "/v1/registrations", payload: { private: marker.repeat(300) } });
  assert.equal(oversized.statusCode, 413); assert.equal(oversized.body.includes(marker), false);
  const unknown = await app.inject({ method: "POST", url: "/v1/registrations", payload: { operationId: operationId(), attemptId: randomUUID(), runtimeToken: token(), continuationToken: token(), ownerId: "self-claimed" } });
  assert.equal(unknown.statusCode, 400); assert.equal(unknown.json().error.code, "invalid_request");
  registration(f);
  const quota = await app.inject({ method: "POST", url: "/v1/registrations", payload: { operationId: operationId(), attemptId: randomUUID(), runtimeToken: token(), continuationToken: token() } });
  assert.equal(quota.statusCode, 429);
  const noAuth = await app.inject({ method: "GET", url: "/v1/owner/agents" }); assert.equal(noAuth.statusCode, 401);
});

test('recovery preview is read-only, survives session expiry and grants no runtime or session authority', async(t)=>{
 const f=fixture({sessionTtlMs:10});t.after(()=>f.store.close());const agent=registration(f);const owner=setup(f,agent);f.tick(11);
 const snapshot=()=>f.store.read(tx=>JSON.stringify(M1_TABLES.map(table=>tx.find(table,{}))));const before=snapshot();
 assert.equal(f.service.invoke('readRecovery',{},owner.recoveryToken).ownerId,agent.ownerId);
 assert.equal(snapshot()===before,true,'Preview must not consume proofs, create sessions or write receipts');
 error('insufficient_scope',()=>f.service.invoke('readRecovery',{},agent.input.runtimeToken));
 error('authentication_failed',()=>f.service.invoke('readRecovery',{},owner.sessionToken));
 const app=Fastify();registerM1Routes(app,f.service);t.after(()=>app.close());
 const response=await app.inject({method:'GET',url:'/v1/owner/recovery',headers:{authorization:`Bearer ${owner.recoveryToken}`}});
 assert.equal(response.statusCode,200);assert.equal(response.json().ownerId,agent.ownerId);
 assert.equal(snapshot()===before,true);
 f.service.invoke('recover',{operationId:operationId(),password:'replacement recovery password',recoveryToken:token(),sessionToken:token(),credentialsSaved:true},owner.recoveryToken);
 error('authentication_failed',()=>f.service.invoke('readRecovery',{},owner.recoveryToken));
});
