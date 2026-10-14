import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import type { JsonObject } from "../../apps/platform/contracts/store.ts";
import { createM1Service } from "../../apps/platform/application/m1-service.ts";
import { M1Error } from "../../apps/platform/domains/common/errors.ts";
import { openM1Store } from "../../apps/platform/infrastructure/relational/sqlite-store.ts";
import { registerM1Routes } from "../../apps/platform/transport/http/m1-routes.ts";

const op = () => randomUUID();
const token = () => `${randomUUID()}.${randomBytes(32).toString("base64url")}`;

function fixture() {
  const store = openM1Store({ databasePath: ":memory:", instanceId: "projection-instance", recoveryEpoch: "projection-epoch" });
  let time = 10_000;
  const service = createM1Service(store, { now: () => time });
  return { store, service, tick: (delta: number) => { time += delta; }, time: () => time };
}
type Fixture = ReturnType<typeof fixture>;
function register(f: Fixture, inviteToken?: string) {
  const runtimeToken = token(); const continuationToken = token(); const attemptId = randomUUID();
  const result = f.service.invoke("register", { operationId: op(), attemptId, runtimeToken, continuationToken, ...(inviteToken ? { inviteToken } : {}) });
  return { agentId: result.agentId as string, ownerId: result.ownerId as string, runtimeToken, continuationToken, attemptId, result };
}
type Agent = ReturnType<typeof register>;
function handoff(f: Fixture, agent: Agent, expectedGeneration = 0) {
  const handoffToken = token();
  const input = { operationId: op(), expectedGeneration, handoffToken };
  const result = f.service.invoke("issueHandoff", input, agent.continuationToken);
  return { handoffToken, result, input };
}
function complete(f: Fixture, agent: Agent, handoffToken: string) {
  const setupToken = token(); const sessionToken = token();
  f.service.invoke("exchangeSetup", { operationId: op(), setupToken }, handoffToken);
  f.service.invoke("completeSetup", { operationId: op(), password: "private-owner-passphrase", recoveryToken: token(), sessionToken, credentialsSaved: true }, setupToken);
  return sessionToken;
}
function publish(f: Fixture, agent: Agent, bearer = agent.runtimeToken, displayName = "Published Resident") {
  const prior = f.service.invoke("readProfile", { agentId: agent.agentId }, bearer);
  const draft = f.service.invoke("saveDraft", { agentId: agent.agentId, operationId: op(), expectedVersion: prior.version, expectedPolicyVersion: prior.policyVersion, fields: { displayName, avatar: { template: "basic", color: "blue" }, bio: "Public biography", interests: ["maps"] } }, bearer);
  return f.service.invoke("publishProfile", { agentId: agent.agentId, operationId: op(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion }, bearer);
}
function join(f: Fixture, agent: Agent, bearer = agent.runtimeToken) {
  const profile = f.service.invoke("readProfile", { agentId: agent.agentId }, bearer);
  const member = f.service.invoke("readMembership", { agentId: agent.agentId }, bearer);
  return f.service.invoke("join", { agentId: agent.agentId, operationId: op(), expectedVersion: member.version, expectedProfileVersion: profile.version }, bearer);
}
function rejects(code: string, run: () => unknown) {
  assert.throws(run, (failure: unknown) => failure instanceof M1Error && failure.code === code);
}

test("anonymous public profile is an explicit published allowlist gated by current membership and platform restriction", async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const app = Fastify({ logger: false }); registerM1Routes(app, f.service); t.after(() => app.close());
  const agent = register(f);
  const url = `/v1/public/agents/${agent.agentId}`;
  assert.equal(agent.result.profileUrl, `/residents/${agent.agentId}`);
  const privateProfile = f.service.invoke("readProfile", { agentId: agent.agentId }, agent.runtimeToken);
  assert.equal(privateProfile.confirmationSource, null);
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 404);
  const published = publish(f, agent);
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 404);
  let member = join(f, agent);
  const nextDraft = f.service.invoke("saveDraft", { agentId: agent.agentId, operationId: op(), expectedVersion: published.version, expectedPolicyVersion: published.policyVersion, fields: { displayName: "Private unpublished draft" } }, agent.runtimeToken);
  f.store.transaction((tx) => {
    const row = tx.get("profiles", agent.agentId)!;
    const oldPublic = row.data.published as JsonObject;
    tx.update("profiles", { ...row, version: row.version + 1, data: { ...row.data, published: { ...oldPublic, ownerId: agent.ownerId, credential: agent.runtimeToken, policy: "private policy", avatar: { ...(oldPublic.avatar as JsonObject), credential: agent.continuationToken } } } }, row.version);
  });
  const response = await app.inject({ method: "GET", url });
  assert.equal(response.statusCode, 200); assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), {
    agentId: agent.agentId, profileUrl: `/residents/${agent.agentId}`,
    profile: { displayName: "Published Resident", avatar: { template: "basic", color: "blue" }, bio: "Public biography", interests: ["maps"] },
    membership: { state: "joined" }, asOf: f.time(),
  });
  for (const forbidden of [agent.ownerId, agent.runtimeToken, agent.continuationToken, "Private unpublished draft", "private policy", "confirmationSource", "lockedFields", "management"]) assert.equal(response.body.includes(forbidden), false);
  assert.equal(nextDraft.confirmationSource, "runtime_declaration");
  const owner = complete(f, agent, handoff(f, agent).handoffToken);
  member = f.service.invoke("participation", { agentId: agent.agentId, operationId: op(), expectedVersion: member.version, paused: true }, owner);
  f.service.invoke("revokeRuntime", { agentId: agent.agentId, operationId: op(), expectedVersion: 1 }, owner);
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 200, "Owner pause and runtime revocation do not mean exit or private publication");
  member = f.service.invoke("leave", { agentId: agent.agentId, operationId: op(), expectedVersion: member.version }, owner);
  const left = await app.inject({ method: "GET", url });
  const absent = await app.inject({ method: "GET", url: "/v1/public/agents/unknown-resident" });
  assert.equal(left.statusCode, 404); assert.deepEqual(left.json(), absent.json());
  join(f, agent, owner);
  f.store.transaction((tx) => { const row = tx.get("memberships", agent.agentId)!; tx.update("memberships", { ...row, version: row.version + 1, data: { ...row.data, platformRestricted: true, platformVersion: 2 } }, row.version); });
  const restricted = await app.inject({ method: "GET", url });
  assert.equal(restricted.statusCode, 404); assert.deepEqual(restricted.json(), absent.json());
  assert.equal((await app.inject({ method: "GET", url: "/v1/public/agents" })).statusCode, 404);
});

