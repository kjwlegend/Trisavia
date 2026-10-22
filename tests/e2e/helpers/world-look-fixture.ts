import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { buildApp } from '../../../apps/platform/app.ts';
import { bootstrapPlatformCatalog } from '../../../apps/platform/application/bootstrap.ts';
import { bootstrapWorld } from '../../../apps/platform/application/world-service.ts';
import { bootstrapInteraction } from '../../../apps/platform/application/interaction-service.ts';
import { seedWs02DemoData } from '../../../apps/platform/application/perception-seed.ts';
import { authorizeWs02SeedOwnerObservation } from '../../../apps/platform/application/perception-owner-observation.ts';
import { updatePerceptionDemoObject } from '../../../apps/platform/application/perception-admin.ts';
import { openPostgresStore, setPostgresWriteGate } from '../../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { openPostgresRuntimeStore } from '../../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { loadEmailConfig } from '../../../apps/platform/infrastructure/email/resend.ts';
import { createWorldDatabase, dropWorldTestDatabase } from '../../../scripts/world-core-database.ts';
import { prepareWorldCoreDatabase } from '../../../scripts/world-core-prepare.ts';
import { privateFile, readRuntime, requirePrivateFile } from '../../../scripts/postgresql/runtime.ts';
import { credential, ownerFixture, registrationCommand, type Api, type Json } from '../../../scripts/agent-manager-qa-fixture.ts';

export const appearanceVersion = '2026-10-21.appearance-v1.1';
export const lookIds = ['shorthair', 'longhair', 'curlyhair', 'bowlhair', 'mophair', 'spikeyhair'].map(hair => 'sunnyside-human-' + hair);
export const lookPair = (lookId = lookIds[0]!) => ({ lookId, catalogVersion: appearanceVersion });
export type LookAgent = { agentId: string; name: string; runtimeToken: string; continuationToken: string; avatarId: string };
export type LookOwner = { owner: Json; agents: LookAgent[] };
const pageEvidenceDirectories = new WeakMap<Page, string>();

/** Observe clipping separately from DOM visibility; no focus, scroll or input is synthesized here. */
export async function lookNavigationObservation(control: Locator) {
  return control.evaluate(node => {
    const box = node.getBoundingClientRect(), sidebar = node.closest('.manager-sidebar'), frame = sidebar?.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { control: node.id || node.getAttribute('data-manager-page'), box: box.toJSON(),
      focused: document.activeElement === node, inertAncestor: node.closest('[inert]')?.id ?? null,
      hitInside: Boolean(hit && (node === hit || node.contains(hit))), hit: hit ? { id: hit.id, className: hit.getAttribute('class') } : null,
      sidebar: sidebar ? { box: frame!.toJSON(), scrollTop: sidebar.scrollTop, scrollHeight: sidebar.scrollHeight, clientHeight: sidebar.clientHeight,
        controlInside: box.top >= frame!.top && box.bottom <= frame!.bottom } : null };
  });
}

/** Reach a real control with the window's native Tab path; do not call focus() or scrollIntoView(). */
export async function lookTabTo(page: Page, control: Locator) {
  await expect(control).toBeVisible(); await expect(control).toBeEnabled();
  await expect(page.locator('#hud-window')).toHaveAttribute('data-panel-state', 'open');
  for (let turn = 0; turn < 48; turn++) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active && !active.closest('[inert]') && active.closest('#hud-window,#hud-dock'));
    }), 'Native Tab stays within the active window and its available HUD controls');
    if (await control.evaluate(node => document.activeElement === node)) {
      const observed = await lookNavigationObservation(control);
      assert(observed.hitInside && observed.sidebar?.controlInside, 'The keyboard target is actually visible within its scroll clip');
      return observed;
    }
  }
  assert.fail('The native Tab order did not reach the requested management control');
}

