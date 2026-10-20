import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { M1Store } from '../../../apps/platform/contracts/store.ts';
import { seedWs02DemoData } from '../../../apps/platform/application/perception-seed.ts';
import { updatePerceptionDemoObject } from '../../../apps/platform/application/perception-admin.ts';
import { authorizeWs02SeedOwnerObservation, OWNER_OBSERVATION_ID } from '../../../apps/platform/application/perception-owner-observation.ts';
import { ownerFixture, type Json } from '../../../scripts/agent-manager-qa-fixture.ts';
import { ws02Fixture } from './ws02-hud-fixture.ts';

export type Ref = { moduleId: string; type: string; id: string };
export const refKey = (ref: Ref) => JSON.stringify([ref.moduleId, ref.type, ref.id]);
export const agentRef = (id: string) => ({ moduleId: 'profiles', type: 'profiles.agent@1', id });

// Reuse the established port-0/browser lifecycle and privacy guard. All three
// owners and their Agents are newly registered through the ordinary APIs.
export async function ownerReadFixture(t: TestContext, viewport = { width: 1440, height: 900 }) {
  const f = await ws02Fixture(t, { accounts: true, viewport });
  const config = f.config;
  const storage = <T>(work: (store: M1Store) => Promise<T>): Promise<T> => work(f.store);
  const administrator = 'owner-read-synthetic-administrator';
  const manifest = await storage(store => seedWs02DemoData(store, { actorId: administrator })) as Json;
  await storage(store => authorizeWs02SeedOwnerObservation(store, {
    actorId: administrator, operationId: randomUUID(), expectedSourceAdministrator: administrator,
  }));
  const empty = await ownerFixture(f.api, 'ReadEmpty', async value => {
    f.track(value.email, value.password, value.browserToken, value.sessionToken);
  });
  const a = f.owners[0]!, b = f.owners[1]!;
  const label = randomUUID().slice(0, 8);
  const markers = { items: `隔离数据库物品-${label}`, notifications: `隔离数据库通知-${label}`,
    announcements: `隔离数据库公告-${label}`, events: `隔离数据库计划-${label}` };
  for (const category of ['items', 'announcements', 'events'] as const) await storage(async store => {
    const row = await store.read(async tx => (await tx.find('perception_objects')).find(row => row.data.categoryId === category
      && (category !== 'events' || row.data.type === 'world.plan@1' || (row.data.ref as Json)?.type === 'world.plan@1')));
    assert(row, `The seeded ${category} source has a real demonstration object to update`);
    return updatePerceptionDemoObject(store, { actorId: administrator, operationId: randomUUID(), expectedVersion: row.version,
      ref: row.data.ref as Ref, title: markers[category] });
  });
  const longMessage = '这是由隔离管理员明确更新的长通知正文，用于核对真实分段读取，网页查看不代表 Agent 已确认。'.repeat(30);
  await storage(store => updatePerceptionDemoObject(store, { actorId: administrator, operationId: randomUUID(), expectedVersion: 1,
    ref: { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-09' }, title: markers.notifications, body: longMessage }));
  const requests: { method: string; path: string; input: Json }[] = [];
  const responses: { path: string; input: Json; status: number; body: Json }[] = [];
  const inflight = new Set<Promise<void>>();
  let runtimeLeaks = 0, exampleLoads = 0;
  f.page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/assets/hud/demo-fixtures.json') exampleLoads++;
    const authorization = request.headers().authorization;
    if (f.owners.some(owner => owner.agents.some(agent => authorization === `Bearer ${agent.runtimeToken}`))) runtimeLeaks++;
    if (!path.startsWith('/v1/perception')) return;
    requests.push({ method: request.method(), path, input: request.postDataJSON() ?? {} });
  });
  f.page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/v1/perception')) return;
    const work = (async () => {
      try { responses.push({ path, input: response.request().postDataJSON() ?? {}, status: response.status(), body: await response.json() as Json }); }
      catch { /* Deliberately aborted responses have no readable body. */ }
    })();
    inflight.add(work); void work.finally(() => inflight.delete(work));
  });
  t.after(async () => {
    await Promise.all(inflight);
    assert.equal(runtimeLeaks, 0, 'No Agent runtime credential is used by the browser');
    assert.equal(requests.some(request => /agent-read-state|reader-state/.test(request.path)), false,
      'Human browsing never queries/confirms Agent progress or writes human reader state');
    for (const request of requests.filter(request => ['/v1/perception/list', '/v1/perception/detail'].includes(request.path))) {
      assert.equal(request.method, 'POST'); assert.equal(request.input.purpose, 'human-inspect');
      assert.equal('selection' in request.input, false); assert.equal('metricId' in request.input, false);
      assert.equal('agentRef' in request.input, request.input.channel !== 'world');
    }
    for (const response of responses.filter(response => response.status === 200 && ['/v1/perception/list', '/v1/perception/detail'].includes(response.path))) {
      const forbidden = (value: unknown): boolean => value !== null && typeof value === 'object'
        && Object.entries(value).some(([key, entry]) => ['agentReadState', 'completionToken'].includes(key) || forbidden(entry));
      assert.equal(forbidden(response.body), false, 'Owner results do not expose Agent confirmation state or proof');
    }
  });
  async function records(channel: 'world' | 'inventory' | 'inbox', categoryId: string, owner = a.owner, selected = a.agents[0]!) {
    const rows: Json[] = []; let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await f.api('POST', '/perception/list', { protocolVersion: 1, consumerId: 'owner-read-fixture-reference',
        purpose: 'human-inspect', channel, categoryId, limit: 50,
        ...(channel !== 'world' ? { agentRef: agentRef(selected.agentId) } : {}), ...(pageToken ? { pageToken } : {}) }, owner.sessionToken);
      assert.equal(result.status, 200, 'Synthetic reference reads use the normal owner HTTP authorization');
      rows.push(...result.body.data.records);
      if (result.body.data.complete) return rows;
      pageToken = result.body.data.nextPageToken;
    }
    assert.fail('A bounded reference collection must terminate');
  }
  const states = () => storage(store => store.read(tx => tx.find('perception_states')));
  const source = (id: string, state: 'enabled' | 'unavailable' | 'not_enabled') => storage(store => store.transaction(async tx => {
    const current = (await tx.get('perception_catalog', 'current'))!;
    await tx.update('perception_catalog', { ...current, version: current.version + 1,
      data: { ...current.data, sourceStates: { ...(current.data.sourceStates as Json), [id]: state } } }, current.version);
  }));
  const observer = (active: boolean) => storage(store => store.transaction(async tx => {
    const row = (await tx.get('perception_catalog', OWNER_OBSERVATION_ID))!;
    await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, active } }, row.version);
  }));
  return { ...f, config, storage, a, b, empty, manifest, markers, longMessage, requests, responses, records, states, source, observer,
    get exampleLoads() { return exampleLoads; } };
}

export async function pointer(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  const bounds = await control.boundingBox(), size = page.viewportSize()!;
  assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height,
    'The control is actually visible before a native pointer action');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

export async function wheelToControl(page: Page, region: Locator, control: Locator) {
  for (let turn = 0; turn < 20; turn++) {
    const frame = await region.boundingBox(), target = await control.boundingBox(); assert(frame && target);
    if (target.y >= frame.y && target.y + target.height <= frame.y + frame.height) return;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    const before = await region.evaluate(node => node.scrollTop);
    await page.mouse.wheel(0, target.y < frame.y ? -400 : 400);
    await expect.poll(() => region.evaluate(node => node.scrollTop)).not.toBe(before);
  }
  assert.fail('The intended action must be reachable in its own native scroll region');
}
