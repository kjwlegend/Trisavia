import {legacyCopy} from './legacy-copy.ts';
import {installSqlFault,removeSqlFault} from './pg-faults.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { M1_TABLES } from '../../apps/platform/contracts/store.ts';
import { publishPerceptionGuide, updatePerceptionDemoObject } from '../../apps/platform/application/perception-admin.ts';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { runSeed } from '../../scripts/ws02-demo-data.ts';
import type { Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, requestBase, type Ref } from './helpers.ts';
await test('administrative publications require a fresh catalog revision and persist one exact original receipt and fact', async (t) => {
    const f = await fixture(t), first = await f.read('GET', '/discovery?limit=50'), original = await f.read('GET', '/guides/world?version=1');
    const nextVersion = first.modules.find((module: Json) => module.moduleId === 'world').usageGuide.version + 1;
    const invalid = { operationId: randomUUID(), actorId: 'isolated-administrator', expectedCatalogRevision: first.catalogRevision,
        revision: first.catalogRevision, guideVersion: nextVersion, guideText: 'A genuinely changed guide must have a discoverable revision.' };
    await assert.rejects(async () => await f.storage(async (store) => await publishPerceptionGuide(store, invalid)), { code: 'version_conflict' });
    assert.equal((await f.read('GET', '/discovery?limit=50')).catalogRevision, first.catalogRevision);
    assert.equal((await f.call('GET', `/guides/world?version=${nextVersion}`)).status, 404);
    const input = { ...invalid, operationId: randomUUID(), revision: 'audited-catalog-2' };
    const published = await f.storage(async (store) => await publishPerceptionGuide(store, input));
    assert.deepEqual(await f.storage(async (store) => await publishPerceptionGuide(store, input)), published);
    await assert.rejects(async () => await f.storage(async (store) => await publishPerceptionGuide(store, { ...input, guideText: 'Changed payload on the same operation is forbidden.' })), { code: 'operation_id_conflict' });
    const current = await f.read('GET', '/discovery?limit=50');
    assert.notEqual(current.catalogRevision, first.catalogRevision);
    assert.notEqual(current.skillCatalogRevision, first.skillCatalogRevision);
    assert.deepEqual(await f.read('GET', '/guides/world?version=1'), original);
    assert.equal((await f.read('GET', `/guides/world?version=${nextVersion}`)).version, nextVersion);
    assert.equal(await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_access', { operationId: input.operationId })).length)), 1);
    const items = await f.listAll(requestBase('world', { categoryId: 'items', limit: 5 })), ref = items.records[0]!.ref as Ref;
    const update = { operationId: randomUUID(), actorId: 'isolated-administrator', expectedVersion: items.records[0]!.version, ref,
        body: 'An actual administrative demo-source revision, not an Agent action.' };
    const edited = await f.storage(async (store) => await updatePerceptionDemoObject(store, update));
    assert.deepEqual(await f.storage(async (store) => await updatePerceptionDemoObject(store, update)), edited);
    assert.equal(edited.version, update.expectedVersion + 1);
    assert.equal((await f.detail(ref, 'world')).final.version, edited.version);
    assert.equal(await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_access', { operationId: update.operationId })).length)), 1);
    const human = await f.read('GET', '/discovery?limit=50', undefined, f.owner.sessionToken);
    for (const directory of [current, human]) {
        assert(!directory.operations.some((row: Json) => ['updateDemoObject', 'publishGuide', 'seedWs02DemoData'].includes(row.id)), 'Local administrative functions do not become runtime or owner HTTP authority');
    }
});
await test('seed rejects mismatched identity and invalid operator before any writable migration or recovery-epoch change', async (t) => {
    const f = await fixture(t), path = join(f.directory, 'unseeded-schema4.sqlite'), paired = join(f.directory, 'paired.identity.json');
    const tables=M1_TABLES.filter(table=>!table.startsWith('perception_')&&!['wallet_accounts','mailbox_messages','mailbox_receipts'].includes(table));
    await f.storage(store=>legacyCopy(store,path,4,tables));
    const identity = { version: 1, instanceId: f.options.instanceId, recoveryEpoch: f.options.recoveryEpoch };
    await writeFile(paired, JSON.stringify(identity), { mode: 0o600 });
    const wrongInstance = join(f.directory, 'wrong-instance.identity.json'), wrongEpoch = join(f.directory, 'wrong-epoch.identity.json');
    await writeFile(wrongInstance, JSON.stringify({ ...identity, instanceId: `instance_${randomUUID()}` }), { mode: 0o600 });
    await writeFile(wrongEpoch, JSON.stringify({ ...identity, recoveryEpoch: `epoch_${randomUUID()}` }), { mode: 0o600 });
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const snapshot = () => {
        const database = new DatabaseSync(path, { readOnly: true });
        try {
            return digest({ identity: database.prepare('SELECT * FROM instance_state').all(),
                migrations: database.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
                tables: Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()])) });
        }
        finally {
            database.close();
        }
    };
    const bytes = await readFile(path), rows = snapshot(), identityBytes = await readFile(paired);
    for (const [index, selected, operator] of [
        [0, wrongInstance, 'isolated-administrator'], [1, wrongEpoch, 'isolated-administrator'],
        [2, paired, null], [3, paired, 'invalid operator!'],
    ] as const) {
        const manifest = join(f.directory, `must-not-exist-${index}.json`);
        await assert.rejects(runSeed(['--database', path, '--identity', selected, '--manifest', manifest,
            ...(operator ? ['--operator', operator] : [])]));
        assert((await readFile(path)).equals(bytes), 'Rejected seed must leave the schema-4 database bytes unchanged');
        assert.equal(snapshot(), rows, 'Rejected seed must preserve all legacy rows, schema history and the paired epoch');
        assert((await readFile(paired)).equals(identityBytes), 'Rejected seed must not rewrite the paired identity');
        await assert.rejects(stat(manifest), { code: 'ENOENT' });
    }
});
await test('administrative edits and guide publication roll back source history, current version, receipt and fact on real SQL faults', async (t) => {
    const f = await fixture(t), items = await f.listAll(requestBase('world', { categoryId: 'items', limit: 5 }));
    const ref = items.records[0]!.ref as Ref;
    const source = await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_objects')).find(row => JSON.stringify(row.data.ref) === JSON.stringify(ref))));
    assert(source);
    const snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => createHash('sha256').update(JSON.stringify({
        objects: await tx.find('perception_objects'), catalog: await tx.find('perception_catalog'), access: await tx.find('perception_access'),
    })).digest('hex')));
    const edit = { operationId: randomUUID(), actorId: 'isolated-administrator', ref, expectedVersion: source.version, body: 'A transactional new body.' };
    const catalog = await f.read('GET', '/discovery?limit=50');
    const guide = { operationId: randomUUID(), actorId: 'isolated-administrator', expectedCatalogRevision: catalog.catalogRevision,
        revision: 'atomic-guide-2', guideVersion: catalog.modules.find((module: Json) => module.moduleId === 'world').usageGuide.version + 1, guideText: 'This new guide and its publication fact must commit together.' };
    const cases = [
        { table: 'perception_access', when: "json_extract(NEW.data,'$.actor.kind')='administrator'", run: async () => await f.storage(async (store) => await updatePerceptionDemoObject(store, edit)), input: edit },
        { table: 'perception_catalog', when: "json_extract(NEW.data,'$.kind')='administrative_receipt'", run: async () => await f.storage(async (store) => await publishPerceptionGuide(store, guide)), input: guide },
    ];
    for (const operation of cases) {
        const before=await snapshot();await installSqlFault(f,operation.table);
        try {
            await assert.rejects(operation.run);
            assert.equal(await snapshot(), before, 'Source/history/catalog and the administrative receipt/fact must all roll back');
        }
        finally {
            await removeSqlFault(f,operation.table);
        }
        const committed = await operation.run();
        assert.equal(committed.outcome, 'committed');
        assert.deepEqual(await operation.run(), committed, 'The same original command can retry after a rolled-back storage fault');
        assert.equal(await f.storage(async (store) => await store.read(async (tx) => (await tx.find('perception_access', { operationId: operation.input.operationId })).length)), 1);
    }
    const history = await f.storage(async (store) => await store.read(async (tx) => await tx.find('perception_catalog', { kind: 'object_history', objectId: source.id, contentVersion: source.version })));
    assert.equal(history.length, 1);
    assert.deepEqual(history[0]!.data.content, source.data);
    await assert.rejects(async () => await f.storage(async (store) => await updatePerceptionDemoObject(store, { ...edit, operationId: randomUUID() })), { code: 'version_conflict' });
    await assert.rejects(async () => await f.storage(async (store) => await updatePerceptionDemoObject(store, { ...edit, body: 'A different payload must not replace the committed operation.' })), { code: 'operation_id_conflict' });
    await assert.rejects(async () => await f.storage(async (store) => await publishPerceptionGuide(store, { ...guide, operationId: randomUUID(), revision: 'stale-guide-3', guideVersion: 3 })), { code: 'version_conflict' });
});
await test('a historical catalog revision cannot be reused with a new guide while its original operation still replays precisely', async (t) => {
    const f = await fixture(t), initial = await f.read('GET', '/discovery?limit=50');
    const version = initial.modules.find((row: Json) => row.moduleId === 'world').usageGuide.version;
    const a = { operationId: randomUUID(), actorId: 'isolated-administrator', expectedCatalogRevision: initial.catalogRevision,
        revision: 'immutable-revision-a', guideVersion: version + 1, guideText: 'Publication A.' };
    const receiptA = await f.storage(async (store) => await publishPerceptionGuide(store, a));
    const b = { ...a, operationId: randomUUID(), expectedCatalogRevision: a.revision,
        revision: 'immutable-revision-b', guideVersion: version + 2, guideText: 'Publication B.' };
    await f.storage(async (store) => await publishPerceptionGuide(store, b));
    const snapshot = async () => await f.storage(async (store) => await store.read(async (tx) => createHash('sha256').update(JSON.stringify({
        catalog: await tx.find('perception_catalog'), access: await tx.find('perception_access'),
    })).digest('hex')));
    const before = await snapshot();
    await assert.rejects(async () => await f.storage(async (store) => await publishPerceptionGuide(store, { ...a, operationId: randomUUID(),
        expectedCatalogRevision: b.revision, guideVersion: version + 3, guideText: 'Silently replacing the old revision A is forbidden.' })), { code: 'version_conflict' });
    assert.equal(await snapshot(), before, 'Rejected historical revision reuse cannot leave a guide, catalog, receipt or administrative fact');
    assert.deepEqual(await f.storage(async (store) => await publishPerceptionGuide(store, a)), receiptA, 'The original operation receipt remains a historical result before the newer catalog CAS');
    assert.equal((await f.read('GET', '/discovery?limit=50')).catalogRevision, b.revision);
});