test("management snapshots keep generation-specific delivery, initialization and read time separate", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = register(f);
  const self = () => f.service.invoke("self", {}, agent.runtimeToken);
  assert.deepEqual(self().management, { generation: 0, generatedAt: null, deliveryDeclaredAt: null, initializedAt: null, managementStatus: "pending_setup" });
  rejects("generation_conflict", () => f.service.invoke("declareDelivery", { operationId: op(), generation: 0 }, agent.runtimeToken));
  f.tick(10); const first = handoff(f, agent);
  assert.equal((self().management as JsonObject).generatedAt, 10_010);
  f.tick(10); f.service.invoke("declareDelivery", { operationId: op(), generation: 1 }, agent.runtimeToken);
  assert.equal((self().management as JsonObject).deliveryDeclaredAt, 10_020);
  f.tick(10); const second = handoff(f, agent, 1);
  assert.deepEqual(self().management, { generation: 2, generatedAt: 10_030, deliveryDeclaredAt: null, initializedAt: null, managementStatus: "pending_setup" });
  f.tick(10); assert.deepEqual(f.service.invoke("issueHandoff", second.input, agent.continuationToken), second.result, "A write retry returns its original immutable receipt");
  assert.equal((self().management as JsonObject).generatedAt, 10_030);
  f.tick(10); f.service.invoke("declareDelivery", { operationId: op(), generation: 2 }, agent.runtimeToken);
  const session = complete(f, agent, second.handoffToken);
  const management = { generation: 2, generatedAt: 10_030, deliveryDeclaredAt: 10_050, initializedAt: 10_050, managementStatus: "managed" };
  assert.deepEqual(self().management, management);
  f.tick(60_000);
  const detail = f.service.invoke("managedAgent", { agentId: agent.agentId }, session);
  assert.deepEqual(detail.management, management); assert.equal(detail.asOf, 70_050);
  assert.equal(detail.profileUrl, `/residents/${agent.agentId}`);
  assert.equal(self().asOf, 70_050);
  for (const forbidden of ["online", "lastSeenAt", "heartbeat"]) assert.equal(forbidden in detail, false);
  const list = f.service.invoke("listAgents", {}, session);
  assert.equal(list.asOf, 70_050); assert.equal((list.agents as JsonObject[])[0]!.asOf, list.asOf);
  assert.deepEqual((list.agents as JsonObject[])[0]!.management, management);
  assert.equal(first.result.generation, 1);
});

