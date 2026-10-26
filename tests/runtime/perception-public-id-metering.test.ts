import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {worldFixture} from './postgresql-fixture.ts';
import {buildApp} from '../../apps/platform/app.ts';
import {openRuntimeStore} from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {prepareTownItemDefinitions} from '../../apps/platform/infrastructure/postgresql/service-inventory-repository.ts';
import {publishNpcServiceReaders} from '../../apps/platform/application/perception-admin.ts';
import {catalogRepository,contentRepository} from '../../apps/platform/domains/perception/repository.ts';
import {refId} from '../../apps/platform/domains/perception/protocol.ts';
import {RESIDENT_GIFT_REPOSITORY} from '../../apps/platform/domains/town-services/resident-gift.ts';
import {SERVICE_INVENTORY_REPOSITORY} from '../../apps/platform/domains/town-services/repository.ts';
import {readPublicId} from '../../apps/platform/domains/public-identifiers/repository.ts';
import {agentFixture,ownerFixture,injectApi,type Json} from '../../scripts/agent-manager-qa-fixture.ts';

test('real PG metered card and public profile reads retain public IDs, row budgets and current Owner isolation', {skip:!process.env.WORLD_CORE_TEST_RUNTIME},async()=>{
 const f=await worldFixture();let app:Awaited<ReturnType<typeof buildApp>>|undefined,admin:Awaited<ReturnType<typeof openRuntimeStore>>|undefined;
 const resource=JSON.parse(await readFile(join(f.privateConnections,'created-database.json'),'utf8'));
 console.info(JSON.stringify({resource:'perception_public_id_metering',database:f.database,oid:resource.oid,creator:resource.creator,created:true}));
 try{
  await f.legacy.transaction(prepareTownItemDefinitions);
  const current=(await f.legacy.read(tx=>catalogRepository(tx).get('current')))!;
  await publishNpcServiceReaders(f.legacy,{actorId:'synthetic-card-reader',operationId:randomUUID(),expectedInstanceId:f.identity.instanceId,expectedRecoveryEpoch:f.identity.recoveryEpoch,expectedCatalogRevision:String(current.data.catalogRevision),revision:'catalog-npc-services-1',expectedGuideVersion:Number(current.data.guideVersion),guideVersion:Number(current.data.guideVersion)+1});
  app=await buildApp({...f.options,clock:f.now,email:{mode:'experience'}});
  const api=injectApi(app),owner=await ownerFixture(api,'MeterOwner'),other=await ownerFixture(api,'MeterOther'),agent=await agentFixture(api,owner,'计量读取测试居民','blue');
  const publicId=await f.legacy.read(tx=>readPublicId(tx,'agent',agent.agentId));
  // Explicit isolated maintenance fixture: one real source-backed card, no welcome claim, reward or other item.
  admin=await openRuntimeStore({...f.migrationOptions,now:f.now});
  const card=await admin.transaction(async ctx=>{
   const gift=await ctx.repository(RESIDENT_GIFT_REPOSITORY).ensure({id:randomUUID(),agentId:agent.agentId,createdAt:ctx.now(),sourceOperationId:null,initiatorKind:'administrator',initiatorId:'synthetic-card-reader'}),id=randomUUID();
   await ctx.repository(SERVICE_INVENTORY_REPOSITORY).issue({id,version:1,agentId:agent.agentId,kind:'resident_card',state:'available',sourceGiftId:gift.id,sourceOperationId:null,issuedAt:ctx.now(),updatedAt:ctx.now(),reservationId:null,consumedBy:null,holdingId:'town-holding:'+id,residentCard:{agentId:agent.agentId,displayName:agent.name,firstWorldJoinedAt:null,issuedAt:ctx.now()}});
   return {holdingId:'town-holding:'+id};
  });await admin.close();admin=undefined;
  const before=await f.runtime.read(ctx=>ctx.repository(SERVICE_INVENTORY_REPOSITORY).findResidentCard(agent.agentId));assert(before);
  const ref={moduleId:'inventory',type:'inventory.holding@1',id:card.holdingId},personRef={moduleId:'profiles',type:'profiles.agent@1',id:agent.agentId};
  const call=async(operation:string,input:Json,token:string)=>{
   const response=await app!.inject({method:'POST',url:'/v1/perception/'+operation,headers:{authorization:'Bearer '+token},payload:{protocolVersion:1,consumerId:'synthetic-metered-reader',...input}});
   return{status:response.statusCode,body:response.json() as Json};
  };
  const read=async(operation:string,input:Json,token:string)=>{const response=await call(operation,input,token);assert.equal(response.status,200,JSON.stringify(response.body.error));return response.body.data as Json;};
  for(const [token,purpose,selector]of [[owner.sessionToken,'human-inspect',{agentRef:personRef}],[agent.runtimeToken,'agent-inspect',{}]] as const){
   const input={purpose,channel:'inventory',...selector},list=await read('list',{...input,categoryId:'holdings'},token);assert.equal(list.records.length,1);assert.deepEqual(list.records[0].ref,ref);assert.equal(list.records[0].summary.quantity,1);assert.equal(list.complete,true);
   const detail=await read('detail',{...input,ref},token);assert.match(detail.content.text,new RegExp('居民编号：'+publicId));assert.match(detail.content.text,/首次加入：未记录/);assert.match(detail.content.text,new RegExp(new Date(before.issuedAt).toISOString()));
  }
  // The same wrapped publicAgent path serves both Owner and runtime world lists/details.
  for(const [token,purpose]of [[owner.sessionToken,'human-inspect'],[agent.runtimeToken,'agent-inspect']] as const){
   const list=await read('list',{purpose,channel:'world',categoryId:'people',metricId:'agents'},token);assert.equal(list.records.length,1);assert.equal(list.records[0].summary.fields.publicId,publicId);
   const detail=await read('detail',{purpose,channel:'world',ref:personRef},token);assert.equal(detail.content.fields.publicId,publicId);
   const overview=await read('overview',{purpose,categoryIds:['people']},token);const metric=overview.sections[0].metrics.find((m:Json)=>m.metricId==='agents');assert.equal(metric.status,'available');assert.equal(metric.count.value,1);
  }
  const inventoryOverview=await read('overview',{purpose:'agent-inspect',categoryIds:['holdings']},agent.runtimeToken);assert.equal(inventoryOverview.sections[0].metrics[0].count.value,1);
  // Holding + item definition spend two rows; the public-ID lookup must spend a third.
  const bounded={purpose:'human-inspect',channel:'inventory',categoryId:'holdings',agentRef:personRef};
  const exhausted=await call('list',{...bounded,budget:{maxScannedRows:2}},owner.sessionToken);assert.equal(exhausted.status,422);assert.equal(exhausted.body.error.code,'budget_too_small');assert.equal(exhausted.body.data,undefined);
  const exact=await read('list',{...bounded,budget:{maxScannedRows:3}},owner.sessionToken);assert.equal(exact.records.length,1);
  // A publication's related-person lookup uses the second metered reader in detail().
  const publicationRef={moduleId:'world',type:'world.occurrence@1',id:'synthetic-metered-person-publication'};
  await f.legacy.transaction(tx=>contentRepository(tx).insert({id:refId(publicationRef),version:1,data:{ref:publicationRef,moduleId:'world',type:publicationRef.type,refId:publicationRef.id,categoryId:'events',metricId:'occurrences',channel:'world',sourceId:'platform-publications',title:'合成居民资料关联',body:'仅供隔离读取预算验证。',public:true,active:true,available:true,dataMode:'platform',attachments:[],eventKind:'occurrence',status:'committed',occurredAt:f.now(),publishedRefs:[personRef],actor:{kind:'administrator',id:'synthetic-card-reader'},source:{kind:'administrative_publication',administrator:'synthetic-card-reader',publishedAt:f.now()}}}));
  const publicationInput={purpose:'human-inspect',channel:'world',ref:publicationRef};
  const shortRelated=await call('detail',{...publicationInput,budget:{maxScannedRows:3}},owner.sessionToken);assert.equal(shortRelated.status,422);assert.equal(shortRelated.body.error.code,'budget_too_small');assert.equal(shortRelated.body.data,undefined);
  const related=await read('detail',{...publicationInput,budget:{maxScannedRows:5}},owner.sessionToken);assert.deepEqual(related.content.publication.relatedItems,[{ref:personRef,title:agent.name}]);
  const linkedPerson=await read('detail',{purpose:'human-inspect',channel:'world',ref:related.content.publication.relatedItems[0].ref},owner.sessionToken);assert.equal(linkedPerson.content.fields.publicId,publicId);
  for(const [operation,input]of [['list',bounded],['detail',{purpose:'human-inspect',channel:'inventory',agentRef:personRef,ref}]] as const){const denied=await call(operation,input,other.sessionToken);assert.equal(denied.status,404);assert.equal(denied.body.error.code,'target_not_accessible');assert.equal(denied.body.data,undefined);}
  assert.deepEqual(await f.runtime.read(ctx=>ctx.repository(SERVICE_INVENTORY_REPOSITORY).findResidentCard(agent.agentId)),before,'Reads never rewrite original card issue facts');
 }finally{
  try{await admin?.close();await app?.close();}finally{await f.dispose();console.info(JSON.stringify({resource:'perception_public_id_metering',database:f.database,oid:resource.oid,creator:resource.creator,dropped:true}));}
 }
});
