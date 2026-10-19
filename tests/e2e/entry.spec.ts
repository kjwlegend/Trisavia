import { openHud, closeHud, worldMenu } from './helpers/hud-ui.ts';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);
function observations(page: Page) {
  const issues: string[] = [];
  let expectedPublic404 = false;
  page.on('pageerror', () => issues.push('pageerror'));
  page.on('console', message => {
    if (message.type() === 'error' && !(expectedPublic404 && message.text().includes('404'))) issues.push('consoleerror');
  });
  page.on('requestfailed', request => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') issues.push('requestfailed');
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.searchParams.has('handoff') || url.searchParams.has('token') || url.searchParams.has('password')) issues.push('secret_query');
  });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !(expectedPublic404 && response.status() === 404 && path.startsWith('/v1/public/agents/'))) issues.push('http_failure');
  });
  return { issues, allowPublicUnavailable: () => { expectedPublic404 = true; } };
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function touchNavigation(page: Page) {
  const links = [page.locator('#hud-account'), page.locator('#hud-agent-entry')];
  for (const link of links) {
    const box = await link.boundingBox();
    expect(Boolean(box && box.height >= 44 && box.width >= 44)).toBe(true);
  }
}

test('anonymous town offers equivalent venue details and same-origin HTTP entry without a resident directory', async ({ page, baseURL }, info) => {
  const observed = observations(page);
  const discoveryRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/')) discoveryRequests.push('api'); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('清昼小镇');
  await expect(page.locator('#world-canvas')).toBeVisible();
  await expect(page.getByText('演示世界 · 人物活动为场景演示', {exact:true})).toBeVisible();
  await expect(page.locator('.world-entry-copy')).toContainText('感知、互动与自动排程尚未启用');
  await page.locator('#world-place-directory > summary').click();
  await expect(page.locator('.world-place-group')).toHaveCount(6);
  const venue = page.getByRole('button', { name: '河岸书馆', exact: true });
  await venue.focus(); await venue.press('Enter');
  await expect(venue).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#world-detail-title')).toHaveText('河岸书馆');
  await expect(page.locator('#world-detail')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#world-detail')).toBeHidden();
  await expect(venue).toBeFocused();
  await page.locator('#connect > summary').click();
  await expect(page.locator('#agent-prompt')).toContainText(`${baseURL}/agent/entry.md`);
  await expect(page.getByRole('link', { name: '下载可选 Node 24 客户端' })).toHaveAttribute('href', '/agent/m1-agent.ts');
  await page.getByRole('button', { name: '复制接入提示词' }).click();
  await expect(page.locator('#copy-status')).toBeVisible();
  await fits(page);
  if (info.project.name === 'mobile') await touchNavigation(page);
  await page.screenshot({ path: info.outputPath('public-home.png'), fullPage: true });
  for (const name of ['entry.md', 'http-api.md', 'local-setup.md', 'prompt.md']) {
    const response = await page.request.get(`/agent/${name}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/markdown');
  }
  expect(discoveryRequests.length).toBe(0);
  expect(observed.issues).toEqual([]);
});

test('320px and reduced motion preserve the entry, venue controls and owner auth boundary', async ({ page }) => {
  const observed = observations(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await fits(page);
  await touchNavigation(page);
  await expect(page.locator('#world-canvas')).toBeVisible();
  const state = () => page.evaluate(async () => (await import(String('/assets/home.js'))).getWorldState());
  expect((await state()).paused).toBe(true);
  await openHud(page, '世界');
  await page.locator('#world-zoom-in').click();
  await expect(page.locator('#world-zoom')).toHaveText('125%');
  await page.locator('#world-canvas').focus(); await page.keyboard.press('Home');
  expect((await state()).mode).toBe('overview');
  await worldMenu(page); await page.locator('#world-reset').click();
  await expect(page.locator('#world-zoom')).toHaveText('100%');
  await page.locator('#world-place-directory > summary').click();
  await page.locator('#world-place-information-hall').click();
  await expect(page.locator('#world-detail-links a').first()).toHaveAttribute('href', '/agent/entry.md');
  await page.locator('#world-detail-close').click();
  await page.locator('#connect > summary').click();
  await expect(page.getByRole('button', { name: '复制接入提示词' })).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect((await state()).paused).toBe(true);
  await page.goto('/owner');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('#login-form').getByLabel('登录密码', { exact: true })).toBeVisible();
  await expect(page.locator('#manage-view')).toBeHidden();
  await fits(page);
  expect(observed.issues).toEqual([]);
});

test('world map selection, movement and pause keep one accessible detail and stable coordinates', async ({page}) => {
  const observed=observations(page); await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');await page.locator('#world-canvas').waitFor();
  const state=()=>page.evaluate(async()=>(await import(String('/assets/home.js'))).getWorldState());
  const initial=JSON.stringify((await state()).actors);
  await expect.poll(async()=>JSON.stringify((await state()).actors)).not.toBe(initial);
  await openHud(page, '世界'); await worldMenu(page); await page.locator('#world-pause').click();await expect(page.locator('#world-pause')).toHaveAttribute('aria-pressed','true');
  const frozen=JSON.stringify((await state()).actors);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(JSON.stringify((await state()).actors)).toBe(frozen);
  await page.locator('#world-fit').click();
  await closeHud(page);
  const camera=(await state()).camera,box=(await page.locator('#world-canvas').boundingBox())!;
  await page.locator('#world-canvas').click({position:{x:(576-camera.x)*camera.scale+box.width/2,y:(328-camera.y)*camera.scale+box.height/2}});
  await expect(page.locator('#world-detail-title')).toHaveText('河岸书馆');await expect(page.locator('#world-place-library')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await expect(page.locator('#world-canvas')).toBeFocused();
  await openHud(page, '世界'); await worldMenu(page); await page.locator('#world-reset').click();
  await page.locator('#world-zoom-in').click();await expect(page.locator('#world-zoom')).toHaveText('125%');
  await page.locator('#world-fit').click();expect((await state()).mode).toBe('overview');
  await fits(page);expect(observed.issues).toEqual([]);
});

test('world asset failure retains venue descriptions and ordinary M1 links, and retry restores the map', async ({page}) => {
  let pageErrors=0;page.on('pageerror',()=>pageErrors++);
  const atlas='**/assets/world-town/assets/characters/sheet.svg';await page.route(atlas,route=>route.abort());
  await page.goto('/');await expect(page.locator('#world-fallback')).toBeVisible();
  await openHud(page, '世界');
  await worldMenu(page);
  for (const id of ['world-zoom-out', 'world-zoom-in', 'world-fit', 'world-pause', 'world-explore', 'world-reset']) {
    const control = page.locator(`#${id}`);
    if (await control.isVisible()) await expect(control, 'Unavailable map actions are disabled while assets have failed').toBeDisabled();
  }
  await expect(page.locator('#world-gesture-hint')).toBeHidden(); await expect(page.locator('#world-open-list')).toBeEnabled();
  await page.locator('#world-place-information-hall').click();await expect(page.locator('#world-detail-title')).toHaveText('信息厅');
  await expect(page.locator('#world-detail-links a')).toHaveCount(2);await page.keyboard.press('Escape');
  await page.unroute(atlas);await page.locator('#world-retry').click();await expect(page.locator('#world-canvas')).toBeVisible();await expect(page.locator('#world-fallback')).toBeHidden();
  await openHud(page, '世界'); await expect(page.locator('#world-fit')).toBeEnabled(); await worldMenu(page); await expect(page.locator('#world-explore')).toBeEnabled();
  expect(pageErrors).toBe(0);await fits(page);
});

test('browser downloads the standalone client and sees only the joined published projection', async ({ page, baseURL }, info) => {
  test.setTimeout(45_000);
  const observed = observations(page);
  const directory = await mkdtemp(join(tmpdir(), 'm1-browser-client-'));
  try {
    await page.goto('/');
    await page.locator('#connect > summary').click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载可选 Node 24 客户端' }).click();
    const downloaded = await downloading;
    const stream = await downloaded.createReadStream();
    if (!stream) throw new Error('Public client download was unavailable');
    const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const clientPath = join(directory, 'm1-agent.ts');
    await writeFile(clientPath, Buffer.concat(chunks), { mode: 0o600 });
    const statePath = join(directory, 'agent.json');
    const displayName = `Browser ${info.project.name}`;
    let output: string;
    try {
      output = (await run(process.execPath, [clientPath, 'onboard', '--url', baseURL!, '--state', statePath,
        '--name', displayName, '--bio', '公开资料 · 合成测试', '--color', 'blue'], { cwd: directory, timeout: 15_000 })).stdout;
    } catch { throw new Error('Downloaded client onboarding did not complete'); }
    const summary = JSON.parse(output), state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(summary.registration).toBe('completed'); expect(summary.membership).toBe('joined');
    const publicResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/v1/public/agents/${summary.agentId}`);
    await page.goto(summary.profileUrl);
    const publicData = await (await publicResponse).json();
    expect(Object.keys(publicData).sort()).toEqual(['agentId', 'asOf', 'membership', 'profile', 'profileUrl'].sort());
    expect(Object.keys(publicData.profile).sort()).toEqual(['displayName', 'avatar', 'bio'].sort());
    await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible();
    await expect(page.getByText('公开资料 · 合成测试', { exact: true })).toBeVisible();
    await fits(page);
    const publicText = JSON.stringify(publicData) + await page.locator('body').innerText();
    for (const secret of [state.ownerId, state.runtimeToken, state.continuationToken, state.handoff.token,
      state.runtimeToken.split('.')[1], state.continuationToken.split('.')[1]]) expect(publicText.includes(secret)).toBe(false);
    await page.screenshot({ path: info.outputPath('public-resident.png'), fullPage: true });
    const draftName = 'UNPUBLISHED PRIVATE DRAFT';
    const draft = await fetch(`${baseURL}/v1/agents/${summary.agentId}/profile/draft`, { method: 'PUT', headers: {
      'content-type': 'application/json', authorization: `Bearer ${state.runtimeToken}`,
    }, body: JSON.stringify({ operationId: randomUUID(), expectedVersion: state.profile.version,
      expectedPolicyVersion: state.profile.policyVersion, fields: { displayName: draftName } }) });
    expect(draft.status).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible();
    expect((await page.locator('body').innerText()).includes(draftName)).toBe(false);
    const left = await fetch(`${baseURL}/v1/agents/${summary.agentId}/membership/leave`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${state.runtimeToken}`,
    }, body: JSON.stringify({ operationId: randomUUID(), expectedVersion: state.membership.version }) });
    expect(left.status).toBe(200);
    observed.allowPublicUnavailable();
    await page.reload();
    await expect(page.getByRole('heading', { name: '公开资料暂不可见' })).toBeVisible();
    await expect(page.locator('#public-resident')).toBeHidden();
    await fits(page);
    expect(observed.issues).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
