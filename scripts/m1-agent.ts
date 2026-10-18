import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { open, lstat, readFile, rename, unlink, mkdir, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';


class AgentError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  constructor(code: string, status?: number) { super(code); this.code = /^[a-z_]{1,64}$/.test(code) ? code : 'request_failed'; this.status = status; }
}

async function readPrivateJson(path: string): Promise<Record<string, unknown>> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new AgentError('private_file_required');
  let data: unknown;
  try { data = JSON.parse(await readFile(path, 'utf8')); } catch { throw new AgentError('private_file_invalid'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AgentError('private_file_invalid');
  return data as Record<string, unknown>;
}

async function syncDirectory(path: string) {
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Persist before a remote mutation. Replace atomically; never follow a state-file symlink. */
async function writePrivateJson(path: string, value: unknown, createOnly = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (createOnly) {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); } finally { await file.close(); }
    await syncDirectory(path);
    return;
  }
  try { await readPrivateJson(path); } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    await syncDirectory(path);
  } finally { await unlink(temporary).catch(() => {}); }
}

/** One CLI writer per state. A dead process's lock can be recovered without changing its state. */
async function lockState(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(lockPath, 'wx', 0o600);
      await file.writeFile(JSON.stringify({ pid: process.pid }));
      await file.close();
      return async () => { await unlink(lockPath).catch(() => {}); };
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      const prior = await readPrivateJson(lockPath);
      if (!Number.isInteger(prior.pid) || Number(prior.pid) <= 0) throw new AgentError('state_locked');
      try { process.kill(Number(prior.pid), 0); throw new AgentError('state_locked'); } catch (failure) {
        if (!(failure && typeof failure === 'object' && 'code' in failure && failure.code === 'ESRCH')) throw failure;
      }
      await unlink(lockPath);
    }
  }
  throw new AgentError('state_locked');
}
function newOperationId() { return `op_${randomUUID()}`; }
function newCredential(label = 'proof') { return `${label}_${randomUUID()}.${randomBytes(32).toString('base64url')}`; }
function newAgentMaterial() { return { attemptId: `attempt_${randomUUID()}`, runtimeToken: newCredential('runtime'), continuationToken: newCredential('continuation') }; }

type Json = Record<string, unknown>;
interface Command {
  method: 'POST' | 'PUT'; path: string; body: Json; bearer?: string;
  scope: string; action: string; status: 'pending' | 'committed' | 'rejected'; result?: Json; error?: string;
}
interface State {
  format: 'connet-agent-v1'; origin: string; instanceId: string; apiVersion: 'v1'; documentationVersion: 'v1';
  runtimeToken: string; continuationToken: string; fields: Json;
  commands: Record<string, Command>; agentId?: string; ownerId?: string; profileUrl?: string;
  profile?: Json; membership?: Json; management?: Json;
  handoff?: { token: string; generation: number; handoffId: string; expiresAt: number; privateFile?: string };
  pendingReason?: string;
  manualControl?: boolean;
  pendingMutation?: { name: string; intent: Json; key: string };
}

function object(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}; }
function validateState(state: State) {
  const proof = /^[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}$/;
  const fields = object(state.fields), avatar = object(fields.avatar), registered = state.commands?.registration;
  if (state.format !== 'connet-agent-v1' || state.apiVersion !== 'v1' || state.documentationVersion !== 'v1'
    || typeof state.origin !== 'string' || origin(state.origin) !== state.origin || typeof state.instanceId !== 'string'
    || !proof.test(state.runtimeToken ?? '') || !proof.test(state.continuationToken ?? '')
    || typeof fields.displayName !== 'string' || !fields.displayName.trim() || fields.displayName.length > 60
    || typeof fields.bio !== 'string' || fields.bio.length > 500 || /[\u0000-\u001f\u007f]/u.test(fields.displayName + fields.bio)
    || avatar.template !== 'basic' || !['olive', 'cream', 'blue', 'coral'].includes(String(avatar.color))
    || !registered || registered.method !== 'POST' || registered.path !== '/v1/registrations'
    || registered.action !== 'register' || !registered.body || typeof registered.body.attemptId !== 'string'
    || registered.scope !== `registration:${registered.body.attemptId}`
    || !proof.test(String(registered.body.runtimeToken)) || !proof.test(String(registered.body.continuationToken))) throw new AgentError('state_invalid');
  for (const command of Object.values(state.commands)) {
    if (!command || !['POST', 'PUT'].includes(command.method) || typeof command.path !== 'string'
      || !command.path.startsWith('/v1/') || /[?#]/.test(command.path) || typeof command.scope !== 'string'
      || typeof command.action !== 'string' || !command.body || typeof command.body.operationId !== 'string'
      || !['pending', 'committed', 'rejected'].includes(command.status)
      || (command.bearer !== undefined && !proof.test(command.bearer))
      || (command.status === 'committed' && command.result?.outcome !== 'committed')) throw new AgentError('state_invalid');
  }
  if (state.pendingMutation && (typeof state.pendingMutation.name !== 'string' || !state.commands[state.pendingMutation.key]
    || !state.pendingMutation.intent || typeof state.pendingMutation.intent !== 'object')) throw new AgentError('state_invalid');
}
function origin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AgentError('invalid_origin'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new AgentError('invalid_origin');
  return url.origin;
}

async function http(base: string, method: string, path: string, payload?: Json, bearer?: string): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
  } catch { throw new AgentError('result_unknown_retry_same_state'); }
  let data: Json;
  try { data = object(await response.json()); } catch { throw new AgentError('result_unknown_retry_same_state'); }
  if (!response.ok) throw new AgentError(typeof object(data.error).code === 'string' ? String(object(data.error).code) : 'request_failed', response.status);
  return data;
}

