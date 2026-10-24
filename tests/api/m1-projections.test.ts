import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import type { JsonObject } from "../../apps/platform/contracts/store.ts";
import { createM1Service } from "../../apps/platform/application/m1-service.ts";
import { M1Error } from "../../apps/platform/domains/common/errors.ts";
import { openTestStore } from "./postgresql-fixture.ts";
import { registerM1Routes } from "../../apps/platform/transport/http/m1-routes.ts";
const op = () => randomUUID();
const token = () => `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
async function fixture() {
    const store = await openTestStore({ databasePath: ":memory:", instanceId: "projection-instance", recoveryEpoch: "projection-epoch" });
    let time = 10000;
    const service = createM1Service(store, { now: () => time });
    return { store, service, tick: (delta: number) => { time += delta; }, time: () => time };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function register(f: Fixture, inviteToken?: string) {
    const runtimeToken = token();
    const continuationToken = token();
    const attemptId = randomUUID();
    const result = await f.service.invoke("register", { operationId: op(), attemptId, runtimeToken, continuationToken, ...(inviteToken ? { inviteToken } : {}) });
    return { agentId: result.agentId as string, ownerId: result.ownerId as string, runtimeToken, continuationToken, attemptId, result };
}
type Agent = Awaited<ReturnType<typeof register>>;
async function handoff(f: Fixture, agent: Agent, expectedGeneration = 0) {
    const handoffToken = token();
    const input = { operationId: op(), expectedGeneration, handoffToken };
    const result = await f.service.invoke("issueHandoff", input, agent.continuationToken);
    return { handoffToken, result, input };
}
async function complete(f: Fixture, agent: Agent, handoffToken: string) {
    const setupToken = token();
    const sessionToken = token();
    await f.service.invoke("exchangeSetup", { operationId: op(), setupToken }, handoffToken);
    await f.service.invoke("completeSetup", { operationId: op(), username: `Owner_${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password: "private-owner-passphrase", recoveryToken: token(), sessionToken, credentialsSaved: true }, setupToken);
    return sessionToken;
}
async function publish(f: Fixture, agent: Agent, bearer = agent.runtimeToken, displayName = "Published Resident") {
    const prior = await f.service.invoke("readProfile", { agentId: agent.agentId }, bearer);
    const draft = await f.service.invoke("saveDraft", { agentId: agent.agentId, operationId: op(), expectedVersion: prior.version, expectedPolicyVersion: prior.policyVersion, fields: { displayName, avatar: { template: "basic", color: "blue" }, bio: "Public biography", interests: ["maps"] } }, bearer);
    return await f.service.invoke("publishProfile", { agentId: agent.agentId, operationId: op(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion }, bearer);
}
async function join(f: Fixture, agent: Agent, bearer = agent.runtimeToken) {
    const profile = await f.service.invoke("readProfile", { agentId: agent.agentId }, bearer);
    const member = await f.service.invoke("readMembership", { agentId: agent.agentId }, bearer);
    return await f.service.invoke("join", { agentId: agent.agentId, operationId: op(), expectedVersion: member.version, expectedProfileVersion: profile.version }, bearer);
}
async function rejects(code: string, run: () => unknown) {
    await assert.rejects(async () => await run(), (failure: unknown) => failure instanceof M1Error && failure.code === code);
}
await test("anonymous public profile is an explicit published allowlist gated by current membership and platform restriction", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const app = Fastify({ logger: false });
    registerM1Routes(app, f.service);
    t.after(async () => await app.close());
    const agent = await register(f);
    const url = `/v1/public/agents/${agent.agentId}`;
    assert.equal(agent.result.profileUrl, `/residents/${agent.agentId}`);
    const privateProfile = await f.service.invoke("readProfile", { agentId: agent.agentId }, agent.runtimeToken);
    assert.equal(privateProfile.confirmationSource, null);
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 404);
    const published = await publish(f, agent);
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 404);
    let member = await join(f, agent);
    const nextDraft = await f.service.invoke("saveDraft", { agentId: agent.agentId, operationId: op(), expectedVersion: published.version, expectedPolicyVersion: published.policyVersion, fields: { displayName: "Private unpublished draft" } }, agent.runtimeToken);
    await f.store.transaction(async (tx) => {
        const row = (await tx.get("profiles", agent.agentId))!;
        const oldPublic = row.data.published as JsonObject;
        await tx.update("profiles", { ...row, version: row.version + 1, data: { ...row.data, published: { ...oldPublic, ownerId: agent.ownerId, credential: agent.runtimeToken, policy: "private policy", avatar: { ...(oldPublic.avatar as JsonObject), credential: agent.continuationToken } } } }, row.version);
    });
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), {
        agentId: agent.agentId, profileUrl: `/residents/${agent.agentId}`,
        profile: { displayName: "Published Resident", avatar: { template: "basic", color: "blue" }, bio: "Public biography", interests: ["maps"] },
        membership: { state: "joined" }, asOf: f.time(),
    });
    for (const forbidden of [agent.ownerId, agent.runtimeToken, agent.continuationToken, "Private unpublished draft", "private policy", "confirmationSource", "lockedFields", "management"])
        assert.equal(response.body.includes(forbidden), false);
    assert.equal(nextDraft.confirmationSource, "runtime_declaration");
    const owner = await complete(f, agent, (await handoff(f, agent)).handoffToken);
    member = await f.service.invoke("participation", { agentId: agent.agentId, operationId: op(), expectedVersion: member.version, paused: true }, owner);
    await f.service.invoke("revokeRuntime", { agentId: agent.agentId, operationId: op(), expectedVersion: 1 }, owner);
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 200, "Owner pause and runtime revocation do not mean exit or private publication");
    member = await f.service.invoke("leave", { agentId: agent.agentId, operationId: op(), expectedVersion: member.version }, owner);
    const left = await app.inject({ method: "GET", url });
    const absent = await app.inject({ method: "GET", url: "/v1/public/agents/unknown-resident" });
    assert.equal(left.statusCode, 404);
    assert.deepEqual(left.json(), absent.json());
    await join(f, agent, owner);
    await f.store.transaction(async (tx) => { const row = (await tx.get("memberships", agent.agentId))!; await tx.update("memberships", { ...row, version: row.version + 1, data: { ...row.data, platformRestricted: true, platformVersion: 2 } }, row.version); });
    const restricted = await app.inject({ method: "GET", url });
    assert.equal(restricted.statusCode, 404);
    assert.deepEqual(restricted.json(), absent.json());
    assert.equal((await app.inject({ method: "GET", url: "/v1/public/agents" })).statusCode, 404);
});
await test("management snapshots keep generation-specific delivery, initialization and read time separate", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await register(f);
    const self = async () => await f.service.invoke("self", {}, agent.runtimeToken);
    assert.deepEqual((await self()).management, { generation: 0, generatedAt: null, deliveryDeclaredAt: null, initializedAt: null, managementStatus: "pending_setup" });
    await rejects("generation_conflict", async () => await f.service.invoke("declareDelivery", { operationId: op(), generation: 0 }, agent.runtimeToken));
    f.tick(10);
    const first = await handoff(f, agent);
    assert.equal(((await self()).management as JsonObject).generatedAt, 10010);
    f.tick(10);
    await f.service.invoke("declareDelivery", { operationId: op(), generation: 1 }, agent.runtimeToken);
    assert.equal(((await self()).management as JsonObject).deliveryDeclaredAt, 10020);
    f.tick(10);
    const second = await handoff(f, agent, 1);
    assert.deepEqual((await self()).management, { generation: 2, generatedAt: 10030, deliveryDeclaredAt: null, initializedAt: null, managementStatus: "pending_setup" });
    f.tick(10);
    assert.deepEqual(await f.service.invoke("issueHandoff", second.input, agent.continuationToken), second.result, "A write retry returns its original immutable receipt");
    assert.equal(((await self()).management as JsonObject).generatedAt, 10030);
    f.tick(10);
    await f.service.invoke("declareDelivery", { operationId: op(), generation: 2 }, agent.runtimeToken);
    const session = await complete(f, agent, second.handoffToken);
    const management = { generation: 2, generatedAt: 10030, deliveryDeclaredAt: 10050, initializedAt: 10050, managementStatus: "managed" };
    assert.deepEqual((await self()).management, management);
    f.tick(60000);
    const detail = await f.service.invoke("managedAgent", { agentId: agent.agentId }, session);
    assert.deepEqual(detail.management, {managementStatus:"managed"});
    assert.equal(detail.asOf, 70050);
    assert.equal(detail.profileUrl, `/residents/${agent.agentId}`);
    assert.equal((await self()).asOf, 70050);
    for (const forbidden of ["online", "lastSeenAt", "heartbeat"])
        assert.equal(forbidden in detail, false);
    const list = await f.service.invoke("listAgents", {}, session);
    assert.equal(list.asOf, 70050);
    assert.equal((list.agents as JsonObject[])[0]!.asOf, list.asOf);
    assert.deepEqual((list.agents as JsonObject[])[0]!.management, {managementStatus:"managed"});
    assert.equal(first.result.generation, 1);
});
await test("invited Agents have their own binding time and cannot inherit another Agent's handoff or private management view", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const a1 = await register(f);
    const owner = await complete(f, a1, (await handoff(f, a1)).handoffToken);
    f.tick(100);
    const inviteToken = token();
    await f.service.invoke("issueInvite", { operationId: op(), inviteToken }, owner);
    const a2 = await register(f, inviteToken);
    const a2View = await f.service.invoke("self", {}, a2.runtimeToken);
    assert.deepEqual(a2View.management, { generation: null, generatedAt: null, deliveryDeclaredAt: null, initializedAt: 10100, managementStatus: "managed" });
    await rejects("insufficient_scope", async () => await f.service.invoke("declareDelivery", { operationId: op(), generation: 1 }, a2.runtimeToken));
    await rejects("target_not_accessible", async () => await f.service.invoke("readProfile", { agentId: a1.agentId }, a2.runtimeToken));
    const other = await register(f);
    const otherOwner = await complete(f, other, (await handoff(f, other)).handoffToken);
    await rejects("target_not_accessible", async () => await f.service.invoke("managedAgent", { agentId: a2.agentId }, otherOwner));
    const list = await f.service.invoke("listAgents", {}, owner);
    assert.deepEqual((list.agents as JsonObject[]).map((item) => item.agentId).sort(), [a1.agentId, a2.agentId].sort());
    assert.equal(JSON.stringify(await f.service.invoke("listAgents", {}, otherOwner)).includes(a2.agentId), false);
    // Pre-MVP records have no handoff creation field or per-invite setup field: do not invent times.
    await f.store.transaction(async (tx) => {
        const row = (await tx.get("agents", a2.agentId))!;
        const { managementInitializedAt: _unknown, ...data } = row.data;
        await tx.update("agents", { ...row, version: row.version + 1, data }, row.version);
        const ownerRow = (await tx.get("owners", a1.ownerId))!;
        const { handoffGeneratedAt: _unrecorded, ...ownerData } = ownerRow.data;
        await tx.update("owners", { ...ownerRow, version: ownerRow.version + 1, data: ownerData }, ownerRow.version);
    });
    assert.equal(((await f.service.invoke("self", {}, a2.runtimeToken)).management as JsonObject).initializedAt, null);
    assert.equal(((await f.service.invoke("self", {}, a1.runtimeToken)).management as JsonObject).generatedAt, null);
});
await test("private confirmation source follows the published version across all three modes", async (t) => {
    const f = await fixture();
    t.after(async () => await f.store.close());
    const agent = await register(f);
    assert.equal((await publish(f, agent)).confirmationSource, "runtime_declaration");
    const owner = await complete(f, agent, (await handoff(f, agent)).handoffToken);
    for (const mode of ["owner_specified", "proposal_required"]) {
        const profile = await f.service.invoke("readProfile", { agentId: agent.agentId }, owner);
        const policy = await f.service.invoke("profilePolicy", { agentId: agent.agentId, operationId: op(), expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion, mode, lockedFields: [] }, owner);
        const draft = await f.service.invoke("saveDraft", { agentId: agent.agentId, operationId: op(), expectedVersion: policy.version, expectedPolicyVersion: policy.policyVersion, fields: { displayName: mode } }, agent.runtimeToken);
        const publishInput = { agentId: agent.agentId, operationId: op(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion };
        await rejects("confirmation_required", async () => await f.service.invoke("publishProfile", publishInput, agent.runtimeToken));
        assert.equal(draft.confirmationSource, profile.confirmationSource, "A new draft must not overwrite the last published evidence source");
        const result = await f.service.invoke("publishProfile", publishInput, owner);
        assert.equal(result.confirmationSource, "owner_authenticated");
        assert.equal((await f.service.invoke("readProfile", { agentId: agent.agentId }, agent.runtimeToken)).confirmationSource, "owner_authenticated");
    }
});
