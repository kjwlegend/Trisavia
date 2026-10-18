import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, idle, loginIdentifier, logout, mutation, openHandoff, prepareRegistration, trackBackup } from './helpers/owner-account-ui.ts';
import type { PrivacyObservation } from './helpers/owner-account-ui.ts';
import { accountFixture, agentFixture, credential, fixtureOk, fixtureRequest, handoffFixture, operationId, privateDirectory, privateDownload, privateJson } from './helpers/private-fixtures.ts';
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

test('FND-U01 viewing forgotten-password help before a same-document handoff still completes the new owner setup in management', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('foundation-forgot-then-handoff-');
  try {
    const fields = (prefix: string) => { const suffix = randomUUID().replaceAll('-', '').slice(0, 10); return {
      username: `${prefix}_${suffix}`, email: `${prefix.toLowerCase()}-${suffix}@example.test`, password: `Synthetic-${randomUUID()}`,
    }; };
    const prior = fields('Prior'), firstBackup = await prepareRegistration(page, directory, privacy, prior);
    await mutation(page, '/owner/accounts', page.locator('#register-submit'));
    await expect(page.getByRole('heading', { name: '我的 Agent', exact: true })).toBeVisible();
    await logout(page);
    await page.getByRole('button', { name: '忘记密码？', exact: true }).click();
    await expect(page.getByLabel('选择登录备份', { exact: true })).toBeVisible();
    expect(await page.getByLabel('选择登录备份', { exact: true }).evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
    const agent = await agentFixture(baseURL!, directory, '切换任务后的新居民'), handoff = await handoffFixture(baseURL!, directory, agent), next = fields('New');
    privacy.password(next.password); privacy.track(next.email, agent.runtimeToken, agent.continuationToken);
    const recoveryCalls: string[] = [];
    page.on('request', request => { const path = new URL(request.url()).pathname;
      if (path === '/v1/owner/recovery' || path === '/v1/owner/recoveries') recoveryCalls.push(`${request.method()} ${path}`);
    });
    await openHandoff(page, privacy, handoff.handoffToken, true);
    await mutation(page, '/owner-setups', page.getByRole('button', { name: '开始设置', exact: true }));
    await page.locator('#setup-username').fill(next.username); await page.locator('#setup-email').fill(next.email);
    await page.locator('#setup-password').fill(next.password); await page.locator('#setup-next').click();
    const backup = await privateDownload(page, page.locator('#credentials-download'), directory); trackBackup(privacy, backup);
    expect(backup.pendingOperation.action).toBe('completeSetup');
    await expect(page.locator('#setup-complete')).toBeDisabled(); await page.locator('#setup-saved').check();
    const completed = await mutation(page, '/owner/setup/complete', page.getByRole('button', { name: '创建账号并关联 Agent', exact: true }));
    expect(completed.ownerId).toBe(backup.ownerId);
    const actual = await fixtureOk(baseURL!, '/owner/account', undefined, backup.sessionToken);
    expect(actual.username).toBe(next.username);
    const self = await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken);
    expect(self.ownerId).toBe(backup.ownerId); expect(self.management.managementStatus).toBe('managed');
    await expect(page.getByRole('heading', { name: '我的 Agent', exact: true })).toBeVisible();
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
    await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(agent.name);
    await expect(page.locator('#forgot-view')).toBeHidden(); await expect(page.locator('#recovery-form')).toBeHidden();
    expect(recoveryCalls, 'A completed new setup must not enter owner recovery due to an earlier help-page visit').toEqual([]);
    expect((await fixtureOk(baseURL!, '/owner/agents', undefined, firstBackup.sessionToken)).agents).toHaveLength(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
async function assistanceFixture(origin: string, directory: string, agent: Awaited<ReturnType<typeof agentFixture>>) {
  const assistanceToken = credential(), id = operationId();
  await privateJson(directory, 'assistance-command', { operationId: id, assistanceToken, scope: `agent:${agent.agentId}`, action: 'createRecoveryRequest' });
  const result = await fixtureOk(origin, '/agent/self/owner-recovery-requests', { operationId: id, assistanceToken }, agent.runtimeToken);
  return { assistanceToken, requestId: result.requestId as string };
}
async function openAssistance(page: Page, privacy: PrivacyObservation, proof: string) {
  privacy.track(proof); await page.goto('/');
  await page.evaluate(value => { location.assign(`/owner#assistance=${encodeURIComponent(value)}`); }, proof);
  await expect.poll(() => new URL(page.url()).hash.length, { message: 'Private assistance fragment is removed immediately' }).toBe(0);
  await idle(page); await expect(page.locator('#assistance-context')).toBeVisible();
}

test('only the authenticated bound owner can decline assistance without a backup and neither session can use it to reset a password', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('foundation-assistance-reject-');
  try {
    const owner = await accountFixture(baseURL!, directory), agent = await ownedAgent(baseURL!, directory, owner, '等待主人确认的居民');
    const other = await accountFixture(baseURL!, directory), request = await assistanceFixture(baseURL!, directory, agent);
    const before = await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken);
    await loginIdentifier(page, privacy, other.username, other.password); const foreignVault = await vault(page);
    trackBackup(privacy, foreignVault); await openAssistance(page, privacy, request.assistanceToken);
    await expect(page.getByRole('button', { name: '拒绝本次协助', exact: true })).toBeHidden();
    await expect(page.locator('#recovery-form')).toBeHidden();
    expect(JSON.stringify(await vault(page)) === JSON.stringify(foreignVault), 'Another account does not adopt the target owner or any proof').toBe(true);
    expect((await fixtureOk(baseURL!, `/agent/self/owner-recovery-requests/${request.requestId}`, undefined, agent.runtimeToken)).status).toBe('pending');
    await page.locator('#back-to-login').click(); await loginIdentifier(page, privacy, owner.username, owner.password);
    const original = await vault(page); trackBackup(privacy, original); expect(original.recoveryToken).toBeUndefined();
    await openAssistance(page, privacy, request.assistanceToken);
    await expect(page.getByRole('button', { name: '拒绝本次协助', exact: true })).toBeEnabled();
    await expect(page.locator('#recovery-form')).toBeHidden();
    page.once('dialog', dialog => { expect(dialog.message()).toContain('密码和登录备份不会改变'); return dialog.accept(); });
    await mutation(page, '/owner/recovery-assistance/reject', page.getByRole('button', { name: '拒绝本次协助', exact: true }));
    await expect(page.locator('#assistance-status')).toHaveText('本次协助已取消');
    await expect(page.locator('#recovery-form')).toBeHidden(); await expect(page.locator('#credentials-import')).toBeHidden();
    const after = await vault(page);
    expect(after.sessionToken === original.sessionToken, 'Declining assistance retains the current session').toBe(true);
    expect(after.recoveryToken === original.recoveryToken, 'Declining assistance creates no replacement recovery material').toBe(true);
    expect(after.ownerId).toBe(owner.ownerId);
    await page.getByRole('button', { name: '返回我的 Agent', exact: true }).click();
    await expect(page.getByRole('heading', { name: '我的 Agent', exact: true })).toBeVisible();
    const final = await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken);
    expect(final.profile).toEqual(before.profile); expect(final.membership).toEqual(before.membership);
    expect((await fixtureOk(baseURL!, `/agent/self/owner-recovery-requests/${request.requestId}`, undefined, agent.runtimeToken)).status).toBe('cancelled');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const committed of [false, true]) test(`independent owner backup completes assistance after ${committed ? 'a committed response loss' : 'an unsent request'} using only the saved next proofs and original command`, async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('foundation-assisted-recovery-');
  try {
    const owner = await accountFixture(baseURL!, directory), agent = await ownedAgent(baseURL!, directory, owner, '恢复仍保留的居民');
    const other = await accountFixture(baseURL!, directory), request = await assistanceFixture(baseURL!, directory, agent);
    const before = await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken);
    await openAssistance(page, privacy, request.assistanceToken);
    const empty = await vault(page); trackBackup(privacy, other.backup);
    await page.getByLabel('选择登录备份', { exact: true }).setInputFiles(await privateJson(directory, 'wrong-owner-backup', other.backup)); await idle(page);
    await expect(page.locator('#global-notice')).toContainText('不属于');
    expect(JSON.stringify(await vault(page)) === JSON.stringify(empty), 'A wrong backup cannot replace the vault or assistance target').toBe(true);
    await expect(page.locator('#recovery-form')).toBeHidden();
    trackBackup(privacy, owner.backup);
    const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/owner/recovery-assistance/verify');
    await page.getByLabel('选择登录备份', { exact: true }).setInputFiles(await privateJson(directory, 'original-registration-backup', owner.backup));
    expect((await verified).status()).toBe(200); await idle(page);
    await expect(page.locator('#recovery-form')).toBeVisible(); await expect(page.locator('#assistance-status')).toContainText('主人备份已验证');
    const password = `Assisted-${randomUUID()}`; privacy.password(password);
    await page.getByLabel('新登录密码', { exact: true }).fill(password); await page.locator('#recovery-next').click();
    const prepared = await privateDownload(page, page.locator('#recovery-download'), directory); trackBackup(privacy, prepared);
    expect(prepared.pendingOperation.action).toBe('recover'); expect(prepared.pendingOperation.scope).toBe(`owner:${owner.ownerId}`);
    expect(prepared.assistanceContext.agentId).toBe(agent.agentId); expect(prepared.assistanceContext.requestId).toBe(request.requestId);
    expect(prepared.sourceRecoveryToken === owner.recoveryToken, 'Next backup preserves the original recovery proof only for the same command').toBe(true);
    let posts = 0, original: Json | undefined;
    page.on('request', event => { if (new URL(event.url()).pathname === '/v1/owner/recoveries' && event.method() === 'POST') posts++; });
    privacy.allowNetworkFailure('/v1/owner/recoveries');
    await page.route('**/v1/operations/**', async route => {
      privacy.allowStatus(new URL(route.request().url()).pathname, 503);
      await route.fulfill({ status: 503, json: { error: { code: 'commit_result_unknown' } } });
    }, { times: 1 });
    await page.route('**/v1/owner/recoveries', async route => {
      original = route.request().postDataJSON();
      const saved = await vault(page);
      expect(saved.pendingOperation.operationId).toBe(prepared.pendingOperation.operationId);
      expect(saved.sessionToken === prepared.sessionToken && saved.recoveryToken === prepared.recoveryToken, 'Both next proofs are persisted before consuming recovery').toBe(true);
      if (committed) await route.fetch(); await route.abort('failed');
    }, { times: 1 });
    await page.locator('#recovery-saved').check(); await page.getByRole('button', { name: '重设密码并完成协助', exact: true }).click();
    await expect(page.locator('#unknown-controls')).toBeVisible(); await idle(page);
    const pending = await vault(page); expect(pending.pendingOperation.action).toBe('recover');
    const exported = await privateDownload(page, page.locator('#prepare-auth-exit'), directory); trackBackup(privacy, exported);
    expect(exported.pendingOperation.operationId).toBe(prepared.pendingOperation.operationId);
    expect(exported.sessionToken === prepared.sessionToken && exported.recoveryToken === prepared.recoveryToken, 'Export keeps the exact next proofs').toBe(true);
    await page.locator('#auth-exit-saved').check(); await page.locator('#confirm-auth-exit').click();
    expect(await page.evaluate(() => !sessionStorage.getItem('connet.owner.assistance.v1') && !sessionStorage.getItem('connet.owner.v2')), 'Explicit exit clears the private entry and active proof').toBe(true);
    await page.locator('.login-help > summary').click();
    await page.getByRole('button', { name: '使用登录备份或继续上次操作', exact: true }).click();
    if (!committed) privacy.allowStatus(`/v1/operations/${prepared.pendingOperation.operationId}`, 401, 2);
    await page.getByLabel('选择登录备份', { exact: true }).setInputFiles(await privateJson(directory, 'same-recovery-progress', exported)); await idle(page);
    if (!committed) {
      await expect(page.locator('#recovery-resume-info')).toBeVisible();
      const resumed = await vault(page);
      expect(resumed.pendingOperation.operationId).toBe(prepared.pendingOperation.operationId);
      expect(resumed.sessionToken === prepared.sessionToken && resumed.recoveryToken === prepared.recoveryToken).toBe(true);
      await page.getByLabel('新登录密码', { exact: true }).fill(password); await page.locator('#recovery-next').click();
      const repeated = await privateDownload(page, page.locator('#recovery-download'), directory);
      expect(repeated.sessionToken === prepared.sessionToken && repeated.recoveryToken === prepared.recoveryToken).toBe(true);
      await page.locator('#recovery-saved').check();
      let identical = false; await page.route('**/v1/owner/recoveries', async route => { identical = JSON.stringify(route.request().postDataJSON()) === JSON.stringify(original); await route.continue(); }, { times: 1 });
      await mutation(page, '/owner/recoveries', page.getByRole('button', { name: '重设密码并完成协助', exact: true })); expect(identical).toBe(true);
    }
    await expect(page.getByRole('heading', { name: '我的 Agent', exact: true })).toBeVisible();
    await expect(page.locator('#global-notice')).toContainText('本次 Agent 协助已完成');
    const final = await vault(page); expect(final.pendingOperation).toBeUndefined();
    expect(final.sessionToken === prepared.sessionToken && final.recoveryToken === prepared.recoveryToken).toBe(true);
    expect(posts).toBe(committed ? 1 : 2);
    const self = await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken);
    expect(self.ownerId).toBe(owner.ownerId); expect(self.profile).toEqual(before.profile); expect(self.membership).toEqual(before.membership);
    expect((await fixtureOk(baseURL!, `/agent/self/owner-recovery-requests/${request.requestId}`, undefined, agent.runtimeToken)).status).toBe('completed');
    await openAssistance(page, privacy, request.assistanceToken);
    await expect(page.locator('#assistance-status')).toHaveText('本次协助已完成');
    await expect(page.locator('#credentials-import')).toBeHidden(); await expect(page.locator('#recovery-form')).toBeHidden();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
