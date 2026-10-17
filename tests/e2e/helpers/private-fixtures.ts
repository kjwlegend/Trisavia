import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Json = Record<string, any>;
export const credential = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
export const operationId = () => randomUUID();

export async function privateDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await chmod(directory, 0o700);
  return directory;
}

function containsPassword(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => /password/i.test(key) || containsPassword(entry));
}

export async function privateJson(directory: string, name: string, value: Json): Promise<string> {
  expect(containsPassword(value), 'A private fixture or backup must never persist a password').toBe(false);
  expect((await stat(directory)).mode & 0o777, 'Private fixture directory uses mode 0700').toBe(0o700);
  const path = join(directory, `${name}-${randomUUID()}.private.json`);
  await writeFile(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  expect((await stat(path)).mode & 0o777, 'Private fixture uses mode 0600').toBe(0o600);
  return path;
}

export async function privateDownload(page: Page, trigger: Locator, directory: string): Promise<Json> {
  const pending = page.waitForEvent('download');
  await trigger.click();
  const download = await pending;
  try {
    const stream = await download.createReadStream();
    if (!stream) throw new Error('Private backup was unavailable');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    let value: Json;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json; }
    catch { throw new Error('Private backup was not valid JSON'); }
    await privateJson(directory, 'download', value);
    return value;
  } finally { await download.delete(); }
}

export async function fixtureRequest(origin: string, path: string, body?: Json, bearer?: string, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${origin}/v1${path}`, {
    method, redirect: 'error',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: Json;
  try { data = await response.json() as Json; } catch { throw new Error('Fixture received a non-JSON response'); }
  return { status: response.status, data };
}

export async function fixtureOk(origin: string, path: string, body?: Json, bearer?: string, method?: string): Promise<Json> {
  const result = await fixtureRequest(origin, path, body, bearer, method);
  expect(result.status, 'Synthetic fixture API operation must succeed').toBe(200);
  return result.data;
}

// This uses the real account API. Only proofs and the full non-secret command key
// are written before the request; the synthetic password remains in memory.
export async function accountFixture(origin: string, directory: string) {
  const attemptId = randomUUID(), sessionToken = credential(), recoveryToken = credential(), id = operationId();
  const username = `QA_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const email = `${username.toLowerCase()}@example.test`, password = `Synthetic-${randomUUID()}`;
  const backup = { format: 'connet-owner-v2', origin, ownerId: attemptId, sessionToken, recoveryToken,
    pendingOperation: { operationId: id, scope: `owner-registration:${attemptId}`, action: 'registerOwner', input: { attemptId, username, email } } };
  await privateJson(directory, 'owner-registration', backup);
  const result = await fixtureOk(origin, '/owner/accounts', { operationId: id, attemptId, username, email, password,
    sessionToken, recoveryToken, credentialsSaved: true });
  expect(result.ownerId).toBe(attemptId);
  return { ownerId: attemptId, username, email, password, sessionToken, recoveryToken, backup };
}

export async function agentFixture(origin: string, directory: string, name: string, inviteToken?: string) {
  const runtimeToken = credential(), continuationToken = credential();
  const command = { operationId: operationId(), attemptId: randomUUID(), runtimeToken, continuationToken,
    ...(inviteToken ? { inviteToken } : {}) };
  await privateJson(directory, 'agent-registration', { command,
    scope: `registration:${command.attemptId}`, action: 'register' });
  const registered = await fixtureOk(origin, '/registrations', command);
  const draft = await fixtureOk(origin, `/agents/${registered.agentId}/profile/draft`, { operationId: operationId(),
    expectedVersion: 1, expectedPolicyVersion: 1, fields: { displayName: name, avatar: { template: 'basic', color: 'blue' } } }, runtimeToken, 'PUT');
  const published = await fixtureOk(origin, `/agents/${registered.agentId}/profile/publish`, { operationId: operationId(),
    expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion }, runtimeToken);
  await fixtureOk(origin, `/agents/${registered.agentId}/membership/join`, { operationId: operationId(), expectedVersion: 1,
    expectedProfileVersion: published.version }, runtimeToken);
  return { agentId: String(registered.agentId), ownerId: String(registered.ownerId), runtimeToken, continuationToken, name };
}

export type AgentFixture = Awaited<ReturnType<typeof agentFixture>>;
export async function handoffFixture(origin: string, directory: string, agent: AgentFixture) {
  const handoffToken = credential(), id = operationId();
  await privateJson(directory, 'agent-handoff', { operationId: id, handoffToken,
    scope: `bootstrap:${agent.continuationToken.split('.')[0]}`, action: 'issueHandoff', expectedGeneration: 0 });
  const result = await fixtureOk(origin, '/agent/self/handoffs', { operationId: id, handoffToken, expectedGeneration: 0 }, agent.continuationToken);
  return { handoffToken, generation: Number(result.generation) };
}

export async function externalInvitedAgent(origin: string, directory: string, invite: Json, name: string) {
  const response = await fetch(`${origin}/agent/m1-agent.ts`, { redirect: 'error' });
  expect(response.status).toBe(200);
  const source = await response.text(), clientPath = join(directory, `client-${randomUUID()}.ts`);
  await writeFile(clientPath, source, { flag: 'wx', mode: 0o600 });
  const invitePath = await privateJson(directory, 'invite-input', invite), statePath = join(directory, `agent-${randomUUID()}.private.json`);
  let output: string;
  try { output = (await promisify(execFile)(process.execPath, [clientPath, 'onboard', '--url', origin, '--state', statePath,
    '--name', name, '--invite-file', invitePath], { cwd: directory, timeout: 15_000 })).stdout; }
  catch { throw new Error('Downloaded client could not complete synthetic invited onboarding'); }
  const state = JSON.parse(await readFile(statePath, 'utf8')) as Json, summary = JSON.parse(output) as Json;
  expect([state.runtimeToken, state.continuationToken].every(value => !output.includes(value)), 'External client summary contains no runtime or continuation proof').toBe(true);
  expect(summary.membership).toBe('joined'); expect((await stat(statePath)).mode & 0o777).toBe(0o600);
  return { state, summary, name };
}

export function samePrivateFields(actual: Json, original: Json, fields: string[]) {
  for (const field of fields) expect(actual[field] === original[field], `Original ${field} remains unchanged`).toBe(true);
}
