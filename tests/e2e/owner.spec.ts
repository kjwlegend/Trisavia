import { test, expect } from '@playwright/test';
import type { Download, Locator, Page } from '@playwright/test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

// These are synthetic residents on e2e-server's isolated database, not a host compatibility claim.
// Private downloads never enter a trace, screenshot, video, test attachment or assertion output.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type Json = Record<string, any>;
const origin = 'http://127.0.0.1:8897';
const credential = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
const op = () => randomUUID();
interface BrowserObservation {
  errors: string[]; secrets: Set<string>; leakedUrl: boolean;
  plannedFailures: Array<{ pathname: string; marker: string; remaining: number }>;
}
const observed = new WeakMap<Page, BrowserObservation>();

test.beforeEach(async ({ page }) => {
  const state: BrowserObservation = { errors: [], secrets: new Set<string>(), leakedUrl: false, plannedFailures: [] };
  observed.set(page, state);
  page.on('pageerror', () => state.errors.push('pageerror'));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    let pathname = '';
    try { pathname = new URL(message.location().url).pathname; } catch {}
    const planned = state.plannedFailures.find((failure) => failure.remaining > 0 && failure.pathname === pathname && message.text().includes(failure.marker));
    if (planned) planned.remaining--;
    else state.errors.push('console.error');
  });
  page.on('request', (request) => {
    for (const secret of state.secrets) if (request.url().includes(secret)) state.leakedUrl = true;
  });
});
test.afterEach(async ({ page }) => {
  const state = observed.get(page)!;
  expect(state.errors, 'Browser must have no unexpected pageerror or console.error').toEqual([]);
  expect(state.leakedUrl, 'No private material may enter an HTTP request URL').toBe(false);
});

