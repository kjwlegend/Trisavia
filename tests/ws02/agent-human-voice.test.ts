import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {AGENT_HUMAN_VOICE_GUIDE,AGENT_TEXT_EXCHANGE_GUIDE,AGENT_FRIENDSHIP_GUIDE,AGENT_AUTONOMY_GUIDE,AGENT_WORLD_MAP_V2_GUIDE} from '../../apps/platform/application/agent-human-voice.ts';
import {initializePerceptionCatalog,publishPerceptionCatalog} from '../../apps/platform/application/perception-catalog.ts';
import {publishAgentHumanVoiceGuide,publishTextExchangeGuide,publishFriendshipGuide,publishAgentAutonomyGuide,publishWorldMapV2Guide,publishNpcServiceReaders,publishAgentHourlyGuide} from '../../apps/platform/application/perception-admin.ts';
import {CURRENT_HOURLY_AUTONOMY_GUIDE,HOURLY_HOST_GUIDE} from '../../apps/platform/application/agent-hourly-participation-guide.ts';
import {catalogData} from '../../apps/platform/application/perception-catalog.ts';
import {refId} from '../../apps/platform/domains/perception/protocol.ts';
import {TOWN_ITEM_DEFINITIONS} from '../../apps/platform/domains/town-services/catalog.ts';
import {createPerceptionService} from '../../apps/platform/application/perception-service.ts';
import {registerPerceptionRoutes} from '../../apps/platform/transport/http/perception-routes.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {worldGatewayGuide,worldGatewayOperations} from '../../apps/platform/application/agent-gateway-world.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {coreFixture} from '../world/runtime-fixture.ts';
import type {M1Service} from '../../apps/platform/application/m1-service.ts';
import {M1_TABLES,type JsonObject,type M1Store,type M1Transaction,type M1Table,type StoredRow,type RetentionCutoff} from '../../apps/platform/contracts/store.ts';

