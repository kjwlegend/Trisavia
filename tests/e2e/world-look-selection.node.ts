import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { expect, type Page } from '@playwright/test';
import { appearanceVersion, lookIds, lookNavigationObservation, lookPair, lookPointer, lookTabTo, worldLookFixture, type LookAgent } from './helpers/world-look-fixture.ts';

const names = ['短发', '长发', '卷发', '齐刘海', '蓬松发', '尖发'];
const profilePath = (agent: LookAgent) => '/v1/agents/' + agent.agentId + '/profile';

async function choose(page: Page, index: number) {
  await lookPointer(page, page.getByRole('button', { name: names[index]!, exact: true }));
  await expect(page.getByRole('button', { name: names[index]!, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#appearance-form canvas[data-look-stage]')).toHaveAttribute('data-look-id', lookIds[index]!);
}
async function commitAppearance(page: Page, agent: LookAgent) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === profilePath(agent) && response.request().method() === 'PUT');
  await lookPointer(page, page.locator('#save-appearance'));
  const actual = await response; assert.equal(actual.status(), 200);
  return { input: actual.request().postDataJSON(), result: await actual.json() };
}
async function renderedFacts(page: Page) {
  return page.evaluate(async () => {
    const path = '/assets/home.js'; const home = await import(path);
    return (home.getWorldState().worldScene?.avatars ?? []).map((entry: { fact: { id: string; agentId: string; version: number; position: unknown; profile: unknown } }) => entry.fact);
  });
}
async function worldHairDrawn(page: Page, hair: string) {
  return page.evaluate(hair => {
    const log = (window as unknown as { __lookDrawObservations: { canvas: string; src: string }[] }).__lookDrawObservations;
    return log.some(row => row.canvas === 'world-canvas' && row.src.endsWith('/human-' + hair + '-idle.png'));
  }, hair);
}

test('real choice, exact receipt and app reconnect preserve one published identity across portraits and the unchanged World Avatar', { timeout: 180_000 }, async t => {
  const f = await worldLookFixture(t), agent = f.a.agents[0]!;
  const catalog = await f.ok('GET', '/avatar-catalog');
  assert.equal(catalog.version, 2); assert.equal(catalog.catalogVersion, appearanceVersion);
  assert.equal(catalog.catalogDigest, '30c00558d539a194e6936b24e0179a2558cad4b047251265231388e9c63c2b82');
  assert.deepEqual(catalog.looks.map((look: { lookId: string }) => look.lookId), lookIds);
  const before = await f.scene(), fact = before.avatars.find((row: { agentId: string }) => row.agentId === agent.agentId);
  const initial = await f.profile(agent, f.a.owner);
  await f.login(f.a.owner); await f.appearancePage(agent); await choose(f.page, 1);
  assert.deepEqual((await f.profile(agent, f.a.owner)).published.avatar, lookPair(), 'A visible preview does not save');
  const saved = await commitAppearance(f.page, agent);
  assert.deepEqual(saved.input.fields, { avatar: lookPair(lookIds[1]!) });
  assert.equal(saved.result.saveEffect, 'public'); assert.equal(saved.result.publishedVersion, initial.publishedVersion + 1);
  const receipt = await f.ok('GET', `/operations/${saved.input.operationId}?scope=${encodeURIComponent('owner:' + f.a.owner.ownerId)}&action=saveProfile`, undefined, f.a.owner.sessionToken);
  assert.deepEqual(receipt, saved.result, 'The canonical original operation receipt is the successful result');
  const read = await f.profile(agent, f.a.owner), published = await f.publicProfile(agent);
  assert.deepEqual(read.published.avatar, lookPair(lookIds[1]!)); assert.deepEqual(read.publishedAppearance, lookPair(lookIds[1]!));
  assert.deepEqual(published.appearance, read.publishedAppearance); assert.equal(published.publishedVersion, read.publishedVersion);
  const after = await f.scene(), changed = after.avatars.find((row: { agentId: string }) => row.agentId === agent.agentId);
  assert.equal(after.worldRevision, before.worldRevision);
  assert.deepEqual({ id: changed.id, version: changed.version, position: changed.position }, { id: fact.id, version: fact.version, position: fact.position });
  assert.deepEqual(changed.profile.appearance, lookPair(lookIds[1]!)); assert.equal(changed.profile.publishedVersion, read.publishedVersion);
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[1]!);
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-appearance-state', 'ready');
  await expect(f.page.locator('#manager-portrait canvas.avatar')).toHaveAttribute('data-look-id', lookIds[1]!);
  await expect(f.page.locator('#agent-list [data-agent-id="' + agent.agentId + '"] canvas.avatar')).toHaveAttribute('data-look-id', lookIds[1]!);
  await expect(f.page.locator('#manager-public-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[1]!);
  await expect(f.page.locator('.hud-agent-picture canvas.avatar')).toHaveAttribute('data-look-id', lookIds[1]!);
  await expect.poll(async () => (await renderedFacts(f.page)).find((row: { agentId: string }) => row.agentId === agent.agentId)?.profile.appearance).toEqual(lookPair(lookIds[1]!));
  await expect.poll(() => worldHairDrawn(f.page, 'longhair')).toBe(true);
  // Stop page polling before replacing only this test's app instance and its application pools.
  await f.page.goto('about:blank'); await f.restart(); await f.page.goto(f.origin + '/#account');
  await expect(f.page.locator('#manage-view')).toBeVisible(); await f.appearancePage(agent);
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[1]!);
  assert.deepEqual((await f.profile(agent, f.a.owner)).published.avatar, lookPair(lookIds[1]!));
  assert.deepEqual((await f.publicProfile(agent)).appearance, lookPair(lookIds[1]!));
  await f.evidence('save-reconnect', { originalOperationId: saved.input.operationId, agentId: agent.agentId, avatarId: agent.avatarId,
    publishedVersion: read.publishedVersion, beforeWorldRevision: before.worldRevision, afterWorldRevision: after.worldRevision, persistence: 'same database; closed app/new pools, no PG or OS restart' });
  await f.logout();
});

test('unknown submit and lost committed response recover the exact operation/body; a stale CAS cannot overwrite another save', { timeout: 180_000 }, async t => {
  const f = await worldLookFixture(t), agent = f.a.agents[0]!, path = profilePath(agent);
  await f.login(f.a.owner); await f.appearancePage(agent); await choose(f.page, 2);
  let first: Record<string, unknown> | undefined;
  f.allowAbort(path);
  await f.page.route('**' + path, async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    first = route.request().postDataJSON();
    f.allowStatus(`/v1/operations/${first!.operationId}`, 404, 5);
    await route.abort('failed');
  }, { times: 1 });
  await lookPointer(f.page, f.page.locator('#save-appearance'));
  await expect(f.page.locator('#unknown-controls')).toBeVisible(); assert(first);
  assert.deepEqual((await f.profile(agent, f.a.owner)).published.avatar, lookPair());
  const unsentCount = f.requests.filter(row => row.method === 'PUT' && row.path === path).length;
  await lookPointer(f.page, f.page.locator('#hud-close')); await expect(f.page.locator('#hud-window')).toBeHidden();
  await lookPointer(f.page, f.page.locator('#hud-open-profile'));
  await expect(f.page.locator('#unknown-controls')).toBeVisible();
  assert.equal(f.requests.filter(row => row.method === 'PUT' && row.path === path).length, unsentCount, 'Closing and reopening does not silently resubmit an unknown operation');
  assert.deepEqual((await f.profile(agent, f.a.owner)).published.avatar, lookPair());
  await f.page.reload(); await expect(f.page.locator('#unknown-controls')).toBeVisible();
  const committed = f.page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'PUT');
  await lookPointer(f.page, f.page.locator('#check-result')); const originalRetry = await committed;
  assert.equal(originalRetry.status(), 200); assert.deepEqual(originalRetry.request().postDataJSON(), first);
  await expect.poll(async () => (await f.profile(agent, f.a.owner)).published.avatar).toEqual(lookPair(lookIds[2]!));
  await f.appearancePage(agent); await choose(f.page, 3);
  let lost: Record<string, unknown> | undefined, committedVersion: number | undefined;
  f.allowAbort(path);
  await f.page.route('**' + path, async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    lost = route.request().postDataJSON();
    const real = await route.fetch(); assert.equal(real.status(), 200); committedVersion = (await real.json()).publishedVersion;
    await route.abort('failed');
  }, { times: 1 });
  await lookPointer(f.page, f.page.locator('#save-appearance')); await expect(f.page.locator('#unknown-controls')).toBeVisible(); assert(lost);
  await f.page.reload();
  // Resume queries the original receipt automatically; a second click is not required if it already resolves.
  if (await f.page.locator('#unknown-controls').isVisible()) await lookPointer(f.page, f.page.locator('#check-result'));
  await expect(f.page.locator('#unknown-controls')).toBeHidden();
  assert.equal((await f.profile(agent, f.a.owner)).publishedVersion, committedVersion);
  assert.deepEqual((await f.profile(agent, f.a.owner)).published.avatar, lookPair(lookIds[3]!));
  await f.appearancePage(agent); await choose(f.page, 4);
  let release!: () => void, received!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), actualCommit = new Promise<void>(resolve => { received = resolve; });
  await f.page.route('**' + path, async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const actual = await route.fetch(); assert.equal(actual.status(), 200); received();
    await held; await route.fulfill({ response: actual }); // Forward the unmodified real result, after a deliberately later owner save.
  }, { times: 1 });
  try {
    await lookPointer(f.page, f.page.locator('#save-appearance')); await actualCommit;
    await f.save(agent, f.a.owner, { avatar: lookPair(lookIds[5]!) }); release();
    await expect(f.page.locator('#account-root')).toHaveAttribute('aria-busy', 'false');
    await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[5]!);
    assert.deepEqual((await f.publicProfile(agent)).appearance, lookPair(lookIds[5]!), 'A delayed earlier successful response cannot overwrite the newer published identity');
  } finally { release(); }
  const stale = await f.profile(agent, f.a.owner); await f.save(agent, f.a.owner, { avatar: lookPair(lookIds[4]!) });
  const staleInput = { operationId: randomUUID(), expectedVersion: stale.version, expectedPolicyVersion: stale.policyVersion, fields: { avatar: lookPair(lookIds[5]!) } };
  const rejected = await f.api('PUT', '/agents/' + agent.agentId + '/profile', staleInput, f.a.owner.sessionToken);
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'version_conflict');
  assert.deepEqual((await f.publicProfile(agent)).appearance, lookPair(lookIds[4]!));
  await f.evidence('unknown-recovery', { agentId: agent.agentId, unsentOriginal: first, lostCommittedOriginal: lost, committedVersion, staleOperationId: staleInput.operationId });
});

