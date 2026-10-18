import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue, M1ReadSession, M1Store, M1Table, M1Transaction, StoredRow } from "../contracts/store.ts";
import { checkPassword, equalDigest, hashPassword, parseToken, payloadHash, verifier } from "../domains/access/credentials.ts";
import { accountFields, loginIdentifier } from "../domains/access/account-identifiers.ts";
import { boolean, fail, M1Error, object, text, version } from "../domains/common/errors.ts";
import { AVATAR_COLORS, PROFILE_FIELDS, REMOVABLE_PROFILE_FIELDS, validateFields, validatePublication, validateRemoveFields } from "../domains/profile/profile-rules.ts";
import { FOUNDATION_HTTP_OPERATIONS } from "../contracts/foundation-operations.ts";

export type M1Action =
  | "capabilities" | "catalog" | "register" | "registrationResult" | "self" | "publicProfile"
  | "issueHandoff" | "declareDelivery" | "previewHandoff" | "exchangeSetup" | "readSetup" | "completeSetup" | "readRecovery"
  | "registerOwner" | "readAccount" | "claimAgent"
  | "login" | "recover" | "listAgents" | "managedAgent" | "issueInvite" | "revokeInvite" | "listInvites"
  | "revokeRuntime" | "replaceRuntime" | "readProfile" | "saveDraft" | "publishProfile" | "unpublishProfile" | "profilePolicy"
  | "readMembership" | "join" | "leave" | "participation" | "receipt";

export interface M1Options {
  now?: () => number;
  handoffTtlMs?: number;
  setupTtlMs?: number;
  sessionTtlMs?: number;
  inviteTtlMs?: number;
  registrationLimit?: number;
  ownerRegistrationLimit?: number;
  maxAgentsPerOwner?: number;
  maxActiveInvitesPerOwner?: number;
}

export interface M1Service {
  invoke(action: M1Action, input?: unknown, token?: string): JsonObject;
}

interface Credential extends JsonObject {
  kind: string; fingerprint: string; verifier: string; epoch: string; active: boolean;
  agentId: string | null; ownerId: string | null; expiresAt: number | null;
}
type CredentialRow = StoredRow<Credential>;

