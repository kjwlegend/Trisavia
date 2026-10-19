import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import test from 'node:test';
import { newAgentMaterial, newCredential, newOperationId } from '../../scripts/m1-client.ts';
import { ownerFixture, type Api } from '../../scripts/agent-manager-qa-fixture.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { seedWs02DemoData } from '../../apps/platform/application/perception-seed.ts';
import { publishPerceptionCatalog } from '../../apps/platform/application/perception-catalog.ts';

type Json = Record<string, any>;
const serverEntry = fileURLToPath(new URL('../../apps/platform/server.ts', import.meta.url));
async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function server(directory: string, instanceId = 'agent-process-test', environment: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [serverEntry], { cwd: directory, env: { ...process.env,
    M1_HOST: '127.0.0.1', M1_PORT: '0', M1_DATABASE_PATH: join(directory, 'test.sqlite'),
    M1_IDENTITY_PATH: join(directory, 'identity.json'), M1_INSTANCE_ID: instanceId, M1_RECOVERY_EPOCH: 'agent-test-epoch',
    M1_EMAIL_MODE: 'experience', RESEND_API_KEY: '', M1_EMAIL_FROM: '', M1_PUBLIC_ORIGIN: '', M1_EMAIL_CODE_SECRET: '', ...environment,
  }, stdio: 'pipe' });
  let address = '';
  try {
    address = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Test service startup timed out')), 8000);
      child.stdout.on('data', chunk => {
        output += String(chunk);
        const match = /M1 backend listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(match[1]!); }
      });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Test service exited before readiness')); });
      child.once('error', () => { clearTimeout(timer); reject(new Error('Test service could not start')); });
    });
    return { child, address };
  } catch (error) { await stop(child); throw error; }
}
async function cli(directory: string, args: string[], preload?: string) {
  const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), join(directory, 'downloaded-agent.ts'), ...args], { cwd: directory, stdio: 'pipe' });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  const [code] = await once(child, 'exit'); clearTimeout(timer);
  return { code: Number(code), stdout, stderr };
}
async function download(directory: string, origin: string) {
  const response = await fetch(`${origin}/agent/m1-agent.ts`);
  assert.equal(response.status, 200);
  const source = await response.text();
  assert(!/from\s+['"](?!node:)/.test(source), 'Downloaded client must have no project/package imports');
  await writeFile(join(directory, 'downloaded-agent.ts'), source, { mode: 0o600 });
}
async function json(path: string): Promise<Json> { return JSON.parse(await readFile(path, 'utf8')); }
async function api(origin: string, method: string, path: string, body?: Json, token?: string): Promise<Json> {
  const response = await fetch(`${origin}${path}`, { method, headers: {
    ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, 200, `Unexpected API status for ${method} ${path}`);
  return response.json() as Promise<Json>;
}
function safeOutput(output: string, state: Json) {
  for (const token of [state.runtimeToken, state.continuationToken, state.handoff?.token, state.assistance?.token,
    ...Object.values(state.commands ?? {}).map((value: any) => value.body?.assistanceToken)].filter(Boolean)) {
    assert(!output.includes(token), 'CLI output must not contain a proof');
    assert(!output.includes(token.split('.')[1]), 'CLI output must not contain the secret segment');
  }
}
async function initializeOwner(origin: string, state: Json) {
  const setupToken = newCredential('setup'), sessionToken = newCredential('session'), recoveryToken = newCredential('recovery');
  const preview = await api(origin, 'GET', `/v1/owner-handoffs/${state.handoff.token.split('.')[0]}`, undefined, state.handoff.token);
  await api(origin, 'POST', '/v1/owner-setups', { operationId: newOperationId(), setupToken }, state.handoff.token);
  await registerOwner(origin, { attemptId: randomUUID(), password: 'process-test-password',
    username: `Process_${randomUUID().replaceAll('-', '').slice(0, 12)}`, email: `process-${randomUUID()}@example.test`,
    recoveryToken, sessionToken }, { agentId: preview.agentId, expectedGeneration: preview.generation, setupToken });
  return sessionToken;
}

async function registerOwner(origin: string, input: Json, target?: Json) {
  const browserToken = newCredential('browser'), { username, email, credentialsSaved: _saved, ...completion } = input;
  await api(origin, 'POST', '/v1/owner/registration-attempts', { operationId: newOperationId(), attemptId: input.attemptId,
    browserToken, username, email, ...target });
  const sendOperationId = newOperationId();
  await api(origin, 'POST', `/v1/owner/registration-attempts/${input.attemptId}/email-challenges`, { operationId: sendOperationId }, browserToken);
  await api(origin, 'POST', `/v1/owner/registration-attempts/${input.attemptId}/email-verifications`, { operationId: newOperationId(), sendOperationId, code: '1234' }, browserToken);
  return api(origin, 'POST', target ? '/v1/owner/setup/complete' : '/v1/owner/accounts', {
    ...completion, operationId: input.operationId ?? newOperationId(), ...(target?.setupToken ? { setupToken: target.setupToken } : {}),
  }, browserToken);
}

async function privateInput(directory: string, value: Json) {
  const path = join(directory, `input-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(value), { mode: 0o600 }); return path;
}
async function command(directory: string, statePath: string, name: string, args: string[] = []): Promise<Json> {
  const result = await cli(directory, [name, '--state', statePath, ...args]);
  const state = await json(statePath); safeOutput(result.stdout + result.stderr, state);
  assert.equal(result.code, 0, `Reference client ${name} must succeed`);
  return JSON.parse(result.stdout);
}

test('downloaded CLI applies explicit initial public intent once and preserves it through loss and owner races', { timeout: 45_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-manager-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = { M1_EMAIL_MODE: 'experience', RESEND_API_KEY: '', M1_EMAIL_FROM: '', M1_PUBLIC_ORIGIN: '', M1_EMAIL_CODE_SECRET: '' };
  let running = await server(directory, 'manager-cli-isolated', environment), upstream = running.address;
  t.after(() => stop(running.child));
  const writes: { path: string; operationId: string }[] = [];
  let discardProfile = true, beforeFirstRead: ((agentId: string) => Promise<void>) | undefined;
  let afterFirstRead: ((agentId: string) => Promise<void>) | undefined;
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks), path = request.url!;
      const forwarded = await fetch(`${upstream}${path}`, { method: request.method!, headers: {
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), ...(body.length ? { 'content-type': 'application/json' } : {}),
      }, ...(body.length ? { body } : {}) });
      const payload = await forwarded.text();
      if (request.method !== 'GET') writes.push({ path, operationId: JSON.parse(body.toString()).operationId });
      if (path === '/v1/registrations' && forwarded.status === 200 && beforeFirstRead) {
        const change = beforeFirstRead; beforeFirstRead = undefined; await change(JSON.parse(payload).agentId);
      }
      if (path === '/v1/agent/self' && forwarded.status === 200 && afterFirstRead) {
        const change = afterFirstRead; afterFirstRead = undefined; await change(JSON.parse(payload).agentId);
      }
      if (discardProfile && request.method === 'PUT' && /^\/v1\/agents\/[^/]+\/profile$/.test(path) && forwarded.status === 200) {
        discardProfile = false; response.destroy(); return;
      }
      response.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'application/json' }); response.end(payload);
    } catch { response.writeHead(503); response.end('{}'); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => proxy.close(() => resolve())));
  const address = proxy.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  await download(directory, origin);
  const ownerApi: Api = async (method, path, body, token) => {
    const response = await fetch(`${upstream}/v1${path}`, { method, headers: {
      ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as Json };
  };
  const owner = await ownerFixture(ownerApi, 'CLI', async value => { await privateInput(directory, value); });
  async function invite() {
    const inviteToken = newCredential('invite');
    const path = await privateInput(directory, { format: 'connet-invite-v1', origin, ownerId: owner.ownerId, inviteToken });
    await api(upstream, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, owner.sessionToken);
    return path;
  }
  async function ownerEdit(agentId: string, name: string) {
    const profile = await api(upstream, 'GET', `/v1/agents/${agentId}/profile`, undefined, owner.sessionToken);
    return api(upstream, 'PUT', `/v1/agents/${agentId}/profile`, { operationId: newOperationId(), expectedVersion: profile.version,
      expectedPolicyVersion: profile.policyVersion, fields: { displayName: name, bio: 'Owner intent must survive CLI reopening', avatar: { template: 'basic', color: 'cream' } } }, owner.sessionToken);
  }
  const statePath = join(directory, 'initial.json');
  const lost = await cli(directory, ['onboard', '--url', origin, '--state', statePath, '--name', 'Explicit CLI Agent', '--bio', 'Explicit initial biography', '--color', 'coral', '--invite-file', await invite()]);
  assert.equal(lost.code, 1);
  const initial = await json(statePath), saved = initial.commands.initialProfile;
  safeOutput(lost.stdout + lost.stderr, initial);
  assert.equal(saved.status, 'pending'); assert.equal(saved.action, 'saveProfile'); assert.equal(saved.scope, `agent:${initial.agentId}`);
  assert.equal(saved.method, 'PUT'); assert.equal(saved.path, `/v1/agents/${initial.agentId}/profile`);
  assert.equal(saved.body.expectedVersion, 1); assert.equal(saved.body.expectedPolicyVersion, 1); assert.deepEqual(saved.body.fields, initial.fields);
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  let visible = await api(upstream, 'GET', `/v1/public/agents/${initial.agentId}`);
  assert.equal(visible.profile.displayName, 'Explicit CLI Agent'); assert.equal(visible.profile.avatar.color, 'coral'); assert.equal(visible.profile.bio, 'Explicit initial biography');
  await stop(running.child); running = await server(directory, 'manager-cli-isolated', environment); upstream = running.address;
  await command(directory, statePath, 'status');
  const resumed = await json(statePath);
  assert.equal(resumed.commands.initialProfile.status, 'committed'); assert.deepEqual(resumed.commands.initialProfile.body, saved.body);
  assert.equal(writes.filter(write => write.path === saved.path).length, 1, 'A committed lost response is recovered by its receipt, never a second profile write');
  assert.equal(resumed.agentId, initial.agentId); assert.equal(resumed.ownerId, owner.ownerId);
  assert(resumed.runtimeToken === initial.runtimeToken && resumed.continuationToken === initial.continuationToken, 'Reopening preserves both independent Agent proofs');
  const edited = await ownerEdit(initial.agentId, 'Later owner profile');
  const beforeReopen = writes.length;
  await command(directory, statePath, 'status'); await command(directory, statePath, 'onboard');
  visible = await api(upstream, 'GET', `/v1/public/agents/${initial.agentId}`);
  assert.equal(visible.profile.displayName, 'Later owner profile'); assert.equal(visible.profile.avatar.color, 'cream');
  assert.equal((await json(statePath)).profile.version, edited.version); assert.equal(writes.length, beforeReopen, 'Status and repeat onboard do not apply initial intent over a later owner edit');

  const preemptedPath = join(directory, 'owner-first.json');
  beforeFirstRead = agentId => ownerEdit(agentId, 'Owner edited before initialization').then(() => {});
  const preempted = await command(directory, preemptedPath, 'onboard', ['--url', origin, '--name', 'Must not replace owner', '--invite-file', await invite()]);
  const preemptedState = await json(preemptedPath);
  assert.equal(preempted.pendingReason, 'initial_profile_requires_explicit_update'); assert.equal(preemptedState.commands.initialProfile, undefined);
  assert.equal((await api(upstream, 'GET', `/v1/public/agents/${preemptedState.agentId}`)).profile.displayName, 'Owner edited before initialization');

  const racePath = join(directory, 'owner-race.json');
  afterFirstRead = agentId => ownerEdit(agentId, 'Owner wins version race').then(() => {});
  const raced = await command(directory, racePath, 'onboard', ['--url', origin, '--name', 'Stale initial intent', '--invite-file', await invite()]);
  const racedState = await json(racePath), originalRace = racedState.commands.initialProfile;
  assert.equal(raced.pendingReason, 'version_conflict'); assert.equal(originalRace.status, 'pending'); assert.equal(originalRace.body.expectedVersion, 1);
  assert.equal((await command(directory, racePath, 'status')).pendingReason, 'version_conflict');
  const retried = await json(racePath);
  assert.deepEqual(retried.commands.initialProfile.body, originalRace.body);
  assert.equal(retried.commands.initialProfile.scope, originalRace.scope); assert.equal(retried.commands.initialProfile.action, originalRace.action);
  const raceWrites = writes.filter(write => write.path === originalRace.path);
  assert.equal(raceWrites.length, 2); assert(raceWrites.every(write => write.operationId === originalRace.body.operationId), 'A CAS conflict never creates a replacement operation or rebases the saved command');
  assert.equal((await api(upstream, 'GET', `/v1/public/agents/${racedState.agentId}`)).profile.displayName, 'Owner wins version race');
  assert(!writes.some(write => /\/profile\/(draft|publish)$|\/membership\/join$/.test(write.path)), 'Default-public onboarding does not fall back to the former publication workflow');
});

test('downloaded reference client manages its own draft, publication and membership without recreating an identity', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-crud-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child));
  await download(directory, running.address);
  const path = join(directory, 'a1.json'), otherPath = join(directory, 'a2.json');
  await command(directory, path, 'onboard', ['--url', running.address, '--name', 'CRUD A1']);
  await command(directory, otherPath, 'onboard', ['--url', running.address, '--name', 'Untouched A2']);
  const initial = await json(path), other = await json(otherPath);
  const catalogue = await cli(directory, ['avatar-catalog', '--url', running.address]);
  assert.equal(catalogue.code, 0); assert.deepEqual(JSON.parse(catalogue.stdout).catalog.templates[0].colors, ['olive', 'cream', 'blue', 'coral']);
  const capabilities = await cli(directory, ['capabilities', '--url', running.address]); assert.equal(capabilities.code, 0);
  const unpublishOperation = JSON.parse(capabilities.stdout).operations.find((operation: Json) => operation.action === 'unpublishProfile');
  assert.equal(unpublishOperation.method, 'POST'); assert.equal(unpublishOperation.path, '/v1/agents/:agentId/profile/unpublish');
  assert.deepEqual(unpublishOperation.requiredVersions, ['expectedVersion', 'expectedPolicyVersion']);
  const input = await privateInput(directory, { fields: { displayName: 'Updated A1', bio: 'A permitted biography',
    interests: ['reading'], avatar: { template: 'basic', color: 'coral' } } });
  let result = await command(directory, path, 'profile-update', ['--input-file', input]);
  assert.equal(result.profileDetails.draft.displayName, 'Updated A1'); assert.equal(result.profileDetails.published.displayName, 'CRUD A1');
  assert.equal((await command(directory, path, 'profile-read')).profileDetails.draft.avatar.color, 'coral');
  await command(directory, path, 'profile-publish');
  result = await command(directory, path, 'profile-clear', ['--fields', 'bio,interests']);
  assert(!('bio' in result.profileDetails.draft)); assert(!('interests' in result.profileDetails.draft));
  assert.equal(result.profileDetails.draft.displayName, 'Updated A1'); assert.equal(result.profileDetails.draft.avatar.color, 'coral');
  assert.equal(result.profileDetails.published.bio, 'A permitted biography', 'Removing a draft field does not silently publish');
  result = await command(directory, path, 'profile-publish');
  const visible = await api(running.address, 'GET', `/v1/public/agents/${initial.agentId}`);
  assert(!('bio' in visible.profile)); assert(!('interests' in visible.profile));
  const beforeInvalid = await readFile(path, 'utf8');
  for (const field of ['displayName', 'avatar', 'unknown', 'bio,bio']) {
    assert.equal((await cli(directory, ['profile-clear', '--state', path, '--fields', field])).code, 1);
    assert.equal(await readFile(path, 'utf8'), beforeInvalid, 'Invalid removal cannot change local or remote intent');
  }
  const publishedVersion = result.profileDetails.publishedVersion;
  result = await command(directory, path, 'profile-unpublish');
  assert.equal(result.operation.changed, true); assert.equal(result.profileDetails.published, null);
  assert.equal(result.profileDetails.confirmationSource, null); assert.equal(result.profileDetails.publishedVersion, publishedVersion);
  assert.equal(result.membershipDetails.state, 'joined'); assert.equal(result.profileDetails.draft.displayName, 'Updated A1');
  assert.equal((await fetch(`${running.address}/v1/public/agents/${initial.agentId}`)).status, 404);
  assert.equal((await command(directory, path, 'status')).profile, 'unpublished', 'Status must not automatically republish withdrawn data');
  result = await command(directory, path, 'profile-unpublish'); assert.equal(result.operation.changed, false);
  assert.equal((await command(directory, path, 'membership-leave')).membershipDetails.state, 'left');
  assert.equal((await command(directory, path, 'membership-read')).membershipDetails.state, 'left');
  const blocked = await cli(directory, ['membership-join', '--state', path]);
  assert.equal(blocked.code, 1); assert.match(blocked.stderr, /admission_requirements_unmet/);
  await command(directory, path, 'profile-publish');
  assert.equal((await command(directory, path, 'membership-join')).membershipDetails.state, 'joined');
  const final = await json(path), currentOther = await api(running.address, 'GET', '/v1/agent/self', undefined, other.runtimeToken);
  assert.equal(final.agentId, initial.agentId); assert.equal(final.ownerId, initial.ownerId);
  assert(final.runtimeToken === initial.runtimeToken && final.continuationToken === initial.continuationToken, 'CRUD preserves both independent Agent proofs');
  assert.equal(currentOther.profile.version, other.profile.version); assert.equal(currentOther.profile.published.displayName, 'Untouched A2');
  assert.equal(currentOther.membership.version, other.membership.version);
});

test('reference client preserves original CRUD commands across lost responses, restart and cross-Agent receipt checks', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-crud-loss-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let running = await server(directory), upstream = running.address;
  t.after(() => stop(running.child));
  let discard = '', interfere: (() => Promise<void>) | undefined; const writes = new Map<string, number>();
  const proxy = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks), path = request.url!;
    try {
      const forwarded = await fetch(`${upstream}${path}`, { method: request.method!, headers: {
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), ...(body.length ? { 'content-type': 'application/json' } : {}),
      }, ...(body.length ? { body } : {}) });
      const payload = await forwarded.text();
      if (path === '/v1/agent/self' && forwarded.status === 200 && interfere) { const change = interfere; interfere = undefined; await change(); }
      if (request.method !== 'GET') writes.set(path, (writes.get(path) ?? 0) + 1);
      if (discard && path.endsWith(discard) && request.method !== 'GET' && forwarded.status === 200) { discard = ''; response.destroy(); return; }
      response.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'application/json' }); response.end(payload);
    } catch { response.writeHead(503); response.end('{}'); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => proxy.close(() => resolve())));
  const address = proxy.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  await download(directory, origin);
  const path = join(directory, 'a1.json'), otherPath = join(directory, 'a2.json');
  await command(directory, path, 'onboard', ['--url', origin, '--name', 'Loss A1']);
  await command(directory, otherPath, 'onboard', ['--url', origin, '--name', 'Loss A2']);
  const initial = await json(path), other = await json(otherPath);
  const input = await privateInput(directory, { fields: { bio: 'Original complete intent' } });
  const cases = [
    { name: 'profile-update', suffix: '/profile/draft', args: ['--input-file', input] },
    { name: 'profile-unpublish', suffix: '/profile/unpublish', args: [] },
    { name: 'membership-leave', suffix: '/membership/leave', args: [] },
    { name: 'membership-join', suffix: '/membership/join', args: [] },
  ];
  for (const [index, item] of cases.entries()) {
    if (item.name === 'membership-join') await command(directory, path, 'profile-publish');
    const endpoint = `/v1/agents/${initial.agentId}${item.suffix}`, before = writes.get(endpoint) ?? 0;
    discard = item.suffix;
    const lost = await cli(directory, [item.name, '--state', path, ...item.args]);
    assert.equal(lost.code, 1); safeOutput(lost.stdout + lost.stderr, initial);
    const pending = await json(path), key = pending.pendingMutation.key, original = pending.commands[key];
    assert.equal(original.status, 'pending'); assert.equal(original.path, endpoint); assert.equal(original.scope, `agent:${initial.agentId}`);
    const selection = new URLSearchParams({ scope: original.scope, action: original.action });
    assert.equal((await fetch(`${origin}/v1/operations/${original.body.operationId}?${selection}`, { headers: { authorization: `Bearer ${other.runtimeToken}` } })).status, 404);
    const conflict = await cli(directory, ['profile-clear', '--state', path, '--fields', 'interests']);
    assert.equal(conflict.code, 1); assert.match(conflict.stderr, /pending_operation_requires_original/);
    assert.equal((await json(path)).pendingMutation.key, key);
    if (index === 0) {
      const changed = await privateInput(directory, { fields: { bio: 'A different intent must wait' } });
      const mismatched = await cli(directory, ['profile-update', '--state', path, '--input-file', changed]);
      assert.equal(mismatched.code, 1); assert.match(mismatched.stderr, /pending_operation_requires_original/);
      assert.deepEqual((await json(path)).commands[key].body, original.body);
    }
    if (index === 0) { await stop(running.child); running = await server(directory); upstream = running.address; }
    const read = await command(directory, path, 'profile-read'); assert.equal(read.pendingOperation.operationId, original.body.operationId);
    await command(directory, path, 'status');
    const resumed = await json(path);
    assert.equal(resumed.pendingMutation, undefined); assert.equal(resumed.commands[key].status, 'committed');
    assert.deepEqual(resumed.commands[key].body, original.body); assert.equal(writes.get(endpoint), before + 1, 'Receipt recovery does not resend a committed mutation');
    assert.equal(resumed.agentId, initial.agentId); assert(resumed.runtimeToken === initial.runtimeToken, 'Restart keeps the original runtime proof');
  }
  const session = await initializeOwner(origin, initial);
  interfere = async () => {
    const current = await api(upstream, 'GET', `/v1/agents/${initial.agentId}/profile`, undefined, session);
    await api(upstream, 'PUT', `/v1/agents/${initial.agentId}/profile/draft`, { operationId: newOperationId(),
      expectedVersion: current.version, expectedPolicyVersion: current.policyVersion, fields: { bio: 'Owner concurrent edit' } }, session);
  };
  const stale = await cli(directory, ['profile-update', '--state', path, '--input-file', input]);
  assert.equal(stale.code, 1); assert.match(stale.stderr, /version_conflict/);
  assert.equal((await api(origin, 'GET', `/v1/agents/${initial.agentId}/profile`, undefined, initial.runtimeToken)).draft.bio, 'Owner concurrent edit');
  assert.equal((await json(path)).pendingMutation, undefined);
  const corrected = await command(directory, path, 'profile-update', ['--input-file', input]);
  assert.equal(corrected.profileDetails.draft.bio, 'Original complete intent', 'A new explicit retry reads current versions instead of overwriting with a stale CAS');
  const assistanceEndpoint = '/v1/agent/self/owner-recovery-requests', beforeAssistance = writes.get(assistanceEndpoint) ?? 0;
  discard = assistanceEndpoint;
  const lostAssistance = await cli(directory, ['recovery-request-create', '--state', path]); assert.equal(lostAssistance.code, 1);
  const pendingAssistance = await json(path), assistanceKey = pendingAssistance.pendingMutation.key;
  const originalAssistance = pendingAssistance.commands[assistanceKey]; safeOutput(lostAssistance.stdout + lostAssistance.stderr, pendingAssistance);
  const resumedAssistance = await command(directory, path, 'status');
  const savedAssistance = await json(path), privateEntry = await json(resumedAssistance.privateAssistanceFile);
  assert.equal(writes.get(assistanceEndpoint), beforeAssistance + 1, 'Create response loss reuses the original request and token');
  assert.deepEqual(savedAssistance.commands[assistanceKey].body, originalAssistance.body);
  assert.equal(new URL(privateEntry.url).hash, `#assistance=${originalAssistance.body.assistanceToken}`);
  await command(directory, path, 'recovery-request-cancel');
});

test('downloaded client requests owner assistance without gaining owner authority and reads true terminal state after reopening', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-assistance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child)); await download(directory, running.address);
  const ownerId = randomUUID(), sessionToken = newCredential('session'), recoveryToken = newCredential('recovery');
  await privateInput(directory, { ownerId, sessionToken, recoveryToken });
  await registerOwner(running.address, { operationId: newOperationId(), attemptId: ownerId,
    username: `Assist_${randomUUID().replaceAll('-', '').slice(0, 12)}`, email: `${randomUUID()}@example.test`,
    password: 'assistance-test-password', sessionToken, recoveryToken, credentialsSaved: true });
  const paths = [join(directory, 'a1.json'), join(directory, 'a2.json')];
  for (const [index, path] of paths.entries()) {
    const inviteToken = newCredential('invite');
    await api(running.address, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, sessionToken);
    const inviteFile = await privateInput(directory, { origin: running.address, inviteToken });
    await command(directory, path, 'onboard', ['--url', running.address, '--name', `Assistance Agent ${index + 1}`, '--invite-file', inviteFile]);
  }
  const path = paths[0]!, initial = await json(path), sibling = await json(paths[1]!);
  const first = await command(directory, path, 'recovery-request-create');
  assert.equal(first.recoveryRequest.status, 'pending'); assert.equal(first.recoveryRequest.nextAction, 'deliver_private_entry');
  const entry = await json(first.privateAssistanceFile); assert.equal((await stat(first.privateAssistanceFile)).mode & 0o777, 0o600);
  assert.equal(new URL(entry.url).origin, running.address); assert.equal(new URL(entry.url).pathname, '/owner');
  assert.equal(new URL(entry.url).hash, `#assistance=${(await json(path)).assistance.token}`);
  const id = first.recoveryRequest.requestId, requestPath = `/v1/agent/self/owner-recovery-requests/${id}`;
  const foreignRead = await cli(directory, ['recovery-request-read', '--state', paths[1]!, '--request-id', id]);
  assert.equal(foreignRead.code, 1); assert.match(foreignRead.stderr, /target_not_accessible/);
  const foreignCancel = await cli(directory, ['recovery-request-cancel', '--state', paths[1]!, '--request-id', id]);
  assert.equal(foreignCancel.code, 1); assert.match(foreignCancel.stderr, /target_not_accessible/);
  assert.equal((await api(running.address, 'GET', requestPath, undefined, initial.runtimeToken)).status, 'pending');
  const capability = (await json(path)).assistance.token;
  const resetWithoutBackup = await fetch(`${running.address}/v1/owner/recoveries`, { method: 'POST', headers: {
    'content-type': 'application/json', authorization: `Bearer ${capability}` }, body: JSON.stringify({ operationId: newOperationId(),
    password: 'not-authorized-password', sessionToken: newCredential('session'), recoveryToken: newCredential('recovery'), credentialsSaved: true, assistanceToken: capability }) });
  assert.equal(resetWithoutBackup.status, 403);
  assert.equal((await command(directory, path, 'recovery-request-cancel')).recoveryRequest.status, 'cancelled');
  assert.equal((await command(directory, path, 'status')).recoveryRequest.status, 'cancelled');
  await command(directory, path, 'recovery-request-create');
  const standaloneNext = { sessionToken: newCredential('session'), recoveryToken: newCredential('recovery') };
  await privateInput(directory, standaloneNext);
  await api(running.address, 'POST', '/v1/owner/recoveries', { operationId: newOperationId(), password: 'standalone-recovery-password',
    ...standaloneNext, credentialsSaved: true }, recoveryToken);
  assert.equal((await command(directory, path, 'status')).recoveryRequest.status, 'expired', 'Recovery elsewhere is not fabricated as assisted completion');
  await command(directory, path, 'recovery-request-create');
  const pending = await json(path), current = pending.assistance, commandKey = Object.keys(pending.commands).find(key => pending.commands[key].body.assistanceToken === current.token)!;
  const next = { sessionToken: newCredential('session'), recoveryToken: newCredential('recovery') }; await privateInput(directory, next);
  await api(running.address, 'POST', '/v1/owner/recoveries', { operationId: newOperationId(), password: 'assisted-recovery-password',
    ...next, credentialsSaved: true, assistanceToken: current.token }, standaloneNext.recoveryToken);
  const complete = await command(directory, path, 'status'); assert.equal(complete.recoveryRequest.status, 'completed');
  assert.equal(complete.recoveryRequest.nextAction, 'none');
  assert.equal((await json(path)).commands[commandKey].result.status, 'pending', 'Historical creation receipt remains historical; current status is a fresh read');
  assert.equal(complete.agentId, initial.agentId); assert((await json(path)).runtimeToken === initial.runtimeToken, 'Recovery keeps the same Agent proof');
  await command(directory, path, 'recovery-request-create');
  const beforeReplacement = await json(path), runtimeToken = newCredential('runtime');
  await api(running.address, 'POST', `/v1/owner/agents/${initial.agentId}/runtime-access/replace`, {
    operationId: newOperationId(), expectedVersion: 1, runtimeToken }, next.sessionToken);
  assert.equal((await cli(directory, ['status', '--state', path])).code, 1);
  const runtimeFile = await privateInput(directory, { format: 'connet-runtime-v1', origin: running.address, agentId: initial.agentId, runtimeToken });
  const replaced = await command(directory, path, 'import-runtime', ['--runtime-file', runtimeFile]);
  assert.equal(replaced.recoveryRequest.status, 'expired'); assert.equal(replaced.agentId, initial.agentId);
  assert.equal((await json(path)).assistance.requestId, beforeReplacement.assistance.requestId);
  const other = await api(running.address, 'GET', '/v1/agent/self', undefined, sibling.runtimeToken);
  assert.equal(other.agentId, sibling.agentId); assert.equal(other.ownerId, ownerId);
});

test('reference client reports policy refusals without losing identity and can correct a rejected intent', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-crud-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child)); await download(directory, running.address);
  const path = join(directory, 'a1.json'); await command(directory, path, 'onboard', ['--url', running.address, '--name', 'Policy Agent']);
  const initial = await json(path), session = await initializeOwner(running.address, initial);
  const policy = async (mode: string, lockedFields: string[]) => {
    const current = await api(running.address, 'GET', `/v1/agents/${initial.agentId}/profile`, undefined, session);
    return api(running.address, 'PUT', `/v1/owner/agents/${initial.agentId}/profile-policy`, { operationId: newOperationId(),
      expectedVersion: current.version, expectedPolicyVersion: current.policyVersion, mode, lockedFields }, session);
  };
  await policy('agent_autonomous', ['bio']);
  const restricted = await command(directory, path, 'profile-read');
  assert(!restricted.effectiveActions.saveDraft.writableFields.includes('bio')); assert(!restricted.effectiveActions.saveDraft.removableFields.includes('bio'));
  const input = await privateInput(directory, { fields: { bio: 'Corrected after unlock' } });
  const locked = await cli(directory, ['profile-update', '--state', path, '--input-file', input]);
  assert.equal(locked.code, 1); assert.match(locked.stderr, /field_locked/);
  assert.equal((await json(path)).pendingMutation, undefined, 'An explicit policy rejection allows a corrected new command');
  await policy('agent_autonomous', []); await command(directory, path, 'profile-update', ['--input-file', input]);
  await policy('agent_autonomous', ['displayName']);
  const lockedPublication = await command(directory, path, 'profile-read');
  assert.equal(lockedPublication.effectiveActions.unpublishProfile.allowed, false); assert(lockedPublication.effectiveActions.unpublishProfile.blockedBy.includes('field_locked'));
  const lockedWithdrawal = await cli(directory, ['profile-unpublish', '--state', path]); assert.equal(lockedWithdrawal.code, 1); assert.match(lockedWithdrawal.stderr, /field_locked/);
  await policy('proposal_required', []);
  for (const name of ['profile-publish', 'profile-unpublish']) {
    const denied = await cli(directory, [name, '--state', path]); assert.equal(denied.code, 1); assert.match(denied.stderr, /confirmation_required/);
  }
  await policy('agent_autonomous', []);
  const member = await api(running.address, 'GET', `/v1/agents/${initial.agentId}/membership`, undefined, session);
  await api(running.address, 'PUT', `/v1/owner/agents/${initial.agentId}/participation`, { operationId: newOperationId(), expectedVersion: member.version, paused: true }, session);
  const paused = await cli(directory, ['profile-unpublish', '--state', path]); assert.equal(paused.code, 1); assert.match(paused.stderr, /participation_paused/);
  const gates = await command(directory, path, 'membership-read'); assert.equal(gates.effectiveActions.leave.allowed, true);
  assert(gates.effectiveActions.join.blockedBy.includes('participation_paused'));
  const left = await command(directory, path, 'membership-leave'); assert.equal(left.membershipDetails.state, 'left'); assert.equal(left.membershipDetails.ownerPaused, true);
  const final = await json(path); assert.equal(final.agentId, initial.agentId); assert(final.runtimeToken === initial.runtimeToken);
});

