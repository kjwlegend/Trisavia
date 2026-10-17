import { test as base, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { privateDownload } from './private-fixtures.ts';
import type { Json } from './private-fixtures.ts';

interface ExpectedFailure { path: string; marker: string; remaining: number }
export interface PrivacyObservation {
  track: (...values: string[]) => void;
  password: (value: string) => void;
  allowStatus: (path: string, status: number, count?: number) => void;
  allowNetworkFailure: (path: string) => void;
}
export const test = base.extend<{ privacy: PrivacyObservation }>({
  privacy: [async ({ page }, use) => {
    const issues: string[] = [], secrets = new Set<string>(), passwords = new Set<string>();
    const consoleFailures: ExpectedFailure[] = [], responseFailures: ExpectedFailure[] = [], networkFailures: ExpectedFailure[] = [];
    const consume = (planned: ExpectedFailure[], path: string, text: string) => {
      const match = planned.find(entry => entry.path === path && entry.remaining > 0 && text.includes(entry.marker));
      if (match) { match.remaining--; return true; } return false;
    };
    const track = (...values: string[]) => { for (const value of values) {
      secrets.add(value);
      if (/^[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}$/.test(value)) secrets.add(value.split('.')[1]!);
    } };
    page.on('pageerror', () => issues.push('pageerror'));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      let path = ''; try { path = new URL(message.location().url).pathname; } catch {}
      if (!consume(consoleFailures, path, message.text())) issues.push('console.error');
    });
    page.on('requestfailed', request => {
      const reason = request.failure()?.errorText ?? '';
      if (reason !== 'net::ERR_ABORTED' && !consume(networkFailures, new URL(request.url()).pathname, reason)) issues.push('requestfailed');
    });
    page.on('response', response => {
      if (response.status() >= 400 && !consume(responseFailures, new URL(response.url()).pathname, String(response.status()))) issues.push('http_failure');
    });
    page.on('request', request => {
      for (const value of secrets) if (request.url().includes(value) || request.url().includes(encodeURIComponent(value))) issues.push('private_material_in_url');
    });
    await use({ track, password: value => { track(value); passwords.add(value); },
      allowStatus: (path, status, count = 1) => {
        consoleFailures.push({ path, marker: `status of ${status}`, remaining: count });
        responseFailures.push({ path, marker: String(status), remaining: count });
      },
      allowNetworkFailure: path => {
        consoleFailures.push({ path, marker: 'net::ERR_FAILED', remaining: 1 });
        networkFailures.push({ path, marker: 'net::ERR_FAILED', remaining: 1 });
      },
    });
    expect(issues, 'Authentication journey has no unplanned browser/network failures or private URL material').toEqual([]);
    expect(await page.evaluate(values => values.every(value => !JSON.stringify(sessionStorage).includes(value)), [...passwords]), 'Plaintext passwords are never persisted in browser progress').toBe(true);
  }, { auto: true }],
});
export { expect };

export async function idle(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); }
export async function mutation(page: Page, path: string, button: Locator, status = 200, method = 'POST'): Promise<Json> {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === `/v1${path}` && response.request().method() === method);
  await button.click(); const response = await pending;
  expect(response.status(), 'Visible account operation returns the expected status').toBe(status);
  const value = await response.json() as Json; await idle(page); return value;
}
export function trackBackup(privacy: PrivacyObservation, backup: Json) {
  for (const key of ['sessionToken', 'recoveryToken', 'setupToken']) if (typeof backup[key] === 'string') privacy.track(backup[key]);
  for (const key of ['handoffToken', 'setupToken']) if (typeof backup.claimContext?.[key] === 'string') privacy.track(backup.claimContext[key]);
}
export function allowReceiptProbe(privacy: PrivacyObservation, backup: Json) {
  const path = `/v1/operations/${backup.pendingOperation.operationId}`;
  privacy.allowStatus(path, 401, 3); privacy.allowStatus(path, 404, 3);
}
export async function prepareRegistration(page: Page, directory: string, privacy: PrivacyObservation,
  fields: { username: string; email: string; password: string }, fromHome = false): Promise<Json> {
  privacy.password(fields.password); privacy.track(fields.email);
  if (fromHome) {
    await page.goto('/');
    const register = page.locator('header nav').getByRole('link', { name: '注册', exact: true });
    if (await register.isVisible()) await register.click();
    else { await page.locator('header nav').getByRole('link', { name: '注册／登录', exact: true }).click(); await page.locator('#show-register').click(); }
  } else await page.goto('/owner#register');
  await expect(page.locator('#register-form')).toBeVisible();
  await page.locator('#register-username').fill(fields.username); await page.locator('#register-email').fill(fields.email);
  await page.locator('#register-password').fill(fields.password); await page.locator('#register-next').click();
  const backup = await privateDownload(page, page.locator('#register-download'), directory); trackBackup(privacy, backup);
  expect(backup.format).toBe('connet-owner-v2'); expect(backup.pendingOperation.action).toBe('registerOwner');
  expect(backup.pendingOperation.scope).toBe(`owner-registration:${backup.ownerId}`);
  expect(backup.pendingOperation.input.attemptId).toBe(backup.ownerId);
  await expect(page.locator('#register-submit')).toBeDisabled();
  await page.locator('#register-saved').check(); return backup;
}
export async function loginIdentifier(page: Page, privacy: PrivacyObservation, identifier: string, password: string) {
  privacy.password(password); await page.goto('/owner#login');
  await page.locator('#login-identifier').fill(identifier); await page.locator('#login-password').fill(password);
  await mutation(page, '/owner/sessions', page.locator('#login-submit'));
  await expect(page.getByRole('heading', { name: '我的 Agent', exact: true })).toBeVisible();
}
export async function logout(page: Page) {
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('connet.owner.v2') === null && sessionStorage.getItem('connet.owner.progress.v2') === null), 'Logout clears active credentials and private archived progress').toBe(true);
}
export async function openHandoff(page: Page, privacy: PrivacyObservation, proof: string, sameDocument = false) {
  privacy.track(proof); if (!sameDocument) await page.goto('/');
  const documentOrigin = sameDocument ? await page.evaluate(() => performance.timeOrigin) : null;
  await page.evaluate(value => { location.assign(`/owner#handoff=${encodeURIComponent(value)}`); }, proof);
  await expect.poll(() => new URL(page.url()).hash.length, { message: 'Handoff fragment is immediately removed' }).toBe(0);
  if (sameDocument) expect(await page.evaluate(() => performance.timeOrigin), 'An existing /owner document handles the handoff without a full reload').toBe(documentOrigin);
  await idle(page);
}
