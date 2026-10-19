import { randomUUID } from 'node:crypto';
import type { JsonObject, JsonValue, M1Store, M1Transaction, StoredRow } from '../contracts/store.ts';
import { fail, object, text, version } from '../domains/common/errors.ts';
import { CATEGORIES, OPERATIONS, TYPE_DEFINITIONS, RULES_REF, bounded, key, plain, ref, refId, type ObjectRef, type PerceptionAction } from '../domains/perception/protocol.ts';
import { catalogData, initializePerceptionCatalog } from './perception-catalog.ts';
import { grantId } from './perception-seed.ts';

export interface PerceptionOptions { now?:()=>number; pageTtlMs?:number; completionTtlMs?:number; accessRetentionMs?:number; accessPerAgentLimit?:number; accessTotalLimit?:number; receiptLimit?:number; detailSegmentChars?:number }
export interface PerceptionAuth { authenticate(tx:M1Transaction,token:unknown,kinds:readonly string[]):StoredRow }
type Actor={id:string;kind:'runtime'|'owner_session';agentId:string|null;ownerId:string|null;generation:JsonValue};
type Candidate={row:StoredRow;ref:ObjectRef;grant?:StoredRow};
const common=['protocolVersion','channel','purpose','consumerId','scope','limit','pageToken','budget','decision'];

