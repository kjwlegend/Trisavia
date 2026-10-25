/** Finite HTTP checks for the already-owned, isolated 18958 Avatar fixture.
 * Executed by D with D's existing private Owner/A002 context; B never receives those credentials.
 * No registration, binding change, Life action, welcome claim, database, service or model operation.
 * node scripts/avatar-http-acceptance.ts --self-check  # offline: zero HTTP/files
 * Execution requires TD's exact reviewed candidate/resource authorization; flags are in --help.
 * D supplies one 0600 JSON: {format:'trisavia-avatar-http-auth-v1',instanceId,recoveryEpoch,
 * agentId:the original A002,ownerSessionToken:own session,runtimeToken:own runtime}.
 * B's separate verify-other phase reads B's original A001 private-state.json without rewriting it.
 * Use the same run ID/task after an unknown result. Website preview/apply/movement and the
 * controlled service restart have separate evidence; this tool does not perform those actions.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ObjectValue = Record<string, any>;
type Target = { baseUrl: string; sourceCommit: string; instanceId: string; recoveryEpoch: string; runId: string; authFile: string; taskId: string; phase: string; assetId?: string };
type Auth = { format: 'trisavia-avatar-http-auth-v1'; instanceId: string; recoveryEpoch: string; agentId: string; ownerSessionToken: string; runtimeToken: string };
const root = fileURLToPath(new URL('../', import.meta.url));
const instance = 'instance_ebd77200-9ad5-4816-82fb-664044ffa570';
const epoch = 'epoch_683a63fc-95df-4531-96fc-0f5da7683f05';
const phases = ['upload', 'verify-applied', 'verify-retired', 'verify-other'];
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

function targetFrom(args: string[]): Target {
  check(args[0] === '--execute', 'explicit_execute_required');
  const allowed = new Set(['--base-url', '--source-sha', '--expected-instance', '--expected-epoch', '--run-id', '--auth-file', '--task-id', '--phase', '--asset-id']);
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]!, value = args[index + 1];
    check(allowed.has(key) && !values.has(key) && value && !value.startsWith('--'), 'invalid_arguments');
    values.set(key, value);
  }
  check(values.size === 8 || values.size === 9 && values.has('--asset-id'), 'all_target_arguments_required');
  const baseUrl = values.get('--base-url')!;
  check(baseUrl === 'http://127.0.0.1:18958', 'only_original_isolated_loopback_fixture');
  const sourceCommit = values.get('--source-sha')!, instanceId = values.get('--expected-instance')!, recoveryEpoch = values.get('--expected-epoch')!;
  check(/^[a-f0-9]{40}$/.test(sourceCommit), 'full_source_sha_required');
  check(instanceId === instance && recoveryEpoch === epoch, 'original_paired_identity_required');
  const runId = values.get('--run-id')!, authFile = values.get('--auth-file')!, taskId = values.get('--task-id')!, phase = values.get('--phase')!;
  check(/^[a-z0-9][a-z0-9-]{7,79}$/.test(runId), 'stable_run_id_required');
  check(isAbsolute(authFile) && /^[A-Za-z0-9_-]{8,100}$/.test(taskId) && phases.includes(phase), 'private_context_task_and_phase_required');
  const assetId = values.get('--asset-id');
  check(phase !== 'verify-other' || assetId && /^[A-Za-z0-9_-]{8,100}$/.test(assetId), 'observer_requires_explicit_asset_locator');
  return { baseUrl, sourceCommit, instanceId, recoveryEpoch, runId, authFile, taskId, phase, ...(assetId ? { assetId } : {}) };
}

async function privateJson(path: string): Promise<ObjectValue> {
  const info = await lstat(path);
  check(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 && info.size <= 2_000_000, 'private_file_required');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function saveJson(path: string, value: ObjectValue) {
  await writeFile(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(path + '.tmp', path);
}
function validateAuth(value: ObjectValue, target: Target): asserts value is Auth {
  check(value.format === 'trisavia-avatar-http-auth-v1' && value.instanceId === target.instanceId && value.recoveryEpoch === target.recoveryEpoch, 'auth_context_target_mismatch');
  check(value.agentId === '2240d64c-7ab4-42fd-9c3a-a1caad7c58cc', 'original_owned_a002_required');
  for (const key of ['ownerSessionToken', 'runtimeToken']) check(typeof value[key] === 'string' && value[key].length >= 20 && !/[\r\n\x00]/.test(value[key]), 'private_existing_bearer_required');
}

class Client {
  requests = 0;
  readonly target: Target;
  readonly evidence: ObjectValue;
  constructor(target: Target, evidence: ObjectValue) { this.target = target; this.evidence = evidence; }
  async call(method: string, path: string, token?: string, body?: ObjectValue): Promise<{ status: number; body: ObjectValue; bytes: Buffer; cacheControl: string }> {
    check(++this.requests <= 40, 'finite_request_budget_exceeded');
    check(path === '/health' || path.startsWith('/v1/'), 'only_named_http_api');
    const url = new URL(path, this.target.baseUrl);
    check(url.origin === this.target.baseUrl && !url.username && !url.password && !url.hash, 'same_origin_required');
    const at = Date.now();
    let status = 0;
    try {
      const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      status = response.status;
      const bytes = Buffer.from(await response.arrayBuffer()); check(bytes.length <= 3 * 1024 * 1024, 'bounded_response_required');
      const contentType = response.headers.get('content-type') ?? '';
      return { status, body: contentType.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : {}, bytes, cacheControl: response.headers.get('cache-control') ?? '' };
    } finally { this.evidence.requests.push({ method, path, status, at, endedAt: Date.now() }); }
  }
}

function markFailure(evidence: ObjectValue, code: string, at: number) {
  const failure = { code, at }; evidence.status = 'failed'; evidence.failure ??= failure;
  evidence.failures ??= []; evidence.failures.push(failure); return failure;
}
function completePhase(evidence: ObjectValue, phase: string, observation: ObjectValue) {
  evidence.phases ??= {}; evidence.phases[phase] = observation;
  evidence.phaseHistory ??= []; evidence.phaseHistory.push({ phase, ...observation });
  evidence.status = evidence.failure || evidence.failures?.length ? 'failed' : 'observed';
}

async function recoverUploadedDraft(client: Client, prefix: string, token: string, input: ObjectValue) {
  const path = `${prefix}/receipts/${input.operationId}?action=avatar_assets.drafts.create`;
  let recovered = await client.call('GET', path, token);
  if (recovered.status === 404) {
    try { await client.call('POST', `${prefix}/drafts`, token, input); } catch { /* Read the same operation after a lost response. */ }
    recovered = await client.call('GET', path, token);
  }
  return recovered;
}

