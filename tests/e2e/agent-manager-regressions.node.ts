// Intentionally opt-in: Node 24 --test this file. It owns an ephemeral HTTP
// server and browser context, so the shared Playwright webServer is never used.
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';
import { buildApp } from '../../apps/platform/app.ts';
import { loadEmailConfig } from '../../apps/platform/infrastructure/email/resend.ts';
import { postgresFixture } from '../api/postgresql-fixture.ts';
import { agentFixture, injectApi, ok, operationId, ownerFixture, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { privateDownload, privateJson } from './helpers/private-fixtures.ts';

async function vault(page: Page): Promise<Json> { return page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}')); }
async function idle(page: Page) { await expect(page.locator('#account-root')).toHaveAttribute('aria-busy', 'false'); }
async function fixture(t: TestContext) {
  const pg = await postgresFixture(), directory = pg.directory, email = loadEmailConfig({ M1_EMAIL_MODE: 'experience' });
  const app = await buildApp({ ...pg.options, ...(email ? { email } : {}) });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const issues: string[] = [], pageErrors: string[] = [], secrets = new Set<string>(), passwords = new Set<string>(), expected = new Map<string, number>();
  let ownListReads = 0;
  let page: Page | undefined;
  t.after(async () => {
    try {
      if (page && !page.isClosed()) assert(await page.evaluate(values => values.every(value => !JSON.stringify(sessionStorage).includes(value)), [...passwords]), 'Passwords are not persisted');
      assert.deepEqual(issues, [], 'Only explicitly injected failures are expected; no page errors or private URL material');
    } finally { try { await browser?.close(); } finally { try { await app.close(); } finally { await pg.dispose(); } } }
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 }), api = injectApi(app);
  const owner = await ownerFixture(api, 'UI', async value => { await privateJson(directory, 'owner-proofs', { browserToken: value.browserToken, sessionToken: value.sessionToken }); });
  const agent = await agentFixture(api, owner, '回归专用 Agent', 'blue', async value => {
    await privateJson(directory, 'agent-command', value);
  });
  browser = await chromium.launch({ headless: true, ...(process.env.M1_TEST_CHROMIUM_PATH ? { executablePath: process.env.M1_TEST_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  page = await context.newPage(); const currentPage = page;
  const track = (...values: unknown[]) => { for (const value of values) if (typeof value === 'string' && value) {
    secrets.add(value); if (/^[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}$/.test(value)) secrets.add(value.split('.')[1]!);
  } };
  track(owner.password, owner.email, owner.browserToken, owner.sessionToken, agent.runtimeToken, agent.continuationToken); passwords.add(owner.password);
  const allow = (channel: string, path: string, marker: string, count = 1) => expected.set(`${channel} ${path} ${marker}`, (expected.get(`${channel} ${path} ${marker}`) ?? 0) + count);
  const consume = (channel: string, path: string, text: string) => {
    for (const [key, remaining] of expected) if (remaining > 0 && key.startsWith(`${channel} ${path} `) && text.includes(key.slice(`${channel} ${path} `.length))) {
      expected.set(key, remaining - 1); return true;
    }
    return false;
  };
  currentPage.on('pageerror', error => {
    issues.push('pageerror'); let text = error.stack || error.message;
    for (const secret of secrets) text = text.replaceAll(secret, '[private]');
    pageErrors.push(text.replace(/[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}/g, '[proof]'));
  });
  currentPage.on('console', message => {
    if (message.type() !== 'error') return;
    let path = ''; try { path = new URL(message.location().url).pathname; } catch {}
    if (!consume('console', path, message.text())) issues.push(`console.error ${path}`);
  });
  currentPage.on('requestfailed', request => {
    const reason = request.failure()?.errorText ?? '', path = new URL(request.url()).pathname;
    if (reason !== 'net::ERR_ABORTED' && !consume('network', path, reason)) issues.push(`network ${path}`);
  });
  currentPage.on('response', response => {
    if (response.status() >= 400 && !consume('response', new URL(response.url()).pathname, String(response.status()))) issues.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  currentPage.on('request', request => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/v1/owner/agents') ownListReads++;
    for (const secret of secrets) if (request.url().includes(secret) || request.url().includes(encodeURIComponent(secret))) issues.push('private_material_in_url');
  });
  function allowStatus(path: string, status: number, count = 1) { allow('response', path, String(status), count); allow('console', path, `status of ${status}`, count); }
  function allowAbort(path: string) { allow('network', path, 'net::ERR_FAILED'); allow('console', path, 'net::ERR_FAILED'); }
  async function login() {
    await currentPage.goto(`${origin}/`); await currentPage.locator('#hud-account').click(); await expect(currentPage.locator('#login-identifier')).toBeVisible();
    await currentPage.locator('#login-identifier').fill(owner.username); await currentPage.locator('#login-password').fill(owner.password);
    const response = currentPage.waitForResponse(value => new URL(value.url()).pathname === '/v1/owner/sessions' && value.request().method() === 'POST');
    await currentPage.locator('#login-submit').click(); assert.equal((await response).status(), 200); await idle(currentPage);
    await expect(currentPage.locator('#manage-view')).toBeVisible(); await expect(currentPage.locator('#manager-object')).toContainText(owner.username);
    const state = await vault(currentPage); track(state.sessionToken, state.recoveryToken); return state;
  }
  async function policyPage() { await currentPage.locator('[data-manager-page="policy"]').click(); await expect(currentPage.locator('#policy-form')).toBeVisible(); await expect(currentPage.locator('#manager-object')).toContainText(agent.name); }
  const diagnostics = async () => ({ issues, pageErrors, ownListReads, busy: await currentPage.locator('#account-root').getAttribute('aria-busy'),
    hasPending: Boolean((await vault(currentPage)).pendingOperation), confirmationVisible: await currentPage.locator('.account-confirm').isVisible() });
  return { page: currentPage, directory, origin, api, owner, agent, login, policyPage, allowStatus, allowAbort, track, diagnostics };
}

for (const action of ['profilePolicy', 'participation'] as const) for (const committed of [false, true]) {
  test(`AM-R02 ${action} ${committed ? 'committed response lost' : 'request not submitted'} survives refresh and visible export/login/import`, { timeout: 45_000 }, async t => {
    const f = await fixture(t), { page, owner, agent } = f;
    const loggedIn = await f.login(); await f.policyPage();
    const endpoint = `/v1/owner/agents/${agent.agentId}/${action === 'profilePolicy' ? 'profile-policy' : 'participation'}`;
    let original: Json | undefined, blockReceipt = true, puts = 0;
    const bodies: Json[] = [], receipts: number[] = [];
    await page.route('**/v1/operations/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!original || path !== `/v1/operations/${original.operationId}`) { await route.continue(); return; }
      if (blockReceipt) { f.allowStatus(path, 503); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"commit_result_unknown"}}' }); }
      else { const response = await route.fetch(); receipts.push(response.status()); if (response.status() >= 400) f.allowStatus(path, response.status()); await route.fulfill({ response }); }
    });
    await page.route(`**${endpoint}`, async route => {
      puts++; const body = route.request().postDataJSON() as Json; bodies.push(body);
      if (!original) {
        original = body; const saved = await vault(page);
        assert.equal(saved.pendingOperation.action, action); assert.equal(saved.pendingOperation.scope, `owner:${owner.ownerId}`);
        assert.equal(saved.pendingOperation.targetId, agent.agentId); assert.equal(saved.pendingOperation.operationId, body.operationId);
        const { operationId: ignored, ...input } = body; assert.deepEqual(saved.pendingOperation.input, input, 'The full original intent is persisted before the request');
        if (committed) assert.equal((await route.fetch()).status(), 200);
        f.allowAbort(endpoint); await route.abort('failed');
      } else await route.continue();
    });
    if (action === 'profilePolicy') {
      await page.locator('#profile-mode').selectOption('owner_specified'); await page.locator('input[name="lock"][value="bio"]').check();
      await page.locator('#save-policy').click();
    } else {
      await page.locator('#pause-agent').click(); const confirmation = page.locator('.account-confirm:visible');
      await expect(confirmation.getByRole('heading', { name: '暂停 Agent 修改', exact: true })).toBeVisible(); await page.getByRole('button', { name: '确认', exact: true }).click();
    }
    try { await expect.poll(async () => Boolean((await vault(page)).pendingOperation?.uncertain)).toBe(true); }
    catch { assert.fail(`Expected an unknown persisted command after visible confirmation: ${JSON.stringify({ puts, notice: await page.locator('#global-notice').textContent(), ...await f.diagnostics() })}`); }
    await idle(page);
    const pending = (await vault(page)).pendingOperation;
    const before = await ok(f.api, 'GET', action === 'profilePolicy' ? `/agents/${agent.agentId}/profile` : `/agents/${agent.agentId}/membership`, undefined, owner.sessionToken);
    assert.equal(action === 'profilePolicy' ? before.mode === 'owner_specified' : before.ownerPaused, committed, 'The fault really distinguishes a committed write from an unsent one');
    if (!committed) blockReceipt = false;
    await page.reload(); await idle(page);
    assert.deepEqual((await vault(page)).pendingOperation.input, pending.input); assert.equal((await vault(page)).pendingOperation.operationId, pending.operationId);
    if (!committed) assert(receipts.includes(404), 'After reload the original receipt really is absent');
    const exported = await privateDownload(page, page.locator('#prepare-auth-exit'), f.directory);
    assert.equal(exported.pendingOperation.action, action); assert.equal(exported.pendingOperation.targetId, agent.agentId);
    assert.equal(exported.pendingOperation.operationId, original!.operationId); assert.deepEqual(exported.pendingOperation.input, pending.input); f.track(exported.sessionToken);
    const progressPath = await privateJson(f.directory, 'saved-progress', exported);
    await page.locator('#auth-exit-saved').check(); await page.locator('#confirm-auth-exit').click();
    assert(await page.evaluate(() => sessionStorage.getItem('connet.owner.v2') === null), 'Confirmed export exit clears the active private vault');
    const fresh = await f.login(); assert(fresh.sessionToken !== loggedIn.sessionToken, 'Normal login supplies a distinct current session');
    await page.locator('[data-manager-page="security"]').click();
    await page.getByRole('button', { name: '继续已保存进度', exact: true }).click();
    await expect(page.getByLabel('选择登录备份', { exact: true })).toBeVisible(); blockReceipt = false;
    await page.getByLabel('选择登录备份', { exact: true }).setInputFiles(progressPath); await idle(page);
    if (!committed) {
      const restored = await vault(page); assert.equal(restored.pendingOperation.operationId, pending.operationId); assert.deepEqual(restored.pendingOperation.input, pending.input);
      assert(restored.sessionToken === fresh.sessionToken, 'Import retains the newly authenticated session instead of the old file proof');
      const response = page.waitForResponse(value => new URL(value.url()).pathname === endpoint && value.request().method() === 'PUT');
      await page.locator('#check-result').click(); assert.equal((await response).status(), 200); await idle(page);
    }
    await expect.poll(async () => Boolean((await vault(page)).pendingOperation)).toBe(false);
    const final = await vault(page); assert(final.sessionToken === fresh.sessionToken, 'Receipt continuation never replaces the current session');
    assert.equal(puts, committed ? 1 : 2); assert(bodies.every(body => JSON.stringify(body) === JSON.stringify(original)), 'Every actual submission uses the identical original body');
    assert(committed ? receipts.includes(200) : receipts.includes(404));
    const result = await ok(f.api, 'GET', action === 'profilePolicy' ? `/agents/${agent.agentId}/profile` : `/agents/${agent.agentId}/membership`, undefined, fresh.sessionToken);
    if (action === 'profilePolicy') { assert.equal(result.mode, 'owner_specified'); assert.deepEqual(result.lockedFields, ['bio']); }
    else assert.equal(result.ownerPaused, true);
    const selector = new URLSearchParams({ scope: pending.scope, action });
    const receipt = await ok(f.api, 'GET', `/operations/${original!.operationId}?${selector}`, undefined, fresh.sessionToken);
    assert.equal(receipt.agentId, agent.agentId); assert.equal(receipt.operationId, original!.operationId);
    await expect(page.locator('#global-notice')).toHaveClass(/\bsuccess\b/);
  });
}

test('AM-R03 unsaved policy survives blocked adoption and cancelled navigation, then a clean explicit adoption succeeds', { timeout: 45_000 }, async t => {
  const f = await fixture(t), { page, agent, owner } = f;
  let profile = await ok(f.api, 'GET', `/agents/${agent.agentId}/profile`, undefined, owner.sessionToken);
  profile = await ok(f.api, 'PUT', `/owner/agents/${agent.agentId}/profile-policy`, { operationId: operationId(), expectedVersion: profile.version,
    expectedPolicyVersion: profile.policyVersion, mode: 'proposal_required', lockedFields: [] }, owner.sessionToken);
  await ok(f.api, 'PUT', `/agents/${agent.agentId}/profile/draft`, { operationId: operationId(), expectedVersion: profile.version,
    expectedPolicyVersion: profile.policyVersion, fields: { displayName: '明确确认后的提议', bio: '只有确认采用才公开' } }, agent.runtimeToken);
  await f.login(); await f.policyPage();
  let publishPosts = 0; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/profile/publish')) publishPosts++; });
  await expect(page.locator('#proposal-review')).toBeVisible();
  await page.locator('#profile-mode').selectOption('owner_specified'); await page.locator('input[name="lock"][value="bio"]').check();
  await expect(page.locator('#publish-profile')).toBeDisabled(); await expect(page.locator('#proposal-unsaved-note')).toBeVisible();
  await page.locator('[data-manager-page="overview"]').click();
  let confirmation = page.locator('.account-confirm:visible'); await expect(confirmation.getByRole('heading', { name: '离开当前编辑', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续原任务', exact: true }).click();
  await expect(page.locator('#profile-mode')).toHaveValue('owner_specified'); await expect(page.locator('input[name="lock"][value="bio"]')).toBeChecked();
  assert.equal(publishPosts, 0, 'Dirty policy has not been silently dropped or used to authorize publication');
  await page.locator('[data-manager-page="overview"]').click(); confirmation = page.locator('.account-confirm:visible');
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click(); await f.policyPage();
  await expect(page.locator('#profile-mode')).toHaveValue('proposal_required'); await expect(page.locator('input[name="lock"][value="bio"]')).not.toBeChecked();
  await expect(page.locator('#publish-profile')).toBeEnabled(); await page.locator('#publish-profile').click();
  confirmation = page.locator('.account-confirm:visible'); await expect(confirmation.getByRole('heading', { name: '确认采用这份资料', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续原任务', exact: true }).click(); assert.equal(publishPosts, 0);
  await expect(page.locator('#proposal-review')).toBeVisible();
  await page.locator('#publish-profile').click(); confirmation = page.locator('.account-confirm:visible');
  const response = page.waitForResponse(value => new URL(value.url()).pathname === `/v1/agents/${agent.agentId}/profile/publish` && value.request().method() === 'POST');
  await page.getByRole('button', { name: '确认采用并公开', exact: true }).click(); assert.equal((await response).status(), 200); await idle(page);
  assert.equal(publishPosts, 1); await expect(page.locator('#proposal-review')).toBeHidden();
  const actual = await ok(f.api, 'GET', `/agents/${agent.agentId}/profile`, undefined, owner.sessionToken);
  assert.equal(actual.published.displayName, '明确确认后的提议'); assert.equal(actual.mode, 'proposal_required'); assert.deepEqual(actual.lockedFields, []);
  assert.equal((await ok(f.api, 'GET', `/public/agents/${agent.agentId}`)).profile.displayName, '明确确认后的提议');
});

test('AM-D02 a native pointer save immediately after text editing writes once and updates the same public Agent', { timeout: 30_000 }, async t => {
  const f = await fixture(t), { page, agent } = f;
  const before = await f.login(); await page.locator('[data-manager-page="profile"]').click();
  const endpoint = `/v1/agents/${agent.agentId}/profile`, submissions: Json[] = [];
  page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === endpoint) submissions.push(request.postDataJSON() as Json); });
  await page.locator('#display-name').fill('鼠标直接保存的新名字'); await page.locator('#interests').fill('');
  await expect(page.locator('#save-profile')).toBeEnabled();
  const box = await page.locator('#save-profile').boundingBox(); assert(box, 'The real save action is visible');
  const response = page.waitForResponse(value => new URL(value.url()).pathname === endpoint && value.request().method() === 'PUT', { timeout: 8_000 });
  // Do not Tab/blur first or dispatch a DOM click: exercise pointer down/up while
  // the edited text input still owns focus, as in the reported user sequence.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const saved = await response; assert.equal(saved.status(), 200); await idle(page);
  assert.equal(submissions.length, 1); assert.equal(submissions[0]!.fields.displayName, '鼠标直接保存的新名字');
  assert(submissions[0]!.removeFields.includes('interests'));
  const actual = await ok(f.api, 'GET', `/public/agents/${agent.agentId}`);
  assert.equal(actual.agentId, agent.agentId); assert.equal(actual.profile.displayName, '鼠标直接保存的新名字'); assert.equal(actual.profile.avatar.color, 'blue');
  assert(!Object.hasOwn(actual.profile, 'interests')); await expect(page.locator('#manager-object')).toContainText('鼠标直接保存的新名字');
  await expect(page.locator('#display-name')).toHaveValue('鼠标直接保存的新名字'); await expect(page.locator('#interests')).toHaveValue('');
  const after = await vault(page); assert(after.ownerId === before.ownerId && after.sessionToken === before.sessionToken, 'Saving keeps the same authenticated identity');
});