/** Native input only. Visibility failures remain failures; this helper never scrolls or dispatches a click. */
export async function lookPointer(page: Page, control: Locator) {
  await expect(control).toBeVisible(); await expect(control).toBeEnabled();
  const panel = await control.evaluate(node => node.closest('.hud-window')?.id ?? '');
  if (panel) await expect(page.locator('#' + panel)).toHaveAttribute('data-panel-state', 'open');
  // Match native actionability: wait for the real layout to stop moving, and verify the actual hit target.
  try {
    await expect.poll(() => control.evaluate(node => new Promise<boolean>(resolve => {
      const before = node.getBoundingClientRect();
      requestAnimationFrame(() => {
        const after = node.getBoundingClientRect(), target = document.elementFromPoint(after.x + after.width / 2, after.y + after.height / 2);
        resolve((['x', 'y', 'width', 'height'] as const).every(key => before[key] === after[key])
          && !node.closest('[inert]') && Boolean(target && (node === target || node.contains(target))));
      });
    }))).toBe(true);
  } catch (error) {
    const observation = await control.evaluate(node => {
      const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2), panel = node.closest('.hud-window');
      return { control: node.id || node.getAttribute('data-manager-page'), box: box.toJSON(), pointerEvents: getComputedStyle(node).pointerEvents,
        inertAncestor: node.closest('[inert]')?.id ?? null, hit: hit ? { id: hit.id, tag: hit.tagName, className: hit.getAttribute('class') } : null,
        panel: { id: panel?.id, state: panel?.getAttribute('data-panel-state'), box: panel?.getBoundingClientRect().toJSON() },
        viewport: { width: innerWidth, height: innerHeight }, page: document.querySelector('#manage-view')?.getAttribute('data-manager-page') };
    });
    const directory = pageEvidenceDirectories.get(page);
    if (directory && observation.control === 'security' && observation.page === 'overview') {
      await privateFile(join(directory, 'pointer-security-failure.json'), JSON.stringify(observation, null, 2) + '\n');
      const frame = await page.locator('#hud-window').boundingBox();
      if (frame) {
        // Only the synthetic, authenticated manager pane; no header identity, login fields or credentials.
        const path = join(directory, 'pointer-security-failure.png'); await page.screenshot({ path, clip: frame }); await chmod(path, 0o600);
      }
    }
    throw new Error('Native pointer target is not actionable: ' + JSON.stringify(observation), { cause: error });
  }
  const box = await control.boundingBox(), viewport = page.viewportSize();
  assert(box && viewport && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0
    && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
  'A real pointer action requires a fully visible control');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Fresh C-owned PG, real HTTP, real clock and experience email; no shared server or existing identity. */