test('two Owners and three Agents stay isolated; dirty selection, runtime policy, avatar lock and independent proposals keep their original authority', { timeout: 180_000 }, async t => {
  const f = await worldLookFixture(t, { width: 1280, height: 800 }), [a1, a2] = f.a.agents, b1 = f.b.agents[0]!; assert(a1 && a2);
  await f.login(f.a.owner); await f.appearancePage(a1); await choose(f.page, 4);
  await lookPointer(f.page, f.page.locator('#hud-close')); await expect(f.page.locator('#hud-window')).toBeHidden();
  await lookPointer(f.page, f.page.locator('#hud-open-profile'));
  await expect(f.page.locator('#appearance-form canvas[data-look-stage]')).toHaveAttribute('data-look-id', lookIds[4]!);
  assert.deepEqual((await f.profile(a1, f.a.owner)).published.avatar, lookPair(), 'Closing retains the unsaved look without publishing it');
  // This native control change must go through the actual dirty confirmation rather than a direct controller call.
  await lookPointer(f.page, f.page.locator('#manager-object').getByRole('button', { name: '切换 Agent', exact: true }));
  await expect(f.page.getByRole('heading', { name: '离开当前编辑' })).toBeVisible();
  await lookPointer(f.page, f.page.getByRole('button', { name: '继续原任务', exact: true }));
  await expect(f.page.locator('#selected-id')).toContainText(a1.agentId);
  await expect(f.page.locator('#appearance-form canvas[data-look-stage]')).toHaveAttribute('data-look-id', lookIds[4]!);
  await commitAppearance(f.page, a1);
  assert.deepEqual((await f.publicProfile(a2)).appearance, lookPair()); assert.deepEqual((await f.publicProfile(b1)).appearance, lookPair());
  const bProfile = await f.profile(b1, f.b.owner);
  const cross = await f.api('PUT', '/agents/' + b1.agentId + '/profile', { operationId: randomUUID(), expectedVersion: bProfile.version,
    expectedPolicyVersion: bProfile.policyVersion, fields: { avatar: lookPair(lookIds[1]!) } }, f.a.owner.sessionToken);
  assert([403, 404].includes(cross.status));
  const aProfile = await f.profile(a2, f.a.owner);
  const direct = await f.ok('PUT', '/agents/' + a2.agentId + '/profile', { operationId: randomUUID(), expectedVersion: aProfile.version,
    expectedPolicyVersion: aProfile.policyVersion, fields: { avatar: lookPair(lookIds[2]!) } }, a2.runtimeToken);
  const policy = await f.ok('PUT', '/owner/agents/' + a2.agentId + '/profile-policy', { operationId: randomUUID(), expectedVersion: direct.version,
    expectedPolicyVersion: direct.policyVersion, mode: 'agent_autonomous', lockedFields: ['avatar'] }, f.a.owner.sessionToken);
  let current = await f.profile(a2, f.a.owner);
  const locked = await f.api('PUT', '/agents/' + a2.agentId + '/profile', { operationId: randomUUID(), expectedVersion: current.version,
    expectedPolicyVersion: policy.policyVersion, fields: { avatar: lookPair(lookIds[5]!) } }, a2.runtimeToken);
  assert.equal(locked.status, 403); assert.equal(locked.body.error.code, 'field_locked');
  await f.ok('PUT', '/owner/agents/' + a2.agentId + '/profile-policy', { operationId: randomUUID(), expectedVersion: current.version,
    expectedPolicyVersion: current.policyVersion, mode: 'proposal_required', lockedFields: [] }, f.a.owner.sessionToken);
  current = await f.profile(a2, f.a.owner);
  const proposed = await f.ok('PUT', '/agents/' + a2.agentId + '/profile/draft', { operationId: randomUUID(), expectedVersion: current.version,
    expectedPolicyVersion: current.policyVersion, fields: { avatar: lookPair(lookIds[5]!) } }, a2.runtimeToken);
  assert.deepEqual(proposed.published.avatar, lookPair(lookIds[2]!));
  const nameOnly = await f.save(a2, f.a.owner, { displayName: a2.name + '改名' });
  assert.deepEqual(nameOnly.result.published.avatar, lookPair(lookIds[2]!)); assert.deepEqual(nameOnly.result.draft.avatar, lookPair(lookIds[5]!));
  await lookPointer(f.page, f.page.locator('#manager-object').getByRole('button', { name: '管理', exact: true }));
  const security = f.page.locator('button[data-manager-page="security"]'), initial = await lookNavigationObservation(security);
  assert(initial.sidebar?.controlInside && initial.hitInside, 'At 1280 the initial security entry is inside its real sidebar clip and receives the pointer');
  assert(initial.box.height >= 35, 'Compact spacing retains the existing 35px navigation target');
  await lookPointer(f.page, security); await expect(f.page.locator('#manager-title-security')).toBeVisible();
  await lookPointer(f.page, f.page.locator('#hud-close')); await expect(f.page.locator('#hud-window')).toBeHidden();
  await expect(f.page.locator('#hud-open-profile')).toBeFocused();
  await f.page.keyboard.press('Enter'); await expect(f.page.locator('#hud-window')).toHaveAttribute('data-panel-state', 'open');
  await expect(f.page.locator('#manage-view')).toHaveAttribute('data-manager-page', 'appearance');
  await lookPointer(f.page, f.page.locator('#manager-object').getByRole('button', { name: '管理', exact: true }));
  const keyboard = await lookTabTo(f.page, security);
  await f.page.keyboard.press('Enter'); await expect(f.page.locator('#manager-title-security')).toBeVisible();
  await f.evidence('manager-navigation', { initial, keyboard, closedFocusReturned: 'hud-open-profile',
    baselineBoundary: 'The earlier unscrolled sidebar clipped the entry; D separately demonstrated native wheel access. No total logout inaccessibility is inferred.' });
  await f.logout(); await f.login(f.b.owner, { navigate: false }); await f.appearancePage(b1);
  await expect(f.page.locator('#agent-list')).not.toContainText(a1.name); await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[0]!);
  await f.logout();
});

