import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import { test, expect, idle, mutation, openHandoff, trackBackup } from './helpers/owner-account-ui.ts';
import type { PrivacyObservation } from './helpers/owner-account-ui.ts';
import { accountFixture, agentFixture, fixtureOk, fixtureRequest, handoffFixture, privateDirectory, privateDownload } from './helpers/private-fixtures.ts';
import type { Json } from './helpers/private-fixtures.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function beginSetup(page: Page, privacy: PrivacyObservation) {
  const request = page.waitForRequest(value => new URL(value.url()).pathname === '/v1/owner-setups' && value.method() === 'POST');
  const result = await mutation(page, '/owner-setups', page.locator('#setup-start'));
  const body = (await request).postDataJSON() as Json; privacy.track(body.setupToken);
  return { body, result };
}
async function setupBackup(page: Page, directory: string, privacy: PrivacyObservation, username: string, email: string, password: string) {
  privacy.password(password); privacy.track(email);
  await page.locator('#setup-username').fill(username); await page.locator('#setup-email').fill(email);
  await page.locator('#setup-password').fill(password); await page.locator('#setup-next').click();
  const backup = await privateDownload(page, page.locator('#credentials-download'), directory); trackBackup(privacy, backup);
  expect(backup.format).toBe('connet-owner-v2');
  await expect(page.locator('#setup-complete')).toBeDisabled(); await page.locator('#setup-saved').check(); return backup;
}
async function archivedSetup(page: Page) {
  const saved = page.locator('#saved-setup-progress');
  await expect(saved).toBeVisible();
  if (!(await saved.evaluate(node => (node as HTMLDetailsElement).open))) await saved.locator('summary').click();
  await expect(saved.locator('[data-setup-progress]')).toHaveCount(1);
  return saved;
}
async function twoFrames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }

test('a second same-document handoff can complete while the first restricted setup remains privately downloadable and resumable', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-setup-targets-');
  try {
    const first = await agentFixture(baseURL!, directory, 'First unfinished setup'), second = await agentFixture(baseURL!, directory, 'Second setup target');
    const firstLink = await handoffFixture(baseURL!, directory, first), secondLink = await handoffFixture(baseURL!, directory, second);
    await openHandoff(page, privacy, firstLink.handoffToken); const firstSetup = await beginSetup(page, privacy);
    await openHandoff(page, privacy, secondLink.handoffToken, true); const secondSetup = await beginSetup(page, privacy);
    expect(firstSetup.body.setupToken !== secondSetup.body.setupToken && firstSetup.body.operationId !== secondSetup.body.operationId,
      'Different targets receive independent setup proofs and exchange commands').toBe(true);
    await expect(page.locator('#setup-agent-id')).toHaveText(second.agentId);
    const suffix = randomUUID().slice(0, 8), backup = await setupBackup(page, directory, privacy, `Second_${suffix}`, `${suffix}@example.test`, `Synthetic-${randomUUID()}`);
    await mutation(page, '/owner/setup/complete', page.locator('#setup-complete'));
    await expect(page.locator('#selected-id')).toContainText(second.agentId);
    const saved = await archivedSetup(page);
    const original = await privateDownload(page, saved.getByRole('button', { name: `保存${first.name}的设置进度`, exact: true }), directory); trackBackup(privacy, original);
    expect(original.ownerId).toBe(first.ownerId);
    expect(original.setupToken === firstSetup.body.setupToken, 'Downloaded first progress retains its original restricted proof').toBe(true);
    expect(original.setupExchange.operationId === firstSetup.body.operationId && original.setupExchange.agentId === first.agentId
      && original.setupExchange.setupToken === firstSetup.body.setupToken && original.setupExchange.handoffToken === firstLink.handoffToken,
      'First progress retains its exact target and original exchange material').toBe(true);
    await saved.getByRole('button', { name: `继续为${first.name}设置`, exact: true }).click(); await idle(page);
    await expect(page.locator('#claim-view')).toBeVisible(); await expect(page.locator('#claim-view')).toHaveAttribute('data-agent-id', first.agentId);
    await page.locator('#claim-cancel').click(); await expect(page.locator('#selected-id')).toContainText(second.agentId);
    expect((await fixtureOk(baseURL!, '/owner/setup', undefined, original.setupToken)).agentId).toBe(first.agentId);
    expect((await fixtureOk(baseURL!, '/owner/agents', undefined, backup.sessionToken)).agents[0].agentId).toBe(second.agentId);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, first.runtimeToken)).management.managementStatus).toBe('pending_setup');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const lost of [false, true]) test(`an old committed setup exchange ${lost ? 'lost response' : 'late response'} cannot overwrite a newly selected handoff`, async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-setup-exchange-race-');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = await agentFixture(baseURL!, directory, 'Delayed first setup'), second = await agentFixture(baseURL!, directory, 'New current setup');
    const firstLink = await handoffFixture(baseURL!, directory, first), secondLink = await handoffFixture(baseURL!, directory, second);
    await openHandoff(page, privacy, firstLink.handoffToken);
    let entered!: () => void, settled!: () => void, original: Json | undefined;
    const intercepted = new Promise<void>(resolve => { entered = resolve; }), finished = new Promise<void>(resolve => { settled = resolve; });
    const active = new Set<Request>();
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/')) active.add(request); });
    page.on('requestfinished', request => active.delete(request)); page.on('requestfailed', request => active.delete(request));
    if (lost) privacy.allowNetworkFailure('/v1/owner-setups');
    await page.route('**/v1/owner-setups', async route => {
      original = route.request().postDataJSON() as Json; privacy.track(original.setupToken);
      const response = await route.fetch(); expect(response.status()).toBe(200); entered(); await gate;
      try { if (lost) await route.abort('failed'); else await route.fulfill({ response }); }
      finally { settled(); }
    }, { times: 1 });
    await page.locator('#setup-start').click(); await intercepted;
    await openHandoff(page, privacy, secondLink.handoffToken, true); const current = await beginSetup(page, privacy);
    expect(current.body.setupToken !== original!.setupToken && current.body.operationId !== original!.operationId).toBe(true);
    release(); await finished; await twoFrames(page);
    await expect.poll(() => active.size, { message: 'Old exchange settlement and any guarded follow-up requests finish' }).toBe(0);
    await expect(page.locator('#setup-agent-id')).toHaveText(second.agentId);
    const saved = await archivedSetup(page);
    const backup = await privateDownload(page, saved.getByRole('button', { name: `保存${first.name}的设置进度`, exact: true }), directory); trackBackup(privacy, backup);
    expect(backup.setupToken === original!.setupToken && backup.setupExchange.operationId === original!.operationId
      && backup.setupExchange.agentId === first.agentId, 'Late and unknown exchange results preserve the original private material separately').toBe(true);
    let exchanges = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/v1/owner-setups' && request.method() === 'POST') exchanges++; });
    await openHandoff(page, privacy, firstLink.handoffToken, true);
    await expect(page.locator('#setup-agent-id')).toHaveText(first.agentId);
    expect(exchanges, 'Returning to a saved target locates its original setup without a new exchange').toBe(0);
    const currentVault = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}'));
    expect(currentVault.setupToken === backup.setupToken && currentVault.setupExchange.operationId === backup.setupExchange.operationId,
      'Automatic target location keeps the exact original exchange and proof').toBe(true);
    expect((await fixtureOk(baseURL!, '/owner/setup', undefined, backup.setupToken)).agentId).toBe(first.agentId);
  } finally { release(); await rm(directory, { recursive: true, force: true }); }
});