export async function worldLookFixture(t: TestContext, viewport = { width: 1440, height: 900 }, input: { createSecondAvatar?: boolean; content?: boolean } = {}) {
  const runtimeFile = process.env.WORLD_CORE_TEST_RUNTIME;
  if (!runtimeFile) throw new Error('WORLD_CORE_TEST_RUNTIME must identify the explicit private local test runtime');
  const config = await readRuntime(runtimeFile);
  const outputRoot = fileURLToPath(new URL('../../../outputs/world-look-selection/', import.meta.url));
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(outputRoot, 'case-'));
  const identity = { instanceId: 'instance_' + randomUUID(), recoveryEpoch: 'epoch_' + randomUUID() };
  const database = 'world_core_c_look_' + randomBytes(10).toString('hex');
  let connections: string | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, origin = '', port = 0;
  let legacy: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  let runtime: Awaited<ReturnType<typeof openPostgresRuntimeStore>> | undefined;
  const owners: LookOwner[] = [], issues: string[] = [], secrets = new Set<string>();
  const expected = new Map<string, number>();
  const requests: { method: string; path: string; operationId?: string; body?: Json }[] = [];
  const cleanup = { database, creator: 'c', browserClosed: false, appClosed: false, poolsClosed: false, databaseDropped: false };
  function track(...values: unknown[]) { for (const value of values) if (typeof value === 'string' && value) secrets.add(value); }
  async function evidence(name: string, value: unknown) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid evidence name');
    await privateFile(join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  }
  // Install cleanup before any resource creation. Failed evidence and private fixture materials are retained.
  t.after(async () => {
    const failures: unknown[] = [];
    const close = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { failures.push(error); } };
    try {
      await close(async () => { await browser?.close(); cleanup.browserClosed = true; });
      await close(async () => { await app?.close(); app = undefined; cleanup.appClosed = true; });
      await close(async () => { await runtime?.close(); await legacy?.close(); cleanup.poolsClosed = true; });
      const ownedConnections = connections;
      if (ownedConnections && cleanup.appClosed && cleanup.poolsClosed) await close(async () => { await dropWorldTestDatabase(config, ownedConnections, 'c'); cleanup.databaseDropped = true; });
    } finally {
      await evidence('cleanup', cleanup);
      await evidence('network', { requests, issues });
    }
    assert.equal(failures.length, 0, 'All independently owned resources close; failures preserve the manifest for diagnosis');
    assert.deepEqual(issues, [], 'No unexpected browser failure, external request, runtime credential or reader-state write');
  });
  connections = (await createWorldDatabase(config, database, join(directory, 'connections'), 'c')).privateConnections;
  await prepareWorldCoreDatabase(config, connections, identity);
  const maintenance = { ...identity, connectionString: (await requirePrivateFile(join(connections, 'migration-database-url'))).trim() };
  const options = { ...identity, connectionString: (await requirePrivateFile(join(connections, 'application-database-url'))).trim() };
  await setPostgresWriteGate(maintenance, { enabled: true });
  legacy = await openPostgresStore(options); runtime = await openPostgresRuntimeStore(options);
  await bootstrapPlatformCatalog(legacy);
  await runtime.transaction(async ctx => {
    await bootstrapWorld(ctx); await bootstrapInteraction(ctx);
    if (await ctx.tasks.currentGeneration('decision') === 0) await ctx.tasks.advanceGeneration('decision', 0);
  });
  const email = loadEmailConfig({ M1_EMAIL_MODE: 'experience' }); assert(email);
  const appOptions = { ...options, email, worldCoreEnabled: true, worldCoreInteractionEnabled: true };
  async function start() {
    app = await buildApp(appOptions);
    origin = await app.listen({ host: '127.0.0.1', port });
    port = Number(new URL(origin).port);
    assert(![8789, 8799, 8801, 8787, 8846, 18892, 18893].includes(port), 'Only an independently allocated ephemeral loopback port is used');
  }
  await start();
  const api: Api = async (method, path, body, token) => {
    const response = await fetch(origin + '/v1' + path, { method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as Json };
  };
  async function ok(method: Parameters<Api>[0], path: string, body?: Json, token?: string) {
    const response = await api(method, path, body, token);
    assert.equal(response.status, 200, `${method} ${path}: ${response.body.error?.code ?? 'unexpected_status'}`);
    return response.body;
  }
  const profile = (agent: LookAgent, owner: Json) => ok('GET', '/agents/' + agent.agentId + '/profile', undefined, owner.sessionToken);
  const publicProfile = (agent: LookAgent) => ok('GET', '/public/agents/' + agent.agentId);
  async function save(agent: LookAgent, owner: Json, fields: Json) {
    const before = await profile(agent, owner), input = { operationId: randomUUID(), expectedVersion: before.version, expectedPolicyVersion: before.policyVersion, fields };
    return { input, result: await ok('PUT', '/agents/' + agent.agentId + '/profile', input, owner.sessionToken) };
  }
  async function scene() {
    const response = await fetch(origin + '/v1/world/scene?worldId=default');
    assert.equal(response.status, 200); return (await response.json() as Json).data as Json;
  }
  for (const label of ['A', 'B']) {
    const owner = await ownerFixture(api, 'Look' + label, async owner => track(owner.email, owner.password, owner.browserToken, owner.sessionToken));
    const agents: LookAgent[] = [];
    for (let index = 0; index < (label === 'A' ? 2 : 1); index++) {
      const inviteToken = credential(), command = registrationCommand(inviteToken);
      track(inviteToken, command.runtimeToken, command.continuationToken);
      await ok('POST', '/owner/agent-invites', { operationId: randomUUID(), inviteToken }, owner.sessionToken);
      const registration = await ok('POST', '/registrations', command);
      assert.equal(registration.ownerId, owner.ownerId);
      const agent: LookAgent = { agentId: registration.agentId, name: `隔离人物${label}${index + 1}-${randomBytes(3).toString('hex')}`,
        runtimeToken: command.runtimeToken, continuationToken: command.continuationToken, avatarId: '' };
      const initial = await publicProfile(agent);
      assert.deepEqual(initial.profile.avatar, lookPair(), 'New registration uses the approved real short-hair identity');
      await save(agent, owner, { displayName: agent.name });
      if (!(label === 'A' && index === 1 && input.createSecondAvatar === false)) {
        const created = await ok('POST', '/gateway/commands', { protocolVersion: 1, consumerId: 'world-look-author', purpose: 'agent-manual',
          operation: 'world.avatar.create', commandId: randomUUID(), input: { worldId: 'default', expectedRulesetVersion: 1 } }, agent.runtimeToken);
        assert.equal(created.data.outcome, 'committed'); agent.avatarId = created.data.result.avatarId;
      }
      agents.push(agent);
    }
    owners.push({ owner, agents });
  }
  let content: { holdingId: string; itemTitle: string; itemEnd: string; notificationId: string; notificationTitle: string; notificationEnd: string } | undefined;
  if (input.content) {
    const actorId = 'world-look-c-isolated-content', marker = randomBytes(5).toString('hex');
    await seedWs02DemoData(legacy, { actorId });
    await authorizeWs02SeedOwnerObservation(legacy, { actorId, operationId: randomUUID(), expectedSourceAdministrator: actorId });
    const owner = owners[0]!, agent = owner.agents[0]!;
    const base = { protocolVersion: 1, consumerId: 'world-look-c-content-preparation', purpose: 'human-inspect', channel: 'inventory',
      agentRef: { moduleId: 'profiles', type: 'profiles.agent@1', id: agent.agentId } };
    const listed = await ok('POST', '/perception/list', { ...base, categoryId: 'holdings', limit: 50 }, owner.owner.sessionToken);
    const holding = listed.data.records[0]; assert(holding, 'The explicitly seeded isolated source provides a real holding');
    const detail = await ok('POST', '/perception/detail', { ...base, ref: holding.ref }, owner.owner.sessionToken);
    const itemRef = detail.data.content.itemRef; assert(itemRef);
    const source = await legacy.read(async tx => (await tx.find('perception_objects')).find(row => JSON.stringify(row.data.ref) === JSON.stringify(itemRef)));
    assert(source, 'The held item resolves to a real source object in this isolated database');
    content = { holdingId: holding.ref.id, itemTitle: 'C隔离真实物品-' + marker, itemEnd: '〔C隔离物品末尾-' + marker + '〕',
      notificationId: 'test-message-09', notificationTitle: ('C隔离长标题-' + marker + '，').repeat(8), notificationEnd: '〔C隔离通知末尾-' + marker + '〕' };
    const text = '这是C自有隔离库中的长正文，仅验证真实HTTP读取与内部滚动，不属于当前用户运行数据。'.repeat(50);
    await updatePerceptionDemoObject(legacy, { actorId, operationId: randomUUID(), expectedVersion: source.version, ref: itemRef,
      title: content.itemTitle, body: text + content.itemEnd });
    await updatePerceptionDemoObject(legacy, { actorId, operationId: randomUUID(), expectedVersion: 1,
      ref: { moduleId: 'mailbox', type: 'mailbox.message@1', id: content.notificationId }, title: content.notificationTitle, body: text + content.notificationEnd });
    await evidence('synthetic-content', { actorId, ...content, instanceId: identity.instanceId, database, source: 'explicit process seed and audited demo update in C-owned database only' });
  }
  await evidence('fixture-private', { purpose: 'fresh-isolated-look-author-tests', database, identity, owners });
  browser = await chromium.launch({ headless: true, ...(process.env.M1_TEST_CHROMIUM_PATH ? { executablePath: process.env.M1_TEST_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
  // Observe the native drawing boundary without changing pixels, invoking handlers, or supplying success data.
  const imageSources: Record<string, string> = {};
  for (const hair of ['base', 'shorthair', 'longhair', 'curlyhair', 'bowlhair', 'mophair', 'spikeyhair']) for (const action of ['idle', 'walk']) {
    const path = 'assets/human-' + hair + '-' + action + '.png';
    imageSources[createHash('sha256').update(await readFile(new URL('../../../apps/web/public/world-pixel/' + path, import.meta.url))).digest('hex')] = '/assets/world-pixel/' + path;
  }
  await context.addInitScript(imageSources => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    const log: { canvas: string; src: string; at: number }[] = [];
    const bitmapSources = new WeakMap<ImageBitmap, string>(), decode = window.createImageBitmap.bind(window);
    // Native decoded bitmaps have no URL. Identify their actual unchanged bytes, then retain the same native bitmap.
    window.createImageBitmap = (async (source: ImageBitmapSource, ...args: unknown[]) => {
      const bitmap = await (decode as (...args: unknown[]) => Promise<ImageBitmap>)(source, ...args);
      if (source instanceof Blob) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await source.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (imageSources[hash]) bitmapSources.set(bitmap, imageSources[hash]);
      }
      return bitmap;
    }) as typeof window.createImageBitmap;
    Object.defineProperty(window, '__lookDrawObservations', { value: log });
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, image: CanvasImageSource, ...coordinates: number[]) {
      const source = image instanceof HTMLImageElement ? new URL(image.currentSrc || image.src).pathname : image instanceof ImageBitmap ? bitmapSources.get(image) : undefined;
      if (source && /\/human-[^/]+\.png$/.test(source)) {
        log.push({ canvas: this.canvas.id, src: source, at: performance.now() });
        if (log.length > 1000) log.splice(0, log.length - 1000);
      }
      Reflect.apply(original, this, [image, ...coordinates]);
    };
  }, imageSources);
  const allow = (path: string, marker: string, count = 1) => expected.set(path + ' ' + marker, (expected.get(path + ' ' + marker) ?? 0) + count);
  function consume(path: string, marker: string) {
    const key = path + ' ' + marker, count = expected.get(key) ?? 0;
    if (!count) return false; expected.set(key, count - 1); return true;
  }
  context.on('page', page => {
    page.on('pageerror', error => issues.push('pageerror:' + error.name));
    page.on('response', response => { const path = new URL(response.url()).pathname; if (response.status() >= 400 && !consume(path, 'HTTP' + response.status())) issues.push('HTTP' + response.status() + ' ' + path); });
    page.on('requestfailed', request => { const path = new URL(request.url()).pathname; if (request.failure()?.errorText !== 'net::ERR_ABORTED' && !consume(path, 'failed')) issues.push('request_failed ' + path); });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) issues.push('external_request');
      if ([...secrets].some(secret => request.url().includes(secret) || request.url().includes(encodeURIComponent(secret)))) issues.push('private_material_in_url');
      if (owners.some(owner => owner.agents.some(agent => request.headers().authorization === 'Bearer ' + agent.runtimeToken))) issues.push('runtime_in_browser');
      if (/agent-read-state|reader-state/.test(url.pathname) && !['GET', 'HEAD'].includes(request.method())) issues.push('human_progress_write');
      if (!url.pathname.startsWith('/v1/')) return;
      const input = request.method() === 'PUT' && /\/agents\/[^/]+\/profile$/.test(url.pathname) ? request.postDataJSON() as Json : undefined;
      requests.push({ method: request.method(), path: url.pathname, ...(input ? { operationId: input.operationId, body: input } : {}) });
    });
  });
  // A network guard rejects external traffic, but never manufactures a successful platform response.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.fallback() : route.abort();
  });
  const page = await context.newPage();
  pageEvidenceDirectories.set(page, directory);
  async function login(owner: Json, input: { navigate?: boolean } = {}) {
    if (input.navigate !== false) await page.goto(origin + '/#account');
    else if (!(await page.locator('#login-identifier').isVisible())) await lookPointer(page, page.locator('#hud-open-profile'));
    await expect(page.locator('#login-identifier')).toBeVisible();
    await page.locator('#login-identifier').fill(owner.username); await page.locator('#login-password').fill(owner.password);
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/owner/sessions' && response.request().method() === 'POST');
    await lookPointer(page, page.locator('#login-submit')); assert.equal((await submitted).status(), 200);
    await expect(page.locator('#manage-view')).toBeVisible(); await expect(page.locator('#account-root')).toHaveAttribute('aria-busy', 'false');
  }
  async function selectAgent(agent: LookAgent) {
    if ((await page.locator('#selected-id').textContent())?.includes(agent.agentId)) return;
    const select = page.locator('#agent-select');
    if (await select.isVisible()) await select.selectOption(agent.agentId);
    else {
      const row = page.locator('#agent-list [data-agent-id="' + agent.agentId + '"]');
      if (!(await row.isVisible())) {
        const switcher = page.locator('#manager-agent-switch');
        await lookPointer(page, await switcher.isVisible() ? switcher : page.locator('#manager-object').getByRole('button', { name: '切换 Agent', exact: true }));
      }
      await lookPointer(page, row);
    }
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
  }
  async function appearancePage(agent?: LookAgent) {
    if (agent) await selectAgent(agent);
    await navigate('appearance');
    await expect(page.locator('#save-appearance')).toBeVisible();
  }
  async function navigate(key: 'profile' | 'appearance') {
    const characterTab = page.locator('[data-character-tab="' + key + '"]');
    await lookPointer(page, await characterTab.isVisible() ? characterTab : page.locator('[data-manager-page="' + key + '"]'));
  }
  async function logout() {
    const security = page.locator('button[data-manager-page="security"]');
    if (!(await security.isVisible())) {
      const manage = page.locator('#manager-object').getByRole('button', { name: '管理', exact: true });
      // The native character dialog keeps the page header outside its active interaction scope.
      if (await manage.isVisible()) await lookPointer(page, manage);
      else await lookPointer(page, page.locator('#hud-account'));
    }
    if (!(await page.locator('#logout').isVisible())) await lookPointer(page, security);
    await lookPointer(page, page.locator('#logout'));
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('connet.owner.v2') === null)).toBe(true);
    await expect(page.locator('#hud-window')).toBeHidden();
  }
  const a = owners[0]!, b = owners[1]!;
  return { page, context, directory, identity, database, content, a, b, api, ok, profile, publicProfile, save, scene, requests, evidence, login, logout, selectAgent, appearancePage, navigate,
    get origin() { return origin; }, get store() { assert(legacy); return legacy; }, get runtime() { assert(runtime); return runtime; },
    allowStatus(path: string, status: number, count = 1) { allow(path, 'HTTP' + status, count); },
    allowAbort(path: string, count = 1) { allow(path, 'failed', count); },
    async restart() { await app!.close(); app = undefined; await start(); },
  };
}