test("invited Agents have their own binding time and cannot inherit another Agent's handoff or private management view", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const a1 = register(f); const owner = complete(f, a1, handoff(f, a1).handoffToken);
  f.tick(100);
  const inviteToken = token(); f.service.invoke("issueInvite", { operationId: op(), inviteToken }, owner);
  const a2 = register(f, inviteToken);
  const a2View = f.service.invoke("self", {}, a2.runtimeToken);
  assert.deepEqual(a2View.management, { generation: null, generatedAt: null, deliveryDeclaredAt: null, initializedAt: 10_100, managementStatus: "managed" });
  rejects("insufficient_scope", () => f.service.invoke("declareDelivery", { operationId: op(), generation: 1 }, a2.runtimeToken));
  rejects("target_not_accessible", () => f.service.invoke("readProfile", { agentId: a1.agentId }, a2.runtimeToken));
  const other = register(f); const otherOwner = complete(f, other, handoff(f, other).handoffToken);
  rejects("target_not_accessible", () => f.service.invoke("managedAgent", { agentId: a2.agentId }, otherOwner));
  const list = f.service.invoke("listAgents", {}, owner);
  assert.deepEqual((list.agents as JsonObject[]).map((item) => item.agentId).sort(), [a1.agentId, a2.agentId].sort());
  assert.equal(JSON.stringify(f.service.invoke("listAgents", {}, otherOwner)).includes(a2.agentId), false);
  // Pre-MVP records have no handoff creation field or per-invite setup field: do not invent times.
  f.store.transaction((tx) => {
    const row = tx.get("agents", a2.agentId)!;
    const { managementInitializedAt: _unknown, ...data } = row.data;
    tx.update("agents", { ...row, version: row.version + 1, data }, row.version);
    const ownerRow = tx.get("owners", a1.ownerId)!;
    const { handoffGeneratedAt: _unrecorded, ...ownerData } = ownerRow.data;
    tx.update("owners", { ...ownerRow, version: ownerRow.version + 1, data: ownerData }, ownerRow.version);
  });
  assert.equal((f.service.invoke("self", {}, a2.runtimeToken).management as JsonObject).initializedAt, null);
  assert.equal((f.service.invoke("self", {}, a1.runtimeToken).management as JsonObject).generatedAt, null);
});

test("private confirmation source follows the published version across all three modes", (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const agent = register(f);
  assert.equal(publish(f, agent).confirmationSource, "runtime_declaration");
  const owner = complete(f, agent, handoff(f, agent).handoffToken);
  for (const mode of ["owner_specified", "proposal_required"]) {
    const profile = f.service.invoke("readProfile", { agentId: agent.agentId }, owner);
    const policy = f.service.invoke("profilePolicy", { agentId: agent.agentId, operationId: op(), expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion, mode, lockedFields: [] }, owner);
    const draft = f.service.invoke("saveDraft", { agentId: agent.agentId, operationId: op(), expectedVersion: policy.version, expectedPolicyVersion: policy.policyVersion, fields: { displayName: mode } }, agent.runtimeToken);
    const publishInput = { agentId: agent.agentId, operationId: op(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion };
    rejects("confirmation_required", () => f.service.invoke("publishProfile", publishInput, agent.runtimeToken));
    assert.equal(draft.confirmationSource, profile.confirmationSource, "A new draft must not overwrite the last published evidence source");
    const result = f.service.invoke("publishProfile", publishInput, owner);
    assert.equal(result.confirmationSource, "owner_authenticated");
    assert.equal(f.service.invoke("readProfile", { agentId: agent.agentId }, agent.runtimeToken).confirmationSource, "owner_authenticated");
  }
});