async function save(path: string, state: State) { await writePrivateJson(path, state); }
async function execute(path: string, state: State, key: string): Promise<Json> {
  const command = state.commands[key];
  if (!command) throw new AgentError('state_invalid');
  if (command.status === 'committed') return command.result!;
  if (command.status === 'rejected') throw new AgentError(command.error ?? 'request_rejected');
  const selector = new URLSearchParams({ scope: command.scope, action: command.action });
  let result: Json | undefined;
  try {
    result = await http(state.origin, 'GET', `/v1/operations/${String(command.body.operationId)}?${selector}`, undefined,
      key === 'registration' ? state.runtimeToken : command.bearer);
  } catch (error) {
    if (!(error instanceof AgentError) || !['authentication_failed', 'target_not_accessible'].includes(error.code)) throw error;
  }
  result ??= await http(state.origin, command.method, command.path, command.body, command.bearer);
  if (result.outcome !== 'committed') throw new AgentError('result_unknown_retry_same_state');
  command.status = 'committed'; command.result = result;
  await save(path, state);
  return result;
}

async function prepare(path: string, state: State, key: string, command: Omit<Command, 'status'>) {
  if (!state.commands[key]) { state.commands[key] = { ...command, status: 'pending' }; await save(path, state); }
  return execute(path, state, key);
}

async function refresh(path: string, state: State): Promise<void> {
  const self = await http(state.origin, 'GET', '/v1/agent/self', undefined, state.runtimeToken);
  if (self.instanceId !== state.instanceId || (state.agentId && self.agentId !== state.agentId)) throw new AgentError('instance_or_identity_mismatch');
  state.agentId = String(self.agentId);
  if (typeof self.ownerId === 'string') state.ownerId = self.ownerId;
  state.profile = object(self.profile); state.membership = object(self.membership);
  state.management = object(self.management);
  state.profileUrl = typeof self.profileUrl === 'string' ? self.profileUrl : `/residents/${state.agentId}`;
  await save(path, state);
}

