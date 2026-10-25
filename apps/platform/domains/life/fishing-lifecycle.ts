import {fail} from '../common/errors.ts';
import type {LifeActor} from './types.ts';
import type {LifeFishingSession,LifeFishingCast,LifeFishingResult} from './b-types.ts';
import type {LifeCommerceEffect} from '../life-assets/types.ts';
import {LIFE_B_RULES as B} from './b-catalog.ts';
import {sampleLifeFish,fishingCastId} from './b-rules.ts';
import {dayOf} from './rules.ts';

/** Actor/seat/authority locks and asset participation belong to the calling same-context service. */
export function beginLifeFishingCast(session:LifeFishingSession,actor:LifeActor,now:number,draw?:(max:number)=>number){
 if(session.state!=='active'||session.currentCastId!==null||session.nextCastIndex>=session.requestedCasts||session.castIds.length!==session.nextCastIndex||actor.actorId!==session.actorId||actor.actorKind!==session.actorKind)fail('life_cast_state_changed',409,'The original fishing session cannot start another cast');
 const day=dayOf(now),used=actor.fishingQuota?.find(q=>q.day===day)?.casts??0;if(used>=B.castsPerUtcDay)fail('life_fishing_quota_reached',409,'Thirty casts have already started in this UTC day');
 if(actor.energy<2||actor.reservedEnergy<2)fail('life_energy_insufficient',409,'The fishing session energy reservation is unavailable');
 const cast:LifeFishingCast={id:fishingCastId(session.id,session.nextCastIndex),version:1,sessionId:session.id,index:session.nextCastIndex,actorKind:session.actorKind,actorId:session.actorId,catalogRevision:2,ruleVersion:1,spotId:session.spotId,state:'active',startDay:day,startedAt:now,scheduledEndAt:now+B.castDurationMs,endedAt:null,resultId:null,sourceEventId:null,outcome:sampleLifeFish(session.spotId,draw),baitQuantity:1,energyCost:2,stopCode:null};
 return {cast,session:{...session,version:session.version+1,nextCastIndex:session.nextCastIndex+1,currentCastId:cast.id,castIds:[...session.castIds,cast.id]},actor:{...actor,version:actor.version+1,updatedAt:now,energy:actor.energy-2,reservedEnergy:actor.reservedEnergy-2,fishingQuota:[{day,casts:used+1}],body:actor.body?{...actor.body,until:cast.scheduledEndAt}:null}};
}
/** Repeat settlement of a terminal cast cannot refund energy or quota twice. */
export function endLifeFishingCast(cast:LifeFishingCast,actor:LifeActor,mode:'complete'|'cancel'|'interrupt',code:string,now:number){
 if(actor.actorKind!==cast.actorKind||actor.actorId!==cast.actorId)fail('target_not_accessible',404,'The cast belongs to another actor');
 if(cast.state!=='active')return {cast,actor,changed:false};if(now<cast.startedAt||mode==='complete'&&now<cast.scheduledEndAt)fail('life_not_due',409,'This cast has not finished its actual duration');
 const state=mode==='complete'?'completed' as const:mode==='cancel'?'cancelled' as const:'interrupted' as const,next:LifeFishingCast={...cast,version:cast.version+1,state,endedAt:now,resultId:cast.id,sourceEventId:'life-cast-result:'+cast.id,stopCode:mode==='complete'?null:code};
 if(mode!=='interrupt')return {cast:next,actor,changed:true};
 const quotas=structuredClone(actor.fishingQuota??[]),q=quotas.find(q=>q.day===cast.startDay);if(q)q.casts=Math.max(0,q.casts-1);
 return {cast:next,actor:{...actor,version:actor.version+1,updatedAt:now,energy:Math.min(100,actor.energy+2),fishingQuota:quotas},changed:true};
}
/** Only already committed economic effects turn a completed draw into an owned fish reference. */
export function fishingResult(session:LifeFishingSession,casts:LifeFishingCast[],effects:LifeCommerceEffect[]):LifeFishingResult&{unstartedCasts:number}{
 const terminal=casts.filter(c=>c.state!=='active'),completed=terminal.filter(c=>c.state==='completed');
 const selected=(kind:LifeCommerceEffect['kind'],id:string)=>{const matches=effects.filter(e=>e.kind===kind&&e.sourceId===id&&e.actorRef.kind===session.actorKind&&e.actorRef.id===session.actorId);if(matches.length!==1)fail('life_fishing_source_unavailable',503,'The unique fishing settlement is not available');return matches[0]!;};
 let bait=0,returned=0;for(const cast of casts){if(cast.sessionId!==session.id||cast.actorId!==session.actorId||cast.actorKind!==session.actorKind)fail('life_fishing_source_unavailable',503,'The fishing source scope differs');bait+=selected('fishing.start',cast.id).baitConsumed;if(cast.state!=='active')returned+=selected('fishing.settle',cast.id).baitReturned;}
 const catches=completed.flatMap(c=>{const e=selected('fishing.settle',c.id);if(c.outcome.itemId===null){if(e.itemIds.length)fail('life_fishing_source_unavailable',503,'An empty cast cannot create a fish');return [];}if(e.itemIds.length!==1||c.outcome.weightGrams===null||c.endedAt===null)fail('life_fishing_source_unavailable',503,'The actual fish instance is missing');return [{castId:c.id,itemInstanceId:e.itemIds[0]!,itemId:c.outcome.itemId,weightGrams:c.outcome.weightGrams,caughtAt:c.endedAt}];});
 const refundedEnergy=terminal.filter(c=>c.state==='interrupted').length*2;
 return {requestedCasts:session.requestedCasts,completedCasts:completed.length,interruptedCasts:terminal.length-completed.length,unstartedCasts:session.requestedCasts-casts.length,noCatchCount:completed.filter(c=>c.outcome.itemId===null).length,catches,actualCosts:{bait:bait-returned,energy:casts.length*2-refundedEnergy},refundedCosts:{bait:returned,energy:refundedEnergy}};
}