test('downloaded standalone CLI completes real HTTP, private handoff, restart and invitation without a repository cwd', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-external-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child));
  await download(directory, running.address);
  const statePath = join(directory, 'a1.json');
  const first = await cli(directory, ['onboard', '--url', running.address, '--state', statePath, '--name', 'Process A1', '--bio', 'Synthetic only', '--color', 'blue']);
  assert.equal(first.code, 0, 'Standalone onboarding must succeed');
  const state = await json(statePath), summary = JSON.parse(first.stdout);
  safeOutput(first.stdout + first.stderr, state);
  assert.equal(summary.membership, 'joined'); assert.equal(summary.managementStatus, 'pending_setup');
  assert.equal(summary.schedule_configuration, 'not_configured'); assert.equal(summary.periodic_run_verification, 'not_verified');
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  assert.equal((await stat(summary.privateHandoffFile)).mode & 0o777, 0o600);
  const privateHandoff = await json(summary.privateHandoffFile);
  const link = new URL(privateHandoff.url);
  assert.equal(link.pathname, '/owner'); assert.equal(link.search, '');
  assert(link.hash.startsWith('#handoff='), 'Only a fragment may contain the initial handoff');
  const second = await cli(directory, ['status', '--state', statePath]);
  assert.equal(second.code, 0); assert.equal(JSON.parse(second.stdout).agentId, summary.agentId);
  assert.equal((await json(statePath)).commands.registration.body.operationId, state.commands.registration.body.operationId);
  const session = await initializeOwner(running.address, state);
  const managed = await cli(directory, ['status', '--state', statePath]);
  assert.equal(managed.code, 0); assert.equal(JSON.parse(managed.stdout).managementStatus, 'managed');
  const inviteToken = newCredential('invite');
  await api(running.address, 'POST', '/v1/owner/agent-invites', { operationId: newOperationId(), inviteToken }, session);
  const invitePath = join(directory, 'invite.json');
  await writeFile(invitePath, JSON.stringify({ origin: running.address, inviteToken }), { mode: 0o600 });
  const a2Path = join(directory, 'a2.json');
  const added = await cli(directory, ['onboard', '--url', running.address, '--state', a2Path, '--name', 'Process A2', '--invite-file', invitePath]);
  assert.equal(added.code, 0);
  const a2 = await json(a2Path);
  assert.equal(a2.ownerId, state.ownerId); assert.notEqual(a2.agentId, state.agentId);
  assert(a2.runtimeToken !== state.runtimeToken, 'Independent Agents must have independent runtime proofs');
  safeOutput(added.stdout + added.stderr, a2);
  const runtimeToken = newCredential('runtime');
  const runtimeFile = join(directory, 'next-runtime.json');
  await writeFile(runtimeFile, JSON.stringify({ format: 'connet-runtime-v1', origin: running.address,
    agentId: state.agentId, runtimeToken, expectedVersion: 1, operationId: newOperationId() }), { mode: 0o600 });
  const next = await json(runtimeFile);
  await api(running.address, 'POST', `/v1/owner/agents/${state.agentId}/runtime-access/replace`, {
    operationId: next.operationId, expectedVersion: next.expectedVersion, runtimeToken,
  }, session);
  assert.equal((await cli(directory, ['status', '--state', statePath])).code, 1, 'Old runtime proof must be rejected');
  const imported = await cli(directory, ['import-runtime', '--state', statePath, '--runtime-file', runtimeFile]);
  assert.equal(imported.code, 0); assert.equal(JSON.parse(imported.stdout).agentId, state.agentId);
  assert.equal((await cli(directory, ['status', '--state', statePath])).code, 0);
  const beforeWrong = await readFile(statePath, 'utf8');
  const wrongFile = join(directory, 'wrong-runtime.json');
  await writeFile(wrongFile, JSON.stringify({ format: 'connet-runtime-v1', origin: running.address,
    agentId: state.agentId, runtimeToken: a2.runtimeToken }), { mode: 0o600 });
  assert.equal((await cli(directory, ['import-runtime', '--state', statePath, '--runtime-file', wrongFile])).code, 1);
  assert((await readFile(statePath, 'utf8')) === beforeWrong, 'A different identity must not modify the original state');
  safeOutput(imported.stdout + imported.stderr, await json(statePath));
  const conflicting = await cli(directory, ['onboard', '--url', running.address, '--state', statePath, '--name', 'Different intent']);
  assert.equal(conflicting.code, 1); assert.equal((await json(statePath)).agentId, state.agentId);
});

