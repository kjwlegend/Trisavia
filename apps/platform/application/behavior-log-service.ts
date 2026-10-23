import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {IdentityAccess,OwnerObservationDomain,Principal} from '../domains/access/public.ts';
import {BEHAVIOR_REPOSITORY} from '../domains/behavior/repository.ts';
import {BEHAVIOR_SCOPES,type BehaviorRecord} from '../domains/behavior/types.ts';
import {fail,M1Error,object,text} from '../domains/common/errors.ts';
import {hashRuntimeRequest} from '../domains/runtime/command.ts';
import {createGatewayContinuation} from './agent-gateway-continuation.ts';

interface BehaviorSource {
 canObserveBehavior(ctx:RuntimeReadContext,record:BehaviorRecord,audience:'owner'|'public'):Promise<boolean>;
 behaviorDetailRef?(ctx:RuntimeReadContext,record:BehaviorRecord):Promise<{invitationId:string}|null>;
 invitation?(ctx:RuntimeReadContext,p:Principal,input:JsonObject):Promise<unknown>;
}
type Sources=Record<OwnerObservationDomain,BehaviorSource>;
type Cut={maxSequence:number;asOf:number};
type Anchor={cut:Cut;after:{occurredAt:number;id:string}};
const absent=():never=>fail('target_not_accessible',404,'Target is not accessible');
const natural:Record<BehaviorRecord['node'],[string,string,string]>={
 'world.movement.received':['移动请求已收到','提交移动','已收到前往请求'],
 'world.movement.started':['已经出发','移动','已出发'],
 'world.movement.completed':['已完成移动','移动','已完成本次移动'],
 'world.movement.stopped':['移动已停止','移动','已停止本次移动'],
 'world.idle.completed':['完成一段漫步','日常漫游','已完成一段日常漫游'],
 'relationships.invitation.sent':['已发出好友申请','好友申请','好友申请已发出'],
 'relationships.invitation.received':['收到好友申请','好友申请','已收到一份好友申请'],
 'relationships.invitation.accepted':['已成为好友','好友申请','双方已确认好友关系'],
 'relationships.invitation.declined':['好友申请已拒绝','好友申请','本次申请已拒绝'],
 'relationships.invitation.cancelled':['好友申请已取消','好友申请','本次申请已取消'],
 'relationships.invitation.expired':['好友申请已到期','好友申请','本次申请已到期'],
 'interaction.invitation.sent':['已发出文字交流邀请','作品交流','本次交流邀请已发出'],
 'interaction.invitation.received':['收到文字交流邀请','作品交流','已收到本次交流邀请'],
 'interaction.invitation.accepted':['已接受文字交流邀请','作品交流','已同意本次文字交流'],
 'interaction.invitation.declined':['文字交流邀请已拒绝','作品交流','本次交流邀请已拒绝'],
 'interaction.invitation.withdrawn':['文字交流邀请已撤回','作品交流','本次交流邀请已撤回'],
 'interaction.invitation.expired':['文字交流邀请已到期','作品交流','本次交流邀请已到期'],
 'interaction.feedback.submitted':['反馈已提交','作品交流','当时已提交反馈，尚未确认收到'],
 'interaction.activity.closed':['已确认收到反馈','作品交流','已确认收到并结束本次往来'],
 'interaction.activity.left':['文字交流已结束','作品交流','本次往来已退出'],
 'interaction.activity.expired':['文字交流已到期','作品交流','本次往来已到期'],
};
export async function behaviorSourcesEnabled(ctx:RuntimeReadContext){const rows=await ctx.repository(BEHAVIOR_REPOSITORY).getCoverage();return BEHAVIOR_SCOPES.every(scope=>rows.some(row=>row.scope===scope&&row.policyVersion===1));}
function timeZoneOf(value:unknown){const zone=value===undefined?'UTC':text(value,'timeZone',1,80);try{new Intl.DateTimeFormat('en',{timeZone:zone});return zone;}catch{fail('invalid_request',400,'Choose an IANA time zone');}}
function localDate(at:number,timeZone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at),get=(type:string)=>parts.find(p=>p.type===type)!.value;return get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day');}
function validDate(value:unknown){const date=text(value,'date',10,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('invalid_request',400,'Use YYYY-MM-DD dates');const stamp=Date.parse(date+'T00:00:00.000Z');if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)fail('invalid_request',400,'Invalid calendar date');return date;}
/** Earliest UTC instant at the requested local day: also handles DST changes at midnight. */
function boundary(date:string,timeZone:string){const noon=Date.parse(date+'T12:00:00.000Z');let lo=noon-48*3600000,hi=noon+48*3600000;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(localDate(mid,timeZone)<date)lo=mid+1;else hi=mid;}return lo;}
function nextDay(date:string){return new Date(Date.parse(date+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);}
function rangeOf(input:JsonObject,timeZone:string){const from=input.fromDate===undefined?null:validDate(input.fromDate),to=input.toDate===undefined?null:validDate(input.toDate);if(from&&to&&from>to)fail('invalid_request',400,'Start date must not follow end date');return {fromDate:from,toDate:to,fromAt:from?boundary(from,timeZone):undefined,toAt:to?boundary(nextDay(to),timeZone):undefined};}
function limitOf(value:unknown){const limit=value??20;if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>50)fail('invalid_request',400,'Choose a limit from 1 to 50');return limit;}