for (const field of ['username', 'email'] as const) test(`first setup explains occupied ${field}, preserves its Agent and recovers a corrected committed response loss`, async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-setup-account-conflict-');
  try {
    const occupied = await accountFixture(baseURL!, directory), agent = await agentFixture(baseURL!, directory, 'Setup conflict Agent');
    const link = await handoffFixture(baseURL!, directory, agent), suffix = randomUUID().slice(0, 8), password = `Synthetic-${randomUUID()}`;
    await openHandoff(page, privacy, link.handoffToken); const restricted = await beginSetup(page, privacy);
    const username = field === 'username' ? occupied.username.toLowerCase() : `Fresh_${suffix}`;
    const email = field === 'email' ? occupied.email.toUpperCase() : `${suffix}@example.test`;
    const rejectedBackup = await setupBackup(page, directory, privacy, username, email, password);
    privacy.allowStatus('/v1/owner/setup/complete', 409);
    const rejection = await mutation(page, '/owner/setup/complete', page.locator('#setup-complete'), 409);
    expect(rejection.error.code).toBe(`${field}_unavailable`);
    await expect(page.locator('#global-notice')).toContainText(field === 'username' ? '用户名' : '邮箱');
    await expect(page.locator('#global-notice')).toContainText(/已被使用|已占用|已使用|不可用/);
    await expect(page.locator('#global-notice')).toContainText(/换|登录/);
    await expect(page.locator('#global-notice')).not.toContainText(/须为|格式|填写有效/);
    await expect(page.locator('#setup-username')).toHaveValue(username); await expect(page.locator('#setup-email')).toHaveValue(email);
    expect((await fixtureOk(baseURL!, '/owner/setup', undefined, restricted.body.setupToken)).agentId).toBe(agent.agentId);
    expect((await fixtureRequest(baseURL!, '/owner/account', undefined, rejectedBackup.sessionToken)).status).toBe(401);
    const corrected = await setupBackup(page, directory, privacy, `Fixed_${suffix}`, `fixed_${suffix}@example.test`, password);
    expect(corrected.pendingOperation.operationId !== rejectedBackup.pendingOperation.operationId && corrected.sessionToken !== rejectedBackup.sessionToken,
      'A corrected rejected setup has a new completion command and saved successor proof').toBe(true);
    let submitted = 0; privacy.allowNetworkFailure('/v1/owner/setup/complete');
    await page.route('**/v1/owner/setup/complete', async route => { submitted++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); }, { times: 1 });
    await page.locator('#setup-complete').click(); await expect(page.locator('#selected-id')).toContainText(agent.agentId);
    expect(submitted).toBe(1); expect((await fixtureOk(baseURL!, '/owner/account', undefined, corrected.sessionToken)).ownerId).toBe(agent.ownerId);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken)).agentId).toBe(agent.agentId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
