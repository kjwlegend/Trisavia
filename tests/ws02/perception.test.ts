import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { publishPerceptionCatalog } from '../../apps/platform/application/perception-catalog.ts';
import { seedWs02DemoData } from '../../apps/platform/application/perception-seed.ts';
import { ok, registrationCommand, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, refKey, requestBase, type Ref } from './helpers.ts';
const inbox = (extra: Json = {}) => requestBase('inbox', { categoryId: 'notifications', limit: 5, ...extra });
const confirmation = (ref: Ref, detail: Json, extra: Json = {}) => ({ protocolVersion: 1,
    operationId: randomUUID(), ref, contentVersion: detail.version, completionToken: detail.completionToken, ...extra });
function noPrivateFields(value: unknown, forbidden: string[]) {
    const text = JSON.stringify(value);
    for (const key of forbidden)
        assert(!text.includes(key), 'The received projection excludes private fields or proof material');
}
await test('overview has bounded category metrics rather than bodies, separates people and events, and all inbox pages remain available after confirmation', async (t) => {
    const f = await fixture(t), view = await f.overview();
    assert.equal(f.metric(view, 'notifications', 'unconfirmed').count.value, 30);
    assert.equal(view.sections.find((row: Json) => row.categoryId === 'items').metrics[0].count.value, 14);
    const humans = f.metric(view, 'people', 'humans'), agents = f.metric(view, 'people', 'agents');
    assert.equal(humans.count.unit, 'public_humans');
    assert.equal(agents.count.unit, 'public_agents');
    assert.equal(humans.count.value, null);
    assert.equal(agents.count.value, 3);
    assert.equal(f.metric(view, 'events', 'plans').count.unit, 'planned_events');
    assert.equal(f.metric(view, 'events', 'occurrences').count.unit, 'occurred_events');
    assert.equal(f.metric(view, 'events', 'plans').count.value, 2);
    const occurrences = await f.listAll(requestBase('world', { categoryId: 'events', metricId: 'occurrences', limit: 5 }));
    assert.equal(f.metric(view, 'events', 'occurrences').count.value, occurrences.records.length);
    assert(occurrences.records.length >= 1, 'Explicitly labeled example occurrences are distinct from plans');
    const publication = occurrences.records.find(row => row.sourceId === 'platform-publications');
    assert(publication);
    const publicationBody = await f.detail(publication.ref, 'world');
    assert.equal(publicationBody.final.content.dataMode, 'platform');
    assert.equal(publicationBody.final.content.publication.actor.kind, 'administrator');
    assert.equal(publicationBody.final.content.publication.actor.id, 'isolated-test-administrator');
    assert(publicationBody.final.content.publication.publishedRefs.length > 0);
    const demonstration = occurrences.records.find(row => row.sourceId === 'demo-events');
    assert(demonstration);
    assert.equal((await f.detail(demonstration.ref, 'world')).final.content.dataMode, 'demo');
    assert.equal(view.checkpoint == null, true);
    noPrivateFields(view, ['completionToken', '"body"', '"records"', f.owner.email, f.owner.ownerId, f.a.runtimeToken]);
    const all = await f.listAll(inbox());
    assert.equal(all.records.length, 31);
    assert.equal(new Set(all.records.map(row => refKey(row.ref))).size, 31);
    assert(all.pages.every(page => page.records.length <= 5));
    assert(all.pages.every(page => page.readSessionId === all.pages[0]!.readSessionId));
    const unread = await f.listAll(inbox({ metricId: 'unconfirmed', selection: 'unconfirmed' }));
    assert.equal(unread.records.length, 30);
    assert(unread.records.every(row => row.detailAvailable));
    const unavailable = all.records.filter(row => !row.detailAvailable);
    assert.equal(unavailable.length, 1);
    assert.equal(unavailable[0]!.unavailableReason, 'content_unavailable');
    assert.equal(unavailable[0]!.agentReadState, null);
    assert.equal((await f.call('POST', '/detail', { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref: unavailable[0]!.ref })).status, 404);
    assert.equal((await f.call('POST', '/agent-read-state/query', { protocolVersion: 1, ref: unavailable[0]!.ref })).status, 404);
    assert.equal((await f.unread()).count.value, 30);
    const tiny = await f.call('POST', '/overview', { protocolVersion: 1, consumerId: 'isolated-http-consumer', purpose: 'agent-perception', budget: { maxResponseBytes: 1 } });
    assert.equal(tiny.error.code, 'budget_too_small');
    assert.equal(tiny.data == null, true, 'A budget failure cannot pretend to be an empty or complete overview');
    const items = await f.listAll(requestBase('world', { categoryId: 'items', limit: 5 }));
    assert.equal(items.records.filter(row => row.summary.itemKind === 'work').length, 6);
    assert.equal(items.records.filter(row => row.summary.itemKind === 'prop').length, 8);
    assert.equal((await f.listAll(requestBase('inventory', { categoryId: 'holdings', limit: 5 }))).records.length, 14);
    const prepared = await f.detail(unread.records[0]!.ref);
    await f.read('PUT', '/agent-read-state', confirmation(unread.records[0]!.ref, prepared.final));
    const again = await f.listAll(inbox());
    assert.equal(again.records.length, 31, 'Omitting metricId and selection still enumerates confirmed messages');
    assert.equal((await f.unread()).count.value, 29);
    await f.storage(async (store) => await store.transaction(async (tx) => {
        const row = (await tx.get('perception_catalog', 'current'))!;
        assert(await tx.update('perception_catalog', { ...row, version: row.version + 1,
            data: { ...row.data, sourceStates: { ...(row.data.sourceStates as Json), 'demo-items': 'unavailable' } } }, row.version));
    }));
    const failedSource = (await f.overview(undefined, { categoryIds: ['items'] })).sections[0].metrics[0];
    assert.equal(failedSource.status, 'unavailable');
    assert.equal(failedSource.count.value, null);
    assert.equal(failedSource.presence, null);
});
await test('thirty confirmable messages permit five summaries, three complete reads and exactly three explicit confirmations', async (t) => {
    const f = await fixture(t, { detailSegmentChars: 32 }), request = inbox({ metricId: 'unconfirmed', selection: 'unconfirmed' });
    const first = await f.read('POST', '/list', request);
    assert.equal(first.records.length, 5);
    assert.equal(first.complete, false);
    assert.equal(first.checkpoint, null);
    assert.equal((await f.unread()).count.value, 30);
    const inputs: Json[] = [];
    for (const row of first.records.slice(0, 3)) {
        const before = await f.queryState(row.ref);
        assert.equal(before.confirmedContentVersion, null);
        const content = await f.detail(row.ref);
        assert.equal(typeof content.final.completionToken, 'string');
        assert.equal((await f.queryState(row.ref)).confirmedContentVersion, null, 'Providing complete content alone is not confirmation');
        inputs.push(confirmation(row.ref, content.final));
    }
    assert.equal((await f.unread()).count.value, 30);
    for (const input of inputs) {
        const committed = await f.read('PUT', '/agent-read-state', input);
        assert.equal(committed.changed, true);
        const replay = await f.read('PUT', '/agent-read-state', input);
        assert.deepEqual(replay, committed);
        const duplicate = await f.read('PUT', '/agent-read-state', { ...input, operationId: randomUUID() });
        assert.equal(duplicate.changed, false);
        assert.equal(duplicate.stateVersion, committed.stateVersion);
    }
    assert.equal((await f.unread()).count.value, 27);
    assert.equal((await f.unread(f.sibling.runtimeToken)).count.value, 30, 'Other Agents, including siblings, have independent confirmations');
    assert.equal((await f.unread(f.b.runtimeToken)).count.value, 30);
    const page = await f.read('POST', '/list', { ...request, pageToken: first.nextPageToken });
    assert.equal(page.readSessionId, first.readSessionId, 'Confirmation does not turn the stable selection into a live offset');
    const all = await f.listAll(inbox());
    assert.equal(all.records.filter(row => row.agentReadState && row.agentReadState.confirmedContentVersion !== null && row.agentReadState.confirmedContentVersion === row.agentReadState.currentContentVersion).length, 3);
    // No snapshot/checkpoint submission is involved in either list or confirmation.
    assert(all.pages.every(item => item.checkpoint === null));
});
await test('completed confirmations replay before expiry checks, current reads detect new content and same-version regrant preserves state', async (t) => {
    const f = await fixture(t, { completionTtlMs: 1000 }), rows = await f.listAll(inbox({ selection: 'unconfirmed' }));
    const ref = rows.records[0]!.ref as Ref, content = await f.detail(ref), input = confirmation(ref, content.final);
    const committed = await f.read('PUT', '/agent-read-state', input);
    f.advance(2000);
    assert.deepEqual(await f.read('PUT', '/agent-read-state', input), committed, 'The exact prior command survives completion proof expiry');
    const expired = await f.call('PUT', '/agent-read-state', { ...input, operationId: randomUUID() });
    assert.equal(expired.status, 410);
    assert.equal(expired.error.code, 'completion_expired');
    const receipt = await ok(f.m1, 'GET', `/operations/${input.operationId}?${new URLSearchParams({ scope: `perception-agent:${f.a.agentId}`, action: 'confirmAgentRead' })}`, undefined, f.a.runtimeToken);
    assert.equal(receipt.operationId, input.operationId);
    const object = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_objects')).find(row => refKey(row.data.ref as unknown as Ref) === refKey(ref))));
    assert(object);
    const grant = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_grants', { agentId: f.a.agentId, objectId: object.id }))[0]));
    assert(grant);
    const setGrant = async (active: boolean) => await f.storage(async (store) => await store.transaction(async (tx) => {
        const current = (await tx.get('perception_grants', grant.id))!;
        assert(await tx.update('perception_grants', { ...current, version: current.version + 1, data: { ...current.data, active } }, current.version));
    }));
    await setGrant(false);
    assert.equal((await f.call('POST', '/agent-read-state/query', { protocolVersion: 1, ref })).status, 404);
    assert.equal((await f.call('PUT', '/agent-read-state', input)).status, 404);
    assert.equal((await f.unread()).count.value, 29);
    await setGrant(true);
    assert.equal((await f.queryState(ref)).confirmedContentVersion, content.final.version);
    assert.equal((await f.unread()).count.value, 29);
    const before = await f.overview(undefined, { categoryIds: ['notifications'] });
    const oldMetric = f.metric(before, 'notifications', 'unconfirmed');
    await f.storage(async (store) => await store.transaction(async (tx) => {
        const current = (await tx.get('perception_objects', object.id))!;
        assert(await tx.update('perception_objects', { ...current, version: current.version + 1,
            data: { ...current.data, body: 'A new body version, with the same number of source objects.' } }, current.version));
    }));
    const after = await f.overview(undefined, { categoryIds: ['notifications'], knownContentRevisions: [{ categoryId: 'notifications', metricId: 'unconfirmed', scopeKey: oldMetric.scopeKey, revision: oldMetric.contentRevision }] });
    assert.equal(f.metric(after, 'notifications', 'unconfirmed').contentChanged, true);
    assert.equal((await f.unread()).count.value, 30);
    assert.equal((await f.queryState(ref)).confirmedContentVersion, content.final.version);
    assert.deepEqual(await f.read('PUT', '/agent-read-state', input), committed, 'A historical result does not erase the newer unconfirmed version');
    assert.equal((await f.unread()).count.value, 30);
});
await test('seed is idempotent, preserves source edits and inactive grants, and later registrations receive the same source set exactly once', async (t) => {
    const f = await fixture(t);
    assert.equal(f.manifest.counts.deduplicatedObjects, f.manifest.objects.length);
    assert.equal(new Set(f.manifest.objects.map((row: Json) => refKey(row.ref))).size, f.manifest.objects.length);
    assert.deepEqual(f.manifest.counts.items, { works: 6, props: 8 });
    assert.equal(f.manifest.counts.demonstrationOccurrences, 1);
    assert.equal(f.manifest.counts.administrativePublications, 1);
    assert.equal(f.manifest.objects.filter((row: Json) => row.sourceId === 'profiles-public').length, 3);
    const agentManifest = f.manifest.agents.find((row: Json) => row.agentId === f.a.agentId);
    assert(agentManifest);
    assert.equal(agentManifest.holdingRecords.length, 14);
    assert.equal(agentManifest.deliveryRecords.length, 31);
    assert.equal(agentManifest.deliveryRecords.filter((row: Json) => row.detailAvailable).length, 30);
    const object = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_objects')).find(row => row.data.sourceId === 'demo-items')));
    assert(object);
    const beforeView = await f.overview(undefined, { categoryIds: ['items'] });
    const beforeMetric = beforeView.sections[0].metrics[0];
    const inactive = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_grants', { agentId: f.a.agentId, objectId: object.id }))[0]));
    assert(inactive);
    await f.storage(async (store) => await store.transaction(async (tx) => {
        assert(await tx.update('perception_objects', { ...object, version: object.version + 1, data: { ...object.data, title: 'Administrator retained edit' } }, object.version));
        assert(await tx.update('perception_grants', { ...inactive, version: inactive.version + 1, data: { ...inactive.data, active: false } }, inactive.version));
    }));
    const changedView = await f.overview(undefined, { categoryIds: ['items'], knownContentRevisions: [{ categoryId: 'items', metricId: beforeMetric.metricId,
                scopeKey: beforeMetric.scopeKey, revision: beforeMetric.contentRevision }] });
    assert.equal(changedView.sections[0].metrics[0].count.value, beforeMetric.count.value);
    assert.equal(changedView.sections[0].metrics[0].contentChanged, true, 'Equal counts do not hide a changed public source body/version');
    const before = await f.storage(async (store) => await store.read(async (tx) => ({ objects: (await tx.find('perception_objects')).length, grants: (await tx.find('perception_grants')).length })));
    const second: Json = await f.storage(async (store) => await seedWs02DemoData(store, { actorId: 'isolated-test-administrator' }));
    const after = await f.storage(async (store) => await store.read(async (tx) => ({ objects: (await tx.find('perception_objects')).length, grants: (await tx.find('perception_grants')).length,
        title: (await tx.get('perception_objects', object.id))!.data.title })));
    assert.equal(after.objects, before.objects);
    assert.equal(after.grants, before.grants);
    assert.equal(after.title, 'Administrator retained edit');
    assert.equal(await f.storage(async (store) => await store.read(async (tx) => (await tx.get('perception_grants', inactive.id))!.data.active)), false, 'Seeding does not reopen a revoked holding');
    assert.equal(second.counts.deduplicatedObjects, f.manifest.counts.deduplicatedObjects);
    const command = registrationCommand(), created = await ok(f.m1, 'POST', '/registrations', command);
    assert.equal((await f.unread(command.runtimeToken)).count.value, 30);
    assert.deepEqual(await ok(f.m1, 'POST', '/registrations', command), created);
    const repeated: Json = await f.storage(async (store) => await seedWs02DemoData(store, { actorId: 'isolated-test-administrator' }));
    const entry = repeated.agents.find((row: Json) => row.agentId === created.agentId);
    assert(entry);
    assert.equal(entry.deliveries, 31);
    assert.equal(entry.readableMessages, 30);
    assert.equal(entry.holdings, 14);
    await f.restart();
    assert.equal((await f.unread(command.runtimeToken)).count.value, 30);
});
await test('versioned catalog guides keep prior versions readable and a partial directory cannot be mistaken for a complete new baseline', async (t) => {
    const f = await fixture(t), before = await f.read('GET', '/discovery?limit=1');
    assert.equal(before.complete, false);
    assert.equal(typeof before.nextPageToken, 'string');
    const collections = ['worlds', 'modules', 'types', 'sources', 'categories', 'skills', 'operations'];
    const catalog: Json = Object.fromEntries(collections.map(name => [name, []]));
    let page = before;
    for (let n = 0; n < 100; n++) {
        assert.equal(page.catalogRevision, before.catalogRevision);
        assert.equal(page.skillCatalogRevision, before.skillCatalogRevision);
        assert(collections.reduce((total, name) => total + page[name].length, 0) <= 1, 'Discovery honors its requested per-page bound');
        for (const name of collections)
            catalog[name].push(...page[name]);
        if (page.complete) {
            assert.equal(page.nextPageToken, null);
            break;
        }
        page = await f.read('GET', `/discovery?limit=1&pageToken=${encodeURIComponent(page.nextPageToken)}`);
        assert(n < 99, 'The bounded directory must reach a proved final page');
    }
    assert.equal(new Set(catalog.operations.map((operation: Json) => operation.id)).size, catalog.operations.length);
    const requirements: Record<string, string[]> = { overview: ['protocolVersion', 'consumerId', 'purpose'],
        list: ['protocolVersion', 'consumerId', 'purpose', 'channel', 'categoryId'],
        detail: ['protocolVersion', 'consumerId', 'purpose', 'channel', 'ref'],
        'agent-read-state-query': ['protocolVersion', 'ref'],
        'agent-read-state-confirm': ['protocolVersion', 'operationId', 'ref', 'contentVersion', 'completionToken'] };
    assert(!catalog.operations.some((row: Json) => row.id === 'activity-query'), 'Runtime discovery does not grant owner history access');
    assert(!catalog.operations.some((row: Json) => ['updateDemoObject', 'publishGuide', 'seedWs02DemoData'].includes(row.id)), 'Administrative process helpers are not Agent capabilities');
    for (const [id, fields] of Object.entries(requirements)) {
        const operation = catalog.operations.find((row: Json) => row.id === id);
        assert(operation, `A published operation resolves ${id}`);
        assert(operation.path.startsWith('/v1/perception/'));
        const schema = await f.read('GET', `/schemas/${encodeURIComponent(operation.inputSchema.id)}?version=${operation.inputSchema.version}`);
        assert.equal(schema.document.additionalProperties, false, 'Public input schemas are exact contracts, not protocol-only placeholders');
        for (const field of fields) {
            assert(schema.document.properties[field], `The public schema defines ${id}.${field}`);
            assert(schema.document.required.includes(field), `The public schema identifies required ${id}.${field}`);
        }
    }
    const human = await f.read('GET', '/discovery?limit=50', undefined, f.owner.sessionToken);
    assert.equal(human.complete, true);
    assert(!human.operations.some((row: Json) => row.id === 'agent-read-state-confirm'));
    assert(!human.operations.some((row: Json) => ['updateDemoObject', 'publishGuide', 'seedWs02DemoData'].includes(row.id)), 'Owner sessions do not grant administrative publication');
    const activity = human.operations.find((row: Json) => row.id === 'activity-query');
    assert(activity);
    const activitySchema = await f.read('GET', `/schemas/${encodeURIComponent(activity.inputSchema.id)}?version=${activity.inputSchema.version}`, undefined, f.owner.sessionToken);
    assert.equal(activitySchema.document.additionalProperties, false);
    assert(activitySchema.document.required.includes('agentRef'));
    const guide1 = await f.read('GET', '/guides/world?version=1');
    for (const field of ['protocolVersion', 'consumerId', 'contentToken', 'completionToken', 'operationId']) {
        assert(JSON.stringify(guide1.document).includes(field), `A reader without source code can find ${field} in the public guide`);
    }
    await f.storage(async (store) => await publishPerceptionCatalog(store, { revision: 'isolated-catalog-2', guideVersion: 2, guideText: 'New reviewed manual guide, version two.' }));
    const overview = await f.overview(undefined, { knownCatalogRevision: before.catalogRevision, knownSkillCatalogRevision: before.skillCatalogRevision });
    assert.equal(overview.catalogChanged, true);
    assert.equal(overview.skillsChanged, true);
    assert.deepEqual(await f.read('GET', '/guides/world?version=1'), guide1);
    const guide2 = await f.read('GET', '/guides/world?version=2');
    assert.notDeepEqual(guide2, guide1);
    const stale = await f.call('GET', `/discovery?limit=1&pageToken=${encodeURIComponent(before.nextPageToken)}`);
    assert.equal(stale.status, 409);
});
await test('private grants, completion proof identity and full same-version segment chains cannot be replaced by public IDs or another Agent', async (t) => {
    const f = await fixture(t, { detailSegmentChars: 32 }), first = await f.read('POST', '/list', inbox({ selection: 'unconfirmed' }));
    const ref = first.records[0].ref as Ref;
    const object = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_objects')).find(row => refKey(row.data.ref as unknown as Ref) === refKey(ref))));
    assert(object);
    await f.storage(async (store) => await store.transaction(async (tx) => {
        const current = (await tx.get('perception_objects', object.id))!;
        assert(await tx.update('perception_objects', { ...current, version: current.version + 1,
            data: { ...current.data, body: 'A deliberately long private message segment. '.repeat(20) } }, current.version));
        const grants = await tx.find('perception_grants', { objectId: object.id });
        for (const row of grants.filter(row => row.data.agentId !== f.a.agentId)) {
            assert(await tx.update('perception_grants', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version));
        }
    }));
    const input = { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref };
    assert.equal((await f.call('POST', '/detail', input, null)).status, 401);
    assert.equal((await f.call('POST', '/detail', input, f.owner.sessionToken)).status, 403);
    for (const token of [f.sibling.runtimeToken, f.b.runtimeToken]) {
        const denied = await f.call('POST', '/detail', input, token);
        assert.equal(denied.status, 404);
        assert.equal(denied.error.code, 'target_not_accessible');
        assert.equal((await f.call('POST', '/agent-read-state/query', { protocolVersion: 1, ref }, token)).status, 404);
    }
    const partial = await f.read('POST', '/detail', input);
    assert.equal(partial.contentComplete, false);
    assert.equal(partial.completionToken == null, true);
    assert.equal((await f.queryState(ref)).confirmedContentVersion, null);
    const mismatched = await f.call('POST', '/detail', { ...input, consumerId: 'another-consumer', contentToken: partial.nextContentToken });
    assert.equal(mismatched.status >= 400 && mismatched.status < 500, true, 'A segment token is not a generic body shortcut');
    const complete = await f.detail(ref);
    assert(complete.segments.length > 1);
    assert(complete.segments.slice(0, -1).every(part => part.completionToken == null));
    const changed = await f.read('PUT', '/agent-read-state', confirmation(ref, complete.final));
    assert.equal(changed.changed, true);
    assert.equal((await f.unread()).count.value, 29);
    noPrivateFields(await f.overview(f.b.runtimeToken), [object.id, 'A deliberately long private message segment.', f.a.runtimeToken]);
});
await test('owner activity exposes only currently authorized public outcomes, distinguishes data preparation and never promotes inbox reading into confirmation', async (t) => {
    const f = await fixture(t), privateList = await f.read('POST', '/list', inbox({ selection: 'unconfirmed' }));
    const privateRef = privateList.records[0].ref as Ref;
    await f.detail(privateRef);
    const items = await f.listAll(requestBase('world', { categoryId: 'items', limit: 5 }));
    const publicRef = items.records[0]!.ref as Ref;
    await f.detail(publicRef, 'world', f.a.runtimeToken, { decision: { summary: 'Inspect the selected public object.' } });
    assert.equal((await f.unread()).count.value, 30);
    const query = { protocolVersion: 1, agentRef: { moduleId: 'profiles', type: 'profiles.agent@1', id: f.a.agentId }, limit: 50 };
    const history = await f.read('POST', '/activity/query', query, f.owner.sessionToken);
    assert(history.historyCoverage && typeof history.historyCoverage.complete === 'boolean');
    assert(history.records.length > 0);
    const serialized = JSON.stringify(history);
    assert(serialized.includes('data_provided'), 'The history labels server-prepared data rather than inventing received or understood state');
    assert(!serialized.includes('agent_confirmed'));
    noPrivateFields(history, [privateRef.id, f.owner.email, f.owner.password, f.owner.sessionToken, f.a.runtimeToken, 'completionToken']);
    const foreign = await f.call('POST', '/activity/query', query, f.otherOwner.sessionToken);
    assert.equal(foreign.status, 404);
    assert.equal((await f.call('POST', '/activity/query', query, f.a.runtimeToken)).status, 403);
    const object = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_objects')).find(row => refKey(row.data.ref as unknown as Ref) === refKey(publicRef))));
    assert(object);
    await f.storage(async (store) => await store.transaction(async (tx) => {
        assert(await tx.update('perception_objects', { ...object, version: object.version + 1, data: { ...object.data, public: false } }, object.version));
    }));
    noPrivateFields(await f.read('POST', '/activity/query', query, f.owner.sessionToken), [publicRef.id, privateRef.id]);
});