test('legal owner claim is adopted from authenticated self after process reopen without changing Agent proofs or historical receipt', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-owner-claim-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child));
  await download(directory, running.address);
  const path = join(directory, 'agent.json');
  const first = await cli(directory, ['onboard', '--url', running.address, '--state', path, '--name', 'Claimed process Agent']);
  assert.equal(first.code, 0);
  const before = await json(path), originalReceipt = JSON.stringify(before.commands.registration.result);
  const sessionToken = newCredential('session'), recoveryToken = newCredential('recovery'), attemptId = randomUUID();
  const registrationOperationId = newOperationId();
  await writeFile(join(directory, 'owner.private.json'), JSON.stringify({ sessionToken, recoveryToken,
    ownerId: attemptId, pendingOperation: { operationId: registrationOperationId,
      scope: `owner-registration:${attemptId}`, action: 'registerOwner' } }), { mode: 0o600 });
  const owner = await registerOwner(running.address, { operationId: registrationOperationId, attemptId,
    username: `Process_${randomUUID().replaceAll('-', '').slice(0, 10)}`, email: `${randomUUID()}@example.test`,
    password: `Synthetic-${randomUUID()}`, sessionToken, recoveryToken, credentialsSaved: true });
  await api(running.address, 'POST', '/v1/owner/agent-claims', { operationId: newOperationId(), agentId: before.agentId,
    expectedGeneration: before.handoff.generation, handoffToken: before.handoff.token }, sessionToken);
  const current = await api(running.address, 'GET', '/v1/agent/self', undefined, before.runtimeToken);
  assert.equal(current.ownerId, owner.ownerId); assert.equal(current.agentId, before.agentId);
  for (const command of ['status', 'onboard']) {
    const reopened = await cli(directory, [command, '--state', path]);
    assert.equal(reopened.code, 0, 'A new client process resumes the same Agent after its legal owner claim');
    const summary = JSON.parse(reopened.stdout), after = await json(path);
    assert.equal(summary.agentId, before.agentId); assert.equal(summary.ownerId, owner.ownerId);
    assert.equal(summary.managementStatus, 'managed'); assert.equal(summary.membership, 'joined');
    assert(after.runtimeToken === before.runtimeToken && after.continuationToken === before.continuationToken,
      'Claiming ownership must not replace local Agent proofs');
    assert.equal(after.instanceId, before.instanceId);
    assert(JSON.stringify(after.commands.registration.result) === originalReceipt, 'The original committed registration receipt remains immutable history');
    assert.equal(after.profile.version, before.profile.version); assert.equal(after.membership.version, before.membership.version);
    safeOutput(reopened.stdout + reopened.stderr, after);
  }
});