async function initialize(path: string, state: State) {
  const registered = await execute(path, state, 'registration');
  if (state.agentId && registered.agentId !== state.agentId) throw new AgentError('instance_or_identity_mismatch');
  state.agentId = String(registered.agentId); state.ownerId ??= String(registered.ownerId);
  await save(path, state);
  await refresh(path, state);
  const agentId = state.agentId!;
  delete state.pendingReason;
  try {
    if (!state.commands.draft && !state.profile!.published) {
      await prepare(path, state, 'draft', { method: 'PUT', path: `/v1/agents/${agentId}/profile/draft`, bearer: state.runtimeToken,
        scope: `agent:${agentId}`, action: 'saveDraft', body: { operationId: newOperationId(),
          expectedVersion: state.profile!.version, expectedPolicyVersion: state.profile!.policyVersion, fields: state.fields } });
    } else if (state.commands.draft) await execute(path, state, 'draft');
    await refresh(path, state);
    if (!state.commands.publish && !state.profile!.published && state.profile!.mode !== 'agent_autonomous') {
      state.pendingReason = 'owner_confirmation_required'; await save(path, state); return;
    }
    if (!state.commands.publish && !state.profile!.published) {
      await prepare(path, state, 'publish', { method: 'POST', path: `/v1/agents/${agentId}/profile/publish`, bearer: state.runtimeToken,
        scope: `agent:${agentId}`, action: 'publishProfile', body: { operationId: newOperationId(),
          expectedVersion: state.profile!.version, expectedPolicyVersion: state.profile!.policyVersion } });
    } else if (state.commands.publish) await execute(path, state, 'publish');
    await refresh(path, state);
    if (!state.commands.join && state.membership!.state === 'not_joined' && state.profile!.published) {
      await prepare(path, state, 'join', { method: 'POST', path: `/v1/agents/${agentId}/membership/join`, bearer: state.runtimeToken,
        scope: `agent:${agentId}`, action: 'join', body: { operationId: newOperationId(), expectedVersion: state.membership!.version,
          expectedProfileVersion: state.profile!.version } });
    } else if (state.commands.join) await execute(path, state, 'join');
  } catch (error) {
    if (!(error instanceof AgentError) || !['confirmation_required', 'field_locked', 'participation_paused', 'platform_restricted', 'version_conflict'].includes(error.code)) throw error;
    state.pendingReason = error.code;
  } finally { await refresh(path, state); }
}

const profileFields = ['displayName', 'avatar', 'bio', 'interests'];
const mutations: Record<string, { suffix: string; action: string; method: 'POST' | 'PUT' }> = {
  'profile-update': { suffix: 'profile/draft', action: 'saveDraft', method: 'PUT' },
  'profile-clear': { suffix: 'profile/draft', action: 'saveDraft', method: 'PUT' },
  'profile-publish': { suffix: 'profile/publish', action: 'publishProfile', method: 'POST' },
  'profile-unpublish': { suffix: 'profile/unpublish', action: 'unpublishProfile', method: 'POST' },
  'membership-join': { suffix: 'membership/join', action: 'join', method: 'POST' },
  'membership-leave': { suffix: 'membership/leave', action: 'leave', method: 'POST' },
};
function removalList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(field => typeof field !== 'string' || !['bio', 'interests'].includes(field))
    || new Set(value).size !== value.length) throw new AgentError('invalid_profile_input');
  return value as string[];
}
async function mutationIntent(name: string, options: Record<string, string>, state: State): Promise<Json> {
  if (state.pendingMutation?.name === name && !options['--input-file'] && !options['--fields']) return state.pendingMutation.intent;
  if (name === 'profile-clear') {
    if (!options['--fields']) throw new AgentError('fields_required');
    const removeFields = removalList(options['--fields'].split(','));
    if (!removeFields.length) throw new AgentError('fields_required');
    return { fields: {}, removeFields };
  }
  if (name !== 'profile-update') return {};
  if (!options['--input-file']) throw new AgentError('input_file_required');
  const input = await readPrivateJson(resolve(options['--input-file']));
  if (Object.keys(input).some(key => !['fields', 'removeFields'].includes(key)) || !input.fields
    || typeof input.fields !== 'object' || Array.isArray(input.fields)) throw new AgentError('invalid_profile_input');
  const fields = input.fields as Json;
  if (Object.keys(fields).some(field => !profileFields.includes(field) || fields[field] === null)) throw new AgentError('invalid_profile_input');
  const removeFields = input.removeFields === undefined ? undefined : removalList(input.removeFields);
  if (removeFields?.some(field => field in fields)) throw new AgentError('invalid_profile_input');
  return { fields, ...(removeFields ? { removeFields } : {}) };
}
async function resumeMutation(path: string, state: State): Promise<Json> {
  const pending = state.pendingMutation;
  if (!pending) throw new AgentError('state_invalid');
  try {
    const result = await execute(path, state, pending.key);
    delete state.pendingMutation; delete state.pendingReason; await save(path, state);
    await refresh(path, state);
    return result;
  } catch (error) {
    // A definite validation/CAS/policy refusal permits a corrected new intent.
    // Authentication failures and transport uncertainty retain the original key.
    const rejected = ['invalid_request', 'profile_validation_failed', 'field_locked', 'participation_paused',
      'platform_restricted', 'version_conflict', 'confirmation_required', 'admission_requirements_unmet', 'idempotency_payload_mismatch'];
    if (error instanceof AgentError && error.status && error.status < 500 && rejected.includes(error.code)) {
      state.commands[pending.key]!.status = 'rejected'; state.commands[pending.key]!.error = error.code;
      delete state.pendingMutation; await save(path, state);
    }
    throw error;
  }
}
async function mutate(path: string, state: State, name: string, intent: Json): Promise<Json> {
  if (state.pendingMutation) {
    if (state.pendingMutation.name !== name || JSON.stringify(state.pendingMutation.intent) !== JSON.stringify(intent)) {
      throw new AgentError('pending_operation_requires_original');
    }
    return resumeMutation(path, state);
  }
  await refresh(path, state);
  const definition = mutations[name]!, operationId = newOperationId(), key = `manual_${operationId}`;
  const body: Json = { operationId, expectedVersion: name.startsWith('profile-') ? state.profile!.version : state.membership!.version, ...intent };
  if (name.startsWith('profile-')) body.expectedPolicyVersion = state.profile!.policyVersion;
  if (name === 'membership-join') body.expectedProfileVersion = state.profile!.version;
  state.commands[key] = { method: definition.method, path: `/v1/agents/${state.agentId}/${definition.suffix}`,
    body, bearer: state.runtimeToken, scope: `agent:${state.agentId}`, action: definition.action, status: 'pending' };
  state.manualControl = true; delete state.pendingReason; state.pendingMutation = { name, intent, key }; await save(path, state);
  return resumeMutation(path, state);
}
function details(path: string, state: State) { return { ...summary(path, state), profileDetails: state.profile, membershipDetails: state.membership }; }

