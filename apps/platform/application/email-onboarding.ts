import { randomUUID } from 'node:crypto';
import type { JsonObject, M1ReadSession, M1Store, M1Transaction, StoredRow } from '../contracts/store.ts';
import { accountFields } from '../domains/access/account-identifiers.ts';
import { equalDigest, hashPassword, parseToken, payloadHash } from '../domains/access/credentials.ts';
import { emailCode, emailDigest, openMail, sealMail } from '../domains/access/email-secrets.ts';
import { fail, M1Error, object, text } from '../domains/common/errors.ts';
import { loadEmailConfig, sendResend, type EmailConfig, type EmailMode, type ResendEmailConfig, type MailPayload, type Delivery } from '../infrastructure/email/resend.ts';

export const EMAIL_ACTIONS = ['startRegistration', 'readRegistrationAttempt', 'sendRegistrationCode', 'verifyRegistrationEmail', 'cancelRegistration', 'registerOwner', 'completeSetup', 'startEmailRecovery', 'readEmailRecoveryAttempt', 'sendRecoveryCode', 'verifyRecoveryEmail', 'recoverByEmail', 'enableRecoveryBackup'] as const;
interface EmailCredential extends JsonObject { kind: string; ownerId: string | null; agentId: string | null }
interface Hooks {
  authenticate(tx: M1ReadSession, raw: unknown, kinds: readonly string[]): StoredRow<EmailCredential>;
  newCredential(tx: M1Transaction, raw: unknown, kind: string, metadata: JsonObject): StoredRow<EmailCredential>;
  command(tx: M1Transaction, scope: string, action: string, input: Record<string, unknown>, work: () => JsonObject): JsonObject;
  pendingRecovery(tx: M1ReadSession, row: StoredRow): void;
  recoveryContext(tx: M1ReadSession, raw: unknown, ownerId?: string): StoredRow;
}
interface Settings { now: () => number; sessionTtl: number; ownerLimit: number; config?: EmailConfig }
const number = (row: StoredRow, key: string) => row.data[key] as number;
const string = (row: StoredRow, key: string) => row.data[key] as string;
const required = (tx: M1ReadSession, table: 'email_attempts' | 'owners' | 'agents' | 'credentials' | 'recovery_requests', id: string) => {
  const row = tx.get(table, id); if (!row) fail('target_not_accessible', 404, 'Target is not accessible'); return row;
};
function update(tx: M1Transaction, table: 'email_attempts' | 'owners' | 'agents' | 'credentials' | 'recovery_requests' | 'registrations' | 'mail_jobs', row: StoredRow, patch: JsonObject): StoredRow {
  const next = { ...row, version: row.version + 1, data: { ...row.data, ...patch } };
  if (!tx.update(table, next, row.version)) fail('version_conflict', 409, 'State changed; read the current result'); return next;
}
const scope = (row: StoredRow) => `${row.data.purpose === 'registration' ? 'owner-registration' : 'owner-email-recovery'}:${row.id}`;
const finalAction = (row: StoredRow) => row.data.purpose === 'recovery' ? 'recoverByEmail' : row.data.agentId ? 'completeSetup' : 'registerOwner';

