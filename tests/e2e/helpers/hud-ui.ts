import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const hudNames = ['个人', '背包', '信箱', '世界'] as const;
export type HudName = typeof hudNames[number];

export const hudWindow = (page: Page) => page.locator('#hud-window');
export const hudButton = (page: Page, name: HudName) => page.locator('#hud-dock').getByRole('button', { name, exact: true, includeHidden: true });

export async function openHud(page: Page, name: HudName) {
  if (name === '世界') { await returnToWorld(page); return hudWindow(page); }
  const trigger = hudButton(page, name);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await expect(hudWindow(page)).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return hudWindow(page);
}

export async function returnToWorld(page: Page) {
  await hudButton(page, '世界').click();
  await expect(hudWindow(page)).toBeHidden();
  await expect(page.locator('#hud-detail-window')).toBeHidden();
  await expect(hudButton(page, '世界')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hud-map-tools')).toBeVisible();
}

export async function worldMenu(page: Page) {
  const trigger = page.locator('#hud-map-more');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await expect(page.locator('#hud-map-menu')).toBeVisible();
  return page.locator('#hud-map-menu');
}

export async function closeHud(page: Page) {
  if (await hudWindow(page).isVisible()) await hudWindow(page).getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(hudWindow(page)).toBeHidden();
}

export async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The page has no horizontal overflow').toBe(true);
}

export async function containedHud(page: Page) {
  const box = await hudWindow(page).boundingBox(), size = page.viewportSize()!;
  expect(Boolean(box && box.x >= 8 && box.y >= 0 && box.x + box.width <= size.width - 8 && box.y + box.height <= size.height + 1),
    'The full panel and its close control fit inside the current viewport').toBe(true);
  const close = await hudWindow(page).getByRole('button', { name: '关闭窗口', exact: true }).boundingBox();
  expect(Boolean(close && close.width >= 44 && close.height >= 44), 'The close action remains a 44px touch target').toBe(true);
  await noPageOverflow(page);
}

export async function camera(page: Page): Promise<{ x: number; y: number; scale: number }> {
  await expect.poll(() => page.evaluate(async () => Boolean((await import(String('/assets/home.js'))).getWorldState()?.camera.width)),
    { message: 'The actual world camera has initialized' }).toBe(true);
  return page.evaluate(async () => (await import(String('/assets/home.js'))).getWorldState().camera);
}