test('registration, initial public save and handoff response loss plus backend restart resume each original complete command', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-loss-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let running = await server(directory); t.after(() => stop(running.child));
  let upstream = running.address, lossIndex = 0, registrations = 0, handoffs = 0, profiles = 0;
  const discardPaths = ['/v1/registrations', '/profile', '/v1/agent/self/handoffs'];
  const proxy = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    try {
      const forwarded = await fetch(`${upstream}${request.url}`, { method: request.method!, headers: {
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        ...(body.length ? { 'content-type': 'application/json' } : {}),
      }, ...(body.length ? { body } : {}) });
      const payload = await forwarded.text();
      if (request.method === 'POST' && request.url === '/v1/registrations') {
        registrations++;
      }
      if (request.url === '/v1/agent/self/handoffs' && request.method === 'POST') handoffs++;
      if (request.url?.endsWith('/profile') && request.method === 'PUT') profiles++;
      if (discardPaths[lossIndex] && request.url?.endsWith(discardPaths[lossIndex]!) && forwarded.status === 200) {
        lossIndex++; response.destroy(); return;
      }
      response.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'text/plain' }); response.end(payload);
    } catch { response.writeHead(503); response.end('{}'); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => proxy.close(() => resolve())));
  const address = proxy.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  await download(directory, origin);
  const statePath = join(directory, 'state.json');
  const lost = await cli(directory, ['onboard', '--url', origin, '--state', statePath, '--name', 'Recoverable']);
  assert.equal(lost.code, 1);
  const before = await json(statePath); assert.equal(before.commands.registration.status, 'pending');
  const created = await api(origin, 'GET', '/v1/agent/self', undefined, before.runtimeToken);
  safeOutput(lost.stdout + lost.stderr, before);
  await stop(running.child); running = await server(directory); upstream = running.address;
  assert.equal((await cli(directory, ['status', '--state', statePath])).code, 1, 'Lost initial public-save response stays pending');
  assert.equal((await cli(directory, ['status', '--state', statePath])).code, 1, 'Lost handoff response stays pending');
  const continued = await cli(directory, ['status', '--state', statePath]);
  assert.equal(continued.code, 0, 'A restarted downloaded client must continue the original registration');
  assert.equal(JSON.parse(continued.stdout).agentId, created.agentId);
  assert.equal(registrations, 1, 'A readable original receipt must avoid another registration POST');
  assert.equal(profiles, 1, 'Initial public-save continuation must query the original command');
  assert.equal(handoffs, 1, 'Handoff continuation must not mint another generation');
  assert.equal((await json(statePath)).commands.registration.body.operationId, before.commands.registration.body.operationId);
  const otherDirectory = await mkdtemp(join(tmpdir(), 'm1-different-instance-'));
  t.after(() => rm(otherDirectory, { recursive: true, force: true }));
  const other = await server(otherDirectory, 'different-agent-instance'); t.after(() => stop(other.child));
  const stableState = await readFile(statePath, 'utf8');
  upstream = other.address;
  assert.equal((await cli(directory, ['status', '--state', statePath])).code, 1);
  assert((await readFile(statePath, 'utf8')) === stableState, 'A different instance must not replace the original state');
  assert.equal(registrations, 1, 'Instance mismatch must not create a new identity');
  for (const [index, invalid] of [['--color', 'invalid'], ['--bio', 'x'.repeat(501)], ['--name', 'x'.repeat(61)]].entries()) {
    const invalidState = join(directory, `invalid-${index}.json`);
    const baseArgs = ['onboard', '--url', origin, '--state', invalidState];
    if (invalid[0] !== '--name') baseArgs.push('--name', 'Invalid preflight');
    const invalidRun = await cli(directory, [...baseArgs, ...invalid]);
    assert.equal(invalidRun.code, 1);
    await assert.rejects(stat(invalidState), { code: 'ENOENT' });
    assert.equal(registrations, 1, 'Invalid profile input must be rejected before any registration POST');
  }
});