/** Durable business work is synchronous. The explicit dispatcher is the only network boundary. */
export function createEmailOnboarding(store: M1Store, hooks: Hooks, settings: Settings) {
  const now = settings.now;
  const config = settings.config && loadEmailConfig({ M1_EMAIL_MODE: settings.config.mode,
    ...(settings.config.resend ? { RESEND_API_KEY: settings.config.resend.apiKey, M1_EMAIL_FROM: settings.config.resend.from, M1_PUBLIC_ORIGIN: settings.config.resend.publicOrigin, M1_EMAIL_CODE_SECRET: settings.config.resend.codeSecret } : {}) });
  const currentMode = config?.mode ?? 'unavailable';
  const attemptMode = (row: StoredRow): EmailMode => row.data.verificationMode === 'experience' ? 'experience' : 'resend';
  function configured(mode: EmailMode, sending = false): ResendEmailConfig | undefined {
    if (!config) fail('email_unavailable', 503, 'Verification channel is temporarily unavailable');
    if (mode === 'experience') return undefined;
    if (!config.resend || (sending && config.mode !== 'resend')) fail('email_unavailable', 503, 'Email service is temporarily unavailable');
    return config.resend;
  }
  function digest(mode: EmailMode, ...parts: string[]): string {
    // A public experience code proves no mailbox control. Its independent domain
    // retains context across restarts/mode switches without requiring a mail key.
    if (mode === 'experience') return emailDigest(payloadHash([store.instanceId, store.recoveryEpoch, 'experience-code-v1']), store.instanceId, 'experience', ...parts);
    return emailDigest(configured(mode)!.codeSecret, store.instanceId, ...parts);
  }
  const available = (mode: EmailMode) => Boolean(config && (mode === 'experience' || config.resend));
  function status(tx: M1ReadSession, row: StoredRow): string {
    if (['completed', 'cancelled'].includes(string(row, 'status'))) return string(row, 'status');
    if (row.data.epoch !== store.recoveryEpoch || number(row, 'expiresAt') <= now() || (row.data.status === 'email_proved' && number(row, 'grantExpiresAt') <= now())) return 'expired';
    if (row.data.purpose === 'recovery') {
      const request = tx.get('recovery_requests', string(row, 'requestId'));
      const owner = tx.get('owners', string(row, 'ownerId'));
      try { if (!request) return 'expired'; hooks.pendingRecovery(tx, request); } catch (error) { if (error instanceof M1Error) return 'expired'; throw error; }
      if (!owner || owner.data.authVersion !== row.data.ownerAuthVersion || owner.data.emailKey !== row.data.emailKey || (owner.data.emailVersion ?? 1) !== row.data.emailVersion) return 'expired';
    }
    if (row.data.agentId && row.data.purpose === 'registration') {
      const owner = tx.get('owners', string(row, 'ownerId')), target = tx.get('credentials', string(row, 'targetCredentialId'));
      if (!owner || owner.data.status !== 'pending_setup' || owner.data.handoffGeneration !== row.data.generation || !target?.data.active || (target.data.expiresAt as number) <= now() || tx.find('bindings', { agentId: string(row, 'agentId'), active: true }).length) return 'expired';
    }
    return string(row, 'status');
  }
  function challengeExpired(row: StoredRow): boolean {
    return typeof row.data.codeExpiresAt === 'number' && row.data.codeExpiresAt <= now();
  }
  function view(tx: M1ReadSession, row: StoredRow): JsonObject {
    const delivery = typeof row.data.deliveryId === 'string' ? tx.get('mail_jobs', row.data.deliveryId) : undefined;
    return { attemptId: row.id, purpose: row.data.purpose!, verificationMode: attemptMode(row), sendOperationIdRequired: row.data.verificationMode !== undefined, codeLength: attemptMode(row) === 'experience' ? 4 : 8, status: status(tx, row), expiresAt: row.data.expiresAt!,
      codeExpiresAt: row.data.codeExpiresAt ?? null, challengeExpired: challengeExpired(row),
      resendAfter: row.data.resendAfter ?? 0, deliveryStatus: delivery?.data.state ?? (available(attemptMode(row)) ? 'none' : 'unavailable'),
      ...(row.data.deliveryId ? { deliveryId: row.data.deliveryId, sendOperationId: delivery?.data.operationId ?? null } : {}),
      ...(row.data.agentId ? { agentId: row.data.agentId!, ...(row.data.purpose === 'registration' ? { generation: row.data.generation!, ownerId: row.data.ownerId! } : { requestId: row.data.requestId!, ownerId: row.data.ownerId! }) } : {}),
      ...(row.data.grantExpiresAt ? { grantExpiresAt: row.data.grantExpiresAt } : {}) };
  }
  function pending(tx: M1ReadSession, row: StoredRow, proved = false) {
    const current = status(tx, row);
    if (current === 'expired') fail('email_attempt_expired', 410, 'Email attempt expired');
    if (!['pending_email', 'email_proved'].includes(current)) fail('email_attempt_closed', 409, 'Email attempt is closed');
    if (proved && (current !== 'email_proved' || number(row, 'grantExpiresAt') <= now())) fail('email_verification_required', 403, 'Verify this email attempt before completing it');
  }
  function browser(tx: M1ReadSession, proof: unknown, attemptId: unknown, purpose: string): StoredRow {
    const actor = hooks.authenticate(tx, proof, [purpose === 'registration' ? 'email_registration' : 'email_recovery']);
    const row = required(tx, 'email_attempts', text(attemptId, 'attemptId', 8, 100));
    if (row.data.purpose !== purpose || row.data.browserCredentialId !== actor.id || actor.data.attemptId !== row.id) fail('target_not_accessible', 404, 'Target is not accessible'); return row;
  }
  function sourceKey(clientIp: string) { return payloadHash([store.instanceId, 'source', clientIp]); }
  function sourceKeys(clientIp: string): string[] {
    return [sourceKey(clientIp), ...(config?.resend ? [emailDigest(config.resend.codeSecret, store.instanceId, 'source', clientIp)] : [])];
  }
  function startLimit(tx: M1ReadSession, keys: string[]) {
    const recent = tx.find('email_attempts').filter((row) => number(row, 'createdAt') > now() - 3_600_000);
    if (recent.filter((row) => keys.includes(string(row, 'sourceKey'))).length >= 30 || recent.length >= 1000) fail('email_rate_limited', 429, 'Try again later');
  }
  function sendLimit(tx: M1ReadSession, row: StoredRow, keys: string[]) {
    const all = tx.find('mail_jobs', { purpose: 'code' });
    const ownerKey = row.data.purpose === 'recovery' ? string(row, 'ownerId') : string(row, 'emailKey');
    const related = all.filter((job) => job.data.ownerKey === ownerKey || (typeof job.data.attemptId === 'string' && tx.get('email_attempts', job.data.attemptId)?.data.emailKey === row.data.emailKey));
    if (related.some((job) => number(job, 'createdAt') > now() - 60_000)
      || related.filter((job) => number(job, 'createdAt') > now() - 30 * 60_000).length >= 3
      || related.filter((job) => number(job, 'createdAt') > now() - 24 * 3_600_000).length >= 10
      || all.filter((job) => keys.includes(string(job, 'sourceKey')) && number(job, 'createdAt') > now() - 30 * 60_000).length >= 20
      || all.filter((job) => number(job, 'createdAt') > now() - 30 * 60_000).length >= 1000) fail('email_rate_limited', 429, 'Try again later');
    return ownerKey;
  }
  function notify(tx: M1Transaction, owner: StoredRow, operationId: string, mode: EmailMode = currentMode === 'experience' ? 'experience' : 'resend') {
    const id = randomUUID(), sender = mode === 'resend' ? config?.resend : undefined;
    const payload: MailPayload | null = sender ? { from: sender.from, to: [string(owner, 'email')], subject: 'connet.ai · Password recovery completed', text: `Your connet.ai password was reset at ${new Date(now()).toISOString()}. If you did not request this, return to the trusted site ${sender.publicOrigin}. This message contains no password or login credential.` } : null;
    tx.insert('mail_jobs', { id, version: 1, data: { purpose: 'notification', verificationMode: mode, ownerKey: owner.id, operationId, createdAt: now(), state: mode === 'experience' ? 'not_sent' : sender ? 'queued' : 'unavailable', retryable: Boolean(sender), dispatchLeaseUntil: 0, idempotencyKey: `m1-notice:${store.instanceId}:${id}`, encryptedPayload: payload ? sealMail(sender!.codeSecret, payload) : null, epoch: store.recoveryEpoch } });
  }
  function invoke(action: string, raw: unknown, proof: unknown, clientIp = 'internal'): JsonObject {
    let rejectedCode = false;
    const result = store.transaction((tx) => {
      if (action === 'startRegistration') {
        const input = object(raw, ['operationId', 'attemptId', 'browserToken', 'username', 'email', 'agentId', 'expectedGeneration', 'handoffToken', 'setupToken']);
        const attemptId = text(input.attemptId, 'attemptId', 36, 36);
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(attemptId)) fail('invalid_request', 400, 'Expected a UUID attempt ID');
        const prior = tx.get('email_attempts', attemptId);
        if (prior) { browser(tx, input.browserToken, attemptId, 'registration'); if (prior.data.status === 'completed') fail('email_attempt_closed', 409, 'Read the original completion result'); }
        return hooks.command(tx, `owner-registration:${attemptId}`, action, input, () => {
          if (prior || tx.get('owners', attemptId)) fail('account_id_conflict', 409, 'Use a new unused account attempt');
          const fields = accountFields(input.username, input.email), key = sourceKey(clientIp); startLimit(tx, sourceKeys(clientIp));
          const hasTarget = input.agentId !== undefined || input.handoffToken !== undefined || input.setupToken !== undefined || input.expectedGeneration !== undefined;
          let target: JsonObject = {}; let expiresAt = now() + 30 * 60_000;
          if (hasTarget) {
            if ((input.handoffToken === undefined) === (input.setupToken === undefined)) fail('invalid_request', 400, 'Supply exactly one private handoff or setup proof');
            const actor = hooks.authenticate(tx, input.handoffToken ?? input.setupToken, input.handoffToken === undefined ? ['setup'] : ['handoff']);
            const agentId = text(input.agentId, 'agentId', 8, 100);
            if (actor.data.agentId !== agentId || input.expectedGeneration !== actor.data.handoffGeneration) fail('target_not_accessible', 404, 'Target is not accessible');
            expiresAt = Math.min(expiresAt, number(actor, 'expiresAt'));
            target = { agentId, ownerId: actor.data.ownerId!, generation: actor.data.handoffGeneration!, targetCredentialId: actor.id, targetKind: actor.data.kind! };
          }
          const credential = hooks.newCredential(tx, input.browserToken, 'email_registration', { attemptId });
          const row: StoredRow = { id: attemptId, version: 1, data: { ...fields, ...target, purpose: 'registration', verificationMode: currentMode === 'experience' ? 'experience' : 'resend', browserCredentialId: credential.id, status: 'pending_email', createdAt: now(), expiresAt, wrongCodes: 0, epoch: store.recoveryEpoch, sourceKey: key } };
          tx.insert('email_attempts', row); return view(tx, row);
        });
      }
      if (action === 'startEmailRecovery') {
        const input = object(raw, ['operationId', 'browserToken']), id = parseToken(input.browserToken, true).id;
        const request = hooks.recoveryContext(tx, proof), prior = tx.get('email_attempts', id);
        if (prior) { browser(tx, input.browserToken, id, 'recovery'); if (prior.data.status === 'completed') fail('email_attempt_closed', 409, 'Read the original completion result'); if (prior.data.requestId !== request.id) fail('target_not_accessible', 404, 'Target is not accessible'); }
        return hooks.command(tx, `owner-email-recovery:${id}`, action, input, () => {
          configured(currentMode === 'experience' ? 'experience' : 'resend'); hooks.pendingRecovery(tx, request);
          if (tx.find('email_attempts', { requestId: request.id }).length) fail('email_attempt_exists', 409, 'Continue the original browser attempt or cancel the recovery request');
          const key = sourceKey(clientIp); startLimit(tx, sourceKeys(clientIp));
          const owner = required(tx, 'owners', string(request, 'ownerId'));
          const credential = hooks.newCredential(tx, input.browserToken, 'email_recovery', { attemptId: id });
          const row: StoredRow = { id, version: 1, data: { purpose: 'recovery', verificationMode: currentMode === 'experience' ? 'experience' : 'resend', browserCredentialId: credential.id, status: 'pending_email', createdAt: now(), expiresAt: Math.min(now() + 30 * 60_000, number(request, 'expiresAt')), wrongCodes: 0, epoch: store.recoveryEpoch, sourceKey: key,
            ownerId: owner.id, agentId: request.data.agentId!, requestId: request.id, ownerAuthVersion: owner.data.authVersion!, email: owner.data.email!, emailKey: owner.data.emailKey!, emailVersion: owner.data.emailVersion ?? 1 } };
          tx.insert('email_attempts', row); return view(tx, row);
        });
      }
      if (action === 'enableRecoveryBackup') {
        const input = object(raw, ['operationId', 'recoveryToken', 'credentialsSaved']);
        const actor = hooks.authenticate(tx, proof, ['owner_session']);
        return hooks.command(tx, `owner:${actor.data.ownerId!}`, action, input, () => {
          if (input.credentialsSaved !== true) fail('invalid_request', 400, 'Save the optional backup before enabling it');
          const recovery = hooks.newCredential(tx, input.recoveryToken, 'owner_recovery', { ownerId: actor.data.ownerId!, ownerAuthVersion: actor.data.ownerAuthVersion! });
          for (const old of tx.find('credentials', { ownerId: actor.data.ownerId!, kind: 'owner_recovery', active: true })) if (old.id !== recovery.id) update(tx, 'credentials', old, { active: false });
          return { ownerId: actor.data.ownerId!, recoveryId: recovery.id };
        });
      }
      const registration = ['readRegistrationAttempt', 'sendRegistrationCode', 'verifyRegistrationEmail', 'cancelRegistration', 'registerOwner', 'completeSetup'].includes(action);
      const input = object(raw, action.startsWith('read') ? ['attemptId'] : action === 'registerOwner' || action === 'completeSetup' ? ['operationId', 'attemptId', 'password', 'sessionToken', 'recoveryToken', 'handoffToken', 'setupToken'] : action === 'recoverByEmail' ? ['operationId', 'attemptId', 'password', 'sessionToken', 'recoveryToken'] : action.startsWith('verify') ? ['operationId', 'attemptId', 'code', 'sendOperationId'] : ['operationId', 'attemptId']);
      const row = browser(tx, proof, input.attemptId, registration ? 'registration' : 'recovery');
      if (action.startsWith('read')) return view(tx, row);
      if (row.data.status === 'completed' && (row.data.completionAction !== action || row.data.completionOperationId !== input.operationId)) fail('email_attempt_closed', 409, 'Read the original completion result');
      const mode = attemptMode(row);
      if (action.startsWith('verify') && (row.data.verificationMode !== undefined || input.sendOperationId !== undefined)) text(input.sendOperationId, 'sendOperationId', 8, 100);
      let commandInput = input;
      if (action.startsWith('verify')) commandInput = { ...input, code: digest(mode, 'operation-code', row.id, text(input.code, 'code', 1, 64)) };
      const result = hooks.command(tx, scope(row), action, commandInput, () => {
        if (action === 'cancelRegistration') { pending(tx, row); return view(tx, update(tx, 'email_attempts', row, { status: 'cancelled' })); }
        const email = configured(mode, action.startsWith('send')); pending(tx, row, action === 'registerOwner' || action === 'completeSetup' || action === 'recoverByEmail');
        if (action.startsWith('send')) {
          if (row.data.status !== 'pending_email') fail('email_attempt_closed', 409, 'Email attempt is closed');
          const previous = typeof row.data.deliveryId === 'string' ? tx.get('mail_jobs', row.data.deliveryId) : undefined;
          if (previous && ['queued', 'unknown'].includes(string(previous, 'state')) && !challengeExpired(row)) fail('email_delivery_pending', 409, 'Continue the original delivery operation', { operationId: previous.data.operationId });
          const key = sourceKey(clientIp), ownerKey = sendLimit(tx, row, sourceKeys(clientIp)), code = mode === 'experience' ? '1234' : emailCode(), generation = (row.data.challengeGeneration as number ?? 0) + 1;
          const id = randomUUID(), expiresAt = Math.min(now() + 10 * 60_000, number(row, 'expiresAt'));
          const purpose = registration ? 'registration' : 'password recovery';
          const payload: MailPayload | null = email ? { from: email.from, to: [string(row, 'email')], subject: `connet.ai · ${purpose} code`, text: `Your connet.ai ${purpose} code is ${code}. Requested at ${new Date(now()).toISOString()}. Enter it only on the trusted page ${email.publicOrigin} that you just opened. Do not give this code to an Agent or anyone else. It expires in 10 minutes. If you did not request this, ignore this message.` } : null;
          tx.insert('mail_jobs', { id, version: 1, data: { purpose: 'code', verificationMode: mode, attemptId: row.id, operationId: text(input.operationId, 'operationId', 8, 100), ownerKey, recipientKey: payloadHash([store.instanceId, 'recipient', string(row, 'emailKey')]), sourceKey: key, createdAt: now(), epoch: store.recoveryEpoch,
            idempotencyKey: `m1-code:${store.instanceId}:${row.id}:${generation}`, encryptedPayload: payload ? sealMail(email!.codeSecret, payload) : null, state: mode === 'experience' ? 'not_sent' : 'queued', retryable: mode === 'resend', dispatchLeaseUntil: 0 } });
          return view(tx, update(tx, 'email_attempts', row, { deliveryId: id, challengeGeneration: generation, codeDigest: digest(mode, 'code', string(row, 'purpose'), row.id, string(row, 'emailKey'), String(generation), code), codeExpiresAt: expiresAt, resendAfter: now() + 60_000 }));
        }
        if (action.startsWith('verify')) {
          const issued = typeof row.data.deliveryId === 'string' ? tx.get('mail_jobs', row.data.deliveryId) : undefined;
          const currentSend = input.sendOperationId === undefined || input.sendOperationId === issued?.data.operationId;
          const valid = currentSend && (mode === 'experience' ? /^1234$/u : /^[0-9]{8}$/u).test(String(input.code)) && row.data.status === 'pending_email' && typeof row.data.codeDigest === 'string' && number(row, 'codeExpiresAt') > now()
            && equalDigest(row.data.codeDigest, digest(mode, 'code', string(row, 'purpose'), row.id, string(row, 'emailKey'), String(row.data.challengeGeneration), String(input.code)));
          if (!valid) {
            const wrongCodes = number(row, 'wrongCodes') + 1;
            const next = update(tx, 'email_attempts', row, { wrongCodes, ...(wrongCodes >= 5 ? { status: 'cancelled' } : {}) });
            if (wrongCodes >= 5 && row.data.purpose === 'recovery') update(tx, 'recovery_requests', required(tx, 'recovery_requests', string(row, 'requestId')), { status: 'cancelled', cancelledAt: now(), cancellationReason: 'code_limit' });
            return { ...view(tx, next), verification: 'invalid' };
          }
          return { ...view(tx, update(tx, 'email_attempts', row, { status: 'email_proved', codeDigest: null, grantExpiresAt: Math.min(now() + 5 * 60_000, number(row, 'expiresAt')) })), verification: 'valid' };
        }
        if (action === 'registerOwner' || action === 'completeSetup') {
          if (action !== finalAction(row)) fail('target_not_accessible', 404, 'Target is not accessible');
          const fields = accountFields(row.data.username, row.data.email);
          if (tx.find('owners', { usernameKey: fields.usernameKey }).length) fail('username_unavailable', 409, 'Username is already in use', { field: 'username' });
          if (tx.find('owners', { emailKey: fields.emailKey }).length) fail('email_unavailable', 409, 'Email is already in use', { field: 'email' });
          const ownerId = typeof row.data.ownerId === 'string' ? row.data.ownerId : row.id;
          const password = hashPassword(input.password);
          let owner: StoredRow;
          if (row.data.agentId) {
            if ((input.handoffToken === undefined) === (input.setupToken === undefined)) fail('invalid_request', 400, 'Supply the original private handoff or setup proof');
            const target = hooks.authenticate(tx, input.handoffToken ?? input.setupToken, [string(row, 'targetKind')]);
            if (target.id !== row.data.targetCredentialId || target.data.agentId !== row.data.agentId || target.data.ownerId !== ownerId || target.data.handoffGeneration !== row.data.generation) fail('target_not_accessible', 404, 'Target is not accessible');
            owner = required(tx, 'owners', ownerId);
          } else {
            if (input.handoffToken !== undefined || input.setupToken !== undefined || tx.get('owners', ownerId)) fail('account_id_conflict', 409, 'Use a new unused account attempt');
            if (tx.find('owners').length >= settings.ownerLimit) fail('quota_exceeded', 429, 'Account registration limit reached');
            owner = { id: ownerId, version: 1, data: { status: 'active', epoch: store.recoveryEpoch, authVersion: 1, createdAt: now() } }; tx.insert('owners', owner);
          }
          owner = update(tx, 'owners', owner, { ...fields, status: 'active', emailVerified: mode === 'resend', emailVerifiedAt: mode === 'resend' ? now() : null, emailVerificationSource: mode === 'resend' ? 'registration_code' : 'experience_code', emailVerificationMode: mode, emailVersion: 1, initializedAt: now(), passwordSalt: password.salt, passwordHash: password.hash });
          const session = hooks.newCredential(tx, input.sessionToken, 'owner_session', { ownerId, ownerAuthVersion: owner.data.authVersion!, expiresAt: now() + settings.sessionTtl });
          if (input.recoveryToken !== undefined) hooks.newCredential(tx, input.recoveryToken, 'owner_recovery', { ownerId, ownerAuthVersion: owner.data.authVersion! });
          if (row.data.agentId) {
            const agentId = string(row, 'agentId');
            if (tx.find('bindings', { agentId, active: true }).length) fail('state_conflict', 409, 'Agent is already managed');
            tx.insert('bindings', { id: randomUUID(), version: 1, data: { agentId, ownerId, active: true } });
            update(tx, 'agents', required(tx, 'agents', agentId), { managementInitializedAt: now() });
            const registration = tx.find('registrations', { agentId })[0]!;
            update(tx, 'registrations', registration, { managementStatus: 'managed' });
            for (const old of tx.find('credentials', { ownerId })) if (old.data.active && ['bootstrap', 'handoff', 'setup'].includes(string(old, 'kind'))) update(tx, 'credentials', old, { active: false });
          }
          update(tx, 'email_attempts', row, { status: 'completed', completionAction: action, completionOperationId: text(input.operationId, 'operationId', 8, 100), ownerId, completionVerificationMode: mode });
          return { attemptId: row.id, ownerId, sessionId: session.id, expiresAt: session.data.expiresAt!, accountComplete: true, emailVerified: mode === 'resend', verificationMode: mode, verificationSource: mode === 'resend' ? 'registration_code' : 'experience_code', ...(row.data.agentId ? { agentId: row.data.agentId!, managementStatus: 'managed' } : {}) };
        }
        if (action === 'recoverByEmail') {
          const request = required(tx, 'recovery_requests', string(row, 'requestId')); hooks.pendingRecovery(tx, request);
          const owner = required(tx, 'owners', string(row, 'ownerId')), password = hashPassword(input.password), ownerAuthVersion = number(owner, 'authVersion') + 1;
          const session = hooks.newCredential(tx, input.sessionToken, 'owner_session', { ownerId: owner.id, ownerAuthVersion, expiresAt: now() + settings.sessionTtl });
          const recovery = input.recoveryToken === undefined ? undefined : hooks.newCredential(tx, input.recoveryToken, 'owner_recovery', { ownerId: owner.id, ownerAuthVersion });
          for (const old of tx.find('credentials', { ownerId: owner.id, active: true })) if (old.id !== session.id && old.id !== recovery?.id && ['owner_session', 'owner_recovery', 'invite'].includes(string(old, 'kind'))) update(tx, 'credentials', old, { active: false });
          const updated = update(tx, 'owners', owner, { authVersion: ownerAuthVersion, passwordSalt: password.salt, passwordHash: password.hash, ...(mode === 'resend' ? { emailVerified: true, emailVerifiedAt: now(), emailVerificationSource: 'recovery_code', emailVerificationMode: mode } : {}), lastRecoveryVerificationMode: mode, lastRecoveryVerificationSource: mode === 'resend' ? 'recovery_code' : 'experience_code' });
          update(tx, 'recovery_requests', request, { status: 'completed', completedAt: now(), completionOperationId: text(input.operationId, 'operationId', 8, 100), completionVerificationMode: mode });
          update(tx, 'email_attempts', row, { status: 'completed', completionAction: action, completionOperationId: text(input.operationId, 'operationId', 8, 100), completionVerificationMode: mode });
          notify(tx, updated, text(input.operationId, 'operationId', 8, 100), mode);
          return { attemptId: row.id, requestId: request.id, agentId: request.data.agentId!, ownerId: owner.id, sessionId: session.id, expiresAt: session.data.expiresAt!, ownerAuthVersion, emailVerified: updated.data.emailVerified === true, verificationMode: mode, verificationSource: mode === 'resend' ? 'recovery_code' : 'experience_code', invalidated: ['owner_session', 'owner_recovery', 'invite', 'other_email_authorizations'] };
        }
        fail('invalid_request', 400, 'Unsupported email action');
      });
      rejectedCode = result.verification === 'invalid'; return result;
    });
    // The failed-code counter and its fixed-operation receipt must commit before returning an error.
    if (rejectedCode) fail('email_code_invalid', 400, 'Code is invalid or expired');
    return result;
  }
  function canRead(tx: M1ReadSession, actor: StoredRow, requestedScope: string, action: string, operationId: string): boolean {
    if (!['email_registration', 'email_recovery'].includes(string(actor, 'kind'))) return false;
    const row = tx.get('email_attempts', string(actor, 'attemptId'));
    if (!row || row.data.browserCredentialId !== actor.id || requestedScope !== scope(row)) return false;
    if (row.data.status === 'completed') return row.data.completionAction === action && row.data.completionOperationId === operationId;
    return row.data.purpose === 'registration'
      ? ['startRegistration', 'sendRegistrationCode', 'verifyRegistrationEmail', 'cancelRegistration'].includes(action)
      : ['startEmailRecovery', 'sendRecoveryCode', 'verifyRecoveryEmail'].includes(action);
  }
  async function dispatch(result: JsonObject, action: string): Promise<void> {
    if (!config || config.mode !== 'resend' || !config.resend) return;
    const ids = store.read((tx) => action === 'sendRegistrationCode' || action === 'sendRecoveryCode'
      ? typeof result.deliveryId === 'string' ? [result.deliveryId] : []
      : tx.find('mail_jobs', { purpose: 'notification', operationId: String(result.operationId), ownerKey: String(result.ownerId) }).map((job) => job.id));
    for (const id of ids) {
      const claimed = store.transaction((tx) => {
        const job = tx.get('mail_jobs', id);
        if (!job || job.data.verificationMode === 'experience' || job.data.epoch !== store.recoveryEpoch || job.data.state === 'accepted' || job.data.retryable === false || number(job, 'dispatchLeaseUntil') > now() || number(job, 'createdAt') <= now() - 24 * 3_600_000) return undefined;
        if (job.data.purpose === 'code') {
          const attempt = tx.get('email_attempts', string(job, 'attemptId'));
          if (!attempt || status(tx, attempt) !== 'pending_email' || attempt.data.deliveryId !== id || number(attempt, 'codeExpiresAt') <= now()) return undefined;
        }
        return update(tx, 'mail_jobs', job, { dispatchLeaseUntil: now() + 15_000, state: 'unknown' });
      });
      if (!claimed || typeof claimed.data.encryptedPayload !== 'string') continue;
      let delivery: Delivery;
      try { delivery = await sendResend(config.resend, openMail(config.resend.codeSecret, claimed.data.encryptedPayload), string(claimed, 'idempotencyKey')); }
      catch { delivery = { state: 'failed' as const, retryable: false }; }
      store.transaction((tx) => { const current = tx.get('mail_jobs', id); if (current && current.version === claimed.version) update(tx, 'mail_jobs', current, { state: delivery.state, retryable: delivery.state === 'accepted' ? false : delivery.retryable, providerId: delivery.state === 'accepted' ? delivery.providerId : null, dispatchLeaseUntil: 0 }); });
    }
  }
  return { handles: (action: string) => (EMAIL_ACTIONS as readonly string[]).includes(action), invoke, canRead, dispatch, notify, configured: Boolean(config && (config.mode === 'experience' || config.resend)), mode: currentMode };
}
