import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { createM1Service } from "../../apps/platform/application/m1-service.ts";
import type { JsonObject, M1Store } from "../../apps/platform/contracts/store.ts";
import { M1_TABLES } from "../../apps/platform/contracts/store.ts";
import { M1Error } from "../../apps/platform/domains/common/errors.ts";
import { openTestStore } from "./postgresql-fixture.ts";
import { registerM1Routes } from "../../apps/platform/transport/http/m1-routes.ts";
const operationId = () => randomUUID();
const token = () => `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
const string = (data: JsonObject, key: string) => {
    assert.equal(typeof data[key], "string");
    return data[key] as string;
};
async function fixture(options: Parameters<typeof createM1Service>[1] = {}) {
    const store = await openTestStore({ databasePath: ":memory:", instanceId: "test-instance", recoveryEpoch: "epoch-1" });
    let time = 1000000;
    const service = createM1Service(store, { now: () => time, email: { mode: 'experience' }, ...options });
    return { store, service, tick: (delta: number) => { time += delta; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function registration(f: Fixture, inviteToken?: string) {
    const input = { operationId: operationId(), attemptId: randomUUID(), runtimeToken: token(), continuationToken: token(), ...(inviteToken ? { inviteToken } : {}) };
    const result = await f.service.invoke("register", input);
    return { input, result, agentId: string(result, "agentId"), ownerId: string(result, "ownerId") };
}
type Registration = Awaited<ReturnType<typeof registration>>;
async function finishSetup(f: Fixture, agent: Registration, setupToken: string, generation: number, username = `Owner_${randomUUID().slice(0, 8)}`) {
    const attemptId = randomUUID(), browserToken = token(), email = `${randomUUID()}@example.test`;
    await f.service.invoke('startRegistration', { operationId: operationId(), attemptId, browserToken, username, email,
        agentId: agent.agentId, expectedGeneration: generation, setupToken });
    const sendOperationId = operationId();
    await f.service.invoke('sendRegistrationCode', { operationId: sendOperationId, attemptId }, browserToken);
    await f.service.invoke('verifyRegistrationEmail', { operationId: operationId(), attemptId, sendOperationId, code: '1234' }, browserToken);
    const sessionToken = token(), recoveryToken = token(), password = 'test-owner-password-123';
    const input = { operationId: operationId(), attemptId, password, recoveryToken, sessionToken, setupToken };
    const result = await f.service.invoke('completeSetup', input, browserToken);
    return { sessionToken, recoveryToken, password, username, result, input, attemptId };
}
async function setup(f: Fixture, agent: Registration) {
    const handoffToken = token();
    const handoff = await f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 0, handoffToken }, agent.input.continuationToken);
    const setupToken = token();
    await f.service.invoke("exchangeSetup", { operationId: operationId(), setupToken }, handoffToken);
    return { ...await finishSetup(f, agent, setupToken, Number(handoff.generation)), setupToken, handoffToken, handoff };
}
async function publish(f: Fixture, agent: Registration, proof = agent.input.runtimeToken) {
    const prior = await f.service.invoke("readProfile", { agentId: agent.agentId }, proof);
    const draft = await f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: prior.version, expectedPolicyVersion: prior.policyVersion, fields: { displayName: "岚", avatar: { template: "basic", color: "olive" } } }, proof);
    return await f.service.invoke("publishProfile", { operationId: operationId(), agentId: agent.agentId, expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion }, proof);
}
async function error(code: string, work: () => unknown) {
    await assert.rejects(async () => await work(), (failure: unknown) => failure instanceof M1Error && failure.code === code);
}
await test("registration response loss, proof isolation and changed-attempt payload preserve one identity", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    assert.deepEqual(await f.service.invoke("register", agent.input), agent.result);
    assert.equal(await f.store.read(async (tx) => (await tx.find("agents")).length), 1);
    await error("idempotency_payload_mismatch", async () => await f.service.invoke("register", { ...agent.input, runtimeToken: token() }));
    await error("idempotency_payload_mismatch", async () => await f.service.invoke("register", { ...agent.input, operationId: operationId(), runtimeToken: token() }));
    await error("authentication_failed", async () => await f.service.invoke("registrationResult", { attemptId: agent.input.attemptId }, token()));
    const result = await f.service.invoke("registrationResult", { attemptId: agent.input.attemptId }, agent.input.continuationToken);
    assert.equal(result.agentId, agent.agentId);
    assert.equal((await f.service.invoke("self", {}, agent.input.runtimeToken)).agentId, agent.agentId);
    await error("insufficient_scope", async () => await f.service.invoke("listAgents", {}, agent.input.runtimeToken));
    await error("authentication_failed", async () => await f.service.invoke("self", {}, agent.agentId));
});
await test("Agent can publish, join and summarize before any owner management visit", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    const profile = await publish(f, agent);
    const joined = await f.service.invoke("join", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 1, expectedProfileVersion: profile.version }, agent.input.runtimeToken);
    assert.equal(joined.state, "joined");
    const current = await f.service.invoke("self", {}, agent.input.runtimeToken);
    assert.equal((current.membership as JsonObject).state, "joined");
    assert.equal(await f.store.read(async (tx) => (await tx.get("owners", agent.ownerId))?.data.status), "pending_setup");
    assert.equal(await f.store.read(async (tx) => (await tx.find("bindings")).length), 0);
});
await test("preview is non-consuming; refresh supersedes expired handoff and setup; binding closes every initial proof", async (t) => {
    const f = await fixture({ handoffTtlMs: 50 });
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    const first = token();
    const handoff = await f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 0, handoffToken: first }, agent.input.continuationToken);
    const preview = async () => await f.service.invoke("previewHandoff", { handoffId: string(handoff, "handoffId") }, first);
    assert.deepEqual(await preview(), await preview());
    f.tick(51);
    await error("authentication_failed", preview);
    const second = token();
    await f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 1, handoffToken: second }, agent.input.continuationToken);
    const oldSetup = token();
    await f.service.invoke("exchangeSetup", { operationId: operationId(), setupToken: oldSetup }, second);
    const third = token();
    await f.service.invoke("issueHandoff", { operationId: operationId(), expectedGeneration: 2, handoffToken: third }, agent.input.continuationToken);
    await error("authentication_failed", async () => await f.service.invoke("readSetup", {}, oldSetup));
    const setupToken = token();
    await f.service.invoke("exchangeSetup", { operationId: operationId(), setupToken }, third);
    await error("insufficient_scope", async () => await f.service.invoke("managedAgent", { agentId: agent.agentId }, setupToken));
    const completed = await finishSetup(f, agent, setupToken, 3, 'Independent_Owner');
    const { sessionToken, result: complete } = completed;
    const completeQuery = { operationId: completed.input.operationId, scope: `owner-registration:${completed.attemptId}`, action: "completeSetup" };
    for (const proof of [first, second, third, oldSetup, setupToken, agent.input.continuationToken])
        await error("authentication_failed", async () => await f.service.invoke("receipt", completeQuery, proof));
    assert.deepEqual(await f.service.invoke("receipt", completeQuery, sessionToken), complete);
    await error("target_not_accessible", async () => await f.service.invoke("receipt", completeQuery, agent.input.runtimeToken));
    assert.equal((await f.service.invoke("registrationResult", { attemptId: agent.input.attemptId }, agent.input.runtimeToken)).managementStatus, "managed");
    assert.equal(await f.store.read(async (tx) => (await tx.find("bindings", { agentId: agent.agentId, active: true })).length), 1);
});
await test("one-use invite creates A2 under O1, response loss resumes A2 and another owner cannot alter targets", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const a1 = await registration(f);
    const owner = await setup(f, a1);
    const foreign = await registration(f);
    const foreignOwner = await setup(f, foreign);
    const inviteToken = token();
    await f.service.invoke("issueInvite", { operationId: operationId(), inviteToken }, owner.sessionToken);
    const a2 = await registration(f, inviteToken);
    assert.equal(a2.ownerId, a1.ownerId);
    assert.notEqual(a2.agentId, a1.agentId);
    assert.deepEqual(await f.service.invoke("register", a2.input), a2.result);
    assert.equal((await f.service.invoke("registrationResult", { attemptId: a2.input.attemptId }, a2.input.continuationToken)).agentId, a2.agentId);
    await error("invite_consumed", async () => await registration(f, inviteToken));
    assert.equal(((await f.service.invoke("listAgents", {}, owner.sessionToken)).agents as JsonObject[]).length, 2);
    await error("target_not_accessible", async () => await f.service.invoke("managedAgent", { agentId: a2.agentId }, foreignOwner.sessionToken));
    await error("target_not_accessible", async () => await f.service.invoke("readProfile", { agentId: a1.agentId }, a2.input.runtimeToken));
    const revoked = token();
    const issued = await f.service.invoke("issueInvite", { operationId: operationId(), inviteToken: revoked }, owner.sessionToken);
    await f.service.invoke("revokeInvite", { operationId: operationId(), inviteId: issued.inviteId, expectedVersion: issued.version }, owner.sessionToken);
    const count = await f.store.read(async (tx) => (await tx.find("agents")).length);
    await error("authentication_failed", async () => await registration(f, revoked));
    assert.equal(await f.store.read(async (tx) => (await tx.find("agents")).length), count);
});
await test("receipt lookup separates shared operation IDs by Agent, actor scope and action without widening access", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const a1 = await registration(f);
    const owner = await setup(f, a1);
    const inviteToken = token();
    await f.service.invoke("issueInvite", { operationId: operationId(), inviteToken }, owner.sessionToken);
    const a2 = await registration(f, inviteToken);
    const foreign = await setup(f, await registration(f));
    const sharedId = operationId();
    const drafts = await Promise.all([a1, a2].map(async (agent) => await f.service.invoke("saveDraft", {
        operationId: sharedId, agentId: agent.agentId, expectedVersion: 1, expectedPolicyVersion: 1,
        fields: { displayName: agent.agentId, avatar: { template: "basic", color: "olive" } },
    }, agent.input.runtimeToken)));
    assert.notEqual(drafts[0]!.receiptId, drafts[1]!.receiptId);
    const published = await f.service.invoke("publishProfile", {
        operationId: sharedId, agentId: a1.agentId, expectedVersion: drafts[0]!.version, expectedPolicyVersion: 1,
    }, a1.input.runtimeToken);
    const ownerDraft = await f.service.invoke("saveDraft", {
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
        assert.deepEqual(await f.service.invoke("receipt", { operationId: sharedId, scope, action }, owner.sessionToken), result);
    }
    const a1Query = { operationId: sharedId, scope: `agent:${a1.agentId}`, action: "saveDraft" };
    assert.deepEqual(await f.service.invoke("receipt", a1Query, a1.input.runtimeToken), drafts[0]);
    await error("target_not_accessible", async () => await f.service.invoke("receipt", a1Query, foreign.sessionToken));
    await error("target_not_accessible", async () => await f.service.invoke("receipt", a1Query, a2.input.runtimeToken));
    await error("target_not_accessible", async () => await f.service.invoke("receipt", { ...a1Query, scope: `owner:${a1.ownerId}` }, a1.input.runtimeToken));
    await error("target_not_accessible", async () => await f.service.invoke("receipt", { ...a1Query, scope: `agent:${a2.agentId}`, action: "publishProfile" }, owner.sessionToken));
    await error("invalid_request", async () => await f.service.invoke("receipt", { operationId: sharedId }, owner.sessionToken));
    await error("invalid_request", async () => await f.service.invoke("receipt", { operationId: sharedId, scope: a1Query.scope }, owner.sessionToken));
    await error("invalid_request", async () => await f.service.invoke("receipt", { operationId: sharedId, action: a1Query.action }, owner.sessionToken));
});
await test("profile versions and owner field locks block stale drafts and publication", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    const published = await publish(f, agent);
    const owner = await setup(f, agent);
    const draft = await f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: published.version, expectedPolicyVersion: published.policyVersion, fields: { displayName: "stale proposal" } }, agent.input.runtimeToken);
    const policy = await f.service.invoke("profilePolicy", { operationId: operationId(), agentId: agent.agentId, expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion, mode: "agent_autonomous", lockedFields: ["displayName"] }, owner.sessionToken);
    await error("version_conflict", async () => await f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion, fields: { bio: "later" } }, agent.input.runtimeToken));
    await error("field_locked", async () => await f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: policy.version, expectedPolicyVersion: policy.policyVersion, fields: { displayName: "override" } }, agent.input.runtimeToken));
    await error("field_locked", async () => await f.service.invoke("publishProfile", { operationId: operationId(), agentId: agent.agentId, expectedVersion: policy.version, expectedPolicyVersion: policy.policyVersion }, agent.input.runtimeToken));
    assert.equal(((await f.service.invoke("readProfile", { agentId: agent.agentId }, owner.sessionToken)).published as JsonObject).displayName, "岚");
});
await test("pause, member state, platform gate and runtime generations remain independent", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    const profile = await publish(f, agent);
    const owner = await setup(f, agent);
    let membership = await f.service.invoke("join", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 1, expectedProfileVersion: profile.version }, agent.input.runtimeToken);
    membership = await f.service.invoke("participation", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version, paused: true }, owner.sessionToken);
    assert.equal(membership.state, "joined");
    await error("participation_paused", async () => await f.service.invoke("saveDraft", { operationId: operationId(), agentId: agent.agentId, expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion, fields: { bio: "blocked" } }, agent.input.runtimeToken));
    membership = await f.service.invoke("leave", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version }, agent.input.runtimeToken);
    assert.equal(membership.state, "left");
    assert.equal(membership.ownerPaused, true);
    await f.store.transaction(async (tx) => { const row = (await tx.get("memberships", agent.agentId))!; await tx.update("memberships", { ...row, version: row.version + 1, data: { ...row.data, platformRestricted: true, platformVersion: 2 } }, row.version); });
    membership = await f.service.invoke("readMembership", { agentId: agent.agentId }, owner.sessionToken);
    membership = await f.service.invoke("participation", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version, paused: false }, owner.sessionToken);
    assert.equal(membership.platformRestricted, true);
    await error("platform_restricted", async () => await f.service.invoke("join", { operationId: operationId(), agentId: agent.agentId, expectedVersion: membership.version, expectedProfileVersion: profile.version }, agent.input.runtimeToken));
    await f.service.invoke("revokeRuntime", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 1 }, owner.sessionToken);
    await error("authentication_failed", async () => await f.service.invoke("self", {}, agent.input.runtimeToken));
    const next = token();
    await f.service.invoke("replaceRuntime", { operationId: operationId(), agentId: agent.agentId, expectedVersion: 2, runtimeToken: next }, owner.sessionToken);
    const current = await f.service.invoke("self", {}, next);
    assert.equal(current.runtimeVersion, 3);
    assert.equal((current.membership as JsonObject).state, "left");
    assert.equal((current.membership as JsonObject).platformRestricted, true);
});
await test("recovery activates pre-saved successors, closes old management and invites, and preserves runtime", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    const owner = await setup(f, agent);
    const inviteToken = token();
    await f.service.invoke("issueInvite", { operationId: operationId(), inviteToken }, owner.sessionToken);
    const nextSession = token();
    const nextRecovery = token();
    const recoveryOperation = operationId();
    const result = await f.service.invoke("recover", { operationId: recoveryOperation, password: "next-password-for-owner", recoveryToken: nextRecovery, sessionToken: nextSession, credentialsSaved: true }, owner.recoveryToken);
    assert.deepEqual(await f.service.invoke("receipt", { operationId: recoveryOperation, scope: `owner:${agent.ownerId}`, action: "recover" }, nextSession), result);
    await error("authentication_failed", async () => await f.service.invoke("listAgents", {}, owner.sessionToken));
    await error("authentication_failed", async () => await f.service.invoke("recover", { operationId: operationId() }, owner.recoveryToken));
    await error("invite_revoked", async () => await registration(f, inviteToken));
    await error("authentication_failed", async () => await f.service.invoke("login", { operationId: operationId(), identifier: owner.username, password: owner.password, sessionToken: token() }));
    await f.service.invoke("login", { operationId: operationId(), identifier: owner.username, password: "next-password-for-owner", sessionToken: token() });
    assert.equal((await f.service.invoke("self", {}, agent.input.runtimeToken)).agentId, agent.agentId);
});
await test("copied old authorization state cannot authenticate into a new recovery epoch", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    const owner = await setup(f, agent);
    const restored: M1Store = { instanceId: f.store.instanceId, recoveryEpoch: "epoch-restored", read: f.store.read.bind(f.store), transaction: f.store.transaction.bind(f.store), async close() { } };
    const service = createM1Service(restored);
    await error("restore_access_unsupported", async () => await service.invoke("self", {}, agent.input.runtimeToken));
    await error("restore_access_unsupported", async () => await service.invoke("login", { operationId: operationId(), identifier: owner.username, password: owner.password, sessionToken: token() }));
    assert.equal(await f.store.read(async (tx) => (await tx.get("agents", agent.agentId))?.id), agent.agentId);
});
await test("secret reuse rolls back the complete registration and durable data contains only verifiers", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const reused = token();
    await error("credential_conflict", async () => await f.service.invoke("register", { operationId: operationId(), attemptId: randomUUID(), runtimeToken: reused, continuationToken: reused }));
    assert.equal(await f.store.read(async (tx) => (await tx.find("agents")).length), 0);
    assert.equal(await f.store.read(async (tx) => (await tx.find("owners")).length), 0);
    const agent = await registration(f);
    const owner = await setup(f, agent);
    const durable = await f.store.read(async (tx) => { const rows = []; for (const table of M1_TABLES) rows.push(await tx.find(table)); return JSON.stringify(rows); });
    for (const secret of [agent.input.runtimeToken, agent.input.continuationToken, owner.sessionToken, owner.recoveryToken, owner.handoffToken, owner.setupToken, owner.password]) {
        assert.equal(durable.includes(secret), false);
        if (secret.includes("."))
            assert.equal(durable.includes(secret.split(".")[1]!), false);
    }
});
await test("HTTP validation and parser failures are safe; registration creation quota is enforced", async (t) => {
    const f = await fixture({ registrationLimit: 1 });
    t.after(async () => await f.store.close());
    const app = Fastify({ logger: false });
    registerM1Routes(app, f.service);
    t.after(async () => await app.close());
    const marker = token();
    const invalid = await app.inject({ method: "POST", url: "/v1/registrations", headers: { "content-type": "application/json" }, payload: `{"runtimeToken":"${marker}",` });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "invalid_request");
    assert.equal(invalid.body.includes(marker), false);
    const oversized = await app.inject({ method: "POST", url: "/v1/registrations", payload: { private: marker.repeat(300) } });
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.body.includes(marker), false);
    const unknown = await app.inject({ method: "POST", url: "/v1/registrations", payload: { operationId: operationId(), attemptId: randomUUID(), runtimeToken: token(), continuationToken: token(), ownerId: "self-claimed" } });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().error.code, "invalid_request");
    await registration(f);
    const quota = await app.inject({ method: "POST", url: "/v1/registrations", payload: { operationId: operationId(), attemptId: randomUUID(), runtimeToken: token(), continuationToken: token() } });
    assert.equal(quota.statusCode, 429);
    const noAuth = await app.inject({ method: "GET", url: "/v1/owner/agents" });
    assert.equal(noAuth.statusCode, 401);
});
await test('recovery preview is read-only, survives session expiry and grants no runtime or session authority', async (t) => {
    const f = await fixture({ sessionTtlMs: 10 });
    t.after(async () => await f.store.close());
    const agent = await registration(f);
    const owner = await setup(f, agent);
    f.tick(11);
    const snapshot = async () => await f.store.read(async (tx) => { const rows = []; for (const table of M1_TABLES) rows.push(await tx.find(table, {})); return JSON.stringify(rows); });
    const before = await snapshot();
    assert.equal((await f.service.invoke('readRecovery', {}, owner.recoveryToken)).ownerId, agent.ownerId);
    assert.equal(await snapshot() === before, true, 'Preview must not consume proofs, create sessions or write receipts');
    await error('insufficient_scope', async () => await f.service.invoke('readRecovery', {}, agent.input.runtimeToken));
    await error('authentication_failed', async () => await f.service.invoke('readRecovery', {}, owner.sessionToken));
    const app = Fastify();
    registerM1Routes(app, f.service);
    t.after(async () => await app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/owner/recovery', headers: { authorization: `Bearer ${owner.recoveryToken}` } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ownerId, agent.ownerId);
    assert.equal(await snapshot() === before, true);
    await f.service.invoke('recover', { operationId: operationId(), password: 'replacement recovery password', recoveryToken: token(), sessionToken: token(), credentialsSaved: true }, owner.recoveryToken);
    await error('authentication_failed', async () => await f.service.invoke('readRecovery', {}, owner.recoveryToken));
});