test('owner-required publication stays pending until authenticated owner preparation and explicit publication', { timeout: 20_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-proposal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child));
  let ownerSession = '';
  const proxy = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    try {
      const forwarded = await fetch(`${running.address}${request.url}`, { method: request.method!, headers: {
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        ...(body.length ? { 'content-type': 'application/json' } : {}),
      }, ...(body.length ? { body } : {}) });
      const payload = await forwarded.text();
      if (request.method === 'POST' && request.url === '/v1/registrations' && forwarded.status === 200) {
        const material = JSON.parse(body.toString()), registered = JSON.parse(payload);
        const handoffToken = newCredential('handoff');
        await api(running.address, 'POST', '/v1/agent/self/handoffs', { operationId: newOperationId(), expectedGeneration: 0, handoffToken }, material.continuationToken);
        ownerSession = await initializeOwner(running.address, { handoff: { token: handoffToken } });
        await api(running.address, 'PUT', `/v1/owner/agents/${registered.agentId}/profile-policy`, {
          operationId: newOperationId(), expectedVersion: 1, expectedPolicyVersion: 1, mode: 'proposal_required', lockedFields: [],
        }, ownerSession);
        const profile = await api(running.address, 'GET', `/v1/agents/${registered.agentId}/profile`, undefined, ownerSession);
        // New registrations are already public. A real owner withdrawal creates
        // the unpublished state this authorization story is intended to protect.
        await api(running.address, 'POST', `/v1/agents/${registered.agentId}/profile/unpublish`, {
          operationId: newOperationId(), expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion,
        }, ownerSession);
      }
      response.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'text/plain' }); response.end(payload);
    } catch { response.writeHead(503); response.end('{}'); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => proxy.close(() => resolve())));
  const address = proxy.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  await download(directory, origin);
  const statePath = join(directory, 'state.json');
  const pending = await cli(directory, ['onboard', '--url', origin, '--state', statePath, '--name', 'Proposal']);
  assert.equal(pending.code, 0);
  const pendingSummary = JSON.parse(pending.stdout), state = await json(statePath);
  assert.equal(pendingSummary.registration, 'completed'); assert.equal(pendingSummary.profile, 'pending');
  assert.equal(pendingSummary.membership, 'joined'); assert.equal(pendingSummary.pendingReason, 'owner_confirmation_required');
  assert.equal(state.profile.published, null);
  assert.equal((await fetch(`${running.address}/v1/public/agents/${state.agentId}`)).status, 404);
  assert.equal(state.commands.initialProfile, undefined, 'The CLI must not prepare a direct write after the owner changed the policy');
  const prepared = await api(running.address, 'PUT', `/v1/agents/${state.agentId}/profile/draft`, {
    operationId: newOperationId(), expectedVersion: state.profile.version, expectedPolicyVersion: state.profile.policyVersion,
    fields: { displayName: 'Owner reviewed proposal' },
  }, ownerSession);
  await api(running.address, 'POST', `/v1/agents/${state.agentId}/profile/publish`, {
    operationId: newOperationId(), expectedVersion: prepared.version, expectedPolicyVersion: prepared.policyVersion,
  }, ownerSession);
  const continued = await cli(directory, ['status', '--state', statePath]);
  assert.equal(continued.code, 0); assert.equal(JSON.parse(continued.stdout).membership, 'joined');
  assert.equal((await json(statePath)).profile.confirmationSource, 'owner_authenticated');
  assert.equal((await api(running.address, 'GET', `/v1/public/agents/${state.agentId}`)).profile.displayName, 'Owner reviewed proposal');
});

