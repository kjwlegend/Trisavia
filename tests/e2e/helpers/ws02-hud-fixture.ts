import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';
import { buildApp } from '../../../apps/platform/app.ts';
import { loadEmailConfig } from '../../../apps/platform/infrastructure/email/resend.ts';
import { postgresFixture } from '../../api/postgresql-fixture.ts';
import { agentFixture, injectApi, ownerFixture, type Json } from '../../../scripts/agent-manager-qa-fixture.ts';
import { privateJson } from './private-fixtures.ts';

// Opt-in Node browser stories own this temporary instance and never use the
// shared Playwright webServer, an existing QA identity, or a user's environment.
export async function ws02Fixture(t: TestContext, options: {
  accounts?: boolean;
  viewport?: { width: number; height: number };
  reducedMotion?: 'reduce' | 'no-preference';
} = {}) {
  const pg = await postgresFixture(), directory = pg.directory, email = loadEmailConfig({ M1_EMAIL_MODE: 'experience' });
  const config = { ...pg.options, ...(email ? { email } : {}) };
  const app = await buildApp(config), api = injectApi(app);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const issues: string[] = [], secrets = new Set<string>(), expected = new Map<string, number>();
  const writes: { method: string; path: string }[] = [];
  t.after(async () => {
    try { assert.deepEqual(issues, [], 'No unexpected browser failures or private material in URLs'); }
    finally {
      try { await browser?.close(); }
      finally { try { await app.close(); } finally { await pg.dispose(); } }
    }
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  function track(...values: unknown[]) {
    for (const value of values) if (typeof value === 'string' && value) {
      secrets.add(value);
      if (/^[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}$/.test(value)) secrets.add(value.split('.')[1]!);
    }
  }
  const owners: { owner: Json; agents: Json[] }[] = [];
  if (options.accounts) for (const label of ['A', 'B']) {
    const owner = await ownerFixture(api, `HUD${label}`, async value => {
      track(value.email, value.password, value.browserToken, value.sessionToken);
      await privateJson(directory, 'owner-command', { ownerId: value.ownerId, browserToken: value.browserToken, sessionToken: value.sessionToken });
    });
    const agents: Json[] = [];
    for (const [name, color] of label === 'A' ? [['演示隔离甲', 'blue'], ['演示隔离乙', 'coral']] : [['另一个主人的角色', 'cream']]) {
      const agent = await agentFixture(api, owner, name!, color!, async value => {
        track(value.runtimeToken, value.continuationToken, value.inviteToken);
        await privateJson(directory, 'agent-command', value);
      });
      agents.push(agent);
    }
    owners.push({ owner, agents });
  }
  browser = await chromium.launch({ headless: true,
    ...(process.env.M1_TEST_CHROMIUM_PATH ? { executablePath: process.env.M1_TEST_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 },
    reducedMotion: options.reducedMotion ?? 'no-preference' });
  const consume = (channel: string, path: string, marker: string) => {
    const key = `${channel} ${path} ${marker}`, count = expected.get(key) ?? 0;
    if (!count) return false;
    expected.set(key, count - 1); return true;
  };
  const allow = (channel: string, path: string, marker: string, count = 1) => {
    const key = `${channel} ${path} ${marker}`; expected.set(key, (expected.get(key) ?? 0) + count);
  };
  function observe(page: Page) {
    page.on('pageerror', () => issues.push('pageerror'));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      let path = ''; try { path = new URL(message.location().url).pathname; } catch {}
      const status = message.text().match(/status of (\d+)/)?.[1];
      if (status && consume('console', path, status)) return;
      if (message.text().includes('net::ERR_FAILED') && consume('console', path, 'failed')) return;
      issues.push(`console.error ${path}`);
    });
    page.on('requestfailed', request => {
      const path = new URL(request.url()).pathname, reason = request.failure()?.errorText;
      if (reason === 'net::ERR_ABORTED') return;
      if (reason === 'net::ERR_FAILED' && consume('network', path, 'failed')) return;
      issues.push(`network ${path}`);
    });
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400 && !consume('response', path, String(response.status()))) issues.push(`HTTP ${response.status()} ${path}`);
    });
    page.on('request', request => {
      const url = request.url(), path = new URL(url).pathname;
      if (path.startsWith('/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), path });
      if (/[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}/.test(url)
        || [...secrets].some(value => url.includes(value) || url.includes(encodeURIComponent(value)))) issues.push('private_material_in_url');
    });
  }
  context.on('page', observe);
  const page = await context.newPage();
  async function login(owner: Json) {
    await page.locator('#hud-account').click();
    await expect(page.locator('#login-identifier')).toBeVisible();
    await page.locator('#login-identifier').fill(owner.username); await page.locator('#login-password').fill(owner.password);
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/owner/sessions' && response.request().method() === 'POST');
    await expect(page.locator('#hud-window')).toHaveAttribute('data-panel-state', 'open');
    const submit = (await page.locator('#login-submit').boundingBox())!, size = page.viewportSize()!;
    assert(submit.y >= 0 && submit.y + submit.height <= size.height, 'The real login submit action is visible before a native pointer click');
    await page.mouse.click(submit.x + submit.width / 2, submit.y + submit.height / 2); assert.equal((await submitted).status(), 200);
    await expect(page.locator('#manage-view')).toBeVisible(); await expect(page.locator('#account-root')).toHaveAttribute('aria-busy', 'false');
    const current = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}')) as Json;
    track(current.sessionToken, current.recoveryToken); assert.equal(current.ownerId, owner.ownerId);
  }
  async function logout() {
    if (!(await page.locator('#manage-view').isVisible())) await page.locator('#hud-account').click();
    await page.locator('[data-manager-page="security"]').click(); await page.locator('#logout').click();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('connet.owner.v2') === null)).toBe(true);
  }
  return { page, context, directory, origin, api, owners, writes, track, login, logout, config, store: pg.store,
    allowStatus(path: string, status: number, count = 1) { allow('response', path, String(status), count); allow('console', path, String(status), count); },
    allowAbort(path: string, count = 1) { allow('network', path, 'failed', count); allow('console', path, 'failed', count); } };
}
