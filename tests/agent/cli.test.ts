import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import test from 'node:test';
import { newAgentMaterial, newCredential, newOperationId } from '../../scripts/m1-client.ts';

type Json = Record<string, any>;
const serverEntry = fileURLToPath(new URL('../../apps/platform/server.ts', import.meta.url));
async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function server(directory: string, instanceId = 'agent-process-test') {
  const child = spawn(process.execPath, [serverEntry], { cwd: directory, env: { ...process.env,
    M1_HOST: '127.0.0.1', M1_PORT: '0', M1_DATABASE_PATH: join(directory, 'test.sqlite'),
    M1_IDENTITY_PATH: join(directory, 'identity.json'), M1_INSTANCE_ID: instanceId, M1_RECOVERY_EPOCH: 'agent-test-epoch',
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
  for (const token of [state.runtimeToken, state.continuationToken, state.handoff?.token].filter(Boolean)) {
    assert(!output.includes(token), 'CLI output must not contain a proof');
    assert(!output.includes(token.split('.')[1]), 'CLI output must not contain the secret segment');
  }
}
async function initializeOwner(origin: string, state: Json) {
  const setupToken = newCredential('setup'), sessionToken = newCredential('session'), recoveryToken = newCredential('recovery');
  await api(origin, 'POST', '/v1/owner-setups', { operationId: newOperationId(), setupToken }, state.handoff.token);
  await api(origin, 'POST', '/v1/owner/setup/complete', { operationId: newOperationId(), password: 'process-test-password',
    recoveryToken, sessionToken, credentialsSaved: true }, setupToken);
  return sessionToken;
}

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

test('registration, draft and handoff response loss plus backend restart resume each original complete command', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-agent-loss-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let running = await server(directory); t.after(() => stop(running.child));
  let upstream = running.address, lossIndex = 0, registrations = 0, handoffs = 0, drafts = 0;
  const discardPaths = ['/v1/registrations', '/profile/draft', '/v1/agent/self/handoffs'];
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
      if (request.url?.endsWith('/profile/draft') && request.method === 'PUT') drafts++;
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
  assert.equal((await cli(directory, ['status', '--state', statePath])).code, 1, 'Lost draft response stays pending');
  assert.equal((await cli(directory, ['status', '--state', statePath])).code, 1, 'Lost handoff response stays pending');
  const continued = await cli(directory, ['status', '--state', statePath]);
  assert.equal(continued.code, 0, 'A restarted downloaded client must continue the original registration');
  assert.equal(JSON.parse(continued.stdout).agentId, created.agentId);
  assert.equal(registrations, 1, 'A readable original receipt must avoid another registration POST');
  assert.equal(drafts, 1, 'Draft continuation must query the original command');
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

test('owner-required publication remains pending and resumes joining only after authenticated owner publication', { timeout: 20_000 }, async t => {
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
  assert.equal(pendingSummary.membership, 'not_joined'); assert.equal(pendingSummary.pendingReason, 'owner_confirmation_required');
  assert.equal(state.profile.published, null);
  await api(running.address, 'POST', `/v1/agents/${state.agentId}/profile/publish`, {
    operationId: newOperationId(), expectedVersion: state.profile.version, expectedPolicyVersion: state.profile.policyVersion,
  }, ownerSession);
  const continued = await cli(directory, ['status', '--state', statePath]);
  assert.equal(continued.code, 0); assert.equal(JSON.parse(continued.stdout).membership, 'joined');
  assert.equal((await json(statePath)).profile.confirmationSource, 'owner_authenticated');
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
  for (const command of ['onboard', 'status', 'handoff', 'import-runtime']) {
    const result = await probe([command, '--state', path]);
    assert.equal(result.code, 1); assert(result.stderr.startsWith('invalid_origin;'));
    assert.equal(result.attempts.length, 0, 'Saved public HTTP must be rejected for every command before transport');
    assert((await readFile(path, 'utf8')) === original, 'Rejected state origin must not rewrite identity or pending commands');
  }
  const bypass = await probe(['onboard', '--url', 'https://example.test', '--state', join(directory, 'not-created.json'), '--name', 'Origin test', '--insecure']);
  assert.equal(bypass.code, 1); assert(bypass.stderr.startsWith('invalid_arguments;')); assert.equal(bypass.attempts.length, 0);
});
