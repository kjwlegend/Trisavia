import { catalogRepository, accessFactRepository, contentRepository } from '../domains/perception/repository.ts';
import { randomUUID } from 'node:crypto';
import type { JsonObject, M1Store, M1Transaction } from '../contracts/store.ts';
import { fail } from '../domains/common/errors.ts';
import { key, plain, refId,OPERATIONS,TYPE_DEFINITIONS, type ObjectRef } from '../domains/perception/protocol.ts';
import { publishCatalogInTransaction, publishImplementedReadersInTransaction, IMPLEMENTED_READER_SOURCES,initializePerceptionCatalog } from './perception-catalog.ts';
import {PERCEPTION_SCHEMA_VERSION} from '../domains/perception/schemas.ts';
import {APPEARANCE_CATALOG_VERSION,APPEARANCE_CATALOG_DIGEST,APPEARANCE_ASSET_VERSION} from '../domains/profile/appearance-catalog.ts';
interface AdministrativeCommand {
    operationId: string;
    actorId: string;
    now?: () => number;
}
async function command(store: M1Store, options: AdministrativeCommand, payload: JsonObject, work: (tx: M1Transaction, stamp: number) => Promise<JsonObject>): Promise<JsonObject> {
    if (!/^[A-Za-z0-9_.:@-]{1,100}$/.test(options.actorId) || !/^.{8,100}$/u.test(options.operationId))
        throw new Error('Explicit administrative actor and operation ID are required');
    return await store.transaction(async (tx) => {
        const id = `admin-operation:${key({ actorId: options.actorId, operationId: options.operationId })}`, prior = await catalogRepository(tx).get(id), digest = key(payload);
        if (prior) {
            if (prior.data.payloadHash !== digest)
                fail('operation_id_conflict', 409, 'Administrative operation payload changed');
            return plain(prior.data.result);
        }
        if (await catalogRepository(tx).countByKind('administrative_receipt', 10001) >= 10000)
            fail('storage_capacity', 503, 'Administrative receipt capacity is exhausted');
        const stamp = (options.now ?? Date.now)(), result: JsonObject = { ...await work(tx, stamp), operationId: options.operationId, actor: { kind: 'administrator', id: options.actorId }, outcome: 'committed', receiptId: randomUUID(), serverTime: stamp };
        await catalogRepository(tx).insert({ id, version: 1, data: { kind: 'administrative_receipt', payloadHash: digest, result } });
        const factId = `${String(stamp).padStart(16, '0')}_admin_${randomUUID()}`;
        await accessFactRepository(tx).insert({ id: factId, version: 1, data: { recordId: factId, actor: { kind: 'administrator', id: options.actorId }, agentId: null, humanAudienceOwnerId: null, operationId: options.operationId, receivedAt: stamp, recordedAt: stamp, targets: result.ref ? [result.ref] : [], declaration: null, result: { status: 'business_committed', recordedAt: stamp, sourceReceiptRef: result.receiptId!, changed: result.changed! } } });
        return result;
    });
}
/** Privileged process operation, never registered as an HTTP or runtime capability. */
export async function updatePerceptionDemoObject(store: M1Store, options: AdministrativeCommand & {
    ref: ObjectRef;
    expectedVersion: number;
    body?: string;
    title?: string;
}): Promise<JsonObject> {
    if (!Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 1 || (options.body === undefined && options.title === undefined) ||
        (options.body !== undefined && (typeof options.body !== 'string' || options.body.length > 100000)) || (options.title !== undefined && (typeof options.title !== 'string' || !options.title.trim() || options.title.length > 180)))
        throw new Error('A bounded explicit demo edit is required');
    const payload: JsonObject = { action: 'updateDemoObject', ref: options.ref, expectedVersion: options.expectedVersion, ...(options.body !== undefined ? { body: options.body } : {}), ...(options.title !== undefined ? { title: options.title } : {}) };
    return await command(store, options, payload, async (tx, stamp) => {
        const row = await contentRepository(tx).get(refId(options.ref));
        if (!row || row.data.dataMode !== 'demo')
            fail('target_not_accessible', 404, 'Only the specified demonstration source may be edited');
        if (row.version !== options.expectedVersion)
            fail('version_conflict', 409, 'Demonstration content changed');
        const next = { ...row.data, ...(options.body !== undefined ? { body: options.body } : {}), ...(options.title !== undefined ? { title: options.title } : {}) };
        const changed = key(next) !== key(row.data);
        if (changed) {
            const historyId = `object-history:${row.id}:${row.version}`;
            if (!await catalogRepository(tx).get(historyId))
                await catalogRepository(tx).insert({ id: historyId, version: 1, data: { kind: 'object_history', objectId: row.id, contentVersion: row.version, content: row.data, recordedAt: stamp } });
            await contentRepository(tx).replace({ ...row, version: row.version + 1, data: next }, row.version);
        }
        return { ref: options.ref, version: row.version + (changed ? 1 : 0), changed };
    });
}
export async function publishPerceptionGuide(store: M1Store, options: AdministrativeCommand & {
    expectedCatalogRevision: string;
    revision: string;
    guideVersion: number;
    guideText: string;
}): Promise<JsonObject> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(options.revision) || !options.expectedCatalogRevision || !Number.isSafeInteger(options.guideVersion) || options.guideVersion < 1 || typeof options.guideText !== 'string' || options.guideText.length < 1 || options.guideText.length > 20000)
        throw new Error('An explicit versioned guide publication is required');
    const payload: JsonObject = { action: 'publishGuide', expectedCatalogRevision: options.expectedCatalogRevision, revision: options.revision, guideVersion: options.guideVersion, guideText: options.guideText };
    return await command(store, options, payload, async (tx) => {
        const current = await catalogRepository(tx).get('current');
        if (!current || current.data.catalogRevision !== options.expectedCatalogRevision)
            fail('version_conflict', 409, 'Catalog revision changed');
        const changed = current.data.catalogRevision !== options.revision || current.data.guideVersion !== options.guideVersion;
        await publishCatalogInTransaction(tx, options);
        const published = (await catalogRepository(tx).get('current'))!;
        return { catalogRevision: published.data.catalogRevision!, skillCatalogRevision: published.data.skillCatalogRevision!, guideVersion: published.data.guideVersion!, changed };
    });
}
/** Reviewed maintenance release. No arbitrary source, guide text, audience or object grant can be supplied. */
export async function publishImplementedPerceptionReaders(store: M1Store, options: AdministrativeCommand & {
    expectedInstanceId: string;
    expectedRecoveryEpoch: string;
    expectedCatalogRevision: string;
    revision: string;
    guideVersion: number;
}): Promise<JsonObject> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(options.revision) || !/^[A-Za-z0-9_-]{1,100}$/.test(options.expectedCatalogRevision) || !Number.isSafeInteger(options.guideVersion) || options.guideVersion < 1)
        throw new Error('An explicit expected and target catalog revision and guide version are required');
    if (options.expectedInstanceId !== store.instanceId || options.expectedRecoveryEpoch !== store.recoveryEpoch)
        fail('version_conflict', 409, 'The explicit target instance or recovery epoch differs');
    const payload: JsonObject = { action: 'publishImplementedReaders', release: 'ws02-implemented-readers@1', instanceId: store.instanceId, recoveryEpoch: store.recoveryEpoch, expectedCatalogRevision: options.expectedCatalogRevision, revision: options.revision, guideVersion: options.guideVersion, sourceIds: [...IMPLEMENTED_READER_SOURCES] };
    return await command(store, options, payload, async (tx, stamp) => ({ instanceId: store.instanceId, recoveryEpoch: store.recoveryEpoch, ...await publishImplementedReadersInTransaction(tx, { ...options, stamp }) }));
}

