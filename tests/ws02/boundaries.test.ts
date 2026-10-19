import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ok, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, refKey, requestBase, type Ref } from './helpers.ts';

test('source outages disclose no private or withdrawn target before current authorization succeeds', async t => {
  const f = await fixture(t), rows = await f.listAll(requestBase('inbox', { categoryId: 'notifications', limit: 5 }));
  const ref = rows.records.find(row => row.detailAvailable)!.ref as Ref, content = await f.detail(ref);
  const missing = { ...ref, id: `nonexistent-${randomUUID()}` };
  const completedOperation = randomUUID();
  await f.read('PUT', '/agent-read-state', { protocolVersion: 1, operationId: completedOperation, ref,
    contentVersion: content.final.version, completionToken: content.final.completionToken });
  const withdrawn = { moduleId: 'profiles', type: 'profiles.agent@1', id: f.sibling.agentId };
  const profile = await ok(f.m1, 'GET', `/agents/${f.sibling.agentId}/profile`, undefined, f.owner.sessionToken);
  await ok(f.m1, 'POST', `/agents/${f.sibling.agentId}/profile/unpublish`, {
    operationId: randomUUID(), expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion,
  }, f.owner.sessionToken);
  f.storage(store => store.transaction(tx => {
    const object = tx.find('perception_objects').find(row => refKey(row.data.ref as unknown as Ref) === refKey(ref)); assert(object);
    for (const grant of tx.find('perception_grants', { objectId: object.id }).filter(row => row.data.agentId !== f.a.agentId)) {
      assert(tx.update('perception_grants', { ...grant, version: grant.version + 1, data: { ...grant.data, active: false } }, grant.version));
    }
  }));
  const operations = (target: Ref) => [
    { method: 'POST' as const, path: '/detail', body: { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref: target } },
    { method: 'POST' as const, path: '/agent-read-state/query', body: { protocolVersion: 1, ref: target } },
    { method: 'PUT' as const, path: '/agent-read-state', body: { protocolVersion: 1, operationId: randomUUID(), ref: target,
      contentVersion: content.final.version, completionToken: content.final.completionToken } },
  ];
  const receiptPath = (operationId: string) => `/operations/${operationId}?${new URLSearchParams({ scope: `perception-agent:${f.a.agentId}`, action: 'confirmAgentRead' })}`;
  for (const state of ['enabled', 'unavailable', 'not_enabled']) {
    f.storage(store => store.transaction(tx => {
      const config = tx.get('perception_catalog', 'current')!;
      assert(tx.update('perception_catalog', { ...config, version: config.version + 1,
        data: { ...config.data, sourceStates: { ...(config.data.sourceStates as Json), 'direct-mail': state, 'profiles-public': state } } }, config.version));
    }));
    for (const token of [f.sibling.runtimeToken, f.b.runtimeToken, f.owner.sessionToken]) {
      for (const [index, operation] of operations(ref).entries()) {
        const nonexistent = operations(missing)[index]!;
        const knownBody: Json = { ...operation.body }, missingBody: Json = { ...nonexistent.body };
        if (index === 0 && token === f.owner.sessionToken) knownBody.purpose = missingBody.purpose = 'human-inspect';
        const knownResult = await f.call(operation.method, operation.path, knownBody, token);
        const missingResult = await f.call(nonexistent.method, nonexistent.path, missingBody, token);
        assert.equal(knownResult.status, token === f.owner.sessionToken && index > 0 ? 403 : 404);
        assert.equal(missingResult.status, knownResult.status);
        assert.deepEqual(knownResult.error, missingResult.error, 'Source state cannot distinguish an unauthorized known ref from an absent ref');
        assert.equal(knownResult.data == null, true); assert.equal(knownResult.error.sourceStates, undefined);
      }
      assert.equal((await f.m1('GET', receiptPath(completedOperation), undefined, token)).status, 404);
      assert.equal((await f.m1('GET', receiptPath(randomUUID()), undefined, token)).status, 404);
    }
    const authorizedStatus = state === 'enabled' ? 200 : state === 'unavailable' ? 503 : 409;
    assert.equal((await f.call('POST', '/detail', operations(ref)[0]!.body)).status, authorizedStatus, 'Only the authorized reader learns its source state');
    for (const target of [withdrawn, { ...withdrawn, id: `nonexistent-${randomUUID()}` }]) {
      const denied = await f.call('POST', '/detail', { ...requestBase('world', { purpose: 'agent-inspect' }), ref: target });
      assert.equal(denied.status, 404); assert.equal(denied.error.code, 'target_not_accessible');
    }
    assert.equal((await f.call('POST', '/detail', { ...requestBase('world', { purpose: 'agent-inspect' }),
      ref: { ...withdrawn, id: f.a.agentId } })).status, authorizedStatus);
  }
  f.storage(store => store.transaction(tx => {
    const object = tx.find('perception_objects').find(row => refKey(row.data.ref as unknown as Ref) === refKey(ref)); assert(object);
    const grant = tx.find('perception_grants', { objectId: object.id, agentId: f.a.agentId })[0]!;
    assert(tx.update('perception_grants', { ...grant, version: grant.version + 1, data: { ...grant.data, active: false } }, grant.version));
  }));
  const ownHistoricalReceipt = await f.m1('GET', receiptPath(completedOperation), undefined, f.a.runtimeToken);
  assert.equal(ownHistoricalReceipt.status, 404); assert.equal(ownHistoricalReceipt.body.error.code, 'target_not_accessible');
  assert.equal((await f.m1('GET', receiptPath(randomUUID()), undefined, f.a.runtimeToken)).status, 404);
});

