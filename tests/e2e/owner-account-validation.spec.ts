import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, expect, loginIdentifier, logout, mutation, prepareRegistration, trackBackup } from './helpers/owner-account-ui.ts';
import { accountFixture, fixtureOk, fixtureRequest, privateDirectory, privateDownload } from './helpers/private-fixtures.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const fullWidth = (value: string) => [...value].map(char => /[A-Za-z0-9_]/.test(char) ? String.fromCharCode(char.charCodeAt(0) + 0xfee0) : char).join('');
async function occupiedMessage(page: import('@playwright/test').Page, field: 'username' | 'email') {
  const notice = page.locator('#global-notice');
  await expect(notice).toContainText(field === 'username' ? '用户名' : '邮箱');
  await expect(notice).toContainText(/已被使用|已占用|已使用|不可用/);
  await expect(notice).toContainText(/换|登录/);
  await expect(notice).not.toContainText(/须为|格式|填写有效/);
}

test('Chinese and mixed usernames fail before registration while normalized ASCII letters, digits and underscore create a usable account', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-account-ascii-');
  try {
    let registrations = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/v1/owner/accounts' && request.method() === 'POST') registrations++; });
    const password = `Synthetic-${randomUUID()}`; privacy.password(password);
    await page.goto('/owner#register');
    await page.locator('#register-email').fill('Ascii+case@Example.Test'); await page.locator('#register-password').fill(password);
    for (const username of ['主人', 'Owner主人']) {
      await page.locator('#register-username').fill(username); await page.locator('#register-next').click();
      await expect(page.locator('#global-notice')).toContainText('英文字母、数字或下划线');
      await expect(page.locator('#register-username')).toBeFocused(); await expect(page.locator('#register-backup-step')).toBeHidden();
      expect(registrations).toBe(0);
    }
    await page.locator('#register-username').fill('　ＱＡ＿１２３　'); await page.locator('#register-next').click();
    await expect(page.locator('#register-backup-step')).toBeVisible();
    expect(await page.locator('#global-notice').evaluate(node => (node as HTMLElement).hidden || !node.classList.contains('error')),
      'Corrected valid input clears the previous format error when entering the new backup step').toBe(true);
    const backup = await privateDownload(page, page.locator('#register-download'), directory); trackBackup(privacy, backup);
    expect(backup.pendingOperation.input.username).toBe('QA_123');
    await page.locator('#register-saved').check(); await mutation(page, '/owner/accounts', page.locator('#register-submit'));
    expect(registrations).toBe(1);
    expect((await fixtureOk(baseURL!, '/owner/account', undefined, backup.sessionToken)).username).toBe('QA_123');
    await logout(page); await loginIdentifier(page, privacy, 'ｑａ＿１２３', password);
    await expect(page.locator('#empty-agents')).toBeVisible();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const field of ['username', 'email'] as const) test(`a ${field} conflict is correctable with a new original command and newly confirmed backup`, async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-account-conflict-');
  try {
    const existing = await accountFixture(baseURL!, directory), suffix = randomUUID().slice(0, 8);
    const input = { username: field === 'username' ? fullWidth(existing.username.toLowerCase()) : `Fresh_${suffix}`,
      email: field === 'email' ? existing.email.toUpperCase() : `${suffix}@example.test`, password: `Synthetic-${randomUUID()}` };
    const first = await prepareRegistration(page, directory, privacy, input);
    privacy.allowStatus('/v1/owner/accounts', 409);
    const rejected = await mutation(page, '/owner/accounts', page.locator('#register-submit'), 409);
    expect(rejected.error.code).toBe(`${field}_unavailable`);
    await occupiedMessage(page, field);
    expect(JSON.stringify(rejected).includes(existing.ownerId) || JSON.stringify(rejected).includes(existing.email), 'Conflict response carries no other owner identity or email').toBe(false);
    await expect(page.locator('#register-fields')).toBeVisible(); await expect(page.locator('#register-email')).toHaveValue(input.email);
    await expect(page.locator('#register-username')).toHaveValue(first.pendingOperation.input.username);
    if (field === 'username') await page.locator('#register-username').fill(`Fixed_${suffix}`);
    else await page.locator('#register-email').fill(`fixed_${suffix}@example.test`);
    await page.locator('#register-next').click();
    const next = await privateDownload(page, page.locator('#register-download'), directory); trackBackup(privacy, next);
    expect(next.pendingOperation.operationId !== first.pendingOperation.operationId && next.ownerId !== first.ownerId
      && next.sessionToken !== first.sessionToken && next.recoveryToken !== first.recoveryToken, 'A corrected submission has a distinct command and proof material').toBe(true);
    await expect(page.locator('#register-submit')).toBeDisabled(); await page.locator('#register-saved').check();
    await mutation(page, '/owner/accounts', page.locator('#register-submit')); await expect(page.locator('#empty-agents')).toBeVisible();
    expect((await fixtureRequest(baseURL!, '/owner/account', undefined, first.sessionToken)).status).toBe(401);
    expect((await fixtureOk(baseURL!, '/owner/account', undefined, existing.sessionToken)).ownerId).toBe(existing.ownerId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