/** Isolated transaction/rollback store. No current service, credentials, files or database are used. */
function memory(){
 let tables=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(table=>[table,new Map()]));
 const rows=(table:M1Table,filters:Record<string,unknown>={})=>[...tables.get(table)!.values()].filter(row=>Object.entries(filters).every(([key,value])=>row.data[key]===value)).sort((a,b)=>a.id.localeCompare(b.id)).map(row=>structuredClone(row));
 const tx={get:async(table:M1Table,id:string)=>structuredClone(tables.get(table)!.get(id)),find:async(table:M1Table,filters:Record<string,unknown>)=>rows(table,filters),scan:async(table:M1Table,filters:Record<string,unknown>,options:{limit:number;afterId?:string;cutoff?:RetentionCutoff})=>rows(table,filters).filter(row=>(!options.afterId||row.id>options.afterId)&&(!options.cutoff||Number(row.data[options.cutoff.field])<(options.cutoff.at+(options.cutoff.inclusive?1:0)))).slice(0,options.limit),count:async(table:M1Table,filters:Record<string,unknown>,limit:number)=>Math.min(limit,rows(table,filters).length),quotaCount:async()=>0,
 insert:async(table:M1Table,row:StoredRow)=>{assert(!tables.get(table)!.has(row.id));tables.get(table)!.set(row.id,structuredClone(row));},update:async(table:M1Table,row:StoredRow,version:number)=>{assert.equal(tables.get(table)!.get(row.id)?.version,version);tables.get(table)!.set(row.id,structuredClone(row));return true;},remove:async(table:M1Table,id:string,version:number)=>{assert.equal(tables.get(table)!.get(id)?.version,version);return tables.get(table)!.delete(id);}} as unknown as M1Transaction;
 const store={instanceId:'instance_voice_unit',recoveryEpoch:'epoch_voice_unit',read:async(work:(reader:M1Transaction)=>Promise<unknown>)=>await work(tx),transaction:async(work:(writer:M1Transaction)=>Promise<unknown>)=>{const before=structuredClone(tables);try{return await work(tx);}catch(error){tables=before;throw error;}},close:async()=>{}} as unknown as M1Store;
 return {store,tx,rows,snapshot:()=>Object.fromEntries(M1_TABLES.map(table=>[table,rows(table)]))};
}
const baseline='catalog-readers-1-schema-4-schema-5';
async function fixture(){
 const f=memory();await f.store.transaction(initializePerceptionCatalog);
 const original=(await f.tx.get('perception_catalog','guide:world:2'))!.data.document as JsonObject;
 await publishPerceptionCatalog(f.store,{revision:baseline,guideVersion:3,guideText:String(original.text).replace('\n'+AGENT_HUMAN_VOICE_GUIDE,'')});
 return f;
}
function release(f:ReturnType<typeof memory>){return {actorId:'isolated-guide-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:baseline,revision:baseline+'-human-voice-1',expectedGuideVersion:3,guideVersion:4};}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');

test('guide-only release becomes discoverable through capabilities and Skill; exact served guides retain normalized digests and history',async()=>{
 const f=await fixture(),options=release(f),service=createPerceptionService(f.store,{authenticate:async()=>({id:'synthetic-runtime',version:1,data:{kind:'runtime',agentId:'synthetic-agent',runtimeVersion:1}})},{now:()=>Date.now()});
 const before=f.snapshot(),oldCapabilities=await service.capabilities(),oldDocuments=f.rows('perception_catalog').filter(row=>/^(guide|schema):/.test(row.id));
 const receipt=await publishAgentHumanVoiceGuide(f.store,options),after=f.snapshot();
 assert.equal(receipt.newGuideDocuments,7);assert.equal(receipt.schemaVersion,5);
 assert.deepEqual(await publishAgentHumanVoiceGuide(f.store,options),receipt);assert.deepEqual(f.snapshot(),after,'An administrative replay adds no writes');
 for(const row of oldDocuments)assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 for(const table of M1_TABLES)if(!['perception_catalog','perception_access'].includes(table))assert.deepEqual(f.rows(table),before[table]);
 const current=(await f.tx.get('perception_catalog','current'))!.data,previous=before.perception_catalog!.find(row=>row.id==='current')!.data;
 assert.deepEqual(current.sourceStates,previous.sourceStates);assert.deepEqual(current.seedObjectIds,previous.seedObjectIds);
 const capabilities=await service.capabilities();assert.notEqual(capabilities.catalogRevision,oldCapabilities.catalogRevision);assert.notEqual(capabilities.skillCatalogRevision,oldCapabilities.skillCatalogRevision);
 const app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
 try{
  const discovery:JsonObject[]=[];let pageToken:string|undefined;
  do{const response=await app.inject({method:'GET',url:'/v1/perception/discovery?limit=50'+(pageToken?'&pageToken='+pageToken:''),headers:{authorization:'Bearer synthetic'}});assert.equal(response.statusCode,200);const page=response.json().data;assert.equal(page.catalogRevision,capabilities.catalogRevision);discovery.push(...page.skills);pageToken=page.nextPageToken??undefined;}while(pageToken);
  assert.equal(discovery[0]!.version,4);assert.deepEqual(discovery[0]!.guideRef,{moduleId:'world',version:4});
  for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet']){
   const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=4`,headers:{authorization:'Bearer synthetic'}});assert.equal(response.statusCode,200);const data=response.json().data;
   assert.equal(sha(data.canonicalDocument),data.digest);assert.deepEqual(JSON.parse(data.canonicalDocument),data.document);assert(data.document.text.includes(AGENT_HUMAN_VOICE_GUIDE));
  }
  const historical=await app.inject({method:'GET',url:'/v1/perception/guides/world?version=3',headers:{authorization:'Bearer synthetic'}});assert.equal(historical.statusCode,200);assert.equal(historical.json().data.digest,oldDocuments.find(row=>row.id==='guide:world:3')!.data.digest);
 }finally{await app.close();}
});

test('guide release rejects stale targets or occupied exact versions without changing facts',async()=>{
 const f=await fixture(),options=release(f),before=f.snapshot();
 for(const patch of [{expectedInstanceId:'wrong'},{expectedRecoveryEpoch:'wrong'},{expectedCatalogRevision:'changed'},{expectedGuideVersion:2},{guideVersion:5}]){await assert.rejects(publishAgentHumanVoiceGuide(f.store,{...options,...patch}));assert.deepEqual(f.snapshot(),before);}
 await f.tx.insert('perception_catalog',{id:'guide:world:4',version:1,data:{document:{text:'immutable occupied version'},digest:'retained'}});const occupied=f.snapshot();await assert.rejects(publishAgentHumanVoiceGuide(f.store,options));assert.deepEqual(f.snapshot(),occupied);
});

test('World discovery and actual entry deliver first-person fact-bound guidance while technical checks remain internal',async()=>{
 const f=coreFixture(),service=createWorldService(f.identity),operations=worldGatewayOperations(service),gateway=createAgentGateway({store:f.store,identity:f.identity,operations,guides:[worldGatewayGuide]});
 const previous=structuredClone(worldGatewayGuide);previous.version=3;previous.document.version=3;delete previous.document.humanCommunication;
 assert.notEqual(gateway.catalogRevision,createAgentGateway({store:f.store,identity:f.identity,operations,guides:[previous]}).catalogRevision);
 const app=Fastify();registerAgentGatewayRoutes(app,gateway,{instanceId:'voice-unit',now:()=>1000});registerSiteRoutes(app);
 try{
  const discovery=(await app.inject({method:'GET',url:'/v1/gateway/discovery'})).json().data,guideRef=discovery.modules.find((module:{moduleId:string})=>module.moduleId==='world').usageGuide;assert.equal(guideRef.version,7);
  const response=await app.inject({method:'GET',url:guideRef.path}),data=response.json().data;assert.equal(response.statusCode,200);assert.equal(sha(data.canonicalDocument),data.digest);assert.equal(data.document.humanCommunication.instruction,AGENT_HUMAN_VOICE_GUIDE);
  for(const phrase of ['第一人称','内部仍须完整发现能力','只有主人明确要求排错','等待中的行动不说完成','不编造到达、交谈或对方回应','不代表外部Agent再次调用模型','绑定完成不重复要求关联'])assert(AGENT_HUMAN_VOICE_GUIDE.includes(phrase));
  const entry=await app.inject({method:'GET',url:'/agent/entry.md'});assert.equal(entry.statusCode,200);assert.match(entry.body,/以角色第一人称说话/);assert.match(entry.body,/内部仍完整发现能力/);assert.match(entry.body,/MANAGEMENT_URL/);assert(!entry.body.includes('我是江屿'));
 }finally{await app.close();}
});


test('text-exchange guide correction is discoverable, immutable and replayable without changing business data',async()=>{
 const f=memory();await f.store.transaction(initializePerceptionCatalog);
 const currentRevision=baseline+'-human-voice-1';
 await publishPerceptionCatalog(f.store,{revision:currentRevision,guideVersion:4,guideText:'Existing synthetic guide before the text-exchange correction.'});
 const service=createPerceptionService(f.store,{authenticate:async()=>({id:'synthetic-runtime',version:1,data:{kind:'runtime',agentId:'synthetic-agent',runtimeVersion:1}})}),oldCapabilities=await service.capabilities(),before=f.snapshot(),documents=f.rows('perception_catalog').filter(row=>/^(guide|schema):/.test(row.id));
 const options={actorId:'isolated-guide-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:currentRevision,revision:currentRevision+'-text-exchange-1',expectedGuideVersion:4,guideVersion:5};
 const receipt=await publishTextExchangeGuide(f.store,options),published=f.snapshot();assert.equal(receipt.newGuideDocuments,7);assert.equal(receipt.schemaVersion,5);assert.deepEqual(await publishTextExchangeGuide(f.store,options),receipt);assert.deepEqual(f.snapshot(),published);
 for(const row of documents)assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 for(const table of M1_TABLES)if(!['perception_catalog','perception_access'].includes(table))assert.deepEqual(f.rows(table),before[table]);
 const capabilities=await service.capabilities();assert.equal(capabilities.catalogRevision,options.revision);assert.notEqual(capabilities.skillCatalogRevision,oldCapabilities.skillCatalogRevision);
 const app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
 try{for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet']){const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=5`,headers:{authorization:'Bearer synthetic'}});assert.equal(response.statusCode,200);const data=response.json().data;assert.equal(sha(data.canonicalDocument),data.digest);assert(data.document.text.includes(AGENT_TEXT_EXCHANGE_GUIDE));assert.match(data.document.text,/两者都不会建立好友/);assert.match(data.document.text,/主人打开是观察/);}}finally{await app.close();}
});