async function handoff(path: string, state: State, output: string, declareDelivered: boolean): Promise<void> {
  if (object(state.management).managementStatus === 'managed'
    || state.commands.registration!.result?.managementStatus === 'managed') return;
  const pending = Object.entries(state.commands).find(([, command]) => command.action === 'issueHandoff' && command.status === 'pending');
  if (pending) {
    const [key, command] = pending;
    const issued = await execute(path, state, key);
    state.handoff = { token: String(command.body.handoffToken), generation: Number(issued.generation),
      handoffId: String(issued.handoffId), expiresAt: Number(issued.expiresAt) };
    await save(path, state);
  }
  if (!state.handoff || state.handoff.expiresAt <= Date.now()) {
    const generation = Number(object(state.management).generation ?? state.handoff?.generation ?? 0);
    const key = `handoff_${generation + 1}`;
    if (!state.commands[key]) {
      const token = newCredential('handoff');
      await prepare(path, state, key, { method: 'POST', path: '/v1/agent/self/handoffs', bearer: state.continuationToken,
        scope: `bootstrap:${state.continuationToken.split('.')[0]}`, action: 'issueHandoff',
        body: { operationId: newOperationId(), expectedGeneration: generation, handoffToken: token } });
    }
    const issued = await execute(path, state, key);
    state.handoff = { token: String(state.commands[key]!.body.handoffToken), generation: Number(issued.generation),
      handoffId: String(issued.handoffId), expiresAt: Number(issued.expiresAt) };
    await save(path, state);
  }
  if (output === path) throw new AgentError('invalid_output_path');
  try {
    const previous = await readPrivateJson(output);
    if (previous.format !== 'connet-handoff-v1' || previous.agentId !== state.agentId) throw new AgentError('output_file_conflict');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const url = new URL('/owner', state.origin); url.hash = `handoff=${state.handoff.token}`;
  await writePrivateJson(output, { format: 'connet-handoff-v1', url: url.href, agentId: state.agentId,
    ownerId: state.ownerId, generation: state.handoff.generation, expiresAt: state.handoff.expiresAt });
  state.handoff.privateFile = output; await save(path, state);
  if (declareDelivered) await prepare(path, state, `delivery_${state.handoff.generation}`, {
    method: 'POST', path: '/v1/agent/self/delivery-declarations', bearer: state.runtimeToken,
    scope: `agent:${state.agentId}`, action: 'declareDelivery', body: { operationId: newOperationId(), generation: state.handoff.generation },
  });
  await refresh(path, state);
}

function summary(path: string, state: State) {
  return { instanceId: state.instanceId, apiVersion: state.apiVersion, documentationVersion: state.documentationVersion,
    agentId: state.agentId ?? null, ownerId: state.ownerId ?? null, profileUrl: state.profileUrl ?? null,
    registration: state.commands.registration?.status === 'committed' ? 'completed' : 'pending',
    profile: state.profile?.published ? 'published' : state.manualControl ? 'unpublished' : 'pending', membership: state.membership?.state ?? 'unknown',
    managementStatus: state.management?.managementStatus ?? state.commands.registration?.result?.managementStatus ?? 'unknown',
    deliveryStatus: state.management?.deliveryDeclaredAt ? 'client_declared_delivered' : state.handoff ? 'generated' : 'not_generated',
    local_setup: 'saved', schedule_configuration: 'not_configured', periodic_run_verification: 'not_verified',
    pendingReason: state.pendingReason ?? null,
    pendingOperation: state.pendingMutation ? { name: state.pendingMutation.name, operationId: state.commands[state.pendingMutation.key]?.body.operationId,
      scope: state.commands[state.pendingMutation.key]?.scope, action: state.commands[state.pendingMutation.key]?.action } : null,
    privateStateFile: path, privateHandoffFile: state.handoff?.privateFile ?? null };
}

export async function runAgent(args: string[]): Promise<Json> {
  const command = args[0];
  const publicReads = ['avatar-catalog', 'capabilities'], reads = ['profile-read', 'membership-read'];
  if (!['onboard', 'status', 'handoff', 'import-runtime', ...publicReads, ...reads, ...Object.keys(mutations)].includes(command ?? '')) throw new AgentError('invalid_command');
  const options: Record<string, string> = {};
  let declareDelivered = false;
  const allowed = ['--url', '--state', '--name', '--bio', '--color', '--invite-file', '--runtime-file', '--out', '--input-file', '--fields'];
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--declare-delivered') { declareDelivered = true; continue; }
    if (!allowed.includes(key) || options[key] !== undefined || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new AgentError('invalid_arguments');
    options[key] = args[++i]!;
  }
  if (publicReads.includes(command!) || reads.includes(command!) || command! in mutations) {
    const accepted = ['--url', '--state', ...(command === 'profile-update' ? ['--input-file'] : []), ...(command === 'profile-clear' ? ['--fields'] : [])];
    if (declareDelivered || Object.keys(options).some(key => !accepted.includes(key))) throw new AgentError('invalid_arguments');
  }
  if (!options['--state']) {
    if (!publicReads.includes(command!) || !options['--url']) throw new AgentError('state_path_required');
    const base = origin(options['--url']), capabilities = await http(base, 'GET', '/v1/capabilities');
    if (capabilities.apiVersion !== 'v1' || typeof capabilities.instanceId !== 'string') throw new AgentError('unsupported_instance');
    return command === 'capabilities' ? capabilities : { instanceId: capabilities.instanceId, apiVersion: 'v1', catalog: await http(base, 'GET', '/v1/avatar-catalog') };
  }
  const path = resolve(options['--state']);
  const release = await lockState(path);
  try {
    let state: State;
    try { state = await readPrivateJson(path) as unknown as State; } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      if (command !== 'onboard' || !options['--url'] || !options['--name']) throw new AgentError('onboard_configuration_required');
      const base = origin(options['--url']);
      const capabilities = await http(base, 'GET', '/v1/capabilities');
      if (capabilities.apiVersion !== 'v1' || typeof capabilities.instanceId !== 'string') throw new AgentError('unsupported_instance');
      const catalog = await http(base, 'GET', '/v1/avatar-catalog');
      const templates = Array.isArray(catalog.templates) ? catalog.templates.map(object) : [];
      const basic = templates.find(template => template.id === 'basic');
      const name = options['--name'], bio = options['--bio'] ?? '', color = options['--color'] ?? 'blue';
      if (name.length > 60 || !name.trim() || bio.length > 500 || /[\u0000-\u001f\u007f]/u.test(name + bio)
        || !Array.isArray(basic?.colors) || !basic.colors.includes(color)) throw new AgentError('invalid_profile_input');
      const material = newAgentMaterial();
      let inviteToken: string | undefined;
      if (options['--invite-file']) {
        const invite = await readPrivateJson(resolve(options['--invite-file']));
        if (invite.origin !== undefined && invite.origin !== base) throw new AgentError('instance_or_identity_mismatch');
        if (typeof invite.inviteToken !== 'string') throw new AgentError('invite_file_invalid');
        inviteToken = invite.inviteToken;
      }
      state = { format: 'connet-agent-v1', origin: base, instanceId: capabilities.instanceId, apiVersion: 'v1', documentationVersion: 'v1',
        runtimeToken: material.runtimeToken, continuationToken: material.continuationToken,
        fields: { displayName: name, bio, avatar: { template: 'basic', color } },
        commands: { registration: { method: 'POST', path: '/v1/registrations', scope: `registration:${material.attemptId}`, action: 'register',
          status: 'pending', body: { operationId: newOperationId(), ...material, ...(inviteToken ? { inviteToken } : {}) } } } };
      await writePrivateJson(path, state, true);
    }
    validateState(state);
    if ((options['--url'] && origin(options['--url']) !== state.origin)
      || (options['--name'] && options['--name'] !== state.fields.displayName)
      || (options['--bio'] && options['--bio'] !== state.fields.bio)
      || (options['--color'] && options['--color'] !== object(state.fields.avatar).color)) throw new AgentError('configuration_mismatch');
    const capabilities = await http(state.origin, 'GET', '/v1/capabilities');
    if (capabilities.instanceId !== state.instanceId || capabilities.apiVersion !== 'v1') throw new AgentError('instance_or_identity_mismatch');
    if (publicReads.includes(command!)) return command === 'capabilities' ? capabilities
      : { instanceId: state.instanceId, apiVersion: 'v1', catalog: await http(state.origin, 'GET', '/v1/avatar-catalog') };
    if (command === 'import-runtime') {
      if (!options['--runtime-file'] || !state.agentId) throw new AgentError('runtime_file_required');
      const replacement = await readPrivateJson(resolve(options['--runtime-file']));
      if (replacement.format !== 'connet-runtime-v1' || replacement.origin !== state.origin
        || replacement.agentId !== state.agentId || typeof replacement.runtimeToken !== 'string') throw new AgentError('instance_or_identity_mismatch');
      const self = await http(state.origin, 'GET', '/v1/agent/self', undefined, replacement.runtimeToken);
      if (self.instanceId !== state.instanceId || self.agentId !== state.agentId) throw new AgentError('instance_or_identity_mismatch');
      if (typeof self.ownerId === 'string') state.ownerId = self.ownerId;
      const previous = state.runtimeToken;
      state.runtimeToken = replacement.runtimeToken;
      for (const saved of Object.values(state.commands)) if (saved.bearer === previous) saved.bearer = state.runtimeToken;
      state.profile = object(self.profile); state.membership = object(self.membership); state.management = object(self.management);
      state.profileUrl = typeof self.profileUrl === 'string' ? self.profileUrl : `/residents/${state.agentId}`;
      await save(path, state);
      return summary(path, state);
    }
    if (reads.includes(command!) || command! in mutations) {
      if (!state.agentId || state.commands.registration?.status !== 'committed') throw new AgentError('registration_required');
      if (reads.includes(command!)) {
        await refresh(path, state);
        const resource = command === 'profile-read' ? 'profile' : 'membership';
        const result = await http(state.origin, 'GET', `/v1/agents/${state.agentId}/${resource}`, undefined, state.runtimeToken);
        if (result.agentId !== state.agentId) throw new AgentError('instance_or_identity_mismatch');
        state[resource] = result; await save(path, state); return details(path, state);
      }
      const intent = await mutationIntent(command!, options, state), result = await mutate(path, state, command!, intent);
      return { ...details(path, state), operation: { operationId: result.operationId, outcome: result.outcome, receiptId: result.receiptId,
        ...(typeof result.changed === 'boolean' ? { changed: result.changed } : {}) } };
    }
    if (state.pendingMutation) {
      if (!['status', 'onboard'].includes(command!)) throw new AgentError('pending_operation_requires_original');
      await resumeMutation(path, state); return details(path, state);
    }
    if (state.manualControl) {
      await refresh(path, state);
      if (command === 'handoff') await handoff(path, state, resolve(options['--out'] ?? state.handoff?.privateFile ?? `${path}.handoff.json`), declareDelivered);
      return summary(path, state);
    }
    await initialize(path, state);
    await handoff(path, state, resolve(options['--out'] ?? state.handoff?.privateFile ?? `${path}.handoff.json`), declareDelivered);
    return summary(path, state);
  } finally { await release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  runAgent(process.argv.slice(2)).then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); }).catch(error => {
    process.stderr.write(`${error instanceof AgentError ? error.code : 'local_operation_failed'}; retain the private state and retry the same command.\n`);
    process.exitCode = 1;
  });
}
