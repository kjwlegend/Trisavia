import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {publishProfileAppearanceCatalog} from '../../apps/platform/application/perception-admin.ts';
import {verifyApplicationReadiness} from '../../apps/platform/application/bootstrap.ts';
import {StorageError,M1_TABLES,type M1Store,type M1Transaction,type M1Table,type StoredRow} from '../../apps/platform/contracts/store.ts';

/** Pure transaction/rollback fixture. The separate HTTP/maintenance tests use real PostgreSQL. */
function memory(){
 let tables=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(table=>[table,new Map()])),enabled=true;
 const filtered=(table:M1Table,filters:Record<string,unknown>={})=>[...tables.get(table)!.values()].filter(row=>Object.entries(filters).every(([key,value])=>row.data[key]===value)).sort((a,b)=>a.id<b.id?-1:1).map(row=>structuredClone(row));
 const tx={get:async(table:M1Table,id:string)=>structuredClone(tables.get(table)!.get(id)),find:async(table:M1Table,filters:Record<string,unknown>)=>filtered(table,filters),scan:async(table:M1Table,filters:Record<string,unknown>,options:{limit:number;afterId?:string})=>filtered(table,filters).filter(row=>!options.afterId||row.id>options.afterId).slice(0,options.limit),count:async(table:M1Table,filters:Record<string,unknown>,limit:number)=>Math.min(limit,filtered(table,filters).length),quotaCount:async()=>0,
 insert:async(table:M1Table,row:StoredRow)=>{assert(!tables.get(table)!.has(row.id));tables.get(table)!.set(row.id,structuredClone(row));return structuredClone(row);},
 update:async(table:M1Table,row:StoredRow,version:number)=>{assert.equal(tables.get(table)!.get(row.id)?.version,version);tables.get(table)!.set(row.id,structuredClone(row));return structuredClone(row);},remove:async(table:M1Table,id:string,version:number)=>{assert.equal(tables.get(table)!.get(id)?.version,version);tables.get(table)!.delete(id);}} as unknown as M1Transaction;
 const store={instanceId:'instance_appearance_publication',recoveryEpoch:'epoch_appearance_publication',read:async(work:(reader:M1Transaction)=>Promise<unknown>)=>await work(tx),transaction:async(work:(writer:M1Transaction)=>Promise<unknown>)=>{if(!enabled)throw new StorageError('busy','Write gate is closed');const before=structuredClone(tables);try{return await work(tx);}catch(error){tables=before;throw error;}},close:async()=>{}} as unknown as M1Store;
 return {store,tx,gate(value:boolean){enabled=value;},snapshot:()=>Object.fromEntries(M1_TABLES.map(table=>[table,filtered(table)])),rows:(table:M1Table)=>filtered(table)};
}
async function legacy(){
 const source=process.env.PROFILE_APPEARANCE_BASELINE_SOURCE;if(!source)throw new Error('An explicit frozen ad5 application source is required');
 const original=await import(pathToFileURL(join(source,'apps/platform/application/perception-catalog.ts')).href),f=memory();await f.store.transaction(original.initializePerceptionCatalog);
 return f;
}
function publication(f:ReturnType<typeof memory>){return {actorId:'isolated-profile-release',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:'catalog-readers-1-schema-4',revision:'catalog-readers-1-schema-4-schema-5',expectedGuideVersion:2,guideVersion:3};}

test('explicit shape publication preserves every exact schema4/guide row and non-catalog fact and replays the original administrative receipt',async()=>{
 const f=await legacy(),options=publication(f);assert.equal((await f.tx.get('perception_catalog','current'))!.data.schemaVersion,4);
 await f.tx.insert('profiles',{id:'historical-profile',version:7,data:{published:{displayName:'Existing person',avatar:{template:'basic',color:'cream'}},draft:{displayName:'Independent proposal',avatar:{template:'basic',color:'blue'}},publishedVersion:4}});
 const before=f.snapshot(),documents=f.rows('perception_catalog').filter(row=>row.id.startsWith('schema:')||row.id.startsWith('guide:'));
 f.gate(false);await assert.rejects(publishProfileAppearanceCatalog(f.store,options),error=>(error as {code:string}).code==='busy');assert.deepEqual(f.snapshot(),before);await assert.rejects(verifyApplicationReadiness(f.store));
 f.gate(true);const result=await publishProfileAppearanceCatalog(f.store,options);assert.equal(result.schemaVersion,5);assert.equal(result.guideVersion,3);assert.equal(result.actor&&typeof result.actor==='object'&&!Array.isArray(result.actor)?result.actor.kind:null,'administrator');
 for(const row of documents)assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 for(const table of M1_TABLES)if(!['perception_catalog','perception_access'].includes(table))assert.deepEqual(f.rows(table),before[table]);
 const current=(await f.tx.get('perception_catalog','current'))!;assert.deepEqual(current.data.sourceStates,(before.perception_catalog!.find(row=>row.id==='current')!).data.sourceStates);assert.equal(current.data.catalogRevision,options.revision);assert.equal(current.data.skillCatalogRevision,'skills-'+options.revision);
 const published=f.snapshot();assert.deepEqual(await publishProfileAppearanceCatalog(f.store,options),result);assert.deepEqual(f.snapshot(),published,'Replaying one operation creates no extra revision, document, receipt or fact');
 const admin=f.rows('perception_access').at(-1)!;assert.equal((admin.data.actor as {kind:string}).kind,'administrator');assert.equal(admin.data.agentId,null);assert.deepEqual(admin.data.targets,[]);
 f.gate(false);await verifyApplicationReadiness(f.store);assert.deepEqual(f.snapshot(),published,'Closed readiness has no publication side effects');
 console.info(JSON.stringify({shapePublication:{oldExactDocumentsPreserved:documents.length,newSchemaVersion:5,newGuideVersion:3,receiptReplayed:true,readinessPure:true}}));
});

test('publication rejects target/revision/guide/operation mismatches and occupied exact versions atomically',async()=>{
 const f=await legacy(),options=publication(f),before=f.snapshot();
 for(const patch of [{expectedInstanceId:'instance_wrong'},{expectedRecoveryEpoch:'epoch_wrong'},{expectedCatalogRevision:'unexpected',revision:'unexpected-schema-5'},{expectedGuideVersion:1,guideVersion:2},{actorId:'not an administrator!'}]){await assert.rejects(publishProfileAppearanceCatalog(f.store,{...options,...patch}));assert.deepEqual(f.snapshot(),before);}
 const occupied={id:'schema:profiles.agent-summary:5',version:1,data:{document:{immutable:'preexisting exact document'},digest:'retained-digest'}};await f.tx.insert('perception_catalog',occupied);const collision=f.snapshot();await assert.rejects(publishProfileAppearanceCatalog(f.store,options));assert.deepEqual(f.snapshot(),collision);await f.tx.remove('perception_catalog',occupied.id,1);
 const result=await publishProfileAppearanceCatalog(f.store,options),after=f.snapshot();assert.equal(result.outcome,'committed');await assert.rejects(publishProfileAppearanceCatalog(f.store,{...options,expectedGuideVersion:3,guideVersion:4}));assert.deepEqual(f.snapshot(),after);
 await assert.rejects(publishProfileAppearanceCatalog(f.store,{...options,operationId:randomUUID()}));assert.deepEqual(f.snapshot(),after);
});
