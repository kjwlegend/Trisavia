// Opt-in targeted browser stories: Node 24 --test this file. No shared ports,
// production fixtures, screenshots, videos or traces are used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { expect, type Page, type Locator } from '@playwright/test';
import { ok, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { ws02Fixture } from './helpers/ws02-hud-fixture.ts';
import { hudButton, hudWindow, openHud, closeHud, returnToWorld, worldMenu, camera, noPageOverflow } from './helpers/hud-ui.ts';

async function demo(page: Page, name: '背包' | '信箱', probes?: Json[]) {
  const sample = async (step: string) => { if (probes) probes.push({ step, scrollY: await page.evaluate(() => scrollY), window: await hudWindow(page).boundingBox() }); };
  await sample('before open');
  const window = await openHud(page, name);
  const enter = window.getByRole('button', { name: `查看演示${name}`, exact: true });
  await sample('after open before demo click');
  if (probes) probes.push({ step: 'demo entry box', box: await enter.boundingBox() });
  if (await enter.isVisible()) await enter.click();
  await expect(window.locator('.hud-demo-label:visible')).toContainText(name === '背包' ? '示例物品' : '示例信箱');
  await expect(window.locator(name === '背包' ? '[data-item-id]' : '[data-message-open]').first()).toBeVisible();
  await sample('after demo source ready');
  return window;
}
async function top(node: Locator) { return node.evaluate(element => element.scrollTop); }
function commandIntent(value: Json) {
  const { operationId, scope, action, targetId, input, uncertain } = value;
  return { operationId, scope, action, targetId, input, uncertain };
}
async function wheelTo(node: Locator, page: Page, delta = 480) {
  await node.hover(); await page.mouse.wheel(0, delta);
  await expect.poll(() => top(node), { message: 'Native wheel input scrolls the intended reading region' }).toBeGreaterThan(80);
}
async function captureScroll(page: Page, node: Locator, delta: number) {
  await node.hover();
  await node.evaluate(element => {
    const observer = window as typeof window & { ws02LastScroll: { top: number; at: number } | null };
    observer.ws02LastScroll = null;
    element.addEventListener('scroll', () => { observer.ws02LastScroll = { top: element.scrollTop, at: performance.now() }; });
  });
  const moved = page.waitForFunction(() => Boolean((window as typeof window & { ws02LastScroll: unknown }).ws02LastScroll), undefined, { polling: 1 });
  await page.mouse.wheel(0, delta); await (await moved).dispose();
  return page.evaluate(() => (window as typeof window & { ws02LastScroll: { top: number; at: number } }).ws02LastScroll);
}
async function withinDebounce(page: Page, captured: { at: number }) {
  const elapsed = await page.evaluate(at => performance.now() - at, captured.at);
  assert(elapsed < 100, `The navigation must exercise a still-pending 100ms scroll write, not wait it out (${elapsed.toFixed(1)}ms)`);
}
async function refreshOnScroll(page: Page, node: Locator, delta: number) {
  const captured = await captureScroll(page, node, delta); await withinDebounce(page, captured);
  await page.reload(); return captured.top;
}
async function shellFits(page: Page) {
  await expect(hudWindow(page)).toHaveAttribute('data-panel-state', 'open');
  const window = (await hudWindow(page).boundingBox())!, dock = (await page.locator('#hud-dock').boundingBox())!;
  const viewport = page.viewportSize()!;
  const geometry = await page.evaluate(() => { const root = document.querySelector('#world-layout')!, hud = document.querySelector('#hud-root')!;
    return { scrollY, root: root.getBoundingClientRect().toJSON(), hud: hud.getBoundingClientRect().toJSON(), variables: (root as HTMLElement).style.cssText,
      active: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
      scrolling: ['html', 'body', '.hud-window-body', '#hud-feature-inventory', '#hud-item-results', '#hud-item-detail'].map(selector => {
        const node = document.querySelector(selector)!; return { selector, scrollTop: node.scrollTop, anchor: getComputedStyle(node).overflowAnchor };
      }), title: document.querySelector('#hud-title')!.getBoundingClientRect().toJSON() }; });
  assert(window.x >= 23 && window.x + window.width <= viewport.width - 23);
  assert(window.y >= 87 && window.y + window.height <= dock.y - 39,
    `Content stays in the shared safe area without covering the dock: ${JSON.stringify({ window, dock, viewport, geometry })}`);
  await expect(page.locator('#hud-close')).toBeInViewport(); await noPageOverflow(page);
}
// Long, explicitly fictional public examples exercise real scroll behavior; no
// business/auth response or successful account action is mocked.
async function longExamples(page: Page) {
  await page.route('**/assets/hud/demo-fixtures.json', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200);
    const data = await response.json() as Json;
    data.items[0].description = '这段虚构作品说明只用于检查阅读位置。'.repeat(160);
    for (let i = 0; i < 36; i++) data.items.push({ ...data.items[i % 3], id: `scroll-item-${i}`, name: `滚动示例物品 ${i}` });
    for (let i = 0; i < 20; i++) data.messages.push({ ...data.messages[1], id: `scroll-message-${i}`, title: `滚动示例通知 ${i}`,
      body: '这是虚构长正文，不代表真实投递或 Agent 处理。'.repeat(150), sourceItemId: undefined });
    await route.fulfill({ json: data });
  });
}

