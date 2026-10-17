import { test, expect } from './helpers/owner-account-ui.ts';
import { idle, loginIdentifier, logout, mutation } from './helpers/owner-account-ui.ts';
import { accountFixture, agentFixture, credential, fixtureOk, fixtureRequest, operationId, privateDirectory, privateJson } from './helpers/private-fixtures.ts';
import { rm } from 'node:fs/promises';
import { hudNames, hudButton, hudWindow, openHud, closeHud, containedHud, camera, noPageOverflow } from './helpers/hud-ui.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function ownerWithAgents(origin: string, directory: string, names: string[]) {
  const owner = await accountFixture(origin, directory), agents = [];
  for (const name of names) {
    const inviteToken = credential(); await privateJson(directory, 'hud-invite', { inviteToken });
    await fixtureOk(origin, '/owner/agent-invites', { operationId: operationId(), inviteToken }, owner.sessionToken);
    agents.push(await agentFixture(origin, directory, name, inviteToken));
  }
  return { owner, agents };
}

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
    if (info.project.name === 'desktop') {
      await trigger.hover();
      await expect(page.getByRole('tooltip')).toHaveText(name);
      await expect(hudWindow(page), 'Hover never opens a module').toBeHidden();
      const tip = (await page.getByRole('tooltip').boundingBox())!, dockBox = (await dock.boundingBox())!;
      expect(tip.y + tip.height <= dockBox.y || tip.y >= dockBox.y + dockBox.height, 'Tooltip stays above or below the whole dock').toBe(true);
    }
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
    await page.setViewportSize({ width: 1280, height: 800 });
    await openHud(page, '背包'); await containedHud(page); await closeHud(page);
    await expect(hudButton(page, '背包')).toBeFocused();
    for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(size);
      for (const name of hudNames) {
        await openHud(page, '世界'); await page.locator('#world-open-list').click();
        const beforeDetail = await camera(page);
        await page.getByRole('button', { name: '中央公共庭', exact: true }).click();
        await expect(page.locator('#world-detail-title')).toHaveText('中央公共庭');
        const placeBox = (await page.locator('#world-detail').boundingBox())!, dockBox = (await dock.boundingBox())!;
        expect(placeBox.x + placeBox.width, 'The place card leaves at least 12px before the full dock').toBeLessThanOrEqual(dockBox.x - 12);
        for (const action of hudNames) await expect(hudButton(page, action)).toBeInViewport();
        await hudButton(page, name).click();
        await expect(hudWindow(page)).toBeVisible(); await expect(page.locator('#hud-title')).toHaveText(name);
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(page.locator('#world-detail'), 'A place card does not intercept a different dock action').toBeHidden();
        const afterDetail = await camera(page);
        expect(afterDetail.x).toBeCloseTo(beforeDetail.x, 4); expect(afterDetail.y).toBeCloseTo(beforeDetail.y, 4); expect(afterDetail.scale).toBeCloseTo(beforeDetail.scale, 4);
        await closeHud(page); await expect(hudButton(page, name)).toBeFocused();
      }
    }
  }
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await noPageOverflow(page);
});

