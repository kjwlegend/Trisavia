import { test, expect } from './helpers/owner-account-ui.ts';
import { hudNames, hudButton, hudWindow, openHud, closeHud, containedHud, camera, noPageOverflow } from './helpers/hud-ui.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('the four dock controls disclose one panel, keep hover separate and restore focus without moving the world', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#world-canvas')).toBeVisible();
  const dock = page.locator('#hud-dock');
  await expect(dock.getByRole('button')).toHaveCount(4);
  for (const [index, name] of hudNames.entries()) await expect(dock.getByRole('button').nth(index)).toHaveAccessibleName(name);
  await expect(hudWindow(page)).toBeHidden();
  const original = await camera(page);

  for (const name of hudNames) {
    const trigger = hudButton(page, name), before = await trigger.boundingBox();
    expect(Boolean(before && before.width >= 44 && before.height >= 44), 'Each dock action has its own usable touch target').toBe(true);
    await trigger.hover();
    await expect(page.getByRole('tooltip')).toHaveText(name);
    await expect(hudWindow(page), 'Hover never opens a module').toBeHidden();
    const tip = (await page.getByRole('tooltip').boundingBox())!, dockBox = (await dock.boundingBox())!;
    expect(tip.y + tip.height <= dockBox.y || tip.y >= dockBox.y + dockBox.height, 'Tooltip stays above or below the whole dock').toBe(true);
    await trigger.focus(); await expect(page.getByRole('tooltip')).toHaveText(name);
    await trigger.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(1); await expect(hudWindow(page)).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true'); await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => document.querySelector('#hud-window')!.contains(document.activeElement)), { message: 'Keyboard entry puts focus into the opened panel' }).toBe(true);
    await containedHud(page);
    if (info.project.name === 'mobile') await expect(dock).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(hudWindow(page)).toBeHidden(); await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(trigger).toHaveAttribute('aria-pressed', 'false');
    const after = (await trigger.boundingBox())!;
    expect(after.x).toBeCloseTo(before!.x, 2); expect(after.y).toBeCloseTo(before!.y, 2);
  }

  await openHud(page, '个人');
  if (info.project.name === 'desktop') {
    await hudButton(page, '背包').click(); await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(hudButton(page, '个人')).toHaveAttribute('aria-expanded', 'false');
    await expect(hudButton(page, '背包')).toHaveAttribute('aria-expanded', 'true');
    await hudButton(page, '背包').click(); await expect(hudWindow(page)).toBeHidden();
  } else {
    await closeHud(page); await expect(hudButton(page, '个人')).toBeFocused();
    await page.setViewportSize({ width: 320, height: 568 });
    await openHud(page, '背包'); await containedHud(page); await expect(dock).toBeHidden(); await closeHud(page);
    await expect(hudButton(page, '背包')).toBeFocused();
  }
  const restored = await camera(page);
  // The mobile resize is a viewport change; ordinary panel actions themselves
  // must not reset the chosen view or request browser fullscreen.
  if (info.project.name === 'desktop') {
    expect(restored.x).toBeCloseTo(original.x, 4); expect(restored.y).toBeCloseTo(original.y, 4); expect(restored.scale).toBeCloseTo(original.scale, 4);
  }
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await noPageOverflow(page);
});