test('WS02 backpack keeps a six-column game grid, independent reading positions and explicit demo state across close and refresh at both desktop sizes', { timeout: 55_000 }, async t => {
  const f = await ws02Fixture(t), { page } = f; await longExamples(page); await page.goto(f.origin);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport); const probes: Json[] = [], window = await demo(page, '背包', probes);
    t.diagnostic(JSON.stringify({ publicGeometry: probes })); await shellFits(page);
    const cells = window.locator('[data-item-id]'), firstRow = await cells.evaluateAll(nodes => nodes.slice(0, 7).map(node => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width };
    }));
    assert.equal(firstRow.length, 7); assert(firstRow.slice(0, 6).every(cell => Math.abs(cell.y - firstRow[0]!.y) < 2));
    assert(firstRow[6]!.y > firstRow[0]!.y + 40, 'The seventh item begins the next row rather than compressing the six readable cells');
    const grid = page.locator('#hud-item-results'), details = page.locator('#hud-item-detail');
    const gridBox = (await grid.boundingBox())!, detailBox = (await details.boundingBox())!;
    assert(detailBox.x >= gridBox.x + gridBox.width + 20 && detailBox.width >= 280, 'The real item detail remains beside the grid at the narrower desktop');
    await window.getByRole('button', { name: '街区速写', exact: true }).click();
    await wheelTo(details, page); let detailTop = await top(details);
    await wheelTo(grid, page); let gridTop = await top(grid);
    await closeHud(page); await demo(page, '背包');
    await expect.poll(() => top(grid)).toBeCloseTo(gridTop, 0); await expect.poll(() => top(details)).toBeCloseTo(detailTop, 0);
    await page.reload(); await expect(hudWindow(page)).toBeHidden(); await demo(page, '背包');
    await expect(window.getByRole('button', { name: '街区速写', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => top(grid)).toBeCloseTo(gridTop, 0); await expect.poll(() => top(details)).toBeCloseTo(detailTop, 0);
    gridTop = await refreshOnScroll(page, grid, -120); await demo(page, '背包');
    await expect.poll(() => top(grid)).toBeCloseTo(gridTop, 0);
    detailTop = await refreshOnScroll(page, details, 150); await demo(page, '背包');
    await expect.poll(() => top(details)).toBeCloseTo(detailTop, 0);
    await details.getByRole('button', { name: '查看作品', exact: true }).click(); await expect(window).toContainText('示例作品预览');
    await page.keyboard.press('Escape'); await expect(grid).toBeVisible(); await expect.poll(() => top(grid)).toBeCloseTo(gridTop, 0);
    const search = window.getByLabel('搜索示例物品', { exact: true }); await search.fill(''); await search.pressSequentially('纪念');
    await expect(search).toHaveValue('纪念'); await expect(search).toBeFocused(); await expect(cells).toHaveCount(2);
    await window.getByRole('button', { name: '作品', exact: true }).click();
    await expect(window.getByRole('button', { name: '纪念明信片', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await window.getByRole('button', { name: '虚拟道具', exact: true }).click();
    await expect(window.getByRole('button', { name: '纪念徽章', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await search.fill('不存在的示例'); await expect(window).toContainText('没有找到符合条件的物品');
    await expect(details.getByRole('heading')).toHaveCount(0); await expect(details.getByRole('button', { name: '查看作品' })).toHaveCount(0);
    await window.getByRole('button', { name: '清除筛选', exact: true }).click(); await closeHud(page);
  }
  assert.deepEqual(f.writes, [], 'Browsing examples never writes a business resource');
});

test('WS02 mailbox detail preserves filters, focus and body position while read/hide/undo survive real refresh without altering the source', { timeout: 55_000 }, async t => {
  const f = await ws02Fixture(t, { viewport: { width: 1280, height: 800 } }), { page } = f;
  await longExamples(page); await page.goto(f.origin); const window = await demo(page, '信箱'); await shellFits(page);
  const list = page.locator('#hud-mail-results'), detail = page.locator('#hud-detail-window');
  await window.getByRole('button', { name: '未读', exact: true }).click();
  const selected = list.getByRole('button', { name: /滚动示例通知 10/ }); await selected.scrollIntoViewIfNeeded();
  const listTop = await top(list); assert(listTop > 80); await selected.press('Enter');
  await expect(detail).toBeVisible(); await expect(page.locator('#hud-detail-title')).toBeFocused();
  assert.equal(await detail.getAttribute('aria-modal'), 'false'); assert.equal(await window.evaluate(node => node.inert), true);
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => Boolean(document.activeElement?.closest('#hud-detail-window,#hud-dock'))), 'Tab never enters the inert underlying list or canvas');
  await wheelTo(page.locator('#hud-detail-body'), page, 700); let bodyTop = await top(page.locator('#hud-detail-body'));
  await page.keyboard.press('Escape'); await expect(detail).toBeHidden(); await expect(window).toBeVisible();
  await expect(window.getByRole('button', { name: '未读', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByRole('button', { name: /滚动示例通知 10/ })).toHaveCount(0);
  await expect(list.getByRole('button', { name: /滚动示例通知 11/ })).toBeFocused();
  assert(Math.abs(await top(list) - listTop) < 3, 'Removing the now-read row from the filter does not reset list position');
  const lastListTop = await refreshOnScroll(page, list, -120); await demo(page, '信箱');
  await expect(detail).toBeHidden(); await expect.poll(() => top(list)).toBeCloseTo(lastListTop, 0);
  await window.getByRole('button', { name: '已读', exact: true }).click();
  await list.getByRole('button', { name: /滚动示例通知 10/ }).click();
  await expect.poll(() => top(page.locator('#hud-detail-body'))).toBeCloseTo(bodyTop, 0);
  bodyTop = await refreshOnScroll(page, page.locator('#hud-detail-body'), 150); await demo(page, '信箱');
  await expect(detail).toBeHidden(); await list.getByRole('button', { name: /滚动示例通知 10/ }).click();
  await expect.poll(() => top(page.locator('#hud-detail-body'))).toBeCloseTo(bodyTop, 0);
  await detail.getByRole('button', { name: '标为未读', exact: true }).click();
  await expect(detail.getByRole('button', { name: '标为已读', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await window.getByRole('button', { name: '全部', exact: true }).click();
  await window.getByRole('button', { name: '未读', exact: true }).click();
  for (const title of ['滚动示例通知 10', '滚动示例通知 19']) {
    const trigger = list.locator(`[data-message-open="scroll-message-${title.endsWith('10') ? '10' : '19'}"]`); await trigger.scrollIntoViewIfNeeded();
    const order = await list.locator('[data-message-open]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.messageOpen));
    const beforeTop = await top(list); await trigger.press('Enter');
    await expect(trigger).toHaveCount(0); await detail.getByRole('button', { name: '标为未读', exact: true }).click();
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    assert.deepEqual(await list.locator('[data-message-open]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.messageOpen)), order,
      'Returning an unread middle or last row restores the original source order');
    assert(Math.abs(await top(list) - beforeTop) < 3);
  }
  await window.getByRole('button', { name: '待处理', exact: true }).click();
  const only = list.locator('[data-message-open]'); await expect(only).toHaveCount(1); await only.press('Enter');
  await expect(list).toContainText('没有符合条件的通知'); await detail.getByRole('button', { name: '标为未读', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(only).toHaveCount(1); await expect(only).toBeFocused();
  await expect(list).not.toContainText('没有符合条件的通知');
  await window.getByRole('button', { name: '待处理', exact: true }).click(); await window.getByRole('button', { name: '全部', exact: true }).click();
  const row = list.locator('.hud-message-row').filter({ hasText: '作品说明有更新' });
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await expect(detail).toBeHidden(); await expect(list.getByRole('button', { name: /作品说明有更新/ })).toHaveCount(0);
  await expect(window).toContainText('已从演示信箱移除');
  await returnToWorld(page); await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await demo(page, '信箱'); await expect(list.getByRole('button', { name: /作品说明有更新/ })).toBeVisible();
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await page.reload(); await expect(detail).toBeHidden(); await expect(hudWindow(page)).toBeHidden(); await demo(page, '信箱');
  await expect(list.getByRole('button', { name: /作品说明有更新/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeVisible(); await page.getByRole('button', { name: '撤销', exact: true }).click();
  await window.getByRole('button', { name: '待处理', exact: true }).click(); await expect(list.locator('[data-message-open]')).toHaveCount(1);
  await window.getByRole('button', { name: '世界动态', exact: true }).click(); await expect(window.getByRole('button', { name: '待处理', exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: '私人通知', exact: true }).click();
  await expect(window.getByRole('button', { name: '待处理', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await window.getByRole('button', { name: '待处理', exact: true }).click();
  await list.getByRole('button', { name: /旧内容已不可查看/ }).click();
  await expect(detail).toContainText('正文、图像及来源动作当前不可用'); await expect(detail.getByRole('button', { name: '查看内容', exact: true })).toHaveCount(0);
  await returnToWorld(page); assert.deepEqual(f.writes, []);
});

test('WS02 guest, owner and selected-Agent records stay separate and World never discards M1 dirty or unknown commands', { timeout: 60_000 }, async t => {
  const f = await ws02Fixture(t, { accounts: true, reducedMotion: 'reduce' }), { page } = f;
  const a = f.owners[0]!, b = f.owners[1]!; await longExamples(page); await page.goto(f.origin);
  await demo(page, '背包'); await page.getByLabel('搜索示例物品', { exact: true }).fill('纪念'); await returnToWorld(page);
  await f.login(a.owner);
  async function select(id: string) {
    await page.locator('#hud-agent').click();
    await page.locator(`#agent-list [data-agent-id="${id}"]`).click(); await expect(page.locator('#account-root')).toHaveAttribute('aria-busy', 'false');
    await returnToWorld(page);
  }
  await select(a.agents[0]!.agentId); await demo(page, '背包'); await expect(page.getByLabel('搜索示例物品', { exact: true })).toHaveValue('');
  const lastScroll = await captureScroll(page, page.locator('#hud-item-results'), 430);
  await select(a.agents[1]!.agentId); await withinDebounce(page, lastScroll); await demo(page, '背包');
  await expect.poll(() => top(page.locator('#hud-item-results'))).toBe(0);
  await select(a.agents[0]!.agentId); await demo(page, '背包');
  await expect.poll(() => top(page.locator('#hud-item-results'))).toBeCloseTo(lastScroll.top, 0);
  await page.getByLabel('搜索示例物品', { exact: true }).fill('手册'); await returnToWorld(page);
  await select(a.agents[1]!.agentId); await demo(page, '背包'); await expect(page.getByLabel('搜索示例物品', { exact: true })).toHaveValue(''); await returnToWorld(page);
  await select(a.agents[0]!.agentId); await demo(page, '背包'); await expect(page.getByLabel('搜索示例物品', { exact: true })).toHaveValue('手册');
  await returnToWorld(page); await f.logout(); await demo(page, '背包'); await expect(page.getByLabel('搜索示例物品', { exact: true })).toHaveValue('纪念');
  await returnToWorld(page); await f.login(b.owner); await demo(page, '背包'); await expect(page.getByLabel('搜索示例物品', { exact: true })).toHaveValue('');
  await returnToWorld(page); await page.locator('#hud-account').click(); await page.locator('[data-manager-page="profile"]').click();
  const dirty = '尚未保存的资料必须保留'; await page.locator('#bio').fill(dirty); await returnToWorld(page);
  await page.locator('#hud-account').click();
  if (await page.locator('.account-confirm:visible').isVisible()) await page.getByRole('button', { name: '继续原任务', exact: true }).click();
  await expect(page.locator('#profile-form')).toBeVisible(); await expect(page.locator('#bio')).toHaveValue(dirty);
  const agent = b.agents[0]!, endpoint = `/v1/agents/${agent.agentId}/profile`;
  let original: Json | undefined, submissions = 0, holdReceipt = true;
  await page.route('**/v1/operations/**', async route => {
    if (!original || new URL(route.request().url()).pathname !== `/v1/operations/${original.operationId}`) { await route.continue(); return; }
    if (holdReceipt) { f.allowStatus(new URL(route.request().url()).pathname, 503); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"commit_result_unknown"}}' }); }
    else { const response = await route.fetch(); if (response.status() === 404) f.allowStatus(new URL(route.request().url()).pathname, 404); await route.fulfill({ response }); }
  });
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return; }
    submissions++; const body = route.request().postDataJSON() as Json;
    if (!original) { original = body; f.allowAbort(endpoint); await route.abort('failed'); }
    else { assert.deepEqual(body, original); await route.continue(); }
  });
  await page.locator('#save-profile').click();
  const saved = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}')) as Promise<Json>;
  await expect.poll(async () => Boolean((await saved()).pendingOperation?.uncertain)).toBe(true);
  const pending = await saved(); await returnToWorld(page); await demo(page, '信箱'); await returnToWorld(page);
  const after = await saved(); assert.deepEqual(commandIntent(after.pendingOperation), commandIntent(pending.pendingOperation));
  assert(after.sessionToken === pending.sessionToken, 'Closing content keeps the exact authenticated proof'); assert.equal(submissions, 1);
  await page.reload(); await page.locator('#hud-account').click(); await expect(page.locator('#check-result')).toBeVisible();
  assert.deepEqual(commandIntent((await saved()).pendingOperation), commandIntent(pending.pendingOperation)); holdReceipt = false;
  await page.locator('#check-result').click(); await expect.poll(async () => Boolean((await saved()).pendingOperation)).toBe(false);
  assert.equal(submissions, 2); assert.equal((await ok(f.api, 'GET', `/public/agents/${agent.agentId}`)).profile.bio, dirty);
  await f.logout(); assert(await page.evaluate(() => sessionStorage.getItem('connet.owner.v2') === null));
});

test('WS02 World returns to a live owned-Agent canvas, retains usable map tools and respects pause/reduced motion and visible overlay avoidance', { timeout: 60_000 }, async t => {
  const f = await ws02Fixture(t, { accounts: true }), { page } = f; await page.goto(f.origin); await f.login(f.owners[0]!.owner); await returnToWorld(page);
  const state = () => page.evaluate(async () => (await import(String('/assets/home.js'))).getWorldState());
  const occupied = () => page.evaluate(async () => (await import(String('/assets/world-safe-area.js'))).worldOverlayRects(document.querySelector('#world-layout')));
  const points = () => page.locator('.world-owned-hit').evaluateAll(nodes => nodes.map(node => {
    const element = node as HTMLElement; return [element.style.left, element.style.top];
  }));
  await expect(page.locator('.world-owned-hit')).toHaveCount(2); const view = await camera(page);
  await demo(page, '背包'); await page.locator('#hud-locate-agent').click();
  await expect(page.locator('.world-owned-hit[aria-pressed="true"]')).toBeVisible(); const moving = await points();
  await expect.poll(points, { timeout: 12_000, message: 'Opening content does not stop the actual owned-Agent visual positions' }).not.toEqual(moving);
  await expect(page.locator('.world-owned-hit[aria-pressed="true"]')).toBeVisible(); const located = await camera(page);
  await returnToWorld(page); const unchanged = await camera(page);
  for (const key of ['x', 'y', 'scale'] as const) assert(Math.abs(unchanged[key] - located[key]) < 0.001);
  assert.equal(located.scale, view.scale, 'Locating an owned role keeps the chosen zoom');
  await page.locator('#world-zoom-in').click(); await expect(page.locator('#world-zoom')).not.toHaveText('100%');
  await page.locator('#world-canvas').focus(); await page.keyboard.press('Home'); assert.equal((await state()).mode, 'overview');
  await worldMenu(page); await page.locator('#world-reset').focus(); await page.keyboard.press('Enter'); assert.equal((await state()).mode, 'initial');
  await page.locator('#world-canvas').focus(); await expect(page.locator('#hud-tooltip')).toBeHidden();
  const noMenu = (await occupied()).length;
  await worldMenu(page); assert.equal((await occupied()).length, noMenu + 1, 'A visible map menu reserves its real rectangle');
  await page.keyboard.press('Escape'); await expect(page.locator('#hud-map-menu')).toBeHidden();
  assert.equal((await occupied()).length, noMenu, 'A closed menu no longer removes space from role positioning');
  await worldMenu(page); await page.locator('#world-explore').click(); await expect(page.locator('#hud-exit-explore')).toBeVisible();
  await page.locator('#hud-exit-explore').click(); await expect(page.locator('#hud-exit-explore')).toBeHidden();
  await page.locator('#world-open-list').click(); await page.getByRole('button', { name: '中央公共庭', exact: true }).click();
  await expect(page.locator('#world-detail')).toBeVisible(); await returnToWorld(page); await expect(page.locator('#world-detail')).toBeHidden();
  await worldMenu(page); await page.locator('#world-pause').click(); await expect.poll(async () => (await state()).paused).toBe(true);
  const frozen = await points(); await new Promise(resolve => setTimeout(resolve, 500)); assert.deepEqual(await points(), frozen, 'User pause holds visual positions across a measured interval');
  await returnToWorld(page); assert.equal((await state()).paused, true, 'World does not forcibly resume a paused canvas');
  await worldMenu(page); await page.locator('#world-pause').click(); await expect.poll(async () => (await state()).paused).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect.poll(async () => (await state()).paused).toBe(true);
  const reduced = await points(); await new Promise(resolve => setTimeout(resolve, 500)); assert.deepEqual(await points(), reduced);
  await demo(page, '信箱'); const beforeReader = (await occupied()).length;
  await page.locator('[data-message-open]').first().click(); await expect(page.locator('#hud-detail-window')).toHaveAttribute('data-panel-state', 'open');
  assert.equal((await occupied()).length, beforeReader + 1, 'The additional reader joins the real scene-safe rectangles');
  await page.keyboard.press('Escape'); await expect(page.locator('#hud-detail-window')).toBeHidden();
  assert.equal((await occupied()).length, beforeReader, 'The hidden reader does not reserve an invisible rectangle');
  await page.locator('[data-message-open]').first().click(); await expect(page.locator('#hud-detail-window')).toBeVisible();
  await page.locator('#hud-locate-agent').click();
  const selected = page.locator('.world-owned-hit[aria-pressed="true"]'), hit = (await selected.boundingBox())!;
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2); await expect(page.locator('#world-owned-tooltip')).toBeVisible();
  const overlay = (await page.locator('#hud-detail-window').boundingBox())!, name = (await page.locator('#world-owned-tooltip').boundingBox())!;
  const overlap = (a: typeof hit, b: typeof hit) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  assert(!overlap(hit, overlay) && !overlap(name, overlay), 'Real locate and the visible name avoid the open mail reader');
  await returnToWorld(page); await expect(hudWindow(page)).toBeHidden(); await expect(page.locator('#hud-detail-window')).toBeHidden();
  await expect(hudButton(page, '世界')).toBeFocused(); await expect(page.getByRole('heading', { name: '世界', exact: true })).toHaveCount(0);
  await noPageOverflow(page); await f.logout();
});
