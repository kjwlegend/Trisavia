import type { Page } from '@playwright/test';
import { test, expect } from './helpers/owner-account-ui.ts';
import { hudButton, hudWindow, openHud, closeHud, containedHud, noPageOverflow } from './helpers/hud-ui.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const writes = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const requests: string[] = []; writes.set(page, requests);
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/v1/') && !['GET', 'HEAD'].includes(request.method())) requests.push(`${request.method()}:${path}`);
  });
});
test.afterEach(async ({ page }) => { expect(writes.get(page), 'Browsing isolated examples never submits M1 or M2 business writes').toEqual([]); });

async function demo(page: Page, feature: '个人' | '背包' | '信箱') {
  const window = await openHud(page, feature);
  await window.getByRole('button', { name: `查看演示${feature === '个人' ? '资料' : feature}`, exact: true }).click();
  await expect(window.locator('.hud-demo-label:visible')).toContainText('演示数据');
  return window;
}
async function inventoryList(page: Page) {
  const window = hudWindow(page);
  if (await window.getByRole('button', { name: '返回物品列表', exact: true }).isVisible()) await window.getByRole('button', { name: '返回物品列表', exact: true }).click();
  await expect(window.getByLabel('搜索示例物品', { exact: true })).toBeVisible();
  return window;
}
async function mailList(page: Page) {
  const window = hudWindow(page);
  if (await window.getByRole('button', { name: '返回通知列表', exact: true }).isVisible()) await window.getByRole('button', { name: '返回通知列表', exact: true }).click();
  return window;
}

