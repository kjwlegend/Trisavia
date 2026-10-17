import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, allowReceiptProbe, idle, loginIdentifier, mutation, openHandoff, prepareRegistration, trackBackup } from './helpers/owner-account-ui.ts';
import type { PrivacyObservation } from './helpers/owner-account-ui.ts';
import { accountFixture, agentFixture, credential, fixtureOk, handoffFixture, privateDirectory, privateDownload, privateJson, samePrivateFields } from './helpers/private-fixtures.ts';
import type { Json } from './helpers/private-fixtures.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
async function pending(page: Page): Promise<Json> { return page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || 'null')); }
async function delayReceipt(page: Page, privacy: PrivacyObservation) {
  await page.route('**/v1/operations/**', async route => {
    privacy.allowStatus(new URL(route.request().url()).pathname, 503);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'commit_result_unknown' } }) });
  }, { times: 1 });
}
async function loseFirstRequest(page: Page, privacy: PrivacyObservation, path: string, committed: boolean) {
  let original: Json | undefined, durable = false, posts = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === `/v1${path}` && request.method() !== 'GET') posts++; });
  await delayReceipt(page, privacy); privacy.allowNetworkFailure(`/v1${path}`);
  await page.route(`**/v1${path}`, async route => {
    original = route.request().postDataJSON() as Json;
    const saved = await pending(page);
    durable = saved?.pendingOperation?.operationId === original.operationId && typeof saved.sessionToken === 'string'
      && (!original.sessionToken || original.sessionToken === saved.sessionToken)
      && (!original.recoveryToken || original.recoveryToken === saved.recoveryToken)
      && (!original.password || !JSON.stringify(saved).includes(original.password));
    if (committed) await route.fetch(); // Only this branch actually reaches the server.
    await route.abort('failed');
  }, { times: 1 });
  return { original: () => original!, durable: () => durable, posts: () => posts };
}
async function waitUnknown(page: Page) { await expect(page.locator('#unknown-controls')).toBeVisible(); await idle(page); }