test('legacy evidence and unavailable identities remain explicit; a confirmed save with failed art never writes a replacement default', { timeout: 180_000 }, async t => {
  const f = await worldLookFixture(t, { width: 1440, height: 900 }, { createSecondAvatar: false }), [agent, other] = f.a.agents; assert(agent && other);
  const catalog = await f.ok('GET', '/avatar-catalog');
  assert(catalog.looks.every((look: { selectable: boolean }) => look.selectable), 'The frozen current directory contains six selectable looks; no fake production retirement is claimed');
  // Legitimate historical payload union, saved through the same real profile command rather than SQL rewriting.
  await f.save(agent, f.a.owner, { avatar: { template: 'basic', color: 'blue' } });
  const legacy = await f.profile(agent, f.a.owner);
  assert.deepEqual(legacy.published.avatar, { template: 'basic', color: 'blue' });
  assert.deepEqual(legacy.publishedAppearance, lookPair(lookIds[2]!));
  await f.save(other, f.a.owner, { avatar: { template: 'basic', color: 'cream' } });
  const noEvidence = await f.profile(other, f.a.owner);
  assert.equal(other.avatarId, ''); assert.deepEqual(noEvidence.publishedAppearance, { template: 'basic', color: 'cream' }, 'A real missing Avatar retains explicit legacy facts, not a hash of Agent id');
  const beforeInvalid = await f.profile(other, f.a.owner);
  for (const avatar of [{ lookId: 'unknown-look', catalogVersion: appearanceVersion }, { lookId: lookIds[1]!, catalogVersion: 'unknown-version' }]) {
    const response = await f.api('PUT', '/agents/' + other.agentId + '/profile', { operationId: randomUUID(), expectedVersion: beforeInvalid.version,
      expectedPolicyVersion: beforeInvalid.policyVersion, fields: { avatar } }, f.a.owner.sessionToken);
    assert.equal(response.status, 422); assert.equal(response.body.error.code, 'profile_validation_failed'); assert.equal(response.body.error.details.field, 'avatar');
  }
  assert.deepEqual((await f.profile(other, f.a.owner)).published.avatar, { template: 'basic', color: 'cream' });
  await f.login(f.a.owner); await f.appearancePage(other);
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-appearance-state', 'unresolved');
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', '');
  // This authorized unpublish leaves membership joined. The independent proposal must not become an implicit default.
  let otherProfile = await f.profile(other, f.a.owner);
  await f.ok('PUT', '/agents/' + other.agentId + '/profile/draft', { operationId: randomUUID(), expectedVersion: otherProfile.version,
    expectedPolicyVersion: otherProfile.policyVersion, fields: { displayName: 'AGENT_UNAPPROVED_NAME', bio: 'AGENT_UNAPPROVED_BODY', avatar: lookPair(lookIds[5]!) } }, other.runtimeToken);
  otherProfile = await f.profile(other, f.a.owner);
  await f.ok('POST', '/agents/' + other.agentId + '/profile/unpublish', { operationId: randomUUID(), expectedVersion: otherProfile.version,
    expectedPolicyVersion: otherProfile.policyVersion }, f.a.owner.sessionToken);
  const unpublished = await f.profile(other, f.a.owner), stable = (profile: Record<string, unknown>) => ({ version: profile.version,
    policyVersion: profile.policyVersion, publishedVersion: profile.publishedVersion, published: profile.published, draft: profile.draft });
  assert.equal(unpublished.published, null);
  const nameOnly = await f.api('PUT', '/agents/' + other.agentId + '/profile', { operationId: randomUUID(), expectedVersion: unpublished.version,
    expectedPolicyVersion: unpublished.policyVersion, fields: { displayName: '主人本次明确姓名' } }, f.a.owner.sessionToken);
  assert.equal(nameOnly.status, 422); assert.equal(nameOnly.body.error.code, 'profile_validation_failed'); assert.equal(nameOnly.body.error.details.field, 'avatar');
  assert.deepEqual(stable(await f.profile(other, f.a.owner)), stable(unpublished), 'Rejected name-only recovery changes neither publication, proposal nor versions');
  assert.equal((await f.api('GET', '/public/agents/' + other.agentId)).status, 404);
  // A native browser refresh obtains the changed source; no controller handler is invoked directly.
  await f.page.reload(); await expect(f.page.locator('#manage-view')).toBeVisible(); await f.appearancePage(other);
  await f.navigate('profile');
  await f.page.locator('#display-name').fill('主人本次明确姓名'); await f.page.locator('#bio').fill('主人本次明确简介');
  await f.page.locator('#interests').fill('主人本次兴趣');
  f.allowStatus(profilePath(other), 422);
  const invalid = f.page.waitForResponse(response => new URL(response.url()).pathname === profilePath(other) && response.request().method() === 'PUT');
  await lookPointer(f.page, f.page.locator('#save-profile')); assert.equal((await invalid).status(), 422);
  await expect(f.page.locator('#profile-appearance-needed')).toBeVisible();
  await expect(f.page.locator('#display-name')).toHaveValue('主人本次明确姓名'); await expect(f.page.locator('#bio')).toHaveValue('主人本次明确简介');
  await expect(f.page.locator('#interests')).toHaveValue('主人本次兴趣');
  assert.deepEqual(stable(await f.profile(other, f.a.owner)), stable(unpublished));
  await lookPointer(f.page, f.page.getByRole('button', { name: '选择角色', exact: true })); await choose(f.page, 1);
  await expect(f.page.locator('#save-appearance')).toHaveText('保存资料与形象');
  const repaired = await commitAppearance(f.page, other);
  assert.deepEqual(repaired.input.fields, { displayName: '主人本次明确姓名', bio: '主人本次明确简介', interests: ['主人本次兴趣'], avatar: lookPair(lookIds[1]!) });
  assert.deepEqual(repaired.result.draft, unpublished.draft, 'The separate Agent proposal remains unadopted');
  assert.deepEqual((await f.publicProfile(other)).profile, repaired.result.published);
  await f.appearancePage(agent);
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[2]!);
  await choose(f.page, 5); const saved = await commitAppearance(f.page, agent);
  const version = saved.result.publishedVersion;
  // Reopen with a fresh browser image cache; only this original art URL is denied. Successful APIs remain untouched.
  const image = '**/human-spikeyhair-idle.png';
  f.allowAbort('/assets/world-pixel/assets/human-spikeyhair-idle.png', 20);
  await f.page.route(image, route => route.abort('failed'));
  await f.page.reload(); await expect(f.page.locator('#manage-view')).toBeVisible(); await f.appearancePage(agent);
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-appearance-state', 'error');
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[5]!);
  await expect(f.page.locator('#appearance-form .stage-status')).toHaveText('已保存 · 图像暂不可用');
  assert.equal((await f.profile(agent, f.a.owner)).publishedVersion, version);
  assert.deepEqual((await f.publicProfile(agent)).appearance, lookPair(lookIds[5]!));
  assert.equal(f.requests.filter(request => request.method === 'PUT' && request.path === profilePath(agent)).length, 1, 'Asset failure cannot submit a replacement appearance');
  await f.page.unroute(image); await f.page.reload(); await expect(f.page.locator('#manage-view')).toBeVisible(); await f.appearancePage(agent);
  await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-appearance-state', 'ready');
  await f.logout();
});

