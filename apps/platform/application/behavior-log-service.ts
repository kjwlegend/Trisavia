import {createBehaviorJournal} from './behavior-journal.ts';
import {journalAudienceRef} from '../domains/behavior/journal.ts';
import type {AuthoredJournalView} from '../domains/behavior/journal.ts';
import journalPolicy from '../../../docs/workstreams/ws03-interaction/life-journal-v1/event-expression-map.json' with {type:'json'};
import type {PublicAgentView} from '../domains/access/public.ts';
import type {ProfileAvatar} from '../domains/profile/appearance.ts';
import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {IdentityAccess,OwnerObservationDomain,Principal} from '../domains/access/public.ts';
import {BEHAVIOR_REPOSITORY} from '../domains/behavior/repository.ts';
import {BEHAVIOR_SCOPES,USER_LOG_PROCESS_NODES,JOURNAL_SUPPRESSED_NODES,type BehaviorDetails,type BehaviorRecord} from '../domains/behavior/types.ts';
import {eligibleForPublicWorldLog} from '../domains/behavior/world-public-selection.ts';
import {fail,M1Error,object,text} from '../domains/common/errors.ts';
import {hashRuntimeRequest} from '../domains/runtime/command.ts';
import {createGatewayContinuation} from './agent-gateway-continuation.ts';