test('list and detail enforce lowered response, source-scan and preparation-time budgets without a false complete result', async t => {
  const f = await fixture(t, { detailSegmentChars: 32 });
  const input = requestBase('inbox', { categoryId: 'notifications', limit: 5 });
  const first = await f.read('POST', '/list', input), ref = first.records.find((row: Json) => row.detailAvailable)!.ref as Ref;
  const detailInput = { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref };
  async function refused(path: string, body: Json) {
    const persisted = () => f.storage(store => store.read(tx => ({ sessions: tx.find('perception_sessions').length,
      prepared: tx.find('perception_access').filter(row => (row.data.result as Json)?.status === 'data_provided').length })));
    const before = persisted();
    const response = await f.call('POST', path, body);
    assert.equal(response.status, 422); assert.equal(response.error.code, 'budget_too_small');
    assert.equal(response.data == null, true, 'A rejected budget cannot masquerade as an empty complete result or grant a completion token');
    assert.deepEqual(persisted(), before, 'A refused budget must not commit a read session or a successful data-prepared fact');
  }
  await refused('/list', { ...input, budget: { maxResponseBytes: 1 } });
  await refused('/detail', { ...detailInput, budget: { maxResponseBytes: 1 } });
  await refused('/list', { ...input, budget: { maxScannedRows: 1 } });
  await refused('/list', { ...input, pageToken: first.nextPageToken, budget: { maxScannedRows: 1 } });
  for (const [budget, status] of [[null, 400], [[], 400], [{ maxResponseBytes: 0 }, 422],
    [{ maxScannedRows: 2001 }, 422], [{ deadlineMs: 251 }, 422], [{ unknown: 1 }, 400]] as const) {
    for (const [path, body] of [['/list', input], ['/detail', detailInput]] as const) {
      const invalid = await f.call('POST', path, { ...body, budget });
      assert.equal(invalid.status, status); assert.equal(invalid.error.code, 'invalid_request');
    }
  }
  const single = await f.call('POST', '/detail', { ...detailInput, budget: { maxScannedRows: 1, maxResponseBytes: 65536 } });
  assert.equal(single.status, 200); assert(Buffer.byteLength(JSON.stringify(single.envelope)) <= 65536);
  assert.equal(single.data.contentComplete, false); assert.equal(single.data.completionToken, undefined);
  // Advance only the isolated wall-clock budget boundary. Authentication and
  // stored read-session expiry continue to use this fixture's explicit clock.
  for (const [path, body] of [['/list', input], ['/detail', detailInput]] as const) {
    let wall = Date.now(); const clock = t.mock.method(Date, 'now', () => (wall += 10));
    try { await refused(path, { ...body, budget: { deadlineMs: 1 } }); }
    finally { clock.mock.restore(); }
  }
  assert.equal((await f.call('POST', '/detail', { ...detailInput, budget: { maxScannedRows: 0 } })).status, 422);
  const page = await f.call('POST', '/list', { ...input, pageToken: first.nextPageToken,
    budget: { maxResponseBytes: 65536, maxScannedRows: 2000, deadlineMs: 250 } });
  assert.equal(page.status, 200); assert.equal(page.data.readSessionId, first.readSessionId);
  assert(Buffer.byteLength(JSON.stringify(page.envelope)) <= 65536);
  assert.equal((await f.unread()).count.value, 30, 'Failed reads never confirm messages or consume the existing read chain');
});

