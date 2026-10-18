import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, idle, loginIdentifier, mutation, trackBackup } from './helpers/owner-account-ui.ts';
import { accountFixture, agentFixture, credential, fixtureOk, fixtureRequest, operationId, privateDirectory, privateDownload, privateJson } from './helpers/private-fixtures.ts';
import type { Json } from './helpers/private-fixtures.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
async function ownedAgent(origin: string, directory: string, owner: Awaited<ReturnType<typeof accountFixture>>, name: string) {
  const inviteToken = credential(); await privateJson(directory, 'invite', { inviteToken });
  await fixtureOk(origin, '/owner/agent-invites', { operationId: operationId(), inviteToken }, owner.sessionToken);
  return agentFixture(origin, directory, name, inviteToken);
}
async function select(page: Page, id: string) {
  await page.locator(`#agent-list button[data-agent-id="${id}"]`).click();
  await expect(page.locator('#selected-id')).toContainText(id);
}
async function vault(page: Page): Promise<Json> { return page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}')); }
async function openProgressImport(page: Page) {
  const security = page.locator('#management-security');
  if (await security.getAttribute('open') === null) await security.locator(':scope > summary').click();
  await page.getByRole('button', { name: '继续已保存进度', exact: true }).click();
  await expect(page.locator('#credentials-import')).toBeVisible();
}