interface BehaviorSource {
 canObserveBehavior(ctx:RuntimeReadContext,record:BehaviorRecord,audience:'owner'|'public'):Promise<boolean>;
 describeBehavior(ctx:RuntimeReadContext,record:BehaviorRecord,audience:'owner'|'public'):Promise<BehaviorDetails|null>;
 readNpcIdentity?(ctx:RuntimeReadContext,npcId:string):Promise<{name:string;appearance?:ProfileAvatar|import('../domains/npc-life/types.ts').NpcLifeSprite;publishedVersion?:number;publicId?:string}|null>;
 behaviorDetailRef?(ctx:RuntimeReadContext,record:BehaviorRecord):Promise<{invitationId:string}|null>;
 invitation?(ctx:RuntimeReadContext,p:Principal,input:JsonObject):Promise<unknown>;
}
type Sources=Record<'world'|'relationships'|'interaction',BehaviorSource>&Partial<Record<OwnerObservationDomain,BehaviorSource>>;
type Cut={maxSequence:number;asOf:number};
type Anchor={cut:Cut;after:{occurredAt:number;id:string}};
const absent=():never=>fail('target_not_accessible',404,'Target is not accessible');
const phaseLabels:Record<BehaviorDetails['phase'],string>={movement:'移动',wander:'日常漫游',friendship_request:'好友申请',text_invitation:'文字交流邀请',text_feedback:'文字反馈',npc_service:'镇民服务',life_care:'照料',life_work:'工作',life_rest:'休息',life_fishing:'钓鱼',life_trade:'商店交易',life_meal:'餐食',life_reading:'阅读',life_visit:'到访',gift:'赠礼'};
function actorLabel(kind:'agent'|'owner'|'system'|'npc',executor=false){return kind==='owner'?'主人明确操作':kind==='system'?(executor?'世界系统推进':'世界系统发起'):(executor?'角色执行':'角色发起');}
const natural:Record<BehaviorRecord['node'],[string,string,string]>={
 'life.journal.authored':['生活自述','记录最终自述','角色本人提交了生活自述'],
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
 'relationships.gift.offered':['寄出一份礼物','赠礼','礼物等待朋友领取'],
 'relationships.gift.received':['收到一份待领取礼物','赠礼','尚未接受这份礼物'],
 'relationships.gift.accepted':['礼物已领取','赠礼','礼物已由收件人明确接受'],
 'relationships.gift.declined':['礼物已婉拒','赠礼','预留物品已释放'],
 'relationships.gift.withdrawn':['礼物已撤回','赠礼','预留物品已释放'],
 'relationships.gift.expired':['礼物已到期','赠礼','未领取的礼物已释放'],
 'relationships.gift.unavailable':['礼物无法继续','赠礼','未交付的礼物已释放'],
 'life.meal.prepared':['加工好一份鱼餐','餐食加工','已完成本次鱼餐加工'],
 'life.meal.completed':['完成一次用餐','用餐','已完成本次用餐'],
 'life.reading.completed':['完成一次阅读活动','阅读','已完成本次阅读活动'],
 'life.visit.completed':['完成一次场所到访','到访','已在真实场所停留'],
 'life.fishing.finished':['完成一次钓鱼','钓鱼','本次钓鱼已结束'],
 'life.purchase.completed':['买到生活物品','购买','本次购买已完成'],
 'life.sale.completed':['出售自己的鱼','售鱼','本次售鱼已完成'],
 'life.care.introduced':['了解园务说明','照料介绍','已在场取得本次园务介绍'],
 'life.care.completed':['完成一轮照料','照料','已完成本轮照料'],
 'life.work.completed':['完成一班工作','工作','已完成本次工作'],
 'life.rest.completed':['完成一次休息','休息','已完成本次休息'],
 'life.activity.interrupted':['活动已中止','生活活动','本次活动已中止'],
 'town_services.greeted':['已打过招呼','NPC招呼','已与这位镇民打过招呼'],
 'town_services.service.started':['服务已开始','NPC服务','本次服务已开始，尚未完成'],
 'town_services.service.completed':['服务已完成','NPC服务','本次服务已完成'],
 'town_services.service.cancelled':['服务已取消','NPC服务','本次服务已取消'],
};
export async function behaviorSourcesEnabled(ctx:RuntimeReadContext){const rows=await ctx.repository(BEHAVIOR_REPOSITORY).getCoverage();return BEHAVIOR_SCOPES.filter(scope=>scope!=='life').every(scope=>rows.some(row=>row.scope===scope&&row.policyVersion===1));}
function timeZoneOf(value:unknown){const zone=value===undefined?'UTC':text(value,'timeZone',1,80);try{new Intl.DateTimeFormat('en',{timeZone:zone});return zone;}catch{fail('invalid_request',400,'Choose an IANA time zone');}}
function localDate(at:number,timeZone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at),get=(type:string)=>parts.find(p=>p.type===type)!.value;return get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day');}
function validDate(value:unknown){const date=text(value,'date',10,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('invalid_request',400,'Use YYYY-MM-DD dates');const stamp=Date.parse(date+'T00:00:00.000Z');if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)fail('invalid_request',400,'Invalid calendar date');return date;}
/** Earliest UTC instant at the requested local day: also handles DST changes at midnight. */
function boundary(date:string,timeZone:string){const noon=Date.parse(date+'T12:00:00.000Z');let lo=noon-48*3600000,hi=noon+48*3600000;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(localDate(mid,timeZone)<date)lo=mid+1;else hi=mid;}return lo;}
function nextDay(date:string){return new Date(Date.parse(date+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);}
function rangeOf(input:JsonObject,timeZone:string){const from=input.fromDate===undefined?null:validDate(input.fromDate),to=input.toDate===undefined?null:validDate(input.toDate);if(from&&to&&from>to)fail('invalid_request',400,'Start date must not follow end date');return {fromDate:from,toDate:to,fromAt:from?boundary(from,timeZone):undefined,toAt:to?boundary(nextDay(to),timeZone):undefined};}
function limitOf(value:unknown){const limit=value??20;if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>50)fail('invalid_request',400,'Choose a limit from 1 to 50');return limit;}