export function createPerceptionService(store:M1Store,auth:PerceptionAuth,options:PerceptionOptions={}) {
 const now=options.now??Date.now;
 const settings={pageTtlMs:options.pageTtlMs??300_000,completionTtlMs:options.completionTtlMs??600_000,accessRetentionMs:options.accessRetentionMs??7*86_400_000,accessPerAgentLimit:options.accessPerAgentLimit??1000,accessTotalLimit:options.accessTotalLimit??20_000,receiptLimit:options.receiptLimit??10_000,detailSegmentChars:options.detailSegmentChars??512};
 if(Object.values(settings).some(n=>!Number.isSafeInteger(n)||n<1)||settings.receiptLimit>100_000||settings.accessTotalLimit>100_000||settings.accessPerAgentLimit>100_000||settings.detailSegmentChars>2000)throw new Error('Invalid perception limits');
 store.transaction(initializePerceptionCatalog);
 function actor(tx:M1Transaction,token:unknown):Actor {const c=auth.authenticate(tx,token,['runtime','owner_session']);return {id:String(c.data.agentId??c.data.ownerId),kind:c.data.kind as Actor['kind'],agentId:typeof c.data.agentId==='string'?c.data.agentId:null,ownerId:typeof c.data.ownerId==='string'?c.data.ownerId:null,generation:c.data.runtimeVersion??c.data.ownerAuthVersion??1};}
 function permission(tx:M1Transaction,a:Actor):string {const config=tx.get('perception_catalog','current')!;return key({actor:a.id,kind:a.kind,generation:a.generation,epoch:store.recoveryEpoch,sources:config.data.sourceStates});}
 function currentSource(tx:M1Transaction,sourceId:string):string {return String(plain(tx.get('perception_catalog','current')!.data.sourceStates)[sourceId]??'not_enabled');}
 function checkSource(tx:M1Transaction,id:string):void {const state=currentSource(tx,id);if(state==='not_enabled')fail('channel_not_enabled',409,'Source is not enabled');if(state!=='enabled')fail('source_unavailable',503,'Source is unavailable');}
 function publicAgent(tx:M1Transaction,id:string):Candidate|null {
  const row=tx.get('profiles',id),member=tx.get('memberships',id);if(!row||row.data.published===null||member?.data.state!=='joined'||member.data.platformRestricted!==false)return null;
  const p=plain(row.data.published),av=plain(p.avatar);if(typeof p.displayName!=='string'||!p.displayName.trim()||av.template!=='basic'||!['olive','cream','blue','coral'].includes(String(av.color)))return null;
  const fields:JsonObject={displayName:p.displayName,avatar:{template:av.template,color:av.color!}};if(typeof p.bio==='string')fields.bio=p.bio;if(Array.isArray(p.interests))fields.interests=p.interests.filter((x):x is string=>typeof x==='string');
  const r:ObjectRef={moduleId:'profiles',type:'profiles.agent@1',id};return {ref:r,row:{id:refId(r),version:Number(row.data.publishedVersion),data:{ref:r,categoryId:'people',metricId:'agents',channel:'world',sourceId:'profiles-public',title:p.displayName,body:JSON.stringify(fields),fields,public:true,active:true,available:true,dataMode:'real',attachments:[],source:{kind:'published_profile'}}}};
 }
 function readable(tx:M1Transaction,a:Actor,r:ObjectRef,channel:string,metadataOnly=false):Candidate {
  if(r.moduleId==='profiles'&&r.type==='profiles.agent@1'){checkSource(tx,'profiles-public');const c=publicAgent(tx,r.id);if(c&&channel==='world')return c;fail('target_not_accessible',404,'Target is not accessible');}
  if(r.moduleId==='inventory'&&r.type==='inventory.holding@1'){
   if(a.kind!=='runtime'||channel!=='inventory')fail('target_not_accessible',404,'Target is not accessible');const g=tx.get('perception_grants',r.id);if(!g||g.data.agentId!==a.agentId||g.data.kind!=='holding'||g.data.active!==true)fail('target_not_accessible',404,'Target is not accessible');
   const item=tx.get('perception_objects',String(g.data.objectId));if(!item||item.data.active!==true||item.data.available!==true)fail('target_not_accessible',404,'Target is not accessible');checkSource(tx,'holdings');
   return {ref:r,grant:g,row:{id:g.id,version:g.version,data:{ref:r,categoryId:'holdings',metricId:'held',channel:'inventory',sourceId:'holdings',title:item.data.title!,body:'明确标识的示例持有记录，不代表经济资产、货币或交易权。',itemRef:item.data.ref!,quantity:g.data.quantity??1,public:false,active:true,available:true,dataMode:g.data.dataMode??'demo',attachments:[],source:{kind:'demo_holding'}}}};
  }
  const row=tx.get('perception_objects',refId(r));if(!row||row.data.channel!==channel||row.data.active!==true||(!metadataOnly&&row.data.available!==true)||key(row.data.ref)!==key(r))fail('target_not_accessible',404,'Target is not accessible');
  checkSource(tx,String(row.data.sourceId));
  if(row.data.public===true&&channel==='world')return {row,ref:r};
  if(channel==='inbox'&&a.kind==='runtime'){const g=tx.get('perception_grants',grantId(a.agentId!,row.id,'delivery'));if(g?.data.active===true&&g.data.agentId===a.agentId)return {row,ref:r,grant:g};}
  fail('target_not_accessible',404,'Target is not accessible');
 }
 function readState(tx:M1Transaction,a:Actor,c:Candidate):JsonObject {const s=tx.get('perception_states',key({agentId:a.agentId,objectId:c.row.id}));return {ref:c.ref,currentContentVersion:c.row.version,confirmedContentVersion:s?.data.confirmedContentVersion??null,stateVersion:s?.version??0,confirmedAt:s?.data.confirmedAt??null};}
 function summary(tx:M1Transaction,a:Actor,c:Candidate):JsonObject {
  const d=c.row.data;const fields:JsonObject={title:d.title!,dataMode:d.dataMode!,source:d.source??{kind:'unknown'}};
  for(const field of ['itemKind','author','area','quantity','itemRef','eventKind','status','fields'])if(d[field]!==undefined)fields[field]=d[field]!;
  return {op:'upsert',sourceId:d.sourceId!,ref:c.ref,version:c.row.version,schema:{id:`${TYPE_DEFINITIONS.find(t=>t.type===c.ref.type)!.prefix}-summary`,version:1},summary:fields,detailAvailable:d.available===true,...(d.available!==true?{unavailableReason:'content_unavailable'}:{}),...(d.channel==='inbox'?{agentReadState:d.available===true?readState(tx,a,c):null}:{})};
 }
 function selection(tx:M1Transaction,a:Actor,categoryId:string,metricId:string|null,unconfirmed:boolean,max:number):{candidates:Candidate[];complete:boolean;scanned:number} {
  const candidates:Candidate[]=[];let scanned=0,complete=true;
  if(categoryId==='people'&&metricId==='humans')return {candidates,complete:true,scanned:0};
  if(['notifications','holdings'].includes(categoryId)){
   if(a.kind!=='runtime')fail('insufficient_scope',403,'This view belongs to the Agent');
   const kind=categoryId==='notifications'?'delivery':'holding',rows=tx.scan('perception_grants',{agentId:a.agentId!,kind},{limit:max+1});complete=rows.length<=max;
   for(const g of rows.slice(0,max)){scanned++;if(g.data.active!==true)continue;const row=tx.get('perception_objects',String(g.data.objectId));if(!row||row.data.active!==true||(unconfirmed&&row.data.available!==true))continue;
    const c=categoryId==='holdings'?readable(tx,a,{moduleId:'inventory',type:'inventory.holding@1',id:g.id},'inventory'):{row,ref:ref(row.data.ref),grant:g};
    if(unconfirmed&&readState(tx,a,c).confirmedContentVersion===row.version)continue;candidates.push(c);
   }
  }else if(categoryId==='people'){
   const rows=tx.scan('profiles',{}, {limit:max+1});complete=rows.length<=max;for(const row of rows.slice(0,max)){scanned++;const c=publicAgent(tx,row.id);if(c)candidates.push(c);}
  }else{
   const rows=tx.scan('perception_objects',{categoryId},{limit:max+1});complete=rows.length<=max;
   for(const row of rows.slice(0,max)){scanned++;if(row.data.public!==true||row.data.active!==true||row.data.available!==true||(metricId&&row.data.metricId!==metricId))continue;candidates.push({row,ref:ref(row.data.ref)});}
  }
  candidates.sort((a,b)=>key(a.ref).localeCompare(key(b.ref)));return {candidates,complete,scanned};
 }
 function validateContext(input:Record<string,unknown>,a:Actor):{consumerId:string;purpose:string;scope:JsonObject} {
  const consumerId=text(input.consumerId,'consumerId',1,100),purpose=text(input.purpose,'purpose',1,60);
  if(!(a.kind==='runtime'?['agent-perception','agent-inspect']:['human-inspect']).includes(purpose))fail('insufficient_scope',403,'Purpose is not permitted');
  const s=input.scope===undefined?{}:object(input.scope,['worldId','filters','spatial']);if(s.worldId!==undefined&&s.worldId!=='default')fail('scope_not_supported',409,'World scope is not supported');
  const spatial=s.spatial===undefined?{kind:'world'}:object(s.spatial,['kind','placeRef','locationRef','radiusMeters']);
  if(spatial.kind!=='world')fail(spatial.kind==='current-place'?'scope_unavailable':'scope_not_supported',409,'No live location source or spatial reader is enabled');
  if(Object.keys(spatial).length!==1)fail('scope_not_supported',409,'Spatial arguments are not supported');
  const filters=s.filters===undefined?{}:object(s.filters,['types','tags','spaceRefs']);if(Object.keys(filters).length)fail('scope_not_supported',409,'No filters are enabled in this catalog');
  validateDecision(input.decision);return {consumerId,purpose,scope:{worldId:'default',spatial:{kind:'world'},filters:{}}};
 }
 function validateDecision(value:unknown):void {if(value===undefined)return;const d=object(value,['summary','observationId','relatedRecordIds']);text(d.summary,'summary',1,240);if(d.observationId!==undefined)text(d.observationId,'observationId',1,100);if(d.relatedRecordIds!==undefined&&(!Array.isArray(d.relatedRecordIds)||d.relatedRecordIds.length>5||d.relatedRecordIds.some(v=>typeof v!=='string'||v.length>100)))fail('invalid_request',422,'Invalid declaration references');}
 function cleanup(tx:M1Transaction):void {
  for(const table of ['perception_access','perception_sessions'] as const)for(const row of tx.scan(table,{}, {limit:200})){
   if(table==='perception_access'?Number(row.data.recordedAt)<now()-settings.accessRetentionMs:Number(row.data.expiresAt)<=now())tx.remove(table,row.id,row.version);
  }
 }
 function capacity(tx:M1Transaction,a:Actor):void {cleanup(tx);if(tx.count('perception_access',{},settings.accessTotalLimit+1)>=settings.accessTotalLimit||tx.count('perception_access',{agentId:a.agentId},settings.accessPerAgentLimit+1)>=settings.accessPerAgentLimit)fail('storage_capacity',503,'Access record capacity is exhausted');}
 function session(tx:M1Transaction,a:Actor,kind:string,data:JsonObject,ttl=settings.pageTtlMs):string {
  if(tx.count('perception_sessions',{actorId:a.id},201)>=200||tx.count('perception_sessions',{},10_001)>=10_000)fail('storage_capacity',503,'Read session capacity is exhausted');
  const id=`ps_${randomUUID()}`;tx.insert('perception_sessions',{id,version:1,data:{...data,kind,actorId:a.id,actorKind:a.kind,permissionVersion:permission(tx,a),epoch:store.recoveryEpoch,expiresAt:now()+ttl}});return id;
 }
 function resume(tx:M1Transaction,a:Actor,id:unknown,kind:string):StoredRow {const token=text(id,'pageToken',8,100),s=tx.get('perception_sessions',token);if(!s||s.data.kind!==kind||s.data.actorId!==a.id||s.data.actorKind!==a.kind||s.data.epoch!==store.recoveryEpoch)fail('page_expired',410,'Read session is not available');if(Number(s.data.expiresAt)<=now())fail(kind==='completion'?'completion_expired':'page_expired',410,'Read session expired');if(s.data.permissionVersion!==permission(tx,a))fail('read_scope_changed',409,'Reading permissions or source states changed');return s;}
 function record(tx:M1Transaction,a:Actor,action:string,requestId:string,data:JsonObject,targets:ObjectRef[],privateRead:boolean,decision:unknown):void {
  if(a.kind!=='runtime')return;capacity(tx,a);
  const binding=privateRead?undefined:tx.scan('bindings',{agentId:a.agentId!,active:true},{limit:1})[0];
  const id=`${String(now()).padStart(16,'0')}_${randomUUID()}`;
  tx.insert('perception_access',{id,version:1,data:{recordId:id,agentId:a.agentId!,agentRef:{moduleId:'profiles',type:'profiles.agent@1',id:a.agentId!},actor:{kind:'runtime',agentId:a.agentId!},requestId,operationRef:action,receivedAt:now(),recordedAt:now(),humanAudienceOwnerId:binding?.data.ownerId??null,targets,scopePrivate:privateRead,result:{status:'data_provided',recordedAt:now(),preparedCount:Array.isArray(data.records)?data.records.length:null,contentVersion:data.version??null,segment:data.segment??null},declaration:null,declarationStatus:decision===undefined?'not_declared':'not_retained',relatedRecordIds:[]}});
 }
 function response(tx:M1Transaction,a:Actor,requestId:string,data:JsonObject,maxBytes=65_536):JsonObject {const r={protocolVersion:1,instanceId:store.instanceId,requestId,permissionVersion:permission(tx,a),data};if(Buffer.byteLength(JSON.stringify(r))>maxBytes)fail('budget_too_small',422,'The response cannot fit the requested budget');return r;}
 function discover(tx:M1Transaction,a:Actor,input:Record<string,unknown>):JsonObject {
  const limit=bounded(input.limit===undefined?undefined:Number(input.limit),50,50),catalog=catalogData(tx),query={limit};
  let snapshot=catalog,offset=0,saved:StoredRow|undefined;
  if(input.pageToken!==undefined){saved=resume(tx,a,input.pageToken,'discovery');if(key(saved.data.query)!==key(query))fail('read_scope_changed',409,'Discovery arguments changed');snapshot=plain(saved.data.snapshot);offset=Number(saved.data.offset);if(snapshot.catalogRevision!==catalog.catalogRevision||snapshot.skillCatalogRevision!==catalog.skillCatalogRevision)fail('read_scope_changed',409,'Catalog changed');}
  const collections=['worlds','modules','types','sources','categories','skills','operations'];const all=collections.flatMap(collection=>(snapshot[collection] as JsonValue[]).map(entry=>({collection,entry})));const page=all.slice(offset,offset+limit);const data:JsonObject={catalogRevision:snapshot.catalogRevision!,skillCatalogRevision:snapshot.skillCatalogRevision!,schemaReader:snapshot.schemaReader!,guideReader:snapshot.guideReader!,notEnabled:snapshot.notEnabled!};for(const name of collections)data[name]=page.filter(p=>p.collection===name).map(p=>p.entry);
  const next=offset+page.length;return {...data,nextPageToken:next<all.length?session(tx,a,'discovery',{query,snapshot,offset:next}):null,complete:next>=all.length};
 }
 function overview(tx:M1Transaction,a:Actor,input:Record<string,unknown>):JsonObject {
  const ctx=validateContext(input,a),budget=input.budget===undefined?{}:object(input.budget,['maxSections','maxResponseBytes','maxSourceReads','maxScannedRows','deadlineMs']);
  const maxSections=bounded(budget.maxSections,8,8,'maxSections'),maxRows=bounded(budget.maxScannedRows,200,200,'maxScannedRows'),maxReads=bounded(budget.maxSourceReads,8,8,'maxSourceReads'),deadline=now()+bounded(budget.deadlineMs,250,250,'deadlineMs');
  const maxBytes=bounded(budget.maxResponseBytes,16_384,16_384,'maxResponseBytes');
  const categoryIds=input.categoryIds===undefined?CATEGORIES.filter(c=>c.categoryId!=='rules').map(c=>c.categoryId):input.categoryIds;
  if(!Array.isArray(categoryIds)||categoryIds.length>8||new Set(categoryIds).size!==categoryIds.length||categoryIds.some(id=>!CATEGORIES.some(c=>c.categoryId===id)))fail('invalid_request',422,'Invalid overview categories');
  const known=input.knownContentRevisions===undefined?[]:input.knownContentRevisions;if(!Array.isArray(known)||known.length>16)fail('invalid_request',422,'Invalid content baselines');const knownKeys=new Set<string>();for(const value of known){const k=object(value,['categoryId','metricId','scopeKey','revision']);for(const field of ['categoryId','metricId','scopeKey','revision'])text(k[field],field,1,150);const id=key({categoryId:k.categoryId,metricId:k.metricId,scopeKey:k.scopeKey});if(knownKeys.has(id))fail('invalid_request',422,'Duplicate content baseline');knownKeys.add(id);}
  const sections:JsonObject[]=[];let scanned=0,reads=0;const started=Date.now();
  for(const categoryId of categoryIds.slice(0,maxSections)){
   const category=CATEGORIES.find(c=>c.categoryId===categoryId)!;if(a.kind!=='runtime'&&category.channel!=='world')fail('insufficient_scope',403,'Agent private views are not granted to a managing owner');
   const metrics:JsonObject[]=[];
   for(const metric of category.metrics){
    const sourceIds=[...metric.sourceIds] as string[],enabled=sourceIds.length>0&&sourceIds.every(id=>currentSource(tx,id)==='enabled'),unavailable=sourceIds.some(id=>currentSource(tx,id)==='unavailable');
    const omitted=reads>=maxReads||scanned>=maxRows||now()>=deadline||Date.now()-started>=bounded(budget.deadlineMs,250,250,'deadlineMs');
    const status=!sourceIds.length?'not_enabled':unavailable?'unavailable':!enabled?'not_enabled':omitted?'not_requested':'available';let selected:{candidates:Candidate[];complete:boolean;scanned:number}|undefined;
    if(status==='available'){reads++;selected=selection(tx,a,category.categoryId,metric.metricId,category.categoryId==='notifications',Math.max(1,maxRows-scanned));scanned+=selected.scanned;}
    const complete=selected?.complete===true,scopeKey=selected?key({actor:a.id,kind:a.kind,purpose:ctx.purpose,categoryId,metricId:metric.metricId,scope:ctx.scope,permission:permission(tx,a),grants:selected.candidates.filter(c=>c.grant).map(c=>({id:c.grant!.id,version:c.grant!.version}))}):null;
    const revision=complete?key(selected!.candidates.map(c=>({ref:c.ref,version:c.row.version,contentHash:key(c.row.data),grantVersion:c.grant?.version??null,state:category.channel==='inbox'?readState(tx,a,c):null}))):null;
    const baseline=known.find(v=>{const k=v as Record<string,unknown>;return k.categoryId===categoryId&&k.metricId===metric.metricId&&k.scopeKey===scopeKey;}) as Record<string,unknown>|undefined;
    metrics.push({metricId:metric.metricId,status,sourceStates:status==='not_requested'?[]:sourceIds.map(sourceId=>({sourceId,state:currentSource(tx,sourceId)})),sourceCoverage:{complete:status==='available'?complete:false,checkedSourceIds:status==='available'?sourceIds:[],omittedReason:status==='not_requested'||(selected&&!complete)?'budget':status==='unavailable'?'unavailable':null},count:{value:selected?selected.candidates.length:null,relation:complete?'exact':selected?'lower_bound':'unknown',unit:metric.unit},presence:selected?(selected.candidates.length>0?true:complete?false:null):null,observedAt:now(),freshness:complete?'fresh':'unknown',scopeKey,contentRevision:revision,contentChanged:baseline&&revision?baseline.revision!==revision:null,listEntry:enabled?{operationId:'list',arguments:{channel:category.channel,categoryId,metricId:metric.metricId,scope:ctx.scope,...(categoryId==='notifications'?{selection:'unconfirmed'}:{})}}:null});
   }
   sections.push({categoryId,channel:category.channel,resolvedScope:category.channel==='world'?ctx.scope:{worldId:'default',subject:'authenticated-agent',spatialApplied:false},metrics});
  }
  const catalog=tx.get('perception_catalog','current')!;
  const data:JsonObject={observationId:`observation_${randomUUID()}`,worldId:'default',name:'connet.ai 世界',description:'获准真实存储内容，演示来源逐项标识',rulesRef:RULES_REF,rulesVersion:1,catalogRevision:catalog.data.catalogRevision!,skillCatalogRevision:catalog.data.skillCatalogRevision!,catalogChanged:input.knownCatalogRevision===undefined?null:input.knownCatalogRevision!==catalog.data.catalogRevision,skillsChanged:input.knownSkillCatalogRevision===undefined?null:input.knownSkillCatalogRevision!==catalog.data.skillCatalogRevision,sections,coverage:{requested:categoryIds as string[],returned:sections.map(s=>s.categoryId!),omitted:categoryIds.slice(maxSections).map(categoryId=>({categoryId,reason:'budget'}))},budgetUsed:{sourceReads:reads,scannedRows:scanned}};
  response(tx,a,'budget_measure',data,maxBytes);return data;
 }
 function list(tx:M1Transaction,a:Actor,input:Record<string,unknown>):JsonObject {
  const ctx=validateContext(input,a),categoryId=text(input.categoryId,'categoryId',1,60),category=CATEGORIES.find(c=>c.categoryId===categoryId);if(!category||input.channel!==category.channel)fail('invalid_request',422,'Category does not belong to the channel');
  const metricId=input.metricId===undefined?null:text(input.metricId,'metricId',1,60);if(metricId&&!category.metrics.some(m=>m.metricId===metricId))fail('invalid_request',422,'Unknown category metric');
  if(input.selection!==undefined&&(categoryId!=='notifications'||input.selection!=='unconfirmed'))fail('invalid_request',422,'Selection is not supported');
  if(a.kind!=='runtime'&&category.channel!=='world')fail('insufficient_scope',403,'Agent private views are not granted');for(const source of category.sourceIds)checkSource(tx,source);
  if(categoryId==='people'&&metricId==='humans')fail('channel_not_enabled',409,'Public human identity source is not enabled');
  const limit=bounded(input.limit,20,50),query={...ctx,categoryId,channel:category.channel,metricId,selection:input.selection??null,limit};
  let records:JsonObject[],offset=0,readSessionId:string;
  if(input.pageToken!==undefined){const s=resume(tx,a,input.pageToken,'list');if(key(s.data.query)!==key(query))fail('read_scope_changed',409,'List arguments changed');records=s.data.records as JsonObject[];offset=Number(s.data.offset);readSessionId=String(s.data.readSessionId);for(const record of records){try{readable(tx,a,ref(record.ref),category.channel,true);}catch{fail('read_scope_changed',409,'A selected object is no longer readable');}}}
  else{const result=selection(tx,a,categoryId,metricId,input.selection==='unconfirmed'||metricId==='unconfirmed',2000);if(!result.complete)fail('source_unavailable',503,'The bounded list selection cannot prove completion');records=result.candidates.map(c=>summary(tx,a,c));readSessionId=`list_${randomUUID()}`;}
  const page=records.slice(offset,offset+limit).map(r=>category.channel==='inbox'?{...r,agentReadState:r.detailAvailable===true?readState(tx,a,readable(tx,a,ref(r.ref),'inbox')):null}:r),next=offset+page.length;
  return {channel:category.channel,consumerId:ctx.consumerId,categoryId,metricId,selection:input.selection??null,scope:ctx.scope,scopeHash:key(ctx.scope),readSessionId,sourceSetVersion:permission(tx,a),sourceStates:category.sourceIds.map(sourceId=>({sourceId,state:currentSource(tx,sourceId)})),records:page,nextPageToken:next<records.length?session(tx,a,'list',{query,records,offset:next,readSessionId}):null,complete:next>=records.length,checkpoint:null};
 }
 function detail(tx:M1Transaction,a:Actor,input:Record<string,unknown>):JsonObject {
  const ctx=validateContext(input,a),r=ref(input.ref),channel=text(input.channel,'channel',1,30),c=readable(tx,a,r,channel);let offset=0,readSessionId=`body_${randomUUID()}`;
  if(input.knownVersion!==undefined)version(input.knownVersion,'knownVersion');
  if(input.contentToken!==undefined){const s=resume(tx,a,input.contentToken,'detail');if(key(s.data.ref)!==key(r)||s.data.channel!==channel||key(s.data.context)!==key(ctx))fail('read_scope_changed',409,'Detail context changed');if(s.data.contentVersion!==c.row.version)fail('content_changed',409,'Content version changed');if(s.data.grantVersion!==(c.grant?.version??null))fail('read_scope_changed',409,'Content grant changed');offset=Number(s.data.offset);readSessionId=String(s.data.readSessionId);}
  const body=String(c.row.data.body??''),end=Math.min(offset+settings.detailSegmentChars,body.length),complete=end>=body.length,attachments=Array.isArray(c.row.data.attachments)?c.row.data.attachments:[];
  if(attachments.length>50||Buffer.byteLength(JSON.stringify(attachments))>8000)fail('source_unavailable',503,'Attachment descriptions exceed the bounded source contract');
  const data:JsonObject={ref:r,version:c.row.version,schema:{id:`${TYPE_DEFINITIONS.find(t=>t.type===r.type)!.prefix}-detail`,version:1},sourceId:c.row.data.sourceId!,content:{text:body.slice(offset,end),dataMode:c.row.data.dataMode!,source:c.row.data.source??{kind:'unknown'},...(c.row.data.fields?{fields:c.row.data.fields}:{}),...(c.row.data.itemRef?{itemRef:c.row.data.itemRef,quantity:c.row.data.quantity??1}:{})},segment:{start:offset,end,total:body.length,unit:'utf16-code-units'},attachments:complete?attachments:[],actions:[],contentComplete:complete,nextContentToken:complete?null:session(tx,a,'detail',{ref:r,channel,context:ctx,contentVersion:c.row.version,grantVersion:c.grant?.version??null,offset:end,readSessionId}),readSessionId};
  if(channel==='inbox'){data.agentReadState=readState(tx,a,c);if(complete)data.completionToken=session(tx,a,'completion',{ref:r,channel,contentVersion:c.row.version,grantVersion:c.grant?.version??null,readSessionId},settings.completionTtlMs);}
  return data;
 }
 function confirm(tx:M1Transaction,a:Actor,input:Record<string,unknown>):JsonObject {
  if(a.kind!=='runtime')fail('insufficient_scope',403,'Only the actual Agent may confirm');const r=ref(input.ref),c=readable(tx,a,r,'inbox'),operationId=text(input.operationId,'operationId',8,100),scope=`perception-agent:${a.agentId}`;
  const prior=tx.scan('operations',{scope,action:'confirmAgentRead',operationId,epoch:store.recoveryEpoch},{limit:1})[0];
  if(prior){if(prior.data.payloadHash!==key(input))fail('operation_id_conflict',409,'Operation payload changed');return plain(prior.data.result);}
  validateDecision(input.decision);
  if(tx.count('operations',{action:'confirmAgentRead'},settings.receiptLimit+1)>=settings.receiptLimit)fail('storage_capacity',503,'Confirmation receipt capacity is exhausted');
  const completion=resume(tx,a,input.completionToken,'completion');if(key(completion.data.ref)!==key(r))fail('target_not_accessible',404,'Completion proof is not for this target');
  if(completion.data.grantVersion!==(c.grant?.version??null))fail('read_scope_changed',409,'Completion grant changed');
  if(version(input.contentVersion,'contentVersion')!==c.row.version||completion.data.contentVersion!==c.row.version)fail('content_changed',409,'The current message version changed');
  const stateId=key({agentId:a.agentId,objectId:c.row.id}),state=tx.get('perception_states',stateId),changed=state?.data.confirmedContentVersion!==c.row.version;
  const stateVersion=changed?(state?.version??0)+1:state!.version,confirmedAt=changed?now():state!.data.confirmedAt!;
  if(changed){const row={id:stateId,version:stateVersion,data:{agentId:a.agentId!,objectId:c.row.id,confirmedContentVersion:c.row.version,confirmedAt}};if(state)tx.update('perception_states',row,state.version);else tx.insert('perception_states',row);}
  const result:JsonObject={agentId:a.agentId!,operationId,ref:r,confirmedContentVersion:c.row.version,stateVersion,confirmedAt,changed,outcome:'committed',receiptId:randomUUID(),serverTime:now()};
  tx.insert('operations',{id:randomUUID(),version:1,data:{scope,action:'confirmAgentRead',operationId,epoch:store.recoveryEpoch,payloadHash:key(input),result}});
  tx.insert('facts',{id:randomUUID(),version:1,data:{action:'confirmAgentRead',operationId,receiptId:result.receiptId!,actor:{kind:'runtime',agentId:a.agentId!},agentId:a.agentId!,ref:r,contentVersion:c.row.version,changed,time:now(),visibility:'agent_private',epoch:store.recoveryEpoch}});
  return result;
 }
 function activity(tx:M1Transaction,a:Actor,input:Record<string,unknown>):JsonObject {
  if(a.kind!=='owner_session')fail('insufficient_scope',403,'Human record-reading permission is required');const ar=ref(input.agentRef);if(ar.moduleId!=='profiles'||ar.type!=='profiles.agent@1'||!tx.scan('bindings',{agentId:ar.id,ownerId:a.ownerId!,active:true},{limit:1}).length)fail('target_not_accessible',404,'Target is not accessible');
  const limit=bounded(input.limit,20,50);let records:JsonObject[],offset=0,cut=now();
  if(input.pageToken!==undefined){const saved=resume(tx,a,input.pageToken,'activity');if(key(saved.data.agentRef)!==key(ar)||saved.data.limit!==limit)fail('read_scope_changed',409,'Activity query changed');records=saved.data.records as JsonObject[];offset=Number(saved.data.offset);cut=Number(saved.data.cut);}
  else records=tx.scan('perception_access',{agentId:ar.id,humanAudienceOwnerId:a.ownerId!},{limit:Math.min(settings.accessPerAgentLimit,1000)}).map(row=>row.data);
  // A public ref does not make the log public; both audience-at-write and current source rights apply.
  records=records.filter(r=>r.humanAudienceOwnerId===a.ownerId&&r.scopePrivate===false&&(r.targets as JsonObject[]).every(target=>{try{return readable(tx,a,ref(target),'world').row.data.public===true;}catch{return false;}}));
  const page=records.slice(offset,offset+limit).map(r=>{const {humanAudienceOwnerId,scopePrivate,...safe}=r;return safe;});const next=offset+page.length;
  return {agentRef:ar,records:page,nextPageToken:next<records.length?session(tx,a,'activity',{agentRef:ar,records,offset:next,cut,limit}):null,complete:next>=records.length,checkpoint:null,historyCoverage:{from:null,to:cut,complete:false,olderDetailsExpired:null}};
 }
 function invoke(action:PerceptionAction,raw:unknown,token:unknown):JsonObject {
  return store.transaction(tx=>{
   const a=actor(tx,token),requestId=`request_${randomUUID()}`;cleanup(tx);
   let allowed:string[];
   if(action==='perceptionDiscovery')allowed=['limit','pageToken','protocolVersion'];else if(action==='perceptionSchema')allowed=['schemaId','version'];else if(action==='perceptionGuide')allowed=['moduleId','version'];else if(action==='perceptionOverview')allowed=['protocolVersion','consumerId','purpose','scope','categoryIds','knownCatalogRevision','knownSkillCatalogRevision','knownContentRevisions','budget','decision'];else if(action==='perceptionList')allowed=[...common,'categoryId','metricId','selection'];else if(action==='perceptionDetail')allowed=[...common.filter(k=>!['limit','pageToken','scope'].includes(k)),'ref','knownVersion','contentToken'];else if(action==='queryAgentRead')allowed=['protocolVersion','ref'];else if(action==='confirmAgentRead')allowed=['protocolVersion','operationId','ref','contentVersion','completionToken','decision'];else allowed=['protocolVersion','agentRef','limit','pageToken'];
   const input=object(raw,allowed);if(!['perceptionDiscovery','perceptionSchema','perceptionGuide'].includes(action)&&input.protocolVersion!==1)fail('protocol_unsupported',422,'Protocol major 1 is required');if(action==='perceptionDiscovery'&&input.protocolVersion!==undefined&&Number(input.protocolVersion)!==1)fail('protocol_unsupported',422,'Protocol major 1 is required');
   let data:JsonObject;
   if(action==='perceptionDiscovery')data=discover(tx,a,input);
   else if(action==='perceptionSchema'||action==='perceptionGuide'){
    const field=action==='perceptionSchema'?'schemaId':'moduleId',id=text(input[field],field,1,100),v=Number(input.version);if(!Number.isSafeInteger(v)||v<1)fail('invalid_request',422,'An exact document version is required');const row=tx.get('perception_catalog',`${action==='perceptionSchema'?'schema':'guide'}:${id}:${v}`);if(!row)fail('target_not_accessible',404,'Document is not registered');data={...(action==='perceptionSchema'?{schemaId:id}:{moduleId:id}),version:v,document:row.data.document!,digest:row.data.digest!};
   }else if(action==='perceptionOverview')data=overview(tx,a,input);
   else if(action==='perceptionList')data=list(tx,a,input);
   else if(action==='perceptionDetail')data=detail(tx,a,input);
   else if(action==='queryAgentRead'){if(a.kind!=='runtime')fail('insufficient_scope',403,'Only the actual Agent may query confirmation');data=readState(tx,a,readable(tx,a,ref(input.ref),'inbox'));}
   else if(action==='confirmAgentRead')data=confirm(tx,a,input);
   else data=activity(tx,a,input);
   const result=response(tx,a,requestId,data,action==='perceptionOverview'?bounded(plain(input.budget as JsonValue).maxResponseBytes,16_384,16_384,'maxResponseBytes'):65_536);
   if(action!=='perceptionActivity'&&action!=='confirmAgentRead'){
    const targets=action==='perceptionDetail'||action==='queryAgentRead'?[ref(input.ref)]:Array.isArray(data.records)?data.records.map(v=>ref(plain(v).ref)):[];
    const privateRead=input.channel==='inbox'||input.channel==='inventory'||action==='queryAgentRead'||(action==='perceptionOverview'&&(data.sections as JsonObject[]).some(s=>s.channel!=='world'));
    record(tx,a,action,requestId,data,targets,privateRead,input.decision);
   }
   return result;
  });
 }
 return {invoke,handles:(action:string)=>OPERATIONS.some(o=>o.action===action),capabilities:()=>store.read(tx=>{const c=tx.get('perception_catalog','current')!;return {protocolVersion:1,discovery:{method:'GET',path:'/v1/perception/discovery'},catalogRevision:c.data.catalogRevision!,skillCatalogRevision:c.data.skillCatalogRevision!,manualOnly:true,snapshot:false,changes:false,activity:true,confirmation:true};}),readReceipt(tx:M1Transaction,token:unknown,row:StoredRow):JsonObject {const a=actor(tx,token);if(a.kind!=='runtime'||row.data.scope!==`perception-agent:${a.agentId}`||row.data.action!=='confirmAgentRead')fail('target_not_accessible',404,'Operation is not accessible');const result=plain(row.data.result);readable(tx,a,ref(result.ref),'inbox');return result;}};
}