test('corrupt, public or symlink client state never turns into a new registration', { timeout: 20_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-safety-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child));
  await download(directory, running.address);
  const corrupt = join(directory, 'corrupt.json'); await writeFile(corrupt, '{incomplete', { mode: 0o600 });
  const result = await cli(directory, ['onboard', '--url', running.address, '--state', corrupt, '--name', 'Must not register']);
  assert.equal(result.code, 1); assert.equal(await readFile(corrupt, 'utf8'), '{incomplete');
  const linked = join(directory, 'linked.json'); await symlink(corrupt, linked);
  assert.equal((await cli(directory, ['status', '--state', linked])).code, 1);
  const publicState = join(directory, 'public-state.json');
  await writeFile(publicState, '{}', { mode: 0o644 });
  assert.equal((await cli(directory, ['status', '--state', publicState])).code, 1);
  assert.equal(await readFile(publicState, 'utf8'), '{}');
  const material = newAgentMaterial();
  const malformedPath = join(directory, 'malformed-state.json');
  const malformed = { format: 'connet-agent-v1', apiVersion: 'v1', documentationVersion: 'v1',
    instanceId: 'agent-process-test', origin: running.address, runtimeToken: material.runtimeToken,
    continuationToken: material.continuationToken, commands: { registration: { method: 'POST', path: '/v1/registrations',
      scope: `registration:${material.attemptId}`, action: 'register', status: 'pending',
      body: { operationId: newOperationId(), ...material } } } }; // Missing role intent must not register.
  const original = JSON.stringify(malformed);
  await writeFile(malformedPath, original, { mode: 0o600 });
  assert.equal((await cli(directory, ['status', '--state', malformedPath])).code, 1);
  assert((await readFile(malformedPath, 'utf8')) === original, 'A malformed state must remain untouched');
  assert.equal((await fetch(`${running.address}/v1/agent/self`, { headers: { authorization: `Bearer ${material.runtimeToken}` } })).status, 401);
  const unsafe = await cli(directory, ['onboard', '--url', `${running.address}/?handoff=not-allowed`, '--state', join(directory, 'new.json'), '--name', 'Invalid origin']);
  assert.equal(unsafe.code, 1); assert(!unsafe.stderr.includes('not-allowed'));
});