/** Explicit read-shape publication only; never seeds objects, changes source states or grants. */
export async function publishProfileAppearanceCatalog(store:M1Store,options:AdministrativeCommand&{
    expectedInstanceId:string;expectedRecoveryEpoch:string;expectedCatalogRevision:string;revision:string;expectedGuideVersion:number;guideVersion:number;
}):Promise<JsonObject>{
    if(options.expectedInstanceId!==store.instanceId||options.expectedRecoveryEpoch!==store.recoveryEpoch)fail('version_conflict',409,'The explicit target instance or recovery epoch differs');
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(options.expectedCatalogRevision)||options.revision!==`${options.expectedCatalogRevision.slice(0,85)}-schema-5`||!Number.isSafeInteger(options.expectedGuideVersion)||options.expectedGuideVersion<1||options.guideVersion!==options.expectedGuideVersion+1)throw new Error('An explicit schema4 to schema5 publication and next guide version are required');
    const payload:JsonObject={action:'publishProfileAppearanceCatalog',release:'ws01-profile-appearance@1',instanceId:store.instanceId,recoveryEpoch:store.recoveryEpoch,expectedCatalogRevision:options.expectedCatalogRevision,revision:options.revision,expectedGuideVersion:options.expectedGuideVersion,guideVersion:options.guideVersion,schemaVersion:PERCEPTION_SCHEMA_VERSION,catalogVersion:APPEARANCE_CATALOG_VERSION,catalogDigest:APPEARANCE_CATALOG_DIGEST,assetVersion:APPEARANCE_ASSET_VERSION};
    return await command(store,options,payload,async tx=>{
        const current=await catalogRepository(tx).get('current');
        if(!current||current.data.schemaVersion!==4||current.data.catalogRevision!==options.expectedCatalogRevision||current.data.guideVersion!==options.expectedGuideVersion)fail('version_conflict',409,'The expected schema4 catalog or guide changed');
        const modules=['perception','world','profiles','items','inventory','mailbox','wallet'];
        const schemaIds=[...OPERATIONS.flatMap(operation=>[`perception.${operation.id}-query`,`perception.${operation.id}-result`]),...TYPE_DEFINITIONS.flatMap(type=>[`${type.prefix}-summary`,`${type.prefix}-detail`]),'perception.error-result'];
        for(const moduleId of modules)if(await catalogRepository(tx).get(`guide:${moduleId}:${options.guideVersion}`))fail('version_conflict',409,'The new exact guide version is occupied');
        for(const schemaId of schemaIds)if(await catalogRepository(tx).get(`schema:${schemaId}:5`))fail('version_conflict',409,'The new exact schema version is occupied');
        await initializePerceptionCatalog(tx,{revision:options.revision,guideVersion:options.guideVersion});
        const published=(await catalogRepository(tx).get('current'))!;
        if(key(published.data.sourceStates)!==key(current.data.sourceStates)||key(published.data.seedObjectIds)!==key(current.data.seedObjectIds))fail('version_conflict',409,'Read-shape publication cannot change source availability or contents');
        return {...payload,changed:true,catalogRevisionBefore:current.data.catalogRevision!,catalogRevision:published.data.catalogRevision!,skillCatalogRevision:published.data.skillCatalogRevision!,guideVersionBefore:current.data.guideVersion!,guideVersion:published.data.guideVersion!,schemaVersionBefore:4,schemaVersion:5,newSchemaDocuments:schemaIds.length,newGuideDocuments:modules.length};
    });
}
