import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

interface WorldState {
  mode: 'initial' | 'overview' | 'custom';
  exploring: boolean;
  camera: { x: number; y: number; scale: number; width: number; height: number };
  actors: Array<{ id: string; x: number; y: number }>;
}
const observed = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const issues: string[] = []; observed.set(page, issues);
  page.on('pageerror', () => issues.push('pageerror'));
  page.on('console', message => { if (message.type() === 'error') issues.push('console.error'); });
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') issues.push('requestfailed'); });
  page.on('response', response => { if (response.status() >= 400) issues.push('http_failure'); });
});
test.afterEach(async ({ page }) => { expect(observed.get(page), 'Public viewport journeys have no unexpected browser or network errors').toEqual([]); });
async function worldState(page: Page): Promise<WorldState> {
  return page.evaluate(async () => (await import(String('/assets/home.js'))).getWorldState());
}
async function ready(page: Page) {
  await expect(page.locator('#world-canvas')).toBeVisible();
  await expect(page.locator('#world-fallback')).toBeHidden();
  await expect.poll(async () => Boolean((await worldState(page))?.camera.width)).toBe(true);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow').toBe(true);
}
async function coverViewport(page: Page) {
  const box = await page.locator('#world-canvas').boundingBox();
  expect(box !== null, 'The visible world canvas exists').toBe(true);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: visualViewport?.height ?? innerHeight }));
  expect(Math.abs(box!.x), 'World begins at the left viewport edge').toBeLessThanOrEqual(2);
  expect(Math.abs(box!.y), 'World begins at the top viewport edge behind navigation').toBeLessThanOrEqual(2);
  expect(Math.abs(box!.width - viewport.width), 'World spans the viewport width').toBeLessThanOrEqual(2);
  expect(Math.abs(box!.height - viewport.height), 'World spans the visible viewport height').toBeLessThanOrEqual(2);
  const { camera } = await worldState(page);
  const minimum = Math.max(box!.width / 1536, box!.height / 1024);
  expect(camera.scale, 'The initial map itself covers the canvas instead of becoming a letterboxed strip').toBeGreaterThanOrEqual(minimum - 0.002);
  const left = box!.width / 2 - camera.x * camera.scale, top = box!.height / 2 - camera.y * camera.scale;
  expect(left, 'Initial camera does not expose the west world boundary').toBeLessThanOrEqual(2);
  expect(top, 'Initial camera does not expose the north world boundary').toBeLessThanOrEqual(2);
  expect(left + 1536 * camera.scale, 'Initial camera does not expose the east world boundary').toBeGreaterThanOrEqual(box!.width - 2);
  expect(top + 1024 * camera.scale, 'Initial camera does not expose the south world boundary').toBeGreaterThanOrEqual(box!.height - 2);
  await noOverflow(page);
}
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
    for (let step = 1; step <= 12; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12, id: 1,
      }] });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await client.detach(); }
}
async function settledPageScroll(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    let last = scrollY, stableFrames = 0;
    const frame = () => {
      stableFrames = scrollY === last ? stableFrames + 1 : 0; last = scrollY;
      if (stableFrames >= 6) resolve(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
}

test('world and camera cover every initial desktop and mobile viewport without requesting browser fullscreen', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = Element.prototype.requestFullscreen;
    const counters = window as typeof window & { fullscreenRequests: number };
    counters.fullscreenRequests = 0;
    Element.prototype.requestFullscreen = function (options) { counters.fullscreenRequests++; return original.call(this, options); };
  });
  const sizes = info.project.name === 'mobile'
    ? [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]
    : [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }];
  for (const size of sizes) {
    await page.setViewportSize(size); await page.goto('/'); await ready(page); await coverViewport(page);
    await expect(page.locator('#world-place-directory')).not.toHaveAttribute('open', '');
    await expect(page.locator('#world-detail')).toBeHidden();
    for (const control of [page.locator('header nav').getByRole('link', { name: /Agent 接入/ }), page.locator('#world-fit'), page.locator('#world-pause')]) {
      const box = await control.boundingBox();
      expect(Boolean(box && box.width >= 44 && box.height >= 44 && box.y >= 0 && box.y + box.height <= size.height + 1), 'Primary control remains a visible 44px target inside the viewport').toBe(true);
    }
    expect(await page.evaluate(() => document.fullscreenElement === null && (window as typeof window & { fullscreenRequests: number }).fullscreenRequests === 0)).toBe(true);
  }
});