function dataObject(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function scalarString(row: StoredRow, key: string): string {
  const value = row.data[key];
  if (typeof value !== "string") throw new Error("Stored state is invalid");
  return value;
}

function numberValue(row: StoredRow, key: string): number {
  const value = row.data[key];
  if (typeof value !== "number") throw new Error("Stored state is invalid");
  return value;
}

function required(session: M1ReadSession, table: M1Table, id: string): StoredRow {
  const row = session.get(table, id);
  if (!row) fail("target_not_accessible", 404, "Target is not accessible");
  return row;
}

function update(tx: M1Transaction, table: M1Table, row: StoredRow, patch: JsonObject): StoredRow {
  const next = { id: row.id, version: row.version + 1, data: { ...row.data, ...patch } };
  if (!tx.update(table, next, row.version)) fail("version_conflict", 409, "State changed; read the current version");
  return next;
}

function expected(row: StoredRow, input: Record<string, unknown>, key = "expectedVersion"): void {
  if (version(input[key], key) !== row.version) fail("version_conflict", 409, "State changed; read the current version", { version: row.version });
}

export function createM1Service(store: M1Store, options: M1Options = {}): M1Service {
  const now = options.now ?? Date.now;
  const limits = {
    handoff: options.handoffTtlMs ?? 15 * 60_000,
    setup: options.setupTtlMs ?? 15 * 60_000,
    session: options.sessionTtlMs ?? 12 * 60 * 60_000,
    invite: options.inviteTtlMs ?? 24 * 60 * 60_000,
    registrations: options.registrationLimit ?? 1000,
    ownerRegistrations: options.ownerRegistrationLimit ?? 1000,
    agentsPerOwner: options.maxAgentsPerOwner ?? 20,
    invitesPerOwner: options.maxActiveInvitesPerOwner ?? 20,
  };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error("Invalid M1 configuration");

  function newCredential(tx: M1Transaction, raw: unknown, kind: string, metadata: JsonObject): CredentialRow {
    const parsed = parseToken(raw, true);
    if (tx.get("credentials", parsed.id) || tx.find("credentials", { fingerprint: parsed.fingerprint }).length > 0) {
      fail("credential_conflict", 409, "Use independent, unused credential material");
    }
    const row: CredentialRow = {
      id: parsed.id, version: 1,
      data: {
        kind, fingerprint: parsed.fingerprint, verifier: verifier(kind, parsed), epoch: store.recoveryEpoch,
        active: true, agentId: null, ownerId: null, expiresAt: null, ...metadata,
      },
    };
    tx.insert("credentials", row);
    return row;
  }

  function authenticate(tx: M1ReadSession, raw: unknown, kinds: readonly string[]): CredentialRow {
    const parsed = parseToken(raw);
    const credential = tx.get<Credential>("credentials", parsed.id);
    if (!credential || !equalDigest(credential.data.verifier, verifier(typeof credential.data.verifierKind === "string" ? credential.data.verifierKind : credential.data.kind, parsed)) || !credential.data.active) {
      fail("authentication_failed", 401, "Authentication failed");
    }
    if (credential.data.epoch !== store.recoveryEpoch) fail("restore_access_unsupported", 403, "Identity is retained; access cannot be restored from old credentials");
    if (credential.data.expiresAt !== null && credential.data.expiresAt <= now()) fail("authentication_failed", 401, "Authentication failed");
    if (!kinds.includes(credential.data.kind)) fail("insufficient_scope", 403, "Credential does not permit this action");
    if (["owner_session", "owner_recovery", "invite"].includes(credential.data.kind)) {
      const owner = tx.get("owners", credential.data.ownerId ?? "");
      if (!owner || owner.data.status !== "active" || owner.data.epoch !== store.recoveryEpoch || owner.data.authVersion !== credential.data.ownerAuthVersion) {
        fail("authentication_failed", 401, "Authentication failed");
      }
    }
    if (credential.data.kind === "runtime") {
      const agent = tx.get("agents", credential.data.agentId ?? "");
      if (!agent || agent.data.runtimeVersion !== credential.data.runtimeVersion) fail("authentication_failed", 401, "Authentication failed");
    }
    if (["bootstrap", "handoff", "setup"].includes(credential.data.kind)) {
      const owner = tx.get("owners", credential.data.ownerId ?? "");
      if (!owner || owner.data.status !== "pending_setup") fail("authentication_failed", 401, "Authentication failed");
      if (credential.data.kind !== "bootstrap" && owner.data.handoffGeneration !== credential.data.handoffGeneration) {
        fail("authentication_failed", 401, "Authentication failed");
      }
    }
    return credential;
  }

  function revokeCredentials(tx: M1Transaction, filters: Record<string, string | boolean>, kinds: readonly string[]): void {
    for (const row of tx.find("credentials", filters)) {
      if (kinds.includes(scalarString(row, "kind")) && row.data.active) update(tx, "credentials", row, { active: false });
    }
  }

  function command(tx: M1Transaction, scope: string, action: string, input: Record<string, unknown>, work: () => JsonObject): JsonObject {
    const operationId = text(input.operationId, "operationId", 8, 100);
    const digest = payloadHash(input);
    const existing = tx.find("operations", { scope, action, operationId, epoch: store.recoveryEpoch })[0];
    if (existing) {
      if (existing.data.payloadHash !== digest) fail("idempotency_payload_mismatch", 409, "Operation was already used with different content");
      return dataObject(existing.data.result);
    }
    const result: JsonObject = {
      ...work(), operationId, outcome: "committed", receiptId: randomUUID(), serverTime: now(),
    };
    tx.insert("operations", { id: randomUUID(), version: 1, data: { scope, action, operationId, epoch: store.recoveryEpoch, payloadHash: digest, result } });
    tx.insert("facts", { id: randomUUID(), version: 1, data: {
      action, operationId, receiptId: result.receiptId!, epoch: store.recoveryEpoch,
      agentId: result.agentId ?? null, ownerId: result.ownerId ?? null, time: result.serverTime!, visibility: "private",
      ...(typeof result.changed === "boolean" ? { changed: result.changed } : {}),
    } });
    return result;
  }

  function registrationView(row: StoredRow): JsonObject {
    return { registrationAttemptId: row.id, agentId: row.data.agentId!, ownerId: row.data.ownerId!, managementStatus: row.data.managementStatus!, profileUrl: profileUrl(scalarString(row, "agentId")) };
  }

  function accountComplete(owner: StoredRow): boolean {
    return typeof owner.data.usernameKey === "string" && typeof owner.data.emailKey === "string";
  }

  function availableAccount(tx: M1ReadSession, fields: ReturnType<typeof accountFields>, ownerId: string): void {
    if (tx.find("owners", { usernameKey: fields.usernameKey }).some((row) => row.id !== ownerId)) fail("username_unavailable", 409, "Username is already in use", { field: "username" });
    if (tx.find("owners", { emailKey: fields.emailKey }).some((row) => row.id !== ownerId)) fail("email_unavailable", 409, "Email is already in use", { field: "email" });
  }

  function profileUrl(agentId: string): string {
    return `/residents/${encodeURIComponent(agentId)}`;
  }

  function profileView(row: StoredRow): JsonObject {
    const confirmationSource = row.data.published !== null && ["runtime_declaration", "owner_authenticated"].includes(row.data.confirmationSource as string) ? row.data.confirmationSource! : null;
    return { agentId: row.data.agentId!, version: row.version, policyVersion: row.data.policyVersion!, mode: row.data.mode!, lockedFields: row.data.lockedFields!, draft: row.data.draft!, published: row.data.published!, publishedVersion: row.data.publishedVersion!, confirmationSource };
  }

  function membershipView(row: StoredRow): JsonObject {
    return { agentId: row.data.agentId!, worldId: row.data.worldId!, version: row.version, state: row.data.state!, ownerPaused: row.data.ownerPaused!, ownerPauseVersion: row.data.ownerPauseVersion!, platformRestricted: row.data.platformRestricted!, platformVersion: row.data.platformVersion! };
  }

  function target(tx: M1ReadSession, credential: CredentialRow, agentId: string): StoredRow {
    if (credential.data.kind === "runtime") {
      if (credential.data.agentId !== agentId) fail("target_not_accessible", 404, "Target is not accessible");
    } else if (credential.data.kind === "owner_session") {
      if (!tx.find("bindings", { agentId, ownerId: credential.data.ownerId, active: true }).length) fail("target_not_accessible", 404, "Target is not accessible");
    } else fail("insufficient_scope", 403, "Credential does not permit this action");
    return required(tx, "agents", agentId);
  }

  function businessWrite(tx: M1ReadSession, actor: CredentialRow, agentId: string): void {
    const member = required(tx, "memberships", agentId);
    if (actor.data.kind === "runtime" && member.data.ownerPaused) fail("participation_paused", 403, "Owner paused platform participation");
    if (member.data.platformRestricted) fail("platform_restricted", 403, "Platform participation is restricted");
  }

  function publicationPermission(profile: StoredRow, actor: CredentialRow, unpublish: boolean): void {
    if (actor.data.kind === "runtime" && profile.data.mode !== "agent_autonomous") fail("confirmation_required", 403, "Owner confirmation is required for publication");
    const published = dataObject(profile.data.published);
    if (unpublish) {
      if (actor.data.kind === "runtime" && (profile.data.lockedFields as string[]).some((field) => Object.hasOwn(published, field))) fail("field_locked", 403, "Owner locked a published field");
      return;
    }
    const draft = dataObject(profile.data.draft);
    validatePublication(draft);
    if (actor.data.kind === "runtime") {
      for (const field of profile.data.lockedFields as string[]) {
        if (JSON.stringify(draft[field]) !== JSON.stringify(published[field])) fail("field_locked", 403, "Owner locked a field changed in this draft");
      }
    }
  }

  function joinPermission(profile: StoredRow): void {
    if (profile.data.published === null) fail("admission_requirements_unmet", 422, "Publish a valid profile before joining");
    validatePublication(dataObject(profile.data.published));
  }

  function effectiveActions(tx: M1ReadSession, actor: CredentialRow, agentId: string): JsonObject {
    const profile = required(tx, "profiles", agentId);
    const check = (work: () => void): JsonObject => {
      try { work(); return { allowed: true, blockedBy: [] }; }
      catch (error) { if (error instanceof M1Error) return { allowed: false, blockedBy: [error.code] }; throw error; }
    };
    const write = () => businessWrite(tx, actor, agentId);
    const locked = profile.data.lockedFields as string[];
    return {
      readProfile: check(() => {}), readMembership: check(() => {}),
      saveDraft: { ...check(write), writableFields: PROFILE_FIELDS.filter((field) => !locked.includes(field)), removableFields: REMOVABLE_PROFILE_FIELDS.filter((field) => !locked.includes(field)) },
      publishProfile: check(() => { write(); publicationPermission(profile, actor, false); }),
      unpublishProfile: check(() => { write(); publicationPermission(profile, actor, true); }),
      join: check(() => { write(); joinPermission(profile); }), leave: check(() => {}),
    };
  }

  function managementView(tx: M1ReadSession, agent: StoredRow): JsonObject {
    const registration = tx.find("registrations", { agentId: agent.id })[0];
    const owner = registration ? tx.get("owners", typeof registration.data.initialOwnerId === "string" ? registration.data.initialOwnerId : scalarString(registration, "ownerId")) : undefined;
    const continuation = registration && typeof registration.data.continuationCredentialId === "string" ? tx.get("credentials", registration.data.continuationCredentialId) : undefined;
    const initial = agent.data.managementKind === "initial" || continuation?.data.kind === "bootstrap";
    const generation = initial && typeof owner?.data.handoffGeneration === "number" ? owner.data.handoffGeneration : null;
    const timestamp = (value: JsonValue | undefined): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      generation,
      generatedAt: initial ? timestamp(owner?.data.handoffGeneratedAt) : null,
      deliveryDeclaredAt: initial && generation !== null && agent.data.deliveryDeclaredGeneration === generation ? timestamp(agent.data.deliveryDeclaredAt) : null,
      initializedAt: timestamp(agent.data.managementInitializedAt) ?? (initial ? timestamp(owner?.data.initializedAt) : null),
      managementStatus: registration?.data.managementStatus === "managed" ? "managed" : "pending_setup",
    };
  }

  function ownerView(tx: M1ReadSession, actor: CredentialRow, agentId: string, asOf: number): JsonObject {
    const agent = target(tx, actor, agentId);
    return { agentId, ownerId: actor.data.ownerId!, runtimeVersion: agent.data.runtimeVersion!, runtimeActive: agent.data.runtimeActive!, profile: profileView(required(tx, "profiles", agentId)), membership: membershipView(required(tx, "memberships", agentId)), profileUrl: profileUrl(agentId), management: managementView(tx, agent), asOf };
  }

  function invoke(action: M1Action, raw: unknown = {}, token?: string): JsonObject {
    if (action === "capabilities") return { apiVersion: "v1", instanceId: store.instanceId, stage: "M1", authentication: "opaque-bearer-v1", ownerRecovery: true, runtimeReplacement: true, scheduling: false, perception: false, interaction: false, operations: FOUNDATION_HTTP_OPERATIONS.map((operation) => ({ ...operation, actors: [...operation.actors], receiptScopes: { ...operation.receiptScopes }, requiredVersions: [...operation.requiredVersions] })) };
    if (action === "catalog") return { version: 1, templates: [{ id: "basic", colors: [...AVATAR_COLORS] }], requiredFields: ["displayName", "avatar"] };
    return store.transaction((tx) => {
      // This is the server's state-read time, never evidence that a local Agent is online.
      const asOf = now();
      if (action === "registerOwner") {
        const input = object(raw, ["operationId", "attemptId", "username", "email", "password", "sessionToken", "recoveryToken", "credentialsSaved"]);
        const attemptId = text(input.attemptId, "attemptId", 36, 36);
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(attemptId)) fail("invalid_request", 400, "Expected a UUID attempt ID", { field: "attemptId" });
        const prior = tx.get("owners", attemptId);
        if (prior) {
          if (prior.data.accountRegistrationAttemptId !== attemptId) fail("account_id_conflict", 409, "Use a new unused account attempt");
          const actor = authenticate(tx, input.sessionToken, ["owner_session"]);
          if (actor.data.ownerId !== prior.id || actor.id !== prior.data.registrationSessionId) fail("authentication_failed", 401, "Authentication failed");
          return command(tx, `owner-registration:${attemptId}`, action, input, () => fail("account_id_conflict", 409, "Use a new unused account attempt"));
        }
        return command(tx, `owner-registration:${attemptId}`, action, input, () => {
          if (input.credentialsSaved !== true) fail("invalid_request", 400, "Save the independent credentials before registration");
          const fields = accountFields(input.username, input.email);
          availableAccount(tx, fields, attemptId);
          if (tx.find("owners").length >= limits.ownerRegistrations) fail("quota_exceeded", 429, "Account registration limit reached");
          const password = hashPassword(input.password);
          tx.insert("owners", { id: attemptId, version: 1, data: { status: "active", epoch: store.recoveryEpoch, authVersion: 1, createdAt: now(), initializedAt: now(), passwordSalt: password.salt, passwordHash: password.hash, ...fields, accountRegistrationAttemptId: attemptId, registrationSessionId: parseToken(input.sessionToken, true).id } });
          newCredential(tx, input.recoveryToken, "owner_recovery", { ownerId: attemptId, ownerAuthVersion: 1 });
          const session = newCredential(tx, input.sessionToken, "owner_session", { ownerId: attemptId, ownerAuthVersion: 1, expiresAt: now() + limits.session });
          return { ownerId: attemptId, sessionId: session.id, expiresAt: session.data.expiresAt!, accountComplete: true };
        });
      }

      if (action === "readAccount") {
        object(raw, []);
        const actor = authenticate(tx, token, ["owner_session"]);
        const owner = required(tx, "owners", actor.data.ownerId!);
        return { ownerId: owner.id, version: owner.version, username: typeof owner.data.username === "string" ? owner.data.username : null, email: typeof owner.data.email === "string" ? owner.data.email : null, emailVerified: false, accountComplete: accountComplete(owner), asOf };
      }

      if (action === "claimAgent") {
        const input = object(raw, ["operationId", "agentId", "expectedGeneration", "handoffToken", "setupToken"]);
        const actor = authenticate(tx, token, ["owner_session"]);
        return command(tx, `owner:${actor.data.ownerId!}`, action, input, () => {
          if ((input.handoffToken === undefined) === (input.setupToken === undefined)) fail("invalid_request", 400, "Supply exactly one private handoff or setup proof");
          const proof = authenticate(tx, input.handoffToken ?? input.setupToken, input.handoffToken === undefined ? ["setup"] : ["handoff"]);
          const agentId = text(input.agentId, "agentId", 8, 100);
          if (proof.data.agentId !== agentId) fail("target_not_accessible", 404, "Target is not accessible");
          const pending = required(tx, "owners", proof.data.ownerId!);
          if (version(input.expectedGeneration, "expectedGeneration") !== proof.data.handoffGeneration) fail("generation_conflict", 409, "Handoff generation changed");
          if (tx.find("bindings", { agentId, active: true }).length) fail("state_conflict", 409, "Agent is already managed");
          if (tx.find("bindings", { ownerId: actor.data.ownerId, active: true }).length >= limits.agentsPerOwner) fail("quota_exceeded", 429, "Owner Agent limit reached");
          const agent = required(tx, "agents", agentId);
          const registration = tx.find("registrations", { agentId })[0]!;
          const continuation = required(tx, "credentials", scalarString(registration, "continuationCredentialId"));
          if (continuation.data.kind !== "bootstrap") fail("target_not_accessible", 404, "Target is not accessible");
          tx.insert("bindings", { id: randomUUID(), version: 1, data: { agentId, ownerId: actor.data.ownerId!, active: true } });
          update(tx, "owners", pending, { status: "claimed", claimedByOwnerId: actor.data.ownerId!, claimedAt: now() });
          update(tx, "registrations", registration, { ownerId: actor.data.ownerId!, initialOwnerId: pending.id, managementStatus: "managed" });
          update(tx, "agents", agent, { managementInitializedAt: now() });
          // Preserve continuation identity as a read-only registration proof; it
          // can no longer mint initial owner capabilities after this claim.
          update(tx, "credentials", continuation, { kind: "registration_receipt", verifierKind: "bootstrap", ownerId: actor.data.ownerId! });
          revokeCredentials(tx, { ownerId: pending.id }, ["bootstrap", "handoff", "setup"]);
          return { ownerId: actor.data.ownerId!, agentId, managementStatus: "managed", generation: proof.data.handoffGeneration!, invalidated: ["bootstrap", "handoff", "setup"] };
        });
      }
      if (action === "publicProfile") {
        const input = object(raw, ["agentId"]);
        const agentId = text(input.agentId, "agentId", 8, 100);
        const agent = tx.get("agents", agentId);
        const profile = tx.get("profiles", agentId);
        const member = tx.get("memberships", agentId);
        if (!agent || !profile || !member || profile.data.published === null || member.data.state !== "joined" || member.data.platformRestricted !== false) {
          fail("target_not_accessible", 404, "Target is not accessible");
        }
        const published = dataObject(profile.data.published);
        const avatar = dataObject(published.avatar);
        if (typeof published.displayName !== "string" || published.displayName.trim().length === 0 || avatar.template !== "basic" || !AVATAR_COLORS.includes(avatar.color as typeof AVATAR_COLORS[number])) {
          fail("target_not_accessible", 404, "Target is not accessible");
        }
        // Build an allowlisted projection. Never return a profile aggregate to an anonymous caller.
        const publicFields: JsonObject = {
          displayName: published.displayName!,
          avatar: { template: avatar.template!, color: avatar.color! },
        };
        if (typeof published.bio === "string") publicFields.bio = published.bio;
        if (Array.isArray(published.interests)) publicFields.interests = published.interests.filter((value): value is string => typeof value === "string");
        return { agentId, profileUrl: profileUrl(agentId), profile: publicFields, membership: { state: "joined" }, asOf };
      }
      if (action === "register") {
        const input = object(raw, ["operationId", "attemptId", "runtimeToken", "continuationToken", "inviteToken"]);
        const attemptId = text(input.attemptId, "attemptId", 8, 100);
        const continuation = parseToken(input.continuationToken, true);
        parseToken(input.runtimeToken, true);
        const prior = tx.get("registrations", attemptId);
        if (prior) {
          const proof = authenticate(tx, input.continuationToken, ["bootstrap", "registration_receipt"]);
          if (proof.data.attemptId !== attemptId || prior.data.continuationCredentialId !== continuation.id) fail("authentication_failed", 401, "Authentication failed");
          if (prior.data.requestHash !== payloadHash(input)) fail("idempotency_payload_mismatch", 409, "Registration attempt was already used with different content");
          return command(tx, `registration:${attemptId}`, action, input, () => registrationView(prior));
        }
        const invite = input.inviteToken === undefined ? undefined : authenticate(tx, input.inviteToken, ["invite"]);
        if (tx.find("agents").length >= limits.registrations) fail("quota_exceeded", 429, "Registration limit reached");
        if (invite && tx.find("bindings", { ownerId: invite.data.ownerId, active: true }).length >= limits.agentsPerOwner) fail("quota_exceeded", 429, "Owner Agent limit reached");
        return command(tx, `registration:${attemptId}`, action, input, () => {
          const agentId = randomUUID();
          const ownerId = invite?.data.ownerId ?? randomUUID();
          const stamp = now();
          if (!invite) tx.insert("owners", { id: ownerId, version: 1, data: { status: "pending_setup", epoch: store.recoveryEpoch, authVersion: 1, handoffGeneration: 0, createdAt: stamp } });
          tx.insert("agents", { id: agentId, version: 1, data: { runtimeVersion: 1, runtimeActive: true, createdAt: stamp, managementKind: invite ? "invited" : "initial", managementInitializedAt: invite ? stamp : null } });
          newCredential(tx, input.runtimeToken, "runtime", { agentId, runtimeVersion: 1 });
          newCredential(tx, input.continuationToken, invite ? "registration_receipt" : "bootstrap", { agentId, ownerId, attemptId });
          if (invite) {
            update(tx, "credentials", invite, { active: false, consumedByAttemptId: attemptId });
            tx.insert("bindings", { id: randomUUID(), version: 1, data: { agentId, ownerId, active: true } });
          }
          const registration: StoredRow = { id: attemptId, version: 1, data: { agentId, ownerId, continuationCredentialId: continuation.id, managementStatus: invite ? "managed" : "pending_setup", requestHash: payloadHash(input) } };
          tx.insert("registrations", registration);
          tx.insert("profiles", { id: agentId, version: 1, data: { agentId, policyVersion: 1, mode: "agent_autonomous", lockedFields: [], draft: {}, published: null, publishedVersion: 0 } });
          tx.insert("memberships", { id: agentId, version: 1, data: { agentId, worldId: "default", state: "not_joined", ownerPaused: false, ownerPauseVersion: 1, platformRestricted: false, platformVersion: 1 } });
          return registrationView(registration);
        });
      }

      if (action === "registrationResult") {
        const input = object(raw, ["attemptId"]);
        const attemptId = text(input.attemptId, "attemptId", 8, 100);
        const actor = authenticate(tx, token, ["runtime", "bootstrap", "registration_receipt", "owner_session"]);
        const row = required(tx, "registrations", attemptId);
        if (actor.data.kind === "owner_session") target(tx, actor, scalarString(row, "agentId"));
        else if (actor.data.agentId !== row.data.agentId || (actor.data.kind !== "runtime" && actor.data.attemptId !== attemptId)) fail("target_not_accessible", 404, "Target is not accessible");
        return registrationView(row);
      }

      if (action === "self") {
        object(raw, []);
        const actor = authenticate(tx, token, ["runtime"]);
        const agentId = actor.data.agentId!;
        const registration = tx.find("registrations", { agentId })[0]!;
        return { agentId, ownerId: scalarString(registration, "ownerId"), instanceId: store.instanceId, runtimeVersion: actor.data.runtimeVersion!, profile: profileView(required(tx, "profiles", agentId)), membership: membershipView(required(tx, "memberships", agentId)), profileUrl: profileUrl(agentId), management: managementView(tx, required(tx, "agents", agentId)), effectiveActions: effectiveActions(tx, actor, agentId), asOf };
      }

      if (action === "issueHandoff") {
        const input = object(raw, ["operationId", "expectedGeneration", "handoffToken"]);
        const actor = authenticate(tx, token, ["bootstrap"]);
        const owner = required(tx, "owners", actor.data.ownerId!);
        return command(tx, `bootstrap:${actor.id}`, action, input, () => {
          if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration !== owner.data.handoffGeneration) fail("generation_conflict", 409, "Read the current handoff generation", { generation: owner.data.handoffGeneration });
          const generation = numberValue(owner, "handoffGeneration") + 1;
          revokeCredentials(tx, { ownerId: owner.id }, ["handoff", "setup"]);
          const handoff = newCredential(tx, input.handoffToken, "handoff", { agentId: actor.data.agentId, ownerId: owner.id, handoffGeneration: generation, expiresAt: now() + limits.handoff });
          update(tx, "owners", owner, { handoffGeneration: generation, handoffGeneratedAt: now() });
          return { agentId: actor.data.agentId!, ownerId: owner.id, handoffId: handoff.id, generation, expiresAt: handoff.data.expiresAt! };
        });
      }

      if (action === "declareDelivery") {
        const input = object(raw, ["operationId", "generation"]);
        const actor = authenticate(tx, token, ["runtime", "bootstrap"]);
        const agent = required(tx, "agents", actor.data.agentId!);
        const registration = tx.find("registrations", { agentId: agent.id })[0]!;
        const owner = required(tx, "owners", scalarString(registration, "ownerId"));
        return command(tx, `agent:${agent.id}`, action, input, () => {
          const continuation = required(tx, "credentials", scalarString(registration, "continuationCredentialId"));
          if (continuation.data.kind !== "bootstrap") fail("insufficient_scope", 403, "This Agent has no initial handoff");
          if (input.generation !== owner.data.handoffGeneration || !Number.isSafeInteger(input.generation) || (input.generation as number) < 1) fail("generation_conflict", 409, "Handoff generation changed");
          update(tx, "agents", agent, { deliveryDeclaredAt: now(), deliveryDeclaredGeneration: input.generation as number });
          return { agentId: agent.id, deliveryStatus: "client_declared_delivered" };
        });
      }

      if (action === "previewHandoff" || action === "exchangeSetup" || action === "readSetup" || action === "completeSetup") {
        const keys = action === "previewHandoff" ? ["handoffId"] : action === "exchangeSetup" ? ["operationId", "setupToken"] : action === "completeSetup" ? ["operationId", "password", "recoveryToken", "sessionToken", "credentialsSaved", "username", "email"] : [];
        const input = object(raw, keys);
        const actor = authenticate(tx, token, action === "previewHandoff" || action === "exchangeSetup" ? ["handoff"] : ["setup"]);
        if (action === "previewHandoff") {
          if (text(input.handoffId, "handoffId", 8, 100) !== actor.id) fail("target_not_accessible", 404, "Target is not accessible");
          return { agentId: actor.data.agentId!, ownerId: actor.data.ownerId!, generation: actor.data.handoffGeneration!, expiresAt: actor.data.expiresAt!, status: "confirmation_required" };
        }
        if (action === "readSetup") return { agentId: actor.data.agentId!, ownerId: actor.data.ownerId!, generation: actor.data.handoffGeneration!, expiresAt: actor.data.expiresAt!, status: "restricted_setup" };
        if (action === "exchangeSetup") return command(tx, `handoff:${actor.id}`, action, input, () => {
          const setup = newCredential(tx, input.setupToken, "setup", { agentId: actor.data.agentId, ownerId: actor.data.ownerId, handoffGeneration: actor.data.handoffGeneration!, expiresAt: now() + limits.setup });
          update(tx, "credentials", actor, { active: false });
          return { agentId: actor.data.agentId!, ownerId: actor.data.ownerId!, setupId: setup.id, generation: actor.data.handoffGeneration!, expiresAt: setup.data.expiresAt! };
        });
        return command(tx, `setup:${actor.id}`, action, input, () => {
          if (input.credentialsSaved !== true) fail("invalid_request", 400, "Save the independent credentials before completing setup");
          const owner = required(tx, "owners", actor.data.ownerId!);
          const fields = accountFields(input.username, input.email);
          availableAccount(tx, fields, owner.id);
          const password = hashPassword(input.password);
          const ownerAuthVersion = numberValue(owner, "authVersion");
          newCredential(tx, input.recoveryToken, "owner_recovery", { ownerId: owner.id, ownerAuthVersion });
          const session = newCredential(tx, input.sessionToken, "owner_session", { ownerId: owner.id, ownerAuthVersion, expiresAt: now() + limits.session });
          tx.insert("bindings", { id: randomUUID(), version: 1, data: { agentId: actor.data.agentId!, ownerId: owner.id, active: true } });
          update(tx, "owners", owner, { status: "active", passwordSalt: password.salt, passwordHash: password.hash, initializedAt: now(), ...fields });
          update(tx, "agents", required(tx, "agents", actor.data.agentId!), { managementInitializedAt: now() });
          const registration = tx.find("registrations", { agentId: actor.data.agentId })[0]!;
          update(tx, "registrations", registration, { managementStatus: "managed" });
          revokeCredentials(tx, { ownerId: owner.id }, ["bootstrap", "handoff", "setup"]);
          return { agentId: actor.data.agentId!, ownerId: owner.id, managementStatus: "managed", sessionId: session.id, expiresAt: session.data.expiresAt!, accountComplete: true, invalidated: ["bootstrap", "handoff", "setup"] };
        });
      }

      if (action === "login") {
        const input = object(raw, ["operationId", "identifier", "password", "sessionToken"]);
        const identifier = loginIdentifier(input.identifier);
        const owner = tx.find("owners", { [identifier.field]: identifier.key })[0];
        const correctPassword = checkPassword(input.password, owner?.data.status === "active" ? scalarString(owner, "passwordSalt") : "unavailable-account", owner?.data.status === "active" ? scalarString(owner, "passwordHash") : "0".repeat(128));
        if (!owner || owner.data.status !== "active" || !correctPassword) fail("authentication_failed", 401, "Authentication failed");
        const ownerId = owner.id;
        if (owner.data.epoch !== store.recoveryEpoch) fail("restore_access_unsupported", 403, "Identity is retained; access cannot be restored from old credentials");
        const scope = `owner-login:${parseToken(input.sessionToken, true).id}`;
        return command(tx, scope, action, input, () => {
          const session = newCredential(tx, input.sessionToken, "owner_session", { ownerId, ownerAuthVersion: owner.data.authVersion!, expiresAt: now() + limits.session });
          return { ownerId, sessionId: session.id, expiresAt: session.data.expiresAt! };
        });
      }

      if (action === "readRecovery") {
        object(raw, []);
        const actor = authenticate(tx, token, ["owner_recovery"]);
        return { ownerId: actor.data.ownerId!, status: "recovery_available" };
      }

      if (action === "recover") {
        const input = object(raw, ["operationId", "password", "recoveryToken", "sessionToken", "credentialsSaved"]);
        const actor = authenticate(tx, token, ["owner_recovery"]);
        return command(tx, `owner:${actor.data.ownerId!}`, action, input, () => {
          if (input.credentialsSaved !== true) fail("invalid_request", 400, "Save the next independent credentials before recovery");
          const password = hashPassword(input.password);
          const owner = required(tx, "owners", actor.data.ownerId!);
          const ownerAuthVersion = numberValue(owner, "authVersion") + 1;
          const recovery = newCredential(tx, input.recoveryToken, "owner_recovery", { ownerId: owner.id, ownerAuthVersion });
          const session = newCredential(tx, input.sessionToken, "owner_session", { ownerId: owner.id, ownerAuthVersion, expiresAt: now() + limits.session });
          for (const old of tx.find("credentials", { ownerId: owner.id })) {
            if (old.id !== recovery.id && old.id !== session.id && ["owner_session", "owner_recovery", "invite"].includes(scalarString(old, "kind")) && old.data.active) update(tx, "credentials", old, { active: false });
          }
          update(tx, "owners", owner, { authVersion: ownerAuthVersion, passwordSalt: password.salt, passwordHash: password.hash });
          return { ownerId: owner.id, sessionId: session.id, ownerAuthVersion, expiresAt: session.data.expiresAt!, invalidated: ["owner_session", "owner_recovery", "invite"] };
        });
      }

      if (action === "listAgents" || action === "managedAgent") {
        const input = object(raw, action === "managedAgent" ? ["agentId"] : []);
        const actor = authenticate(tx, token, ["owner_session"]);
        if (action === "managedAgent") return ownerView(tx, actor, text(input.agentId, "agentId", 8, 100), asOf);
        return { ownerId: actor.data.ownerId!, agents: tx.find("bindings", { ownerId: actor.data.ownerId, active: true }).map((binding) => ownerView(tx, actor, scalarString(binding, "agentId"), asOf)), asOf };
      }

      if (action === "issueInvite" || action === "revokeInvite" || action === "listInvites") {
        const input = object(raw, action === "issueInvite" ? ["operationId", "inviteToken"] : action === "revokeInvite" ? ["operationId", "inviteId", "expectedVersion"] : []);
        const actor = authenticate(tx, token, ["owner_session"]);
        const ownerId = actor.data.ownerId!;
        const inviteView = (row: StoredRow): JsonObject => ({ inviteId: row.id, version: row.version, active: row.data.active!, expiresAt: row.data.expiresAt!, consumed: Boolean(row.data.consumedByAttemptId) });
        if (action === "listInvites") return { invites: tx.find("credentials", { ownerId, kind: "invite" }).map(inviteView) };
        return command(tx, `owner:${ownerId}`, action, input, () => {
          if (action === "issueInvite") {
            if (tx.find("credentials", { ownerId, kind: "invite", active: true }).filter((row) => (row.data.expiresAt as number) > now()).length >= limits.invitesPerOwner) fail("quota_exceeded", 429, "Active invite limit reached");
            const invite = newCredential(tx, input.inviteToken, "invite", { ownerId, ownerAuthVersion: actor.data.ownerAuthVersion!, expiresAt: now() + limits.invite });
            return { ownerId, ...inviteView(invite), limit: 1 };
          }
          const invite = tx.get("credentials", text(input.inviteId, "inviteId", 8, 100));
          if (!invite || invite.data.kind !== "invite" || invite.data.ownerId !== ownerId) fail("target_not_accessible", 404, "Target is not accessible");
          expected(invite, input);
          return { ownerId, ...inviteView(update(tx, "credentials", invite, { active: false })) };
        });
      }

      if (action === "revokeRuntime" || action === "replaceRuntime") {
        const input = object(raw, ["operationId", "agentId", "expectedVersion", ...(action === "replaceRuntime" ? ["runtimeToken"] : [])]);
        const actor = authenticate(tx, token, ["owner_session"]);
        const agentId = text(input.agentId, "agentId", 8, 100);
        const agent = target(tx, actor, agentId);
        return command(tx, `owner:${actor.data.ownerId!}`, action, input, () => {
          if (version(input.expectedVersion) !== agent.data.runtimeVersion) fail("version_conflict", 409, "Runtime generation changed", { version: agent.data.runtimeVersion });
          const runtimeVersion = numberValue(agent, "runtimeVersion") + 1;
          revokeCredentials(tx, { agentId }, ["runtime", "bootstrap", "registration_receipt", "handoff", "setup"]);
          if (action === "replaceRuntime") newCredential(tx, input.runtimeToken, "runtime", { agentId, runtimeVersion });
          update(tx, "agents", agent, { runtimeVersion, runtimeActive: action === "replaceRuntime" });
          return { agentId, runtimeVersion, runtimeActive: action === "replaceRuntime" };
        });
      }

      if (["readProfile", "saveDraft", "publishProfile", "unpublishProfile", "profilePolicy"].includes(action)) {
        const keys = action === "readProfile" ? ["agentId"] : action === "saveDraft" ? ["operationId", "agentId", "expectedVersion", "expectedPolicyVersion", "fields", "removeFields"] : action === "profilePolicy" ? ["operationId", "agentId", "expectedVersion", "expectedPolicyVersion", "mode", "lockedFields"] : ["operationId", "agentId", "expectedVersion", "expectedPolicyVersion"];
        const input = object(raw, keys);
        const actor = authenticate(tx, token, action === "profilePolicy" ? ["owner_session"] : ["runtime", "owner_session"]);
        const agentId = text(input.agentId, "agentId", 8, 100);
        target(tx, actor, agentId);
        const profile = required(tx, "profiles", agentId);
        if (action === "readProfile") return profileView(profile);
        return command(tx, `${actor.data.kind === "runtime" ? "agent" : "owner"}:${actor.data.kind === "runtime" ? agentId : actor.data.ownerId!}`, action, input, () => {
          expected(profile, input);
          if (version(input.expectedPolicyVersion, "expectedPolicyVersion") !== profile.data.policyVersion) fail("version_conflict", 409, "Profile policy changed", { policyVersion: profile.data.policyVersion });
          if (action === "profilePolicy") {
            if (!["agent_autonomous", "owner_specified", "proposal_required"].includes(input.mode as string) || !Array.isArray(input.lockedFields) || input.lockedFields.length > PROFILE_FIELDS.length || input.lockedFields.some((field) => !PROFILE_FIELDS.includes(field as typeof PROFILE_FIELDS[number])) || new Set(input.lockedFields).size !== input.lockedFields.length) fail("invalid_request", 400, "Invalid profile policy");
            return profileView(update(tx, "profiles", profile, { mode: input.mode as string, lockedFields: input.lockedFields as string[], policyVersion: numberValue(profile, "policyVersion") + 1 }));
          }
          businessWrite(tx, actor, agentId);
          if (action === "saveDraft") {
            const fields = validateFields(input.fields) as JsonObject;
            const removeFields = validateRemoveFields(input.removeFields);
            if (removeFields.some((field) => Object.hasOwn(fields, field))) fail("invalid_request", 400, "A field cannot be set and removed together", { field: "removeFields" });
            const locked = profile.data.lockedFields as string[];
            if (actor.data.kind === "runtime" && [...Object.keys(fields), ...removeFields].some((field) => locked.includes(field))) fail("field_locked", 403, "Owner locked a requested field");
            const draft = { ...dataObject(profile.data.draft), ...fields };
            for (const field of removeFields) delete draft[field];
            return profileView(update(tx, "profiles", profile, { draft }));
          }
          publicationPermission(profile, actor, action === "unpublishProfile");
          if (action === "unpublishProfile") {
            if (profile.data.published === null) return { ...profileView(profile), changed: false };
            return { ...profileView(update(tx, "profiles", profile, { published: null })), changed: true };
          }
          const draft = dataObject(profile.data.draft);
          return profileView(update(tx, "profiles", profile, { published: draft, publishedVersion: numberValue(profile, "publishedVersion") + 1, confirmationSource: actor.data.kind === "runtime" ? "runtime_declaration" : "owner_authenticated" }));
        });
      }

      if (["readMembership", "join", "leave", "participation"].includes(action)) {
        const input = object(raw, action === "readMembership" ? ["agentId"] : ["operationId", "agentId", "expectedVersion", ...(action === "join" ? ["expectedProfileVersion"] : action === "participation" ? ["paused"] : [])]);
        const actor = authenticate(tx, token, action === "participation" ? ["owner_session"] : ["runtime", "owner_session"]);
        const agentId = text(input.agentId, "agentId", 8, 100);
        target(tx, actor, agentId);
        const member = required(tx, "memberships", agentId);
        if (action === "readMembership") return membershipView(member);
        return command(tx, `${actor.data.kind === "runtime" ? "agent" : "owner"}:${actor.data.kind === "runtime" ? agentId : actor.data.ownerId!}`, action, input, () => {
          expected(member, input);
          if (action === "participation") return membershipView(update(tx, "memberships", member, { ownerPaused: boolean(input.paused, "paused"), ownerPauseVersion: numberValue(member, "ownerPauseVersion") + 1 }));
          if (action === "leave") return membershipView(member.data.state === "left" ? member : update(tx, "memberships", member, { state: "left" }));
          businessWrite(tx, actor, agentId);
          const profile = required(tx, "profiles", agentId);
          if (version(input.expectedProfileVersion, "expectedProfileVersion") !== profile.version) fail("version_conflict", 409, "Profile changed", { version: profile.version });
          joinPermission(profile);
          return membershipView(member.data.state === "joined" ? member : update(tx, "memberships", member, { state: "joined" }));
        });
      }

      if (action === "receipt") {
        const input = object(raw, ["operationId", "scope", "action"]);
        const operationId = text(input.operationId, "operationId", 8, 100);
        const scope = text(input.scope, "scope", 1, 220);
        const commandAction = text(input.action, "action", 1, 100);
        const actor = authenticate(tx, token, ["runtime", "bootstrap", "registration_receipt", "owner_session"]);
        // This is the same unique command key used by writes. Never choose among
        // otherwise visible receipts when independent clients reuse an operation ID.
        const row = tx.find("operations", { scope, action: commandAction, operationId, epoch: store.recoveryEpoch })[0];
        if (row) {
          const result = dataObject(row.data.result);
          if (actor.data.kind === "owner_session") {
            if (result.ownerId === actor.data.ownerId) return result;
            if (typeof result.agentId === "string" && tx.find("bindings", { agentId: result.agentId, ownerId: actor.data.ownerId, active: true }).length) return result;
          } else if (result.agentId === actor.data.agentId) {
            const registration = tx.find("registrations", { agentId: actor.data.agentId })[0];
            const registrationScope = `registration:${registration?.id ?? ""}`;
            if ((actor.data.kind === "runtime" && (row.data.scope === `agent:${actor.data.agentId}` || row.data.scope === registrationScope)) || row.data.scope === `registration:${actor.data.attemptId}` || row.data.scope === `bootstrap:${actor.id}`) return result;
          }
        }
        fail("target_not_accessible", 404, "Operation is not accessible");
      }
      fail("invalid_request", 400, "Unsupported M1 action");
    });
  }
  return { invoke };
}
