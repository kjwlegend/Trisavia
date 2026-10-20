import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';
import { buildApp } from '../../apps/platform/app.ts';
import { loadBackendConfig } from '../../apps/platform/configuration/backend-config.ts';
import type { M1Store, StoredRow } from '../../apps/platform/contracts/store.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { createM1Service } from '../../apps/platform/application/m1-service.ts';
import { grantId, seedWs02DemoData } from '../../apps/platform/application/perception-seed.ts';
import { authorizeWs02SeedOwnerObservation } from '../../apps/platform/application/perception-owner-observation.ts';
import { updatePerceptionDemoObject } from '../../apps/platform/application/perception-admin.ts';
import type { TrustedMailboxSource } from '../../apps/platform/application/mailbox-service.ts';
import { mailboxRepository, type MailboxReceipt } from '../../apps/platform/domains/mailbox/repository.ts';
import { walletRepository, type WalletAccount } from '../../apps/platform/domains/wallet/repository.ts';
import { refId, type ObjectRef } from '../../apps/platform/domains/perception/protocol.ts';
import { agentFixture, injectApi, ownerFixture, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { privateDirectory, privateJson } from '../e2e/helpers/private-fixtures.ts';
import { pointer } from '../e2e/helpers/ws02-owner-read-fixture.ts';
import { returnToWorld } from '../e2e/helpers/hud-ui.ts';

export async function walletMailFixture(t: TestContext, viewport = { width: 1440, height: 900 }) {
  const directory = await privateDirectory('ws02-wallet-mail-');
  const config = loadBackendConfig({ M1_EMAIL_MODE: 'experience', M1_DATABASE_PATH: join(directory, 'synthetic.sqlite'),
    M1_IDENTITY_PATH: join(directory, 'synthetic.identity.json') }, directory);
  const receivers = new Set<string>();
  // This server-owned synthetic upstream adapter authenticates a real M1 runtime
  // credential. Sender fields never come from a message body or browser input.
  const source: TrustedMailboxSource = { sourceId: 'isolated-authenticated-agent-source',
    authenticate(tx, raw, authenticateCredential) {
      const context = raw as { runtimeToken?: string };
      const credential = authenticateCredential(tx, context.runtimeToken, ['runtime']);
      return { kind: 'agent', ref: { moduleId: 'profiles', type: 'profiles.agent@1', id: String(credential.data.agentId) } };
    },
    authorizeRecipient(_tx, _actor, recipient) { return receivers.has(recipient); },
    ownerObservation() { return { existence: true, summary: true, body: true, attachments: true }; } };
  const perception = { mailboxSources: [source] }, app = buildApp({ ...config, perception }), api = injectApi(app);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const issues: string[] = [], secrets = new Set<string>(), expected = new Map<string, number>();
  const requests: { path: string; method: string; input: Json }[] = [], responses: { path: string; input: Json; status: number; body: Json }[] = [];
  const pending = new Set<Promise<void>>();
  const consume = (kind: string, path: string, code: string) => { const key = `${kind} ${path} ${code}`, count = expected.get(key) ?? 0;
    if (!count) return false; expected.set(key, count - 1); return true; };
  const allow = (kind: string, path: string, code: string, count: number) => { const key = `${kind} ${path} ${code}`; expected.set(key, (expected.get(key) ?? 0) + count); };
  const track = (...values: unknown[]) => { for (const value of values) if (typeof value === 'string' && value) {
    secrets.add(value); if (/^[\w-]{8,100}\.[\w-]{43,128}$/.test(value)) secrets.add(value.split('.')[1]!);
  } };
  t.after(async () => {
    try {
      await Promise.all(pending); assert.deepEqual(issues, [], 'No unexpected browser failures or credential disclosure');
      assert.equal(requests.some(request => /agent-read-state|reader-state/.test(request.path)), false, 'Human reads never confirm Agent messages');
      for (const request of requests.filter(request => !['GET', 'HEAD'].includes(request.method))) {
        assert(['/v1/perception/list', '/v1/perception/detail', '/v1/wallet/query'].includes(request.path), 'The browser has no message/wallet business write');
        assert.equal(request.method, 'POST'); assert.equal(request.input.purpose, 'human-inspect');
        assert.equal('selection' in request.input, false); assert.equal('metricId' in request.input, false);
        assert.equal('agentRef' in request.input, request.input.channel !== 'world');
      }
      for (const response of responses.filter(response => response.status === 200)) {
        const forbidden = (value: unknown): boolean => value !== null && typeof value === 'object'
          && Object.entries(value).some(([key, entry]) => ['agentReadState', 'completionToken'].includes(key) || forbidden(entry));
        assert.equal(forbidden(response.body), false, 'Human content and wallet results contain no Agent confirmation proof');
      }
    } finally { try { await browser?.close(); } finally { try { await app.close(); } finally { await rm(directory, { recursive: true, force: true }); } } }
  });
  const rememberOwner = async (value: Json) => { track(value.password, value.email, value.browserToken, value.sessionToken);
    await privateJson(directory, 'owner-command', { ownerId: value.ownerId, browserToken: value.browserToken, sessionToken: value.sessionToken }); };
  const owner = await ownerFixture(api, 'WalletA', rememberOwner), otherOwner = await ownerFixture(api, 'WalletB', rememberOwner);
  const rememberAgent = async (value: Json) => { track(value.runtimeToken, value.continuationToken, value.inviteToken); await privateJson(directory, 'agent-command', value); };
  const a = await agentFixture(api, owner, '钱包合成甲', 'blue', rememberAgent), sibling = await agentFixture(api, owner, '可信发件乙', 'coral', rememberAgent);
  const other = await agentFixture(api, otherOwner, '另一主人丙', 'cream', rememberAgent);
  for (const agent of [a, sibling, other]) receivers.add(agent.agentId);
  const storage = <T>(work: (store: M1Store) => T): T => { const store = openM1Store(config); try { return work(store); } finally { store.close(); } };
  const administrator = 'wallet-mail-synthetic-administrator';
  storage(store => seedWs02DemoData(store, { actorId: administrator }));
  storage(store => authorizeWs02SeedOwnerObservation(store, { actorId: administrator, operationId: randomUUID(), expectedSourceAdministrator: administrator }));
  const marker = `隔离持有物-${randomUUID().slice(0, 8)}`;
  const itemRef = storage(store => {
    const item = store.read(tx => tx.find('perception_objects').find(row => row.data.categoryId === 'items'))!;
    updatePerceptionDemoObject(store, { actorId: administrator, operationId: randomUUID(), ref: item.data.ref as ObjectRef, expectedVersion: item.version, title: marker });
    return item.data.ref as ObjectRef;
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true, ...(process.env.M1_TEST_CHROMIUM_PATH ? { executablePath: process.env.M1_TEST_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport }), page = await context.newPage();
  page.on('pageerror', () => issues.push('pageerror'));
  page.on('console', message => { if (message.type() !== 'error') return; let path = ''; try { path = new URL(message.location().url).pathname; } catch {}
    const status = message.text().match(/status of (\d+)/)?.[1]; if (status && consume('console', path, status)) return;
    if (message.text().includes('net::ERR_FAILED') && consume('console', path, 'failed')) return; issues.push(`console.error ${path}`); });
  page.on('requestfailed', request => { const path = new URL(request.url()).pathname, error = request.failure()?.errorText;
    if (error === 'net::ERR_ABORTED' || error === 'net::ERR_FAILED' && consume('network', path, 'failed')) return; issues.push(`network ${path}`); });
  page.on('request', request => { const path = new URL(request.url()).pathname;
    if ([a, sibling, other].some(agent => request.headers().authorization === `Bearer ${agent.runtimeToken}`)) issues.push('browser_runtime_credential');
    if ([...secrets].some(secret => request.url().includes(secret) || request.url().includes(encodeURIComponent(secret)))) issues.push('credential_in_url');
    if (/^\/v1\/(?:perception|wallet)/.test(path)) requests.push({ path, method: request.method(), input: request.postDataJSON() ?? {} }); });
  page.on('response', response => { const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !consume('response', path, String(response.status()))) issues.push(`HTTP ${response.status()} ${path}`);
    if (!['/v1/wallet/query', '/v1/perception/list', '/v1/perception/detail'].includes(path)) return;
    const work = (async () => { try { responses.push({ path, status: response.status(), input: response.request().postDataJSON() ?? {}, body: await response.json() as Json }); } catch { /* Cancelled real reads can have no body. */ } })();
    pending.add(work); void work.finally(() => pending.delete(work)); });
  async function login(who = owner) {
    await pointer(page, page.locator('#hud-account')); await expect(page.locator('#login-identifier')).toBeVisible();
    await page.locator('#login-identifier').fill(who.username); await page.locator('#login-password').fill(who.password);
    await expect(page.locator('#hud-window')).toHaveAttribute('data-panel-state', 'open');
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/owner/sessions' && response.request().method() === 'POST');
    await pointer(page, page.locator('#login-submit')); assert.equal((await submitted).status(), 200);
    await expect(page.locator('#manage-view')).toBeVisible(); await expect(page.locator('#account-root')).toHaveAttribute('aria-busy', 'false');
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connet.owner.v2') || '{}')) as Json;
    assert.equal(saved.ownerId, who.ownerId); track(saved.sessionToken, saved.recoveryToken);
  }
  async function select(agent = a) { await pointer(page, page.locator('#hud-agent')); await pointer(page, page.locator(`#agent-list [data-agent-id="${agent.agentId}"]`));
    await expect(page.locator('#account-root')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#hud-agent-select')).toContainText(agent.name); await returnToWorld(page); }
  async function logout() { if (!(await page.locator('#manage-view').isVisible())) await pointer(page, page.locator('#hud-account'));
    await page.locator('[data-manager-page="security"]').click(); await pointer(page, page.locator('#logout'));
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('connet.owner.v2') === null)).toBe(true); }
  const records = async (channel: string, categoryId: string, agent = a) => {
    const result = await api('POST', '/perception/list', { protocolVersion: 1, consumerId: 'wallet-mail-fixture-reference', purpose: 'human-inspect',
      channel, categoryId, limit: 50, ...(channel === 'world' ? {} : { agentRef: { moduleId: 'profiles', type: 'profiles.agent@1', id: agent.agentId } }) }, owner.sessionToken);
    assert.equal(result.status, 200); assert.equal(result.body.data.complete, true); return result.body.data.records as Json[];
  };
  return { page, context, origin, owner, otherOwner, a, sibling, other, marker, itemRef, api, storage, requests, responses, login, select, logout, records,
    addHoldings(count: number, agent = a) { assert(Number.isSafeInteger(count) && count > 0 && count <= 30);
      // No public mint API exists. These extra authoritative, explicitly
      // synthetic records exercise normal HTTP pagination, not fake responses.
      storage(store => store.transaction(tx => {
        const original = tx.find('perception_objects').find(row => row.data.categoryId === 'items')!; assert(original);
        for (let index = 0; index < count; index++) {
          const ref = { moduleId: 'items', type: 'items.item@1', id: `isolated-pagination-${randomUUID()}` }, objectId = refId(ref);
          tx.insert('perception_objects', { id: objectId, version: 1, data: { ...original.data, ref, refId: ref.id,
            title: `隔离分页持有物 ${index + 1}`, body: '仅用于隔离浏览器分页验证的明确合成内容。', itemKind: 'prop' } });
          tx.insert('perception_grants', { id: grantId(agent.agentId, objectId, 'holding'), version: 1,
            data: { agentId: agent.agentId, objectId, kind: 'holding', active: true, quantity: 1, dataMode: 'demo',
              createdAt: Date.now(), sourceId: 'holdings' } });
        }
      }));
    },
    deliver(title: string, body: string, recipient = a) { return storage(store => createM1Service(store, { perception }).receiveTrustedMessage(source.sourceId,
      { sourceMessageKey: randomUUID(), recipientAgentId: recipient.agentId, title, body }, { runtimeToken: sibling.runtimeToken })) as Json; },
    readStates() { return storage(store => store.read(tx => ({ notifications: tx.find('perception_states'),
      messages: tx.find<MailboxReceipt>('mailbox_receipts').map(row => ({ id: row.id, confirmed: row.data.confirmedContentVersion, stateVersion: row.data.stateVersion, confirmedAt: row.data.confirmedAt })) }))); },
    setBalance(agent: Json, balance: number) { assert(Number.isSafeInteger(balance) && balance >= 0); return storage(store => store.transaction(tx => {
      const row = walletRepository(tx).get(agent.agentId)!; assert(row); tx.update('wallet_accounts', { ...row, version: row.version + 1, data: { ...row.data, balance } }, row.version);
    })); },
    removeWallet(agent = a) { return storage(store => store.transaction(tx => { const row = walletRepository(tx).get(agent.agentId)!; assert(row); tx.remove('wallet_accounts', row.id, row.version); return row; })); },
    restoreWallet(row: StoredRow<WalletAccount>) { storage(store => store.transaction(tx => tx.insert('wallet_accounts', row))); },
    revokeMessage(ref: ObjectRef, recipient = a) { storage(store => store.transaction(tx => { const row = mailboxRepository(tx).receipt(ref.id, recipient.agentId)!; assert(row);
      tx.update('mailbox_receipts', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version); })); },
    revokeItem(ref: ObjectRef) { storage(store => store.transaction(tx => { const row = tx.get('perception_objects', refId(ref))!; assert(row);
      tx.update('perception_objects', { ...row, version: row.version + 1, data: { ...row.data, public: false } }, row.version); })); },
    allowStatus(path: string, status: number, count = 1) { allow('response', path, String(status), count); allow('console', path, String(status), count); },
    allowAbort(path: string) { allow('network', path, 'failed', 1); allow('console', path, 'failed', 1); } };
}
