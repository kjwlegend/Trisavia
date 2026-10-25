import type {RuntimeReadContext,RuntimeTransaction} from '../contracts/runtime-store.ts';
import type {LifeActivity,LifeActor,LifeActorRef,LifeResult} from '../domains/life/types.ts';
import type {LifeFishingSession,LifeFishingCast} from '../domains/life/b-types.ts';
import {LIFE_REPOSITORY} from '../domains/life/repository.ts';
import {LIFE_FISHING_REPOSITORY} from '../domains/life/fishing-repository.ts';
import {LIFE_COMMERCE_REPOSITORY} from '../domains/life-assets/repository.ts';
import type {LifeCommerceEffect} from '../domains/life-assets/types.ts';
import {beginLifeFishingCast,endLifeFishingCast,fishingResult} from '../domains/life/fishing-lifecycle.ts';
import {LIFE_B_RULES as B} from '../domains/life/b-catalog.ts';
import {fail,M1Error,object} from '../domains/common/errors.ts';
import {identifier} from '../domains/interaction/rules.ts';
import type {JsonObject} from '../contracts/store.ts';

export interface LifeFishingHost {
 actor(ctx:RuntimeTransaction,ref:LifeActorRef):Promise<LifeActor>;
 saveActor(ctx:RuntimeTransaction,actor:LifeActor,change:Partial<LifeActor>):Promise<LifeActor>;
 recordResult(ctx:RuntimeTransaction,activity:LifeActivity):Promise<void>;
}
export function parseFishingParams(raw:unknown){const p=object(raw,['spotId','castCount','rodInstanceId']);if(!B.spots.some(s=>s.id===p.spotId)||typeof p.castCount!=='number'||!Number.isInteger(p.castCount)||p.castCount<1||p.castCount>B.castsPerSession)fail('invalid_request',400,'Choose one to five casts at a published harbor spot');return {spotId:p.spotId as LifeFishingSession['spotId'],castCount:p.castCount,rodInstanceId:identifier(p.rodInstanceId,'rodInstanceId')};}
/** Orchestrates source facts and asset participation only inside the caller's original transaction. */
export function createLifeFishingService(host:LifeFishingHost,draw?: (max:number)=>number){
 async function beginCast(ctx:RuntimeTransaction,session:LifeFishingSession){
  const ref={kind:session.actorKind,id:session.actorId},actor=await host.actor(ctx,ref),next=beginLifeFishingCast(session,actor,ctx.now(),draw),repo=ctx.repository(LIFE_FISHING_REPOSITORY);
  await repo.saveCast(next.cast,null);await repo.saveSession(next.session,session.version);await ctx.repository(LIFE_REPOSITORY).saveActor(next.actor,actor.version);
  await ctx.repository(LIFE_COMMERCE_REPOSITORY).startFishingCast({actorRef:ref,castId:next.cast.id});return next.cast;
 }
 async function endCast(ctx:RuntimeTransaction,cast:LifeFishingCast,mode:'complete'|'cancel'|'interrupt',code:string){
  const ref={kind:cast.actorKind,id:cast.actorId},actor=await host.actor(ctx,ref),next=endLifeFishingCast(cast,actor,mode,code,ctx.now());if(!next.changed)return next.cast;
  await ctx.repository(LIFE_FISHING_REPOSITORY).saveCast(next.cast,cast.version);if(next.actor.version!==actor.version)await ctx.repository(LIFE_REPOSITORY).saveActor(next.actor,actor.version);
  await ctx.repository(LIFE_COMMERCE_REPOSITORY).settleFishingCast({actorRef:ref,castId:cast.id});
  await ctx.events.append({eventId:next.cast.sourceEventId!,domain:'life',kind:'life.fishing.cast.'+next.cast.state,schemaVersion:1,subject:{type:'life.fishing_cast',id:cast.id,version:next.cast.version},worldId:'default',actor:{kind:'system',id:'life-rules'},source:cast.actorKind==='npc'?'rules':'external_agent',occurredAt:ctx.now(),causationId:cast.id,correlationId:cast.sessionId,audience:{kind:cast.actorKind==='agent'?'agents':'private',agentIds:cast.actorKind==='agent'?[cast.actorId]:[]},payload:JSON.parse(JSON.stringify({sessionId:cast.sessionId,castId:cast.id,state:next.cast.state,outcome:next.cast.state==='completed'?cast.outcome:null})) as JsonObject});
  await ctx.outbox.enqueue({outboxId:next.cast.sourceEventId!+':projection',eventId:next.cast.sourceEventId!,consumerId:'life-projection',dedupeKey:next.cast.sourceEventId!,generation:await ctx.tasks.currentGeneration('life'),dueAt:ctx.now(),maxAttempts:4});return next.cast;
 }
 async function summary(ctx:RuntimeReadContext,session:LifeFishingSession){
  const casts=await ctx.repository(LIFE_FISHING_REPOSITORY).listCasts(session.id),effects:LifeCommerceEffect[]=[];for(const cast of casts){const start=await ctx.repository(LIFE_COMMERCE_REPOSITORY).getEffect('fishing.start',cast.id);if(start)effects.push(start);if(cast.state!=='active'){const end=await ctx.repository(LIFE_COMMERCE_REPOSITORY).getEffect('fishing.settle',cast.id);if(end)effects.push(end);}}return fishingResult(session,casts,effects);
 }
 async function finish(ctx:RuntimeTransaction,v:LifeActivity,mode:'complete'|'cancel'|'interrupt',code:string){
  const repo=ctx.repository(LIFE_FISHING_REPOSITORY),ref={kind:v.actorKind,id:v.actorId},session=await repo.getSession(v.id);if(!session)fail('life_fishing_source_unavailable',503,'The original fishing session is unavailable');if(session.state!=='active')return (await ctx.repository(LIFE_REPOSITORY).getActivity(v.id))!;
  if(session.currentCastId){const cast=await repo.getCast(session.currentCastId);if(!cast)fail('life_fishing_source_unavailable',503,'The original cast is unavailable');if(cast.state==='active')await endCast(ctx,cast,mode==='complete'?'complete':mode,code);}
  const state=mode==='complete'?'completed' as const:mode==='cancel'?'cancelled' as const:'interrupted' as const,now=ctx.now(),sourceEventId='life-result:'+v.id,nextSession={...session,version:session.version+1,state,currentCastId:null,endedAt:now,resultId:v.id,sourceEventId};
  if(mode==='complete'&&(await repo.listCasts(v.id)).filter(c=>c.state==='completed').length!==session.requestedCasts)fail('life_fishing_not_finished',409,'The requested casts have not all completed');
  await repo.saveSession(nextSession,session.version);await ctx.repository(LIFE_COMMERCE_REPOSITORY).releaseFishing({actorRef:ref,sessionId:v.id});
  const resultData=await summary(ctx,nextSession),a=await host.actor(ctx,ref),release=(session.requestedCasts-session.nextCastIndex)*2;if(a.reservedEnergy<release)fail('life_fishing_source_unavailable',503,'The original fishing energy reservation differs');
  const result:LifeResult={resultId:v.id,state,code,completedAt:now,energyBefore:session.energyBefore,energyAfter:a.energy,energySpent:resultData.actualCosts.energy,energyRestored:0,coinReward:0,quotaRefunded:resultData.refundedCosts.energy>0,sourceEventId,fishing:resultData},next={...v,version:v.version+1,state,endedAt:now,resultId:v.id,sourceEventId,result};
  await ctx.repository(LIFE_REPOSITORY).saveActivity(next,v.version);await host.saveActor(ctx,a,{reservedEnergy:a.reservedEnergy-release,body:v.planId?{kind:'plan',id:v.planId,until:now+5000}:null});await host.recordResult(ctx,next);return next;
 }
 async function start(ctx:RuntimeTransaction,v:LifeActivity,raw:unknown){
  const params=parseFishingParams(raw),a=await host.actor(ctx,{kind:v.actorKind,id:v.actorId});if(B.spots.find(s=>s.id===params.spotId)!.placeId!==v.placeId)fail('life_spot_not_supported',400,'The chosen fishing spot belongs to another place');
  const session:LifeFishingSession={id:v.id,activityId:v.id,version:1,actorKind:v.actorKind,actorId:v.actorId,actionId:'fish.session',catalogRevision:2,ruleVersion:1,spotId:params.spotId,rodInstanceId:params.rodInstanceId,requestedCasts:params.castCount,nextCastIndex:0,state:'active',startedAt:v.startedAt,endedAt:null,currentCastId:null,castIds:[],qualification:v.qualification,ownerAudience:v.ownerAudience,resultId:null,sourceEventId:null,energyBefore:a.energy};
  await ctx.repository(LIFE_FISHING_REPOSITORY).saveSession(session,null);await ctx.repository(LIFE_COMMERCE_REPOSITORY).reserveFishing({actorRef:{kind:v.actorKind,id:v.actorId},sessionId:v.id});await beginCast(ctx,session);return v;
 }
 async function tick(ctx:RuntimeTransaction,v:LifeActivity){
  const repo=ctx.repository(LIFE_FISHING_REPOSITORY);let session=await repo.getSession(v.id);if(!session||session.state!=='active')fail('life_fishing_source_unavailable',503,'The active fishing session is unavailable');
  if(session.currentCastId){const cast=await repo.getCast(session.currentCastId);if(!cast)fail('life_fishing_source_unavailable',503,'The active cast is unavailable');if(cast.state==='active'&&ctx.now()<cast.scheduledEndAt)return v;if(cast.state==='active')await endCast(ctx,cast,'complete','completed');const next={...session,version:session.version+1,currentCastId:null};await repo.saveSession(next,session.version);session=next;}
  if(session.nextCastIndex===session.requestedCasts)return finish(ctx,v,'complete','completed');
  if(v.planId){const plan=await ctx.repository(LIFE_REPOSITORY).getPlan(v.planId);if(!plan||ctx.now()+B.castDurationMs>plan.deadlineAt)return finish(ctx,v,'cancel','plan_deadline');}
  try{await ctx.attempt(current=>beginCast(current,session!));}catch(e){if(!(e instanceof M1Error)||e.statusCode>=500)throw e;return finish(ctx,v,'cancel',e.code);}return v;
 }
 return {start,tick,finish,summary};
}
