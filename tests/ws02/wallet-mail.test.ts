import {legacyCopy} from './legacy-copy.ts';
import {installSqlFault,removeSqlFault} from './pg-faults.ts';
import { eachAsync } from '../../apps/platform/domains/common/async-collections.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { initializePerceptionCatalog } from '../../apps/platform/application/perception-catalog.ts';
import { authorizeWs02SeedOwnerObservation } from '../../apps/platform/application/perception-owner-observation.ts';
import { key, refId } from '../../apps/platform/domains/perception/protocol.ts';
import { fixture, requestBase } from './helpers.ts';
const agentRef = (id: string) => ({ moduleId: 'profiles', type: 'profiles.agent@1', id });
await test('detail schema4 supplies the authorized source title alongside the body and never leaks a title through an unauthorized known ref', async (t) => {
    const f = await fixture(t);
    const items = await f.read('POST', '/list', requestBase('world', { categoryId: 'items', limit: 50 }));
    const item = items.records[0], read = await f.detail(item.ref, 'world');
    assert.equal(read.final.content.title, item.summary.title);
    assert(read.segments.every(part => part.content.title === item.summary.title));
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_objects', refId(item.ref)))!; await tx.update('perception_objects', { ...row, version: row.version + 1, data: { ...row.data, public: false } }, row.version); }));
    const unavailable = await f.call('POST', '/detail', { ...requestBase('world', { purpose: 'human-inspect' }), ref: item.ref }, f.owner.sessionToken);
    assert.equal(unavailable.status, 404);
    assert(!JSON.stringify(unavailable.envelope).includes(item.summary.title));
    await f.storage(async (store) => await authorizeWs02SeedOwnerObservation(store, { actorId: 'isolated-title-administrator', operationId: randomUUID(), expectedSourceAdministrator: 'isolated-test-administrator' }));
    const input = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), categoryId: 'notifications', limit: 50 };
    const notifications = await f.read('POST', '/list', input, f.owner.sessionToken), notification = notifications.records.find((row: any) => row.detailAvailable);
    const detail = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref: notification.ref };
    assert.equal((await f.read('POST', '/detail', detail, f.owner.sessionToken)).content.title, notification.summary.title);
    const denied = await f.call('POST', '/detail', detail, f.otherOwner.sessionToken);
    assert.equal(denied.status, 404);
    assert(!JSON.stringify(denied.envelope).includes(notification.summary.title));
});
await test('schema3 and guide3 exact documents and frozen catalog digests remain intact when the next contract is registered', async (t) => {
    const f = await fixture(t);
    await f.storage(async (store) => await store.transaction(async (tx) => {
        const legacySchema = { type: 'object', additionalProperties: false, properties: { legacySchemaVersion: { const: 3 } } };
        await tx.insert('perception_catalog', { id: 'schema:perception.detail-result:3', version: 1, data: { document: legacySchema, digest: key(legacySchema) } });
        for (const moduleId of ['perception', 'world', 'profiles', 'items', 'inventory', 'mailbox']) {
            const document = { moduleId, version: 3, text: 'Frozen guide3 source bytes', http: { detail: { meaning: 'Historical contract without title' } } };
            await tx.insert('perception_catalog', { id: `guide:${moduleId}:3`, version: 1, data: { document, digest: key(document) } });
        }
        await tx.insert('perception_catalog', { id: `catalog-revision:${key('frozen-catalog-schema3')}`, version: 1, data: { kind: 'catalog_revision', catalogRevision: 'frozen-catalog-schema3', digest: key({ historicalDeclaration: 'frozen before wallet/mail contract' }) } });
        const row = (await tx.get('perception_catalog', 'current'))!;
        await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, schemaVersion: 3, guideVersion: 3, catalogRevision: 'frozen-catalog-schema3', skillCatalogRevision: 'skills-frozen-catalog-schema3' } }, row.version);
    }));
    const before = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_catalog')).filter(row => row.id !== 'current')));
    await f.storage(async (store) => await store.transaction(initializePerceptionCatalog));
    const after = await f.storage(async (store) => await store.read(async (tx) => await tx.find('perception_catalog'))), byId = new Map(after.map(row => [row.id, row]));
    for (const row of before)
        assert.deepEqual(byId.get(row.id), row);
    const directory = await f.read('GET', '/discovery?limit=50');
    assert.equal(directory.catalogRevision, 'frozen-catalog-schema3-schema-4');
    const old = await f.read('GET', '/schemas/perception.detail-result?version=3');
    assert.equal(old.document.properties.legacySchemaVersion.const, 3);
    assert.equal((await f.read('GET', '/guides/world?version=3')).document.text, 'Frozen guide3 source bytes');
    const current = await f.read('GET', '/schemas/perception.detail-result?version=4');
    assert(current.document.properties.data.properties.content.properties.title);
});
// These sources are explicit isolated upstream adapters. Their credentials are
// authenticated by the actual M1 service; neither input nor test rows claim an actor.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFile, readFile, realpath } from 'node:fs/promises';
import { M1_TABLES, type JsonObject } from '../../apps/platform/contracts/store.ts';
import { createM1Service } from '../../apps/platform/application/m1-service.ts';
import type { TrustedMailboxSource } from '../../apps/platform/application/mailbox-service.ts';
import { initializeWalletAccount, walletAccountId } from '../../apps/platform/domains/wallet/repository.ts';
import { mailboxRepository, saveMailboxReceipt, mailboxReceiptId } from '../../apps/platform/domains/mailbox/repository.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { updatePerceptionDemoObject } from '../../apps/platform/application/perception-admin.ts';
import { runSeed } from '../../scripts/ws02-demo-data.ts';
import { runOwnerObservation } from '../../scripts/ws02-owner-observation.ts';
import { agentFixture, ok, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import type { TestContext } from 'node:test';
const stamp = Date.UTC(2026, 9, 20), newTables = ['wallet_accounts', 'mailbox_messages', 'mailbox_receipts'];
const messages = (id?: string, extra: Json = {}) => requestBase('inbox', { categoryId: 'messages', ...(id ? { purpose: 'human-inspect', agentRef: agentRef(id) } : {}), ...extra });
async function messageFixture(t: TestContext) {
    const recipients = new Set<string>(), humanNames = new Map<string, string>();
    let observe = true, receiveTime = stamp;
    const source: TrustedMailboxSource = { sourceId: 'isolated-authenticated-upstream',
        async authenticate(tx, context, authenticate) {
            const credential = await authenticate(tx, (context as {
                token?: string;
            }).token, ['runtime', 'owner_session']);
            return credential.data.kind === 'runtime' ? { kind: 'agent', ref: agentRef(String(credential.data.agentId)) } : { kind: 'human', ref: { moduleId: 'identities', type: 'identities.human@1', id: String(credential.data.ownerId) } };
        },
        async authorizeRecipient(_tx, _actor, recipient) { return recipients.has(recipient); },
        async ownerObservation() { return { existence: observe, summary: observe, body: observe, attachments: observe }; },
        async humanIdentity(_tx, ar, recipient) { const name = recipients.has(recipient) ? humanNames.get(ar.id) : undefined; return name ? { ref: ar, displayName: name, authorityId: 'isolated-explicit-disclosure', version: 1 } : null; }, };
    const f = await fixture(t, { mailboxSources: [source], detailSegmentChars: 32 });
    recipients.add(f.a.agentId);
    recipients.add(f.sibling.agentId);
    const receive = async (input: Json, token = f.sibling.runtimeToken) => await f.storage(async (store) => await createM1Service(store, { now: () => receiveTime, perception: { mailboxSources: [source] } }).receiveTrustedMessage(source.sourceId, input, { token }));
    const input = (extra: Json = {}) => ({ sourceMessageKey: `source-${randomUUID()}`, recipientAgentId: f.a.agentId, title: '来自受信来源的合成来信', body: 'Only an authenticated upstream may provide this original body. '.repeat(12), attachments: [{ name: 'Authorized attachment', description: 'A bounded description.' }], ...extra });
    return { ...f, source, receive, input, recipients, humanNames, setObserve(value: boolean) { observe = value; }, setReceiveTime(value: number) { receiveTime = value; } };
}
await test('wallet accounts are durable registration records; queries are pure reads, isolate actors, retain values across initialization/rebinding and never invent missing zero', async (t) => {
    const f = await fixture(t), query = { protocolVersion: 1, consumerId: 'wallet-browser', purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) };
    const snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => key(await Promise.all(M1_TABLES.map(async (table) => await tx.find(table))))));
    const before = await snapshot(), result = await f.m1('POST', '/wallet/query', query, f.owner.sessionToken);
    assert.equal(result.status, 200);
    assert.equal(result.body.protocolVersion, 1);
    assert.equal(result.body.data.balance, 0);
    assert.equal(result.body.data.initializationSource, 'registration');
    assert.equal(result.body.data.dataMode, 'platform');
    assert.equal(await snapshot(), before);
    assert.equal((await f.m1('POST', '/wallet/query', query, f.otherOwner.sessionToken)).status, 404);
    assert.equal((await f.m1('POST', '/wallet/query', { ...query, agentRef: agentRef(f.b.agentId) }, f.owner.sessionToken)).status, 404);
    assert.equal((await f.m1('POST', '/wallet/query', { ...query, purpose: 'agent-inspect', agentRef: agentRef(f.sibling.agentId) }, f.a.runtimeToken)).status, 404);
    const own = await f.m1('POST', '/wallet/query', { protocolVersion: 1, consumerId: 'wallet-agent', purpose: 'agent-inspect' }, f.a.runtimeToken);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.balance, 0);
    const a = await agentFixture(f.m1, f.owner, '新注册有真实零余额', 'blue');
    const account = await f.storage(async (store) => await store.read(async (tx) => (await tx.get('wallet_accounts', walletAccountId(a.agentId)))!));
    assert.equal(account.data.balance, 0);
    const command = { operationId: a.operationId, attemptId: a.attemptId, runtimeToken: a.runtimeToken, continuationToken: a.continuationToken, inviteToken: a.inviteToken };
    await ok(f.m1, 'POST', '/registrations', command);
    assert.deepEqual(await f.storage(async (store) => await store.read(async (tx) => await tx.get('wallet_accounts', account.id))), account);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('wallet_accounts', walletAccountId(f.a.agentId)))!; await tx.update('wallet_accounts', { ...row, version: row.version + 1, data: { ...row.data, balance: 17 } }, row.version); await initializeWalletAccount(tx, f.a.agentId, stamp + 1000); }));
    await f.restart();
    assert.equal((await f.m1('POST', '/wallet/query', query, f.owner.sessionToken)).body.data.balance, 17);
    await f.storage(async (store) => await store.transaction(async (tx) => { const binding = (await tx.find('bindings', { agentId: f.a.agentId, active: true }))[0]!; await tx.update('bindings', { ...binding, version: binding.version + 1, data: { ...binding.data, ownerId: f.otherOwner.ownerId } }, binding.version); }));
    assert.equal((await f.m1('POST', '/wallet/query', query, f.owner.sessionToken)).status, 404);
    assert.equal((await f.m1('POST', '/wallet/query', query, f.otherOwner.sessionToken)).body.data.balance, 17);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('wallet_accounts', walletAccountId(f.a.agentId)))!; await tx.remove('wallet_accounts', row.id, row.version); }));
    const missing = await f.m1('POST', '/wallet/query', query, f.otherOwner.sessionToken);
    assert.equal(missing.status, 409);
    assert.equal(missing.body.error.code, 'wallet_not_initialized');
    assert(!JSON.stringify(missing.body).includes('balance'));
    assert.equal(await f.storage(async (store) => await store.read(async (tx) => await tx.get('wallet_accounts', walletAccountId(f.a.agentId)))), undefined);
});
await test('schema5 migration preserves the original 20 tables and migration checksums, creates real zero accounts, and legacy observation CLI refuses to migrate implicitly', async (t) => {
    const f = await fixture(t), legacyPath = join(f.directory, 'original-schema5.sqlite'), oldTables = M1_TABLES.filter(table => !newTables.includes(table));
    await f.storage(async (store) => await updatePerceptionDemoObject(store, { actorId: 'isolated-test-administrator', operationId: randomUUID(), ref: { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-09' }, expectedVersion: 1, body: 'Keep the R03 exact second version.' }));
    await f.storage(store=>legacyCopy(store,legacyPath,5,oldTables));
    const snapshot = () => {
        const db = new DatabaseSync(legacyPath, { readOnly: true });
        try {
            return { identity: db.prepare('SELECT * FROM instance_state').all(), migrations: db.prepare('SELECT * FROM schema_migrations WHERE version<=5 ORDER BY version').all(), tables: oldTables.map(table => [table, db.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()]) };
        }
        finally {
            db.close();
        }
    };
    const before = snapshot(), identity = join(f.directory, 'paired-schema5.identity.json');
    await writeFile(identity, JSON.stringify({ version: 1, instanceId: f.options.instanceId, recoveryEpoch: f.options.recoveryEpoch }));
    const bytes = await readFile(legacyPath), identityBytes = await readFile(identity);
    await assert.rejects(runOwnerObservation(['--database', legacyPath, '--identity', identity, '--operator', 'isolated-admin', '--source-administrator', 'isolated-test-administrator', '--operation-id', 'must-not-implicitly-migrate', '--manifest', join(await realpath(f.directory), 'rejected-receipt.json')]));
    assert((await readFile(legacyPath)).equals(bytes));
    assert((await readFile(identity)).equals(identityBytes));
    assert.deepEqual(snapshot(), before);
    await assert.rejects(runSeed(['--database', legacyPath, '--identity', identity, '--operator', 'isolated-admin', '--manifest', join(await realpath(f.directory), 'rejected-seed-receipt.json')]));
    assert((await readFile(legacyPath)).equals(bytes));
    assert((await readFile(identity)).equals(identityBytes));
    assert.deepEqual(snapshot(), before);
    const migrated = openM1Store({ ...f.options, databasePath: legacyPath });
    try {
        assert.deepEqual(snapshot(), before);
        const accounts = migrated.read(tx=>tx.find('wallet_accounts'));
        assert.equal(accounts.length, 3);
        assert(accounts.every(row => row.data.balance === 0 && row.data.initializationSource === 'migration'));
        assert.equal(migrated.read(tx=>tx.count('mailbox_messages',{},10)), 0);
        assert.equal(migrated.read(tx=>tx.count('mailbox_receipts',{},10)), 0);
    }
    finally {
        migrated.close();
    }
    const db = new DatabaseSync(legacyPath, { readOnly: true });
    try {
        assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get()!.n, 6);
        assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()!.n, 23);
        assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    }
    finally {
        db.close();
    }
});
await test('mailbox starts genuinely empty, accepts only authenticated registered sources, rejects spoofing, and replays the exact source receipt without rewriting content or inactive delivery', async (t) => {
    const f = await messageFixture(t), empty = await f.read('POST', '/list', messages(f.a.agentId), f.owner.sessionToken);
    assert.equal(empty.complete, true);
    assert.deepEqual(empty.records, []);
    const old = async () => await f.storage(async (store) => await store.read(async (tx) => key({ objects: await tx.find('perception_objects'), grants: await tx.find('perception_grants'), states: await tx.find('perception_states') })));
    const before = await old(), input = f.input();
    await assert.rejects(async () => await f.receive({ ...input, sender: { kind: 'agent', id: f.b.agentId } }), { code: 'invalid_request' });
    await assert.rejects(async () => await f.receive(input, 'invalid-token'));
    await assert.rejects(async () => await f.receive({ ...input, recipientAgentId: f.b.agentId }), { code: 'target_not_accessible' });
    const received = await f.receive(input);
    assert.deepEqual(await f.receive(input), received);
    await assert.rejects(async () => await f.receive({ ...input, body: 'Changed same source key payload' }), { code: 'operation_id_conflict' });
    const list = await f.read('POST', '/list', messages(f.a.agentId), f.owner.sessionToken);
    assert.equal(list.records.length, 1);
    assert.equal(list.records[0].summary.sender.displayName, '合成感知乙');
    assert.equal(list.records[0].summary.sender.ref.id, f.sibling.agentId);
    assert.equal(list.records[0].summary.dataMode, 'real');
    assert.equal(list.records[0].agentReadState, undefined);
    const complete = await f.detail(received.ref as any, 'inbox', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
    assert.equal(complete.segments.map(row => row.content.text).join(''), input.body);
    assert.equal(complete.final.completionToken, undefined);
    assert.equal(await old(), before);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await mailboxRepository(tx).receipt((received.ref as Json).id, f.a.agentId))!; await saveMailboxReceipt(tx, { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row); }));
    assert.deepEqual(await f.receive(input), received);
    assert.equal((await f.read('POST', '/list', messages(f.a.agentId), f.owner.sessionToken)).records.length, 0);
});
await test('new message versions use independent receipt confirmation with full-body proof, exact receipt replay and rejected-key preservation', async (t) => {
    const f = await messageFixture(t), input = f.input(), received = await f.receive(input), ref = received.ref as any;
    const legacyRef = { moduleId: 'mailbox', type: 'mailbox.message@1', id: 'test-message-09' };
    await f.storage(async (store) => await updatePerceptionDemoObject(store, { actorId: 'isolated-test-administrator', operationId: randomUUID(), ref: legacyRef, expectedVersion: 1, body: 'The legacy R03 notification remains version two.' }));
    const notifications = await f.read('POST', '/list', requestBase('inbox', { categoryId: 'notifications', limit: 50 }));
    for (const oldRef of [legacyRef, ...notifications.records.filter((r: Json) => r.detailAvailable && r.ref.id !== legacyRef.id).slice(0, 2).map((r: Json) => r.ref)]) {
        const oldBody = await f.detail(oldRef);
        await f.read('PUT', '/agent-read-state', { protocolVersion: 1, operationId: randomUUID(), ref: oldRef, contentVersion: oldBody.final.version, completionToken: oldBody.final.completionToken });
    }
    assert.equal((await f.unread()).count.value, 27);
    const oldStates = async () => await f.storage(async (store) => await store.read(async (tx) => key(await tx.find('perception_states'))));
    const before = await oldStates();
    const first = await f.read('POST', '/detail', { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref });
    assert.equal(first.contentComplete, false);
    assert.equal(first.completionToken, undefined);
    const wrong = { protocolVersion: 1, operationId: randomUUID(), ref, contentVersion: 1, completionToken: 'invalid-completion-proof' };
    assert.equal((await f.call('PUT', '/agent-read-state', wrong)).status, 410);
    assert.equal((await f.queryState(ref)).confirmedContentVersion, null);
    const body = await f.detail(ref), confirm = { protocolVersion: 1, operationId: randomUUID(), ref, contentVersion: 1, completionToken: body.final.completionToken };
    const state = await f.read('PUT', '/agent-read-state', confirm);
    assert.equal(state.confirmedContentVersion, 1);
    assert.equal(state.stateVersion, 1);
    assert.equal(state.changed, true);
    assert.deepEqual(await f.read('PUT', '/agent-read-state', confirm), state);
    assert.equal((await f.call('PUT', '/agent-read-state', { ...wrong, completionToken: body.final.completionToken })).status, 409);
    const revised = await f.receive({ ...input, contentVersion: 2, body: 'An immutable second original source version. '.repeat(5) });
    assert.equal((revised.ref as Json).id, ref.id);
    assert.equal((await f.queryState(ref)).currentContentVersion, 2);
    assert.equal((await f.queryState(ref)).confirmedContentVersion, 1);
    const next = await f.detail(ref), second = await f.read('PUT', '/agent-read-state', { ...confirm, operationId: randomUUID(), contentVersion: 2, completionToken: next.final.completionToken });
    assert.equal(second.confirmedContentVersion, 2);
    assert.equal(second.stateVersion, 2);
    assert.equal(await oldStates(), before);
    const versions = await f.storage(async (store) => await store.read(async (tx) => await tx.find('mailbox_messages')));
    assert.equal(versions.length, 2);
    assert.equal(versions[0]!.version, 1);
    assert.equal(versions[1]!.version, 1);
    await assert.rejects(async () => await f.storage(async (store) => await store.transaction(async (tx) => { const row = versions[0]!; await tx.update('mailbox_messages', { ...row, version: row.version + 1, data: { ...row.data, body: 'Overwrite forbidden' } }, row.version); })));
    assert.equal(await oldStates(), before);
});
await test('owner message observation and continuations require each current layer, binding, receipt and subject; human reads never confirm', async (t) => {
    const f = await messageFixture(t);
    f.setObserve(false);
    const secret = await f.receive(f.input({ title: 'Agent-only new message' }));
    f.setObserve(true);
    const one = await f.receive(f.input()), two = await f.receive(f.input());
    const input = messages(f.a.agentId, { limit: 1 }), first = await f.read('POST', '/list', input, f.owner.sessionToken);
    assert.equal(first.records.length, 1);
    assert(first.nextPageToken);
    assert(!JSON.stringify(first).includes('Agent-only'));
    const detail = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref: one.ref }, part = await f.read('POST', '/detail', detail, f.owner.sessionToken);
    assert.equal((await f.call('POST', '/detail', { ...detail, ref: secret.ref }, f.owner.sessionToken)).status, 404);
    assert.equal((await f.call('POST', '/list', input, f.otherOwner.sessionToken)).status, 404);
    assert.equal((await f.call('POST', '/list', { ...input, agentRef: agentRef(f.sibling.agentId), pageToken: first.nextPageToken }, f.owner.sessionToken)).status, 409);
    assert.equal((await f.call('POST', '/detail', { ...detail, agentRef: agentRef(f.sibling.agentId), contentToken: part.nextContentToken }, f.owner.sessionToken)).status, 404);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await mailboxRepository(tx).receipt((one.ref as Json).id, f.a.agentId))!; await saveMailboxReceipt(tx, { ...row, version: row.version + 1, data: { ...row.data, ownerObservation: { existence: true, summary: true, body: false, attachments: false } } }, row); }));
    assert.equal((await f.call('POST', '/detail', { ...detail, contentToken: part.nextContentToken }, f.owner.sessionToken)).status, 404);
    const summary = await f.listAll(messages(f.a.agentId), f.owner.sessionToken);
    assert.equal(summary.records.find(row => row.ref.id === (one.ref as Json).id)!.detailAvailable, false);
    const state = await f.queryState(two.ref as any);
    assert.equal(state.confirmedContentVersion, null);
    const human = await f.detail(two.ref as any, 'inbox', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
    assert.equal(human.final.completionToken, undefined);
    assert.deepEqual(await f.queryState(two.ref as any), state);
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.find('bindings', { agentId: f.a.agentId, active: true }))[0]!; await tx.update('bindings', { ...row, version: row.version + 1, data: { ...row.data, active: false } }, row.version); }));
    assert.equal((await f.call('POST', '/list', messages(f.a.agentId), f.owner.sessionToken)).status, 404);
});
await test('human sender names need explicit audience disclosure and current Agent/human name revocation cannot leak snapshots or change body confirmation', async (t) => {
    const f = await messageFixture(t), input = f.input();
    await assert.rejects(async () => await f.receive(input, f.owner.sessionToken), { code: 'sender_not_verified' });
    f.humanNames.set(f.owner.ownerId, '明确披露的合成人类称谓');
    const human = await f.receive(input, f.owner.sessionToken);
    const initial = await f.read('POST', '/list', messages(f.a.agentId), f.owner.sessionToken);
    assert.equal(initial.records[0].summary.sender.kind, 'human');
    assert.equal(initial.records[0].summary.sender.displayName, '明确披露的合成人类称谓');
    assert(!JSON.stringify(initial).includes(f.owner.username));
    assert(!JSON.stringify(initial).includes(f.owner.email));
    const state = await f.queryState(human.ref as any);
    f.humanNames.delete(f.owner.ownerId);
    const restricted = await f.read('POST', '/list', messages(f.a.agentId), f.owner.sessionToken);
    assert.deepEqual(restricted.records[0].summary.sender, { kind: 'human', ref: null, displayName: null });
    assert(!JSON.stringify(restricted).includes('明确披露的合成人类称谓'));
    assert.equal(restricted.records[0].version, 1);
    const body = await f.detail(human.ref as any, 'inbox', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
    assert.equal(body.final.content.sender.displayName, null);
    assert.equal(body.segments.map(row => row.content.text).join(''), input.body);
    assert.deepEqual(await f.queryState(human.ref as any), state);
    const agent = await f.receive(f.input()), profile = await ok(f.m1, 'GET', `/agents/${f.sibling.agentId}/profile`, undefined, f.owner.sessionToken);
    await ok(f.m1, 'POST', `/agents/${f.sibling.agentId}/profile/unpublish`, { operationId: randomUUID(), expectedVersion: profile.version, expectedPolicyVersion: profile.policyVersion }, f.owner.sessionToken);
    const hidden = await f.detail(agent.ref as any, 'inbox', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
    assert.deepEqual(hidden.final.content.sender, { kind: 'agent', ref: null, displayName: null });
    assert.equal(hidden.final.version, 1);
});
await test('source reception and new-message confirmation roll back immutable versions, receipts, operations and facts together on real SQL failure', async (t) => {
    const f = await messageFixture(t), input = f.input(), snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => key(await Promise.all(M1_TABLES.map(async (table) => await tx.find(table))))));
    const before=await snapshot();await installSqlFault(f,'facts');
    try {
        await assert.rejects(async () => await f.receive(input));
        assert.equal(await snapshot(), before);
    }
    finally {
        await removeSqlFault(f,'facts');
    }
    const received = await f.receive(input), body = await f.detail(received.ref as any), confirm = { protocolVersion: 1, operationId: randomUUID(), ref: received.ref, contentVersion: 1, completionToken: body.final.completionToken };
    const prior=await snapshot();await installSqlFault(f,'facts');
    try {
        const response = await f.call('PUT', '/agent-read-state', confirm);
        assert(response.status >= 500);
        assert.equal(await snapshot(), prior);
    }
    finally {
        await removeSqlFault(f,'facts');
    }
    const accepted = await f.read('PUT', '/agent-read-state', confirm);
    assert.equal(accepted.confirmedContentVersion, 1);
    assert.deepEqual(await f.read('PUT', '/agent-read-state', confirm), accepted);
});
await test('holding kinds and named publication associations require each target current visibility and do not disclose withdrawn names or refs', async (t) => {
    const f = await fixture(t), holdings = await f.read('POST', '/list', requestBase('inventory', { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId), categoryId: 'holdings', limit: 50 }), f.owner.sessionToken);
    assert(holdings.records.every((r: Json) => ['work', 'prop'].includes(r.summary.itemKind)));
    const events = await f.read('POST', '/list', requestBase('world', { purpose: 'human-inspect', categoryId: 'events', metricId: 'occurrences', limit: 50 }), f.owner.sessionToken), publication = events.records.find((r: Json) => r.sourceId === 'platform-publications');
    assert(publication);
    const old = await f.detail(publication.ref, 'world', f.owner.sessionToken, { purpose: 'human-inspect' }), related = old.final.content.publication.relatedItems;
    assert(related.length > 10);
    assert.equal(related.length, old.final.content.publication.publishedRefs.length);
    const item = holdings.records[0], itemId = refId(item.summary.itemRef);
    assert(related.some((r: Json) => key(r.ref) === key(item.summary.itemRef) && r.title === item.summary.title));
    const source = await f.storage(async (store) => await store.read(async (tx) => (await tx.get('perception_objects', itemId))!));
    await f.storage(async (store) => await store.transaction(async (tx) => await tx.update('perception_objects', { ...source, version: source.version + 1, data: { ...source.data, public: false } }, source.version)));
    const current = await f.detail(publication.ref, 'world', f.owner.sessionToken, { purpose: 'human-inspect' }), serialized = JSON.stringify(current.final.content.publication);
    assert(!serialized.includes(item.summary.itemRef.id));
    assert(!serialized.includes(item.summary.title));
    const reread = await f.read('POST', '/list', requestBase('inventory', { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId), categoryId: 'holdings', limit: 50 }), f.owner.sessionToken), record = reread.records.find((r: Json) => r.ref.id === item.ref.id);
    assert.equal(record.summary.itemKind, undefined);
    assert.equal(record.summary.itemRef, undefined);
    assert.equal(record.summary.title, '持有记录');
});
await test('discovery publishes the wallet module and new message category with strict schemas that validate actual wallet and mailbox envelopes', async (t) => {
    const f = await messageFixture(t), directory = await f.read('GET', '/discovery?limit=50', undefined, f.owner.sessionToken), wallet = directory.operations.find((row: Json) => row.id === 'wallet-query');
    assert(wallet);
    assert.equal(wallet.path, '/v1/wallet/query');
    const walletModule = directory.modules.find((row: Json) => row.moduleId === 'wallet');
    assert(walletModule);
    const guide = await f.read('GET', `/guides/wallet?version=${walletModule.usageGuide.version}`);
    assert(JSON.stringify(guide.document).includes('/v1/wallet/query'));
    assert(directory.categories.some((row: Json) => row.categoryId === 'messages'));
    assert(directory.types.some((row: Json) => row.type === 'mailbox.direct-message@1'));
    const { createRequire } = await import('node:module'), Ajv2020 = createRequire(import.meta.url)('ajv/dist/2020.js').default, ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = async (schemaRef: Json, value: unknown) => { const schema = await f.read('GET', `/schemas/${schemaRef.id}?version=${schemaRef.version}`); const run = ajv.compile({ ...schema.document, $id: `${schemaRef.id}-${randomUUID()}` }); assert(run(value), JSON.stringify(run.errors)); };
    const query = { protocolVersion: 1, consumerId: 'wallet-schema-reader', purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) };
    await validate(wallet.inputSchema, query);
    const account = await f.m1('POST', '/wallet/query', query, f.owner.sessionToken);
    assert.equal(account.status, 200);
    await validate(wallet.outputSchema, account.body);
    const received = await f.receive(f.input()), listOperation = directory.operations.find((row: Json) => row.id === 'list'), input = messages(f.a.agentId), listed = await f.call('POST', '/list', input, f.owner.sessionToken);
    await validate(listOperation.inputSchema, input);
    await validate(listOperation.outputSchema, listed.envelope);
    await validate(listed.data.records[0].schema, listed.data.records[0].summary);
    const detailOperation = directory.operations.find((row: Json) => row.id === 'detail'), body = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref: received.ref }, part = await f.call('POST', '/detail', body, f.owner.sessionToken);
    await validate(detailOperation.inputSchema, body);
    await validate(detailOperation.outputSchema, part.envelope);
    await validate(part.data.schema, part.data.content);
});
await test('wallet initialization is part of registration rollback and PostgreSQL rejects fractional, negative or unsafe balances', async (t) => {
    const f = await fixture(t), { credential, registrationCommand } = await import('../../scripts/agent-manager-qa-fixture.ts'), inviteToken = credential(), command = registrationCommand(inviteToken);
    await ok(f.m1, 'POST', '/owner/agent-invites', { operationId: randomUUID(), inviteToken }, f.owner.sessionToken);
    const snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => key(await Promise.all(M1_TABLES.map(async (table) => await tx.find(table)))))), before = await snapshot();
    await installSqlFault(f,'wallet_accounts');
    try {
        const failed = await f.m1('POST', '/registrations', command);
        assert(failed.status >= 400);
        assert.equal(await snapshot(), before);
    }
    finally {
        await removeSqlFault(f,'wallet_accounts');
    }
    const registered = await ok(f.m1, 'POST', '/registrations', command), account = await f.storage(async (store) => await store.read(async (tx) => (await tx.get('wallet_accounts', walletAccountId(registered.agentId)))!));
    assert.equal(account.data.balance, 0);
    await ok(f.m1, 'POST', '/registrations', command);
    assert.deepEqual(await f.storage(async (store) => await store.read(async (tx) => await tx.get('wallet_accounts', account.id))), account);
    for (const balance of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(async () => await f.storage(async (store) => await store.transaction(async (tx) => await tx.update('wallet_accounts', { ...account, version: account.version + 1, data: { ...account.data, balance } }, account.version))));
        assert.deepEqual(await f.storage(async (store) => await store.read(async (tx) => await tx.get('wallet_accounts', account.id))), account);
    }
});
for (const senderKind of ['agent', 'human'] as const)
    for (const readerKind of ['runtime', 'owner'] as const)
        await test(`WM-CR04: ${readerKind} continuation rechecks ${senderKind} sender disclosure after rename and withdrawal`, async (t) => {
            const f = await messageFixture(t), human = senderKind === 'human', token = human ? f.owner.sessionToken : f.sibling.runtimeToken;
            const oldName = human ? '本次明确披露的人类旧名' : '合成感知乙', newName = human ? '本次明确披露的人类新名' : '重新公开的合成Agent名称';
            if (human)
                f.humanNames.set(f.owner.ownerId, oldName);
            const received = await f.receive(f.input(), token);
            await f.receive(f.input(), token);
            const originalBody = await f.detail(received.ref as any), confirmation = await f.read('PUT', '/agent-read-state', { protocolVersion: 1, operationId: randomUUID(), ref: received.ref, contentVersion: 1, completionToken: originalBody.final.completionToken }), legacyCount = (await f.unread()).count.value;
            const readerToken = readerKind === 'owner' ? f.owner.sessionToken : f.a.runtimeToken, input = messages(readerKind === 'owner' ? f.a.agentId : undefined, { limit: 1 }), bodyInput = { ...requestBase('inbox', { purpose: readerKind === 'owner' ? 'human-inspect' : 'agent-inspect' }), ...(readerKind === 'owner' ? { agentRef: agentRef(f.a.agentId) } : {}), ref: received.ref };
            const page = await f.read('POST', '/list', input, readerToken), part = await f.read('POST', '/detail', bodyInput, readerToken);
            assert(page.nextPageToken);
            assert(part.nextContentToken);
            assert.equal(page.records[0].summary.sender.displayName, oldName);
            if (human)
                f.humanNames.delete(f.owner.ownerId);
            else {
                const p = await ok(f.m1, 'GET', `/agents/${f.sibling.agentId}/profile`, undefined, f.owner.sessionToken);
                await ok(f.m1, 'POST', `/agents/${f.sibling.agentId}/profile/unpublish`, { operationId: randomUUID(), expectedVersion: p.version, expectedPolicyVersion: p.policyVersion }, f.owner.sessionToken);
            }
            const withdrawn = await f.call('POST', '/list', { ...input, pageToken: page.nextPageToken }, readerToken);
            assert.equal(withdrawn.status, 409);
            assert(!JSON.stringify(withdrawn.envelope).includes(oldName));
            assert(!JSON.stringify(withdrawn.envelope).includes(human ? f.owner.ownerId : f.sibling.agentId));
            assert.equal((await f.call('POST', '/detail', { ...bodyInput, contentToken: part.nextContentToken }, readerToken)).status, 409);
            const restricted = await f.read('POST', '/list', input, readerToken);
            assert.deepEqual(restricted.records[0].summary.sender, { kind: senderKind, ref: null, displayName: null });
            assert.equal(restricted.records[0].version, 1);
            const rename = async (name: string) => {
                if (human)
                    f.humanNames.set(f.owner.ownerId, name);
                else {
                    const p = await ok(f.m1, 'GET', `/agents/${f.sibling.agentId}/profile`, undefined, f.owner.sessionToken);
                    await ok(f.m1, 'PUT', `/agents/${f.sibling.agentId}/profile`, { operationId: randomUUID(), expectedVersion: p.version, expectedPolicyVersion: p.policyVersion, fields: { displayName: name } }, f.owner.sessionToken);
                }
            };
            await rename(newName);
            const fresh = await f.read('POST', '/list', input, readerToken), newPart = await f.read('POST', '/detail', bodyInput, readerToken);
            assert.equal(fresh.records[0].summary.sender.displayName, newName);
            assert.equal(fresh.records[0].version, 1);
            await rename(`${newName}二`);
            const renamed = await f.call('POST', '/list', { ...input, pageToken: fresh.nextPageToken }, readerToken);
            assert.equal(renamed.status, 409);
            assert(!JSON.stringify(renamed.envelope).includes(newName));
            assert.equal((await f.call('POST', '/detail', { ...bodyInput, contentToken: newPart.nextContentToken }, readerToken)).status, 409);
            assert.equal((await f.read('POST', '/list', input, readerToken)).records[0].summary.sender.displayName, `${newName}二`);
            const current = await f.queryState(received.ref as any);
            assert.equal(current.confirmedContentVersion, confirmation.confirmedContentVersion);
            assert.equal(current.stateVersion, confirmation.stateVersion);
            assert.equal((await f.unread()).count.value, legacyCount);
        });
