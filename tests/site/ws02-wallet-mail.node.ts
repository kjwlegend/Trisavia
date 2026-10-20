// Explicit Node browser entry. Four stories own new databases/identities and
// port-0 listeners; no existing QA/user service, traces or screenshots are used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { expect, type Page } from '@playwright/test';
import { walletMailFixture } from './ws02-wallet-mail-fixture.ts';
import { pointer, wheelToControl } from '../e2e/helpers/ws02-owner-read-fixture.ts';
import { hudWindow, openHud, returnToWorld, containedHud } from '../e2e/helpers/hud-ui.ts';
import type { ObjectRef } from '../../apps/platform/domains/perception/protocol.ts';
import { mailboxRepository } from '../../apps/platform/domains/mailbox/repository.ts';

const inventory = (page: Page) => page.locator('#hud-feature-inventory');
const mail = (page: Page) => page.locator('#hud-feature-mail');
const cells = (page: Page) => inventory(page).locator('[data-platform-item]');
const rows = (page: Page) => mail(page).locator('[data-platform-message]');
const wallet = (page: Page) => page.locator('#hud-wallet-status');
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fits(page: Page) { await expect(hudWindow(page)).toHaveAttribute('data-panel-state', 'open'); await containedHud(page); }
async function humanReadOnly(page: Page) {
  for (const name of ['未读', '已读', '标为已读', '标为未读', '隐藏', '删除', '撤销', '回复', '发送']) {
    await expect(hudWindow(page).getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.locator('#hud-detail-window').getByRole('button', { name, exact: true })).toHaveCount(0);
  }
}
async function start(f: Awaited<ReturnType<typeof walletMailFixture>>) {
  await f.page.goto(f.origin); await f.login(); await returnToWorld(f.page); await f.select(f.a);
}
async function inventoryNavigation(page: Page, agentId: string) {
  return page.evaluate(id => {
    const entry = Object.entries(sessionStorage).find(([key]) => key.startsWith('connet.hud.platform.inventory-view.v1:') && key.includes(id));
    if (!entry) throw new Error('Expected an independently scoped inventory navigation record');
    return { key: entry[0], value: JSON.parse(entry[1]) as Record<string, unknown> };
  }, agentId);
}