test('owner withdraws public data without losing private drafts, unsaved inputs, membership or another Agent and can publish again', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('foundation-withdraw-');
  try {
    const owner = await accountFixture(baseURL!, directory), first = await ownedAgent(baseURL!, directory, owner, '可撤回的居民'), second = await ownedAgent(baseURL!, directory, owner, '另一位保持公开');
    const before = await fixtureOk(baseURL!, '/agent/self', undefined, first.runtimeToken), otherBefore = await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken);
    await loginIdentifier(page, privacy, owner.username, owner.password); await select(page, first.agentId);
    await page.getByLabel('居民名字', { exact: true }).fill('保留在表单的修改');
    page.once('dialog', dialog => { expect(dialog.message()).toContain('不会退出世界或被注销'); return dialog.accept(); });
    const result = await mutation(page, `/agents/${first.agentId}/profile/unpublish`, page.getByRole('button', { name: '撤回公开资料', exact: true }));
    expect(result.changed).toBe(true); await expect(page.locator('#unpublish-profile')).toBeDisabled();
    await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue('保留在表单的修改');
    const withdrawn = await fixtureOk(baseURL!, '/agent/self', undefined, first.runtimeToken);
    expect(withdrawn.profile.published).toBe(null); expect(withdrawn.profile.draft).toEqual(before.profile.draft);
    expect(withdrawn.membership).toEqual(before.membership); expect(withdrawn.ownerId).toBe(before.ownerId);
    expect((await fixtureRequest(baseURL!, `/public/agents/${first.agentId}`)).status).toBe(404);
    await page.getByRole('textbox', { name: '简介', exact: true }).fill('主人重新确认的公开简介');
    await page.getByLabel('衣服颜色', { exact: true }).selectOption('coral');
    await mutation(page, `/agents/${first.agentId}/profile/draft`, page.getByRole('button', { name: '保存草稿', exact: true }), 200, 'PUT');
    expect((await fixtureRequest(baseURL!, `/public/agents/${first.agentId}`)).status).toBe(404);
    await mutation(page, `/agents/${first.agentId}/profile/publish`, page.getByRole('button', { name: '发布资料', exact: true }));
    const published = await fixtureOk(baseURL!, `/public/agents/${first.agentId}`);
    expect(published.profile.displayName).toBe('保留在表单的修改'); expect(published.profile.bio).toBe('主人重新确认的公开简介'); expect(published.profile.avatar.color).toBe('coral');
    const otherAfter = await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken);
    expect(otherAfter.profile).toEqual(otherBefore.profile); expect(otherAfter.membership).toEqual(otherBefore.membership);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const committed of [false, true]) test(`withdrawal progress survives export, invalidated session and same-owner login when the ${committed ? 'committed response is lost' : 'request never reached the service'}`, async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('foundation-withdraw-resume-');
  try {
    const owner = await accountFixture(baseURL!, directory), first = await ownedAgent(baseURL!, directory, owner, '原撤回目标'), second = await ownedAgent(baseURL!, directory, owner, '不能串入的目标');
    await loginIdentifier(page, privacy, owner.username, owner.password); await select(page, first.agentId);
    const endpoint = `/v1/agents/${first.agentId}/profile/unpublish`; let posts = 0, original: Json | undefined;
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint && request.method() === 'POST') posts++; });
    privacy.allowNetworkFailure(endpoint);
    await page.route('**/v1/operations/**', async route => {
      privacy.allowStatus(new URL(route.request().url()).pathname, 503);
      await route.fulfill({ status: 503, json: { error: { code: 'commit_result_unknown' } } });
    }, { times: 1 });
    await page.route(`**${endpoint}`, async route => {
      original = route.request().postDataJSON(); const saved = await vault(page);
      expect(saved.pendingOperation.operationId).toBe(original!.operationId); expect(saved.pendingOperation.targetId).toBe(first.agentId);
      expect(saved.pendingOperation.input.expectedVersion).toBe(original!.expectedVersion);
      if (committed) await route.fetch(); await route.abort('failed');
    }, { times: 1 });
    page.once('dialog', dialog => dialog.accept()); await page.locator('#unpublish-profile').click();
    await expect(page.locator('#unknown-controls')).toBeVisible(); await idle(page);
    const pending = await vault(page); trackBackup(privacy, pending);
    await page.evaluate(id => { location.hash = `agent=${id}`; }, second.agentId);
    await expect.poll(() => new URL(page.url()).hash.length).toBe(0);
    expect((await vault(page)).pendingOperation.targetId).toBe(first.agentId);
    const backup = await privateDownload(page, page.locator('#prepare-auth-exit'), directory); trackBackup(privacy, backup);
    await page.locator('#auth-exit-saved').check(); await page.locator('#confirm-auth-exit').click();
    expect((await vault(page)).sessionToken).toBeUndefined();
    const newPassword = `Recovered-${randomUUID()}`, sessionToken = credential(), recoveryToken = credential(), recoveryOperation = operationId();
    await privateJson(directory, 'saved-next-owner-proofs', { sessionToken, recoveryToken, operationId: recoveryOperation });
    await fixtureOk(baseURL!, '/owner/recoveries', { operationId: recoveryOperation, password: newPassword, sessionToken, recoveryToken, credentialsSaved: true }, owner.recoveryToken);
    await loginIdentifier(page, privacy, owner.username, newPassword);
    const current = await vault(page); trackBackup(privacy, current);
    expect(current.sessionToken === backup.sessionToken).toBe(false);
    await openProgressImport(page);
    const file = await privateJson(directory, 'exported-withdrawal', backup);
    privacy.allowStatus(`/v1/operations/${original!.operationId}`, 404, 2);
    await page.locator('#credentials-import').setInputFiles(file); await idle(page);
    if (!committed) {
      await expect(page.locator('#unknown-controls')).toBeVisible();
      const resumed = await vault(page); expect(resumed.pendingOperation.operationId).toBe(original!.operationId);
      let sameBody = false; await page.route(`**${endpoint}`, async route => { sameBody = JSON.stringify(route.request().postDataJSON()) === JSON.stringify(original); await route.continue(); }, { times: 1 });
      await mutation(page, `/agents/${first.agentId}/profile/unpublish`, page.locator('#check-result')); expect(sameBody).toBe(true);
    }
    const final = await vault(page);
    expect(final.sessionToken === current.sessionToken, 'Import preserves the newly authenticated session').toBe(true);
    expect(final.recoveryToken === current.recoveryToken, 'Import cannot replace current recovery material with an older file').toBe(true);
    expect(final.pendingOperation).toBeUndefined(); expect(posts).toBe(committed ? 1 : 2);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, first.runtimeToken)).profile.published).toBe(null);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken)).profile.published.displayName).toBe(second.name);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an authenticated owner cannot import another owner withdrawal or send its proof to a different origin', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('foundation-withdraw-import-');
  try {
    const firstOwner = await accountFixture(baseURL!, directory), target = await ownedAgent(baseURL!, directory, firstOwner, '不属于当前账号的居民');
    const currentOwner = await accountFixture(baseURL!, directory); await ownedAgent(baseURL!, directory, currentOwner, '当前账号自己的居民');
    await loginIdentifier(page, privacy, currentOwner.username, currentOwner.password);
    const current = await vault(page); trackBackup(privacy, current);
    const profile = await fixtureOk(baseURL!, `/agents/${target.agentId}/profile`, undefined, firstOwner.sessionToken);
    const backup = { format: 'connet-owner-v2', origin: baseURL!, ownerId: firstOwner.ownerId, sessionToken: firstOwner.sessionToken,
      pendingOperation: { operationId: operationId(), scope: `owner:${firstOwner.ownerId}`, action: 'unpublishProfile', targetId: target.agentId,
        input: { expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion }, uncertain: true } };
    trackBackup(privacy, backup); await openProgressImport(page);
    const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
    await page.locator('#credentials-import').setInputFiles(await privateJson(directory, 'other-owner', backup)); await idle(page);
    await expect(page.locator('#global-notice')).toContainText('不属于当前账号');
    expect(JSON.stringify(await vault(page)) === JSON.stringify(current), 'Another account file cannot replace current credentials or install its pending target').toBe(true);
    await page.locator('#credentials-import').setInputFiles(await privateJson(directory, 'other-origin', { ...backup, origin: 'https://other.example' })); await idle(page);
    await expect(page.locator('#global-notice')).toContainText('另一个网站');
    expect(JSON.stringify(await vault(page)) === JSON.stringify(current), 'An origin mismatch cannot replace the authenticated vault').toBe(true);
    expect(writes).toEqual([]);
    expect((await fixtureOk(baseURL!, `/public/agents/${target.agentId}`)).profile.displayName).toBe(target.name);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