await test('WM-CR05: actual wallet HTTP rejects all schema-invalid purpose shapes without durable writes', async (t) => {
    const f = await fixture(t), directory = await f.read('GET', '/discovery?limit=50'), operation = directory.operations.find((row: Json) => row.id === 'wallet-query'), schema = await f.read('GET', `/schemas/${operation.inputSchema.id}?version=${operation.inputSchema.version}`);
    const { createRequire } = await import('node:module'), Ajv2020 = createRequire(import.meta.url)('ajv/dist/2020.js').default, validate = new Ajv2020({ strict: false }).compile(schema.document), snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => key(await Promise.all(M1_TABLES.map(async (table) => await tx.find(table)))))), before = await snapshot();
    for (const [token, purpose, target] of [[f.owner.sessionToken, 'human-inspect', agentRef(f.a.agentId)], [f.a.runtimeToken, 'agent-inspect', undefined]] as const) {
        const base = { protocolVersion: 1, consumerId: 'wallet-invalid-purpose', ...(target ? { agentRef: target } : {}) };
        for (const invalid of [[purpose], null, {}, 17, 'unknown-purpose']) {
            const input = { ...base, purpose: invalid };
            assert.equal(validate(input), false);
            const response = await f.m1('POST', '/wallet/query', input, token);
            assert(response.status >= 400 && response.status < 500, `invalid purpose ${JSON.stringify(invalid)} was accepted`);
            assert.equal(response.body.data, undefined);
            assert.equal(await snapshot(), before);
        }
    }
    for (const [token, purpose, target] of [[f.owner.sessionToken, 'human-inspect', agentRef(f.a.agentId)], [f.a.runtimeToken, 'agent-inspect', undefined], [f.a.runtimeToken, 'agent-perception', agentRef(f.a.agentId)]] as const) {
        const input = { protocolVersion: 1, consumerId: 'wallet-valid-purpose', purpose, ...(target ? { agentRef: target } : {}) };
        assert(validate(input));
        assert.equal((await f.m1('POST', '/wallet/query', input, token)).status, 200);
        assert.equal(await snapshot(), before);
    }
});
await test('WM-CR06: message summary and body expose the same durable receipt receivedAt, never a guessed sentAt', async (t) => {
    const f = await messageFixture(t), input = f.input(), received = await f.receive(input), receipt = await f.storage(async (store) => await store.read(async (tx) => (await mailboxRepository(tx).receipt((received.ref as Json).id, f.a.agentId))!));
    const check = async () => {
        const page = await f.read('POST', '/list', messages(f.a.agentId), f.owner.sessionToken), record = page.records[0], body = await f.detail(received.ref as any, 'inbox', f.owner.sessionToken, { purpose: 'human-inspect', agentRef: agentRef(f.a.agentId) });
        assert.equal(record.summary.receivedAt, receipt.data.receivedAt);
        assert(body.segments.every(part => part.content.receivedAt === receipt.data.receivedAt));
        assert.equal(record.summary.sentAt, undefined);
        assert(body.segments.every(part => part.content.sentAt === undefined));
        const { createRequire } = await import('node:module'), Ajv2020 = createRequire(import.meta.url)('ajv/dist/2020.js').default;
        for (const [reference, value] of [[record.schema, record.summary], [body.final.schema, body.final.content]]) {
            const schema = await f.read('GET', `/schemas/${reference.id}?version=${reference.version}`);
            assert(schema.document.required.includes('receivedAt'));
            assert.equal(schema.document.properties.receivedAt.type, 'integer');
            const run = new Ajv2020({ strict: false }).compile(schema.document);
            assert(run(value), JSON.stringify(run.errors));
        }
    };
    await check();
    f.advance(60000);
    await f.restart();
    await check();
    f.setReceiveTime(stamp + 120000);
    await f.receive({ ...input, contentVersion: 2, body: 'A later immutable content version without a new initial reception.' });
    await check();
    const guide = await f.read('GET', '/guides/mailbox?version=1');
    assert(JSON.stringify(guide.document.http.messages).includes('receivedAt'));
    assert(JSON.stringify(guide.document.http.messages).includes('sentAt'));
});
await test('WM-CR07: publication target names obey bounded unique logical row reads and deadlines without committing partial read preparation', async (t) => {
    const f = await fixture(t, { detailSegmentChars: 32 }), items = await f.read('POST', '/list', requestBase('world', { categoryId: 'items', limit: 50 })), events = await f.read('POST', '/list', requestBase('world', { categoryId: 'events', limit: 50 })), publication = events.records.find((row: Json) => row.sourceId === 'platform-publications'), plan = events.records.find((row: Json) => row.ref.type === 'world.plan@1');
    const target = items.records[0], references = [target.ref, target.ref, agentRef(f.sibling.agentId), agentRef(f.sibling.agentId), plan.ref];
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_objects', refId(publication.ref)))!; await tx.update('perception_objects', { ...row, version: row.version + 1, data: { ...row.data, body: 'A source publication body with several named target kinds. '.repeat(40), publishedRefs: references } }, row.version); }));
    const input = { ...requestBase('world', { purpose: 'agent-inspect' }), ref: publication.ref }, prepared = async () => await f.storage(async (store) => await store.read(async (tx) => ({ sessions: await tx.find('perception_sessions'), access: await tx.find('perception_access') })));
    for (const maxScannedRows of [1, 4]) {
        const before = await prepared(), denied = await f.call('POST', '/detail', { ...input, budget: { maxScannedRows } });
        assert.equal(denied.status, 422);
        assert.equal(denied.error.code, 'budget_too_small');
        assert.equal(denied.data, undefined);
        assert.deepEqual(await prepared(), before);
    }
    const full = await f.read('POST', '/detail', { ...input, budget: { maxScannedRows: 5 } });
    assert.equal(full.content.publication.relatedItems.length, 5);
    assert.deepEqual(full.content.publication.publishedRefs, references);
    assert.equal(full.contentComplete, false);
    assert(full.nextContentToken);
    const beforeDeadline = await prepared();
    let calls = 0;
    const wall = Date.now(), clock = t.mock.method(Date, 'now', () => ++calls <= 5 ? wall : wall + 10);
    try {
        const expired = await f.call('POST', '/detail', { ...input, budget: { maxScannedRows: 5, deadlineMs: 5 } });
        assert.equal(expired.status, 422);
        assert.equal(expired.error.code, 'budget_too_small');
        assert.deepEqual(await prepared(), beforeDeadline);
    }
    finally {
        clock.mock.restore();
    }
    await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_objects', refId(target.ref)))!; await tx.update('perception_objects', { ...row, version: row.version + 1, data: { ...row.data, public: false } }, row.version); }));
    const withdrawn = await f.read('POST', '/detail', { ...input, budget: { maxScannedRows: 5 } });
    assert.equal(withdrawn.content.publication.relatedItems.length, 3);
    assert(!JSON.stringify(withdrawn.content.publication).includes(target.ref.id));
    assert(!JSON.stringify(withdrawn.content.publication).includes(target.summary.title));
    const single = await f.call('POST', '/detail', { ...requestBase('world', { purpose: 'agent-inspect' }), ref: plan.ref, budget: { maxScannedRows: 1 } });
    assert.equal(single.status, 200);
});
await test('WM-CR08: a frozen runtime list continues after confirming frozen candidates and returns their latest confirmation projection', async (t) => {
    const f = await messageFixture(t);
    for (let n = 0; n < 3; n++)
        await f.receive(f.input({ title: `Stable source message ${n}` }));
    const before = await f.storage(async (store) => await store.read(async (tx) => await tx.find('perception_states'))), oldCount = (await f.unread()).count.value;
    const expected = (await f.listAll(messages(undefined, { limit: 50 }))).records, input = messages(undefined, { limit: 1 }), first = await f.read('POST', '/list', input), records = [...first.records];
    for (const record of expected.slice(0, 2)) {
        const body = await f.detail(record.ref);
        await f.read('PUT', '/agent-read-state', { protocolVersion: 1, operationId: randomUUID(), ref: record.ref, contentVersion: 1, completionToken: body.final.completionToken });
    }
    let page = first;
    while (!page.complete) {
        page = await f.read('POST', '/list', { ...input, pageToken: page.nextPageToken });
        records.push(...page.records);
    }
    assert.deepEqual(records.map(row => row.ref), expected.map(row => row.ref));
    assert.equal(new Set(records.map(row => row.ref.id)).size, 3);
    assert.equal(records[1].agentReadState.confirmedContentVersion, 1);
    assert.equal(records[1].agentReadState.stateVersion, 1);
    assert.equal(records[2].agentReadState.confirmedContentVersion, null);
    assert.deepEqual(await f.storage(async (store) => await store.read(async (tx) => await tx.find('perception_states'))), before);
    assert.equal((await f.unread()).count.value, oldCount);
});
await test('WM-CR08: Agent confirmation does not interrupt an owner frozen list or an already-started body', async (t) => {
    const f = await messageFixture(t);
    await f.receive(f.input());
    await f.receive(f.input());
    const input = messages(f.a.agentId, { limit: 1 }), first = await f.read('POST', '/list', input, f.owner.sessionToken), ref = first.records[0].ref;
    const detailInput = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref }, part = await f.read('POST', '/detail', detailInput, f.owner.sessionToken), pieces = [part.content.text];
    assert(part.nextContentToken);
    const body = await f.detail(ref), confirmed = await f.read('PUT', '/agent-read-state', { protocolVersion: 1, operationId: randomUUID(), ref, contentVersion: 1, completionToken: body.final.completionToken });
    let current = part;
    while (!current.contentComplete) {
        current = await f.read('POST', '/detail', { ...detailInput, contentToken: current.nextContentToken }, f.owner.sessionToken);
        pieces.push(current.content.text);
        assert.equal(current.agentReadState, undefined);
        assert.equal(current.completionToken, undefined);
    }
    assert.equal(pieces.join(''), body.segments.map(segment => segment.content.text).join(''));
    const second = await f.read('POST', '/list', { ...input, pageToken: first.nextPageToken }, f.owner.sessionToken);
    assert.equal(second.complete, true);
    assert.notEqual(second.records[0].ref.id, ref.id);
    assert(second.records.every((row: Json) => row.agentReadState === undefined));
    const state = await f.queryState(ref);
    assert.equal(state.confirmedContentVersion, confirmed.confirmedContentVersion);
    assert.equal(state.stateVersion, 1);
});
await test('WM-CR08: independent full-body completion proofs survive pure confirmation without an extra state transition', async (t) => {
    const f = await messageFixture(t), received = await f.receive(f.input()), ref = received.ref as any, detailInput = { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref };
    const partial = await f.read('POST', '/detail', detailInput), one = await f.detail(ref), two = await f.detail(ref), input = { protocolVersion: 1, operationId: randomUUID(), ref, contentVersion: 1, completionToken: one.final.completionToken }, first = await f.read('PUT', '/agent-read-state', input);
    const continued = await f.read('POST', '/detail', { ...detailInput, contentToken: partial.nextContentToken });
    assert.equal(continued.segment.start, partial.segment.end);
    assert.equal(continued.agentReadState.confirmedContentVersion, 1);
    const second = await f.read('PUT', '/agent-read-state', { ...input, operationId: randomUUID(), completionToken: two.final.completionToken });
    assert.equal(second.changed, false);
    assert.equal(second.stateVersion, first.stateVersion);
    assert.equal(second.confirmedAt, first.confirmedAt);
    assert.deepEqual(await f.read('PUT', '/agent-read-state', input), first);
});
for (const change of ['delivery', 'owner-layer', 'binding', 'sender', 'body', 'source'] as const)
    await test(`WM-CR08: ${change} changes still invalidate frozen message observations after a pure confirmation`, async (t) => {
        const f = await messageFixture(t), sourceInputs = [f.input(), f.input()];
        await eachAsync(sourceInputs, async (input) => await f.receive(input));
        const runtimeInput = messages(undefined, { limit: 1 }), humanInput = messages(f.a.agentId, { limit: 1 }), runtimePage = await f.read('POST', '/list', runtimeInput), humanPage = await f.read('POST', '/list', humanInput, f.owner.sessionToken), ref = runtimePage.records[0].ref;
        const runtimeBody = { ...requestBase('inbox', { purpose: 'agent-inspect' }), ref }, humanBody = { ...requestBase('inbox', { purpose: 'human-inspect' }), agentRef: agentRef(f.a.agentId), ref }, rp = await f.read('POST', '/detail', runtimeBody), hp = await f.read('POST', '/detail', humanBody, f.owner.sessionToken), full = await f.detail(ref), confirm = { protocolVersion: 1, operationId: randomUUID(), ref, contentVersion: 1, completionToken: full.final.completionToken };
        await f.read('PUT', '/agent-read-state', confirm);
        const before = await f.queryState(ref);
        if (change === 'delivery' || change === 'owner-layer')
            await f.storage(async (store) => await store.transaction(async (tx) => { const receipt = (await mailboxRepository(tx).receipt(ref.id, f.a.agentId))!; await saveMailboxReceipt(tx, { ...receipt, version: receipt.version + 1, data: { ...receipt.data, ...(change === 'delivery' ? { active: false } : { ownerObservation: { existence: true, summary: true, body: false, attachments: false } }) } }, receipt); }));
        if (change === 'binding')
            await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.find('bindings', { agentId: f.a.agentId, active: true }))[0]!; await tx.update('bindings', { ...row, version: row.version + 1, data: { ...row.data, ownerId: f.otherOwner.ownerId } }, row.version); }));
        if (change === 'sender') {
            const p = await ok(f.m1, 'GET', `/agents/${f.sibling.agentId}/profile`, undefined, f.owner.sessionToken);
            await ok(f.m1, 'POST', `/agents/${f.sibling.agentId}/profile/unpublish`, { operationId: randomUUID(), expectedVersion: p.version, expectedPolicyVersion: p.policyVersion }, f.owner.sessionToken);
        }
        if (change === 'body') {
            const sourceKey = await f.storage(async (store) => await store.read(async (tx) => { const repo = mailboxRepository(tx); return (await repo.message((await repo.receipt(ref.id, f.a.agentId))!.data.messageVersionId))!.data.sourceMessageKey; })), original = sourceInputs.find(input => input.sourceMessageKey === sourceKey)!;
            await f.receive({ ...original, contentVersion: 2, body: 'A genuinely new immutable message body.' });
        }
        if (change === 'source')
            await f.storage(async (store) => await store.transaction(async (tx) => { const row = (await tx.get('perception_catalog', 'current'))!; await tx.update('perception_catalog', { ...row, version: row.version + 1, data: { ...row.data, sourceStates: { ...(row.data.sourceStates as JsonObject), 'direct-messages': 'not_enabled' } } }, row.version); }));
        const hpResult = await f.call('POST', '/detail', { ...humanBody, contentToken: hp.nextContentToken }, f.owner.sessionToken), hlResult = await f.call('POST', '/list', { ...humanInput, pageToken: humanPage.nextPageToken }, f.owner.sessionToken);
        assert(hpResult.status >= 400);
        assert(hlResult.status >= 400);
        assert.equal(hpResult.data, undefined);
        assert.equal(hlResult.data, undefined);
        if (change !== 'binding') {
            assert((await f.call('POST', '/list', { ...runtimeInput, pageToken: runtimePage.nextPageToken })).status >= 400);
            if (change !== 'owner-layer')
                assert((await f.call('POST', '/detail', { ...runtimeBody, contentToken: rp.nextContentToken })).status >= 400);
        }
        if (['delivery', 'owner-layer', 'body', 'source'].includes(change))
            assert((await f.call('PUT', '/agent-read-state', { ...confirm, operationId: randomUUID() })).status >= 400);
        const receipt = await f.storage(async (store) => await store.read(async (tx) => (await mailboxRepository(tx).receipt(ref.id, f.a.agentId))!));
        assert.equal(receipt.data.confirmedContentVersion, before.confirmedContentVersion);
        assert.equal(receipt.data.stateVersion, before.stateVersion);
    });