test('wallet/backpack shows only actual holdings, restores a manually loaded later-page selection and never persists free search text', { timeout: 90_000 }, async t => {
  const f = await walletMailFixture(t), { page } = f; await start(f);
  const holdings = await f.records('inventory', 'holdings'), works = holdings.filter(row => row.summary.itemKind === 'work'), props = holdings.filter(row => row.summary.itemKind === 'prop');
  assert.equal(works.length, 6); assert.equal(props.length, 8);
  await openHud(page, '背包'); await fits(page); await expect(cells(page)).toHaveCount(holdings.length);
  await expect(inventory(page).getByRole('button', { name: '物品目录', exact: true })).toHaveCount(0);
  await expect(inventory(page).getByRole('button', { name: '查看物品目录', exact: true })).toHaveCount(0);
  await expect(wallet(page)).toHaveAttribute('data-phase', 'ready'); await expect(wallet(page)).toContainText('星币 0');
  await expect.poll(() => f.responses.some(response => response.path === '/v1/wallet/query' && response.status === 200
    && response.body.data.agentRef.id === f.a.agentId && response.body.data.balance === 0)).toBe(true);
  assert.equal(await f.storage(store => store.read(async tx => (await tx.find('wallet_accounts', { agentId: f.a.agentId }))[0]!.data.balance)), 0);
  await pointer(page, inventory(page).getByRole('button', { name: '作品', exact: true })); await expect(cells(page)).toHaveCount(works.length);
  assert.deepEqual(await cells(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-item'))), works.map(row => row.ref.id));
  await pointer(page, inventory(page).getByRole('button', { name: '虚拟道具', exact: true })); await expect(cells(page)).toHaveCount(props.length);
  const selected = props.at(-1)!; await pointer(page, inventory(page).locator(`[data-platform-item="${selected.ref.id}"]`));
  await returnToWorld(page); await openHud(page, '背包');
  await expect(inventory(page).getByRole('button', { name: '虚拟道具', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(inventory(page).locator(`[data-platform-item="${selected.ref.id}"]`)).toHaveAttribute('aria-pressed', 'true');
  // A non-zero balance is an explicit isolated authority-row fixture, never a
  // production credit endpoint or a quantity inferred from held objects.
  await f.setBalance(f.a, 17); await returnToWorld(page); await openHud(page, '背包'); await expect(wallet(page)).toContainText('星币 17');
  await page.reload(); await expect(page.locator('#hud-agent-select')).toContainText(f.a.name); await openHud(page, '背包');
  await expect(wallet(page)).toContainText('星币 17'); await expect(cells(page)).toHaveCount(props.length);
  await expect(inventory(page).getByRole('button', { name: '虚拟道具', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(inventory(page).locator(`[data-platform-item="${selected.ref.id}"]`)).toHaveAttribute('aria-pressed', 'true');

  const search = page.locator('#hud-platform-item-search'), privateQuery = '仅当前内存的私有搜索词';
  const priorNavigation = await inventoryNavigation(page, f.a.agentId);
  await page.evaluate(() => sessionStorage.setItem('isolated-wallet-mail-unrelated', 'preserve-this-record'));
  await search.fill(privateQuery); await expect(cells(page)).toHaveCount(0);
  const saved = await inventoryNavigation(page, f.a.agentId);
  assert.deepEqual(Object.keys(saved.value).sort(), ['category', 'detailTop', 'selected', 'top']);
  assert.equal(JSON.stringify(saved.value).includes(privateQuery), false);
  // An older navigation payload may still exist. Reading it must ignore its
  // free text while keeping legitimate category/ref/position fields.
  await page.evaluate(({ key, value, query }) => sessionStorage.setItem(key, JSON.stringify({ ...value, query })), { ...priorNavigation, query: privateQuery });
  await page.reload(); await expect(page.locator('#hud-agent-select')).toContainText(f.a.name); await openHud(page, '背包');
  await expect(search).toHaveValue(''); await expect(cells(page)).toHaveCount(props.length);
  await expect(inventory(page).locator(`[data-platform-item="${selected.ref.id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await search.fill(privateQuery); await f.select(f.sibling); await openHud(page, '背包'); await expect(search).toHaveValue('');
  await f.select(f.a); await openHud(page, '背包'); await expect(search).toHaveValue('');

  // Close the consumer before the isolated authoritative fixture writes.
  await returnToWorld(page); await f.addHoldings(13); await openHud(page, '背包');
  await pointer(page, inventory(page).getByRole('button', { name: '全部', exact: true }));
  const all = await f.records('inventory', 'holdings'); assert.equal(all.length, 27);
  await expect(cells(page)).toHaveCount(20);
  const more = inventory(page).getByRole('button', { name: '继续载入', exact: true }), region = page.locator('#hud-platform-item-results');
  await wheelToControl(page, region, more); await pointer(page, more); await expect(cells(page)).toHaveCount(all.length);
  const later = all[24]!, laterCell = inventory(page).locator(`[data-platform-item="${later.ref.id}"]`);
  await wheelToControl(page, region, laterCell); await pointer(page, laterCell); await expect(laterCell).toHaveAttribute('aria-pressed', 'true');
  const position = await region.evaluate(node => node.scrollTop); assert(position > 0);
  await returnToWorld(page); const countBeforeOpen = f.requests.length; await openHud(page, '背包'); await expect(cells(page)).toHaveCount(20);
  await expect(inventory(page)).toContainText('先前选择的物品尚未载入');
  await expect(inventory(page).locator('[data-platform-item][aria-pressed="true"]')).toHaveCount(0);
  assert.equal((await inventoryNavigation(page, f.a.agentId)).value.selected, JSON.stringify([later.ref.moduleId, later.ref.type, later.ref.id]));
  assert.equal(f.requests.slice(countBeforeOpen).filter(request => request.path.endsWith('/list') && request.input.categoryId === 'holdings').length, 1,
    'Opening restores only the first page; it must not traverse later pages in the background');
  await page.reload(); await expect(page.locator('#hud-agent-select')).toContainText(f.a.name); const countBeforeReloadOpen = f.requests.length;
  await openHud(page, '背包'); await expect(cells(page)).toHaveCount(20); await expect(inventory(page)).toContainText('先前选择的物品尚未载入');
  assert.equal(f.requests.slice(countBeforeReloadOpen).filter(request => request.path.endsWith('/list') && request.input.categoryId === 'holdings').length, 1);
  await wheelToControl(page, region, more); await pointer(page, more); await expect(cells(page)).toHaveCount(all.length);
  await expect(laterCell).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Math.abs(await region.evaluate(node => node.scrollTop) - position),
    { timeout: 5000, message: 'The restored full list retains the captured position' }).toBeLessThanOrEqual(2);
  await search.fill(privateQuery); await f.logout(); await returnToWorld(page); await f.login(); await returnToWorld(page); await f.select(f.a); await openHud(page, '背包');
  await expect(search).toHaveValue(''); assert.equal(await page.evaluate(() => sessionStorage.getItem('isolated-wallet-mail-unrelated')), 'preserve-this-record');
  await humanReadOnly(page); await f.logout();
});

test('mail has four peer categories, starts with genuinely empty messages and reads a trusted Agent sender without advancing either confirmation store', { timeout: 65_000 }, async t => {
  const f = await walletMailFixture(t, { width: 1280, height: 800 }), { page } = f; await start(f); await openHud(page, '信箱'); await fits(page);
  assert.deepEqual(await mail(page).locator('[data-platform-tab]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-tab'))), ['messages', 'notifications', 'announcements', 'events']);
  await expect(mail(page).getByRole('button', { name: '消息', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(mail(page)).toContainText('这个 Agent 暂无消息'); await expect(rows(page)).toHaveCount(0);
  assert.equal(f.requests.filter(request => request.path.endsWith('/list')).at(-1)!.input.categoryId, 'messages');
  await expect.poll(() => f.responses.some(response => response.path.endsWith('/list') && response.input.categoryId === 'messages'
    && response.status === 200 && response.body.data.complete && response.body.data.records.length === 0)).toBe(true);
  const title = `受信上游真实来信-${crypto.randomUUID().slice(0, 8)}`, body = '这封长来信由经过实际 runtime 认证的合成 Agent 通过受信上游接收。'.repeat(40);
  const received = await f.deliver(title, body), before = await f.readStates();
  const receivedAt = await f.storage(store => store.read(async tx => (await mailboxRepository(tx).receipt(received.ref.id, f.a.agentId))!.data.receivedAt));
  const displayedTime = await page.evaluate(stamp => new Date(stamp).toLocaleString('zh-CN', { hour12: false }), receivedAt);
  await pointer(page, mail(page).getByRole('button', { name: '消息', exact: true })); await expect(rows(page)).toHaveCount(1);
  const row = mail(page).locator(`[data-platform-message="${received.ref.id}"]`); await expect(row).toContainText(title);
  await expect(row.locator('..').locator('[data-sender-name]')).toContainText(f.sibling.name);
  await expect(row.locator('..').locator('[data-sender-name]')).toContainText('Agent');
  await expect(row.locator('..').locator('time')).toHaveText(`接收于 ${displayedTime}`);
  await expect.poll(() => f.responses.some(response => response.status === 200 && response.input.categoryId === 'messages'
    && response.body.data.records.some((record: { ref: ObjectRef; summary: { receivedAt?: number } }) => record.ref.id === received.ref.id && record.summary.receivedAt === receivedAt))).toBe(true);
  await pointer(page, row); await expect(page.locator('#hud-detail-body .hud-message-body')).toHaveText(body);
  await expect(page.locator('#hud-detail-body [data-sender-name]')).toContainText(f.sibling.name);
  await expect(page.locator('#hud-detail-body')).toContainText(`接收于 ${displayedTime}`);
  await expect(page.locator('#hud-detail-body')).not.toContainText('消息时间未提供');
  await expect.poll(() => f.responses.some(response => response.status === 200 && response.path.endsWith('/detail')
    && response.input.ref?.id === received.ref.id && response.body.data.content.receivedAt === receivedAt)).toBe(true);
  await expect(page.locator('#hud-detail-body')).toContainText(`收件对象：${f.a.name}`); await humanReadOnly(page);
  await page.keyboard.press('Escape'); await expect(row).toBeFocused();
  await pointer(page, mail(page).getByRole('button', { name: '通知', exact: true })); await expect(rows(page)).toHaveCount(20);
  const more = mail(page).getByRole('button', { name: '继续载入', exact: true }); await wheelToControl(page, page.locator('#hud-platform-mail-results'), more); await pointer(page, more);
  await expect(rows(page)).toHaveCount(31); await expect(mail(page).locator('[data-sender-name]')).toHaveCount(0);
  await expect(mail(page)).toContainText('来源：平台演示内容'); await expect(mail(page)).not.toContainText(title);
  await pointer(page, mail(page).getByRole('button', { name: '公告', exact: true })); await expect(rows(page)).toHaveCount(2);
  await returnToWorld(page); await openHud(page, '信箱'); await expect(mail(page).getByRole('button', { name: '公告', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.locator('#hud-agent-select')).toContainText(f.a.name); await openHud(page, '信箱');
  await expect(mail(page).getByRole('button', { name: '公告', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(rows(page)).toHaveCount(2);
  assert.deepEqual(await f.readStates(), before); await f.logout();
});

test('missing/failed wallet reads never show zero, and delayed balances or revoked messages cannot repopulate a different Agent context', { timeout: 65_000 }, async t => {
  const f = await walletMailFixture(t), { page } = f; await f.setBalance(f.a, 17); await f.setBalance(f.sibling, 42); await start(f);
  const entered = defer(), release = defer(), delivered = defer(); let delay = true;
  await page.route('**/v1/wallet/query', async route => {
    if (delay && route.request().postDataJSON()?.agentRef?.id === f.a.agentId) { delay = false; const response = await route.fetch(); entered.resolve(); await release.promise;
      try { await route.fulfill({ response }); } catch { /* Subject change aborts the old real request. */ } finally { delivered.resolve(); } }
    else await route.continue();
  });
  try {
    await openHud(page, '背包'); await entered.promise; await expect(wallet(page)).toHaveAttribute('data-phase', 'loading');
    await expect(wallet(page)).not.toContainText('17'); await expect(wallet(page)).not.toContainText('星币 0');
    await f.select(f.sibling); await openHud(page, '背包'); await expect(wallet(page)).toContainText('星币 42');
    release.resolve(); await delivered.promise; await expect(wallet(page)).not.toContainText('17');
    const expected = await f.records('inventory', 'holdings', f.sibling); await expect(cells(page)).toHaveCount(expected.length);
    assert.deepEqual(await cells(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-item'))), expected.map(row => row.ref.id));
  } finally { release.resolve(); await page.unroute('**/v1/wallet/query'); }
  await f.select(f.a); const account = await f.removeWallet(); f.allowStatus('/v1/wallet/query', 409); await openHud(page, '背包');
  await expect(wallet(page)).toHaveAttribute('data-phase', 'not_initialized'); await expect(wallet(page)).toContainText('暂未取得余额');
  await expect(wallet(page)).not.toContainText('星币 0'); await expect(wallet(page)).not.toContainText('17'); await expect(cells(page)).toHaveCount(14);
  await f.restoreWallet(account); await pointer(page, wallet(page).getByRole('button', { name: '重试', exact: true })); await expect(wallet(page)).toContainText('星币 17');
  let fail = true; await page.route('**/v1/wallet/query', async route => { if (fail) { fail = false; f.allowAbort('/v1/wallet/query'); await route.abort('failed'); } else await route.continue(); });
  await returnToWorld(page); await openHud(page, '背包'); await expect(wallet(page)).toHaveAttribute('data-phase', 'error');
  await expect(wallet(page)).toContainText('暂时无法读取'); await expect(wallet(page)).not.toContainText('星币 0'); await expect(cells(page)).toHaveCount(14);
  await pointer(page, wallet(page).getByRole('button', { name: '重试', exact: true })); await expect(wallet(page)).toContainText('星币 17');
  const received = await f.deliver('隔离撤权来信', '此正文撤权后不能沿用旧标题或发件人。'); const before = await f.readStates();
  await openHud(page, '信箱'); await expect(rows(page)).toHaveCount(1); await f.revokeMessage(received.ref as ObjectRef); f.allowStatus('/v1/perception/detail', 404);
  await pointer(page, rows(page).first()); await expect(page.locator('#hud-detail-window')).toBeHidden(); await expect(rows(page)).toHaveCount(0);
  await expect(mail(page)).not.toContainText('隔离撤权来信'); await expect(mail(page)).not.toContainText(f.sibling.name);
  assert.deepEqual(await f.readStates(), before);
  await pointer(page, mail(page).getByRole('button', { name: '公告', exact: true })); await expect(rows(page)).toHaveCount(2);
  await f.logout(); await returnToWorld(page);
  await f.login(f.otherOwner); await returnToWorld(page); await f.select(f.other); await openHud(page, '背包');
  await expect(wallet(page)).toHaveAttribute('data-phase', 'ready'); await expect(wallet(page)).toContainText('星币 0');
  await expect(wallet(page)).not.toContainText('17'); await expect(wallet(page)).not.toContainText('42');
  await expect(inventory(page)).not.toContainText(f.a.name); await expect(inventory(page)).not.toContainText(f.sibling.name);
  await openHud(page, '信箱'); await expect(mail(page).getByRole('button', { name: '消息', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(mail(page)).toContainText('这个 Agent 暂无消息'); await expect(rows(page)).toHaveCount(0);
  await expect(mail(page)).not.toContainText('隔离撤权来信'); await f.logout();
});

test('related item entry and detail use the actual authorized name, prop content uses generic wording and denied references discard old titles', { timeout: 65_000 }, async t => {
  const f = await walletMailFixture(t, { width: 1280, height: 800 }), { page } = f; await start(f);
  const events = await f.records('world', 'events'), publication = events.find(record => record.summary.source?.kind === 'administrative_publication')!; assert(publication);
  await openHud(page, '信箱'); await pointer(page, mail(page).getByRole('button', { name: '事件', exact: true })); await expect(rows(page)).toHaveCount(events.length);
  const event = mail(page).locator(`[data-platform-message="${publication.ref.id}"]`); await pointer(page, event);
  const linked = page.locator('#hud-detail-body').getByRole('button', { name: `查看关联物品：${f.marker}`, exact: true });
  await expect(linked).toHaveCount(1);
  await wheelToControl(page, page.locator('#hud-detail-body'), linked); await pointer(page, linked);
  await expect(page.locator('#hud-detail-title')).toHaveText(f.marker); await expect(page.locator('#hud-detail-body').getByRole('heading', { name: f.marker, exact: true })).toBeVisible();
  await pointer(page, page.getByRole('button', { name: '返回原内容', exact: true })); await expect(page.locator('#hud-detail-body')).toContainText(publication.summary.title);
  await f.revokeItem(f.itemRef); f.allowStatus('/v1/perception/detail', 404);
  await wheelToControl(page, page.locator('#hud-detail-body'), linked); await pointer(page, linked);
  await expect(page.locator('#hud-detail-body')).toContainText('不可查看'); await expect(page.locator('#hud-detail-title')).not.toHaveText(f.marker);
  await pointer(page, page.getByRole('button', { name: '返回原内容', exact: true })); await expect(linked).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(event).toBeFocused();
  await openHud(page, '背包'); await pointer(page, inventory(page).getByRole('button', { name: '虚拟道具', exact: true }));
  const props = (await f.records('inventory', 'holdings')).filter(record => record.summary.itemKind === 'prop'); assert(props.length);
  await pointer(page, inventory(page).locator(`[data-platform-item="${props[0]!.ref.id}"]`));
  const content = page.locator('#hud-platform-item-detail').getByRole('button', { name: '查看内容', exact: true }); await expect(content).toBeVisible();
  await expect(inventory(page).getByRole('button', { name: '查看作品内容', exact: true })).toHaveCount(0); await pointer(page, content);
  await pointer(page, inventory(page).getByRole('button', { name: '返回物品详情', exact: true })); await returnToWorld(page);
  await expect(page.locator('#world-canvas')).toBeVisible(); await expect(hudWindow(page)).toBeHidden(); await expect(page.locator('#hud-detail-window')).toBeHidden();
  await humanReadOnly(page); await f.logout();
});