test('friendship guide6 replaces stale current-only advice, publishes normalized discovery and preserves exact guide5',async()=>{
 const f=memory();await f.store.transaction(initializePerceptionCatalog);
 const previousRevision=baseline+'-human-voice-1-text-exchange-1';
 await publishPerceptionCatalog(f.store,{revision:previousRevision,guideVersion:5,guideText:'Synthetic pre-release source guide.\n'+AGENT_TEXT_EXCHANGE_GUIDE});
 const old=(await f.tx.get('perception_catalog','guide:world:5'))!,before=f.snapshot(),service=createPerceptionService(f.store,{authenticate:async()=>({id:'synthetic-runtime',version:1,data:{kind:'runtime',agentId:'synthetic-agent',runtimeVersion:1}})}),oldCapabilities=await service.capabilities();
 const options={actorId:'isolated-guide-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:previousRevision,revision:previousRevision+'-friendship-1',expectedGuideVersion:5,guideVersion:6};
 const receipt=await publishFriendshipGuide(f.store,options),after=f.snapshot();assert.equal(receipt.newGuideDocuments,7);assert.equal(receipt.schemaVersion,5);assert.deepEqual(await publishFriendshipGuide(f.store,options),receipt);assert.deepEqual(f.snapshot(),after);assert.deepEqual(await f.tx.get('perception_catalog','guide:world:5'),old);
 for(const row of before.perception_catalog!.filter(row=>/^(guide|schema):/.test(row.id)))assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 for(const table of M1_TABLES)if(!['perception_catalog','perception_access'].includes(table))assert.deepEqual(f.rows(table),before[table]);
 const capabilities=await service.capabilities();assert.equal(capabilities.catalogRevision,options.revision);assert.notEqual(capabilities.skillCatalogRevision,oldCapabilities.skillCatalogRevision);
 const app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
 try{
  const discovery=(await app.inject({method:'GET',url:'/v1/perception/discovery?limit=50',headers:{authorization:'Bearer synthetic'}})).json().data;assert(discovery.skills.every((skill:any)=>skill.version===6&&skill.guideRef.version===6));
  for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet']){const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=6`,headers:{authorization:'Bearer synthetic'}});assert.equal(response.statusCode,200);const data=response.json().data;assert.equal(sha(data.canonicalDocument),data.digest);assert(data.document.text.includes(AGENT_FRIENDSHIP_GUIDE));assert(!data.document.text.includes('当前好友列表只有主人只读入口，没有建立好友命令'));assert.match(data.document.text,/两者都不会建立好友/);}
 }finally{await app.close();}
 const afterReads=f.snapshot();await assert.rejects(publishFriendshipGuide(f.store,{...options,operationId:randomUUID(),expectedRecoveryEpoch:'wrong'}));assert.deepEqual(f.snapshot(),afterReads);
});


test('autonomy guide7 is discoverable with canonical digests while exact guide6 and business facts remain immutable',async()=>{
 const f=memory();await f.store.transaction(initializePerceptionCatalog);
 const previousRevision=baseline+'-human-voice-1-text-exchange-1-friendship-1';
 await publishPerceptionCatalog(f.store,{revision:previousRevision,guideVersion:6,guideText:'Synthetic retained guide6.\n'+AGENT_FRIENDSHIP_GUIDE});
 const before=f.snapshot(),old=(await f.tx.get('perception_catalog','guide:world:6'))!,service=createPerceptionService(f.store,{authenticate:async()=>({id:'synthetic-runtime',version:1,data:{kind:'runtime',agentId:'synthetic-agent',runtimeVersion:1}})}),oldCapabilities=await service.capabilities();
 const options={actorId:'isolated-guide-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:previousRevision,revision:previousRevision+'-autonomy-1',expectedGuideVersion:6,guideVersion:7};
 const receipt=await publishAgentAutonomyGuide(f.store,options),after=f.snapshot();assert.equal(receipt.newGuideDocuments,7);assert.equal(receipt.schemaVersion,5);assert.deepEqual(await publishAgentAutonomyGuide(f.store,options),receipt);assert.deepEqual(f.snapshot(),after);assert.deepEqual(await f.tx.get('perception_catalog','guide:world:6'),old);
 for(const row of before.perception_catalog!.filter(row=>/^(guide|schema):/.test(row.id)))assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 for(const table of M1_TABLES)if(!['perception_catalog','perception_access'].includes(table))assert.deepEqual(f.rows(table),before[table]);
 const capabilities=await service.capabilities();assert.equal(capabilities.catalogRevision,options.revision);assert.notEqual(capabilities.skillCatalogRevision,oldCapabilities.skillCatalogRevision);
 const app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
 try{const discovery=(await app.inject({method:'GET',url:'/v1/perception/discovery?limit=50',headers:{authorization:'Bearer synthetic'}})).json().data;assert(discovery.skills.every((skill:any)=>skill.version===7&&skill.guideRef.version===7));for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet']){const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=7`,headers:{authorization:'Bearer synthetic'}});assert.equal(response.statusCode,200);const data=response.json().data;assert.equal(sha(data.canonicalDocument),data.digest);assert(data.document.text.includes(AGENT_AUTONOMY_GUIDE));assert.match(data.document.text,/例行更新静默完成/);assert.match(data.document.text,/已有Agent保留原期望/);assert.match(data.document.text,/Agent自报，不是服务器验证/);assert.match(data.document.text,/主人明确要求立即停止时，即使断网也先停本地/);assert.match(data.document.text,/主人从好友窗口查看申请和结果/);assert.match(data.document.http.updateCheck.currentPolicy,/world-action-policy/);}}finally{await app.close();}
});

test('map guide8 accepts the actual long current revision, preserves exact guide7 and publishes seven canonical guides without a schema upgrade',async()=>{
 const f=memory();await f.store.transaction(initializePerceptionCatalog);
 const previousRevision='catalog-readers-1-schema-4-schema-5-human-voice-1-text-exchange-1-friendship-1-autonomy-1';assert.equal(previousRevision.length,89);
 await publishPerceptionCatalog(f.store,{revision:previousRevision,guideVersion:7,guideText:'Synthetic retained guide7.\n'+AGENT_AUTONOMY_GUIDE});
 const before=f.snapshot(),old=(await f.tx.get('perception_catalog','guide:world:7'))!,service=createPerceptionService(f.store,{authenticate:async()=>({id:'pre-map-runtime',version:1,data:{kind:'runtime',agentId:'pre-map-agent',runtimeVersion:1}})}),oldCapabilities=await service.capabilities();
 const options={actorId:'isolated-guide-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:previousRevision,revision:'catalog-map-v2-1',expectedGuideVersion:7,guideVersion:8};
 const receipt=await publishWorldMapV2Guide(f.store,options),after=f.snapshot();assert.equal(receipt.newGuideDocuments,7);assert.equal(receipt.schemaVersion,5);assert.deepEqual(await publishWorldMapV2Guide(f.store,options),receipt);assert.deepEqual(f.snapshot(),after);assert.deepEqual(await f.tx.get('perception_catalog','guide:world:7'),old);
 for(const row of before.perception_catalog!.filter(row=>/^(guide|schema):/.test(row.id)))assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 for(const table of M1_TABLES)if(!['perception_catalog','perception_access'].includes(table))assert.deepEqual(f.rows(table),before[table]);
 const capabilities=await service.capabilities();assert.equal(capabilities.catalogRevision,options.revision);assert.notEqual(capabilities.skillCatalogRevision,oldCapabilities.skillCatalogRevision);assert(String(capabilities.skillCatalogRevision).length<=100);
 const app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
 try{
  const discovery=(await app.inject({method:'GET',url:'/v1/perception/discovery?limit=50',headers:{authorization:'Bearer pre-map-runtime'}})).json().data;assert(discovery.skills.every((skill:any)=>skill.version===8&&skill.guideRef.version===8));
  for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet']){const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=8`,headers:{authorization:'Bearer pre-map-runtime'}});assert.equal(response.statusCode,200);const data=response.json().data;assert.equal(sha(data.canonicalDocument),data.digest);assert.deepEqual(JSON.parse(data.canonicalDocument),data.document);assert(data.document.text.includes(AGENT_WORLD_MAP_V2_GUIDE));assert.match(data.document.text,/最多64/);assert.match(data.document.text,/不是目标点自动导航/);assert.match(data.document.text,/独立server-managed只读定义/);}
  const historical=await app.inject({method:'GET',url:'/v1/perception/guides/world?version=7',headers:{authorization:'Bearer pre-map-runtime'}});assert.equal(historical.statusCode,200);assert.equal(historical.json().data.digest,old.data.digest);
 }finally{await app.close();}
 const afterReads=f.snapshot();await assert.rejects(publishWorldMapV2Guide(f.store,{...options,operationId:randomUUID(),expectedRecoveryEpoch:'wrong'}));assert.deepEqual(f.snapshot(),afterReads);
});

test('cumulative exact guides remain readable by Owner and runtime without widening list or detail budgets',async()=>{
 const f=memory();await f.store.transaction(initializePerceptionCatalog);
 const retained=(await f.tx.get('perception_catalog','guide:world:2'))!.data.document as JsonObject;
 // Retained public guidance grows across releases. Cover at least the live guide8
 // canonical size (32,355 UTF-8 bytes), without using private content or a live store.
 await publishPerceptionCatalog(f.store,{revision:'isolated-cumulative-guide8',guideVersion:8,guideText:String(retained.text)+'\n'+'既有公开说明。'.repeat(200)});
 const documents=f.rows('perception_catalog').filter(row=>/^(guide|schema):/.test(row.id));
 const service=createPerceptionService(f.store,{authenticate:async(_tx,token)=>{
  if(token==='synthetic-owner')return {id:'synthetic-owner',version:1,data:{kind:'owner_session',ownerId:'synthetic-owner',ownerAuthVersion:1}};
  if(token==='synthetic-runtime')return {id:'synthetic-runtime',version:1,data:{kind:'runtime',agentId:'synthetic-agent',runtimeVersion:1}};
  return fail('authentication_failed',401,'Authentication failed');
 }});
 const app=Fastify(),http={invokeHttp:service.invoke} as unknown as M1Service;registerM1Routes(app,http);registerPerceptionRoutes(app,http);
 try{
  for(const token of ['synthetic-owner','synthetic-runtime']){
   const headers={authorization:`Bearer ${token}`};
   for(const moduleId of ['inventory','mailbox','world','wallet']){
    const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=8`,headers});
    assert.equal(response.statusCode,200,response.body);const data=response.json().data;
    assert(Buffer.byteLength(data.canonicalDocument)>=32355);assert(Buffer.byteLength(response.body)>65536);assert(Buffer.byteLength(response.body)<=256*1024);
    assert.equal(sha(data.canonicalDocument),data.digest);assert.deepEqual(JSON.parse(data.canonicalDocument),data.document);
    assert.deepEqual(data.document,(await f.tx.get('perception_catalog',`guide:${moduleId}:8`))!.data.document);
   }
   for(const schemaId of ['perception.list-query','perception.list-result']){
    const response=await app.inject({method:'GET',url:`/v1/perception/schemas/${schemaId}?version=5`,headers});assert.equal(response.statusCode,200);
    const data=response.json().data;assert.equal(sha(data.canonicalDocument),data.digest);assert.deepEqual(JSON.parse(data.canonicalDocument),data.document);
   }
  }
  const anonymous=await app.inject({method:'GET',url:'/v1/perception/guides/world?version=8'});assert.equal(anonymous.statusCode,401);assert.equal(anonymous.json().error.code,'authentication_failed');
  const headers={authorization:'Bearer synthetic-owner'},context={protocolVersion:1,consumerId:'isolated-budget-check',purpose:'human-inspect',channel:'world'};
  for(const [path,input] of [['list',{...context,categoryId:'announcements'}],['detail',{...context,ref:{moduleId:'world',type:'world.rules@1',id:'world-rules'}}]] as const){
   for(const maxResponseBytes of [1,65537]){
    const response=await app.inject({method:'POST',url:`/v1/perception/${path}`,headers,payload:{...input,budget:{maxResponseBytes}}});assert.equal(response.statusCode,422);assert.equal(response.json().error.code,maxResponseBytes===1?'budget_too_small':'invalid_request');
   }
  }
  for(const row of documents)assert.deepEqual(await f.tx.get('perception_catalog',row.id),row,'Reads preserve every exact document and digest');
 }finally{await app.close();}
});

test('named NPC item-source release preserves prior exact guides and permissions while enabling real items only after preparation',async()=>{
 const f=memory();await f.store.transaction(initializePerceptionCatalog);const retained=(await f.tx.get('perception_catalog','guide:world:2'))!.data.document as JsonObject;
 await publishPerceptionCatalog(f.store,{revision:'catalog-map-v2-1',guideVersion:8,guideText:String(retained.text)});
 const current=(await f.tx.get('perception_catalog','current'))!;await f.tx.update('perception_catalog',{...current,version:current.version+1,data:{...current.data,sourceStates:{...current.data.sourceStates as JsonObject,'direct-mail':'unavailable'}}},current.version);
 const options={actorId:'synthetic-town-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:'catalog-map-v2-1',revision:'catalog-npc-services-1',expectedGuideVersion:8,guideVersion:9},beforePreparation=f.snapshot();
 await assert.rejects(publishNpcServiceReaders(f.store,options));assert.deepEqual(f.snapshot(),beforePreparation);
 for(const item of Object.values(TOWN_ITEM_DEFINITIONS)){const ref={moduleId:'items',type:'items.item@1',id:item.id};await f.tx.insert('perception_objects',{id:refId(ref),version:1,data:{ref,moduleId:'items',type:ref.type,refId:ref.id,categoryId:'items',metricId:'all',channel:'world',sourceId:'npc-service-items',title:item.title,body:item.text,itemKind:'prop',public:true,active:true,available:true,dataMode:'real',attachments:[],source:{kind:'town_service_item',reference:item.id}}});}
 const service=createPerceptionService(f.store,{authenticate:async()=>({id:'pre-town-runtime',version:1,data:{kind:'runtime',agentId:'pre-town-agent',runtimeVersion:1}})}),input={protocolVersion:1,consumerId:'synthetic-town-reader',purpose:'agent-inspect',channel:'world',categoryId:'items'};
 assert.deepEqual(((await service.invoke('perceptionList',input,'synthetic')).data as JsonObject).records,[],'Prepared definitions are not discovered through an unpublished source');
 const before=f.snapshot(),oldCapabilities=await service.capabilities(),receipt=await publishNpcServiceReaders(f.store,options),published=f.snapshot();assert.equal(receipt.newGuideDocuments,7);assert.equal(receipt.schemaVersion,5);assert.deepEqual(await publishNpcServiceReaders(f.store,options),receipt);assert.deepEqual(f.snapshot(),published);
 for(const row of before.perception_catalog!.filter(row=>/^(guide|schema|catalog-revision):/.test(row.id)))assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 const states=(await f.tx.get('perception_catalog','current'))!.data.sourceStates as JsonObject;assert.deepEqual(states,{...current.data.sourceStates as JsonObject,'direct-mail':'unavailable','npc-service-items':'enabled'});assert.equal(f.rows('perception_grants').length,0,'Publishing a reader does not issue a voucher or holding');
 const catalog=await catalogData(f.tx);assert.deepEqual((catalog.categories as JsonObject[]).find(c=>c.categoryId==='items')!.sourceIds,['demo-items','npc-service-items']);assert((catalog.sources as JsonObject[]).some(s=>s.sourceId==='npc-service-items'&&s.state==='enabled'));
 assert.notEqual((await service.capabilities()).catalogRevision,oldCapabilities.catalogRevision);assert.notEqual((await service.capabilities()).skillCatalogRevision,oldCapabilities.skillCatalogRevision);
 const listed=((await service.invoke('perceptionList',input,'synthetic')).data as JsonObject).records as JsonObject[];assert.equal(listed.length,2);assert(listed.every(row=>(row.summary as JsonObject).dataMode==='real'&&row.sourceId==='npc-service-items'));
 const app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);try{for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet']){const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=9`,headers:{authorization:'Bearer pre-town-runtime'}});assert.equal(response.statusCode,200);const data=response.json().data;assert.equal(sha(data.canonicalDocument),data.digest);assert.deepEqual(JSON.parse(data.canonicalDocument),data.document);assert.match(data.document.text,/town_services\.welcome\.claim/);assert(!data.document.text.includes('scene顶层npcs为独立server-managed只读定义'));}}finally{await app.close();}
});

test('hourly onboarding guide10 replaces the obsolete default while preserving every exact guide, source and existing Agent arrangement',async()=>{
 const f=memory();await f.store.transaction(initializePerceptionCatalog);
 const text=String(((await f.tx.get('perception_catalog','guide:world:2'))!.data.document as JsonObject).text);
 await publishPerceptionCatalog(f.store,{revision:'catalog-map-v2-1',guideVersion:8,guideText:text});
 for(const item of Object.values(TOWN_ITEM_DEFINITIONS)){const ref={moduleId:'items',type:'items.item@1',id:item.id};await f.tx.insert('perception_objects',{id:refId(ref),version:1,data:{ref,categoryId:'items',sourceId:'npc-service-items',dataMode:'real',public:true,active:true,available:true}});}
 await publishNpcServiceReaders(f.store,{actorId:'fixture-npc-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:'catalog-map-v2-1',revision:'catalog-npc-services-1',expectedGuideVersion:8,guideVersion:9});
 for(const [id,intervalSeconds,paused,manual] of [['old-null',null,false,false],['old-hour',3600,false,false],['old-paused',600,true,false],['old-manual',null,false,true]] as const){await f.tx.insert('agents',{id,version:3,data:{worldAccess:{version:2,intervalSeconds},runtimeActive:true}});await f.tx.insert('memberships',{id,version:2,data:{agentId:id,ownerPaused:paused,manual}});}
 const before=f.snapshot(),options={actorId:'isolated-hourly-maintainer',operationId:randomUUID(),expectedInstanceId:f.store.instanceId,expectedRecoveryEpoch:f.store.recoveryEpoch,expectedCatalogRevision:'catalog-npc-services-1',revision:'catalog-hourly-onboarding-1',expectedGuideVersion:9,guideVersion:10};
 const receipt=await publishAgentHourlyGuide(f.store,options),published=f.snapshot();assert.equal(receipt.newGuideDocuments,7);assert.equal(receipt.schemaVersion,5);assert.deepEqual(await publishAgentHourlyGuide(f.store,options),receipt);assert.deepEqual(f.snapshot(),published);
 for(const row of before.perception_catalog!.filter(row=>/^(guide|schema|catalog-revision):/.test(row.id)))assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
 assert.deepEqual((await f.tx.get('perception_catalog','current'))!.data.sourceStates,(before.perception_catalog!.find(row=>row.id==='current'))!.data.sourceStates);
 for(const table of M1_TABLES)if(!['perception_catalog','perception_access'].includes(table))assert.deepEqual(f.rows(table),before[table]);
 const service=createPerceptionService(f.store,{authenticate:async()=>({id:'existing-hourly-runtime',version:1,data:{kind:'runtime',agentId:'old-null',runtimeVersion:1}})}),app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
 try{
  assert.equal((await service.capabilities()).catalogRevision,'catalog-hourly-onboarding-1');
  for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet']){const response=await app.inject({method:'GET',url:`/v1/perception/guides/${moduleId}?version=10`,headers:{authorization:'Bearer existing-hourly-runtime'}});assert.equal(response.statusCode,200);const exact=response.json().data;assert.equal(sha(exact.canonicalDocument),exact.digest);assert.deepEqual(JSON.parse(exact.canonicalDocument),exact.document);assert(exact.document.text.includes(CURRENT_HOURLY_AUTONOMY_GUIDE));assert(exact.document.text.includes(HOURLY_HOST_GUIDE));assert.match(exact.document.text,/3600秒/);assert.match(exact.document.text,/关联前不创建任务/);assert.match(exact.document.text,/management\.managementStatus/);assert(!exact.document.text.includes('建议600秒'));assert(!exact.document.text.includes('擅自600覆盖'));}
 }finally{await app.close();}
});
