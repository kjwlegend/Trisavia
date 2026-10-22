import {assertWorldActionAllowed,worldActionPolicy,worldActionPolicyView} from '../domains/access/world-action-policy.ts';
import {authenticateCredential} from '../domains/access/authentication.ts';
import { mapAsync } from '../domains/common/async-collections.ts';
import { requireRow as required, patchRow as update } from '../domains/common/repository.ts';
import { profileRepository } from '../domains/profile/repository.ts';
import { operationRepository, factRepository } from '../domains/platform/repository.ts';
import { credentialRepository, humanAccountRepository, agentRepository, managementBindingRepository, membershipRepository, recoveryRequestRepository, registrationRepository } from '../domains/access/repository.ts';
import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue, M1ReadSession, M1Store, M1Table, M1Transaction, StoredRow } from "../contracts/store.ts";
import { checkPassword, equalDigest, hashPassword, parseToken, payloadHash, verifier } from "../domains/access/credentials.ts";
import { loginIdentifier } from "../domains/access/account-identifiers.ts";
import { boolean, fail, M1Error, object, text, version } from "../domains/common/errors.ts";
import { PROFILE_FIELDS, REMOVABLE_PROFILE_FIELDS, defaultPublicProfile, validateFields, validatePublication, validateRemoveFields } from "../domains/profile/profile-rules.ts";
import {avatarCatalog} from '../domains/profile/appearance-catalog.ts';
import {projectAvatar,readAppearance,type LegacyAvatarIdentityReader} from '../domains/profile/appearance.ts';
import { createEmailOnboarding } from "./email-onboarding.ts";
import type { EmailConfig } from "../infrastructure/email/resend.ts";
import { FOUNDATION_HTTP_OPERATIONS } from "../contracts/foundation-operations.ts";
import { createWalletService } from "./wallet-service.ts";
import { initializeWalletAccount } from "../domains/wallet/repository.ts";
import { createTrustedMailboxReceiver } from "./mailbox-service.ts";
import { createPerceptionService, type PerceptionOptions } from "./perception-service.ts";
import { initializePerceptionAgent } from "./perception-seed.ts";
import {createOwnerFriendsReader} from "./owner-friends.ts";
import type { PerceptionAction } from "../domains/perception/protocol.ts";
export type M1Action = PerceptionAction | "readOwnerFriends" | "capabilities" | "catalog" | "register" | "registrationResult" | "self" | "publicProfile" | "issueHandoff" | "declareDelivery" | "previewHandoff" | "exchangeSetup" | "readSetup" | "completeSetup" | "readRecovery" | "registerOwner" | "readAccount" | "claimAgent" | "login" | "recover" | "listAgents" | "managedAgent" | "issueInvite" | "revokeInvite" | "listInvites" | "revokeRuntime" | "replaceRuntime" | "readProfile" | "saveProfile" | "saveDraft" | "publishProfile" | "unpublishProfile" | "profilePolicy" | "createRecoveryRequest" | "readRecoveryRequest" | "cancelRecoveryRequest" | "recoveryAssistance" | "verifyRecoveryRequest" | "rejectRecoveryRequest" | "startRegistration" | "readRegistrationAttempt" | "sendRegistrationCode" | "verifyRegistrationEmail" | "cancelRegistration" | "startEmailRecovery" | "readEmailRecoveryAttempt" | "sendRecoveryCode" | "verifyRecoveryEmail" | "recoverByEmail" | "enableRecoveryBackup" | "readWorldActionPolicy" | "saveWorldActionPolicy" | "readWorldAccess" | "saveWorldAccess" | "adoptWorldAccess" | "readMembership" | "join" | "leave" | "participation" | "receipt";
export interface M1Options {
    legacyAvatarIdentity?:LegacyAvatarIdentityReader<M1ReadSession>;
    perception?: PerceptionOptions;
    /** Composition-owned source reader. Keeps Owner REST and Gateway on the same current authorization. */
    friendshipOwnerRead?:(raw:unknown,token:unknown)=>Promise<JsonObject>;
    /** Composition-owned module discovery. M1 does not implement those modules. */
    gateway?: () => JsonObject;
    now?: () => number;
    email?: EmailConfig;
    handoffTtlMs?: number;
    setupTtlMs?: number;
    sessionTtlMs?: number;
    inviteTtlMs?: number;
    recoveryRequestTtlMs?: number;
    registrationLimit?: number;
    ownerRegistrationLimit?: number;
    maxAgentsPerOwner?: number;
    maxActiveInvitesPerOwner?: number;
}
export interface M1Service {
    /** Process-only trusted-source reception; never registered as HTTP authority. */
    receiveTrustedMessage(sourceId: string, input: unknown, context: unknown): Promise<JsonObject>;
    invoke(action: M1Action, input?: unknown, token?: string, context?: {
        clientIp?: string;
    }): Promise<JsonObject>;
    invokeHttp(action: M1Action, input?: unknown, token?: string, context?: {
        clientIp?: string;
    }): Promise<JsonObject>;
}
interface Credential extends JsonObject {
    kind: string;
    fingerprint: string;
    verifier: string;
    epoch: string;
    active: boolean;
    agentId: string | null;
    ownerId: string | null;
    expiresAt: number | null;
}
type CredentialRow = StoredRow<Credential>;
function dataObject(value: JsonValue | undefined): JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function scalarString(row: StoredRow, key: string): string {
    const value = row.data[key];
    if (typeof value !== "string")
        throw new Error("Stored state is invalid");
    return value;
}
function numberValue(row: StoredRow, key: string): number {
    const value = row.data[key];
    if (typeof value !== "number")
        throw new Error("Stored state is invalid");
    return value;
}
function expected(row: StoredRow, input: Record<string, unknown>, key = "expectedVersion"): void {
    if (version(input[key], key) !== row.version)
        fail("version_conflict", 409, "State changed; read the current version", { version: row.version });
}
export function createM1Service(store: M1Store, options: M1Options = {}): M1Service {
    const now = options.now ?? Date.now;
    const limits = {
        handoff: options.handoffTtlMs ?? 15 * 60000,
        setup: options.setupTtlMs ?? 15 * 60000,
        session: options.sessionTtlMs ?? 12 * 60 * 60000,
        invite: options.inviteTtlMs ?? 24 * 60 * 60000,
        recoveryRequest: options.recoveryRequestTtlMs ?? 30 * 60000,
        registrations: options.registrationLimit ?? 1000,
        ownerRegistrations: options.ownerRegistrationLimit ?? 1000,
        agentsPerOwner: options.maxAgentsPerOwner ?? 20,
        invitesPerOwner: options.maxActiveInvitesPerOwner ?? 20,
    };
    if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1))
        throw new Error("Invalid M1 configuration");
    async function newCredential(tx: M1Transaction, raw: unknown, kind: string, metadata: JsonObject): Promise<CredentialRow> {
        const parsed = parseToken(raw, true);
        if (await credentialRepository(tx).get(parsed.id) || await credentialRepository(tx).existsByFingerprint(parsed.fingerprint)) {
            fail("credential_conflict", 409, "Use independent, unused credential material");
        }
        const row: CredentialRow = {
            id: parsed.id, version: 1,
            data: {
                kind, fingerprint: parsed.fingerprint, verifier: verifier(kind, parsed), epoch: store.recoveryEpoch,
                active: true, agentId: null, ownerId: null, expiresAt: null, ...metadata,
            },
        };
        await credentialRepository(tx).insert(row);
        return row;
    }
    async function authenticate(tx: M1ReadSession, raw: unknown, kinds: readonly string[]): Promise<CredentialRow> {
        return await authenticateCredential(tx, raw, kinds, { recoveryEpoch: store.recoveryEpoch, now });
    }

    async function revokeCredentials(tx: M1Transaction, subject: {ownerId:string}|{agentId:string}, kinds: readonly string[]): Promise<void> {
        for (const row of ('ownerId' in subject ? await credentialRepository(tx).findByOwnerId(subject.ownerId) : await credentialRepository(tx).findByAgentId(subject.agentId))) {
            if (kinds.includes(scalarString(row, "kind")) && row.data.active)
                await update(credentialRepository(tx), row, { active: false });
        }
    }
    async function command(tx: M1Transaction, scope: string, action: string, input: Record<string, unknown>, work: () => JsonObject | Promise<JsonObject>): Promise<JsonObject> {
        const operationId = text(input.operationId, "operationId", 8, 100);
        const digest = payloadHash(input);
        const existing = (await operationRepository(tx).findByActionAndEpochAndOperationIdAndScope(action, store.recoveryEpoch, operationId, scope))[0];
        if (existing) {
            if (existing.data.payloadHash !== digest)
                fail("idempotency_payload_mismatch", 409, "Operation was already used with different content");
            return dataObject(existing.data.result);
        }
        const result: JsonObject = {
            ...await work(), operationId, outcome: "committed", receiptId: randomUUID(), serverTime: now(),
        };
        await operationRepository(tx).insert({ id: randomUUID(), version: 1, data: { scope, action, operationId, epoch: store.recoveryEpoch, payloadHash: digest, result } });
        await factRepository(tx).insert({ id: randomUUID(), version: 1, data: {
                action, operationId, receiptId: result.receiptId!, epoch: store.recoveryEpoch,
                agentId: result.agentId ?? null, ownerId: result.ownerId ?? null, time: result.serverTime!, visibility: "private",
                ...(typeof result.changed === "boolean" ? { changed: result.changed } : {}),
                ...(typeof result.verificationMode === "string" ? { verificationMode: result.verificationMode } : {}),
                ...(typeof result.verificationSource === "string" ? { verificationSource: result.verificationSource } : {}),
            } });
        return result;
    }
    function registrationView(row: StoredRow): JsonObject {
        return { registrationAttemptId: row.id, agentId: row.data.agentId!, ownerId: row.data.ownerId!, managementStatus: row.data.managementStatus!, ...(options.gateway ? { gateway: { capabilities: "/v1/capabilities", discovery: "/v1/gateway/discovery", ownerBindingRequired: false } } : {}), profileUrl: profileUrl(scalarString(row, "agentId")) };
    }
    function accountComplete(owner: StoredRow): boolean {
        return typeof owner.data.usernameKey === "string" && typeof owner.data.emailKey === "string";
    }
    function profileUrl(agentId: string): string {
        return `/residents/${encodeURIComponent(agentId)}`;
    }
    function profileView(row: StoredRow): JsonObject {
        const confirmationSource = row.data.published !== null && ["platform_default", "runtime_declaration", "owner_authenticated"].includes(row.data.confirmationSource as string) ? row.data.confirmationSource! : null;
        return { agentId: row.data.agentId!, version: row.version, policyVersion: row.data.policyVersion!, mode: row.data.mode!, lockedFields: row.data.lockedFields!, draft: row.data.draft!, published: row.data.published!, publishedVersion: row.data.publishedVersion!, confirmationSource, proposalPending: payloadHash(dataObject(row.data.draft)) !== payloadHash(dataObject(row.data.published)) };
    }
    /** Read-only presentation fields never enter stored profiles or historical command receipts. */
    async function readProfileView(tx:M1ReadSession,row:StoredRow):Promise<JsonObject> {
        const agentId=scalarString(row,'agentId');
        let identity:ReturnType<LegacyAvatarIdentityReader<M1ReadSession>>|undefined;
        const reader=options.legacyAvatarIdentity?((session:M1ReadSession,input:{agentId:string;worldId:'default'})=>identity??=options.legacyAvatarIdentity!(session,input)):undefined;
        return {...profileView(row),publishedAppearance:row.data.published===null?null:await readAppearance(tx,agentId,dataObject(row.data.published).avatar,reader),draftAppearance:row.data.draft===null?null:await readAppearance(tx,agentId,dataObject(row.data.draft).avatar,reader)};
    }
    function worldAccessView(agent: StoredRow, asOf: number): JsonObject {
        const stored = dataObject(agent.data.worldAccess);
        const currentVersion = stored.version ?? 1;
        const intervalSeconds = stored.intervalSeconds ?? null;
        if (!Number.isSafeInteger(currentVersion) || (currentVersion as number) < 1
            || (intervalSeconds !== null && (!Number.isSafeInteger(intervalSeconds) || (intervalSeconds as number) < 1)))
            throw new Error("Stored world access preference is invalid");
        const rawAdoption=stored.adoption;
        if(rawAdoption!==undefined&&rawAdoption!==null&&(typeof rawAdoption!=='object'||Array.isArray(rawAdoption)||!Number.isSafeInteger(rawAdoption.appliedVersion)||Number(rawAdoption.appliedVersion)<1||!['scheduled','stopped','unknown'].includes(String(rawAdoption.jobState))||!Number.isSafeInteger(rawAdoption.reportedAt)||Number(rawAdoption.reportedAt)<0))fail('world_access_unavailable',503,'Stored adoption report is invalid');
        const report=dataObject(rawAdoption),appliedVersion=report.appliedVersion??null,jobState=report.jobState??'unknown';
        const adoption={appliedVersion,jobState,reportedAt:report.reportedAt??null,status:appliedVersion!==null&&appliedVersion!==currentVersion?'awaiting':jobState==='unknown'?'unknown':'current',source:'agent_report'};
        return { agentId: agent.id, version: currentVersion, intervalSeconds, adoption, asOf };
    }
    function membershipView(row: StoredRow): JsonObject {
        return { agentId: row.data.agentId!, worldId: row.data.worldId!, version: row.version, state: row.data.state!, ownerPaused: row.data.ownerPaused!, ownerPauseVersion: row.data.ownerPauseVersion!, platformRestricted: row.data.platformRestricted!, platformVersion: row.data.platformVersion! };
    }
    async function target(tx: M1ReadSession, credential: CredentialRow, agentId: string): Promise<StoredRow> {
        if (credential.data.kind === "runtime") {
            if (credential.data.agentId !== agentId)
                fail("target_not_accessible", 404, "Target is not accessible");
        }
        else if (credential.data.kind === "owner_session") {
            if (!await managementBindingRepository(tx).existsActiveByAgentIdAndOwnerId(agentId, credential.data.ownerId!))
                fail("target_not_accessible", 404, "Target is not accessible");
        }
        else
            fail("insufficient_scope", 403, "Credential does not permit this action");
        return await required(agentRepository(tx), agentId);
    }
    async function businessWrite(tx: M1ReadSession, actor: CredentialRow, agentId: string): Promise<void> {
        const member = await required(membershipRepository(tx), agentId);
        if (actor.data.kind === "runtime" && member.data.ownerPaused)
            fail("participation_paused", 403, "Owner paused platform participation");
        if (member.data.platformRestricted)
            fail("platform_restricted", 403, "Platform participation is restricted");
    }
    async function directSavePermission(tx: M1ReadSession, actor: CredentialRow, agentId: string, profile: StoredRow): Promise<void> {
        await businessWrite(tx, actor, agentId);
        if (actor.data.kind === "runtime" && profile.data.mode !== "agent_autonomous")
            fail("confirmation_required", 403, "Owner confirmation is required for publication");
        const member = await required(membershipRepository(tx), agentId);
        if (member.data.state !== "joined" || (actor.data.kind === "runtime" && profile.data.published === null)) {
            fail("role_not_public", 409, "Restore the explicit public role before using direct save", { membershipState: member.data.state!, published: profile.data.published !== null });
        }
    }
    function publicationPermission(profile: StoredRow, actor: CredentialRow, unpublish: boolean): void {
        if (actor.data.kind === "runtime" && profile.data.mode !== "agent_autonomous")
            fail("confirmation_required", 403, "Owner confirmation is required for publication");
        const published = dataObject(profile.data.published);
        if (unpublish) {
            if (actor.data.kind === "runtime" && (profile.data.lockedFields as string[]).some((field) => Object.hasOwn(published, field)))
                fail("field_locked", 403, "Owner locked a published field");
            return;
        }
        const draft = dataObject(profile.data.draft);
        validatePublication(draft);
        if (actor.data.kind === "runtime") {
            for (const field of profile.data.lockedFields as string[]) {
                if (JSON.stringify(draft[field]) !== JSON.stringify(published[field]))
                    fail("field_locked", 403, "Owner locked a field changed in this draft");
            }
        }
    }
    function joinPermission(profile: StoredRow): void {
        if (profile.data.published === null)
            fail("admission_requirements_unmet", 422, "Publish a valid profile before joining");
        validatePublication(dataObject(profile.data.published));
    }
    async function recoveryOwner(tx: M1ReadSession, agentId: string): Promise<StoredRow> {
        const binding = (await managementBindingRepository(tx).findByActiveAndAgentId(true, agentId))[0];
        const owner = binding && await humanAccountRepository(tx).get(scalarString(binding, "ownerId"));
        if (!owner || owner.data.status !== "active" || owner.data.epoch !== store.recoveryEpoch)
            fail("owner_setup_required", 409, "Complete owner setup before requesting assistance");
        return owner;
    }
    async function recoveryStatus(tx: M1ReadSession, request: StoredRow): Promise<string> {
        // A completed request records this exact recovery, despite its auth-version rotation.
        if (request.data.status !== "pending")
            return scalarString(request, "status");
        const owner = await humanAccountRepository(tx).get(scalarString(request, "ownerId"));
        const binding = await managementBindingRepository(tx).get(scalarString(request, "bindingId"));
        const runtime = await credentialRepository(tx).get(scalarString(request, "creatorRuntimeCredentialId"));
        const agent = await agentRepository(tx).get(scalarString(request, "agentId"));
        if (request.data.epoch !== store.recoveryEpoch || numberValue(request, "expiresAt") <= now()
            || !owner || owner.data.status !== "active" || owner.data.epoch !== store.recoveryEpoch || owner.data.authVersion !== request.data.ownerAuthVersion
            || !binding || binding.version !== request.data.bindingVersion || binding.data.active !== true || binding.data.ownerId !== owner.id
            || !runtime || runtime.data.active !== true || runtime.data.kind !== "runtime" || runtime.data.epoch !== store.recoveryEpoch
            || runtime.data.runtimeVersion !== request.data.creatorRuntimeVersion || !agent || agent.data.runtimeVersion !== request.data.creatorRuntimeVersion || agent.data.runtimeActive !== true)
            return "expired";
        return "pending";
    }
    async function recoveryCreatePermission(tx: M1ReadSession, agentId: string): Promise<StoredRow> {
        const owner = await recoveryOwner(tx, agentId);
        if (await recoveryRequestRepository(tx).countRecent(now() - 3600000, 5, { ownerId: owner.id }) >= 5)
            fail("recovery_rate_limited", 429, "Try again later");
        if (await recoveryRequestRepository(tx).hasCurrentPending(agentId, store.recoveryEpoch, now()))
            fail("recovery_request_pending", 409, "A recovery request is already pending");
        return owner;
    }
    async function recoveryView(tx: M1ReadSession, request: StoredRow, ownerContext = false): Promise<JsonObject> {
        const status = await recoveryStatus(tx, request);
        return { requestId: request.id, agentId: request.data.agentId!, version: request.version, status, expiresAt: request.data.expiresAt!,
            ...(ownerContext ? { ownerId: request.data.ownerId!, requires: "owner_recovery" } : { nextAction: status === "pending" ? "deliver_private_entry" : "none" }) };
    }
    async function recoveryContext(tx: M1ReadSession, raw: unknown, ownerId?: string): Promise<StoredRow> {
        const context = await authenticate(tx, raw, ["recovery_assistance"]);
        const request = await required(recoveryRequestRepository(tx), context.id);
        if (ownerId !== undefined && request.data.ownerId !== ownerId)
            fail("target_not_accessible", 404, "Target is not accessible");
        return request;
    }
    async function pendingRecovery(tx: M1ReadSession, request: StoredRow): Promise<void> {
        if (await recoveryStatus(tx, request) === "expired" || numberValue(request, "expiresAt") <= now())
            fail("recovery_request_expired", 410, "Recovery request expired");
        if (request.data.status !== "pending")
            fail("recovery_request_closed", 409, "Recovery request is closed");
    }
    async function effectiveActions(tx: M1ReadSession, actor: CredentialRow, agentId: string): Promise<JsonObject> {
        const profile = await required(profileRepository(tx), agentId);
        const check = async (work: () => void | Promise<void>): Promise<JsonObject> => {
            try {
                await work();
                return { allowed: true, blockedBy: [] };
            }
            catch (error) {
                if (error instanceof M1Error)
                    return { allowed: false, blockedBy: [error.code] };
                throw error;
            }
        };
        const write = async () => await businessWrite(tx, actor, agentId);
        const locked = profile.data.lockedFields as string[];
        return {
            readProfile: await check(() => { }), readMembership: await check(() => { }),
            saveProfile: { ...await check(async () => await directSavePermission(tx, actor, agentId, profile)), writableFields: PROFILE_FIELDS.filter((field) => !locked.includes(field)), removableFields: REMOVABLE_PROFILE_FIELDS.filter((field) => !locked.includes(field)) },
            readWorldAccess: await check(() => { }), saveWorldAccess: await check(() => { }),
            readWorldActionPolicy: await check(() => { }), saveWorldActionPolicy: {allowed:false,blockedBy:['insufficient_scope']},
            saveDraft: { ...await check(write), writableFields: PROFILE_FIELDS.filter((field) => !locked.includes(field)), removableFields: REMOVABLE_PROFILE_FIELDS.filter((field) => !locked.includes(field)) },
            publishProfile: await check(async () => { await write(); publicationPermission(profile, actor, false); }),
            unpublishProfile: await check(async () => { await write(); publicationPermission(profile, actor, true); }),
            join: await check(async () => { assertWorldActionAllowed(worldActionPolicy(await required(agentRepository(tx),agentId)),'world.membership.join'); await write(); joinPermission(profile); }), leave: await check(async () => { assertWorldActionAllowed(worldActionPolicy(await required(agentRepository(tx),agentId)),'world.membership.leave'); }),
            createRecoveryRequest: await check(async () => { await recoveryCreatePermission(tx, agentId); }),
            readRecoveryRequest: await check(() => { }),
            cancelRecoveryRequest: await check(async () => {
                if (!await recoveryRequestRepository(tx).hasCurrentPending(agentId, store.recoveryEpoch, now()))
                    fail("recovery_request_closed", 409, "No pending recovery request");
            }),
        };
    }
    async function managementView(tx: M1ReadSession, agent: StoredRow): Promise<JsonObject> {
        const registration = (await registrationRepository(tx).findByAgentId(agent.id))[0];
        const owner = registration ? await humanAccountRepository(tx).get(typeof registration.data.initialOwnerId === "string" ? registration.data.initialOwnerId : scalarString(registration, "ownerId")) : undefined;
        const continuation = registration && typeof registration.data.continuationCredentialId === "string" ? await credentialRepository(tx).get(registration.data.continuationCredentialId) : undefined;
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
    async function ownerView(tx: M1ReadSession, actor: CredentialRow, agentId: string, asOf: number): Promise<JsonObject> {
        const agent = await target(tx, actor, agentId);
        return { agentId, ownerId: actor.data.ownerId!, runtimeVersion: agent.data.runtimeVersion!, runtimeActive: agent.data.runtimeActive!, profile: await readProfileView(tx,await required(profileRepository(tx), agentId)), membership: membershipView(await required(membershipRepository(tx), agentId)), worldAccess: worldAccessView(agent, asOf), profileUrl: profileUrl(agentId), management: await managementView(tx, agent), asOf };
    }
    const readOwnerFriends=createOwnerFriendsReader(store,{now,...(options.legacyAvatarIdentity?{legacyAvatarIdentity:options.legacyAvatarIdentity}:{})});
    const wallet = createWalletService(store, authenticate, now);
    const receiveTrustedMessage = createTrustedMailboxReceiver(store, options.perception?.mailboxSources ?? [], authenticate, now);
    const perception = createPerceptionService(store, { authenticate }, { ...options.perception, now, ...(options.legacyAvatarIdentity?{legacyAvatarIdentity:options.legacyAvatarIdentity}:{}) });
    const email = createEmailOnboarding(store, { authenticate, newCredential, command, pendingRecovery, recoveryContext }, {
        now, sessionTtl: limits.session, ownerLimit: limits.ownerRegistrations, ...(options.email ? { config: options.email } : {}),
    });
    async function invoke(action: M1Action, raw: unknown = {}, token?: string, context: {
        clientIp?: string;
    } = {}): Promise<JsonObject> {
        if (action === "capabilities") {
            const gateway = options.gateway?.();
            return { apiVersion: "v1", instanceId: store.instanceId, stage: "M1", authentication: "opaque-bearer-v1", ownerRecovery: true, ownerRecoveryAssistance: true, ownerEmailVerification: email.configured, ownerEmailRecovery: email.configured, emailMode: email.mode, runtimeReplacement: true, defaultPublicRole: true, profileSave: "immediate-public", worldAccessPreference: true, scheduling: false, perception: true, perceptionApi: await perception.capabilities(), walletApi: wallet.capabilities(), interaction: Array.isArray(gateway?.modules) && gateway.modules.includes("interaction"), ...(gateway ? { gateway } : {}), operations: FOUNDATION_HTTP_OPERATIONS.map((operation) => ({ ...operation, actors: [...operation.actors], receiptScopes: { ...operation.receiptScopes }, requiredVersions: [...operation.requiredVersions] })) };
        }
        if (action === "catalog")
            return avatarCatalog();
        if (email.handles(action))
            return await email.invoke(action, raw, token, context.clientIp);
        if (action === "readOwnerFriends")
            return await (options.friendshipOwnerRead??readOwnerFriends)(raw,token);
        if (action === "walletQuery")
            return await wallet.query(raw, token);
        if (perception.handles(action))
            return await perception.invoke(action as PerceptionAction, raw, token);
        return await store.transaction(async (tx) => {
            // This is the server's state-read time, never evidence that a local Agent is online.
            const asOf = now();
            if (action === "readAccount") {
                object(raw, []);
                const actor = await authenticate(tx, token, ["owner_session"]);
                const owner = await required(humanAccountRepository(tx), actor.data.ownerId!);
                return { ownerId: owner.id, version: owner.version, username: typeof owner.data.username === "string" ? owner.data.username : null, email: typeof owner.data.email === "string" ? owner.data.email : null, emailVerified: owner.data.emailVerified === true, emailVerifiedAt: owner.data.emailVerifiedAt ?? null, emailVerificationSource: owner.data.emailVerificationSource ?? null, emailVerificationMode: owner.data.emailVerificationMode ?? null, lastRecoveryVerificationMode: owner.data.lastRecoveryVerificationMode ?? null, lastRecoveryVerificationSource: owner.data.lastRecoveryVerificationSource ?? null, accountComplete: accountComplete(owner), asOf };
            }
            if (action === "claimAgent") {
                const input = object(raw, ["operationId", "agentId", "expectedGeneration", "handoffToken", "setupToken"]);
                const actor = await authenticate(tx, token, ["owner_session"]);
                return await command(tx, `owner:${actor.data.ownerId!}`, action, input, async () => {
                    if ((input.handoffToken === undefined) === (input.setupToken === undefined))
                        fail("invalid_request", 400, "Supply exactly one private handoff or setup proof");
                    const proof = await authenticate(tx, input.handoffToken ?? input.setupToken, input.handoffToken === undefined ? ["setup"] : ["handoff"]);
                    const agentId = text(input.agentId, "agentId", 8, 100);
                    if (proof.data.agentId !== agentId)
                        fail("target_not_accessible", 404, "Target is not accessible");
                    const pending = await required(humanAccountRepository(tx), proof.data.ownerId!);
                    if (version(input.expectedGeneration, "expectedGeneration") !== proof.data.handoffGeneration)
                        fail("generation_conflict", 409, "Handoff generation changed");
                    if (await managementBindingRepository(tx).existsActiveByAgentId(agentId))
                        fail("state_conflict", 409, "Agent is already managed");
                    if (await managementBindingRepository(tx).countActiveByOwnerId(actor.data.ownerId!, limits.agentsPerOwner) >= limits.agentsPerOwner)
                        fail("quota_exceeded", 429, "Owner Agent limit reached");
                    const agent = await required(agentRepository(tx), agentId);
                    const registration = (await registrationRepository(tx).findByAgentId(agentId))[0]!;
                    const continuation = await required(credentialRepository(tx), scalarString(registration, "continuationCredentialId"));
                    if (continuation.data.kind !== "bootstrap")
                        fail("target_not_accessible", 404, "Target is not accessible");
                    await managementBindingRepository(tx).insert({ id: randomUUID(), version: 1, data: { agentId, ownerId: actor.data.ownerId!, active: true } });
                    await update(humanAccountRepository(tx), pending, { status: "claimed", claimedByOwnerId: actor.data.ownerId!, claimedAt: now() });
                    await update(registrationRepository(tx), registration, { ownerId: actor.data.ownerId!, initialOwnerId: pending.id, managementStatus: "managed" });
                    await update(agentRepository(tx), agent, { managementInitializedAt: now() });
                    // Preserve continuation identity as a read-only registration proof; it
                    // can no longer mint initial owner capabilities after this claim.
                    await update(credentialRepository(tx), continuation, { kind: "registration_receipt", verifierKind: "bootstrap", ownerId: actor.data.ownerId! });
                    await revokeCredentials(tx, { ownerId: pending.id }, ["bootstrap", "handoff", "setup"]);
                    return { ownerId: actor.data.ownerId!, agentId, managementStatus: "managed", generation: proof.data.handoffGeneration!, invalidated: ["bootstrap", "handoff", "setup"] };
                });
            }
            if (action === "publicProfile") {
                const input = object(raw, ["agentId"]);
                const agentId = text(input.agentId, "agentId", 8, 100);
                const agent = await agentRepository(tx).get(agentId);
                const profile = await profileRepository(tx).get(agentId);
                const member = await membershipRepository(tx).get(agentId);
                if (!agent || !profile || !member || profile.data.published === null || member.data.state !== "joined" || member.data.platformRestricted !== false) {
                    fail("target_not_accessible", 404, "Target is not accessible");
                }
                const published = dataObject(profile.data.published);
                const avatar = projectAvatar(published.avatar);
                if (typeof published.displayName !== "string" || published.displayName.trim().length === 0 || !avatar) {
                    fail("target_not_accessible", 404, "Target is not accessible");
                }
                // Build an allowlisted projection. Never return a profile aggregate to an anonymous caller.
                const publicFields: JsonObject = {
                    displayName: published.displayName!,
                    avatar,
                };
                if (typeof published.bio === "string")
                    publicFields.bio = published.bio;
                if (Array.isArray(published.interests))
                    publicFields.interests = published.interests.filter((value): value is string => typeof value === "string");
                return { agentId, profileUrl: profileUrl(agentId), profile: publicFields, appearance:await readAppearance(tx,agentId,avatar,options.legacyAvatarIdentity),publishedVersion:profile.data.publishedVersion!, membership: { state: "joined" }, asOf };
            }
            if (action === "register") {
                const input = object(raw, ["operationId", "attemptId", "runtimeToken", "continuationToken", "inviteToken"]);
                const attemptId = text(input.attemptId, "attemptId", 8, 100);
                const continuation = parseToken(input.continuationToken, true);
                parseToken(input.runtimeToken, true);
                const prior = await registrationRepository(tx).get(attemptId);
                if (prior) {
                    const proof = await authenticate(tx, input.continuationToken, ["bootstrap", "registration_receipt"]);
                    if (proof.data.attemptId !== attemptId || prior.data.continuationCredentialId !== continuation.id)
                        fail("authentication_failed", 401, "Authentication failed");
                    if (prior.data.requestHash !== payloadHash(input))
                        fail("idempotency_payload_mismatch", 409, "Registration attempt was already used with different content");
                    return await command(tx, `registration:${attemptId}`, action, input, () => registrationView(prior));
                }
                const invite = input.inviteToken === undefined ? undefined : await authenticate(tx, input.inviteToken, ["invite"]);
                if (await agentRepository(tx).countAll(limits.registrations) >= limits.registrations)
                    fail("quota_exceeded", 429, "Registration limit reached");
                if (invite && await managementBindingRepository(tx).countActiveByOwnerId(invite.data.ownerId!, limits.agentsPerOwner) >= limits.agentsPerOwner)
                    fail("quota_exceeded", 429, "Owner Agent limit reached");
                return await command(tx, `registration:${attemptId}`, action, input, async () => {
                    const agentId = randomUUID();
                    const ownerId = invite?.data.ownerId ?? randomUUID();
                    const stamp = now();
                    if (!invite)
                        await humanAccountRepository(tx).insert({ id: ownerId, version: 1, data: { status: "pending_setup", epoch: store.recoveryEpoch, authVersion: 1, handoffGeneration: 0, createdAt: stamp } });
                    await agentRepository(tx).insert({ id: agentId, version: 1, data: { runtimeVersion: 1, runtimeActive: true, createdAt: stamp, managementKind: invite ? "invited" : "initial", managementInitializedAt: invite ? stamp : null, worldAccess: { version: 1, intervalSeconds: null } } });
                    await newCredential(tx, input.runtimeToken, "runtime", { agentId, runtimeVersion: 1 });
                    await newCredential(tx, input.continuationToken, invite ? "registration_receipt" : "bootstrap", { agentId, ownerId, attemptId });
                    if (invite) {
                        await update(credentialRepository(tx), invite, { active: false, consumedByAttemptId: attemptId });
                        await managementBindingRepository(tx).insert({ id: randomUUID(), version: 1, data: { agentId, ownerId, active: true } });
                    }
                    const registration: StoredRow = { id: attemptId, version: 1, data: { agentId, ownerId, continuationCredentialId: continuation.id, managementStatus: invite ? "managed" : "pending_setup", requestHash: payloadHash(input) } };
                    await registrationRepository(tx).insert(registration);
                    const initialProfile = defaultPublicProfile(agentId);
                    await profileRepository(tx).insert({ id: agentId, version: 1, data: { agentId, policyVersion: 1, mode: "agent_autonomous", lockedFields: [], draft: initialProfile, published: initialProfile, publishedVersion: 1, confirmationSource: "platform_default" } });
                    await membershipRepository(tx).insert({ id: agentId, version: 1, data: { agentId, worldId: "default", state: "joined", ownerPaused: false, ownerPauseVersion: 1, platformRestricted: false, platformVersion: 1, sharingGeneration: 1 } });
                    await initializeWalletAccount(tx, agentId, stamp);
                    await initializePerceptionAgent(tx, agentId, stamp);
                    return registrationView(registration);
                });
            }
            if (action === "registrationResult") {
                const input = object(raw, ["attemptId"]);
                const attemptId = text(input.attemptId, "attemptId", 8, 100);
                const actor = await authenticate(tx, token, ["runtime", "bootstrap", "registration_receipt", "owner_session"]);
                const row = await required(registrationRepository(tx), attemptId);
                if (actor.data.kind === "owner_session")
                    await target(tx, actor, scalarString(row, "agentId"));
                else if (actor.data.agentId !== row.data.agentId || (actor.data.kind !== "runtime" && actor.data.attemptId !== attemptId))
                    fail("target_not_accessible", 404, "Target is not accessible");
                return registrationView(row);
            }
            if (action === "self") {
                object(raw, []);
                const actor = await authenticate(tx, token, ["runtime"]);
                const agentId = actor.data.agentId!;
                const registration = (await registrationRepository(tx).findByAgentId(agentId))[0]!;
                return { agentId, ownerId: scalarString(registration, "ownerId"), instanceId: store.instanceId, runtimeVersion: actor.data.runtimeVersion!, profile: await readProfileView(tx,await required(profileRepository(tx), agentId)), membership: membershipView(await required(membershipRepository(tx), agentId)), profileUrl: profileUrl(agentId), management: await managementView(tx, await required(agentRepository(tx), agentId)), worldAccess: worldAccessView(await required(agentRepository(tx), agentId), asOf), effectiveActions: await effectiveActions(tx, actor, agentId), asOf };
            }
            if (action === "issueHandoff") {
                const input = object(raw, ["operationId", "expectedGeneration", "handoffToken"]);
                const actor = await authenticate(tx, token, ["bootstrap"]);
                const owner = await required(humanAccountRepository(tx), actor.data.ownerId!);
                return await command(tx, `bootstrap:${actor.id}`, action, input, async () => {
                    if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration !== owner.data.handoffGeneration)
                        fail("generation_conflict", 409, "Read the current handoff generation", { generation: owner.data.handoffGeneration });
                    const generation = numberValue(owner, "handoffGeneration") + 1;
                    await revokeCredentials(tx, { ownerId: owner.id }, ["handoff", "setup"]);
                    const handoff = await newCredential(tx, input.handoffToken, "handoff", { agentId: actor.data.agentId, ownerId: owner.id, handoffGeneration: generation, expiresAt: now() + limits.handoff });
                    await update(humanAccountRepository(tx), owner, { handoffGeneration: generation, handoffGeneratedAt: now() });
                    return { agentId: actor.data.agentId!, ownerId: owner.id, handoffId: handoff.id, generation, expiresAt: handoff.data.expiresAt! };
                });
            }
            if (action === "declareDelivery") {
                const input = object(raw, ["operationId", "generation"]);
                const actor = await authenticate(tx, token, ["runtime", "bootstrap"]);
                const agent = await required(agentRepository(tx), actor.data.agentId!);
                const registration = (await registrationRepository(tx).findByAgentId(agent.id))[0]!;
                const owner = await required(humanAccountRepository(tx), scalarString(registration, "ownerId"));
                return await command(tx, `agent:${agent.id}`, action, input, async () => {
                    const continuation = await required(credentialRepository(tx), scalarString(registration, "continuationCredentialId"));
                    if (continuation.data.kind !== "bootstrap")
                        fail("insufficient_scope", 403, "This Agent has no initial handoff");
                    if (input.generation !== owner.data.handoffGeneration || !Number.isSafeInteger(input.generation) || (input.generation as number) < 1)
                        fail("generation_conflict", 409, "Handoff generation changed");
                    await update(agentRepository(tx), agent, { deliveryDeclaredAt: now(), deliveryDeclaredGeneration: input.generation as number });
                    return { agentId: agent.id, deliveryStatus: "client_declared_delivered" };
                });
            }
            if (action === "previewHandoff" || action === "exchangeSetup" || action === "readSetup") {
                const keys = action === "previewHandoff" ? ["handoffId"] : action === "exchangeSetup" ? ["operationId", "setupToken"] : [];
                const input = object(raw, keys);
                const actor = await authenticate(tx, token, action === "previewHandoff" || action === "exchangeSetup" ? ["handoff"] : ["setup"]);
                if (action === "previewHandoff") {
                    if (text(input.handoffId, "handoffId", 8, 100) !== actor.id)
                        fail("target_not_accessible", 404, "Target is not accessible");
                    return { agentId: actor.data.agentId!, ownerId: actor.data.ownerId!, generation: actor.data.handoffGeneration!, expiresAt: actor.data.expiresAt!, status: "confirmation_required" };
                }
                if (action === "readSetup")
                    return { agentId: actor.data.agentId!, ownerId: actor.data.ownerId!, generation: actor.data.handoffGeneration!, expiresAt: actor.data.expiresAt!, status: "restricted_setup" };
                if (action === "exchangeSetup")
                    return await command(tx, `handoff:${actor.id}`, action, input, async () => {
                        const setup = await newCredential(tx, input.setupToken, "setup", { agentId: actor.data.agentId, ownerId: actor.data.ownerId, handoffGeneration: actor.data.handoffGeneration!, expiresAt: now() + limits.setup });
                        await update(credentialRepository(tx), actor, { active: false });
                        return { agentId: actor.data.agentId!, ownerId: actor.data.ownerId!, setupId: setup.id, generation: actor.data.handoffGeneration!, expiresAt: setup.data.expiresAt! };
                    });
                fail("invalid_request", 400, "Unsupported setup action");
            }
            if (action === "login") {
                const input = object(raw, ["operationId", "identifier", "password", "sessionToken"]);
                const identifier = loginIdentifier(input.identifier);
                const owner = (identifier.field === 'emailKey' ? await humanAccountRepository(tx).findByEmailKey(identifier.key) : await humanAccountRepository(tx).findByUsernameKey(identifier.key))[0];
                const correctPassword = checkPassword(input.password, owner?.data.status === "active" ? scalarString(owner, "passwordSalt") : "unavailable-account", owner?.data.status === "active" ? scalarString(owner, "passwordHash") : "0".repeat(128));
                if (!owner || owner.data.status !== "active" || !correctPassword)
                    fail("authentication_failed", 401, "Authentication failed");
                const ownerId = owner.id;
                if (owner.data.epoch !== store.recoveryEpoch)
                    fail("restore_access_unsupported", 403, "Identity is retained; access cannot be restored from old credentials");
                const scope = `owner-login:${parseToken(input.sessionToken, true).id}`;
                return await command(tx, scope, action, input, async () => {
                    const session = await newCredential(tx, input.sessionToken, "owner_session", { ownerId, ownerAuthVersion: owner.data.authVersion!, expiresAt: now() + limits.session });
                    return { ownerId, sessionId: session.id, expiresAt: session.data.expiresAt! };
                });
            }
            if (action === "readRecovery") {
                object(raw, []);
                const actor = await authenticate(tx, token, ["owner_recovery"]);
                return { ownerId: actor.data.ownerId!, status: "recovery_available" };
            }
            if (["createRecoveryRequest", "readRecoveryRequest", "cancelRecoveryRequest"].includes(action)) {
                const input = object(raw, action === "createRecoveryRequest" ? ["operationId", "assistanceToken"] : action === "readRecoveryRequest" ? ["requestId"] : ["operationId", "requestId", "expectedVersion"]);
                const actor = await authenticate(tx, token, ["runtime"]);
                const agentId = actor.data.agentId!;
                if (action === "createRecoveryRequest")
                    return await command(tx, `agent:${agentId}`, action, input, async () => {
                        const owner = await recoveryCreatePermission(tx, agentId);
                        const sourceKey = payloadHash([store.instanceId, context.clientIp ?? "internal"]);
                        const since = now() - 3600000;
                        if (await recoveryRequestRepository(tx).countRecent(since, 30, { sourceKey }) >= 30 || await recoveryRequestRepository(tx).countRecent(since, 1000) >= 1000)
                            fail("recovery_rate_limited", 429, "Try again later");
                        const binding = (await managementBindingRepository(tx).findByActiveAndAgentIdAndOwnerId(true, agentId, owner.id))[0]!;
                        const requestContext = await newCredential(tx, input.assistanceToken, "recovery_assistance", { agentId, ownerId: owner.id });
                        const request: StoredRow = { id: requestContext.id, version: 1, data: {
                                agentId, ownerId: owner.id, epoch: store.recoveryEpoch, contextCredentialId: requestContext.id,
                                bindingId: binding.id, bindingVersion: binding.version, creatorRuntimeCredentialId: actor.id,
                                creatorRuntimeVersion: actor.data.runtimeVersion!, ownerAuthVersion: owner.data.authVersion!,
                                status: "pending", createdAt: now(), expiresAt: now() + limits.recoveryRequest, sourceKey,
                            } };
                        await recoveryRequestRepository(tx).insert(request);
                        return await recoveryView(tx, request);
                    });
                const request = await required(recoveryRequestRepository(tx), text(input.requestId, "requestId", 8, 100));
                if (request.data.agentId !== agentId)
                    fail("target_not_accessible", 404, "Target is not accessible");
                if (action === "readRecoveryRequest")
                    return await recoveryView(tx, request);
                return await command(tx, `agent:${agentId}`, action, input, async () => {
                    await pendingRecovery(tx, request);
                    expected(request, input);
                    return await recoveryView(tx, await update(recoveryRequestRepository(tx), request, { status: "cancelled", cancelledAt: now() }));
                });
            }
            if (action === "recoveryAssistance") {
                object(raw, []);
                const request = await recoveryContext(tx, token);
                if (await recoveryStatus(tx, request) === "expired" || numberValue(request, "expiresAt") <= now())
                    fail("recovery_request_expired", 410, "Recovery request expired");
                return await recoveryView(tx, request, true);
            }
            if (action === "verifyRecoveryRequest" || action === "rejectRecoveryRequest") {
                const input = object(raw, action === "verifyRecoveryRequest" ? ["assistanceToken"] : ["operationId", "assistanceToken", "expectedVersion"]);
                const actor = await authenticate(tx, token, action === "verifyRecoveryRequest" ? ["owner_recovery"] : ["owner_recovery", "owner_session"]);
                const work = async () => {
                    const request = await recoveryContext(tx, input.assistanceToken, actor.data.ownerId!);
                    await pendingRecovery(tx, request);
                    if (action === "verifyRecoveryRequest")
                        return await recoveryView(tx, request, true);
                    expected(request, input);
                    return await recoveryView(tx, await update(recoveryRequestRepository(tx), request, { status: "cancelled", cancelledAt: now() }), true);
                };
                return action === "verifyRecoveryRequest" ? await work() : await command(tx, `owner:${actor.data.ownerId!}`, action, input, work);
            }
            if (action === "recover") {
                const input = object(raw, ["operationId", "password", "recoveryToken", "sessionToken", "credentialsSaved", "assistanceToken"]);
                const actor = await authenticate(tx, token, ["owner_recovery"]);
                return await command(tx, `owner:${actor.data.ownerId!}`, action, input, async () => {
                    if (input.credentialsSaved !== true)
                        fail("invalid_request", 400, "Save the next independent credentials before recovery");
                    const assistance = input.assistanceToken === undefined ? undefined : await recoveryContext(tx, input.assistanceToken, actor.data.ownerId!);
                    if (assistance)
                        await pendingRecovery(tx, assistance);
                    const password = hashPassword(input.password);
                    const owner = await required(humanAccountRepository(tx), actor.data.ownerId!);
                    const ownerAuthVersion = numberValue(owner, "authVersion") + 1;
                    const recovery = await newCredential(tx, input.recoveryToken, "owner_recovery", { ownerId: owner.id, ownerAuthVersion });
                    const session = await newCredential(tx, input.sessionToken, "owner_session", { ownerId: owner.id, ownerAuthVersion, expiresAt: now() + limits.session });
                    for (const old of await credentialRepository(tx).findByOwnerId(owner.id)) {
                        if (old.id !== recovery.id && old.id !== session.id && ["owner_session", "owner_recovery", "invite"].includes(scalarString(old, "kind")) && old.data.active)
                            await update(credentialRepository(tx), old, { active: false });
                    }
                    await update(humanAccountRepository(tx), owner, { authVersion: ownerAuthVersion, passwordSalt: password.salt, passwordHash: password.hash });
                    if (assistance)
                        await update(recoveryRequestRepository(tx), assistance, { status: "completed", completedAt: now(), completionOperationId: text(input.operationId, "operationId", 8, 100) });
                    await email.notify(tx, owner, text(input.operationId, "operationId", 8, 100));
                    return { ownerId: owner.id, ...(assistance ? { requestId: assistance.id } : {}), sessionId: session.id, ownerAuthVersion, expiresAt: session.data.expiresAt!, invalidated: ["owner_session", "owner_recovery", "invite"] };
                });
            }
            if (action === "listAgents" || action === "managedAgent") {
                const input = object(raw, action === "managedAgent" ? ["agentId"] : []);
                const actor = await authenticate(tx, token, ["owner_session"]);
                if (action === "managedAgent")
                    return await ownerView(tx, actor, text(input.agentId, "agentId", 8, 100), asOf);
                return { ownerId: actor.data.ownerId!, agents: await mapAsync((await managementBindingRepository(tx).findByActiveAndOwnerId(true, actor.data.ownerId)), async (binding) => await ownerView(tx, actor, scalarString(binding, "agentId"), asOf)), asOf };
            }
            if (action === "issueInvite" || action === "revokeInvite" || action === "listInvites") {
                const input = object(raw, action === "issueInvite" ? ["operationId", "inviteToken"] : action === "revokeInvite" ? ["operationId", "inviteId", "expectedVersion"] : []);
                const actor = await authenticate(tx, token, ["owner_session"]);
                const ownerId = actor.data.ownerId!;
                const inviteView = (row: StoredRow): JsonObject => ({ inviteId: row.id, version: row.version, active: row.data.active!, expiresAt: row.data.expiresAt!, consumed: Boolean(row.data.consumedByAttemptId) });
                if (action === "listInvites")
                    return { invites: (await credentialRepository(tx).findByKindAndOwnerId("invite", ownerId)).map(inviteView) };
                return await command(tx, `owner:${ownerId}`, action, input, async () => {
                    if (action === "issueInvite") {
                        if (await credentialRepository(tx).countActiveInvites(ownerId, now(), limits.invitesPerOwner) >= limits.invitesPerOwner)
                            fail("quota_exceeded", 429, "Active invite limit reached");
                        const invite = await newCredential(tx, input.inviteToken, "invite", { ownerId, ownerAuthVersion: actor.data.ownerAuthVersion!, expiresAt: now() + limits.invite });
                        return { ownerId, ...inviteView(invite), limit: 1 };
                    }
                    const invite = await credentialRepository(tx).get(text(input.inviteId, "inviteId", 8, 100));
                    if (!invite || invite.data.kind !== "invite" || invite.data.ownerId !== ownerId)
                        fail("target_not_accessible", 404, "Target is not accessible");
                    expected(invite, input);
                    return { ownerId, ...inviteView(await update(credentialRepository(tx), invite, { active: false })) };
                });
            }
            if (action === "revokeRuntime" || action === "replaceRuntime") {
                const input = object(raw, ["operationId", "agentId", "expectedVersion", ...(action === "replaceRuntime" ? ["runtimeToken"] : [])]);
                const actor = await authenticate(tx, token, ["owner_session"]);
                const agentId = text(input.agentId, "agentId", 8, 100);
                const agent = await target(tx, actor, agentId);
                return await command(tx, `owner:${actor.data.ownerId!}`, action, input, async () => {
                    if (version(input.expectedVersion) !== agent.data.runtimeVersion)
                        fail("version_conflict", 409, "Runtime generation changed", { version: agent.data.runtimeVersion });
                    const runtimeVersion = numberValue(agent, "runtimeVersion") + 1;
                    await revokeCredentials(tx, { agentId }, ["runtime", "bootstrap", "registration_receipt", "handoff", "setup"]);
                    if (action === "replaceRuntime")
                        await newCredential(tx, input.runtimeToken, "runtime", { agentId, runtimeVersion });
                    await update(agentRepository(tx), agent, { runtimeVersion, runtimeActive: action === "replaceRuntime" });
                    return { agentId, runtimeVersion, runtimeActive: action === "replaceRuntime" };
                });
            }
            if (action === "readWorldActionPolicy" || action === "saveWorldActionPolicy") {
                const input=object(raw,action==='readWorldActionPolicy'?['agentId']:['operationId','agentId','expectedVersion','mode']);
                const actor=await authenticate(tx,token,action==='readWorldActionPolicy'?['runtime','owner_session']:['owner_session']);
                const agentId=text(input.agentId,'agentId',8,100),agent=await target(tx,actor,agentId),current=worldActionPolicy(agent);
                if(action==='readWorldActionPolicy')return worldActionPolicyView(agent,asOf);
                return await command(tx,`owner:${actor.data.ownerId!}`,action,input,async()=>{
                    if(!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<0)fail('invalid_request',400,'Expected a nonnegative policy version');
                    if(input.expectedVersion!==current.version)fail('version_conflict',409,'World action policy changed',{version:current.version});
                    if(input.mode!=='autonomous'&&input.mode!=='observe')fail('invalid_request',400,'Choose autonomous or observe');
                    if(input.mode===current.mode)return {...worldActionPolicyView(agent,asOf),changed:false};
                    const nextVersion=current.version+1;if(!Number.isSafeInteger(nextVersion))fail('state_conflict',409,'Policy version cannot advance');
                    const next=await update(agentRepository(tx),agent,{worldActionPolicy:{version:nextVersion,mode:input.mode,updatedAt:asOf,updatedByOwnerId:actor.data.ownerId!}});
                    return {...worldActionPolicyView(next,asOf),changed:true};
                });
            }
            if (action === "readWorldAccess" || action === "saveWorldAccess" || action === "adoptWorldAccess") {
                const input = object(raw, action === "readWorldAccess" ? ["agentId"] : ["operationId", "agentId", "expectedVersion", ...(action === "adoptWorldAccess" ? ["jobState"] : ["intervalSeconds"])]);
                const actor = await authenticate(tx, token, action === "adoptWorldAccess" ? ["runtime"] : ["runtime", "owner_session"]);
                const agentId = text(input.agentId, "agentId", 8, 100);
                const agent = await target(tx, actor, agentId);
                const current = worldAccessView(agent, asOf);
                if (action === "readWorldAccess")
                    return current;
                return await command(tx, actor.data.kind==='runtime'?`agent:${agentId}`:`owner:${actor.data.ownerId!}`, action, input, async () => {
                    if (version(input.expectedVersion) !== current.version)
                        fail("version_conflict", 409, "World access preference changed", { version: current.version! });
                    if(action==='adoptWorldAccess'){
                        const jobState=input.jobState;
                        if(!['scheduled','stopped','unknown'].includes(String(jobState))||jobState==='scheduled'&&current.intervalSeconds===null||jobState==='stopped'&&current.intervalSeconds!==null)fail('invalid_request',400,'Job state must agree with the current configured interval');
                        const adoption={appliedVersion:current.version!,jobState:jobState as string,reportedAt:asOf};
                        const next=await update(agentRepository(tx),agent,{worldAccess:{...dataObject(agent.data.worldAccess),adoption}});
                        return {...worldAccessView(next,asOf),changed:true};
                    }
                    const intervalSeconds = input.intervalSeconds;
                    if (intervalSeconds !== null && (!Number.isSafeInteger(intervalSeconds) || (intervalSeconds as number) < 1))
                        fail("invalid_request", 400, "Expected a positive safe integer number of seconds or null", { field: "intervalSeconds" });
                    if (intervalSeconds === current.intervalSeconds)
                        return { ...current, changed: false };
                    const nextVersion = (current.version as number) + 1;
                    if (!Number.isSafeInteger(nextVersion))
                        fail("state_conflict", 409, "Preference version cannot advance");
                    const next = await update(agentRepository(tx), agent, { worldAccess: { ...dataObject(agent.data.worldAccess), version: nextVersion, intervalSeconds: intervalSeconds as number | null } });
                    return { ...worldAccessView(next, asOf), changed: true };
                });
            }
            if (["readProfile", "saveProfile", "saveDraft", "publishProfile", "unpublishProfile", "profilePolicy"].includes(action)) {
                const keys = action === "readProfile" ? ["agentId"] : (action === "saveDraft" || action === "saveProfile") ? ["operationId", "agentId", "expectedVersion", "expectedPolicyVersion", "fields", "removeFields"] : action === "profilePolicy" ? ["operationId", "agentId", "expectedVersion", "expectedPolicyVersion", "mode", "lockedFields"] : ["operationId", "agentId", "expectedVersion", "expectedPolicyVersion"];
                const input = object(raw, keys);
                const actor = await authenticate(tx, token, action === "profilePolicy" ? ["owner_session"] : ["runtime", "owner_session"]);
                const agentId = text(input.agentId, "agentId", 8, 100);
                await target(tx, actor, agentId);
                const profile = await required(profileRepository(tx), agentId);
                if (action === "readProfile")
                    return await readProfileView(tx,profile);
                return await command(tx, `${actor.data.kind === "runtime" ? "agent" : "owner"}:${actor.data.kind === "runtime" ? agentId : actor.data.ownerId!}`, action, input, async () => {
                    expected(profile, input);
                    if (version(input.expectedPolicyVersion, "expectedPolicyVersion") !== profile.data.policyVersion)
                        fail("version_conflict", 409, "Profile policy changed", { policyVersion: profile.data.policyVersion });
                    if (action === "profilePolicy") {
                        if (!["agent_autonomous", "owner_specified", "proposal_required"].includes(input.mode as string) || !Array.isArray(input.lockedFields) || input.lockedFields.length > PROFILE_FIELDS.length || input.lockedFields.some((field) => !PROFILE_FIELDS.includes(field as typeof PROFILE_FIELDS[number])) || new Set(input.lockedFields).size !== input.lockedFields.length)
                            fail("invalid_request", 400, "Invalid profile policy");
                        return profileView(await update(profileRepository(tx), profile, { mode: input.mode as string, lockedFields: input.lockedFields as string[], policyVersion: numberValue(profile, "policyVersion") + 1 }));
                    }
                    if (action === "saveProfile")
                        await directSavePermission(tx, actor, agentId, profile);
                    else
                        await businessWrite(tx, actor, agentId);
                    if (action === "saveDraft" || action === "saveProfile") {
                        const fields = validateFields(input.fields) as JsonObject;
                        const removeFields = validateRemoveFields(input.removeFields);
                        if (removeFields.some((field) => Object.hasOwn(fields, field)))
                            fail("invalid_request", 400, "A field cannot be set and removed together", { field: "removeFields" });
                        const locked = profile.data.lockedFields as string[];
                        if (actor.data.kind === "runtime" && [...Object.keys(fields), ...removeFields].some((field) => locked.includes(field)))
                            fail("field_locked", 403, "Owner locked a requested field");
                        if (action === "saveProfile") {
                            if(profile.data.published===null&&!Object.hasOwn(fields,'avatar'))fail('profile_validation_failed',422,'Choose an appearance before restoring this unpublished profile',{field:'avatar'});
                            const current = profile.data.published === null ? defaultPublicProfile(agentId) : dataObject(profile.data.published);
                            const combined = { ...current, ...fields } as JsonObject;
                            for (const field of removeFields)
                                delete combined[field];
                            validatePublication(combined);
                            // A name-only edit preserves a retained selection, including an older
                            // catalogue version. Only an explicitly submitted avatar is reselected.
                            const {avatar:retainedAvatar,...otherFields}=combined;
                            const published = {...validateFields(otherFields),avatar:retainedAvatar!} as JsonObject;
                            if (profile.data.published !== null && payloadHash(published) === payloadHash(current))
                                return { ...profileView(profile), changed: false, saveEffect: "public" };
                            // Preserve separately saved proposals. A direct partial save must
                            // neither adopt nor discard fields that were not explicitly confirmed.
                            const draftMatchesActive = payloadHash(dataObject(profile.data.draft)) === payloadHash(dataObject(profile.data.published));
                            const next = await update(profileRepository(tx), profile, { published, publishedVersion: numberValue(profile, "publishedVersion") + 1,
                                confirmationSource: actor.data.kind === "runtime" ? "runtime_declaration" : "owner_authenticated",
                                ...(draftMatchesActive ? { draft: published } : {}) });
                            return { ...profileView(next), changed: true, saveEffect: "public" };
                        }
                        const draft = { ...dataObject(profile.data.draft), ...fields };
                        for (const field of removeFields)
                            delete draft[field];
                        return profileView(await update(profileRepository(tx), profile, { draft }));
                    }
                    publicationPermission(profile, actor, action === "unpublishProfile");
                    if (action === "unpublishProfile") {
                        if (profile.data.published === null)
                            return { ...profileView(profile), changed: false };
                        return { ...profileView(await update(profileRepository(tx), profile, { published: null })), changed: true };
                    }
                    const draft = dataObject(profile.data.draft);
                    return profileView(await update(profileRepository(tx), profile, { published: draft, publishedVersion: numberValue(profile, "publishedVersion") + 1, confirmationSource: actor.data.kind === "runtime" ? "runtime_declaration" : "owner_authenticated" }));
                });
            }
            if (["readMembership", "join", "leave", "participation"].includes(action)) {
                const input = object(raw, action === "readMembership" ? ["agentId"] : ["operationId", "agentId", "expectedVersion", ...(action === "join" ? ["expectedProfileVersion"] : action === "participation" ? ["paused"] : [])]);
                const actor = await authenticate(tx, token, action === "participation" ? ["owner_session"] : ["runtime", "owner_session"]);
                const agentId = text(input.agentId, "agentId", 8, 100);
                await target(tx, actor, agentId);
                const member = await required(membershipRepository(tx), agentId);
                if (action === "readMembership")
                    return membershipView(member);
                return await command(tx, `${actor.data.kind === "runtime" ? "agent" : "owner"}:${actor.data.kind === "runtime" ? agentId : actor.data.ownerId!}`, action, input, async () => {
                    expected(member, input);
                    if (action === "participation")
                        return membershipView(await update(membershipRepository(tx), member, { ownerPaused: boolean(input.paused, "paused"), ownerPauseVersion: numberValue(member, "ownerPauseVersion") + 1 }));
                    if (actor.data.kind === 'runtime' && (action === 'join' || action === 'leave'))assertWorldActionAllowed(worldActionPolicy(await required(agentRepository(tx),agentId)),`world.membership.${action}`);
                    if (action === "leave")
                        return membershipView(member.data.state === "left" ? member : await update(membershipRepository(tx), member, { state: "left", sharingGeneration: Number(member.data.sharingGeneration ?? 1) + 1 }));
                    await businessWrite(tx, actor, agentId);
                    const profile = await required(profileRepository(tx), agentId);
                    if (version(input.expectedProfileVersion, "expectedProfileVersion") !== profile.version)
                        fail("version_conflict", 409, "Profile changed", { version: profile.version });
                    joinPermission(profile);
                    return membershipView(member.data.state === "joined" ? member : await update(membershipRepository(tx), member, { state: "joined" }));
                });
            }
            if (action === "receipt") {
                const input = object(raw, ["operationId", "scope", "action"]);
                const operationId = text(input.operationId, "operationId", 8, 100);
                const scope = text(input.scope, "scope", 1, 220);
                const commandAction = text(input.action, "action", 1, 100);
                const actor = await authenticate(tx, token, ["runtime", "bootstrap", "registration_receipt", "owner_session", "owner_recovery", "email_registration", "email_recovery"]);
                // This is the same unique command key used by writes. Never choose among
                // otherwise visible receipts when independent clients reuse an operation ID.
                const row = (await operationRepository(tx).findByActionAndEpochAndOperationIdAndScope(commandAction, store.recoveryEpoch, operationId, scope))[0];
                if (row) {
                    if (typeof row.data.scope === "string" && row.data.scope.startsWith("perception-agent:"))
                        return await perception.readReceipt(tx, token, row);
                    const result = dataObject(row.data.result);
                    if (actor.data.kind === "email_registration" || actor.data.kind === "email_recovery") {
                        if (await email.canRead(tx, actor, scope, commandAction, operationId))
                            return result;
                    }
                    else if (actor.data.kind === "owner_recovery") {
                        if (scope === `owner:${actor.data.ownerId!}` && commandAction === "rejectRecoveryRequest" && result.ownerId === actor.data.ownerId)
                            return result;
                    }
                    else if (actor.data.kind === "owner_session") {
                        if (result.ownerId === actor.data.ownerId)
                            return result;
                        if (typeof result.agentId === "string" && await managementBindingRepository(tx).existsActiveByAgentIdAndOwnerId(result.agentId, actor.data.ownerId!))
                            return result;
                    }
                    else if (result.agentId === actor.data.agentId) {
                        const registration = (await registrationRepository(tx).findByAgentId(actor.data.agentId))[0];
                        const registrationScope = `registration:${registration?.id ?? ""}`;
                        if ((actor.data.kind === "runtime" && (row.data.scope === `agent:${actor.data.agentId}` || row.data.scope === registrationScope)) || row.data.scope === `registration:${actor.data.attemptId}` || row.data.scope === `bootstrap:${actor.id}`)
                            return result;
                    }
                }
                fail("target_not_accessible", 404, "Operation is not accessible");
            }
            fail("invalid_request", 400, "Unsupported M1 action");
        });
    }
    async function invokeHttp(action: M1Action, input?: unknown, token?: string, context?: {
        clientIp?: string;
    }): Promise<JsonObject> {
        const result = await invoke(action, input, token, context);
        // Delivery failure cannot turn an already committed password change into an unknown reset.
        if (["sendRegistrationCode", "sendRecoveryCode", "recoverByEmail", "recover", "receipt"].includes(action)) {
            try {
                await email.dispatch(result, action);
            }
            catch { /* Durable intent remains queryable/retryable. */ }
        }
        return result;
    }
    return { invoke, invokeHttp, receiveTrustedMessage };
}