function track(page: Page, ...values: string[]) {
  for (const value of values) {
    observed.get(page)!.secrets.add(value);
    if (value.includes('.')) observed.get(page)!.secrets.add(value.slice(value.indexOf('.') + 1));
  }
}
function plannedFailure(page: Page, pathname: string, marker: string) {
  observed.get(page)!.plannedFailures.push({ pathname, marker, remaining: 1 });
}
async function privateFile(directory: string, name: string, data: Json): Promise<string> {
  const path = join(directory, `${name}-${randomUUID()}.private.json`);
  await writeFile(path, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
  expect((await stat(path)).mode & 0o777, 'Private test material uses mode 0600').toBe(0o600);
  return path;
}
async function downloaded(page: Page, button: Locator, directory: string): Promise<Json> {
  const event = page.waitForEvent('download');
  await button.click();
  const download: Download = await event;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Private download did not produce a stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  let value: Json;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json; }
  catch { throw new Error('Private download could not be decoded'); }
  await privateFile(directory, 'download', value);
  await download.delete();
  for (const [key, entry] of Object.entries(value)) if (/token/i.test(key) && typeof entry === 'string') track(page, entry);
  return value;
}
async function http(path: string, body?: Json, bearer?: string, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${origin}/v1${path}`, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: Json;
  try { data = await response.json() as Json; } catch { throw new Error('Synthetic fixture received non-JSON response'); }
  return { status: response.status, data };
}
async function ok(path: string, body?: Json, bearer?: string, method?: string): Promise<Json> {
  const response = await http(path, body, bearer, method);
  expect(response.status, 'Synthetic HTTP operation must succeed').toBe(200);
  return response.data;
}
async function resident(directory: string, name: string, inviteToken?: string) {
  const runtimeToken = credential(), continuationToken = credential();
  const registration = { operationId: op(), attemptId: randomUUID(), runtimeToken, continuationToken, ...(inviteToken ? { inviteToken } : {}) };
  await privateFile(directory, 'agent', registration); // Persist both proofs and the original command before registration.
  const result = await ok('/registrations', registration);
  const agentId = result.agentId as string;
  const draft = await ok(`/agents/${agentId}/profile/draft`, {
    operationId: op(), expectedVersion: 1, expectedPolicyVersion: 1,
    fields: { displayName: name, avatar: { template: 'basic', color: 'olive' }, bio: 'Synthetic browser-test resident', interests: ['reading'] },
  }, runtimeToken, 'PUT');
  const profile = await ok(`/agents/${agentId}/profile/publish`, { operationId: op(), expectedVersion: draft.version, expectedPolicyVersion: draft.policyVersion }, runtimeToken);
  await ok(`/agents/${agentId}/membership/join`, { operationId: op(), expectedVersion: 1, expectedProfileVersion: profile.version }, runtimeToken);
  return { agentId, ownerId: result.ownerId as string, runtimeToken, continuationToken, name };
}
type Resident = Awaited<ReturnType<typeof resident>>;
async function initialHandoff(directory: string, agent: Resident) {
  const token = credential();
  const command = { operationId: op(), expectedGeneration: 0, handoffToken: token };
  await privateFile(directory, 'handoff', command);
  await ok('/agent/self/handoffs', command, agent.continuationToken);
  return token;
}
async function managedFixture(directory: string, agent: Resident) {
  const token = await initialHandoff(directory, agent);
  const setupToken = credential(), sessionToken = credential(), recoveryToken = credential();
  const password = 'synthetic owner passphrase one';
  await privateFile(directory, 'owner', { setupToken, sessionToken, recoveryToken, password });
  await ok('/owner-setups', { operationId: op(), setupToken }, token);
  await ok('/owner/setup/complete', { operationId: op(), password, recoveryToken, sessionToken, credentialsSaved: true }, setupToken);
  return { sessionToken, recoveryToken, password };
}
async function idle(page: Page) {
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}
async function mutate(page: Page, path: string, button: Locator, method = 'POST') {
  const response = page.waitForResponse((value) => new URL(value.url()).pathname === `/v1${path}` && value.request().method() === method);
  await button.click();
  expect((await response).status(), 'Visible management action must commit').toBe(200);
  await idle(page);
}
async function login(page: Page, ownerId: string, password: string) {
  track(page, password);
  await page.goto('/owner');
  await page.getByLabel('主人 ID', { exact: true }).fill(ownerId);
  await page.getByLabel('管理密码', { exact: true }).fill(password);
  await mutate(page, '/owner/sessions', page.getByRole('button', { name: '登录', exact: true }));
  await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
}
async function select(page: Page, agent: Resident) {
  const selector = page.getByRole('combobox', { name: /^当前居民/ });
  if (await selector.isVisible()) await selector.selectOption(agent.agentId);
  else await page.locator('#agent-list').getByRole('button').filter({ hasText: agent.name }).click();
  await expect(page.locator('#selected-id')).toContainText(agent.agentId);
  await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(agent.name);
}

test('主人先保存私密管理材料，再登录和独立恢复；旧会话随恢复失效', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-ui-'));
  try {
    const agent = await resident(directory, 'UI Quiet Resident');
    const handoffToken = await initialHandoff(directory, agent);
    track(page, handoffToken, agent.runtimeToken, agent.continuationToken);
    const selfBefore = await ok('/agent/self', undefined, agent.runtimeToken);
    expect(selfBefore.membership.state).toBe('joined'); expect(selfBefore.management.managementStatus).toBe('pending_setup');
    await page.goto('/');
    // Passing the secret to evaluate avoids putting it into navigation/assertion call logs.
    await page.evaluate((proof) => { location.assign(`/owner#handoff=${encodeURIComponent(proof)}`); }, handoffToken);
    await expect(page.getByRole('button', { name: '开始设置', exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash.length, { message: 'Handoff fragment is removed immediately' }).toBe(0);
    await mutate(page, '/owner-setups', page.getByRole('button', { name: '开始设置', exact: true }));
    await expect(page.getByRole('button', { name: '完成设置', exact: true })).toBeDisabled();
    const password = 'synthetic browser password initial'; track(page, password);
    await page.getByLabel('设置管理密码', { exact: true }).fill(password);
    const saved = await downloaded(page, page.getByRole('button', { name: '下载私密管理文件', exact: true }), directory);
    expect(saved.format).toBe('connet-owner-v1'); expect(saved.ownerId).toBe(agent.ownerId);
    expect((await ok('/agent/self', undefined, agent.runtimeToken)).management.managementStatus).toBe('pending_setup');
    await page.getByRole('checkbox', { name: '我已保存私密管理文件', exact: true }).check();
    await mutate(page, '/owner/setup/complete', page.getByRole('button', { name: '完成设置', exact: true }));
    await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
    await expect(page.locator('#stage-generated')).toContainText('已生成');
    await expect(page.locator('#stage-delivered')).toHaveText('尚未声明交付');
    await expect(page.locator('#stage-initialized')).toContainText('已建立');
    await page.getByRole('button', { name: '退出管理', exact: true }).click();
    await login(page, agent.ownerId, password);
    await page.getByRole('button', { name: '退出管理', exact: true }).click();
    await page.getByRole('tab', { name: '独立恢复', exact: true }).click();
    await page.getByLabel('恢复主人 ID', { exact: true }).fill(agent.ownerId);
    await page.getByLabel('恢复证明', { exact: true }).fill(saved.recoveryToken as string);
    const nextPassword = 'synthetic browser password next'; track(page, nextPassword);
    await page.getByLabel('新管理密码', { exact: true }).fill(nextPassword);
    await expect(page.getByRole('button', { name: '恢复管理访问', exact: true })).toBeDisabled();
    const next = await downloaded(page, page.getByRole('button', { name: '下载下一代恢复文件', exact: true }), directory);
    expect(next.recoveryToken !== saved.recoveryToken, 'Recovery successor is independently generated').toBe(true);
    await page.getByRole('checkbox', { name: '我已保存下一代恢复文件', exact: true }).check();
    await mutate(page, '/owner/recoveries', page.getByRole('button', { name: '恢复管理访问', exact: true }));
    await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
    expect((await http('/owner/agents', undefined, saved.sessionToken as string)).status).toBe(401);
    expect((await http('/owner/recoveries', { operationId: op(), password: nextPassword, recoveryToken: credential(), sessionToken: credential(), credentialsSaved: true }, saved.recoveryToken as string)).status).toBe(401);
    expect((await ok('/agent/self', undefined, agent.runtimeToken)).agentId).toBe(agent.agentId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('主人邀请第二位居民；读取期间锁住切换，回包后草稿和目标仍对应', async ({ page }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-targets-'));
  try {
    const a1 = await resident(directory, 'UI First Resident');
    const owner = await managedFixture(directory, a1);
    await login(page, a1.ownerId, owner.password);
    const invite = await downloaded(page, page.getByRole('button', { name: '下载单次邀请文件', exact: true }), directory);
    await expect(page.getByRole('button', { name: '签发已保存的邀请', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: '我已保存邀请文件', exact: true }).check();
    await mutate(page, '/owner/agent-invites', page.getByRole('button', { name: '签发已保存的邀请', exact: true }));
    const a2 = await resident(directory, 'UI Second Resident', invite.inviteToken as string);
    await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await idle(page);
    await expect(page.locator('#agent-count')).toHaveText('2');
    await select(page, a1);
    await page.getByLabel('居民名字', { exact: true }).fill('Unsaved draft for first resident only');
    await select(page, a2);
    await mutate(page, `/agents/${a2.agentId}/profile/draft`, page.getByRole('button', { name: '保存草稿', exact: true }), 'PUT');
    expect((await ok(`/agents/${a1.agentId}/profile`, undefined, a1.runtimeToken)).draft.displayName).toBe(a1.name);
    await select(page, a1);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const intercepted = new Promise<void>((resolve) => { entered = resolve; });
    await page.route('**/v1/owner/agents', async (route) => {
      const response = await route.fetch(); entered(); await gate; await route.fulfill({ response });
    }, { times: 1 });
    try {
      await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await intercepted;
      await expect(page.getByTestId('agent-select')).toBeDisabled();
      const buttons = page.locator('#agent-list').getByRole('button', { includeHidden: true });
      await expect(buttons).toHaveCount(2);
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
    } finally { release(); }
    await idle(page); await select(page, a2);
    await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(a2.name);
    await expect(page.locator('#selected-id')).toContainText(a2.agentId);
    await expect(page.locator('#stage-generated')).toHaveText('尚无生成记录');
    await expect(page.locator('#stage-delivered')).toHaveText('尚未声明交付');
    await expect(page.locator('#stage-initialized')).toContainText('已建立');
    const courtyardToggle = page.getByText('查看我的庭院', { exact: true });
    await courtyardToggle.focus(); await page.keyboard.press('Enter');
    const firstChip = page.locator('#owner-courtyard').getByRole('button', { name: a1.name, exact: true });
    let tabReachedResident = false;
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab');
      if (await firstChip.evaluate((element) => element === document.activeElement)) { tabReachedResident = true; break; }
    }
    expect(tabReachedResident, 'A resident in the courtyard is keyboard reachable').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#selected-id')).toContainText(a1.agentId);
    await expect(firstChip).toBeFocused();
    const focusStyle = await firstChip.evaluate((element) => {
      const style = getComputedStyle(element);
      return { keyboardVisible: element.matches(':focus-visible'), width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(focusStyle.keyboardVisible, 'Resident selection retains visible keyboard focus after rendering').toBe(true);
    expect(focusStyle.width).toBeGreaterThanOrEqual(2); expect(focusStyle.style).not.toBe('none');
    for (const width of testInfo.project.name === 'mobile' ? [390, 320] : [1440]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await firstChip.boundingBox();
      expect(bounds !== null, 'A courtyard resident has a visible touch target').toBe(true);
      expect(bounds!.height, 'Courtyard resident controls need a 44px touch target').toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'The keyboard-accessible courtyard must not overflow').toBe(false);
    }
    const stranger = await resident(directory, 'UI Foreign Resident');
    const strangerOwner = await managedFixture(directory, stranger);
    expect((await http(`/owner/agents/${a1.agentId}`, undefined, strangerOwner.sessionToken)).status).toBe(404);
    expect((await http(`/owner/agents/${a2.agentId}/runtime-access/revoke`, { operationId: op(), expectedVersion: 1 }, strangerOwner.sessionToken)).status).toBe(404);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('主人控制资料三模式与字段锁、暂停退出重入，并先保存再替换运行访问', async ({ page }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-controls-'));
  try {
    const agent = await resident(directory, 'UI Controlled Resident');
    const owner = await managedFixture(directory, agent);
    await login(page, agent.ownerId, owner.password);
    await expect(page.getByRole('combobox', { name: /^资料设定模式/ })).toHaveValue('agent_autonomous');
    for (const mode of ['owner_specified', 'proposal_required']) {
      await page.getByRole('combobox', { name: /^资料设定模式/ }).selectOption(mode);
      await mutate(page, `/owner/agents/${agent.agentId}/profile-policy`, page.getByRole('button', { name: '保存字段控制', exact: true }), 'PUT');
      const current = await ok(`/agents/${agent.agentId}/profile`, undefined, agent.runtimeToken);
      expect(current.mode).toBe(mode);
      expect((await http(`/agents/${agent.agentId}/profile/publish`, { operationId: op(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion }, agent.runtimeToken)).status).toBe(403);
    }
    await page.getByRole('checkbox', { name: '名字', exact: true }).check();
    await mutate(page, `/owner/agents/${agent.agentId}/profile-policy`, page.getByRole('button', { name: '保存字段控制', exact: true }), 'PUT');
    const locked = await ok(`/agents/${agent.agentId}/profile`, undefined, agent.runtimeToken);
    expect((await http(`/agents/${agent.agentId}/profile/draft`, { operationId: op(), expectedVersion: locked.version, expectedPolicyVersion: locked.policyVersion, fields: { displayName: 'Blocked runtime change' } }, agent.runtimeToken, 'PUT')).status).toBe(403);
    await page.getByLabel('居民名字', { exact: true }).fill('UI Owner Published');
    await mutate(page, `/agents/${agent.agentId}/profile/draft`, page.getByRole('button', { name: '保存草稿', exact: true }), 'PUT');
    await mutate(page, `/agents/${agent.agentId}/profile/publish`, page.getByRole('button', { name: '发布资料', exact: true }));
    await expect(page.getByRole('heading', { name: 'UI Owner Published', exact: true })).toBeVisible();
    await expect(page.locator('#confirmation-source')).toContainText('已认证主人发布');
    await mutate(page, `/owner/agents/${agent.agentId}/participation`, page.getByRole('button', { name: '暂停参与', exact: true }), 'PUT');
    await expect(page.getByText('主人已暂停', { exact: true })).toBeVisible();
    await mutate(page, `/agents/${agent.agentId}/membership/leave`, page.getByRole('button', { name: '退出庭院', exact: true }));
    await expect(page.getByText('已退出庭院', { exact: true })).toBeVisible();
    expect((await http(`/public/agents/${agent.agentId}`)).status).toBe(404);
    await mutate(page, `/owner/agents/${agent.agentId}/participation`, page.getByRole('button', { name: '恢复参与', exact: true }), 'PUT');
    await mutate(page, `/agents/${agent.agentId}/membership/join`, page.getByRole('button', { name: '加入庭院', exact: true }));
    await expect(page.getByText('已加入庭院', { exact: true })).toBeVisible();
    await page.getByText('运行访问管理', { exact: true }).click();
    const runtime = await downloaded(page, page.getByRole('button', { name: '下载替换运行文件', exact: true }), directory);
    await expect(page.getByRole('button', { name: '确认替换运行访问', exact: true })).toBeDisabled();
    expect((await http('/agent/self', undefined, runtime.runtimeToken as string)).status).toBe(401);
    await page.getByRole('checkbox', { name: '我已保存新运行文件，并确认替换当前居民', exact: true }).check();
    await mutate(page, `/owner/agents/${agent.agentId}/runtime-access/replace`, page.getByRole('button', { name: '确认替换运行访问', exact: true }));
    expect((await http('/agent/self', undefined, agent.runtimeToken)).status).toBe(401);
    expect((await ok('/agent/self', undefined, runtime.runtimeToken as string)).agentId).toBe(agent.agentId);
    expect((await ok(`/public/agents/${agent.agentId}`)).profile.displayName).toBe('UI Owner Published');
    if (testInfo.project.name === 'mobile') {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Owner controls must not overflow at 390px or 320px').toBe(false);
        for (const name of ['名字', '形象', '简介', '兴趣']) {
          const label = page.getByRole('checkbox', { name, exact: true }).locator('..');
          const bounds = await label.boundingBox();
          expect(bounds !== null, 'A lock checkbox has a visible associated label').toBe(true);
          expect(bounds!.height, 'Mobile field lock labels need a 44px touch target').toBeGreaterThanOrEqual(44);
        }
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function prepareRecovery(page: Page, directory: string, agent: Resident, owner: Awaited<ReturnType<typeof managedFixture>>, password: string) {
  track(page, owner.recoveryToken, owner.sessionToken, password);
  await page.goto('/owner');
  await page.getByRole('tab', { name: '独立恢复', exact: true }).click();
  await page.getByLabel('恢复主人 ID', { exact: true }).fill(agent.ownerId);
  await page.getByLabel('恢复证明', { exact: true }).fill(owner.recoveryToken);
  await page.getByLabel('新管理密码', { exact: true }).fill(password);
  const next = await downloaded(page, page.getByRole('button', { name: '下载下一代恢复文件', exact: true }), directory);
  expect(next.pendingOperation.scope).toBe(`owner:${agent.ownerId}`);
  expect(next.pendingOperation.action).toBe('recover');
  await page.getByRole('checkbox', { name: '我已保存下一代恢复文件', exact: true }).check();
  return next;
}
function receiptPath(next: Json): string {
  const pending = next.pendingOperation;
  return `/operations/${encodeURIComponent(pending.operationId)}?scope=${encodeURIComponent(pending.scope)}&action=${encodeURIComponent(pending.action)}`;
}
function assertSameRecoveryFields(actual: Json, original: Json) {
  // Compare only booleans: a failed assertion must never print a password or proof.
  for (const field of ['operationId', 'password', 'recoveryToken', 'sessionToken', 'credentialsSaved']) {
    expect(actual[field] === original[field], `The original recovery ${field} is retained`).toBe(true);
  }
}

async function registeredOnly(directory: string, name: string) {
  const runtimeToken = credential(), continuationToken = credential(), attemptId = randomUUID();
  const command = { operationId: op(), attemptId, runtimeToken, continuationToken };
  await privateFile(directory, 'auth-only-agent', command);
  const result = await ok('/registrations', command);
  return { agentId: result.agentId as string, ownerId: result.ownerId as string, runtimeToken, continuationToken, name, attemptId };
}
async function pendingVault(page: Page, directory: string, password: string): Promise<Json> {
  expect(await page.evaluate((secret) => !JSON.stringify(sessionStorage).includes(secret), password), 'Pending authentication must not persist its plaintext password').toBe(true);
  const value = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v1') ?? 'null')) as Json;
  expect(Boolean(value?.pendingOperation), 'The original authentication command remains persisted').toBe(true);
  if (typeof value.sessionToken === 'string') track(page, value.sessionToken);
  await privateFile(directory, 'pending-authentication', value);
  return value;
}
function sameFields(actual: Json, original: Json, fields: string[]) {
  for (const field of fields) expect(actual[field] === original[field], `The original authentication ${field} is retained`).toBe(true);
}
async function persistedBeforeSend(page: Page, body: Json, scope: string, action: string): Promise<boolean> {
  const value = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v1') ?? 'null')) as Json;
  return value?.sessionToken === body.sessionToken && value?.pendingOperation?.operationId === body.operationId
    && value.pendingOperation.scope === scope && value.pendingOperation.action === action;
}
async function prepareInitialSetup(page: Page, directory: string, agent: Resident, password: string): Promise<Json> {
  const token = await initialHandoff(directory, agent);
  track(page, token, password);
  await page.goto('/');
  await page.evaluate((proof) => { location.assign(`/owner#handoff=${encodeURIComponent(proof)}`); }, token);
  await expect(page.getByRole('button', { name: '开始设置', exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash.length).toBe(0);
  await mutate(page, '/owner-setups', page.getByRole('button', { name: '开始设置', exact: true }));
  await page.getByLabel('设置管理密码', { exact: true }).fill(password);
  const saved = await downloaded(page, page.getByRole('button', { name: '下载私密管理文件', exact: true }), directory);
  await page.getByRole('checkbox', { name: '我已保存私密管理文件', exact: true }).check();
  return { ...saved, handoffToken: token };
}

test('恢复请求未到服务时刷新，重新输入必要秘密后沿用原完整键和下一代证明', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-recover-unsent-'));
  try {
    const agent = await resident(directory, 'UI Recovery Unsent');
    const owner = await managedFixture(directory, agent);
    const password = 'synthetic original next password';
    const next = await prepareRecovery(page, directory, agent, owner, password);
    let original: Json | undefined, originalAuthorization = '';
    let aborted!: () => void;
    const intercepted = new Promise<void>((resolve) => { aborted = resolve; });
    plannedFailure(page, '/v1/owner/recoveries', 'net::ERR_FAILED');
    await page.route('**/v1/owner/recoveries', async (route) => {
      original = route.request().postDataJSON() as Json;
      originalAuthorization = route.request().headers().authorization ?? '';
      // Deliberately do not route.fetch(): the service never receives this POST.
      await route.abort('failed'); aborted();
    }, { times: 1 });
    await page.getByRole('button', { name: '恢复管理访问', exact: true }).click();
    await intercepted; await idle(page);
    expect(Boolean(original), 'Capture the original recovery command before the network failure').toBe(true);
    expect(original!.operationId).toBe(next.pendingOperation.operationId);
    expect(await page.evaluate((secret) => !JSON.stringify(sessionStorage).includes(secret), password), 'A pending recovery must not persist its plaintext password').toBe(true);
    expect((await http(receiptPath(next), undefined, owner.sessionToken)).status).toBe(404);
    expect((await http('/owner/agents', undefined, owner.sessionToken)).status).toBe(200);
    expect((await http('/owner/recoveries', { operationId: op(), credentialsSaved: false }, owner.recoveryToken)).status).toBe(400);
    plannedFailure(page, `/v1/operations/${next.pendingOperation.operationId}`, '401');
    await page.reload(); // The in-memory pendingPayload is genuinely gone.
    await expect(page.getByRole('heading', { name: '继续原恢复操作', exact: true })).toBeVisible();
    await expect(page.getByLabel('恢复主人 ID', { exact: true })).toHaveValue(agent.ownerId);
    expect(await page.getByLabel('恢复证明', { exact: true }).inputValue() === '', 'Refresh requires the old recovery proof to be re-entered').toBe(true);
    expect(await page.getByLabel('新管理密码', { exact: true }).inputValue() === '', 'Refresh requires the original new password to be re-entered').toBe(true);
    await page.getByLabel('恢复证明', { exact: true }).fill(owner.recoveryToken);
    await page.getByLabel('新管理密码', { exact: true }).fill(password);
    const reSaved = await downloaded(page, page.getByRole('button', { name: '重新下载已保存的下一代恢复文件', exact: true }), directory);
    expect(reSaved.sessionToken === next.sessionToken, 'Refresh retains the pre-saved next session').toBe(true);
    expect(reSaved.recoveryToken === next.recoveryToken, 'Refresh retains the pre-saved next recovery proof').toBe(true);
    expect(reSaved.pendingOperation.operationId).toBe(next.pendingOperation.operationId);
    expect(reSaved.pendingOperation.scope).toBe(next.pendingOperation.scope); expect(reSaved.pendingOperation.action).toBe('recover');
    await page.getByRole('checkbox', { name: '我已保存下一代恢复文件', exact: true }).check();
    let resumed: Json | undefined, resumedAuthorization = '';
    await page.route('**/v1/owner/recoveries', async (route) => {
      resumed = route.request().postDataJSON() as Json;
      resumedAuthorization = route.request().headers().authorization ?? '';
      await route.continue();
    }, { times: 1 });
    await mutate(page, '/owner/recoveries', page.getByRole('button', { name: '继续原恢复', exact: true }));
    expect(Boolean(resumed), 'Continuation must send the original recovery command').toBe(true);
    assertSameRecoveryFields(resumed!, original!);
    expect(resumedAuthorization === originalAuthorization, 'Continuation uses the original old recovery proof').toBe(true);
    const receipt = await ok(receiptPath(next), undefined, next.sessionToken as string);
    expect(receipt.operationId).toBe(next.pendingOperation.operationId);
    expect((await http('/owner/agents', undefined, owner.sessionToken)).status).toBe(401);
    expect((await ok('/owner/agents', undefined, next.sessionToken as string)).agents[0].agentId).toBe(agent.agentId);
    await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('恢复已提交但响应丢失时刷新，预存新会话按完整键读回执且旧证明失效', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-recover-committed-'));
  try {
    const agent = await resident(directory, 'UI Recovery Committed');
    const owner = await managedFixture(directory, agent);
    const next = await prepareRecovery(page, directory, agent, owner, 'synthetic committed next password');
    let original: Json | undefined, committedStatus = 0, submitted!: () => void;
    let recoveryPosts = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/owner/recoveries' && request.method() === 'POST') recoveryPosts++;
    });
    const intercepted = new Promise<void>((resolve) => { submitted = resolve; });
    plannedFailure(page, '/v1/owner/recoveries', 'net::ERR_FAILED');
    await page.route('**/v1/owner/recoveries', async (route) => {
      original = route.request().postDataJSON() as Json;
      const response = await route.fetch(); committedStatus = response.status();
      await route.abort('failed'); submitted();
    }, { times: 1 });
    await page.getByRole('button', { name: '恢复管理访问', exact: true }).click();
    await intercepted; await idle(page);
    expect(committedStatus, 'The service committed before the response was discarded').toBe(200);
    expect(Boolean(original), 'Capture the original committed recovery command').toBe(true);
    expect(original!.operationId).toBe(next.pendingOperation.operationId);
    expect(original!.sessionToken === next.sessionToken, 'The committed request uses the pre-saved next session').toBe(true);
    expect(original!.recoveryToken === next.recoveryToken, 'The committed request uses the pre-saved next recovery proof').toBe(true);
    const receiptRequest = page.waitForRequest((request) => new URL(request.url()).pathname === `/v1/operations/${next.pendingOperation.operationId}`);
    await page.reload(); // Only durable browser state can recover this result.
    const receiptUrl = new URL((await receiptRequest).url());
    expect(receiptUrl.searchParams.get('scope')).toBe(`owner:${agent.ownerId}`);
    expect(receiptUrl.searchParams.get('action')).toBe('recover');
    await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
    expect(recoveryPosts, 'Reload recovers the committed receipt without another recovery POST').toBe(1);
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
    const receipt = await ok(receiptPath(next), undefined, next.sessionToken as string);
    expect(receipt.operationId).toBe(original!.operationId);
    expect((await http('/owner/agents', undefined, owner.sessionToken)).status).toBe(401);
    expect((await http('/owner/recoveries', { operationId: op(), credentialsSaved: false }, owner.recoveryToken)).status).toBe(401);
    expect((await ok('/agent/self', undefined, agent.runtimeToken)).agentId).toBe(agent.agentId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('登录请求未到服务时刷新，重新输入密码沿用原登录键与预存会话', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-login-unsent-'));
  try {
    const agent = await registeredOnly(directory, 'UI Login Unsent');
    const owner = await managedFixture(directory, agent); track(page, owner.password);
    await page.goto('/owner');
    await page.getByLabel('主人 ID', { exact: true }).fill(agent.ownerId);
    await page.getByLabel('管理密码', { exact: true }).fill(owner.password);
    let original: Json | undefined, preSaved = false, aborted!: () => void;
    const intercepted = new Promise<void>((resolve) => { aborted = resolve; });
    plannedFailure(page, '/v1/owner/sessions', 'net::ERR_FAILED');
    await page.route('**/v1/owner/sessions', async (route) => {
      original = route.request().postDataJSON() as Json;
      preSaved = await persistedBeforeSend(page, original, `owner:${agent.ownerId}`, 'login');
      await route.abort('failed'); aborted(); // No route.fetch(): the server receives nothing.
    }, { times: 1 });
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await intercepted; await idle(page);
    const pending = await pendingVault(page, directory, owner.password);
    expect(Boolean(original)).toBe(true);
    expect(preSaved, 'The complete login key and session proof are durable before the first request').toBe(true);
    expect(pending.pendingOperation.operationId).toBe(original!.operationId);
    expect(pending.pendingOperation.scope).toBe(`owner:${agent.ownerId}`);
    expect(pending.pendingOperation.action).toBe('login');
    expect(pending.sessionToken === original!.sessionToken, 'The login session was saved before the first request').toBe(true);
    expect((await http(receiptPath(pending), undefined, owner.sessionToken)).status).toBe(404);
    plannedFailure(page, `/v1/operations/${pending.pendingOperation.operationId}`, '401');
    await page.reload();
    await expect(page.getByRole('heading', { name: '继续原登录操作', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '核对原操作结果', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '核对原操作结果', exact: true })).toBeEnabled();
    await expect(page.getByLabel('主人 ID', { exact: true })).toHaveValue(agent.ownerId);
    expect(await page.getByLabel('管理密码', { exact: true }).inputValue() === '', 'Refresh requests the original password without persisting it').toBe(true);
    await page.getByLabel('管理密码', { exact: true }).fill(owner.password);
    let resumed: Json | undefined;
    await page.route('**/v1/owner/sessions', async (route) => { resumed = route.request().postDataJSON() as Json; await route.continue(); }, { times: 1 });
    await mutate(page, '/owner/sessions', page.getByRole('button', { name: '继续原登录', exact: true }));
    expect(Boolean(resumed)).toBe(true);
    sameFields(resumed!, original!, ['operationId', 'ownerId', 'password', 'sessionToken']);
    const receipt = await ok(receiptPath(pending), undefined, pending.sessionToken as string);
    expect(receipt.operationId).toBe(original!.operationId);
    const managed = await ok('/owner/agents', undefined, pending.sessionToken as string);
    expect(managed.agents.length).toBe(1); expect(managed.agents[0].agentId).toBe(agent.agentId);
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('登录已提交但响应丢失时刷新，以原会话完整键读回执而不再次登录', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-login-committed-'));
  try {
    const agent = await registeredOnly(directory, 'UI Login Committed');
    const owner = await managedFixture(directory, agent); track(page, owner.password);
    await page.goto('/owner');
    await page.getByLabel('主人 ID', { exact: true }).fill(agent.ownerId);
    await page.getByLabel('管理密码', { exact: true }).fill(owner.password);
    let original: Json | undefined, preSaved = false, committedStatus = 0, submitted!: () => void, posts = 0;
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/v1/owner/sessions' && request.method() === 'POST') posts++; });
    const intercepted = new Promise<void>((resolve) => { submitted = resolve; });
    plannedFailure(page, '/v1/owner/sessions', 'net::ERR_FAILED');
    await page.route('**/v1/owner/sessions', async (route) => {
      original = route.request().postDataJSON() as Json;
      preSaved = await persistedBeforeSend(page, original, `owner:${agent.ownerId}`, 'login');
      const response = await route.fetch(); committedStatus = response.status();
      await route.abort('failed'); submitted();
    }, { times: 1 });
    await page.getByRole('button', { name: '登录', exact: true }).click(); await intercepted; await idle(page);
    expect(committedStatus).toBe(200); expect(Boolean(original)).toBe(true);
    expect(preSaved, 'The committed login key and proof were durable before sending').toBe(true);
    const pending = await pendingVault(page, directory, owner.password);
    expect(pending.sessionToken === original!.sessionToken, 'The committed session matches the pre-saved proof').toBe(true);
    const receiptRequest = page.waitForRequest((request) => new URL(request.url()).pathname === `/v1/operations/${original!.operationId}`);
    await page.reload();
    const url = new URL((await receiptRequest).url());
    expect(url.searchParams.get('scope')).toBe(`owner:${agent.ownerId}`); expect(url.searchParams.get('action')).toBe('login');
    await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
    expect(posts, 'Committed login recovery must not send another login POST').toBe(1);
    const receipt = await ok(receiptPath(pending), undefined, pending.sessionToken as string);
    expect(receipt.operationId).toBe(original!.operationId);
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('首次设置请求未到服务时刷新，重新保存原证明并以同键继续原设置', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-setup-unsent-'));
  try {
    const agent = await registeredOnly(directory, 'UI Setup Unsent');
    const password = 'synthetic original setup password';
    const saved = await prepareInitialSetup(page, directory, agent, password);
    let original: Json | undefined, originalAuthorization = '', preSaved = false, aborted!: () => void;
    const intercepted = new Promise<void>((resolve) => { aborted = resolve; });
    plannedFailure(page, '/v1/owner/setup/complete', 'net::ERR_FAILED');
    await page.route('**/v1/owner/setup/complete', async (route) => {
      original = route.request().postDataJSON() as Json; originalAuthorization = route.request().headers().authorization ?? '';
      preSaved = await persistedBeforeSend(page, original, saved.pendingOperation.scope as string, 'completeSetup');
      await route.abort('failed'); aborted();
    }, { times: 1 });
    await page.getByRole('button', { name: '完成设置', exact: true }).click(); await intercepted; await idle(page);
    const pending = await pendingVault(page, directory, password);
    expect(Boolean(original)).toBe(true); expect(pending.pendingOperation.operationId).toBe(original!.operationId);
    expect(preSaved, 'The complete setup key and next session are durable before sending').toBe(true);
    expect(pending.pendingOperation.scope).toBe(`setup:${(saved.setupToken as string).split('.')[0]}`);
    expect(pending.pendingOperation.action).toBe('completeSetup');
    expect((await ok('/agent/self', undefined, agent.runtimeToken)).management.managementStatus).toBe('pending_setup');
    expect((await http('/owner/setup', undefined, saved.setupToken as string)).status).toBe(200);
    plannedFailure(page, `/v1/operations/${pending.pendingOperation.operationId}`, '401');
    await page.reload();
    await expect(page.getByRole('heading', { name: '继续原设置操作', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '核对原操作结果', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '核对原操作结果', exact: true })).toBeEnabled();
    expect(await page.getByLabel('设置管理密码', { exact: true }).inputValue() === '', 'Refresh requests the original setup password without persisting it').toBe(true);
    await page.getByLabel('设置管理密码', { exact: true }).fill(password);
    const reSaved = await downloaded(page, page.getByRole('button', { name: '重新下载已保存的管理文件', exact: true }), directory);
    sameFields(reSaved, saved, ['setupToken', 'sessionToken', 'recoveryToken']);
    expect(reSaved.pendingOperation.operationId).toBe(pending.pendingOperation.operationId);
    expect(reSaved.pendingOperation.scope).toBe(pending.pendingOperation.scope); expect(reSaved.pendingOperation.action).toBe('completeSetup');
    await page.getByRole('checkbox', { name: '我已保存私密管理文件', exact: true }).check();
    let resumed: Json | undefined, resumedAuthorization = '';
    await page.route('**/v1/owner/setup/complete', async (route) => {
      resumed = route.request().postDataJSON() as Json; resumedAuthorization = route.request().headers().authorization ?? ''; await route.continue();
    }, { times: 1 });
    await mutate(page, '/owner/setup/complete', page.getByRole('button', { name: '继续原设置', exact: true }));
    expect(Boolean(resumed)).toBe(true); assertSameRecoveryFields(resumed!, original!);
    expect(resumedAuthorization === originalAuthorization, 'The original restricted setup proof is retained').toBe(true);
    const receipt = await ok(receiptPath(pending), undefined, saved.sessionToken as string);
    expect(receipt.operationId).toBe(original!.operationId);
    const managed = await ok('/owner/agents', undefined, saved.sessionToken as string);
    expect(managed.agents.length).toBe(1); expect(managed.agents[0].agentId).toBe(agent.agentId);
    expect((await http('/owner/setup', undefined, saved.setupToken as string)).status).toBe(401);
    await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('首次设置已提交但响应丢失时刷新，新会话精确核对原回执且不二次提交', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-owner-setup-committed-'));
  try {
    const agent = await registeredOnly(directory, 'UI Setup Committed');
    const password = 'synthetic committed setup password';
    const saved = await prepareInitialSetup(page, directory, agent, password);
    let original: Json | undefined, preSaved = false, committedStatus = 0, submitted!: () => void, posts = 0;
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/v1/owner/setup/complete' && request.method() === 'POST') posts++; });
    const intercepted = new Promise<void>((resolve) => { submitted = resolve; });
    plannedFailure(page, '/v1/owner/setup/complete', 'net::ERR_FAILED');
    await page.route('**/v1/owner/setup/complete', async (route) => {
      original = route.request().postDataJSON() as Json;
      preSaved = await persistedBeforeSend(page, original, saved.pendingOperation.scope as string, 'completeSetup');
      const response = await route.fetch(); committedStatus = response.status();
      await route.abort('failed'); submitted();
    }, { times: 1 });
    await page.getByRole('button', { name: '完成设置', exact: true }).click(); await intercepted; await idle(page);
    expect(committedStatus).toBe(200); expect(Boolean(original)).toBe(true);
    expect(preSaved, 'The committed setup key and next session were durable before sending').toBe(true);
    const pending = await pendingVault(page, directory, password);
    sameFields(original!, saved, ['sessionToken', 'recoveryToken']);
    const receiptRequest = page.waitForRequest((request) => new URL(request.url()).pathname === `/v1/operations/${original!.operationId}`);
    await page.reload();
    const url = new URL((await receiptRequest).url());
    expect(url.searchParams.get('scope')).toBe(`setup:${(saved.setupToken as string).split('.')[0]}`);
    expect(url.searchParams.get('action')).toBe('completeSetup');
    await expect(page.getByRole('heading', { name: '我的居民', exact: true })).toBeVisible();
    expect(posts, 'Committed setup recovery must not send another completion POST').toBe(1);
    const receipt = await ok(receiptPath(pending), undefined, saved.sessionToken as string);
    expect(receipt.operationId).toBe(original!.operationId);
    expect((await http('/owner/setup', undefined, saved.setupToken as string)).status).toBe(401);
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
