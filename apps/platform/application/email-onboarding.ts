import {ensurePublicId,readPublicId} from '../domains/public-identifiers/repository.ts';
import { requireRow as required, patchRow as update } from '../domains/common/repository.ts';
import { mailJobRepository } from '../domains/email/repository.ts';
import { recoveryRequestRepository, humanAccountRepository, credentialRepository, managementBindingRepository, emailAttemptRepository, agentRepository, registrationRepository } from '../domains/access/repository.ts';
import { operationRepository } from '../domains/platform/repository.ts';
import { randomUUID } from 'node:crypto';
import type { JsonObject, M1ReadSession, M1Store, M1Transaction, StoredRow } from '../contracts/store.ts';
import { accountFields } from '../domains/access/account-identifiers.ts';
import { equalDigest, hashPassword, parseToken, payloadHash } from '../domains/access/credentials.ts';
import { emailCode, emailDigest, openMail, sealMail } from '../domains/access/email-secrets.ts';
import { fail, M1Error, object, text } from '../domains/common/errors.ts';
import {optionalUiLocale,type OwnerUiLocale} from '../domains/access/owner-ui-preferences.ts';
import {localizedChallenge,localizedRecoveryNotice} from '../domains/email/messages.ts';
import { loadEmailConfig, sendResend, type EmailConfig, type EmailMode, type ResendEmailConfig, type MailPayload, type Delivery } from '../infrastructure/email/resend.ts';
export const EMAIL_ACTIONS = ['startRegistration', 'readRegistrationAttempt', 'sendRegistrationCode', 'verifyRegistrationEmail', 'cancelRegistration', 'registerOwner', 'completeSetup', 'startEmailRecovery', 'readEmailRecoveryAttempt', 'sendRecoveryCode', 'verifyRecoveryEmail', 'recoverByEmail', 'enableRecoveryBackup'] as const;
interface EmailCredential extends JsonObject {
    kind: string;
    ownerId: string | null;
    agentId: string | null;
}
interface Hooks {
    authenticate(tx: M1ReadSession, raw: unknown, kinds: readonly string[]): Promise<StoredRow<EmailCredential>>;
    newCredential(tx: M1Transaction, raw: unknown, kind: string, metadata: JsonObject): Promise<StoredRow<EmailCredential>>;
    command(tx: M1Transaction, scope: string, action: string, input: Record<string, unknown>, work: () => JsonObject | Promise<JsonObject>): Promise<JsonObject>;
    pendingRecovery(tx: M1ReadSession, row: StoredRow): Promise<void>;
    recoveryContext(tx: M1ReadSession, raw: unknown, ownerId?: string): Promise<StoredRow>;
}
interface Settings {
    now: () => number;
    sessionTtl: number;
    ownerLimit: number;
    config?: EmailConfig;
}
const number = (row: StoredRow, key: string) => row.data[key] as number;
const string = (row: StoredRow, key: string) => row.data[key] as string;
const scope = (row: StoredRow) => `${row.data.purpose === 'registration' ? 'owner-registration' : 'owner-email-recovery'}:${row.id}`;
const finalAction = (row: StoredRow) => row.data.purpose === 'recovery' ? 'recoverByEmail' : row.data.agentId ? 'completeSetup' : 'registerOwner';
/** Durable business work uses short awaited database transactions. The explicit dispatcher is the only network boundary. */
export function createEmailOnboarding(store: M1Store, hooks: Hooks, settings: Settings) {
    const now = settings.now;
    const config = settings.config && loadEmailConfig({ M1_EMAIL_MODE: settings.config.mode,
        ...(settings.config.resend ? { RESEND_API_KEY: settings.config.resend.apiKey, M1_EMAIL_FROM: settings.config.resend.from, M1_PUBLIC_ORIGIN: settings.config.resend.publicOrigin, M1_EMAIL_CODE_SECRET: settings.config.resend.codeSecret } : {}) });
    const currentMode = config?.mode ?? 'unavailable';
    const attemptMode = (row: StoredRow): EmailMode => row.data.verificationMode === 'experience' ? 'experience' : 'resend';
    function matchingMode(mode: EmailMode): void {
        if (currentMode !== mode)
            fail('email_mode_mismatch', 409, 'Continue reading the original result or start again in the current verification mode', { currentMode, verificationMode: mode });
    }
    function configured(mode: EmailMode, sending = false): ResendEmailConfig | undefined {
        if (!config)
            fail('email_unavailable', 503, 'Verification channel is temporarily unavailable');
        if (mode === 'experience')
            return undefined;
        if (!config.resend || (sending && config.mode !== 'resend'))
            fail('email_unavailable', 503, 'Email service is temporarily unavailable');
        return config.resend;
    }
    function digest(mode: EmailMode, ...parts: string[]): string {
        // A public experience code proves no mailbox control. Its independent domain
        // retains context across restarts/mode switches without requiring a mail key.
        if (mode === 'experience')
            return emailDigest(payloadHash([store.instanceId, store.recoveryEpoch, 'experience-code-v1']), store.instanceId, 'experience', ...parts);
        // Without the old real key a POST body cannot be compared to its stored
        // keyed hash. Its authenticated GET receipt remains available independently.
        if (!config?.resend)
            matchingMode(mode);
        return emailDigest(configured(mode)!.codeSecret, store.instanceId, ...parts);
    }
    const available = (mode: EmailMode) => Boolean(config && (mode === 'experience' || config.resend));
    async function status(tx: M1ReadSession, row: StoredRow): Promise<string> {
        if (['completed', 'cancelled'].includes(string(row, 'status')))
            return string(row, 'status');
        if (row.data.epoch !== store.recoveryEpoch || number(row, 'expiresAt') <= now() || (row.data.purpose === 'recovery' && row.data.status === 'email_proved' && number(row, 'grantExpiresAt') <= now()))
            return 'expired';
        if (row.data.purpose === 'recovery') {
            const request = await recoveryRequestRepository(tx).get(string(row, 'requestId'));
            const owner = await humanAccountRepository(tx).get(string(row, 'ownerId'));
            try {
                if (!request)
                    return 'expired';
                await hooks.pendingRecovery(tx, request);
            }
            catch (error) {
                if (error instanceof M1Error)
                    return 'expired';
                throw error;
            }
            if (!owner || owner.data.authVersion !== row.data.ownerAuthVersion || owner.data.emailKey !== row.data.emailKey || (owner.data.emailVersion ?? 1) !== row.data.emailVersion)
                return 'expired';
        }
        if (row.data.agentId && row.data.purpose === 'registration') {
            const owner = await humanAccountRepository(tx).get(string(row, 'ownerId')), target = await credentialRepository(tx).get(string(row, 'targetCredentialId'));
            if (!owner || owner.data.status !== 'pending_setup' || owner.data.handoffGeneration !== row.data.generation || !target?.data.active || (target.data.expiresAt as number) <= now() || await managementBindingRepository(tx).existsActiveByAgentId(string(row, 'agentId')))
                return 'expired';
        }
        return string(row, 'status');
    }
    function challengeExpired(row: StoredRow): boolean {
        return typeof row.data.codeExpiresAt === 'number' && row.data.codeExpiresAt <= now();
    }
    async function view(tx: M1ReadSession, row: StoredRow): Promise<JsonObject> {
        if (row.data.purpose === 'registration') {
            const current = await status(tx, row);
            return { attemptId: row.id, purpose: 'registration', verificationMode: 'none', emailVerificationRequired: false,
                status: ['pending_email', 'email_proved'].includes(current) ? 'pending_registration' : current,
                expiresAt: row.data.expiresAt!,
                ...(row.data.agentId ? { agentId: row.data.agentId, generation: row.data.generation!, ownerId: row.data.ownerId! } : {}) };
        }
        const delivery = typeof row.data.deliveryId === 'string' ? await mailJobRepository(tx).get(row.data.deliveryId) : undefined;
        return { attemptId: row.id, purpose: row.data.purpose!, verificationMode: attemptMode(row), currentMode, modeMismatch: currentMode !== attemptMode(row), sendOperationIdRequired: row.data.verificationMode !== undefined, codeLength: attemptMode(row) === 'experience' ? 4 : 8, status: await status(tx, row), expiresAt: row.data.expiresAt!,
            codeExpiresAt: row.data.codeExpiresAt ?? null, challengeExpired: challengeExpired(row),
            resendAfter: row.data.resendAfter ?? 0, deliveryStatus: delivery?.data.state ?? (available(attemptMode(row)) ? 'none' : 'unavailable'),
            ...(row.data.deliveryId ? { deliveryId: row.data.deliveryId, sendOperationId: delivery?.data.operationId ?? null } : {}),
            ...(row.data.agentId ? { agentId: row.data.agentId!, ...(row.data.purpose === 'registration' ? { generation: row.data.generation!, ownerId: row.data.ownerId! } : { requestId: row.data.requestId!, ownerId: row.data.ownerId! }) } : {}),
            ...(row.data.grantExpiresAt ? { grantExpiresAt: row.data.grantExpiresAt } : {}) };
    }
    async function pending(tx: M1ReadSession, row: StoredRow, proved = false) {
        const current = await status(tx, row);
        if (current === 'expired')
            fail('email_attempt_expired', 410, 'Email attempt expired');
        if (!['pending_registration', 'pending_email', 'email_proved'].includes(current))
            fail('email_attempt_closed', 409, 'Email attempt is closed');
        if (proved && (current !== 'email_proved' || number(row, 'grantExpiresAt') <= now()))
            fail('email_verification_required', 403, 'Verify this email attempt before completing it');
    }
    async function browser(tx: M1ReadSession, proof: unknown, attemptId: unknown, purpose: string): Promise<StoredRow> {
        const actor = await hooks.authenticate(tx, proof, [purpose === 'registration' ? 'email_registration' : 'email_recovery']);
        const row = await required(emailAttemptRepository(tx), text(attemptId, 'attemptId', 8, 100));
        if (row.data.purpose !== purpose || row.data.browserCredentialId !== actor.id || actor.data.attemptId !== row.id)
            fail('target_not_accessible', 404, 'Target is not accessible');
        return row;
    }
    function sourceKey(clientIp: string) { return payloadHash([store.instanceId, 'source', clientIp]); }
    function sourceKeys(clientIp: string): string[] {
        return [sourceKey(clientIp), ...(config?.resend ? [emailDigest(config.resend.codeSecret, store.instanceId, 'source', clientIp)] : [])];
    }
    async function startLimit(tx: M1ReadSession, keys: string[]) {
        const since = now() - 3600000;
        if (await emailAttemptRepository(tx).countRecent(since, 30, keys) >= 30 || await emailAttemptRepository(tx).countRecent(since, 1000) >= 1000)
            fail('email_rate_limited', 429, 'Try again later');
    }
    async function sendLimit(tx: M1ReadSession, row: StoredRow, keys: string[]) {
        const ownerKey = row.data.purpose === 'recovery' ? string(row, 'ownerId') : string(row, 'emailKey');
        const repository = mailJobRepository(tx), at = now(), related = { ownerKey, emailKey: string(row, 'emailKey') };
        if (await repository.countRecentCodes(at - 60000, 1, { related }) >= 1
            || await repository.countRecentCodes(at - 30 * 60000, 3, { related }) >= 3
            || await repository.countRecentCodes(at - 24 * 3600000, 10, { related }) >= 10
            || await repository.countRecentCodes(at - 30 * 60000, 20, { sourceKeys: keys }) >= 20
            || await repository.countRecentCodes(at - 30 * 60000, 1000) >= 1000)
            fail('email_rate_limited', 429, 'Try again later');
        return ownerKey;
    }
    async function notify(tx: M1Transaction, owner: StoredRow, operationId: string, mode: EmailMode = currentMode === 'experience' ? 'experience' : 'resend',uiLocale?:OwnerUiLocale) {
        const id = randomUUID(), sender = mode === 'resend' ? config?.resend : undefined;
        const locale=uiLocale??optionalUiLocale(owner.data.uiLocale);
        const payload: MailPayload | null = sender ? { from: sender.from, to: [string(owner, 'email')], ...(locale?localizedRecoveryNotice(locale,{completedAt:new Date(now()).toISOString(),publicOrigin:sender.publicOrigin}):{subject: 'connet.ai · Password recovery completed', text: `Your connet.ai password was reset at ${new Date(now()).toISOString()}. If you did not request this, return to the trusted site ${sender.publicOrigin}. This message contains no password or login credential.`}) } : null;
        await mailJobRepository(tx).insert({ id, version: 1, data: { purpose: 'notification', verificationMode: mode, ownerKey: owner.id, operationId, createdAt: now(), state: mode === 'experience' ? 'not_sent' : sender ? 'queued' : 'unavailable', retryable: Boolean(sender), dispatchLeaseUntil: 0, idempotencyKey: `m1-notice:${store.instanceId}:${id}`, encryptedPayload: payload ? sealMail(sender!.codeSecret, payload) : null, epoch: store.recoveryEpoch } });
    }
    async function invoke(action: string, raw: unknown, proof: unknown, clientIp = 'internal'): Promise<JsonObject> {
        let rejectedCode = false;
        const result = await store.transaction(async (tx) => {
            if (action === 'startRegistration') {
                const input = object(raw, ['operationId', 'attemptId', 'browserToken', 'username', 'email', 'agentId', 'expectedGeneration', 'handoffToken', 'setupToken']);
                const attemptId = text(input.attemptId, 'attemptId', 36, 36);
                if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(attemptId))
                    fail('invalid_request', 400, 'Expected a UUID attempt ID');
                const prior = await emailAttemptRepository(tx).get(attemptId);
                if (prior) {
                    await browser(tx, input.browserToken, attemptId, 'registration');
                    if (prior.data.status === 'completed')
                        fail('email_attempt_closed', 409, 'Read the original completion result');
                }
                return await hooks.command(tx, `owner-registration:${attemptId}`, action, input, async () => {
                    if (prior || await humanAccountRepository(tx).get(attemptId))
                        fail('account_id_conflict', 409, 'Use a new unused account attempt');
                    const fields = accountFields(input.username, input.email), key = sourceKey(clientIp);
                    await startLimit(tx, sourceKeys(clientIp));
                    const hasTarget = input.agentId !== undefined || input.handoffToken !== undefined || input.setupToken !== undefined || input.expectedGeneration !== undefined;
                    let target: JsonObject = {};
                    let expiresAt = now() + 30 * 60000;
                    if (hasTarget) {
                        if ((input.handoffToken === undefined) === (input.setupToken === undefined))
                            fail('invalid_request', 400, 'Supply exactly one private handoff or setup proof');
                        const actor = await hooks.authenticate(tx, input.handoffToken ?? input.setupToken, input.handoffToken === undefined ? ['setup'] : ['handoff']);
                        const agentId = text(input.agentId, 'agentId', 8, 100);
                        if (actor.data.agentId !== agentId || input.expectedGeneration !== actor.data.handoffGeneration)
                            fail('target_not_accessible', 404, 'Target is not accessible');
                        expiresAt = Math.min(expiresAt, number(actor, 'expiresAt'));
                        target = { agentId, ownerId: actor.data.ownerId!, generation: actor.data.handoffGeneration!, targetCredentialId: actor.id, targetKind: actor.data.kind! };
                    }
                    const credential = await hooks.newCredential(tx, input.browserToken, 'email_registration', { attemptId });
                    const row: StoredRow = { id: attemptId, version: 1, data: { ...fields, ...target, purpose: 'registration', verificationMode: 'none', browserCredentialId: credential.id, status: 'pending_registration', createdAt: now(), expiresAt, wrongCodes: 0, epoch: store.recoveryEpoch, sourceKey: key } };
                    await emailAttemptRepository(tx).insert(row);
                    return await view(tx, row);
                });
            }
            if (action === 'startEmailRecovery') {
                const input = object(raw, ['operationId', 'browserToken']), id = parseToken(input.browserToken, true).id;
                const request = await hooks.recoveryContext(tx, proof), prior = await emailAttemptRepository(tx).get(id);
                if (prior) {
                    await browser(tx, input.browserToken, id, 'recovery');
                    if (prior.data.status === 'completed')
                        fail('email_attempt_closed', 409, 'Read the original completion result');
                    if (prior.data.requestId !== request.id)
                        fail('target_not_accessible', 404, 'Target is not accessible');
                }
                return await hooks.command(tx, `owner-email-recovery:${id}`, action, input, async () => {
                    configured(currentMode === 'experience' ? 'experience' : 'resend');
                    await hooks.pendingRecovery(tx, request);
                    if (await emailAttemptRepository(tx).existsByRequestId(request.id))
                        fail('email_attempt_exists', 409, 'Continue the original browser attempt or cancel the recovery request');
                    const key = sourceKey(clientIp);
                    await startLimit(tx, sourceKeys(clientIp));
                    const owner = await required(humanAccountRepository(tx), string(request, 'ownerId'));
                    const credential = await hooks.newCredential(tx, input.browserToken, 'email_recovery', { attemptId: id });
                    const row: StoredRow = { id, version: 1, data: { purpose: 'recovery', verificationMode: currentMode === 'experience' ? 'experience' : 'resend', browserCredentialId: credential.id, status: 'pending_email', createdAt: now(), expiresAt: Math.min(now() + 30 * 60000, number(request, 'expiresAt')), wrongCodes: 0, epoch: store.recoveryEpoch, sourceKey: key,
                            ownerId: owner.id, agentId: request.data.agentId!, requestId: request.id, ownerAuthVersion: owner.data.authVersion!, email: owner.data.email!, emailKey: owner.data.emailKey!, emailVersion: owner.data.emailVersion ?? 1 } };
                    await emailAttemptRepository(tx).insert(row);
                    return await view(tx, row);
                });
            }
            if (action === 'enableRecoveryBackup') {
                const input = object(raw, ['operationId', 'recoveryToken', 'credentialsSaved']);
                const actor = await hooks.authenticate(tx, proof, ['owner_session']);
                return await hooks.command(tx, `owner:${actor.data.ownerId!}`, action, input, async () => {
                    if (input.credentialsSaved !== true)
                        fail('invalid_request', 400, 'Save the optional backup before enabling it');
                    const recovery = await hooks.newCredential(tx, input.recoveryToken, 'owner_recovery', { ownerId: actor.data.ownerId!, ownerAuthVersion: actor.data.ownerAuthVersion! });
                    for (const old of await credentialRepository(tx).findByActiveAndKindAndOwnerId(true, 'owner_recovery', actor.data.ownerId!))
                        if (old.id !== recovery.id)
                            await update(credentialRepository(tx), old, { active: false });
                    return { ownerId: actor.data.ownerId!, recoveryId: recovery.id };
                });
            }
            const registration = ['readRegistrationAttempt', 'sendRegistrationCode', 'verifyRegistrationEmail', 'cancelRegistration', 'registerOwner', 'completeSetup'].includes(action);
            const input = object(raw, action.startsWith('read') ? ['attemptId'] : action === 'registerOwner' || action === 'completeSetup' ? ['operationId', 'attemptId', 'password', 'sessionToken', 'recoveryToken', 'handoffToken', 'setupToken'] : action === 'recoverByEmail' ? ['operationId', 'attemptId', 'password', 'sessionToken', 'recoveryToken','uiLocale'] : action.startsWith('verify') ? ['operationId', 'attemptId', 'code', 'sendOperationId'] : action.startsWith('send')?['operationId','attemptId','uiLocale']:['operationId', 'attemptId']);
            const requestedLocale=optionalUiLocale(input.uiLocale);
            const row = await browser(tx, proof, input.attemptId, registration ? 'registration' : 'recovery');
            if (action.startsWith('read'))
                return await view(tx, row);
            if (row.data.status === 'completed' && (row.data.completionAction !== action || row.data.completionOperationId !== input.operationId))
                fail('email_attempt_closed', 409, 'Read the original completion result');
            const mode = attemptMode(row);
            if (action.startsWith('verify') && (row.data.verificationMode !== undefined || input.sendOperationId !== undefined))
                text(input.sendOperationId, 'sendOperationId', 8, 100);
            let commandInput = input;
            if (registration && action.startsWith('verify')) {
                const prior = await operationRepository(tx).findByActionAndEpochAndOperationIdAndScope(action, store.recoveryEpoch, text(input.operationId, 'operationId', 8, 100), scope(row));
                if (!prior.length) fail('registration_verification_not_required', 409, 'Registration does not require an email challenge');
            }
            if (action.startsWith('verify'))
                commandInput = { ...input, code: digest(mode, 'operation-code', row.id, text(input.code, 'code', 1, 64)) };
            const result = await hooks.command(tx, scope(row), action, commandInput, async () => {
                if (action === 'cancelRegistration') {
                    await pending(tx, row);
                    return await view(tx, await update(emailAttemptRepository(tx), row, { status: 'cancelled' }));
                }
                // command returns an existing exact receipt before reaching this gate.
                // A frozen challenge may never mint new authority under another mode.
                if (registration && (action.startsWith('send') || action.startsWith('verify')))
                    fail('registration_verification_not_required', 409, 'Registration does not require an email challenge');
                if (!registration) matchingMode(mode);
                const email = registration ? undefined : configured(mode, action.startsWith('send'));
                await pending(tx, row, action === 'recoverByEmail');
                if (action.startsWith('send')) {
                    if (row.data.status !== 'pending_email')
                        fail('email_attempt_closed', 409, 'Email attempt is closed');
                    const previous = typeof row.data.deliveryId === 'string' ? await mailJobRepository(tx).get(row.data.deliveryId) : undefined;
                    if (previous && ['queued', 'unknown'].includes(string(previous, 'state')) && !challengeExpired(row))
                        fail('email_delivery_pending', 409, 'Continue the original delivery operation', { operationId: previous.data.operationId });
                    const key = sourceKey(clientIp), ownerKey = await sendLimit(tx, row, sourceKeys(clientIp)), code = mode === 'experience' ? '1234' : emailCode(), generation = (row.data.challengeGeneration as number ?? 0) + 1;
                    const id = randomUUID(), expiresAt = Math.min(now() + 10 * 60000, number(row, 'expiresAt'));
                    const purpose = registration ? 'registration' : 'password recovery';
                    const owner=!registration&&typeof row.data.ownerId==='string'?await humanAccountRepository(tx).get(row.data.ownerId):undefined;
                    const locale=requestedLocale??optionalUiLocale(owner?.data.uiLocale);
                    const payload: MailPayload | null = email ? { from: email.from, to: [string(row, 'email')], ...(locale?localizedChallenge(locale,registration?'registration':'recovery',{code,requestedAt:new Date(now()).toISOString(),publicOrigin:email.publicOrigin,minutes:Math.ceil((expiresAt-now())/60000)}):{subject: `connet.ai · ${purpose} code`, text: `Your connet.ai ${purpose} code is ${code}. Requested at ${new Date(now()).toISOString()}. Enter it only on the trusted page ${email.publicOrigin} that you just opened. Do not give this code to an Agent or anyone else. It expires in 10 minutes. If you did not request this, ignore this message.`}) } : null;
                    await mailJobRepository(tx).insert({ id, version: 1, data: { purpose: 'code', verificationMode: mode, attemptId: row.id, operationId: text(input.operationId, 'operationId', 8, 100), ownerKey, recipientKey: payloadHash([store.instanceId, 'recipient', string(row, 'emailKey')]), sourceKey: key, createdAt: now(), epoch: store.recoveryEpoch,
                            idempotencyKey: `m1-code:${store.instanceId}:${row.id}:${generation}`, encryptedPayload: payload ? sealMail(email!.codeSecret, payload) : null, state: mode === 'experience' ? 'not_sent' : 'queued', retryable: mode === 'resend', dispatchLeaseUntil: 0 } });
                    return await view(tx, await update(emailAttemptRepository(tx), row, { deliveryId: id, challengeGeneration: generation, codeDigest: digest(mode, 'code', string(row, 'purpose'), row.id, string(row, 'emailKey'), String(generation), code), codeExpiresAt: expiresAt, resendAfter: now() + 60000 }));
                }
                if (action.startsWith('verify')) {
                    const issued = typeof row.data.deliveryId === 'string' ? await mailJobRepository(tx).get(row.data.deliveryId) : undefined;
                    const currentSend = input.sendOperationId === undefined || input.sendOperationId === issued?.data.operationId;
                    const valid = currentSend && (mode === 'experience' ? /^1234$/u : /^[0-9]{8}$/u).test(String(input.code)) && row.data.status === 'pending_email' && typeof row.data.codeDigest === 'string' && number(row, 'codeExpiresAt') > now()
                        && equalDigest(row.data.codeDigest, digest(mode, 'code', string(row, 'purpose'), row.id, string(row, 'emailKey'), String(row.data.challengeGeneration), String(input.code)));
                    if (!valid) {
                        const wrongCodes = number(row, 'wrongCodes') + 1;
                        const next = await update(emailAttemptRepository(tx), row, { wrongCodes, ...(wrongCodes >= 5 ? { status: 'cancelled' } : {}) });
                        if (wrongCodes >= 5 && row.data.purpose === 'recovery')
                            await update(recoveryRequestRepository(tx), await required(recoveryRequestRepository(tx), string(row, 'requestId')), { status: 'cancelled', cancelledAt: now(), cancellationReason: 'code_limit' });
                        return { ...await view(tx, next), verification: 'invalid' };
                    }
                    return { ...await view(tx, await update(emailAttemptRepository(tx), row, { status: 'email_proved', codeDigest: null, grantExpiresAt: Math.min(now() + 5 * 60000, number(row, 'expiresAt')) })), verification: 'valid' };
                }
                if (action === 'registerOwner' || action === 'completeSetup') {
                    if (action !== finalAction(row))
                        fail('target_not_accessible', 404, 'Target is not accessible');
                    const fields = accountFields(row.data.username, row.data.email);
                    if (await humanAccountRepository(tx).existsByUsernameKey(fields.usernameKey))
                        fail('username_unavailable', 409, 'Username is already in use', { field: 'username' });
                    if (await humanAccountRepository(tx).existsByEmailKey(fields.emailKey))
                        fail('email_unavailable', 409, 'Email is already in use', { field: 'email' });
                    const ownerId = typeof row.data.ownerId === 'string' ? row.data.ownerId : row.id;
                    const password = hashPassword(input.password);
                    let owner: StoredRow;
                    if (row.data.agentId) {
                        if ((input.handoffToken === undefined) === (input.setupToken === undefined))
                            fail('invalid_request', 400, 'Supply the original private handoff or setup proof');
                        const target = await hooks.authenticate(tx, input.handoffToken ?? input.setupToken, [string(row, 'targetKind')]);
                        if (target.id !== row.data.targetCredentialId || target.data.agentId !== row.data.agentId || target.data.ownerId !== ownerId || target.data.handoffGeneration !== row.data.generation)
                            fail('target_not_accessible', 404, 'Target is not accessible');
                        owner = await required(humanAccountRepository(tx), ownerId);
                    }
                    else {
                        if (input.handoffToken !== undefined || input.setupToken !== undefined || await humanAccountRepository(tx).get(ownerId))
                            fail('account_id_conflict', 409, 'Use a new unused account attempt');
                        if (await humanAccountRepository(tx).countAll(settings.ownerLimit) >= settings.ownerLimit)
                            fail('quota_exceeded', 429, 'Account registration limit reached');
                        owner = { id: ownerId, version: 1, data: { status: 'active', epoch: store.recoveryEpoch, authVersion: 1, createdAt: now() } };
                        await humanAccountRepository(tx).insert(owner);
                    }
                    owner = await update(humanAccountRepository(tx), owner, { ...fields, status: 'active', emailVerified: false, emailVerifiedAt: null, emailVerificationSource: 'unverified', emailVerificationMode: 'none', emailVersion: 1, initializedAt: now(), passwordSalt: password.salt, passwordHash: password.hash });
                    const ownerPublicId=await ensurePublicId(tx,'owner',ownerId);
                    const session = await hooks.newCredential(tx, input.sessionToken, 'owner_session', { ownerId, ownerAuthVersion: owner.data.authVersion!, expiresAt: now() + settings.sessionTtl });
                    if (input.recoveryToken !== undefined)
                        await hooks.newCredential(tx, input.recoveryToken, 'owner_recovery', { ownerId, ownerAuthVersion: owner.data.authVersion! });
                    if (row.data.agentId) {
                        const agentId = string(row, 'agentId');
                        if (await managementBindingRepository(tx).existsActiveByAgentId(agentId))
                            fail('state_conflict', 409, 'Agent is already managed');
                        await managementBindingRepository(tx).insert({ id: randomUUID(), version: 1, data: { agentId, ownerId, active: true } });
                        await update(agentRepository(tx), await required(agentRepository(tx), agentId), { managementInitializedAt: now() });
                        const registration = (await registrationRepository(tx).findByAgentId(agentId))[0]!;
                        await update(registrationRepository(tx), registration, { managementStatus: 'managed' });
                        for (const old of await credentialRepository(tx).findByOwnerId(ownerId))
                            if (old.data.active && ['bootstrap', 'handoff', 'setup'].includes(string(old, 'kind')))
                                await update(credentialRepository(tx), old, { active: false });
                    }
                    await update(emailAttemptRepository(tx), row, { status: 'completed', completionAction: action, completionOperationId: text(input.operationId, 'operationId', 8, 100), ownerId, completionVerificationMode: 'none' });
                    return { attemptId: row.id, ownerId, ownerPublicId, sessionId: session.id, expiresAt: session.data.expiresAt!, accountComplete: true, emailVerified: false, verificationMode: 'none', verificationSource: 'unverified', ...(row.data.agentId ? { agentId: row.data.agentId!, publicId:await readPublicId(tx,'agent',string(row,'agentId')), managementStatus: 'managed' } : {}) };
                }
                if (action === 'recoverByEmail') {
                    const request = await required(recoveryRequestRepository(tx), string(row, 'requestId'));
                    await hooks.pendingRecovery(tx, request);
                    const owner = await required(humanAccountRepository(tx), string(row, 'ownerId')), password = hashPassword(input.password), ownerAuthVersion = number(owner, 'authVersion') + 1;
                    const session = await hooks.newCredential(tx, input.sessionToken, 'owner_session', { ownerId: owner.id, ownerAuthVersion, expiresAt: now() + settings.sessionTtl });
                    const recovery = input.recoveryToken === undefined ? undefined : await hooks.newCredential(tx, input.recoveryToken, 'owner_recovery', { ownerId: owner.id, ownerAuthVersion });
                    for (const old of await credentialRepository(tx).findByActiveAndOwnerId(true, owner.id))
                        if (old.id !== session.id && old.id !== recovery?.id && ['owner_session', 'owner_recovery', 'invite'].includes(string(old, 'kind')))
                            await update(credentialRepository(tx), old, { active: false });
                    const updated = await update(humanAccountRepository(tx), owner, { authVersion: ownerAuthVersion, passwordSalt: password.salt, passwordHash: password.hash, ...(mode === 'resend' ? { emailVerified: true, emailVerifiedAt: now(), emailVerificationSource: 'recovery_code', emailVerificationMode: mode } : {}), lastRecoveryVerificationMode: mode, lastRecoveryVerificationSource: mode === 'resend' ? 'recovery_code' : 'experience_code' });
                    await update(recoveryRequestRepository(tx), request, { status: 'completed', completedAt: now(), completionOperationId: text(input.operationId, 'operationId', 8, 100), completionVerificationMode: mode });
                    await update(emailAttemptRepository(tx), row, { status: 'completed', completionAction: action, completionOperationId: text(input.operationId, 'operationId', 8, 100), completionVerificationMode: mode });
                    await notify(tx, updated, text(input.operationId, 'operationId', 8, 100), mode,requestedLocale);
                    return { attemptId: row.id, requestId: request.id, agentId: request.data.agentId!, ownerId: owner.id, sessionId: session.id, expiresAt: session.data.expiresAt!, ownerAuthVersion, emailVerified: updated.data.emailVerified === true, verificationMode: mode, verificationSource: mode === 'resend' ? 'recovery_code' : 'experience_code', invalidated: ['owner_session', 'owner_recovery', 'invite', 'other_email_authorizations'] };
                }
                fail('invalid_request', 400, 'Unsupported email action');
            });
            rejectedCode = result.verification === 'invalid';
            return result;
        });
        // The failed-code counter and its fixed-operation receipt must commit before returning an error.
        if (rejectedCode)
            fail('email_code_invalid', 400, 'Code is invalid or expired');
        return result;
    }
    async function canRead(tx: M1ReadSession, actor: StoredRow, requestedScope: string, action: string, operationId: string): Promise<boolean> {
        if (!['email_registration', 'email_recovery'].includes(string(actor, 'kind')))
            return false;
        const row = await emailAttemptRepository(tx).get(string(actor, 'attemptId'));
        if (!row || row.data.browserCredentialId !== actor.id || requestedScope !== scope(row))
            return false;
        if (row.data.status === 'completed')
            return row.data.completionAction === action && row.data.completionOperationId === operationId;
        return row.data.purpose === 'registration'
            ? ['startRegistration', 'sendRegistrationCode', 'verifyRegistrationEmail', 'cancelRegistration'].includes(action)
            : ['startEmailRecovery', 'sendRecoveryCode', 'verifyRecoveryEmail'].includes(action);
    }
    async function dispatch(result: JsonObject, action: string): Promise<void> {
        if (!config || config.mode !== 'resend' || !config.resend)
            return;
        const ids = await store.read(async (tx) => action === 'sendRegistrationCode' || action === 'sendRecoveryCode'
            ? typeof result.deliveryId === 'string' ? [result.deliveryId] : []
            : (await mailJobRepository(tx).findByOperationIdAndOwnerKeyAndPurpose(String(result.operationId), String(result.ownerId), 'notification')).map((job) => job.id));
        for (const id of ids) {
            const claimed = await store.transaction(async (tx) => {
                const job = await mailJobRepository(tx).get(id);
                if (!job || job.data.verificationMode === 'experience' || job.data.epoch !== store.recoveryEpoch || job.data.state === 'accepted' || job.data.retryable === false || number(job, 'dispatchLeaseUntil') > now() || number(job, 'createdAt') <= now() - 24 * 3600000)
                    return undefined;
                if (job.data.purpose === 'code') {
                    const attempt = await emailAttemptRepository(tx).get(string(job, 'attemptId'));
                    if (!attempt || attempt.data.purpose === 'registration' || await status(tx, attempt) !== 'pending_email' || attempt.data.deliveryId !== id || number(attempt, 'codeExpiresAt') <= now())
                        return undefined;
                }
                return await update(mailJobRepository(tx), job, { dispatchLeaseUntil: now() + 15000, state: 'unknown' });
            });
            if (!claimed || typeof claimed.data.encryptedPayload !== 'string')
                continue;
            let delivery: Delivery;
            try {
                delivery = await sendResend(config.resend, openMail(config.resend.codeSecret, claimed.data.encryptedPayload), string(claimed, 'idempotencyKey'));
            }
            catch {
                delivery = { state: 'failed' as const, retryable: false };
            }
            await store.transaction(async (tx) => {
                const current = await mailJobRepository(tx).get(id);
                if (current && current.version === claimed.version)
                    await update(mailJobRepository(tx), current, { state: delivery.state, retryable: delivery.state === 'accepted' ? false : delivery.retryable, providerId: delivery.state === 'accepted' ? delivery.providerId : null, dispatchLeaseUntil: 0 });
            });
        }
    }
    return { handles: (action: string) => (EMAIL_ACTIONS as readonly string[]).includes(action), invoke, canRead, dispatch, notify, configured: Boolean(config && (config.mode === 'experience' || config.resend)), mode: currentMode };
}
