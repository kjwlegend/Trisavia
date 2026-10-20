import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { buildApp } from '../../apps/platform/app.ts';
import { verifyApplicationReadiness } from '../../apps/platform/application/bootstrap.ts';
import { createM1Service } from '../../apps/platform/application/m1-service.ts';
import { publishImplementedPerceptionReaders } from '../../apps/platform/application/perception-admin.ts';
import { OWNER_NOTIFICATION_COLLECTION_QUERY_ID } from '../../apps/platform/application/perception-collection-query.ts';
import { authorizeWs02SeedOwnerObservation, OWNER_OBSERVATION_ID } from '../../apps/platform/application/perception-owner-observation.ts';
import { M1_TABLES, type M1ReadSession, type M1Store } from '../../apps/platform/contracts/store.ts';
import { key, refId } from '../../apps/platform/domains/perception/protocol.ts';
import { agentFixture, injectApi, ownerFixture, type Api, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { runImplementedReaders } from '../../scripts/ws02-implemented-readers.ts';
import { postgresFixture } from '../api/postgresql-fixture.ts';
import { gatewayFixture } from '../gateway/postgresql-fixture.ts';
import { fixture, requestBase } from './helpers.ts';
import { installSqlFault, removeSqlFault } from './pg-faults.ts';

const readerSources = ['holdings', 'demo-items', 'direct-messages', 'direct-mail', 'demo-announcements', 'demo-events', 'platform-publications'];
const agentRef = (id: string) => ({ moduleId: 'profiles', type: 'profiles.agent@1', id });
const input = (id: string, extra: Json = {}) => requestBase('inbox', { purpose: 'human-inspect', agentRef: agentRef(id), categoryId: 'notifications', ...extra });
async function tableDigest(tx: M1ReadSession, exclude: readonly string[] = []) {
    const rows = [];
    for (const table of M1_TABLES) if (!exclude.includes(table)) rows.push([table, await tx.find(table)]);
    return key(rows);
}
const snapshot = async (store: M1Store) => await store.read(tx => tableDigest(tx));
const businessDigest = (tx: M1ReadSession) => tableDigest(tx, ['perception_catalog', 'perception_access', 'perception_sessions']);
async function legacyDefault(store: M1Store, unavailable = false) {
    await store.transaction(async tx => {
        const current = (await tx.get('perception_catalog', 'current'))!;
        const sourceStates = { ...(current.data.sourceStates as Json) };
        for (const id of readerSources) if (id !== 'direct-messages') sourceStates[id] = 'not_enabled';
        if (unavailable) sourceStates['demo-items'] = 'unavailable';
        sourceStates['demo-places'] = 'not_enabled';
        await tx.update('perception_catalog', { ...current, version: current.version + 1, data: { ...current.data, catalogRevision: 'catalog-1', skillCatalogRevision: 'skills-1', guideVersion: 1, sourceStates } }, current.version);
        const query = await tx.get('perception_catalog', OWNER_NOTIFICATION_COLLECTION_QUERY_ID);
        if (query) await tx.remove('perception_catalog', query.id, query.version);
    });
}
const publication = (store: M1Store) => ({ actorId: 'isolated-reader-maintainer', operationId: randomUUID(), expectedInstanceId: store.instanceId, expectedRecoveryEpoch: store.recoveryEpoch, expectedCatalogRevision: 'catalog-1', revision: 'reviewed-readers-isolated-3', guideVersion: 3 });

await test('fresh explicit bootstrap discovers implemented readers and normal bound Owner HTTP returns authorized empty collections without demo seed', async (t) => {
    const pg = await postgresFixture();
    const app = await buildApp({ ...pg.options, email: { mode: 'experience' } });
    t.after(async () => { try { await app.close(); } finally { await pg.dispose(); } });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const api: Api = async (method, path, body, token) => {
        const response = await fetch(`${origin}/v1${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() as Json };
    };
    const owner = await ownerFixture(api, 'FreshReaders');
    const agent = await agentFixture(api, owner, '无演示的真实隔离角色', 'blue');
    const sibling = await agentFixture(api, owner, '同主第二角色', 'coral');
    const other = await ownerFixture(api, 'OtherReaders'), third = await agentFixture(api, other, '无关第三角色', 'cream');
    const directory = await api('GET', '/perception/discovery?limit=50', undefined, owner.sessionToken);
    assert.equal(directory.status, 200);
    for (const id of readerSources)
        assert.equal(directory.body.data.sources.find((source: Json) => source.sourceId === id)?.state, 'enabled', id);
    assert.equal(directory.body.data.sources.find((source: Json) => source.sourceId === 'demo-places').state, 'not_enabled', 'Unrequested sources are not activated');
    const document = await api('GET', `/perception/guides/mailbox?version=${directory.body.data.modules.find((module: Json) => module.moduleId === 'mailbox').usageGuide.version}`, undefined, owner.sessionToken);
    const declaration = document.body.data.document.sourceDeclarations[0];
    assert.equal(declaration.declarationVersion, 1);
    assert.equal(declaration.declaredBy.version, 1);
    assert.equal(declaration.active, true);
    assert.equal(declaration.audience, 'current_bound_owner');
    assert.equal(declaration.channel, 'inbox');
    assert.equal(declaration.categoryId, 'notifications');
    assert.deepEqual(declaration.operations, ['list']);
    assert.equal(declaration.subject, 'currently-bound-selected-agent');
    assert.equal(declaration.objectLayersGranted, false);
    for (const [channel, categoryId] of [['inventory', 'holdings'], ['inbox', 'messages'], ['inbox', 'notifications'], ['world', 'announcements'], ['world', 'events']]) {
        const result = await api('POST', '/perception/list', { protocolVersion: 1, consumerId: 'fresh-owner-reader', purpose: 'human-inspect', channel, categoryId, limit: 50, ...(channel !== 'world' ? { agentRef: agentRef(agent.agentId) } : {}) }, owner.sessionToken);
        assert.equal(result.status, 200, categoryId);
        assert.deepEqual(result.body.data.records, [], categoryId);
        assert.equal(result.body.data.complete, true, categoryId);
        assert.equal(result.body.data.nextPageToken, null, categoryId);
    }
    const wallet = await api('POST', '/wallet/query', { protocolVersion: 1, consumerId: 'fresh-owner-reader', purpose: 'human-inspect', agentRef: agentRef(agent.agentId) }, owner.sessionToken);
    assert.equal(wallet.status, 200);
    assert.equal(wallet.body.data.balance, 0);
    assert.equal(wallet.body.data.source.kind, 'account_initialization');
    assert.equal((await api('POST', '/perception/list', input(sibling.agentId), owner.sessionToken)).status, 200);
    assert.equal((await api('POST', '/perception/list', input(third.agentId), owner.sessionToken)).status, 404);
    assert.equal((await api('POST', '/perception/list', input(agent.agentId), other.sessionToken)).status, 404);
    const beforeReads = await snapshot(pg.store);
    await api('POST', '/wallet/query', { protocolVersion: 1, consumerId: 'fresh-owner-reader', purpose: 'human-inspect', agentRef: agentRef(agent.agentId) }, owner.sessionToken);
    assert.equal(await snapshot(pg.store), beforeReads, 'Wallet remains a pure read');
    const rows = await pg.store.read(async tx => ({ objects: await tx.find('perception_objects'), grants: await tx.find('perception_grants'), states: await tx.find('perception_states'), messages: await tx.find('mailbox_messages'), receipts: await tx.find('mailbox_receipts'), current: await tx.get('perception_catalog', 'current') }));
    assert.deepEqual(rows.current!.data.seedObjectIds, []);
    assert.equal(rows.objects.length, 1, 'Only the pre-existing platform reading rules are bootstrapped');
    for (const name of ['grants', 'states', 'messages', 'receipts'] as const) assert.equal(rows[name].length, 0, name);
    const beforeRepeatedReads = await pg.store.read(async tx => key({ catalog: await tx.find('perception_catalog'), accounts: await tx.find('wallet_accounts') }));
    for (let n = 0; n < 2; n++) assert.equal((await api('POST', '/perception/list', input(agent.agentId), owner.sessionToken)).status, 200);
    assert.equal(await pg.store.read(async tx => key({ catalog: await tx.find('perception_catalog'), accounts: await tx.find('wallet_accounts') })), beforeRepeatedReads);
});

await test('collection permission exposes neither Agent-only notifications nor private real messages and does not change the Agent read state', async (t) => {
    let recipient: string;
    const source = { sourceId: 'isolated-query-only-upstream',
        async authenticate(_tx: unknown, context: unknown, authenticate: any) { const credential = await authenticate(_tx, (context as Json).token, ['runtime']); return { kind: 'agent' as const, ref: agentRef(String(credential.data.agentId)) }; },
        async authorizeRecipient(_tx: unknown, _actor: unknown, target: string) { return target === recipient; },
    };
    const f = await fixture(t, { mailboxSources: [source] }); recipient = f.a.agentId;
    const beforeStates = await f.storage(store => store.read(async tx => key(await tx.find('perception_states'))));
    const hidden = await f.read('POST', '/list', input(f.a.agentId), f.owner.sessionToken);
    assert.deepEqual(hidden.records, []);
    assert.equal(hidden.complete, true);
    assert.equal(hidden.nextPageToken, null);
    assert.equal(hidden.checkpoint, null);
    for (const field of ['filtered', 'skipped', 'count', 'hasMore', 'offset']) assert.equal(hidden[field], undefined);
    assert(!JSON.stringify(hidden).includes('test-message'));
    assert.equal((await f.listAll(requestBase('inbox', { categoryId: 'notifications' }))).records.length, 31, 'Agent delivery reading remains unchanged');
    const message = await f.storage(store => createM1Service(store, { now: () => Date.UTC(2026, 9, 20), perception: { mailboxSources: [source] } }).receiveTrustedMessage(source.sourceId, { sourceMessageKey: 'query-only-private-real-message', recipientAgentId: recipient, title: 'Do not expose this sender/title', body: 'Do not expose this original private body', attachments: [{ name: 'Do not expose attachment' }] }, { token: f.sibling.runtimeToken }));
    const messages = await f.read('POST', '/list', input(recipient, { categoryId: 'messages' }), f.owner.sessionToken);
    assert.deepEqual(messages.records, []);
    assert.equal(messages.complete, true);
    assert.equal(messages.nextPageToken, null);
    assert.equal((await f.read('POST', '/list', requestBase('inbox', { categoryId: 'messages' }))).records.length, 1);
    const refs = [{ moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-01' }, message.ref as { moduleId: string; type: string; id: string }, { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'unknown-ref' }];
    for (const ref of refs) {
        const result = await f.call('POST', '/detail', { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(recipient), ref }, f.owner.sessionToken);
        assert.equal(result.status, 404);
        assert.equal(result.error.code, 'target_not_accessible');
        assert(!JSON.stringify(result.envelope).includes(ref.id));
    }
    assert.equal(await f.storage(store => store.read(async tx => key(await tx.find('perception_states')))), beforeStates);
});

await test('mixed permitted summaries and Agent-only deliveries paginate only visible records, with independent body and attachment authorization', async (t) => {
    const f = await fixture(t);
    await f.storage(store => authorizeWs02SeedOwnerObservation(store, { actorId: 'isolated-owner-observer', operationId: randomUUID(), expectedSourceAdministrator: 'isolated-test-administrator' }));
    const refs = ['test-message-01', 'test-message-02'].map(id => ({ moduleId: 'mailbox', type: 'mailbox.message@1', id }));
    await f.storage(store => store.transaction(async tx => {
        const policy = (await tx.get('perception_catalog', OWNER_OBSERVATION_ID))!;
        await tx.update('perception_catalog', { ...policy, version: policy.version + 1, data: { ...policy.data, objectIds: refs.map(refId), layers: { existence: true, summary: true, body: false, attachments: false } } }, policy.version);
        const object = (await tx.get('perception_objects', refId(refs[0]!)))!;
        await tx.update('perception_objects', { ...object, version: object.version + 1, data: { ...object.data, attachments: [{ name: 'Hidden attachment', href: 'https://example.invalid/not-authorized' }] } }, object.version);
    }));
    const first = await f.read('POST', '/list', input(f.a.agentId, { limit: 1 }), f.owner.sessionToken);
    const second = await f.read('POST', '/list', input(f.a.agentId, { limit: 1, pageToken: first.nextPageToken }), f.owner.sessionToken);
    assert.equal(first.records.length, 1);
    assert.equal(first.complete, false);
    assert.equal(second.records.length, 1);
    assert.equal(second.complete, true);
    assert.equal(second.nextPageToken, null);
    assert.deepEqual([...first.records, ...second.records].map(record => record.ref.id).sort(), refs.map(ref => ref.id).sort());
    assert([...first.records, ...second.records].every(record => record.detailAvailable === false && !('agentReadState' in record)));
    assert(!JSON.stringify([first, second]).includes('test-message-03'));
    assert(!JSON.stringify([first, second]).includes('Hidden attachment'));
    const detail = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref: refs[0] };
    assert.equal((await f.call('POST', '/detail', detail, f.owner.sessionToken)).status, 404);
    await f.storage(store => store.transaction(async tx => { const policy = (await tx.get('perception_catalog', OWNER_OBSERVATION_ID))!; await tx.update('perception_catalog', { ...policy, version: policy.version + 1, data: { ...policy.data, layers: { existence: true, summary: true, body: true, attachments: false } } }, policy.version); }));
    assert.equal((await f.call('POST', '/list', input(f.a.agentId, { limit: 1, pageToken: first.nextPageToken }), f.owner.sessionToken)).status, 409);
    const body = await f.detail(refs[0]!, 'inbox', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
    assert(body.segments.every(part => part.attachments.length === 0 && !('completionToken' in part)));
    assert(!JSON.stringify(body).includes('Hidden attachment'));
    assert.equal((await f.listAll(requestBase('inbox', { categoryId: 'notifications' }))).records.length, 31);
});

await test('missing/revoked query permission stays denied; source failure stays explicit and query-policy versions fence old authorized pagination', async (t) => {
    const f = await fixture(t);
    await f.storage(store => authorizeWs02SeedOwnerObservation(store, { actorId: 'isolated-owner-observer', operationId: randomUUID(), expectedSourceAdministrator: 'isolated-test-administrator' }));
    const request = input(f.a.agentId, { limit: 1 }), page = await f.read('POST', '/list', request, f.owner.sessionToken);
    assert.equal(page.records.length, 1);
    assert(page.nextPageToken);
    const patch = async (active: boolean) => await f.storage(store => store.transaction(async tx => { const row = (await tx.get('perception_catalog', OWNER_NOTIFICATION_COLLECTION_QUERY_ID))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, active } }, row.version); }));
    await patch(false);
    const denied = await f.call('POST', '/list', request, f.owner.sessionToken);
    assert.equal(denied.status, 403);
    assert.equal(denied.error.code, 'insufficient_scope');
    await patch(true);
    assert.equal((await f.call('POST', '/list', { ...request, pageToken: page.nextPageToken }, f.owner.sessionToken)).status, 409);
    assert.equal((await f.call('POST', '/list', { ...request, agentRef: agentRef(f.sibling.agentId), pageToken: page.nextPageToken }, f.owner.sessionToken)).status, 409);
    for (const [state, status, code] of [['not_enabled', 409, 'channel_not_enabled'], ['unavailable', 503, 'source_unavailable']] as const) {
        await f.storage(store => store.transaction(async tx => { const row = (await tx.get('perception_catalog', 'current'))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, sourceStates: { ...(row.data.sourceStates as Json), 'direct-mail': state } } }, row.version); }));
        const result = await f.call('POST', '/list', request, f.owner.sessionToken);
        assert.equal(result.status, status);
        assert.equal(result.error.code, code);
    }
    await f.storage(store => store.transaction(async tx => { const row = (await tx.get('perception_catalog', OWNER_NOTIFICATION_COLLECTION_QUERY_ID))!; await tx.remove('perception_catalog', row.id, row.version); }));
    assert.equal((await f.call('POST', '/list', request, f.owner.sessionToken)).status, 403);
});

await test('the explicit publication CLI checks target/actor/baseline, preserves old exact documents and all business rows, atomically publishes and replays', async (t) => {
    const f = await fixture(t);
    await f.storage(legacyDefault);
    const state = await f.storage(store => store.read(async tx => ({ catalog: await tx.find('perception_catalog'), business: await businessDigest(tx) })));
    const directory = await realpath(f.directory), options = await f.storage(async store => publication(store));
    const args = (manifest: string, extra: Json = {}) => {
        const selected = { ...options, ...extra };
        return ['--connection', join(f.privateConnections, 'application-database-url'), '--identity', f.identityPath, '--operator', selected.actorId, '--manifest', join(directory, manifest), '--expected-instance', selected.expectedInstanceId, '--expected-epoch', selected.expectedRecoveryEpoch, '--expected-catalog-revision', selected.expectedCatalogRevision, '--revision', selected.revision, '--guide-version', String(selected.guideVersion), '--operation-id', selected.operationId];
    };
    const before = await f.storage(snapshot), identityBytes = await readFile(f.identityPath);
    for (const extra of [{ actorId: 'invalid actor!' }, { expectedInstanceId: `instance_${randomUUID()}` }, { expectedRecoveryEpoch: `epoch_${randomUUID()}` }, { expectedCatalogRevision: 'unexpected-catalog' }, { guideVersion: 2 }]) {
        await assert.rejects(runImplementedReaders(args(`rejected-${randomUUID()}.json`, extra)));
        assert.equal(await f.storage(snapshot), before);
    }
    const wrong = join(directory, 'wrong-identity.json');
    await writeFile(wrong, JSON.stringify({ version: 1, instanceId: `instance_${randomUUID()}`, recoveryEpoch: f.options.recoveryEpoch }), { mode: 0o600 });
    const mismatched = args('wrong-identity-must-not-exist.json'); mismatched[mismatched.indexOf('--identity') + 1] = wrong;
    await assert.rejects(runImplementedReaders(mismatched));
    assert.equal(await f.storage(snapshot), before);
    await installSqlFault(f, 'perception_catalog');
    try { await assert.rejects(runImplementedReaders(args('rolled-back-must-not-exist.json'))); assert.equal(await f.storage(snapshot), before); }
    finally { await removeSqlFault(f, 'perception_catalog'); }
    const first = await runImplementedReaders(args('first-receipt.json')), committed = await f.storage(snapshot);
    const replay = await runImplementedReaders(args('replay-receipt.json'));
    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal(await f.storage(snapshot), committed);
    assert.equal(first.receipt.changed, true);
    assert.equal((first.receipt.collectionQuery as Json).objectLayersGranted, false);
    assert.deepEqual((first.receipt.collectionQuery as Json).objectIds, []);
    await assert.rejects(runImplementedReaders(args('conflict-must-not-exist.json', { revision: 'changed-payload' })), { code: 'operation_id_conflict' });
    assert.equal(await f.storage(snapshot), committed);
    assert((await readFile(f.identityPath)).equals(identityBytes));
    const after = await f.storage(store => store.read(async tx => ({ catalog: await tx.find('perception_catalog'), business: await businessDigest(tx) })));
    assert.equal(after.business, state.business);
    const byId = new Map(after.catalog.map(row => [row.id, row]));
    for (const row of state.catalog.filter(row => row.id !== 'current')) assert.deepEqual(byId.get(row.id), row);
    assert.equal((await f.read('GET', '/discovery?limit=50', undefined, f.owner.sessionToken)).catalogRevision, options.revision);
    assert.deepEqual((await f.read('POST', '/list', input(f.a.agentId), f.owner.sessionToken)).records, []);
    await f.storage(store => store.transaction(async tx => { const current = (await tx.get('perception_catalog', 'current'))!; await tx.update('perception_catalog', { ...current, version: current.version + 1, data: { ...current.data, schemaVersion: 3 } }, current.version); }));
    const unsupported = await f.storage(snapshot);
    await assert.rejects(runImplementedReaders(args('unsupported-must-not-exist.json', { operationId: randomUUID(), expectedCatalogRevision: options.revision, guideVersion: 4 })));
    assert.equal(await f.storage(snapshot), unsupported, 'The CLI never migrates an unsupported catalog');
});

await test('publication preserves unavailable sources and revoked declarations, no-op replay does not advance a revision, and later explicit disable is not re-enabled', async (t) => {
    const pg = await postgresFixture(); t.after(pg.dispose);
    await legacyDefault(pg.store, true);
    const options = publication(pg.store), result = await publishImplementedPerceptionReaders(pg.store, options);
    assert.equal((result.sourceTransitions as Json[]).find(source => source.sourceId === 'demo-items')!.after, 'unavailable');
    const mutate = async (change: (tx: any) => Promise<void>) => await pg.store.transaction(change);
    await mutate(async tx => { const row = (await tx.get('perception_catalog', OWNER_NOTIFICATION_COLLECTION_QUERY_ID))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version); });
    const next = { ...options, operationId: randomUUID(), expectedCatalogRevision: options.revision, revision: 'unused-no-op-revision', guideVersion: 4 };
    const noOp = await publishImplementedPerceptionReaders(pg.store, next);
    assert.equal(noOp.changed, false);
    assert.equal(noOp.catalogRevision, options.revision);
    assert.equal((noOp.collectionQuery as Json).active, false);
    assert.equal((await pg.store.read(tx => tx.get('perception_catalog', 'guide:mailbox:4'))), undefined);
    await mutate(async tx => { const row = (await tx.get('perception_catalog', 'current'))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, sourceStates: { ...row.data.sourceStates, holdings: 'not_enabled' } } }, row.version); });
    const before = await snapshot(pg.store);
    await assert.rejects(publishImplementedPerceptionReaders(pg.store, { ...next, operationId: randomUUID() }), { code: 'version_conflict' });
    assert.equal(await snapshot(pg.store), before);
    const current = (await pg.store.read(tx => tx.get('perception_catalog', 'current')))!;
    assert.equal((current.data.sourceStates as Json)['demo-items'], 'unavailable');
    assert.equal((current.data.sourceStates as Json)['demo-places'], 'not_enabled');
});

await test('publication leaves populated World/Interaction/Decision facts and all other business tables intact, and closed readiness never repairs old defaults', async () => {
    const f = await gatewayFixture(), pool = new Pool({ connectionString: f.options.connectionString, max: 1 });
    const app = await buildApp({ ...f.options, clock: f.now, email: { mode: 'experience' }, worldCoreEnabled: true, worldCoreInteractionEnabled: true });
    let closed = false;
    try {
        const [a, b] = [await f.register(), await f.register()];
        const command = async (actor: typeof a, operation: string, input: Json) => {
            const response = await app.inject({ method: 'POST', url: '/v1/gateway/commands', headers: { authorization: `Bearer ${actor.runtimeToken}` }, payload: { protocolVersion: 1, consumerId: 'reader-preservation', purpose: 'agent-manual', operation, input, commandId: randomUUID() } });
            assert.equal(response.statusCode, 200);
            assert.equal(response.json().data.outcome, 'committed');
            return response.json().data.result;
        };
        for (const actor of [a, b]) await command(actor, 'world.avatar.create', { worldId: 'default', expectedRulesetVersion: 1 });
        const artifact = await command(a, 'interaction.artifact.create', { title: 'Private preserved work', body: 'This private body must remain unchanged' });
        await command(a, 'interaction.invitation.send', { worldId: 'default', toAgentId: b.agentId, artifact: artifact.artifact, expectedArtifactVersion: 1, templateVersion: 1, configVersion: 1, intent: 'A legitimate isolated invitation' });
        await app.close(); closed = true;
        await legacyDefault(f.legacy);
        await f.gate(false);
        const allTables = async () => {
            const tables = (await pool.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name")).rows;
            const result: Record<string, string> = {};
            for (const table of tables) {
                assert(/^[a-z_]+$/.test(table.table_schema) && /^[a-z_]+$/.test(table.table_name));
                const name = `${table.table_schema}.${table.table_name}`;
                if (name === 'platform.instance_state') continue; // Guard generation is an expected transaction mechanism, not identity/business state.
                result[name] = (await pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM "${table.table_schema}"."${table.table_name}" t`)).rows[0].digest;
            }
            return result;
        };
        const untouched = await allTables();
        const reader = await buildApp({ ...f.options, clock: f.now, email: { mode: 'experience' }, worldCoreEnabled: true, worldCoreInteractionEnabled: true });
        try {
            await reader.ready();
            await verifyApplicationReadiness(f.legacy);
            assert.equal((await reader.inject({ method: 'GET', url: '/health' })).statusCode, 200);
            const wallet = await reader.inject({ method: 'POST', url: '/v1/wallet/query', headers: { authorization: `Bearer ${a.runtimeToken}` }, payload: { protocolVersion: 1, consumerId: 'closed-reader', purpose: 'agent-inspect' } });
            assert.equal(wallet.statusCode, 200);
            assert.equal(wallet.json().data.balance, 0);
        } finally { await reader.close(); }
        assert.deepEqual(await allTables(), untouched, 'Startup, readiness and health cannot repair catalog-1 or create declarations');
        assert.equal((await f.legacy.read(tx => tx.get('perception_catalog', OWNER_NOTIFICATION_COLLECTION_QUERY_ID))), undefined);
        assert((await pool.query('SELECT count(*)::integer AS count FROM world.avatars')).rows[0].count > 0);
        assert((await pool.query('SELECT count(*)::integer AS count FROM interaction.invitations')).rows[0].count > 0);
        assert((await pool.query('SELECT count(*)::integer AS count FROM decision.requests')).rows[0].count > 0);
        const identity = (await pool.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state')).rows[0];
        await f.gate(true);
        const before = await allTables(), documents = await f.legacy.read(async tx => (await tx.find('perception_catalog')).filter(row => row.id !== 'current'));
        await publishImplementedPerceptionReaders(f.legacy, publication(f.legacy));
        const after = await allTables();
        const allowed = new Set(['perception.catalog_current', 'perception.source_states', 'perception.documents', 'perception.catalog_releases', 'perception.observation_policies', 'platform.administrative_receipts', 'perception.access_facts']);
        for (const [name, digest] of Object.entries(before)) if (!allowed.has(name)) assert.equal(after[name], digest, name);
        const old = new Map((await f.legacy.read(tx => tx.find('perception_catalog'))).map(row => [row.id, row]));
        for (const row of documents) assert.deepEqual(old.get(row.id), row);
        const afterIdentity = (await pool.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state')).rows[0];
        assert.equal(afterIdentity.instance_id, identity.instance_id);
        assert.equal(afterIdentity.recovery_epoch, identity.recovery_epoch);
        assert.equal(afterIdentity.writes_enabled, true);
    } finally { if (!closed) await app.close(); await pool.end(); await f.dispose(); }
});