test('activity retention is a disclosure barrier despite cleanup backlog and invalidates a page crossing the retention cutoff', async t => {
  const f = await fixture(t), items = await f.listAll(requestBase('world', { categoryId: 'items', limit: 5 }));
  const target = items.records[0]!.ref as Ref, stamp = Date.UTC(2026, 9, 20), retention = 7 * 86_400_000;
  const expiredPrefix = `${String(stamp - retention - 1000).padStart(16, '0')}_retention-expired-`;
  const nearIds = [0, 1].map(index => `${String(stamp - retention + 1000).padStart(16, '0')}_retention-near-${index}`);
  f.storage(store => store.transaction(tx => {
    const insert = (id: string, recordedAt: number) => tx.insert('perception_access', { id, version: 1, data: {
      recordId: id, agentId: f.a.agentId, humanAudienceOwnerId: f.owner.ownerId, scopePrivate: false,
      agentRef: { moduleId: 'profiles', type: 'profiles.agent@1', id: f.a.agentId },
      actor: { kind: 'runtime', agentId: f.a.agentId }, operationRef: 'perceptionDetail',
      receivedAt: recordedAt, recordedAt, targets: [target], declaration: null, result: { status: 'data_provided', recordedAt },
    } });
    for (let index = 0; index < 300; index++) insert(`${expiredPrefix}${String(index).padStart(3, '0')}`, stamp - retention - 1000);
    for (const id of nearIds) insert(id, stamp - retention + 1000);
  }));
  const query = { protocolVersion: 1, agentRef: { moduleId: 'profiles', type: 'profiles.agent@1', id: f.a.agentId }, limit: 50 };
  const history = await f.read('POST', '/activity/query', query, f.owner.sessionToken);
  assert(!history.records.some((row: Json) => row.recordId.startsWith(expiredPrefix)));
  assert(f.storage(store => store.read(tx => tx.find('perception_access').some(row => row.id.startsWith(expiredPrefix)))),
    'The test includes expired rows beyond one bounded cleanup batch; disclosure cannot rely on their physical deletion');
  const first = await f.read('POST', '/activity/query', { ...query, limit: 1 }, f.owner.sessionToken);
  assert.equal(first.records[0].recordId, nearIds[0]); assert.equal(first.complete, false);
  f.advance(2000);
  const continuation = await f.call('POST', '/activity/query', { ...query, limit: 1, pageToken: first.nextPageToken }, f.owner.sessionToken);
  assert.equal(continuation.status, 409); assert.equal(continuation.error.code, 'read_scope_changed');
  assert.equal(continuation.data == null, true, 'A frozen page cannot disclose expired records or skip them using its old offset');
  const current = await f.read('POST', '/activity/query', query, f.owner.sessionToken);
  assert(!current.records.some((row: Json) => nearIds.includes(row.recordId)));
  assert.equal(current.historyCoverage.complete, false);
});