test('withdrawn public participation and account switching reject old art completion and remove the World person', { timeout: 180_000 }, async t => {
  const f = await worldLookFixture(t), agent = f.a.agents[0]!, b1 = f.b.agents[0]!;
  await f.save(agent, f.a.owner, { avatar: lookPair(lookIds[1]!) });
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), actualImage = new Promise<void>(resolve => { arrived = resolve; });
  await f.page.route('**/human-longhair-idle.png', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200); arrived();
    await held; await route.fulfill({ response }); // Real native bytes; only delivery is delayed across the actual Owner transition.
  });
  try {
    await f.login(f.a.owner); await f.appearancePage(agent); await actualImage;
    await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[1]!);
    assert((await f.scene()).avatars.some((fact: { agentId: string }) => fact.agentId === agent.agentId));
    const member = await f.ok('GET', '/agents/' + agent.agentId + '/membership', undefined, agent.runtimeToken);
    await f.ok('POST', '/agents/' + agent.agentId + '/membership/leave', { operationId: randomUUID(), expectedVersion: member.version }, agent.runtimeToken);
    assert(!(await f.scene()).avatars.some((fact: { agentId: string }) => fact.agentId === agent.agentId));
    await f.logout(); await f.login(f.b.owner, { navigate: false }); await f.appearancePage(b1);
    await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[0]!);
    release();
    await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-appearance-state', 'ready');
    await expect(f.page.locator('#selected-avatar canvas.avatar')).toHaveAttribute('data-look-id', lookIds[0]!);
    await expect(f.page.locator('#agent-list')).not.toContainText(agent.name);
    await lookPointer(f.page, f.page.locator('#hud-open-world')); await expect(f.page.locator('#world-canvas')).toBeVisible();
    await expect.poll(async () => (await renderedFacts(f.page)).some((fact: { agentId: string }) => fact.agentId === b1.agentId)).toBe(true);
    await expect.poll(async () => (await renderedFacts(f.page)).some((fact: { agentId: string }) => fact.agentId === agent.agentId)).toBe(false);
    await expect(f.page.locator('[data-agent-id="' + agent.agentId + '"][data-world-source="server"]')).toHaveCount(0);
  } finally { release(); }
  await f.evidence('withdrawal', { agentId: agent.agentId, originalAvatarId: agent.avatarId, publishedProfileStatus: (await f.api('GET', '/public/agents/' + agent.agentId)).status,
    newOwnerId: f.b.owner.ownerId, newAgentId: b1.agentId });
  await f.logout();
});