test('an Agent settings URL locates a bound target but never grants access to another account target', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('hud-target-authorization-');
  try {
    const own = await ownerWithAgents(baseURL!, directory, ['自己的第一位', '自己的第二位']);
    const other = await ownerWithAgents(baseURL!, directory, ['另一账号的私有目标']);
    const selected = own.agents[1]!, foreign = other.agents[0]!;
    await loginIdentifier(page, privacy, own.owner.username, own.owner.password);
    await page.goto(`/owner#agent=${encodeURIComponent(selected.agentId)}`);
    await expect(page.locator('#selected-id')).toContainText(selected.agentId);
    await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(selected.name);
    expect((await fixtureRequest(baseURL!, `/owner/agents/${foreign.agentId}`, undefined, own.owner.sessionToken)).status).toBe(404);

    privacy.allowStatus(`/v1/owner/agents/${foreign.agentId}`, 404);
    await page.goto(`/owner#agent=${encodeURIComponent(foreign.agentId)}`);
    await expect(page.locator('#selected-id')).not.toContainText(foreign.agentId);
    await expect(page.locator('#global-notice')).toContainText(/无权|无法|不属于|未关联|不可访问|不可用/);
    const visible = await page.locator('body').innerText();
    expect([foreign.name, other.owner.username, other.owner.email, other.owner.ownerId].every(value => !visible.includes(value)),
      'A public target locator does not reveal another owner or its private management fields').toBe(true);
    const list = await fixtureOk(baseURL!, '/owner/agents', undefined, own.owner.sessionToken);
    expect(list.agents.map((agent: any) => agent.agentId).sort()).toEqual(own.agents.map(agent => agent.agentId).sort());
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, foreign.runtimeToken)).agentId).toBe(foreign.agentId);
    await logout(page); await page.goto(`/owner#agent=${encodeURIComponent(selected.agentId)}`);
    await expect(page.locator('#login-form')).toBeVisible(); await expect(page.locator('#manage-view')).toBeHidden();
    expect((await page.locator('body').innerText()).includes(selected.name), 'A target URL alone cannot restore an account session').toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real account summaries keep zero, one and multiple Agent targets isolated across navigation, delayed refresh, failure and logout', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('hud-real-session-');
  const releases: Array<() => void> = [];
  try {
    const owner = await accountFixture(baseURL!, directory);
    await loginIdentifier(page, privacy, owner.username, owner.password); await page.goto('/');
    const writes: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${path}`);
    });
    await expect(page.locator('#hud-account')).toContainText(owner.username);
    const selector = page.getByLabel('当前 Agent', { exact: true });
    await expect(selector).toBeDisabled(); await openHud(page, '个人');
    await expect(hudWindow(page)).toContainText('你还没有关联的 Agent');
    await expect(hudWindow(page).getByRole('link', { name: '邀请 Agent', exact: true })).toHaveAttribute('href', '/owner');
    const add = async (name: string) => {
      const inviteToken = credential(); await privateJson(directory, 'hud-real-invite', { inviteToken });
      await fixtureOk(baseURL!, '/owner/agent-invites', { operationId: operationId(), inviteToken }, owner.sessionToken);
      return agentFixture(baseURL!, directory, name, inviteToken);
    };
    const refresh = async () => {
      if (await page.locator('#hud-account').getAttribute('aria-expanded') !== 'true') await page.locator('#hud-account').click();
      await page.getByRole('button', { name: '刷新账户状态', exact: true }).click();
    };
    const initial = await add('真实初始 Agent'); await refresh();
    await expect(selector).toBeEnabled(); await expect(selector).toHaveValue(initial.agentId);
    await openHud(page, '个人'); await expect(hudWindow(page)).toContainText(initial.name);
    const added = await add('真实追加 Agent'); await refresh();
    await expect(selector.locator('option')).toHaveCount(2);
    const optionIds = await selector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    const fixtures = [initial, added];
    expect([...optionIds].sort(), 'Both real options map to this account’s complete fixture identities').toEqual(fixtures.map(agent => agent.agentId).sort());
    const first = fixtures.find(agent => agent.agentId === optionIds[0])!, second = fixtures.find(agent => agent.agentId === optionIds[1])!;
    const bio = '非首项居民自己的简介，不属于首项。';
    const self = await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken);
    const draft = await fixtureOk(baseURL!, `/agents/${second.agentId}/profile/draft`, { operationId: operationId(),
      expectedVersion: self.profile.version, expectedPolicyVersion: self.profile.policyVersion,
      fields: { displayName: second.name, avatar: { template: 'basic', color: 'coral' }, bio } }, second.runtimeToken, 'PUT');
    await fixtureOk(baseURL!, `/agents/${second.agentId}/profile/publish`, { operationId: operationId(),
      expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion }, second.runtimeToken);
    await refresh();
    await expect(selector.locator('option')).toHaveCount(2);
    expect(await selector.locator('option').first().getAttribute('value'), 'The journey deliberately selects a non-first Agent').not.toBe(second.agentId);
    await selector.selectOption(second.agentId); await refresh();
    await expect(page.locator('#hud-agent')).toHaveAttribute('data-phase', 'ready');
    await expect(selector).toHaveValue(second.agentId); await openHud(page, '个人');
    await expect(hudWindow(page)).toContainText(second.name); await expect(hudWindow(page)).not.toContainText(first.name);
    await expect(hudWindow(page)).toContainText(bio);
    const profileAvatar = hudWindow(page).locator('#hud-feature-profile .hud-profile-identity canvas');
    const chosenImage = await profileAvatar.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    const management = hudWindow(page).getByRole('link', { name: '管理资料与参与方式', exact: true });
    await expect(management).toHaveAttribute('href', `/owner#agent=${second.agentId}`);
    await management.click(); await idle(page);
    await expect(page.locator('#selected-id')).toContainText(second.agentId);
    await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(second.name);
    await expect(page.locator('#bio')).toHaveValue(bio); await expect(page.locator('#avatar-color')).toHaveValue('coral');
    expect(await page.locator('#selected-avatar canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()), 'The management avatar matches the selected personal profile').toBe(chosenImage);
    await page.getByRole('link', { name: 'connet.ai 首页', exact: true }).click();
    await expect(page.locator('#hud-agent')).toHaveAttribute('data-phase', 'ready');
    await expect(selector, 'Returning through the brand keeps the deliberately selected non-first Agent').toHaveValue(second.agentId);
    await openHud(page, '个人');
    await expect(hudWindow(page)).toContainText(second.name); await expect(hudWindow(page)).toContainText(bio);
    await expect(hudWindow(page)).not.toContainText(first.name);
    expect(await profileAvatar.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()), 'The same selected Agent keeps its own avatar after returning to the world').toBe(chosenImage);
    await expect(hudWindow(page).getByRole('link', { name: '管理资料与参与方式', exact: true })).toHaveAttribute('href', `/owner#agent=${second.agentId}`);
    await closeHud(page); await selector.selectOption(first.agentId); await openHud(page, '背包');
    await expect(hudWindow(page)).toContainText('此内容尚未接入');
    await hudWindow(page).getByRole('button', { name: '查看演示背包', exact: true }).click();
    await expect(hudWindow(page).locator('.hud-demo-label:visible')).toContainText('非当前账号或 Agent 的资产');
    await closeHud(page); await selector.selectOption(second.agentId); await openHud(page, '背包');
    await expect(hudWindow(page)).toContainText('此内容尚未接入');
    await expect(hudWindow(page).locator('.hud-demo-label:visible')).toHaveCount(0);
    await closeHud(page);
    const text = await page.locator('body').innerText();
    expect([owner.email, owner.ownerId, owner.sessionToken, owner.recoveryToken].every(value => !text.includes(value)), 'The HUD account projection exposes no email, internal owner UUID or proof').toBe(true);

    const holdRead = async () => {
      let enter!: () => void, finish!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; }), finished = new Promise<void>(resolve => { finish = resolve; });
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }); releases.push(release);
      await page.route('**/v1/owner/agents', async route => {
        const response = await route.fetch(); expect(response.status()).toBe(200); enter(); await gate;
        try { await route.fulfill({ response }); }
        catch (error) { if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error; }
        finally { finish(); }
      }, { times: 1 });
      return { entered, finished, release };
    };
    await selector.selectOption(first.agentId); const old = await holdRead(); await refresh(); await old.entered;
    const repeated = await holdRead(); await refresh(); await repeated.entered;
    await expect(selector, 'Refreshing the same valid account twice keeps current Agent choices usable').toBeEnabled();
    await expect(page.locator('#hud-account')).toContainText(owner.username);
    await selector.selectOption(second.agentId); await openHud(page, '个人');
    await expect(hudWindow(page)).toContainText(second.name); old.release(); repeated.release(); await Promise.all([old.finished, repeated.finished]);
    await expect(page.locator('#hud-agent')).toHaveAttribute('data-phase', 'ready');
    await expect(selector).toHaveValue(second.agentId); await expect(hudWindow(page)).toContainText(second.name);
    await expect(hudWindow(page)).not.toContainText(first.name);

    const savedProof = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}').sessionToken);
    privacy.track(savedProof); privacy.allowStatus('/v1/owner/account', 503);
    await page.route('**/v1/owner/account', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'service_unavailable' } }) }), { times: 1 });
    await refresh(); await expect(page.locator('#hud-agent')).toHaveAttribute('data-phase', 'error'); await openHud(page, '个人');
    await expect(hudWindow(page)).toContainText('资料暂不可用');
    await expect(hudWindow(page).getByRole('button', { name: '查看演示资料', exact: true })).toBeVisible();
    await expect(hudWindow(page).getByText('小岚', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(proof => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}').sessionToken === proof, savedProof), 'A transient read failure retains the valid private login material').toBe(true);
    await refresh(); await expect(selector).toHaveValue(second.agentId);

    const late = await holdRead(); await refresh(); await late.entered;
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    expect(await page.evaluate(() => sessionStorage.getItem('connet.owner.v2') === null && sessionStorage.getItem('connet.owner.progress.v2') === null), 'HUD logout clears the private owner session and archive').toBe(true);
    late.release(); await late.finished;
    await expect(selector).toBeDisabled(); await expect(page.locator('#hud-account')).toContainText('注册／登录');
    expect(await page.evaluate(ids => ids.every(id => !JSON.stringify(sessionStorage).includes(id)), [first.agentId, second.agentId]),
      'Logout and a late read do not retain the previous account selection in tab progress').toBe(true);
    await openHud(page, '个人'); await expect(hudWindow(page)).toContainText('登录后可查看自己的 Agent 资料');
    await expect(hudWindow(page)).not.toContainText(first.name); await expect(hudWindow(page)).not.toContainText(second.name);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, first.runtimeToken)).agentId).toBe(first.agentId);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken)).agentId).toBe(second.agentId);
    expect(writes, 'Real summaries, demo previews, refresh and logout submit no business mutations').toEqual([]);
    await page.reload(); await expect(selector).toBeDisabled();
    await expect(selector.locator('option')).toHaveCount(1);
    expect(await selector.locator('option').first().getAttribute('value')).not.toBe(second.agentId);
    const other = await ownerWithAgents(baseURL!, directory, ['新账号的第一位', '新账号的第二位']);
    await loginIdentifier(page, privacy, other.owner.username, other.owner.password);
    await page.getByRole('link', { name: 'connet.ai 首页', exact: true }).click();
    await expect(page.locator('#hud-agent')).toHaveAttribute('data-phase', 'ready');
    await expect(selector.locator('option')).toHaveCount(2);
    const choices = await selector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    expect(choices.sort()).toEqual(other.agents.map(agent => agent.agentId).sort());
    expect(other.agents.map(agent => agent.agentId)).toContain(await selector.inputValue());
    await openHud(page, '个人');
    await expect(hudWindow(page)).not.toContainText(first.name); await expect(hudWindow(page)).not.toContainText(second.name);
    await page.goto(`/owner#agent=${second.agentId}`); await idle(page);
    await expect(page.locator('#global-notice')).toContainText('不可用');
    await expect(page.locator('#selected-id')).not.toContainText(second.agentId);
    expect((await page.locator('body').innerText()).includes(second.name), 'An old account selection cannot authorize or disclose its target to a different account').toBe(false);
    expect(writes, 'Only the deliberate new-account login writes during the account switch').toEqual(['POST /v1/owner/sessions']);
  } finally { for (const release of releases) release(); await rm(directory, { recursive: true, force: true }); }
});