/** Source projections, read authorization and human wording; it never changes a business or read state. */
export function createBehaviorLogService(identity:IdentityAccess<RuntimeReadContext>,sources:Sources){
 const cursors=createGatewayContinuation(1024);
 async function coverage(ctx:RuntimeReadContext,asOf:number){const rows=await ctx.repository(BEHAVIOR_REPOSITORY).getCoverage();if(BEHAVIOR_SCOPES.some(scope=>!rows.some(row=>row.scope===scope)))fail('behavior_unavailable',503,'Behavior sources have not been enabled');const starts=rows.map(row=>row.fromAt),gaps=['启用前的记录未补录'];if(rows.some(row=>row.scope==='world_idle'&&row.partial))gaps.push('日常漫游仅记录部分完成节点');if(new Set(starts).size>1)gaps.push('各来源启用时间不同，更早记录不完整');return {from:Math.min(...starts),to:asOf,complete:rows.every(row=>!row.partial)&&new Set(starts).size===1,gaps};}
 async function visible(ctx:RuntimeReadContext,row:BehaviorRecord,audience:'owner'|'public',p?:Principal){
  if(audience==='public'&&!row.publicProjection)return false;
  if(audience==='owner'){
   if(p?.kind!=='owner'||row.ownerAudience?.ownerId!==p.ownerId)return false;
   const current=await identity.captureOwnerObservation?.(ctx,row.agentId,row.sourceDomain);
   if(!current||current.ownerId!==p.ownerId||current.authorizationVersion!==row.ownerAudience.authorizationVersion||current.bindingId!==row.ownerAudience.bindingId||current.bindingVersion!==row.ownerAudience.bindingVersion||current.sharingGeneration!==row.ownerAudience.sharingGeneration)return false;
  }
  return await sources[row.sourceDomain].canObserveBehavior(ctx,row,audience);
 }
 async function item(ctx:RuntimeReadContext,row:BehaviorRecord,timeZone:string,owner?:Principal):Promise<JsonObject>{
  const profile=await identity.readPublicAgent(ctx,row.agentId),[originalTitle,action,originalResult]=natural[row.node];let title=originalTitle,result=originalResult;
  const place=row.publicProjection?.placeName;
  if(place&&row.node==='world.movement.started')result='从'+place+'出发';
  if(place&&row.node==='world.movement.completed')title=result='已抵达'+place;
  if(place&&row.node==='world.idle.completed')title=result='在'+place+'结束一段漫步';
  let detail:JsonObject|null=null;
  if(owner&&row.sourceRef.type==='friendship_invitation'&&sources.relationships.invitation){
   const input={agentId:row.agentId,requestId:row.sourceRef.id};
   try{await sources.relationships.invitation(ctx,owner,input);detail={operation:'relationships.invitation',input};}catch(error){if(!(error instanceof M1Error)||error.statusCode>=500)throw error;}
  }
  if(owner&&row.sourceRef.type==='interaction_invitation')detail={operation:'interaction.owner_exchange',input:{agentId:row.agentId,invitationId:row.sourceRef.id}};
  if(owner&&row.sourceRef.type==='interaction_activity'){const ref=await sources.interaction.behaviorDetailRef?.(ctx,row);if(ref)detail={operation:'interaction.owner_exchange',input:{agentId:row.agentId,invitationId:ref.invitationId}};}
  const time=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(row.occurredAt);
  return {id:row.id,agent:{agentId:row.agentId,displayName:profile?.displayName??null},title,action,result,occurredAt:row.occurredAt,date:localDate(row.occurredAt,timeZone),time,source:{domain:row.sourceDomain,node:row.node,detail}};
 }
 function base(agentId:string|null,timeZone:string,items:JsonObject[],historyCoverage:JsonObject,partial:boolean,nextPageToken:string|null,asOf:number){return {worldId:'default',agentId,timeZone,items,historyCoverage,partial,nextPageToken,asOf};}
 async function publicRead(ctx:RuntimeReadContext,input:JsonObject,agentId:string|null){
  object(input,agentId===null?['worldId','timeZone']:['agentId','timeZone']);if(input.worldId!==undefined&&input.worldId!=='default')absent();
  const timeZone=timeZoneOf(input.timeZone);if(agentId!==null&&!await identity.readPublicAgent(ctx,agentId))absent();
  const repo=ctx.repository(BEHAVIOR_REPOSITORY),cut=await repo.cut(),historyCoverage=await coverage(ctx,cut.asOf),items:JsonObject[]=[],counts=new Map<string,number>(),cap=agentId===null?30:10;
  let after:{occurredAt:number;id:string}|undefined,scanned=0,complete=false;
  while(scanned<500&&items.length<cap&&!complete){const size=Math.min(50,500-scanned),rows=await repo.list({maxSequence:cut.maxSequence,publicOnly:true,toAt:cut.asOf+1,...(agentId===null?{}:{agentId}),...(after?{after}:{}),limit:size});if(!rows.length){complete=true;break;}
   for(const row of rows){scanned++;after={occurredAt:row.occurredAt,id:row.id};if((counts.get(row.agentId)??0)>=10)continue;if(!await visible(ctx,row,'public'))continue;counts.set(row.agentId,(counts.get(row.agentId)??0)+1);items.push(await item(ctx,row,timeZone));if(items.length===cap)break;}
   if(rows.length<size)complete=true;
  }
  return base(agentId,timeZone,items,historyCoverage,!complete&&items.length<cap,null,cut.asOf);
 }
 return {
  publicWorld:(ctx:RuntimeReadContext,input:JsonObject)=>publicRead(ctx,input,null),
  publicRecent:(ctx:RuntimeReadContext,input:JsonObject)=>publicRead(ctx,input,text(input.agentId,'agentId',1,100)),
  async ownerHistory(ctx:RuntimeReadContext,p:Principal,input:JsonObject){
   object(input,['agentId','timeZone','fromDate','toDate','limit','pageToken']);if(p.kind!=='owner')fail('owner_identity_required',403,'Owner history requires the current Owner session');
   const agentId=text(input.agentId,'agentId',1,100),authority=await identity.authorizeAgent(ctx,p,agentId),participation=await identity.readParticipation(ctx,agentId),proof=await identity.captureOwnerObservation?.(ctx,agentId,'world');
   if(!proof||proof.ownerId!==p.ownerId||!authority.binding)absent();
   const timeZone=timeZoneOf(input.timeZone),range=rangeOf(input,timeZone),limit=limitOf(input.limit),repo=ctx.repository(BEHAVIOR_REPOSITORY),profile=await identity.readPublicAgent(ctx,agentId);
   const scope={instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,principal:p.ownerId,authorizationVersion:hashRuntimeRequest({authority:authority.authorizationVersion,proof:{...proof},participation:{...participation,membership:{...participation.membership}},profile:profile?{publishedVersion:profile.publishedVersion,displayName:profile.displayName}:null,visibilityVersion:await repo.visibilityVersion(agentId)}),query:'behavior.owner_history',target:JSON.stringify([agentId,timeZone,range.fromDate,range.toDate]),limit};
   let anchor:Anchor|undefined;if(input.pageToken!==undefined){try{anchor=JSON.parse(cursors.decode(text(input.pageToken,'pageToken',1,2048),scope,ctx.now())) as Anchor;if(!Number.isSafeInteger(anchor.cut.maxSequence)||anchor.cut.maxSequence<0||!Number.isSafeInteger(anchor.cut.asOf)||anchor.cut.asOf>ctx.now()||!Number.isSafeInteger(anchor.after.occurredAt)||typeof anchor.after.id!=='string')throw new Error('Invalid anchor');}catch{fail('invalid_cursor',409,'Restart the current history query');}}
   const cut=anchor?.cut??await repo.cut(),historyCoverage=await coverage(ctx,cut.asOf),items:JsonObject[]=[];let after=anchor?.after,scanned=0,complete=false,byteBudget=0,budgetHit=false;
   while(items.length<limit&&scanned<500&&!complete&&!budgetHit){const size=Math.min(50,500-scanned),rows=await repo.list({agentId,maxSequence:cut.maxSequence,...(range.fromAt===undefined?{}:{fromAt:Math.max(0,range.fromAt)}),toAt:Math.max(0,Math.min(range.toAt??cut.asOf+1,cut.asOf+1)),...(after?{after}:{}),limit:size});if(!rows.length){complete=true;break;}
    for(let i=0;i<rows.length;i++){const row=rows[i]!;scanned++;if(await visible(ctx,row,'owner',p)){const projected=await item(ctx,row,timeZone,p),bytes=Buffer.byteLength(JSON.stringify(projected));if(byteBudget+bytes>60000){budgetHit=true;break;}items.push(projected);byteBudget+=bytes;}after={occurredAt:row.occurredAt,id:row.id};if(items.length===limit){complete=i===rows.length-1&&rows.length<size;break;}}
    if(!budgetHit&&items.length<limit&&rows.length<size)complete=true;
   }
   return base(agentId,timeZone,items,historyCoverage,!complete&&(scanned>=500||budgetHit),!complete&&after?cursors.encode(JSON.stringify({cut,after}),scope,ctx.now()):null,cut.asOf);
  },
 };
}