test('all CLI origin boundaries reject public HTTP before network access and retain HTTPS parsing', { timeout: 20_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-origin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const running = await server(directory); t.after(() => stop(running.child));
  await download(directory, running.address);
  const audit = join(directory, 'fetch-audit.jsonl');
  const preload = join(directory, 'origin-network-tripwire.mjs');
  // This child-only transport tripwire prevents any public connection or identity creation.
  // It records only method/protocol/path/redirect, never proofs, headers, body or full URLs.
  await writeFile(preload, `import {appendFileSync} from 'node:fs';
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  appendFileSync(${JSON.stringify(audit)}, JSON.stringify({method:options.method || 'GET',protocol:url.protocol,path:url.pathname,redirect:options.redirect}) + '\\n', {mode:0o600});
  throw new Error('Network disabled by the origin test');
};\n`, { mode: 0o600 });
  const probe = async (args: string[]) => {
    await writeFile(audit, '', { mode: 0o600 });
    const result = await cli(directory, args, preload);
    const attempts = (await readFile(audit, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Json);
    return { ...result, attempts };
  };
  for (const base of ['http://example.test', 'http://203.0.113.10:8080', 'http://localhost.example.test',
    'http://127.0.0.2', 'http://[::ffff:127.0.0.1]', 'https://user:dummy@example.test',
    'https://example.test/other', 'https://example.test/?private=invalid', 'https://example.test/#invalid']) {
    const path = join(directory, 'not-created.json');
    const result = await probe(['onboard', '--url', base, '--state', path, '--name', 'Origin test']);
    assert.equal(result.code, 1); assert(result.stderr.startsWith('invalid_origin;'));
    assert.equal(result.attempts.length, 0, 'Invalid origins must fail before a read or write request');
    await assert.rejects(stat(path), { code: 'ENOENT' });
  }
  for (const base of ['https://example.test', 'https://203.0.113.10:8443', 'http://localhost:8787',
    'http://127.0.0.1:8787', 'http://[::1]:8787']) {
    const result = await probe(['onboard', '--url', base, '--state', join(directory, 'not-created.json'), '--name', 'Origin test']);
    assert.equal(result.code, 1); // The tripwire deliberately stops the first capability read.
    assert.equal(result.attempts.length, 1, 'Allowed HTTPS and explicit loopback origins reach the transport boundary');
    assert.equal(result.attempts[0]!.protocol, new URL(base).protocol);
    assert.equal(result.attempts[0]!.method, 'GET'); assert.equal(result.attempts[0]!.path, '/v1/capabilities');
    assert.equal(result.attempts[0]!.redirect, 'error', 'Redirects must not forward proofs to another origin or downgrade HTTPS');
  }
  const material = newAgentMaterial();
  const state = { format: 'connet-agent-v1', apiVersion: 'v1', documentationVersion: 'v1', instanceId: 'origin-probe',
    origin: 'http://example.test', runtimeToken: material.runtimeToken, continuationToken: material.continuationToken,
    agentId: 'origin_probe_agent', fields: { displayName: 'Origin test', bio: '', avatar: { template: 'basic', color: 'blue' } },
    commands: { registration: { method: 'POST', path: '/v1/registrations', action: 'register',
      scope: `registration:${material.attemptId}`, status: 'pending', body: { operationId: newOperationId(), ...material } } } };
  const path = join(directory, 'existing.json'), original = JSON.stringify(state);
  await writeFile(path, original, { mode: 0o600 });
  for (const command of ['onboard', 'status', 'handoff', 'import-runtime', 'avatar-catalog', 'capabilities', 'profile-read', 'profile-update',
    'profile-clear', 'profile-publish', 'profile-unpublish', 'membership-read', 'membership-join', 'membership-leave',
    'recovery-request-create', 'recovery-request-read', 'recovery-request-cancel', 'check-updates']) {
    const result = await probe([command, '--state', path]);
    assert.equal(result.code, 1); assert(result.stderr.startsWith('invalid_origin;'));
    assert.equal(result.attempts.length, 0, 'Saved public HTTP must be rejected for every command before transport');
    assert((await readFile(path, 'utf8')) === original, 'Rejected state origin must not rewrite identity or pending commands');
  }
  const bypass = await probe(['onboard', '--url', 'https://example.test', '--state', join(directory, 'not-created.json'), '--name', 'Origin test', '--insecure']);
  assert.equal(bypass.code, 1); assert(bypass.stderr.startsWith('invalid_arguments;')); assert.equal(bypass.attempts.length, 0);
});

test('manual discovery reuses the downloaded Agent identity, preserves complete versions on failures and never resumes a pending business write', { timeout: 45_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ws02-cli-discovery-'));
  const running = await server(directory, 'ws02-cli-discovery');
  let failDiscovery = true, forcePages = false, failGuide = false, rejectDraft = false, discoveries = 0;
  const writes: { path: string; method: string }[] = [];
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks), target = new URL(request.url!, running.address);
      const isDiscovery = target.pathname === '/v1/perception/discovery';
      if (isDiscovery) discoveries++;
      if (request.method !== 'GET') writes.push({ path: target.pathname, method: request.method! });
      if ((isDiscovery && failDiscovery) || (forcePages && isDiscovery && target.searchParams.has('pageToken'))
        || (failGuide && target.pathname.startsWith('/v1/perception/guides/'))) {
        response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":{"code":"source_unavailable"}}'); return;
      }
      if (rejectDraft && request.method === 'PUT' && target.pathname.endsWith('/profile/draft')) { response.destroy(); return; }
      // Only the transport query bound changes: every successful directory page
      // and token comes from the real service, never a fabricated success.
      if (forcePages && isDiscovery) target.searchParams.set('limit', '1');
      const forwarded = await fetch(target, { method: request.method!, headers: {
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        ...(body.length ? { 'content-type': 'application/json' } : {}),
      }, ...(body.length ? { body } : {}) });
      response.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'application/json' }); response.end(await forwarded.text());
    } catch { response.writeHead(503); response.end('{}'); }
  });
  t.after(async () => {
    try { await new Promise<void>(resolve => proxy.close(() => resolve())); }
    finally { try { await stop(running.child); } finally { await rm(directory, { recursive: true, force: true }); } }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  await download(directory, origin);
  const path = join(directory, 'agent.private.json');
  const first = await cli(directory, ['onboard', '--url', origin, '--state', path, '--name', 'Manual perception Agent']);
  assert.equal(first.code, 0); const state = await json(path); safeOutput(first.stdout + first.stderr, state);
  assert.equal(JSON.parse(first.stdout).discovery.status, 'unknown'); assert(discoveries > 0);
  assert.equal(state.commands.registration.status, 'committed'); assert(state.handoff?.privateFile);
  assert.equal((await stat(state.handoff.privateFile)).mode & 0o777, 0o600);
  assert.equal((await api(running.address, 'GET', '/v1/agent/self', undefined, state.runtimeToken)).agentId, state.agentId);
  const administrative = (version?: number) => {
    const store = openM1Store({ databasePath: join(directory, 'test.sqlite'), instanceId: 'ws02-cli-discovery', recoveryEpoch: 'agent-test-epoch' });
    try {
      if (version) publishPerceptionCatalog(store, { revision: `cli-catalog-${version}`, guideVersion: version });
      else seedWs02DemoData(store, { actorId: 'isolated-cli-administrator' });
    } finally { store.close(); }
  };
  administrative(); failDiscovery = false;
  const updated = await command(directory, path, 'check-updates'); assert.equal(updated.discovery.status, 'updated');
  const cachePath = `${path}.discovery.json`, baseline = await json(cachePath);
  assert.equal(baseline.complete, true); assert.equal(baseline.agentId, state.agentId); assert.equal(baseline.origin, origin);
  assert.equal((await stat(cachePath)).mode & 0o777, 0o600);
  const beforeRead = discoveries; await command(directory, path, 'profile-read'); assert.equal(discoveries, beforeRead, 'Ordinary local reads do not start another discovery cycle');
  rejectDraft = true;
  const intent = await privateInput(directory, { fields: { bio: 'This unsubmitted business command must stay pending' } });
  const pendingResult = await cli(directory, ['profile-update', '--state', path, '--input-file', intent]); assert.equal(pendingResult.code, 1);
  const pending = await json(path), originalWrites = writes.length;
  const preserve = async () => {
    const current = await json(path);
    assert(current.runtimeToken === pending.runtimeToken && current.continuationToken === pending.continuationToken, 'Discovery cannot rotate identity proofs');
    assert.equal(current.agentId, pending.agentId); assert.equal(current.instanceId, pending.instanceId);
    assert(JSON.stringify(current.commands) === JSON.stringify(pending.commands), 'The exact business command and receipt history remain untouched');
    assert(JSON.stringify(current.pendingMutation) === JSON.stringify(pending.pendingMutation)); assert.equal(writes.length, originalWrites);
  };
  administrative(2); const second = await command(directory, path, 'check-updates'); assert.equal(second.discovery.status, 'updated');
  const cache2 = await readFile(cachePath, 'utf8'); assert.equal(JSON.parse(cache2).catalogRevision, 'cli-catalog-2');
  assert(JSON.parse(cache2).documents.some((document: Json) => document.kind === 'guide' && document.version === 2)); await preserve();
  administrative(3); forcePages = true;
  const incomplete = await cli(directory, ['check-updates', '--state', path]); assert.equal(incomplete.code, 1); safeOutput(incomplete.stdout + incomplete.stderr, pending);
  assert((await readFile(cachePath, 'utf8')) === cache2, 'An actual first directory page followed by failure cannot replace the complete baseline'); await preserve();
  forcePages = false; await command(directory, path, 'check-updates'); const cache3 = await readFile(cachePath, 'utf8');
  administrative(4); failGuide = true;
  const missingGuide = await cli(directory, ['check-updates', '--state', path]); assert.equal(missingGuide.code, 1); safeOutput(missingGuide.stdout + missingGuide.stderr, pending);
  assert((await readFile(cachePath, 'utf8')) === cache3, 'A complete directory without reliable exact guides is still an incomplete update'); await preserve();
  failGuide = false; await command(directory, path, 'check-updates');
  assert.equal((await command(directory, path, 'check-updates')).discovery.status, 'unchanged'); await preserve();
  assert.equal((await api(running.address, 'GET', `/v1/public/agents/${state.agentId}`)).profile.displayName, 'Manual perception Agent');
  assert.equal(writes.filter(write => write.path === '/v1/registrations').length, 1);
  assert(!writes.some(write => write.path.startsWith('/v1/perception/')), 'Update checks never confirm a message or submit another business action');
});