async function selfCheck() {
  const base = ['--execute', '--base-url', 'http://127.0.0.1:18958', '--source-sha', 'a'.repeat(40), '--expected-instance', instance, '--expected-epoch', epoch, '--run-id', 'avatar-http-offline', '--auth-file', '/private/test.json', '--task-id', 'task-offline', '--phase', 'upload'];
  assert.equal(targetFrom(base).phase, 'upload');
  for (const bad of ['http://127.0.0.1:18893', 'http://localhost:18958', 'http://127.0.0.1:18958?x=1', 'https://trisavia.kjwlabs.com']) assert.throws(() => targetFrom(base.map(value => value === 'http://127.0.0.1:18958' ? bad : value)));
  assert.throws(() => targetFrom(base.map(value => value === epoch ? 'another-epoch' : value)));
  const failed: ObjectValue = {}; markFailure(failed, 'original_condition_failed', 1);
  const restored = JSON.parse(JSON.stringify(failed)); completePhase(restored, 'verify-applied', { valid: true });
  assert.equal(restored.status, 'failed'); assert.deepEqual(restored.failure, { code: 'original_condition_failed', at: 1 });
  const savedFetch = globalThis.fetch, calls: Array<{ path: string; method: string; body: any }> = [], evidence: ObjectValue = { requests: [] };
  const input = { operationId: 'offline-original-operation', taskId: 'offline-task', expectedTaskVersion: 1, kind: 'avatar', files: [] };
  try {
    globalThis.fetch = (async (url: any, init: any) => {
      const path = new URL(String(url)).pathname + new URL(String(url)).search;
      calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (calls.length === 1) return new Response(JSON.stringify({ error: { code: 'target_not_accessible' } }), { status: 404, headers: { 'content-type': 'application/json' } });
      if (calls.length === 2) throw new Error('offline simulated response loss');
      return new Response(JSON.stringify({ protocolVersion: 1, instanceId: instance, data: { key: { commandId: input.operationId }, result: { draft: { assetId: 'offline-asset' } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const client = new Client(targetFrom(base), evidence);
    const result = await recoverUploadedDraft(client, '/v1/agents/offline/avatar-assets', 'offline-private-bearer', input);
    assert.equal(result.status, 200); assert.equal(result.body.data.key.commandId, input.operationId);
    assert.equal(calls.length, 3); assert.deepEqual(calls[1]!.body, input); assert.equal(calls[0]!.path, calls[2]!.path);
    assert.deepEqual(evidence.requests.map((entry: ObjectValue) => entry.status), [404, 0, 200]);
    assert(!JSON.stringify(evidence).includes('offline-private-bearer'));
    client.requests = 40; await assert.rejects(client.call('GET', '/health'), /finite_request_budget_exceeded/);
    assert.equal(calls.length, 3, 'request budget rejects before transport');
  } finally { globalThis.fetch = savedFetch; }
  console.info(JSON.stringify({ status: 'passed', mode: 'offline-arguments-recovery-checkpoint-check', networkRequests: 0, simulatedRequests: 3, filesWritten: 0 }));
}

async function execute(target: Target): Promise<void> {
  check(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() === target.sourceCommit, 'checkout_not_expected_candidate');
  execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: root, stdio: 'ignore' });
  const auth = await privateJson(target.authFile);
  const observer = target.phase === 'verify-other';
  if (observer) {
    check(auth.version === 1 && auth.agentId === 'ff2ac518-37cd-423d-bb90-f8b7b6db74aa' && auth.target?.instanceId === instance && auth.target?.recoveryEpoch === epoch && typeof auth.runtimeToken === 'string', 'original_a001_private_context_required');
  } else validateAuth(auth, target);
  const { phase: _phase, authFile: _authFile, assetId: _assetId, ...runTarget } = target;
  const directory = join(root, 'outputs/avatar-http', target.runId + (observer ? '-observer' : ''));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stateFile = join(directory, 'private-state.json'), evidenceFile = join(directory, 'evidence.json');
  const exists = async (path: string) => { try { return await privateJson(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } };
  const state = await exists(stateFile) ?? { version: 1, target: runTarget, operationId: randomUUID() };
  assert.deepEqual(state.target, runTarget, 'original_run_target_must_match');
  const evidence = await exists(evidenceFile) ?? { version: 1, target: runTarget, status: 'running', requests: [], phases: {}, boundaries: { existingIdentitiesOnly: true, publicOriginalSample: true, modelGeneration: false, submitResponseDiscardedByClient: true, serverUnknownCommitInjection: false, ownerApplicationByWebsite: true, databaseAccess: false, lifecycleOperations: false, lifeActions: false } };
  const save = async () => { await saveJson(stateFile, state); await saveJson(evidenceFile, evidence); };
  await save();
  const client = new Client(target, evidence), agentId = '2240d64c-7ab4-42fd-9c3a-a1caad7c58cc', prefix = `/v1/agents/${agentId}/avatar-assets`;
  const unbox = (response: Awaited<ReturnType<Client['call']>>) => {
    check(response.status === 200 && response.body.protocolVersion === 1 && response.body.instanceId === target.instanceId && response.body.data && typeof response.body.data === 'object', 'gateway_response_invalid');
    return response.body.data as ObjectValue;
  };
  const ok = async (method: string, path: string, token?: string, body?: ObjectValue) => unbox(await client.call(method, path, token, body));
  const requirePrivateRejection = (reply: Awaited<ReturnType<Client['call']>>, anonymous = false) => {
    check(reply.status === 404 || reply.status === 403 || anonymous && reply.status === 401, 'private_material_exposed');
    check(typeof reply.body.error?.code === 'string' && reply.body.data === undefined && reply.body.task === undefined && reply.body.draft === undefined, 'private_content_in_rejection');
  };
  try {
    const health = await client.call('GET', '/health');
    check(health.status === 200 && health.body.instanceId === target.instanceId && health.body.appVersion === '0.4.0' && health.body.worldCore === 'ready', 'approved_avatar_service_required');
    const self = await client.call('GET', '/v1/agent/self', auth.runtimeToken);
    check(self.status === 200 && self.body.agentId === (observer ? 'ff2ac518-37cd-423d-bb90-f8b7b6db74aa' : agentId), 'original_actor_authentication_required');
    if (observer) {
      const taskReply = await client.call('GET', `${prefix}/tasks/${target.taskId}`, auth.runtimeToken);
      const draftReply = await client.call('GET', `${prefix}/drafts/${target.assetId}`, auth.runtimeToken);
      const fileReply = await client.call('GET', `${prefix}/drafts/${target.assetId}/files/idle.png`, auth.runtimeToken);
      for (const reply of [taskReply, draftReply, fileReply]) requirePrivateRejection(reply);
      completePhase(evidence, target.phase, { at: Date.now(), taskStatus: taskReply.status, draftStatus: draftReply.status, fileStatus: fileReply.status });
    } else {
      const profilePath = `/v1/agents/${agentId}/profile`;
      const profileReply = await client.call('GET', profilePath, auth.ownerSessionToken);
      check(profileReply.status === 200 && Number.isSafeInteger(profileReply.body.version) && Number.isSafeInteger(profileReply.body.publishedVersion), 'current_owner_profile_required');
      const profile = profileReply.body;
      if (target.phase === 'upload') {
        const capabilities = await client.call('GET', '/v1/capabilities');
        check(capabilities.status === 200 && capabilities.body.instanceId === target.instanceId && capabilities.body.gateway?.discovery?.path === '/v1/gateway/discovery', 'real_capabilities_required');
        const discovery = await ok('GET', '/v1/gateway/discovery');
        check(Array.isArray(discovery.operations), 'real_discovery_required');
        check(discovery.operations.some((entry: ObjectValue) => entry.id === 'avatar_assets.spec'), 'avatar_module_not_discoverable');
        const specification = await ok('GET', '/v1/avatar-assets/spec');
        check(specification.version === 1 && specification.httpOperations?.some((entry: ObjectValue) => entry.action === 'avatar_assets.drafts.create' && entry.method === 'POST' && entry.path === '/v1/agents/:agentId/avatar-assets/drafts'), 'discovered_upload_contract_invalid');
        const specOperation = discovery.operations.find((entry: ObjectValue) => entry.id === 'avatar_assets.spec');
        check(typeof specOperation.usageGuide?.path === 'string', 'exact_avatar_guide_not_discovered');
        const guide = await ok('GET', specOperation.usageGuide.path);
        check(guide.digestAlgorithm === 'sha256-utf8-hex' && sha(Buffer.from(guide.canonicalDocument)) === guide.digest && canonical(guide.document) === guide.canonicalDocument, 'exact_avatar_guide_digest_invalid');
        const taskResult = await ok('GET', `${prefix}/tasks/${target.taskId}`, auth.runtimeToken), task = taskResult.task;
        check(task?.taskId === target.taskId && task.agentId === agentId && task.state === 'active' && Number.isSafeInteger(task.version), 'current_owner_task_required');
        const materials = await ok('GET', `${prefix}/drafts?taskId=${encodeURIComponent(target.taskId)}&limit=20`, auth.runtimeToken);
        check(Array.isArray(materials.drafts) && materials.drafts.every((entry: ObjectValue) => entry.taskId === target.taskId), 'task_material_scope_invalid');
        const reference = materials.drafts.find((entry: ObjectValue) => entry.kind === 'reference');
        let referenceRead: ObjectValue = { present: false, read: false };
        if (reference) {
          const file = reference.files?.[0];
          check(reference.files.length === 1 && ['reference.png', 'reference.jpg'].includes(file?.name) && file.path === `${prefix}/drafts/${reference.assetId}/files/${file.name}`, 'reference_material_binding_invalid');
          const read = await client.call('GET', file.path, auth.runtimeToken);
          check(read.status === 200 && sha(read.bytes) === file.sha256 && read.bytes.length === file.bytes, 'task_private_reference_read_failed');
          requirePrivateRejection(await client.call('GET', file.path), true);
          referenceRead = { present: true, read: true, assetId: reference.assetId, name: file.name, sha256: file.sha256, bytes: file.bytes };
        }
        const source = join(root, 'apps/web/public/avatar-authoring/v1');
        if (!state.input) {
          const manifest = JSON.parse(await readFile(join(source, 'sample.manifest.json'), 'utf8'));
          const files = await Promise.all(['idle.png', 'walk.png'].map(async name => ({ name, dataBase64: (await readFile(join(source, name))).toString('base64') })));
          state.input = { operationId: state.operationId, taskId: target.taskId, expectedTaskVersion: task.version, kind: 'avatar', manifest, files };
          state.before = { profileVersion: profile.version, publishedVersion: profile.publishedVersion, appearance: profile.published?.avatar };
          await save(); // Original command is durable before the first submit.
        }
        const recovered = await recoverUploadedDraft(client, prefix, auth.runtimeToken, state.input);
        const receipt = unbox(recovered), draft = receipt.result?.draft;
        check(receipt.key?.commandId === state.operationId && receipt.key?.action === 'avatar_assets.drafts.create' && receipt.key?.principal?.id === agentId && receipt.key?.recoveryEpoch === epoch && receipt.outcome === 'committed', 'original_receipt_not_committed');
        check(draft?.taskId === target.taskId && draft.agentId === agentId && draft.version === 1 && draft.kind === 'avatar' && draft.validation?.valid === true && draft.validation.errors.length === 0 && typeof draft.assetId === 'string', 'real_draft_validation_failed');
        const replay = await ok('POST', `${prefix}/drafts`, auth.runtimeToken, state.input);
        assert.deepEqual(replay, receipt, 'same_operation_changed_receipt');
        const detail = await ok('GET', `${prefix}/drafts/${draft.assetId}`, auth.runtimeToken);
        check(detail.draft?.assetId === draft.assetId && detail.draft.validation?.valid === true, 'saved_draft_unavailable');
        check(detail.draft.files.length === 2, 'unexpected_sample_files');
        for (const file of detail.draft.files) {
          check(['idle.png', 'walk.png'].includes(file.name) && file.path === `${prefix}/drafts/${draft.assetId}/files/${file.name}`, 'private_file_binding_invalid');
          const bytes = await client.call('GET', file.path, auth.runtimeToken);
          check(bytes.status === 200 && sha(bytes.bytes) === file.sha256 && bytes.bytes.length === file.bytes, 'private_png_bytes_changed');
          requirePrivateRejection(await client.call('GET', file.path), true);
        }
        const after = await client.call('GET', profilePath, auth.ownerSessionToken);
        check(after.body.publishedVersion === state.before.publishedVersion && canonical(after.body.published?.avatar) === canonical(state.before.appearance), 'draft_changed_public_appearance');
        // Persist the checkpoint only after receipt, validation, private bytes and public state all pass.
        state.assetId = draft.assetId; state.uploadVerified = true;
        completePhase(evidence, target.phase, { at: Date.now(), assetId: draft.assetId, operationId: state.operationId, valid: true, idempotentReplay: true, originalReceiptRecovered: true, appearanceUnchanged: true, guideDigest: guide.digest, referenceRead });
      } else {
        check(state.uploadVerified === true && typeof state.assetId === 'string', 'original_verified_upload_required');
        const appearance = profile.published?.avatar;
        if (target.phase === 'verify-applied') {
          check(appearance?.kind === 'custom' && appearance.assetId === state.assetId && appearance.version === 1 && /^[a-f0-9]{64}$/.test(appearance.digest), 'owner_has_not_applied_this_draft');
          check(profile.publishedVersion === state.before.publishedVersion + 1, 'owner_publication_version_invalid');
          const publicProfile = await client.call('GET', `/v1/public/agents/${agentId}`);
          assert.deepEqual(publicProfile.body.profile?.avatar, appearance, 'public_profile_uses_another_appearance');
          const document = await client.call('GET', appearance.manifestUrl);
          check(document.status === 200 && document.cacheControl.includes('no-store') && sha(Buffer.from(canonical(document.body))) === appearance.digest, 'public_document_digest_or_cache_invalid');
          assert.deepEqual(document.body.manifest, state.input.manifest);
          check(document.body.files?.length === 2, 'public_document_files_invalid');
          for (const file of document.body.files) {
            check(['idle.png', 'walk.png'].includes(file.name) && file.url === `/v1/avatar-assets/public/${state.assetId}/1/${file.sha256}/${file.name}`, 'public_file_binding_invalid');
            const png = await client.call('GET', file.url);
            check(png.status === 200 && png.cacheControl.includes('no-store') && sha(png.bytes) === file.sha256 && png.bytes.length === file.bytes, 'public_png_bytes_changed');
          }
          if (state.applied) assert.deepEqual(state.applied, { appearance, publishedVersion: profile.publishedVersion }, 'restart_or_refresh_changed_applied_version');
          state.applied = { appearance, publishedVersion: profile.publishedVersion };
          completePhase(evidence, target.phase, { at: Date.now(), assetId: state.assetId, publishedVersion: profile.publishedVersion, digest: appearance.digest, publicBytesVerified: true, lifecycleAndMovementEvidence: 'recorded separately by B lifecycle and D UI' });
        } else {
          check(state.applied?.appearance?.assetId === state.assetId && appearance?.assetId !== state.assetId, 'owner_has_not_retired_the_applied_draft');
          check((await client.call('GET', state.applied.appearance.manifestUrl)).status === 404, 'retired_public_document_still_readable');
          for (const file of state.input.files) {
            const url = `/v1/avatar-assets/public/${state.assetId}/1/${sha(Buffer.from(file.dataBase64, 'base64'))}/${file.name}`;
            check((await client.call('GET', url)).status === 404, 'retired_public_png_still_readable');
          }
          completePhase(evidence, target.phase, { at: Date.now(), assetId: state.assetId, retiredBy: appearance?.kind === 'custom' ? 'owner-replacement' : 'owner-builtin-restore', newAnonymousReadsRejected: true });
        }
      }
    }
    await save();
    console.info(JSON.stringify({ runId: target.runId, phase: target.phase, status: evidence.status, requests: client.requests, assetId: state.assetId ?? target.assetId ?? null }));
    if (evidence.status === 'failed') process.exitCode = 1;
  } catch {
    markFailure(evidence, 'phase_acceptance_failed', Date.now());
    await writeFile(join(directory, `failure-${Date.now()}-${randomUUID()}.json`), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await save(); throw new Error('retained_avatar_run_failed');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-check') await selfCheck();
  else if (args.length === 1 && args[0] === '--help') console.info('Existing private auth context only; --execute --phase upload|verify-applied|verify-retired --base-url http://127.0.0.1:18958 --source-sha <40hex> --expected-instance <original> --expected-epoch <original> --run-id <stable-id> --auth-file /absolute/0600.json --task-id <existing-owner-task>. B alone may use --phase verify-other --asset-id <D-provided-nonsecret-id> with B original A001 file. Owner uses the website to preview/confirm; the runner never applies, registers or starts a server.');
  else await execute(targetFrom(args));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('avatar_http_check_failed; retain the original context, operation and evidence'); process.exitCode = 1; });