test('persisted preparation facts preserve the observed category, empty page and partial coverage using only safe fields', async t => {
  const f = await fixture(t);
  async function prepared(path: string, body: Json) {
    const response = await f.call('POST', path, body); assert.equal(response.status, 200);
    const matches = f.storage(store => store.read(tx => tx.find('perception_access', { requestId: response.envelope.requestId })));
    assert.equal(matches.length, 1);
    const fact = matches[0]!.data as Json; assert.equal(fact.result.status, 'data_provided');
    assert(fact.result.prepared, 'A committed preparation must describe what was actually prepared');
    return { data: response.data, fact, value: fact.result.prepared as Json };
  }
  const people = await prepared('/overview', { protocolVersion: 1, consumerId: 'observed-people', purpose: 'agent-perception', categoryIds: ['people'] });
  const items = await prepared('/overview', { protocolVersion: 1, consumerId: 'observed-items', purpose: 'agent-perception', categoryIds: ['items'] });
  const allowedMetric = ['metricId', 'status', 'count', 'presence', 'sourceStates', 'sourceCoverage', 'scopeKey', 'contentRevision', 'observedAt', 'freshness'];
  for (const observation of [people, items]) {
    assert.equal(observation.value.kind, 'overview'); assert.equal(observation.value.observationId, observation.data.observationId);
    assert.equal(observation.value.consumerId, observation.data === people.data ? 'observed-people' : 'observed-items');
    assert.deepEqual(observation.value.coverage, observation.data.coverage);
    assert.deepEqual(observation.value.budgetUsed, observation.data.budgetUsed);
    for (const [index, section] of observation.value.sections.entries()) {
      assert.deepEqual(Object.keys(section).sort(), ['categoryId', 'channel', 'resolvedScope', 'metrics'].sort());
      assert.equal(section.categoryId, observation.data.sections[index].categoryId);
      assert.deepEqual(section.resolvedScope, observation.data.sections[index].resolvedScope);
      for (const [metricIndex, metric] of section.metrics.entries()) {
        assert.deepEqual(Object.keys(metric).sort(), [...allowedMetric].sort());
        for (const key of allowedMetric) assert.deepEqual(metric[key], observation.data.sections[index].metrics[metricIndex][key]);
      }
    }
  }
  assert.notEqual(people.value.sections[0].categoryId, items.value.sections[0].categoryId);
  const partial = await prepared('/overview', { protocolVersion: 1, consumerId: 'observed-partial', purpose: 'agent-perception',
    categoryIds: ['items', 'places'], budget: { maxSourceReads: 1 } });
  assert.equal(partial.value.sections[1].metrics[0].status, 'not_requested');
  assert.equal(partial.value.sections[1].metrics[0].count.value, null);
  assert.deepEqual(partial.value.sections[1].metrics[0].sourceCoverage, partial.data.sections[1].metrics[0].sourceCoverage);
  f.storage(store => store.transaction(tx => {
    for (const grant of tx.find('perception_grants', { agentId: f.a.agentId, kind: 'holding' })) {
      assert(tx.update('perception_grants', { ...grant, version: grant.version + 1, data: { ...grant.data, active: false } }, grant.version));
    }
  }));
  const empty = await prepared('/list', requestBase('inventory', { categoryId: 'holdings', limit: 5 }));
  assert.equal(empty.value.kind, 'list'); assert.equal(empty.value.categoryId, 'holdings'); assert.equal(empty.value.channel, 'inventory');
  assert.deepEqual(empty.value.objects, []); assert.deepEqual(empty.value.page, { preparedCount: 0, complete: true });
  assert.deepEqual(empty.value.sourceStates, empty.data.sourceStates); assert.deepEqual(empty.value.scope, empty.data.scope);
  const rows = await f.read('POST', '/list', requestBase('inbox', { categoryId: 'notifications', limit: 5 }));
  const detail = await prepared('/detail', { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref: rows.records.find((row: Json) => row.detailAvailable).ref });
  assert.equal(detail.value.kind, 'detail'); assert.equal(detail.value.version, detail.data.version);
  assert.deepEqual(detail.value.segment, detail.data.segment); assert.equal(detail.value.contentComplete, detail.data.contentComplete);
  function safe(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert(!['body', 'text', 'completionToken', 'contentToken', 'nextContentToken', 'nextPageToken', 'authorization', 'sessionToken', 'runtimeToken', 'email'].includes(key),
        'Preparation history must not retain a body, continuation capability or account credential');
      safe(child);
    }
  }
  for (const record of [people, items, partial, empty, detail]) safe(record.value);
  const profile = await ok(f.m1, 'GET', `/agents/${f.sibling.agentId}/profile`, undefined, f.owner.sessionToken);
  await ok(f.m1, 'POST', `/agents/${f.sibling.agentId}/profile/unpublish`, {
    operationId: randomUUID(), expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion,
  }, f.owner.sessionToken);
  assert.equal(f.metric(await f.overview(undefined, { categoryIds: ['people'] }), 'people', 'agents').count.value, 2);
  const historical = f.storage(store => store.read(tx => tx.get('perception_access', people.fact.recordId)!.data)) as Json;
  assert.deepEqual(historical.result.prepared, people.value, 'Later world changes cannot rewrite the original observed quantities');
  assert.equal(historical.result.prepared.sections[0].metrics.find((metric: Json) => metric.metricId === 'agents').count.value, 3);
});
