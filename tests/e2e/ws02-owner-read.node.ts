// Opt-in Node 24 browser checks. Each story owns a fresh synthetic database,
// paired identity, browser context and random loopback listener; no trace/media.
import assert from 'node:assert/strict';
import test from 'node:test';
import { expect, type Page } from '@playwright/test';
import { ownerReadFixture, pointer, wheelToControl } from './helpers/ws02-owner-read-fixture.ts';
import { hudButton, hudWindow, openHud, returnToWorld, containedHud, camera, worldMenu } from './helpers/hud-ui.ts';
import type { Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { updatePerceptionDemoObject } from '../../apps/platform/application/perception-admin.ts';
import type { ObjectRef } from '../../apps/platform/domains/perception/protocol.ts';

const inventory = (page: Page) => page.locator('#hud-feature-inventory');
const mail = (page: Page) => page.locator('#hud-feature-mail');
const itemButtons = (page: Page) => inventory(page).locator('[data-platform-item]');
const messages = (page: Page) => mail(page).locator('[data-platform-message]');
async function readOnly(page: Page) {
  for (const name of ['标为已读', '标为未读', '删除', '撤销', '未读', '已读', '待处理']) {
    await expect(hudWindow(page).getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.locator('#hud-detail-window').getByRole('button', { name, exact: true })).toHaveCount(0);
  }
}
async function chooseAgent(page: Page, agent: Json) {
  await pointer(page, page.locator('#hud-agent'));
  await pointer(page, page.locator(`#agent-list [data-agent-id="${agent.agentId}"]`));
  await expect(page.locator('#account-root')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#hud-agent-select')).toContainText(agent.name);
  await returnToWorld(page);
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fits(page: Page) { await expect(hudWindow(page)).toHaveAttribute('data-panel-state', 'open'); await containedHud(page); }

test('owner platform holdings and notifications match real authorized pages and full content without Agent or human reader-state writes', { timeout: 75_000 }, async t => {
  const f = await ownerReadFixture(t), { page } = f;
  const holdings = await f.records('inventory', 'holdings'), notices = await f.records('inbox', 'notifications');
  const before = await f.states(); await page.goto(f.origin); await f.login(f.a.owner); await returnToWorld(page); await chooseAgent(page, f.a.agents[0]!);
  const selectedName = await page.locator('#hud-agent-select').innerText();
  await openHud(page, '背包'); await fits(page);
  await expect(inventory(page).getByRole('button', { name: '背包', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(itemButtons(page)).toHaveCount(holdings.length);
  const ids = await itemButtons(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-item')));
  assert.deepEqual(ids, holdings.map(row => row.ref.id), 'Only the selected Agent’s actual holding relations are presented');
  await expect(inventory(page).getByRole('button', { name: f.markers.items, exact: true })).toBeVisible();
  for (const row of holdings) await expect(inventory(page).getByRole('button', { name: row.summary.title, exact: true })).toContainText('演示持有记录');
  const details = page.locator('#hud-platform-item-detail'); await expect(details).toContainText('持有说明');
  await expect(details).toContainText('记录数量：1'); await expect(details).toContainText('持有状态：有效');
  await readOnly(page);
  await openHud(page, '信箱'); await expect(mail(page)).toContainText('阅读者：你'); await expect(mail(page)).toContainText(selectedName);
  await expect(messages(page)).toHaveCount(20); await expect(mail(page)).toContainText('尚未全部载入');
  const more = mail(page).getByRole('button', { name: '继续载入', exact: true });
  await wheelToControl(page, page.locator('#hud-platform-mail-results'), more); await pointer(page, more);
  await expect(messages(page)).toHaveCount(notices.length); await expect(mail(page)).toContainText('当前可查看范围已完整载入');
  assert.equal(notices.length, 31); assert.equal(notices.filter(row => row.detailAvailable).length, 30);
  assert.deepEqual(await messages(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-message'))), notices.map(row => row.ref.id));
  const long = mail(page).locator('[data-platform-message="test-message-09"]');
  await expect(long).toContainText(f.markers.notifications);
  await wheelToControl(page, page.locator('#hud-platform-mail-results'), long); await pointer(page, long);
  await expect(page.locator('#hud-detail-body .hud-message-body')).toHaveText(f.longMessage);
  const parts = f.responses.filter(response => response.path.endsWith('/detail') && response.input.ref?.id === 'test-message-09');
  assert(parts.length > 1 && parts.some(part => part.body.data?.contentComplete === false), 'The displayed body actually traverses same-version service segments');
  assert(parts.every(part => part.status === 200 && part.body.data.version === 2));
  await readOnly(page); await page.keyboard.press('Escape'); await expect(long).toBeFocused();
  const unavailable = notices.find(row => !row.detailAvailable)!;
  const closed = mail(page).locator(`[data-platform-message="${unavailable.ref.id}"]`);
  await wheelToControl(page, page.locator('#hud-platform-mail-results'), closed); await pointer(page, closed);
  await expect(page.locator('#hud-detail-body')).toContainText('当前仅可查看摘要');
  assert.equal(f.requests.some(request => request.path.endsWith('/detail') && request.input.ref?.id === unavailable.ref.id), false);
  await page.keyboard.press('Escape'); assert.deepEqual(await f.states(), before, 'Human full reading preserves every Agent confirmation');
  await f.logout();
});

test('public catalogue, announcements and event records work without an Agent and keep per-record source, demo and plan/occurrence meaning at narrow desktop', { timeout: 65_000 }, async t => {
  const f = await ownerReadFixture(t, { width: 1280, height: 800 }), { page } = f;
  const items = await f.records('world', 'items', f.empty), announcements = await f.records('world', 'announcements', f.empty), events = await f.records('world', 'events', f.empty);
  await page.goto(f.origin); await f.login(f.empty); await returnToWorld(page); await openHud(page, '背包');
  await expect(inventory(page)).toContainText('请选择要查看的 Agent'); await expect(itemButtons(page)).toHaveCount(0);
  await expect(inventory(page).getByRole('button', { name: '背包', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await pointer(page, inventory(page).getByRole('button', { name: '物品目录', exact: true })); await expect(itemButtons(page)).toHaveCount(items.length);
  await expect(inventory(page)).toContainText('不表示你或当前 Agent 持有'); await fits(page);
  assert.deepEqual(await itemButtons(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-item'))), items.map(row => row.ref.id));
  await expect(inventory(page).getByRole('button', { name: f.markers.items, exact: true })).toBeVisible();
  await expect(page.locator('#hud-platform-item-detail')).not.toContainText('记录数量');
  await openHud(page, '信箱'); await pointer(page, mail(page).getByRole('button', { name: '世界动态', exact: true }));
  await expect(messages(page)).toHaveCount(announcements.length); await expect(mail(page)).toContainText('不代表私人来信');
  await expect(mail(page)).toContainText(f.markers.announcements);
  for (const record of announcements) await expect(mail(page).locator(`[data-platform-message="${record.ref.id}"]`).locator('..')).toContainText('演示内容');
  await pointer(page, mail(page).getByRole('button', { name: '事件', exact: true })); await expect(messages(page)).toHaveCount(events.length);
  const plans = events.filter(row => row.summary.eventKind === 'plan');
  await expect(mail(page)).toContainText(f.markers.events);
  const demoOccurred = events.find(row => row.summary.eventKind === 'occurrence' && row.summary.dataMode === 'demo')!;
  const publication = events.find(row => row.summary.source?.kind === 'administrative_publication')!;
  assert(plans.length > 0 && demoOccurred && publication, 'The real catalogue supplies distinct plans, demonstration history and an actual content publication');
  for (const record of plans) {
    const row = mail(page).locator(`[data-platform-message="${record.ref.id}"]`); await expect(row).toContainText('演示计划');
    await expect(row.locator('..')).toContainText('计划时间未提供');
  }
  await expect(mail(page).locator(`[data-platform-message="${demoOccurred.ref.id}"]`)).toContainText('演示发生记录');
  const publicationButton = mail(page).locator(`[data-platform-message="${publication.ref.id}"]`);
  await expect(publicationButton.locator('..')).toContainText('平台发布');
  await wheelToControl(page, page.locator('#hud-platform-mail-results'), publicationButton); await pointer(page, publicationButton);
  await expect(page.locator('#hud-detail-body')).toContainText('来源：平台内容发布');
  await expect(page.locator('#hud-detail-body')).toContainText('内容发布于');
  await expect(page.locator('#hud-detail-body .hud-message-body')).toBeVisible(); await readOnly(page);
  await returnToWorld(page); await expect(hudButton(page, '世界')).toBeFocused();
  await expect(page.locator('#world-canvas')).toBeVisible(); await expect(page.getByRole('heading', { name: '世界', exact: true })).toHaveCount(0);
  await f.logout();
});

test('real unavailable, denied, empty and network-error states never substitute interface examples, which remain an explicit separate context', { timeout: 70_000 }, async t => {
  const f = await ownerReadFixture(t), { page } = f;
  await page.goto(f.origin); await f.login(f.a.owner); await returnToWorld(page); await chooseAgent(page, f.a.agents[0]!); await openHud(page, '信箱');
  await expect(messages(page)).toHaveCount(20); await f.observer(false);
  await returnToWorld(page); f.allowStatus('/v1/perception/list', 403); await openHud(page, '信箱');
  await expect(mail(page)).toContainText('当前账号无权查看这类内容'); await expect(messages(page)).toHaveCount(0);
  await expect(mail(page)).not.toContainText('当前没有可查看的通知'); await expect(mail(page)).not.toContainText('示例私人通知');
  await f.observer(true); await f.source('direct-mail', 'not_enabled'); await returnToWorld(page); await openHud(page, '信箱');
  await expect(mail(page)).toContainText('主人查看这类通知的入口尚未开放'); await expect(messages(page)).toHaveCount(0);
  await f.source('direct-mail', 'enabled'); await f.source('demo-items', 'unavailable');
  await openHud(page, '背包'); await pointer(page, inventory(page).getByRole('button', { name: '物品目录', exact: true }));
  await expect(inventory(page)).toContainText('内容来源暂不可用'); await expect(itemButtons(page)).toHaveCount(0);
  assert.equal(f.exampleLoads, 0, 'A real source failure does not even load the old static examples');
  await pointer(page, inventory(page).getByRole('button', { name: '查看界面示例', exact: true }));
  await expect(inventory(page)).toContainText('界面示例 · 非本次平台读取'); await expect(inventory(page).locator('[data-item-id]').first()).toBeVisible();
  assert.equal(f.exampleLoads, 1, 'The example resource is loaded only after the explicit user action');
  await pointer(page, inventory(page).getByRole('button', { name: '返回平台内容', exact: true }));
  await expect(inventory(page)).toContainText('内容来源暂不可用'); await expect(inventory(page).locator('[data-item-id]')).toHaveCount(0);
  await f.source('demo-items', 'enabled');
  let abort = true;
  await page.route('**/v1/perception/list', async route => {
    if (abort && route.request().postDataJSON()?.categoryId === 'items') { abort = false; f.allowAbort('/v1/perception/list'); await route.abort('failed'); }
    else await route.continue();
  });
  await pointer(page, inventory(page).getByRole('button', { name: '重试', exact: true })); await expect(inventory(page)).toContainText('暂时无法载入');
  await expect(itemButtons(page)).toHaveCount(0); await pointer(page, inventory(page).getByRole('button', { name: '重试', exact: true }));
  await expect(itemButtons(page)).toHaveCount(14);
  await f.storage(store => store.transaction(async tx => { for (const row of await tx.find('perception_grants', { agentId: f.a.agents[0]!.agentId, kind: 'holding' })) {
    await tx.update('perception_grants', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version);
  } }));
  await pointer(page, inventory(page).getByRole('button', { name: '背包', exact: true }));
  await expect(inventory(page)).toContainText('当前没有可查看的持有记录'); await expect(itemButtons(page)).toHaveCount(0);
  await readOnly(page); await f.logout();
});

test('subject changes discard delayed private results and World preserves M1 dirty/unknown work while the owned canvas remains live', { timeout: 85_000 }, async t => {
  const f = await ownerReadFixture(t), { page } = f;
  await page.goto(f.origin); await f.login(f.a.owner); await returnToWorld(page);
  const hiddenHold = deferred(), hiddenEntered = deferred(), hiddenDelivered = deferred(); let closeProbe = true;
  await page.route('**/v1/capabilities', async route => {
    if (!closeProbe) { await route.continue(); return; }
    closeProbe = false; const response = await route.fetch(); hiddenEntered.resolve(); await hiddenHold.promise;
    try { await route.fulfill({ response }); } catch { /* Expected cancellation of the old hidden read. */ } finally { hiddenDelivered.resolve(); }
  });
  try {
    await openHud(page, '背包'); await hiddenEntered.promise; await returnToWorld(page);
    const detailCount = f.requests.filter(request => request.path.endsWith('/detail')).length;
    hiddenHold.resolve(); await hiddenDelivered.promise;
    await expect(hudWindow(page)).toBeHidden(); await expect(page.locator('#world-canvas')).toBeVisible();
    assert.equal(f.requests.filter(request => request.path.endsWith('/detail')).length, detailCount, 'Closing a loading content window does not start a hidden detail read');
  } finally { hiddenHold.resolve(); await page.unroute('**/v1/capabilities'); }
  const selected = await page.locator('#hud-agent-select').innerText(), first = f.a.agents.find(agent => selected.includes(agent.name))!, second = f.a.agents.find(agent => agent.agentId !== first.agentId)!;
  const hold = deferred(), captured = deferred(); let delay = true;
  await page.route('**/v1/perception/list', async route => {
    const input = route.request().postDataJSON();
    if (delay && input?.channel === 'inventory' && input.agentRef?.id === first.agentId) {
      delay = false; const response = await route.fetch(); captured.resolve(); await hold.promise;
      try { await route.fulfill({ response }); } catch { /* The old request may already be aborted on scope change. */ }
    } else await route.continue();
  });
  try {
    await openHud(page, '背包'); await captured.promise; await expect(inventory(page)).toContainText('正在载入内容');
    await chooseAgent(page, second); await openHud(page, '背包'); await expect(itemButtons(page)).toHaveCount(14);
    const current = await itemButtons(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-item')));
    hold.resolve(); await expect.poll(() => f.responses.filter(response => response.path.endsWith('/list')).length).toBeGreaterThan(0);
    await expect(itemButtons(page)).toHaveCount(14); assert.deepEqual(await itemButtons(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-item'))), current);
    const expected = await f.records('inventory', 'holdings', f.a.owner, second); assert.deepEqual(current, expected.map(row => row.ref.id));
  } finally { hold.resolve(); await page.unroute('**/v1/perception/list'); }
  await returnToWorld(page); await f.logout(); await openHud(page, '背包');
  await expect(itemButtons(page)).toHaveCount(0); await expect(inventory(page)).toContainText('尚未登录');
  await returnToWorld(page); await f.login(f.b.owner); await returnToWorld(page); await openHud(page, '背包');
  await expect(itemButtons(page)).toHaveCount(14);
  const bHoldings = await f.records('inventory', 'holdings', f.b.owner, f.b.agents[0]!);
  assert.deepEqual(await itemButtons(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-item'))), bHoldings.map(row => row.ref.id));
  await expect(inventory(page)).not.toContainText(first.name); await expect(inventory(page)).not.toContainText(second.name);
  await pointer(page, page.locator('#hud-locate-agent')); const points = () => page.locator('.world-owned-hit').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.cssText));
  const moving = await points(); await expect.poll(points, { timeout: 12_000 }).not.toEqual(moving);
  const beforeCamera = await camera(page); await returnToWorld(page); const afterCamera = await camera(page);
  for (const key of ['x', 'y', 'scale'] as const) assert.equal(afterCamera[key], beforeCamera[key]);
  await worldMenu(page); await pointer(page, page.locator('#world-pause')); await expect(page.locator('#world-pause')).toHaveAttribute('aria-pressed', 'true');
  await openHud(page, '信箱'); await returnToWorld(page); await expect(page.locator('#world-pause')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#hud-account').click(); await page.locator('[data-manager-page="profile"]').click();
  const dirty = '这是本轮未保存的合成资料，切回世界不得丢失。'; await page.locator('#bio').fill(dirty);
  await returnToWorld(page); await page.locator('#hud-account').click();
  if (await page.locator('.account-confirm:visible').isVisible()) await pointer(page, page.getByRole('button', { name: '继续原任务', exact: true }));
  await expect(page.locator('#bio')).toHaveValue(dirty);
  const endpoint = `/v1/agents/${f.b.agents[0]!.agentId}/profile`; let original: Json | undefined;
  await page.route('**/v1/operations/**', async route => { f.allowStatus(new URL(route.request().url()).pathname, 503); await route.fulfill({ status: 503, contentType: 'application/json', json: { error: { code: 'commit_result_unknown' } } }); });
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return; }
    original = route.request().postDataJSON(); f.allowAbort(endpoint); await route.abort('failed');
  });
  await pointer(page, page.locator('#save-profile'));
  const vault = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}')) as Promise<Json>;
  await expect.poll(async () => Boolean((await vault()).pendingOperation?.uncertain)).toBe(true);
  const pending = await vault(); assert(original);
  await returnToWorld(page); await openHud(page, '信箱'); await returnToWorld(page);
  const after = await vault(); assert.deepEqual(after.pendingOperation, pending.pendingOperation); assert(after.sessionToken === pending.sessionToken);
  await page.locator('#hud-account').click(); await expect(page.locator('#check-result')).toBeVisible();
  // Cleanup closes this synthetic context; this test deliberately leaves the
  // original unknown command unmodified instead of manufacturing a success.
  assert.equal(f.requests.some(request => request.path.includes('reader-state')), false);
});

test('owner detail retry refreshes a stale summary before reading the newly committed content version', { timeout: 45_000 }, async t => {
  const f = await ownerReadFixture(t), { page } = f;
  await page.goto(f.origin); await f.login(f.a.owner); await returnToWorld(page); await openHud(page, '背包');
  await pointer(page, inventory(page).getByRole('button', { name: '物品目录', exact: true })); await expect(itemButtons(page)).toHaveCount(14);
  const stale = inventory(page).getByRole('button', { name: f.markers.items, exact: true });
  await expect(page.locator('#hud-platform-item-detail .hud-message-body')).toBeVisible();
  const other = itemButtons(page).filter({ hasNotText: f.markers.items }).first();
  await pointer(page, other); await expect(page.locator('#hud-platform-item-detail .hud-message-body')).toBeVisible();
  const id = await stale.getAttribute('data-platform-item'); assert(id);
  const updatedTitle = `${f.markers.items}-新版`, body = '这是列表完成后才由隔离管理员提交的物品新版正文。';
  await f.storage(async store => {
    const object = (await store.read(async tx => (await tx.find('perception_objects')).find(row => (row.data.ref as Json)?.id === id)))!;
    await updatePerceptionDemoObject(store, { actorId: 'owner-read-synthetic-administrator', operationId: crypto.randomUUID(),
      ref: object.data.ref as ObjectRef, expectedVersion: object.version, title: updatedTitle, body });
  });
  await pointer(page, stale); await expect(inventory(page)).toContainText('内容已变化');
  await pointer(page, inventory(page).getByRole('button', { name: '重新载入', exact: true }));
  const current = inventory(page).getByRole('button', { name: updatedTitle, exact: true }); await expect(current).toBeVisible(); await pointer(page, current);
  await expect(page.locator('#hud-platform-item-detail .hud-message-body')).toHaveText(body);
  assert(f.requests.some(request => request.path.endsWith('/detail') && request.input.ref?.id === id && request.input.knownVersion === 3));
  await f.logout();
});

test('owner retry after an expired page starts a fresh list instead of recycling an expired continuation token', { timeout: 45_000 }, async t => {
  const f = await ownerReadFixture(t), { page } = f;
  await page.goto(f.origin); await f.login(f.a.owner); await returnToWorld(page); await openHud(page, '信箱');
  await pointer(page, mail(page).getByRole('button', { name: '通知', exact: true })); await expect(messages(page)).toHaveCount(20);
  await f.storage(store => store.transaction(async tx => { for (const session of await tx.find('perception_sessions', { kind: 'list' }))
    await tx.update('perception_sessions', { ...session, version: session.version + 1, data: { ...session.data, expiresAt: Date.now() - 1 } }, session.version);
  }));
  f.allowStatus('/v1/perception/list', 410);
  const more = mail(page).getByRole('button', { name: '继续载入', exact: true }); await wheelToControl(page, page.locator('#hud-platform-mail-results'), more); await pointer(page, more);
  await expect(mail(page)).toContainText('内容已变化');
  const failed = f.requests.filter(request => request.path.endsWith('/list') && request.input.channel === 'inbox').at(-1)!; assert(failed.input.pageToken);
  const reload = mail(page).getByRole('button', { name: '重新载入', exact: true }); await wheelToControl(page, page.locator('#hud-platform-mail-results'), reload); await pointer(page, reload);
  await expect(messages(page)).toHaveCount(20);
  const fresh = f.requests.filter(request => request.path.endsWith('/list') && request.input.channel === 'inbox').at(-1)!;
  assert.equal('pageToken' in fresh.input, false, 'An expired page is never reissued as the new initial query');
  await wheelToControl(page, page.locator('#hud-platform-mail-results'), more); await pointer(page, more); await expect(messages(page)).toHaveCount(31);
  await f.logout();
});

test('a denied private detail removes all previously visible private summaries instead of leaving other revoked titles cached', { timeout: 45_000 }, async t => {
  const f = await ownerReadFixture(t), { page } = f;
  await page.goto(f.origin); await f.login(f.a.owner); await returnToWorld(page); await openHud(page, '信箱');
  await pointer(page, mail(page).getByRole('button', { name: '通知', exact: true })); await expect(messages(page)).toHaveCount(20);
  const oldTitles = await messages(page).allTextContents(); await f.observer(false); f.allowStatus('/v1/perception/detail', 404);
  await pointer(page, messages(page).first()); await expect(page.locator('#hud-detail-window')).toBeHidden();
  await expect(messages(page)).toHaveCount(0); await expect(mail(page)).toContainText('当前账号无权查看这类内容');
  const visible = await mail(page).innerText(); assert(oldTitles.every(title => !visible.includes(title)), 'Revocation clears the whole old private projection');
  await readOnly(page); await f.logout();
});