for (const committed of [false, true]) {
  const timing = committed ? 'committed response is lost' : 'request never reaches the server';

  test(`account registration resumes the original saved attempt after reload when its ${timing}`, async ({ page, baseURL, privacy }) => {
    const directory = await privateDirectory('m1-register-continuation-');
    try {
      const suffix = randomUUID().slice(0, 8), input = { username: `Retry_${suffix}`, email: `${suffix}@example.test`, password: `Retry-${randomUUID()}` };
      const backup = await prepareRegistration(page, directory, privacy, input); allowReceiptProbe(privacy, backup);
      const loss = await loseFirstRequest(page, privacy, '/owner/accounts', committed);
      await page.locator('#register-submit').click(); await waitUnknown(page);
      expect(loss.durable(), 'Full original key and successor proofs are persisted before registration').toBe(true);
      const saved = await pending(page); samePrivateFields(saved, backup, ['ownerId', 'sessionToken', 'recoveryToken']);
      const unrelated = credential(); privacy.track(unrelated);
      let previews = 0; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/owner-handoffs/')) previews++; });
      await page.evaluate(proof => { location.hash = `handoff=${encodeURIComponent(proof)}`; }, unrelated);
      await expect.poll(() => new URL(page.url()).hash.length).toBe(0);
      const preserved = await pending(page); samePrivateFields(preserved, saved, ['ownerId', 'sessionToken', 'recoveryToken']);
      samePrivateFields(preserved.pendingOperation, saved.pendingOperation, ['operationId', 'scope', 'action']);
      expect(previews, 'A new fragment does not replace or consume another target while registration is unresolved').toBe(0);
      await expect(page.locator('#unknown-controls'), 'A new handoff does not dismiss the unresolved original operation').toBeVisible();
      await expect(page.locator('#global-notice')).toHaveClass(/pending/);
      await page.reload(); await idle(page);
      if (!committed) {
        await page.locator('#register-password').fill(input.password);
        const again = await privateDownload(page, page.locator('#register-download'), directory); trackBackup(privacy, again);
        samePrivateFields(again, backup, ['ownerId', 'sessionToken', 'recoveryToken']);
        samePrivateFields(again.pendingOperation, backup.pendingOperation, ['operationId', 'scope', 'action']);
        await page.locator('#register-saved').check();
        let resumed = false; await page.route('**/v1/owner/accounts', async route => {
          const body = route.request().postDataJSON() as Json;
          resumed = ['attemptId', 'operationId', 'username', 'email', 'password', 'sessionToken', 'recoveryToken'].every(key => body[key] === loss.original()[key]);
          await route.continue();
        }, { times: 1 });
        await mutation(page, '/owner/accounts', page.locator('#register-submit')); expect(resumed).toBe(true);
      }
      await expect(page.locator('#empty-agents')).toBeVisible();
      expect((await fixtureOk(baseURL!, '/owner/account', undefined, backup.sessionToken)).ownerId).toBe(backup.ownerId);
      expect(loss.posts()).toBe(committed ? 1 : 2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test(`explicit Agent claim retains the authenticated owner and target after reload when its ${timing}`, async ({ page, baseURL, privacy }) => {
    const directory = await privateDirectory('m1-claim-continuation-');
    try {
      const owner = await accountFixture(baseURL!, directory), agent = await agentFixture(baseURL!, directory, 'Claim retry Agent');
      const handoff = await handoffFixture(baseURL!, directory, agent);
      await loginIdentifier(page, privacy, owner.username, owner.password); await openHandoff(page, privacy, handoff.handoffToken);
      const loss = await loseFirstRequest(page, privacy, '/owner/agent-claims', committed);
      await page.locator('#claim-confirm').click(); await waitUnknown(page);
      const saved = await pending(page); allowReceiptProbe(privacy, saved);
      expect(loss.durable()).toBe(true); expect(saved.pendingOperation.scope).toBe(`owner:${owner.ownerId}`);
      expect(saved.pendingOperation.input.agentId).toBe(agent.agentId); expect(saved.claimContext.agentId).toBe(agent.agentId);
      expect(saved.claimContext.handoffToken === handoff.handoffToken).toBe(true);
      let targetReads = 0;
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/owner/agents')) targetReads++; });
      await page.evaluate(target => { location.hash = `agent=${target}`; }, randomUUID());
      await expect.poll(() => new URL(page.url()).hash.length).toBe(0);
      const preserved = await pending(page);
      samePrivateFields(preserved, saved, ['ownerId', 'sessionToken']);
      expect(JSON.stringify(preserved.pendingOperation) === JSON.stringify(saved.pendingOperation), 'An unresolved claim retains its complete original command when another target URL arrives').toBe(true);
      expect(JSON.stringify(preserved.claimContext) === JSON.stringify(saved.claimContext), 'The explicit claim keeps the original Agent and its proof').toBe(true);
      expect(targetReads, 'A target URL cannot start a competing read while the claim result is unknown').toBe(0);
      await expect(page.locator('#unknown-controls')).toBeVisible();
      await expect(page.locator('#global-notice')).toHaveClass(/pending/);
      await page.reload(); await idle(page);
      if (!committed) {
        await expect(page.locator('#claim-account')).toContainText(owner.username);
        await expect(page.locator('#claim-agent-summary')).toContainText(agent.name);
        let resumed = false; await page.route('**/v1/owner/agent-claims', async route => {
          const body = route.request().postDataJSON() as Json;
          resumed = ['operationId', 'agentId', 'expectedGeneration', 'handoffToken'].every(key => body[key] === loss.original()[key]);
          await route.continue();
        }, { times: 1 });
        await mutation(page, '/owner/agent-claims', page.locator('#claim-confirm')); expect(resumed).toBe(true);
      }
      await expect(page.locator('#selected-id')).toContainText(agent.agentId); expect(loss.posts()).toBe(committed ? 1 : 2);
      expect((await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken)).ownerId).toBe(owner.ownerId);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test(`identifier login exports and imports proof-bound progress without an owner ID when its ${timing}`, async ({ page, baseURL, privacy }) => {
    const directory = await privateDirectory('m1-identifier-login-continuation-');
    try {
      const owner = await accountFixture(baseURL!, directory); privacy.password(owner.password);
      await page.goto('/owner#login'); await page.locator('#login-identifier').fill(owner.email); await page.locator('#login-password').fill(owner.password);
      const loss = await loseFirstRequest(page, privacy, '/owner/sessions', committed);
      await page.locator('#login-submit').click(); await waitUnknown(page);
      const saved = await pending(page); allowReceiptProbe(privacy, saved); trackBackup(privacy, saved);
      expect(saved.format).toBe('connet-owner-v2'); expect('ownerId' in saved).toBe(false);
      expect(['recoveryToken', 'setupToken', 'sourceRecoveryToken', 'setupExchange'].every(key => !(key in saved)), 'Ownerless pending login carries only its own session proof').toBe(true);
      expect(saved.pendingOperation.scope).toBe(`owner-login:${saved.sessionToken.split('.')[0]}`); expect(loss.durable()).toBe(true);
      const progress = await privateDownload(page, page.locator('#prepare-auth-exit'), directory);
      expect(progress.format).toBe('connet-owner-v2'); expect('ownerId' in progress).toBe(false);
      await page.locator('#auth-exit-saved').check(); await page.locator('#confirm-auth-exit').click();
      await page.locator('#sign-in-view > .login-help > summary').click(); await page.locator('#import-help').click();
      await page.locator('#credentials-import').setInputFiles(await privateJson(directory, 'login-progress', progress)); await idle(page);
      await page.reload(); await idle(page);
      if (!committed) {
        await expect(page.locator('#login-identifier')).toHaveValue(owner.email);
        await page.locator('#login-password').fill(owner.password);
        let resumed = false; await page.route('**/v1/owner/sessions', async route => {
          const body = route.request().postDataJSON() as Json;
          resumed = ['operationId', 'identifier', 'password', 'sessionToken'].every(key => body[key] === loss.original()[key]) && !('ownerId' in body);
          await route.continue();
        }, { times: 1 });
        await mutation(page, '/owner/sessions', page.locator('#login-submit')); expect(resumed).toBe(true);
      }
      await expect(page.locator('#empty-agents')).toBeVisible(); expect(loss.posts()).toBe(committed ? 1 : 2);
      expect((await pending(page)).ownerId).toBe(owner.ownerId);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
