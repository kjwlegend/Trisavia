import assert from 'node:assert/strict';
import test from 'node:test';
import type { Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, requestBase } from './helpers.ts';
await test('plan metrics and frozen plan pages remain independent of an unrelated publication source outage', async (t) => {
    const f = await fixture(t), input = requestBase('world', { categoryId: 'events', metricId: 'plans', limit: 1 });
    const first = await f.read('POST', '/list', input);
    assert.equal(first.complete, false);
    for (const state of ['unavailable', 'not_enabled']) {
        await f.storage(async (store) => await store.transaction(async (tx) => {
            const current = (await tx.get('perception_catalog', 'current'))!;
            assert(await tx.update('perception_catalog', { ...current, version: current.version + 1,
                data: { ...current.data, sourceStates: { ...(current.data.sourceStates as Json), 'platform-publications': state } } }, current.version));
        }));
        const overview = await f.overview(undefined, { categoryIds: ['events'] });
        const plans = f.metric(overview, 'events', 'plans'), occurrences = f.metric(overview, 'events', 'occurrences');
        assert.equal(plans.status, 'available');
        assert.equal(plans.count.value, 2);
        assert.equal(occurrences.status, state);
        assert.equal(occurrences.count.value, null);
        const page = await f.read('POST', '/list', { ...input, pageToken: first.nextPageToken });
        assert.equal(page.readSessionId, first.readSessionId);
        assert.equal(page.complete, true);
        assert.equal(page.records.length, 1);
        assert.equal(page.records[0].ref.type, 'world.plan@1');
        assert.deepEqual(page.sourceStates, [{ sourceId: 'demo-events', state: 'enabled' }]);
        const allPlans = await f.listAll({ ...input, limit: 5 });
        assert.equal(allPlans.records.length, 2);
        for (const extra of [{ metricId: 'occurrences' }, {}]) {
            const rejected = await f.call('POST', '/list', requestBase('world', { categoryId: 'events', limit: 5, ...extra }));
            assert.equal(rejected.status, state === 'unavailable' ? 503 : 409);
            assert.equal(rejected.error.code, state === 'unavailable' ? 'source_unavailable' : 'channel_not_enabled');
            assert.equal(rejected.data == null, true, 'Missing selected sources cannot be reported as an empty or complete category');
        }
    }
});