/** Source projections, read authorization and human wording; it never changes a business or read state. */
export function createBehaviorLogService(identity:IdentityAccess<RuntimeReadContext>,sources:Sources,options:{journalEnabled?:boolean}={}){
 const journalEnabled=options.journalEnabled===true;
 const cursors=createGatewayContinuation(1024);
 async function coverage(ctx:RuntimeReadContext,asOf:number){const rows=await ctx.repository(BEHAVIOR_REPOSITORY).getCoverage();if(BEHAVIOR_SCOPES.filter(scope=>scope!=='life'||!!sources.life).some(scope=>!rows.some(row=>row.scope===scope)))fail('behavior_unavailable',503,'Behavior sources have not been enabled');const starts=rows.map(row=>row.fromAt),gaps=['启用前的记录未补录'];if(new Set(starts).size>1)gaps.push('各来源启用时间不同，更早记录不完整');return {from:Math.min(...starts),to:asOf,complete:rows.every(row=>!row.partial)&&new Set(starts).size===1,gaps};}
 async function visible(ctx:RuntimeReadContext,row:BehaviorRecord,audience:'owner'|'public'|'agent',p?:Principal){
  if(USER_LOG_PROCESS_NODES.includes(row.node)||journalEnabled&&JOURNAL_SUPPRESSED_NODES.includes(row.node))return false;
  const authored=row.node==='life.journal.authored'&&row.sourceRef.type==='life_journal',source=sources[row.sourceDomain];if(!source&&!authored)return false;
  if(audience==='agent'&&(p?.kind!=='agent'||row.agentId!==p.agentId))return false;
  if(audience==='public'&&!row.publicProjection)return false;
  const selection=journalPolicy.journalNodes.find(x=>x.node===row.node);if(journalEnabled&&audience==='public'&&selection&&selection.worldTemplate===null)return false;
  if(audience==='owner'){
   if(row.agentId===null||p?.kind!=='owner'||row.ownerAudience?.ownerId!==p.ownerId)return false;
   const current=await identity.captureOwnerObservation?.(ctx,row.agentId,row.sourceDomain);
   if(!current||current.ownerId!==p.ownerId||current.authorizationVersion!==row.ownerAudience.authorizationVersion||current.bindingId!==row.ownerAudience.bindingId||current.bindingVersion!==row.ownerAudience.bindingVersion||current.sharingGeneration!==row.ownerAudience.sharingGeneration)return false;
  }
  if(authored){if(audience==='public')return false;const entry=await ctx.repository(BEHAVIOR_REPOSITORY).getJournal(row.sourceRef.id);if(!entry||entry.agentId!==row.agentId||entry.sourceEventId!==row.sourceEventId)fail('journal_source_unavailable',503,'The actual authored statement source is unavailable');if(audience==='owner'){for(const ref of entry.sourceRefs){const original=await ctx.repository(BEHAVIOR_REPOSITORY).get(ref.recordId);if(!original)fail('journal_source_unavailable',503,'The referenced source is missing');if(original.sourceRef.type==='life_journal'||!await visible(ctx,original,'owner',p))return false;}}return true;}
  const sourceAudience=audience==='agent'?'owner':audience;
  if(!await source!.canObserveBehavior(ctx,row,sourceAudience))return false;
  if(journalEnabled&&(row.node==='life.activity.interrupted'||['relationships.gift.declined','relationships.gift.withdrawn','relationships.gift.expired','relationships.gift.unavailable'].includes(row.node))){const d=await source!.describeBehavior(ctx,row,sourceAudience),j=d?.journal,f=d?.life?.fishing;if(!j?.items.length&&!j?.moneyDelta&&!j?.energySpent&&!j?.energyRestored&&!j?.quotaRefunded&&!f?.completedCasts&&!f?.actualCosts.bait&&!f?.refundedCosts.bait)return false;}
  return true;
 }
 const authored=createBehaviorJournal(identity,async(ctx,p,row)=>p.kind==='agent'&&row.agentId===p.agentId&&row.sourceRef.type!=='life_journal'&&await visible(ctx,row,'agent',p));
 async function item(ctx:RuntimeReadContext,row:BehaviorRecord,timeZone:string,owner?:Principal,profiles=new Map<string,Promise<PublicAgentView|null>>(),worldOnly=false):Promise<JsonObject>{
  const publicProfile=(id:string)=>{let v=profiles.get(id);if(!v){v=identity.readPublicAgent(ctx,id);profiles.set(id,v);}return v;};
  const profile=row.agentId===null?null:await publicProfile(row.agentId),[originalTitle,action,originalResult]=natural[row.node];let title=originalTitle,result=originalResult;const npcIdentity=row.npcId?await sources[row.sourceDomain]?.readNpcIdentity?.(ctx,row.npcId):null;
  if(row.node==='life.journal.authored'&&row.sourceRef.type==='life_journal'){
   if(!owner)return absent();const entry=await ctx.repository(BEHAVIOR_REPOSITORY).getJournal(row.sourceRef.id);if(!entry||entry.agentId!==row.agentId||entry.sourceEventId!==row.sourceEventId)fail('journal_source_unavailable',503,'The authored source is unavailable');const sourceRefs=[];
   for(const ref of entry.sourceRefs){const original=await ctx.repository(BEHAVIOR_REPOSITORY).get(ref.recordId);if(!original)fail('journal_source_unavailable',503,'The referenced source is missing');sourceRefs.push(ref);}
   const statement:AuthoredJournalView={kind:'agent_life_statement',version:1,clientEntryId:entry.clientEntryId,title:entry.title,text:entry.text,sourceRefs,submittedAt:entry.submittedAt};
   return {id:row.id,agent:{agentId:row.agentId,displayName:profile?.displayName??null,...(journalEnabled?{publicId:profile?.publicId??null,publishedVersion:profile?.publishedVersion??null,appearance:profile?.appearance?JSON.parse(JSON.stringify(profile.appearance)):null}:{})},title:entry.title??'生活记录',action:'记录最终自述',result:'这是角色本人提交的陈述',occurredAt:row.occurredAt,date:localDate(row.occurredAt,timeZone),time:new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(row.occurredAt),details:null,source:{domain:'life',node:row.node,detail:null,...(journalEnabled?{label:'角色自述'}:{})},authored:JSON.parse(JSON.stringify(statement))};
  }
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
  const described=await sources[row.sourceDomain]!.describeBehavior(ctx,row,owner?'owner':'public');let details:JsonObject|null=null;
  if(described){
   if(row.sourceRef.type==='resident_gift')title=result=described.resultCode==='resident_card_and_credit_issued'?'镇长补发居民身份卡和100星币':described.resultCode==='resident_card_issued'?'镇长补发居民身份卡':'镇长补发100星币';
   const service=described.service;
   if(described.life){const where=described.location?.to?.name??'小镇';title=result=row.node==='life.care.introduced'?'在'+where+'取得本次园务介绍':row.node==='life.care.completed'?'在'+where+'完成一轮照料':row.node==='life.meal.prepared'?'在'+where+'加工好一份鱼餐':row.node==='life.meal.completed'?'在'+where+'完成用餐':row.node==='life.reading.completed'?'在'+where+'完成一次阅读活动':row.node==='life.visit.completed'?'到访'+where:row.node==='life.work.completed'?'在'+where+'完成一班短工':row.node==='life.rest.completed'?'在'+where+'完成休息':row.node==='life.fishing.finished'?'在'+where+'完成一次钓鱼':row.node==='life.purchase.completed'?'在'+where+'买到生活物品':row.node==='life.sale.completed'?'在'+where+'出售自己的鱼':'生活活动已中止';const f=described.life.fishing;if(f){if(f.completedCasts<f.requestedCasts)title='钓鱼已停止';result='完成'+f.completedCasts+'／'+f.requestedCasts+(f.completedCasts<f.requestedCasts?'竿后停止，钓到':'竿，钓到')+f.catches.length+'条鱼，'+f.noCatchCount+'次空竿；实际消耗'+f.actualCosts.bait+'份鱼饵和'+f.actualCosts.energy+'点体力';}const trade=described.life.trade;if(trade)result=(trade.moneyDelta<0?'购买'+trade.quantity+'件物品，花费'+(-trade.moneyDelta):'出售'+trade.quantity+'条鱼，得到'+trade.moneyDelta)+'星币';}
   if(service){
    if(row.node==='town_services.greeted')title=result='拜访了'+service.npcName;
    if(row.node==='town_services.service.started'){title='在石岸旅舍开始休息';result='已开始休息，休息券已预留，尚未完成';}
    if(row.node==='town_services.service.completed'&&row.sourceRef.type!=='resident_gift'){
     title=result=service.serviceId==='welcome.claim'?(described.resultCode==='facility_service_completed'?'在市政厅领取新人礼包':'从镇长那里领到新人礼包'):service.serviceId==='tavern.host'?'在港湾酒馆使用招待券，喝了一杯迎新茶':service.serviceId==='inn.rest'?'在石岸旅舍使用休息券，完成休息':'已完成'+service.serviceName;
    }
    if(row.node==='town_services.service.cancelled')title=result=service.serviceName+'已取消';
   }
   const participants:JsonObject[]=[];
   for(const participant of described.participants){const visibleProfile=participant.agentId===row.agentId?profile:await publicProfile(participant.agentId);if(visibleProfile)participants.push({agentId:participant.agentId,displayName:visibleProfile.displayName,role:participant.role});}
   if(journalEnabled&&!owner){const mapping=journalPolicy.journalNodes.find(x=>x.node===row.node);if(mapping?.worldTemplate){title=result=mapping.worldTemplate.replaceAll('{actor}',profile?.displayName??npcIdentity?.name??'居民').replaceAll('{place}',described.location?.to?.name??'小镇');}}
   else if(journalEnabled&&described.journal){const j=described.journal,list=(role:string)=>j.items.filter(x=>x.role===role).map(x=>x.name+'×'+x.quantity).join('、'),where=described.location?.to?.name,at=where?'在'+where:'';
    if(row.node==='life.purchase.completed')title=result=at+'买了'+(list('bought')||'生活物品（这次记录未保存品名）')+(j.moneyDelta!==null?'，花费'+(-j.moneyDelta)+'星币':'');
    if(row.node==='life.sale.completed')title=result=at+'卖出'+(list('sold')||'自己的鱼（这次记录未保存品名）')+(j.moneyDelta!==null?'，得到'+j.moneyDelta+'星币':'');
    if(row.node==='life.care.completed')title=result=at+'完成一轮照料'+(j.energySpent?'，消耗'+j.energySpent+'体力':'');
    if(row.node==='life.care.introduced')title=result=at+'在场取得本次园务介绍';
    if(row.node==='life.work.completed')title=result=at+'完成一班短工'+(described.life?.coinReward?'，赚到'+described.life.coinReward+'星币':'')+(j.energySpent?'，消耗'+j.energySpent+'体力':'');
    if(row.node==='life.meal.prepared')title=result=at+'把'+(list('consumed')||'选中的鱼')+'加工成'+(list('created')||'鱼餐')+(j.moneyDelta?'，花费'+(-j.moneyDelta)+'星币':'');
    if(row.node==='life.meal.completed')title=result=at+'吃了'+(list('consumed')||'选中的餐食')+(j.energyRestored?'，实际恢复'+j.energyRestored+'体力':'');
    if(row.node==='life.rest.completed')title=result=at+'完成休息'+(j.moneyDelta?'，花费'+(-j.moneyDelta)+'星币':'')+(j.energyRestored?'，实际恢复'+j.energyRestored+'体力':'');
    if(row.node==='life.reading.completed')title=result=at+'读了'+(described.life?.c?.book?'《'+described.life.c.book.title+'》':'一会儿书');
    if(row.node==='life.fishing.finished'){const f=described.life?.fishing;if(f)title=result=at+'完成'+f.completedCasts+'／'+f.requestedCasts+'竿'+(f.completedCasts<f.requestedCasts?'后停止':'')+'，'+(list('caught')||'没有鱼获')+'，'+f.noCatchCount+'次空竿';}
    if(row.node==='life.activity.interrupted')title=result=at+'活动已停止'+(list('caught')?'，保留'+list('caught'):'')+(list('released')?'，释放'+list('released'):'')+(j.energySpent?'，实际消耗'+j.energySpent+'体力':'');
    if(described.gift){const other=participants.find(x=>x.agentId!==row.agentId),name=typeof other?.displayName==='string'?other.displayName:'对方';if(row.node==='relationships.gift.accepted')title=result=described.gift.direction==='sent'?name+'收下了'+list('sent')+'，物品已交付':'收到了'+name+'送来的'+list('received');else title=result=originalTitle+(list('released')?'，已释放'+list('released'):'');}
   }
   // Public movement does not disclose whether a human initiated the action.
   // Only the separately authorized Owner view retains that actor distinction.
   const initiator=owner?{kind:row.initiator.kind,label:actorLabel(row.initiator.kind)}:row.node==='world.idle.completed'?{kind:'system',label:'日常系统漫游'}:null;
   const executor=row.sourceDomain==='town_services'&&row.executor.kind==='system'?{kind:'system',label:'镇民服务规则执行'}:owner?{kind:row.executor.kind,label:actorLabel(row.executor.kind,true)}:row.sourceDomain==='world'?{kind:'system',label:'世界系统推进'}:null;
   details={version:1,completeness:described.completeness,phase:described.phase,phaseLabel:phaseLabels[described.phase],summary:result,timeRange:{startedAt:described.startedAt,endedAt:described.endedAt,durationMs:described.durationMs},location:described.location?{from:described.location.from?{...described.location.from}:null,to:described.location.to?{...described.location.to}:null,via:described.location.via.map(place=>({...place}))}:null,journey:described.journey?{...described.journey}:null,participants,initiator,executor,service:service?{...service}:null,...(described.life?{life:JSON.parse(JSON.stringify(described.life)) as JsonObject}:{}),...(described.gift?{gift:JSON.parse(JSON.stringify(described.gift)) as JsonObject}:{}),...(journalEnabled&&described.journal&&owner?{journal:JSON.parse(JSON.stringify(described.journal)) as JsonObject}:{}),gaps:[...described.gaps]};
  }
  if(worldOnly&&row.sourceDomain==='town_services'){
   const place=described?.location?.to??(row.publicProjection?.placeName?{kind:'place' as const,name:row.publicProjection.placeName}:null);
   title=result=(place?'在'+place.name:'')+'完成了一次镇民服务';
   // The original source has approved the result. The world face exposes only that result/place,
   // without copying the private service name, chosen topic, voucher, gift or payment particulars.
   details={version:1,completeness:described?.completeness??'partial',phase:'npc_service',phaseLabel:phaseLabels.npc_service,summary:result,timeRange:{startedAt:null,endedAt:null,durationMs:null},location:place?{from:null,to:{...place},via:[]}:null,journey:null,participants:[],initiator:null,executor:null,service:null,gaps:[]};
  }
  const time=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(row.occurredAt);
  return {id:row.id,agent:{agentId:row.agentId,displayName:profile?.displayName??npcIdentity?.name??null,...(journalEnabled?{publicId:profile?.publicId??npcIdentity?.publicId??null,publishedVersion:profile?.publishedVersion??npcIdentity?.publishedVersion??null,appearance:JSON.parse(JSON.stringify(profile?.appearance??npcIdentity?.appearance??null))}:{}),...(row.npcId?{npcId:row.npcId,actorKind:'npc'}:{})},title,action,result,occurredAt:row.occurredAt,date:localDate(row.occurredAt,timeZone),time,details,...(owner?{authored:null}:{}),source:{domain:row.sourceDomain,node:row.node,detail,...(journalEnabled?{label:({world:'世界活动',relationships:'居民交往',interaction:'文字交流',town_services:'镇民服务',life:'生活经历'})[row.sourceDomain]}:{})}};
 }
 function base(agentId:string|null,timeZone:string,items:JsonObject[],historyCoverage:JsonObject,partial:boolean,nextPageToken:string|null,asOf:number){return {worldId:'default',agentId,timeZone,items,historyCoverage,partial,nextPageToken,asOf};}
 async function publicRead(ctx:RuntimeReadContext,input:JsonObject,agentId:string|null){
  object(input,agentId===null?['worldId','timeZone']:['agentId','timeZone']);if(input.worldId!==undefined&&input.worldId!=='default')absent();
  const timeZone=timeZoneOf(input.timeZone);if(agentId!==null&&!await identity.readPublicAgent(ctx,agentId))absent();
  const repo=ctx.repository(BEHAVIOR_REPOSITORY),cut=await repo.cut(),historyCoverage=await coverage(ctx,cut.asOf),items:JsonObject[]=[],counts=new Map<string,number>(),cap=agentId===null?30:10,profiles=new Map<string,Promise<PublicAgentView|null>>();
  let after:{occurredAt:number;id:string}|undefined,scanned=0,complete=false;
  while(scanned<500&&items.length<cap&&!complete){const size=Math.min(50,500-scanned),rows=await repo.list({maxSequence:cut.maxSequence,userLogOnly:true,publicOnly:true,toAt:cut.asOf+1,...(agentId===null?{worldPublicOnly:true}:{agentId}),...(after?{after}:{}),limit:size});if(!rows.length){complete=true;break;}
   for(const row of rows){scanned++;after={occurredAt:row.occurredAt,id:row.id};if(agentId===null&&!eligibleForPublicWorldLog(row))continue;if((counts.get(row.agentId??row.npcId!)??0)>=10)continue;if(!await visible(ctx,row,'public'))continue;counts.set(row.agentId??row.npcId!,(counts.get(row.agentId??row.npcId!)??0)+1);items.push(await item(ctx,row,timeZone,undefined,profiles,agentId===null));if(items.length===cap)break;}
   if(rows.length<size)complete=true;
  }
  return base(agentId,timeZone,items,historyCoverage,!complete&&items.length<cap,null,cut.asOf);
 }
 async function journalHistory(ctx:RuntimeReadContext,p:Principal,input:JsonObject){
  object(input,['timeZone','fromDate','toDate','limit','pageToken']);const agentId=await authored.authorize(ctx,p),repo=ctx.repository(BEHAVIOR_REPOSITORY),timeZone=timeZoneOf(input.timeZone),range=rangeOf(input,timeZone),limit=limitOf(input.limit),participation=await identity.readParticipation(ctx,agentId),proof=await identity.captureOwnerObservation?.(ctx,agentId,'life')??null;
  const scope={instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,principal:agentId,authorizationVersion:hashRuntimeRequest({credentialId:p.credentialId,credentialVersion:p.credentialVersion,runtimeVersion:p.kind==='agent'?p.runtimeVersion:0,authorizationVersion:p.authorizationVersion,participation:{...participation,membership:{...participation.membership}},proof:proof?{...proof}:null,visibilityVersion:await repo.visibilityVersion(agentId)}),query:'behavior.journal.history:1',target:JSON.stringify([agentId,timeZone,range.fromDate,range.toDate]),limit};
  let anchor:Anchor|undefined;if(input.pageToken!==undefined){try{anchor=JSON.parse(cursors.decode(text(input.pageToken,'pageToken',1,2048),scope,ctx.now()))as Anchor;if(!Number.isSafeInteger(anchor.cut.maxSequence)||anchor.cut.maxSequence<0||!Number.isSafeInteger(anchor.cut.asOf)||anchor.cut.asOf>ctx.now()||!Number.isSafeInteger(anchor.after.occurredAt)||typeof anchor.after.id!=='string')throw Error('Invalid statement anchor');}catch{fail('invalid_cursor',409,'Restart the current own statement query');}}
  const cut=anchor?.cut??await repo.cut(),historyCoverage=await coverage(ctx,cut.asOf),items:JsonObject[]=[],profiles=new Map<string,Promise<PublicAgentView|null>>();let after=anchor?.after,scanned=0,complete=false,bytes=0,hasMore=false,budgetHit=false;
  while(scanned<500&&!complete&&!budgetHit&&!hasMore){const size=Math.min(50,500-scanned),rows=await repo.list({agentId,authoredOnly:true,maxSequence:cut.maxSequence,...(range.fromAt===undefined?{}:{fromAt:range.fromAt}),toAt:Math.min(range.toAt??cut.asOf+1,cut.asOf+1),...(after?{after}:{}),limit:size});if(!rows.length){complete=true;break;}
   for(const row of rows){scanned++;if(await visible(ctx,row,'agent',p)){if(items.length===limit){hasMore=true;break;}const projected=await item(ctx,row,timeZone,p,profiles),size=Buffer.byteLength(JSON.stringify(projected));if(bytes+size>60000){budgetHit=true;break;}items.push(projected);bytes+=size;}after={occurredAt:row.occurredAt,id:row.id};}if(!budgetHit&&!hasMore&&rows.length<size)complete=true;
  }return {...base(agentId,timeZone,items,historyCoverage,!complete&&(scanned>=500||budgetHit),!complete&&after?cursors.encode(JSON.stringify({cut,after}),scope,ctx.now()):null,cut.asOf),submissionContext:{expectedAudienceRef:journalAudienceRef(agentId,proof)}};
 }
 return {submitJournal:authored.submitJournal,authorizeJournalReceipt:authored.authorizeJournalReceipt,journalHistory,
  publicWorld:(ctx:RuntimeReadContext,input:JsonObject)=>publicRead(ctx,input,null),
  publicRecent:(ctx:RuntimeReadContext,input:JsonObject)=>publicRead(ctx,input,text(input.agentId,'agentId',1,100)),
  async ownerHistory(ctx:RuntimeReadContext,p:Principal,input:JsonObject){
   object(input,['agentId','timeZone','fromDate','toDate','limit','pageToken']);if(p.kind!=='owner')fail('owner_identity_required',403,'Owner history requires the current Owner session');
   const agentId=text(input.agentId,'agentId',1,100),authority=await identity.authorizeAgent(ctx,p,agentId),participation=await identity.readParticipation(ctx,agentId),proof=await identity.captureOwnerObservation?.(ctx,agentId,'world');
   if(!proof||proof.ownerId!==p.ownerId||!authority.binding)absent();
   const timeZone=timeZoneOf(input.timeZone),range=rangeOf(input,timeZone),limit=limitOf(input.limit),repo=ctx.repository(BEHAVIOR_REPOSITORY),profile=await identity.readPublicAgent(ctx,agentId);
   const scope={instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,principal:p.ownerId,authorizationVersion:hashRuntimeRequest({authority:authority.authorizationVersion,proof:{...proof},participation:{...participation,membership:{...participation.membership}},profile:profile?{publishedVersion:profile.publishedVersion,displayName:profile.displayName}:null,visibilityVersion:await repo.visibilityVersion(agentId)}),query:journalEnabled?'behavior.owner_history:life-journal-v2':'behavior.owner_history:business-events-v1',target:JSON.stringify([agentId,timeZone,range.fromDate,range.toDate]),limit};
   const profiles=new Map<string,Promise<PublicAgentView|null>>();let anchor:Anchor|undefined;if(input.pageToken!==undefined){try{anchor=JSON.parse(cursors.decode(text(input.pageToken,'pageToken',1,2048),scope,ctx.now())) as Anchor;if(!Number.isSafeInteger(anchor.cut.maxSequence)||anchor.cut.maxSequence<0||!Number.isSafeInteger(anchor.cut.asOf)||anchor.cut.asOf>ctx.now()||!Number.isSafeInteger(anchor.after.occurredAt)||typeof anchor.after.id!=='string')throw new Error('Invalid anchor');}catch{fail('invalid_cursor',409,'Restart the current history query');}}
   const cut=anchor?.cut??await repo.cut(),historyCoverage=await coverage(ctx,cut.asOf),items:JsonObject[]=[];let after=anchor?.after,scanned=0,complete=false,byteBudget=0,budgetHit=false,hasMore=false;
   while(scanned<500&&!complete&&!budgetHit&&!hasMore){const size=Math.min(50,500-scanned),rows=await repo.list({agentId,userLogOnly:true,maxSequence:cut.maxSequence,...(range.fromAt===undefined?{}:{fromAt:Math.max(0,range.fromAt)}),toAt:Math.max(0,Math.min(range.toAt??cut.asOf+1,cut.asOf+1)),...(after?{after}:{}),limit:size});if(!rows.length){complete=true;break;}
    for(let i=0;i<rows.length;i++){const row=rows[i]!;scanned++;if(await visible(ctx,row,'owner',p)){if(items.length===limit){hasMore=true;break;}const projected=await item(ctx,row,timeZone,p,profiles),bytes=Buffer.byteLength(JSON.stringify(projected));if(byteBudget+bytes>60000){budgetHit=true;break;}items.push(projected);byteBudget+=bytes;}after={occurredAt:row.occurredAt,id:row.id};}
    if(!budgetHit&&!hasMore&&rows.length<size)complete=true;
   }
   return base(agentId,timeZone,items,historyCoverage,!complete&&(scanned>=500||budgetHit),!complete&&after?cursors.encode(JSON.stringify({cut,after}),scope,ctx.now()):null,cut.asOf);
  },
 };
}