test('an owner target change keeps editing locked until the new authorized read finishes after an older refresh is cancelled', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('owner-target-read-race-');
  const held: Array<() => void> = [];
  try {
    const own = await ownerWithAgents(baseURL!, directory, ['切换前的居民', '切换后的居民']);
    const first = own.agents[0]!, second = own.agents[1]!;
    await loginIdentifier(page, privacy, own.owner.username, own.owner.password);
    await page.goto(`/owner#agent=${first.agentId}`); await idle(page);
    await expect(page.locator('#selected-id')).toContainText(first.agentId);
    await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(first.name);

    const writes: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${path}`);
    });
    const holdRead = async (path: string) => {
      let enter!: () => void, finish!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      held.push(release);
      await page.route(`**/v1${path}`, async route => {
        const response = await route.fetch(); expect(response.status()).toBe(200); enter(); await gate;
        try { await route.fulfill({ response }); }
        catch (error) { if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error; }
        finally { finish(); }
      }, { times: 1 });
      return { entered, finished, release };
    };
    const locked = async () => {
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
      for (const selector of ['#display-name', '#bio', '#interests', '#avatar-color', '#save-profile', '#publish-profile']) {
        await expect(page.locator(selector), 'A superseded read cannot unlock a target that is still being verified').toBeDisabled();
      }
      await expect(page.locator('#unknown-controls')).toBeHidden();
      await expect(page.locator('#global-notice'), 'Cancelling a superseded read does not invent an unresolved write').not.toHaveClass(/pending/);
      expect(writes, 'No profile mutation is sent while the new target is unresolved').toEqual([]);
    };

    const old = await holdRead('/owner/agents');
    await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await old.entered;
    await locked();
    const next = await holdRead('/owner/agents'), account = await holdRead('/owner/account');
    const cancelled = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === '/v1/owner/agents');
    const originalDocument = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate(target => { location.hash = `agent=${encodeURIComponent(target)}`; }, second.agentId);
    await next.entered; await cancelled;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => performance.timeOrigin), 'The target changes in the current owner document').toBe(originalDocument);
    await locked();
    await expect(page.locator('#selected-id')).toContainText(first.agentId);
    old.release(); await old.finished;
    await locked();

    next.release(); await next.finished; await account.entered;
    await locked();
    account.release(); await account.finished; await idle(page);
    await expect(page.locator('#selected-id')).toContainText(second.agentId);
    await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(second.name);
    await expect(page.getByLabel('居民名字', { exact: true })).toBeEditable();
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
    const changedName = '只保存到切换后的居民';
    await page.getByLabel('居民名字', { exact: true }).fill(changedName);
    await mutation(page, `/agents/${second.agentId}/profile/draft`, page.getByRole('button', { name: '保存草稿', exact: true }), 200, 'PUT');
    expect(writes).toEqual([`PUT /v1/agents/${second.agentId}/profile/draft`]);
    const list = await fixtureOk(baseURL!, '/owner/agents', undefined, own.owner.sessionToken);
    expect(list.agents.find((agent: any) => agent.agentId === first.agentId).profile.draft.displayName).toBe(first.name);
    expect(list.agents.find((agent: any) => agent.agentId === second.agentId).profile.draft.displayName).toBe(changedName);
  } finally {
    for (const release of held) release();
    await page.unrouteAll({ behavior: 'wait' });
    await rm(directory, { recursive: true, force: true });
  }
});