test('full map is an explicit alternate view and closing details preserves the chosen camera', async ({ page }) => {
  await page.goto('/'); await ready(page); await coverViewport(page);
  await page.getByRole('button', { name: '全景', exact: true }).click();
  const overview = (await worldState(page)).camera;
  expect(overview.scale * 1536).toBeLessThanOrEqual(overview.width + 2);
  expect(overview.scale * 1024).toBeLessThanOrEqual(overview.height + 2);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height - 100 });
  await expect.poll(async () => (await worldState(page)).camera.height).toBe(size.height - 100);
  const resized = await worldState(page);
  expect(resized.mode, 'Viewport resize keeps the deliberately selected full-map mode').toBe('overview');
  expect(resized.camera.scale * 1536).toBeLessThanOrEqual(resized.camera.width + 2);
  expect(resized.camera.scale * 1024).toBeLessThanOrEqual(resized.camera.height + 2);
  await page.locator('#world-open-list').click();
  const beforeDetail = (await worldState(page)).camera;
  await page.getByRole('button', { name: '中央公共庭', exact: true }).click();
  await expect(page.locator('#world-detail-title')).toHaveText('中央公共庭');
  await page.getByRole('button', { name: '关闭场所说明', exact: true }).click();
  const closed = (await worldState(page)).camera;
  expect(closed.x).toBeCloseTo(beforeDetail.x, 4); expect(closed.y).toBeCloseTo(beforeDetail.y, 4); expect(closed.scale).toBeCloseTo(beforeDetail.scale, 4);
  await page.getByRole('button', { name: '返回初始视角', exact: true }).click();
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await coverViewport(page);
});

test('closing an overview detail after a wide-to-phone resize fits the current viewport and preserves custom views separately', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/'); await ready(page);
  await page.locator('#world-fit').click();
  await page.locator('#world-open-list').click();
  await page.getByRole('button', { name: '中央公共庭', exact: true }).click();
  await expect(page.locator('#world-detail-title')).toHaveText('中央公共庭');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await worldState(page)).camera.width).toBe(390);
  await page.getByRole('button', { name: '关闭场所说明', exact: true }).click();
  const fitted = await worldState(page);
  expect(fitted.mode).toBe('overview');
  await page.locator('#world-fit').click();
  const freshFit = await worldState(page);
  expect(fitted.camera.scale, 'Restored overview matches an explicit fit at the new viewport, including safe control insets').toBeCloseTo(freshFit.camera.scale, 4);
  expect(fitted.camera.x).toBeCloseTo(freshFit.camera.x, 4); expect(fitted.camera.y).toBeCloseTo(freshFit.camera.y, 4);
  expect(fitted.camera.scale * 1536).toBeLessThanOrEqual(fitted.camera.width + 2);
  expect(fitted.camera.scale * 1024).toBeLessThanOrEqual(fitted.camera.height + 2);
  await noOverflow(page);

  await page.locator('#world-reset').click();
  await page.getByRole('button', { name: '放大地图', exact: true }).click();
  const custom = await worldState(page); expect(custom.mode).toBe('custom');
  await page.locator('#world-open-list').click();
  await page.getByRole('button', { name: '中央公共庭', exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await worldState(page)).camera.width).toBe(844);
  await page.getByRole('button', { name: '关闭场所说明', exact: true }).click();
  const restored = await worldState(page);
  expect(restored.mode, 'Closing a custom view does not reset every mode to overview').toBe('custom');
  expect(restored.camera.scale).toBeCloseTo(custom.camera.scale, 4);
  expect(restored.camera.scale, 'Custom zoom stays distinct from a full-map fit').toBeGreaterThan(Math.min(844 / 1536, 390 / 1024));
  await noOverflow(page);
});

test('mobile scrolls naturally, explores with two-dimensional touch drag, then restores page scrolling', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Native touch gestures run on the mobile project');
  await page.goto('/'); await ready(page);
  const size = page.viewportSize()!;
  const downPage = async () => {
    await swipe(page, { x: size.width / 2, y: size.height * 0.65 }, { x: size.width / 2, y: size.height * 0.25 });
    await settledPageScroll(page); // Let the native touch fling finish before resetting the next task.
  };
  await downPage();
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'Default map touch allows the page to scroll towards the introduction' }).toBeGreaterThan(60);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: '探索地图', exact: true }).click();
  await page.getByRole('button', { name: '放大地图', exact: true }).click();
  const before = (await worldState(page)).camera;
  await swipe(page, { x: size.width * 0.65, y: size.height * 0.58 }, { x: size.width * 0.35, y: size.height * 0.44 });
  const after = (await worldState(page)).camera;
  expect(Math.abs(after.x - before.x), 'Exploration moves the camera horizontally').toBeGreaterThan(5);
  expect(Math.abs(after.y - before.y), 'Exploration moves the camera vertically').toBeGreaterThan(5);
  expect((await worldState(page)).mode).toBe('custom'); expect((await worldState(page)).exploring).toBe(true);
  expect(await page.evaluate(() => scrollY), 'Exploration does not drag the page').toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '退出探索', exact: true }).click(); await downPage();
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'Exit exploration restores normal scrolling' }).toBeGreaterThan(60);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '探索地图', exact: true }).click();
  await page.getByRole('button', { name: '全景', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出探索', exact: true })).toHaveCount(0);
  await downPage();
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'Full map view also restores normal scrolling' }).toBeGreaterThan(60);
  await noOverflow(page);
});

test('same-document portrait to landscape viewport changes keep a single honest registration and login navigation', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Viewport rotation uses the mobile emulation context');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await ready(page);
  const navigation = page.locator('header nav');
  await expect(navigation.getByRole('link', { name: '注册／登录', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(navigation.getByRole('link', { name: '注册／登录', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: '注册', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: '登录', exact: true })).toBeVisible(); await coverViewport(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(navigation.getByRole('link', { name: '注册／登录', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: '注册', exact: true })).toBeHidden(); await coverViewport(page);
});
