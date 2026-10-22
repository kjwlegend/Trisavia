import {postgresFixture} from '../api/postgresql-fixture.ts';
import {buildApp} from '../../apps/platform/app.ts';
import {bootstrapPlatformCatalog} from '../../apps/platform/application/bootstrap.ts';
import {injectApi,ok,ownerFixture,agentFixture} from '../../scripts/agent-manager-qa-fixture.ts';
import {installSqlFault,removeSqlFault} from './pg-faults.ts';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { authorizeWs02SeedOwnerObservation, OWNER_OBSERVATION_ID } from '../../apps/platform/application/perception-owner-observation.ts';
import { updatePerceptionDemoObject } from '../../apps/platform/application/perception-admin.ts';
import { initializePerceptionCatalog } from '../../apps/platform/application/perception-catalog.ts';
import { CATEGORIES, OPERATIONS, TYPE_DEFINITIONS, key, refId } from '../../apps/platform/domains/perception/protocol.ts';
import { grantId } from '../../apps/platform/application/perception-seed.ts';
import { runOwnerObservation } from '../../scripts/ws02-owner-observation.ts';
import type { Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, requestBase, type Ref } from './helpers.ts';
const Ajv2020 = createRequire(import.meta.url)('ajv/dist/2020.js').default;
const agentRef = (id: string) => ({ moduleId: 'profiles', type: 'profiles.agent@1', id });
const ownerInput = (id: string, channel = 'inbox', extra: Json = {}): Json => requestBase(channel, { purpose: 'human-inspect', agentRef: agentRef(id), categoryId: channel === 'inbox' ? 'notifications' : 'holdings', ...extra });
const authorize = async (f: Awaited<ReturnType<typeof fixture>>, extra: Json = {}) => await f.storage(async (store) => await authorizeWs02SeedOwnerObservation(store, { actorId: 'isolated-owner-observer-administrator', operationId: randomUUID(), expectedSourceAdministrator: 'isolated-test-administrator', ...extra }));
async function assertFilteredEmpty(f: Awaited<ReturnType<typeof fixture>>) {
    const result = await f.call('POST', '/list', ownerInput(f.a.agentId), f.owner.sessionToken);
    assert.equal(result.status, 200, 'The explicit query-only source declaration permits collection enumeration');
    assert.deepEqual(result.data.records, [], 'Missing or revoked object observation grants no object visibility');
    assert.equal(result.data.complete, true);
    assert.equal(result.data.nextPageToken, null);
}
await test('owner observes actual permitted holdings and all 31 declared notifications without changing content, deliveries or the 27 Agent confirmations', async (t) => {
    const f = await fixture(t, { detailSegmentChars: 256 });
    const message: Ref = { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-09' };
    await f.storage(async (store) => await updatePerceptionDemoObject(store, { actorId: 'isolated-test-administrator', operationId: randomUUID(), ref: message, expectedVersion: 1, body: 'R03 version two preserves the stable message ref. '.repeat(30) }));
    const runtime = await f.listAll(requestBase('inbox', { categoryId: 'notifications', limit: 50 }));
    const confirmations = [message, ...runtime.records.filter(row => row.detailAvailable && row.ref.id !== message.id).slice(0, 2).map(row => row.ref as Ref)];
    for (const ref of confirmations) {
        const complete = await f.detail(ref);
        await f.read('PUT', '/agent-read-state', { protocolVersion: 1, operationId: randomUUID(), ref, contentVersion: complete.final.version, completionToken: complete.final.completionToken });
    }
    assert.equal((await f.unread()).count.value, 27);
    const snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => ({ objects: await tx.find('perception_objects'), grants: await tx.find('perception_grants'), states: await tx.find('perception_states') })));
    const before = await snapshot(), receipt = await authorize(f);
    assert.equal(receipt.registeredNotifications, 31);
    const inbox = await f.listAll(ownerInput(f.a.agentId, 'inbox', { limit: 7 }), f.owner.sessionToken);
    assert.equal(inbox.records.length, 31);
    assert.equal(inbox.records.filter(row => row.detailAvailable).length, 30);
    assert.equal(inbox.records.find(row => row.ref.id === message.id)!.version, 2);
    assert(inbox.records.every(row => !('agentReadState' in row) && !('completionToken' in row)));
    for (const row of inbox.records) {
        if (!row.detailAvailable) {
            assert.equal((await f.call('POST', '/detail', { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref: row.ref }, f.owner.sessionToken)).status, 404);
            continue;
        }
        const body = await f.detail(row.ref, 'inbox', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
        assert(body.segments.every(part => !('agentReadState' in part) && !('completionToken' in part)));
        const source = before.objects.find(object => object.id === refId(row.ref))!;
        assert.equal(body.segments.map(part => part.content.text).join(''), source.data.body);
    }
    const holdings = await f.listAll(ownerInput(f.a.agentId, 'inventory', { limit: 5 }), f.owner.sessionToken);
    assert.equal(holdings.records.length, 14);
    for (const row of holdings.records) {
        assert.equal(row.summary.quantity, 1);
        assert.equal(row.summary.status, 'active');
        assert(row.summary.itemRef);
    }
    assert.deepEqual(await snapshot(), before);
    assert.equal((await f.unread()).count.value, 27);
    const humanFacts = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_access')).filter(row => (row.data.actor as Json)?.kind === 'owner_session')));
    assert(humanFacts.length > 30);
    assert(humanFacts.every(row => row.data.agentId === null && (row.data.result as Json).status === 'human_data_provided'));
    const serialized = JSON.stringify(humanFacts);
    assert(!serialized.includes('R03 version two'));
    assert(!serialized.includes(f.owner.sessionToken));
    assert(!serialized.includes(f.a.runtimeToken));
});
await test('binding alone and demo data do not authorize private notifications; cross owner/runtime selectors and Agent confirmation selectors are rejected', async (t) => {
    const f = await fixture(t), input = ownerInput(f.a.agentId);
    await assertFilteredEmpty(f);
    const ref: Ref = { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-01' };
    const detail = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref };
    assert.equal((await f.call('POST', '/detail', detail, f.owner.sessionToken)).status, 404);
    await authorize(f);
    await f.storage(async (store) => await store.transaction(async (tx) => {
        const original = (await tx.get('perception_objects', refId(ref)))!, privateRef = { ...ref, id: 'private-demo-default-closed' }, objectId = refId(privateRef);
        await tx.insert('perception_objects', { id: objectId, version: 1, data: { ...original.data, ref: privateRef, refId: privateRef.id, title: 'Agent-only private title', body: 'Never disclose this private body', dataMode: 'demo' } });
        await tx.insert('perception_grants', { id: grantId(f.a.agentId, objectId, 'delivery'), version: 1, data: { agentId: f.a.agentId, objectId, kind: 'delivery', active: true } });
    }));
    const all = await f.listAll(input, f.owner.sessionToken);
    assert.equal(all.records.length, 31);
    assert(!JSON.stringify(all).includes('Agent-only'));
    assert.equal((await f.call('POST', '/detail', { ...detail, ref: { ...ref, id: 'private-demo-default-closed' } }, f.owner.sessionToken)).status, 404);
    assert.equal((await f.call('POST', '/list', input, f.otherOwner.sessionToken)).status, 404);
    assert.equal((await f.call('POST', '/list', ownerInput(f.b.agentId), f.owner.sessionToken)).status, 404);
    assert.equal((await f.call('POST', '/list', { ...input, purpose: 'agent-perception' }, f.a.runtimeToken)).status, 403);
    for (const selectors of [{ selection: 'unconfirmed' }, { metricId: 'unconfirmed' }])
        assert.equal((await f.call('POST', '/list', { ...input, ...selectors }, f.owner.sessionToken)).status, 403);
    assert.equal((await f.call('POST', '/overview', { protocolVersion: 1, consumerId: 'human-overview', purpose: 'human-inspect', categoryIds: ['notifications'] }, f.owner.sessionToken)).status, 403);
    const world = await f.read('POST', '/list', requestBase('world', { purpose: 'human-inspect', categoryId: 'items' }), f.owner.sessionToken);
    assert.equal(world.records.length, 14);
    assert.equal((await f.call('POST', '/list', requestBase('world', { purpose: 'human-inspect', categoryId: 'items', agentRef: agentRef(f.a.agentId) }), f.owner.sessionToken)).status, 403);
});
await test('owner pagination and body continuations bind the actual human, selected Agent, current binding, source and audience versions', async (t) => {
    const f = await fixture(t, { detailSegmentChars: 32 });
    await authorize(f);
    const input = ownerInput(f.a.agentId, 'inbox', { limit: 2 }), page = await f.read('POST', '/list', input, f.owner.sessionToken);
    const ref = page.records.find((r: Json) => r.detailAvailable)!.ref;
    const detail = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref };
    const part = await f.read('POST', '/detail', detail, f.owner.sessionToken);
    assert.equal(part.contentComplete, false);
    assert.equal((await f.call('POST', '/list', { ...input, pageToken: page.nextPageToken }, f.otherOwner.sessionToken)).status, 404);
    assert.equal((await f.call('POST', '/list', { ...input, agentRef: agentRef(f.sibling.agentId), pageToken: page.nextPageToken }, f.owner.sessionToken)).status, 409);
    assert.equal((await f.call('POST', '/detail', { ...detail, agentRef: agentRef(f.sibling.agentId), contentToken: part.nextContentToken }, f.owner.sessionToken)).status, 409);
    assert.equal((await f.call('POST', '/detail', { ...detail, consumerId: 'other-consumer', contentToken: part.nextContentToken }, f.owner.sessionToken)).status, 409);
    const binding = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('bindings', { agentId: f.a.agentId, ownerId: f.owner.ownerId, active: true }))[0]!));
    assert(binding);
    await f.storage(async (store) => await store.transaction(async (tx) => await tx.update('bindings', { ...binding, version: binding.version + 1, data: { ...binding.data, active: false } }, binding.version)));
    assert.equal((await f.call('POST', '/list', { ...input, pageToken: page.nextPageToken }, f.owner.sessionToken)).status, 404);
    assert.equal((await f.call('POST', '/detail', { ...detail, contentToken: part.nextContentToken }, f.owner.sessionToken)).status, 404);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('bindings', binding.id))!; await tx.update('bindings', { ...row, version: row.version + 1, data: { ...row.data, active: true } }, row.version); }));
    assert.equal((await f.call('POST', '/list', { ...input, pageToken: page.nextPageToken }, f.owner.sessionToken)).status, 409);
    assert.equal((await f.call('POST', '/detail', { ...detail, contentToken: part.nextContentToken }, f.owner.sessionToken)).status, 409);
    const fresh = await f.read('POST', '/detail', detail, f.owner.sessionToken);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_catalog', OWNER_OBSERVATION_ID))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, layers: { existence: true, summary: true, body: true, attachments: false } } }, row.version); }));
    assert.equal((await f.call('POST', '/detail', { ...detail, contentToken: fresh.nextContentToken }, f.owner.sessionToken)).status, 409);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_catalog', OWNER_OBSERVATION_ID))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version); }));
    await assertFilteredEmpty(f);
    assert.equal((await f.call('POST', '/detail', detail, f.owner.sessionToken)).status, 404);
});
await test('source layer checks keep existence, summary, body and attachments independent, and private item content is not inferred from ownership', async (t) => {
    const f = await fixture(t, { detailSegmentChars: 2000 });
    await authorize(f);
    const ref: Ref = { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-01' };
    const patchLayers = async (layers: Json) => await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_catalog', OWNER_OBSERVATION_ID))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, layers } }, row.version); }));
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_objects', refId(ref)))!; await tx.update('perception_objects', { ...row, version: row.version + 1, data: { ...row.data, body: 'Source authorized body', attachments: [{ name: 'Private attachment', href: 'https://example.invalid/private' }] } }, row.version); }));
    await patchLayers({ existence: true, summary: true, body: false, attachments: false });
    const list = await f.read('POST', '/list', ownerInput(f.a.agentId, 'inbox', { limit: 50 }), f.owner.sessionToken);
    assert(list.records.every((row: Json) => !row.detailAvailable));
    const detail = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref };
    assert.equal((await f.call('POST', '/detail', detail, f.owner.sessionToken)).status, 404);
    await patchLayers({ existence: true, summary: true, body: true, attachments: false });
    const body = await f.read('POST', '/detail', detail, f.owner.sessionToken);
    assert.equal(body.content.text, 'Source authorized body');
    assert.deepEqual(body.attachments, []);
    await patchLayers({ existence: true, summary: false, body: true, attachments: true });
    await assertFilteredEmpty(f);
    assert.equal((await f.call('POST', '/detail', detail, f.owner.sessionToken)).status, 404);
    await patchLayers({ existence: false, summary: true, body: true, attachments: true });
    await assertFilteredEmpty(f);
    const holdings = await f.read('POST', '/list', ownerInput(f.a.agentId, 'inventory', { limit: 2 }), f.owner.sessionToken), holding = holdings.records[0];
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_objects', refId(holding.summary.itemRef)))!; await tx.update('perception_objects', { ...row, version: row.version + 1, data: { ...row.data, public: false, title: 'Private item title', body: 'Private item content' } }, row.version); }));
    const updated = await f.read('POST', '/list', ownerInput(f.a.agentId, 'inventory', { limit: 50 }), f.owner.sessionToken), relation = updated.records.find((r: Json) => r.ref.id === holding.ref.id)!;
    assert.equal((await f.call('POST', '/list', ownerInput(f.a.agentId, 'inventory', { limit: 2, pageToken: holdings.nextPageToken }), f.owner.sessionToken)).status, 409);
    assert.equal(relation.summary.quantity, 1);
    assert.equal(relation.summary.title, '持有记录');
    assert.equal(relation.summary.itemRef, undefined);
    assert.equal((await f.call('POST', '/detail', { ...requestBase('world', { purpose: 'human-inspect' }), ref: holding.summary.itemRef }, f.owner.sessionToken)).status, 404);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_grants', holding.ref.id))!; await tx.update('perception_grants', { ...row, version: row.version + 1, data: { ...row.data, dataMode: 'real', source: { kind: 'source_holding' } } }, row.version); }));
    const real = await f.detail(holding.ref, 'inventory', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
    assert.equal(real.final.content.quantity, 1);
    assert.equal(real.final.content.itemRef, undefined);
    assert.equal(real.final.content.dataMode, 'real');
    assert.equal(real.final.content.source.kind, 'source_holding');
    assert(!real.segments.map(r => r.content.text).join('').includes('示例'));
});
await test('the explicit source declaration is idempotent, preserves source and inactive deliveries/policies, and rolls back on a real receipt/fact SQL fault', async (t) => {
    const f = await fixture(t), options = { operationId: randomUUID() };
    const notification = { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-09' };
    await f.storage(async (store) => await updatePerceptionDemoObject(store, { actorId: 'isolated-test-administrator', operationId: randomUUID(), ref: notification, expectedVersion: 1, body: 'Keep this R03 second version unchanged.' }));
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_grants', grantId(f.a.agentId, refId(notification), 'delivery')))!; await tx.update('perception_grants', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version); }));
    const snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => ({ objects: await tx.find('perception_objects'), grants: await tx.find('perception_grants'), states: await tx.find('perception_states') })));
    const before = await snapshot();
    await assert.rejects(async () => await authorize(f, { expectedSourceAdministrator: 'wrong-administrator' }), { code: 'target_not_accessible' });
    assert.equal(await f.storage(async (store) => await store.read(async (tx) => await tx.get('perception_catalog', OWNER_OBSERVATION_ID))), undefined);
    await installSqlFault(f,'perception_access');
    try {
        await assert.rejects(async () => await authorize(f, options));
        assert.equal(await f.storage(async (store) => await store.read(async (tx) => await tx.get('perception_catalog', OWNER_OBSERVATION_ID))), undefined);
    }
    finally {
        await removeSqlFault(f,'perception_access');
    }
    const receipt = await authorize(f, options);
    assert.deepEqual(await authorize(f, options), receipt);
    assert.equal(receipt.changed, true);
    assert.equal((await authorize(f)).changed, false);
    assert.deepEqual(await snapshot(), before);
    const all = await f.listAll(ownerInput(f.a.agentId), f.owner.sessionToken);
    assert.equal(all.records.length, 30);
    assert(!all.records.some(row => row.ref.id === notification.id));
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_catalog', OWNER_OBSERVATION_ID))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version); }));
    const inactive = await authorize(f);
    assert.equal(inactive.changed, false);
    assert.equal(inactive.active, false);
    await assertFilteredEmpty(f);
    assert.deepEqual(await snapshot(), before);
});
await test('the local CLI checks actor and paired identity before writes, emits an exact receipt and can replay without reseeding', async (t) => {
    const f = await fixture(t), identity = join(f.directory, 'paired.identity.json'), wrong = join(f.directory, 'wrong.identity.json');
    await writeFile(identity, JSON.stringify({ version: 1, instanceId: f.options.instanceId, recoveryEpoch: f.options.recoveryEpoch }),{mode:0o600});
    await writeFile(wrong, JSON.stringify({ version: 1, instanceId: `instance_${randomUUID()}`, recoveryEpoch: f.options.recoveryEpoch }),{mode:0o600});
    const args = (paired: string, manifest: string, actor = 'isolated-cli-administrator') => ['--connection', join(f.privateConnections,'application-database-url'), '--identity', paired, '--operator', actor, '--manifest', manifest, '--source-administrator', 'isolated-test-administrator', '--operation-id', 'isolated-cli-owner-observation-1'];
    const snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => key({ objects: await tx.find('perception_objects'), grants: await tx.find('perception_grants'), states: await tx.find('perception_states'), catalog: await tx.find('perception_catalog'), access: await tx.find('perception_access') })));
    const before = await snapshot(), identityBytes = await readFile(identity);
    await assert.rejects(runOwnerObservation(args(wrong, join(f.directory, 'wrong-must-not-exist.json'))));
    await assert.rejects(runOwnerObservation(args(identity, join(f.directory, 'invalid-must-not-exist.json'), 'invalid actor!')));
    assert.equal(await snapshot(), before);
    assert((await readFile(identity)).equals(identityBytes));
    const canonicalDirectory = await realpath(f.directory);
    const first = await runOwnerObservation(args(identity, join(canonicalDirectory, 'receipt-1.json'))), second = await runOwnerObservation(args(identity, join(canonicalDirectory, 'receipt-2.json')));
    assert.deepEqual(first.receipt, second.receipt);
    assert.equal(first.receipt.registeredNotifications, 31);
    assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'receipt-1.json'), 'utf8')), first.receipt);
    assert((await readFile(identity)).equals(identityBytes));
    const read = await f.read('POST', '/list', ownerInput(f.a.agentId, 'inbox', { limit: 50 }), f.owner.sessionToken);
    assert.equal(read.records.length, 31);
});
await test('an existing schema2 R03 catalog upgrades without recomputing its frozen declaration or changing historical schema/guide bytes', async (t) => {
    const baseline = await fixture(t), pg=await postgresFixture(undefined,{bootstrap:false}), modules = ['perception', 'world', 'profiles', 'items', 'inventory', 'mailbox'];
    let app:Awaited<ReturnType<typeof buildApp>>|undefined;
    t.after(async()=>{if(app)await app.close();await pg.dispose();});
    const current=await baseline.storage(store=>store.read(async tx=>(await tx.get('perception_catalog','current'))!));
    const storage=async <T>(work:(store:typeof pg.store)=>Promise<T>)=>await work(pg.store);
    const legacySchemas = [...OPERATIONS.filter(o => o.id !== 'wallet-query').flatMap(o => [`perception.${o.id}-query`, `perception.${o.id}-result`]), ...TYPE_DEFINITIONS.filter(o => o.type !== 'mailbox.direct-message@1').flatMap(o => [`${o.prefix}-summary`, `${o.prefix}-detail`]), 'perception.error-result'];
    assert.equal(legacySchemas.length, 37); // Preserve all operation/type/error documents, including owner activity schemas.
    await storage(async (store) => await store.transaction(async (tx) => {
        await tx.insert('perception_catalog',{...current,data:{...current.data,seedObjectIds:[]}});
        for (const schemaId of legacySchemas) {
            const document = { ...JSON.parse(JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: schemaId, type: 'object', additionalProperties: false, properties: { legacyVersion: { const: 2 } } })) };
            await tx.insert('perception_catalog', { id: `schema:${schemaId}:2`, version: 1, data: { document, digest: key(document) } });
        }
        for (const version of [1, 2])
            for (const moduleId of modules) {
                const document = { moduleId, version, text: `Frozen R03 guide ${moduleId} v${version}`, http: { authentication: { human: 'Legacy schema2 owner has no private observation' } } };
                await tx.insert('perception_catalog', { id: `guide:${moduleId}:${version}`, version: 1, data: { document, digest: key(document) } });
            }
        // A published legacy declaration has its own historical category text. The
        // newer executable must not reconstruct it from today's CATEGORIES constant.
        const oldCategories = JSON.parse(JSON.stringify(CATEGORIES));
        oldCategories[0].metrics[0].description = 'Historical source-owned wording, frozen before this implementation';
        const declaration = { protocolVersion: 1, schemaVersion: 2, guideVersion: 2, categories: oldCategories };
        await tx.insert('perception_catalog', { id: `catalog-revision:${key('catalog-r03-isolated')}`, version: 1, data: { kind: 'catalog_revision', catalogRevision: 'catalog-r03-isolated', digest: key(declaration) } });
        const row = (await tx.get('perception_catalog', 'current'))!;
        await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, schemaVersion: 2, guideVersion: 2, catalogRevision: 'catalog-r03-isolated', skillCatalogRevision: 'skills-catalog-r03-isolated' } }, row.version);
    }));
    const snapshot = async () => await storage(async (store) => await store.read(async (tx) => (await tx.find('perception_catalog')).filter(row => row.id.endsWith(':2') || row.id.endsWith(':1') || row.id === `catalog-revision:${key('catalog-r03-isolated')}`)));
    const before = await snapshot();
    // Startup is read-only: this historical catalog must be explicitly upgraded first.
    await assert.rejects(buildApp(pg.options),/initialized explicitly/);
    assert.deepEqual(await snapshot(),before);
    await bootstrapPlatformCatalog(pg.store);
    app=await buildApp({...pg.options,email:{mode:'experience'}});
    const api=injectApi(app),owner=await ownerFixture(api,'Legacy'),agent=await agentFixture(api,owner,'目录升级观察者','blue');
    const f={read:async(method:'GET',path:string)=>(await ok(api,method,`/perception${path}`,undefined,agent.runtimeToken)).data};
    assert.deepEqual(await snapshot(), before);
    const discovery = await f.read('GET', '/discovery?limit=50');
    assert.equal(discovery.catalogRevision, 'catalog-r03-isolated-schema-5');
    assert(discovery.operations.every((o: Json) => o.inputSchema.version === 5));
    assert(discovery.modules.every((m: Json) => m.usageGuide.version === 3));
    const old = await f.read('GET', '/guides/world?version=2');
    assert.equal(old.document.text, 'Frozen R03 guide world v2');
    assert.equal(createHash('sha256').update(old.canonicalDocument).digest('hex'), old.digest);
    const guide = await f.read('GET', '/guides/world?version=3');
    assert(JSON.stringify(guide.document).includes('human-inspect'));
    const supportedCurrent = await storage(async (store) => await store.read(async (tx) => (await tx.get('perception_catalog', 'current'))!));
    await storage(async (store) => await store.transaction(async (tx) => await tx.update('perception_catalog', { ...supportedCurrent, version: supportedCurrent.version + 1, data: { ...supportedCurrent.data, schemaVersion: 6 } }, supportedCurrent.version)));
    const protectedCatalog = await storage(async (store) => await store.read(async (tx) => await tx.find('perception_catalog')));
    await assert.rejects(async () => await storage(async (store) => await store.transaction(initializePerceptionCatalog)), { code: 'protocol_unsupported' });
    assert.deepEqual(await storage(async (store) => await store.read(async (tx) => await tx.find('perception_catalog'))), protectedCatalog);
});
await test('HTTP-discovered strict schema5 describes owner target context and validates actual read-only owner responses', async (t) => {
    const f = await fixture(t);
    await authorize(f);
    const directory = await f.read('GET', '/discovery?limit=50', undefined, f.owner.sessionToken), ajv = new Ajv2020({ strict: false, allErrors: true });
    const schemas = new Map<string, any>();
    const validate = async (schemaRef: Json, value: unknown) => {
        const id = `${schemaRef.id}:${schemaRef.version}`;
        if (!schemas.has(id)) {
            const schema = await f.read('GET', `/schemas/${schemaRef.id}?version=${schemaRef.version}`, undefined, f.owner.sessionToken);
            schemas.set(id, ajv.compile(schema.document));
        }
        const run = schemas.get(id);
        assert(run(value), JSON.stringify(run.errors));
    };
    const listOp = directory.operations.find((row: Json) => row.id === 'list'), detailOp = directory.operations.find((row: Json) => row.id === 'detail');
    for (const channel of ['inventory', 'inbox']) {
        const input = ownerInput(f.a.agentId, channel, { limit: 50 });
        await validate(listOp.inputSchema, input);
        const listed = await f.call('POST', '/list', input, f.owner.sessionToken);
        assert.equal(listed.status, 200);
        await validate(listOp.outputSchema, listed.envelope);
        const row = listed.data.records.find((r: Json) => r.detailAvailable);
        await validate(row.schema, row.summary);
        const detail = { ...requestBase(channel, { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref: row.ref };
        await validate(detailOp.inputSchema, detail);
        const result = await f.call('POST', '/detail', detail, f.owner.sessionToken);
        assert.equal(result.status, 200);
        await validate(detailOp.outputSchema, result.envelope);
        await validate(result.data.schema, result.data.content);
    }
    const schema = await f.read('GET', `/schemas/${listOp.inputSchema.id}?version=${listOp.inputSchema.version}`), run = ajv.compile({ ...schema.document, $id: 'owner-schema-negative' });
    const input = ownerInput(f.a.agentId), { agentRef: omitted, ...noTarget } = input;
    assert.equal(run(noTarget), false);
    assert.equal(run({ ...input, unexpected: 'strict' }), false);
    assert.equal(run({ ...input, selection: 'unconfirmed' }), false);
    const capabilities = await f.m1('GET', '/capabilities', undefined, f.owner.sessionToken);
    assert.equal(capabilities.status, 200);
    assert.deepEqual(capabilities.body.perceptionApi?.ownerObservation ?? capabilities.body.data?.perceptionApi?.ownerObservation, { agentRefRequired: true, inventory: true, inbox: 'source-authorized', messages: 'source-authorized', readerState: false, confirmation: false });
});
