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
const observed = new WeakMap<Page, { errors: string[]; secrets: Set<string>; leakedUrl: boolean }>();

test.beforeEach(async ({ page }) => {
  const state = { errors: [] as string[], secrets: new Set<string>(), leakedUrl: false };
  observed.set(page, state);
  page.on('pageerror', () => state.errors.push('pageerror'));
  page.on('console', (message) => { if (message.type() === 'error') state.errors.push('console.error'); });
  page.on('request', (request) => {
    for (const secret of state.secrets) if (request.url().includes(secret)) state.leakedUrl = true;
  });
});
test.afterEach(async ({ page }) => {
  const state = observed.get(page)!;
  expect(state.errors, 'Browser must have no pageerror or console.error').toEqual([]);
  expect(state.leakedUrl, 'No private material may enter an HTTP request URL').toBe(false);
});

function track(page: Page, ...values: string[]) {
  for (const value of values) {
    observed.get(page)!.secrets.add(value);
    if (value.includes('.')) observed.get(page)!.secrets.add(value.slice(value.indexOf('.') + 1));
  }
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
    await expect(page.locator('#stage-initialized')).not.toHaveText('尚无记录');
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

test('主人邀请第二位居民；读取期间锁住切换，回包后草稿和目标仍对应', async ({ page }) => {
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