test('personal examples require an explicit demo context and their public preview returns before the outer window closes', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => sessionStorage.getItem('connet.owner.v2'));
  let loads = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/assets/hud/demo-fixtures.json') loads++; });
  await openHud(page, '个人');
  await expect(hudWindow(page)).toContainText('登录后可查看自己的 Agent 资料'); expect(loads).toBe(0);
  const window = await demo(page, '个人');
  await expect(window.getByText('小岚', { exact: true })).toBeVisible();
  await expect(window).toContainText('与当前真实 Agent 无关'); await expect(window).toContainText('暂未收到新报告（示例）');
  await window.getByRole('button', { name: '公开资料', exact: true }).click();
  await expect(window).toContainText('只读公开字段'); await expect(window.getByRole('heading', { name: '最近记录（示例）' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(window).toBeVisible(); await expect(window.getByRole('button', { name: '公开资料', exact: true })).toBeFocused();
  await expect(window.getByRole('heading', { name: '最近记录（示例）' })).toBeVisible();
  await window.getByRole('button', { name: '返回真实资料', exact: true }).click();
  await expect(window).toContainText('登录后可查看自己的 Agent 资料');
  expect(await page.evaluate(previous => sessionStorage.getItem('connet.owner.v2') === previous, before), 'An example never creates or changes real owner credentials').toBe(true);
  await page.keyboard.press('Escape'); await expect(window).toBeHidden(); await expect(hudButton(page, '个人')).toBeFocused();
});

test('inventory filters retain only visible selections, clear empty details and return from the same read-only artwork preview', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/'); const window = await demo(page, '背包');
  await expect(window.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(window.getByRole('button', { name: '街区速写', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await window.getByRole('button', { name: '纪念明信片', exact: true }).click(); await inventoryList(page);
  await window.getByRole('button', { name: '作品', exact: true }).click();
  await expect(window.getByRole('button', { name: '纪念明信片', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await window.getByRole('button', { name: '虚拟道具', exact: true }).click();
  await expect(window.getByRole('button', { name: '小镇手册', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(window.getByRole('heading', { name: '纪念明信片', exact: true })).toHaveCount(0);
  await window.getByLabel('搜索示例物品', { exact: true }).fill('不存在的示例条目');
  await expect(window).toContainText('此筛选下暂无示例物品');
  await expect(window.getByRole('heading', { name: '小镇手册', exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: '查看作品', exact: true })).toHaveCount(0);
  await window.getByLabel('搜索示例物品', { exact: true }).fill('');
  await window.getByRole('button', { name: '全部', exact: true }).click(); await window.getByRole('button', { name: '街区速写', exact: true }).click();
  await window.getByRole('button', { name: '查看作品', exact: true }).click();
  await expect(window).toContainText('示例作品预览'); await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(window).toBeVisible();
  await expect(window.getByRole('heading', { name: '街区速写', exact: true })).toBeVisible();
  await expect(window.getByRole('button', { name: '查看作品', exact: true })).toBeVisible();
  await inventoryList(page); await expect(window.getByRole('button', { name: '街区速写', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(window).toContainText('非当前账号或 Agent 的资产');
  await expect(window.getByRole('button', { name: /购买|赠送|领取|装备|转让/ })).toHaveCount(0);
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 568 }); await containedHud(page);
    await window.getByRole('button', { name: '纪念徽章', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY), 'Long example content scrolls inside the panel, not the page').toBe(0);
    await expect(window.getByRole('button', { name: '关闭窗口', exact: true })).toBeInViewport();
  }
  await closeHud(page); await expect(hudButton(page, '背包')).toBeFocused(); await noPageOverflow(page);
});

test('mail separates private pending examples from public announcements and removes unavailable source content', async ({ page }) => {
  await page.goto('/'); const window = await demo(page, '信箱');
  await expect(window).toContainText('不是当前账号的消息'); await expect(window).toContainText('示例阅读者：lin');
  await expect(window.getByRole('button', { name: '私人通知', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(window.getByLabel('通知筛选', { exact: true })).toHaveValue('全部通知');
  await expect(window.getByLabel('示例私人通知', { exact: true }).getByRole('button')).toHaveCount(6);
  await window.getByRole('button', { name: /作品说明有更新/ }).click();
  await expect(window).toContainText('仅供知晓'); await window.getByRole('button', { name: '查看内容', exact: true }).click();
  await expect(window).toContainText('同一夹具的演示内容');
  await page.keyboard.press('Escape'); await expect(window).toBeVisible(); await expect(window.getByRole('heading', { name: '作品说明有更新', exact: true })).toBeVisible();
  await mailList(page); await window.getByLabel('通知筛选', { exact: true }).selectOption('待处理');
  await expect(window.getByRole('button', { name: /资料有一项待确认/ })).toBeVisible();
  await expect(window.getByLabel('示例私人通知', { exact: true }).getByRole('button')).toHaveCount(1);
  await expect(window.getByRole('button', { name: /作品说明有更新|旧提醒已到期|旧内容已不可查看/ })).toHaveCount(0);
  await window.getByRole('button', { name: '世界动态（公开）', exact: true }).click();
  await expect(window.getByLabel('通知筛选', { exact: true })).toHaveCount(0);
  await expect(window.getByLabel('示例公共公告', { exact: true }).getByRole('button').first()).toBeVisible();
  await expect(window.getByRole('button', { name: /资料有一项待确认/ })).toHaveCount(0);
  await window.getByRole('button', { name: '私人通知', exact: true }).click();
  await expect(window.getByLabel('通知筛选', { exact: true })).toHaveValue('待处理');
  await expect(window.getByRole('button', { name: /资料有一项待确认/ })).toBeVisible();
  await window.getByLabel('通知筛选', { exact: true }).selectOption('全部通知');
  await window.getByRole('button', { name: /旧内容已不可查看/ }).click();
  await expect(window.getByRole('heading', { name: '此示例内容不可查看', exact: true })).toBeVisible();
  await expect(window).toContainText('正文、图像及来源动作当前不可用');
  await expect(window.getByRole('button', { name: '查看内容', exact: true })).toHaveCount(0);
  await expect(window.getByText('广场有新的作品说明。你可以打开查看。', { exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: /发送|回复|接受|接单|标记已读/ })).toHaveCount(0);
  await closeHud(page); await noPageOverflow(page);
});

test('a failed example resource offers a real retry while successful empty fixtures clear examples instead of pretending success', async ({ page, privacy }) => {
  const path = '/assets/hud/demo-fixtures.json'; privacy.allowStatus(path, 503);
  await page.route(`**${path}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }), { times: 1 });
  await page.goto('/'); const window = await demo(page, '背包');
  await expect(window).toContainText('演示内容暂不可用'); await expect(window).not.toContainText('此筛选下暂无示例物品');
  await expect(window.getByRole('button', { name: '关闭窗口', exact: true })).toBeVisible();
  await window.getByRole('button', { name: '重试演示内容', exact: true }).click();
  await expect(window.getByRole('button', { name: '街区速写', exact: true })).toBeVisible();
  await page.route(`**${path}`, async route => {
    const response = await route.fetch(), data = await response.json();
    await route.fulfill({ json: { ...data, items: [], messages: [], announcements: [] } });
  }, { times: 1 });
  await page.reload(); await demo(page, '背包');
  await expect(window).toContainText('此筛选下暂无示例物品');
  await expect(window.getByRole('heading', { name: '街区速写', exact: true })).toHaveCount(0);
  await closeHud(page); await demo(page, '信箱'); await expect(window).toContainText('此筛选下暂无示例通知');
  await expect(window.getByRole('button', { name: '查看内容', exact: true })).toHaveCount(0);
  await closeHud(page); await expect(page.locator('#hud-account')).toBeVisible();
});