test('1024 desktop reads isolated real long content to its end while main and mail-reader close controls remain reachable', { timeout: 180_000 }, async t => {
  const f = await worldLookFixture(t, { width: 1024, height: 768 }, { content: true }); assert(f.content);
  const content = f.content;
  await f.login(f.a.owner); await f.appearancePage(f.a.agents[0]!);
  await lookPointer(f.page, f.page.locator('#hud-open-inventory'));
  await expect(f.page.locator('#hud-platform-item-detail')).toContainText(content.itemEnd);
  await expect(f.page.locator('#hud-window')).toHaveAttribute('data-panel-state', 'open');
  const detail = f.page.locator('#hud-platform-item-detail'), pageTop = await f.page.evaluate(() => scrollY);
  const beforeClose = await f.page.locator('#hud-close').boundingBox(); assert(beforeClose);
  const region = await detail.boundingBox(); assert(region);
  await f.page.mouse.move(region.x + region.width / 2, region.y + region.height / 2);
  for (let turn = 0; turn < 15; turn++) {
    const end = await detail.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 2);
    if (end) break;
    const before = await detail.evaluate(node => node.scrollTop); await f.page.mouse.wheel(0, 600);
    await expect.poll(() => detail.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
  }
  assert(await detail.evaluate(node => node.scrollTop > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 2), 'The actual inventory detail, not the document, reaches its last content');
  await expect(f.page.locator('#hud-close')).toBeVisible();
  assert.equal(await f.page.evaluate(() => scrollY), pageTop);
  assert.deepEqual(await f.page.locator('#hud-close').boundingBox(), beforeClose);
  await lookPointer(f.page, f.page.locator('#hud-close')); await expect(f.page.locator('#hud-window')).toBeHidden();
  await lookPointer(f.page, f.page.locator('#hud-open-mail'));
  await lookPointer(f.page, f.page.locator('[data-platform-tab="notifications"]'));
  const row = f.page.locator('[data-platform-message="' + content.notificationId + '"]');
  const list = f.page.locator('#hud-platform-mail-results');
  for (let turn = 0; turn < 20; turn++) {
    const box = await row.boundingBox(), frame = await list.boundingBox(); assert(frame);
    if (box && box.y >= frame.y && box.y + box.height <= frame.y + frame.height) break;
    const before = await list.evaluate(node => node.scrollTop);
    await f.page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2); await f.page.mouse.wheel(0, 500);
    await expect.poll(() => list.evaluate(node => node.scrollTop)).not.toBe(before);
  }
  await lookPointer(f.page, row);
  await expect(f.page.locator('#hud-detail-body')).toContainText(content.notificationEnd);
  await expect(f.page.locator('#hud-detail-window')).toHaveAttribute('data-panel-state', 'open');
  await expect(f.page.locator('#hud-detail-body').getByRole('heading', { name: content.notificationTitle, exact: true })).toBeVisible();
  const reader = f.page.locator('#hud-detail-body'), close = await f.page.locator('#hud-detail-close').boundingBox(); assert(close);
  const readerRegion = await reader.boundingBox(); assert(readerRegion);
  await f.page.mouse.move(readerRegion.x + readerRegion.width / 2, readerRegion.y + readerRegion.height / 2);
  for (let turn = 0; turn < 15; turn++) {
    if (await reader.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 2)) break;
    const before = await reader.evaluate(node => node.scrollTop); await f.page.mouse.wheel(0, 600);
    await expect.poll(() => reader.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
  }
  assert(await reader.evaluate(node => node.scrollTop > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 2));
  assert.equal(await f.page.evaluate(() => scrollY), pageTop); assert.deepEqual(await f.page.locator('#hud-detail-close').boundingBox(), close);
  await lookPointer(f.page, f.page.locator('#hud-detail-close')); await expect(f.page.locator('#hud-detail-window')).toBeHidden();
  await lookPointer(f.page, f.page.locator('#hud-close')); await expect(f.page.locator('#hud-window')).toBeHidden();
  assert(f.requests.some(request => request.path === '/v1/perception/list') && f.requests.some(request => request.path === '/v1/perception/detail'));
  await f.evidence('desktop-1024-content', { viewport: { width: 1024, height: 768 }, database: f.database, itemEnd: content.itemEnd,
    notificationEnd: content.notificationEnd, internalScroll: true, closeControlsUnmoved: true, documentScroll: pageTop, realHttp: true });
  await f.logout();
});
