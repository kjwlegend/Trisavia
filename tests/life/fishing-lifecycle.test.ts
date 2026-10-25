import test from 'node:test';import assert from 'node:assert/strict';
import {freshActor} from '../../apps/platform/domains/life/rules.ts';
import {beginLifeFishingCast,endLifeFishingCast,fishingResult} from '../../apps/platform/domains/life/fishing-lifecycle.ts';
import type {LifeFishingSession} from '../../apps/platform/domains/life/b-types.ts';
import type {LifeCommerceEffect} from '../../apps/platform/domains/life-assets/types.ts';
const now=Date.parse('2026-10-25T10:00:00Z'),ref={kind:'agent' as const,id:'synthetic-fisher'};
const session=():LifeFishingSession=>({id:'session-original-001',version:1,actorKind:'agent',actorId:ref.id,catalogRevision:2,ruleVersion:1,actionId:'fish.session',activityId:'session-original-001',spotId:'shore_spot',rodInstanceId:'owned-rod',requestedCasts:3,nextCastIndex:0,state:'active',startedAt:now,endedAt:null,currentCastId:null,castIds:[],qualification:null,ownerAudience:null,resultId:null,sourceEventId:null});
const actor=()=>({...freshActor(ref,now),reservedEnergy:6,body:{kind:'activity' as const,id:session().id,until:now+180000}});
test('cast costs and quota commit at actual start, and a later cast starts now after downtime',()=>{
 const first=beginLifeFishingCast(session(),actor(),now,()=>0);assert.equal(first.actor.energy,98);assert.equal(first.actor.reservedEnergy,4);assert.equal(first.actor.fishingQuota[0]!.casts,1);assert.equal(first.cast.outcome.itemId,null);
 const ended=endLifeFishingCast(first.cast,first.actor,'complete','completed',now+60000);assert.equal(ended.actor.energy,98);
 const second=beginLifeFishingCast({...first.session,currentCastId:null},ended.actor,now+600000,()=>0);assert.equal(second.cast.startedAt,now+600000);assert.equal(second.cast.scheduledEndAt,now+660000);assert.equal(second.actor.energy,96);
 assert.throws(()=>endLifeFishingCast(second.cast,second.actor,'complete','completed',now+659999),{code:'life_not_due'});
});
test('cancel keeps this cast cost; system interruption refunds it once and never redraws',()=>{
 const b=beginLifeFishingCast(session(),actor(),now,max=>max-1),cancel=endLifeFishingCast(b.cast,b.actor,'cancel','participation_paused',now+5000);assert.equal(cancel.actor.energy,98);assert.equal(cancel.actor.fishingQuota![0]!.casts,1);assert.equal(cancel.cast.state,'cancelled');
 const interrupted=endLifeFishingCast(b.cast,b.actor,'interrupt','rule_retry_exhausted',now+5000);assert.equal(interrupted.actor.energy,100);assert.equal(interrupted.actor.fishingQuota![0]!.casts,0);assert.deepEqual(interrupted.cast.outcome,b.cast.outcome);
 const replay=endLifeFishingCast(interrupted.cast,interrupted.actor,'complete','completed',now+60000);assert.equal(replay.changed,false);assert.deepEqual(replay, {...interrupted,changed:false});
});
test('daily limit or missing reservation rejects before consuming a private draw',()=>{
 let draws=0;for(const a of [{...actor(),fishingQuota:[{day:'2026-10-25',casts:30}]},{...actor(),reservedEnergy:0}])assert.throws(()=>beginLifeFishingCast(session(),a,now,()=>{draws++;return 0;}));assert.equal(draws,0);
});
test('mixed/partial results expose only completed fish backed by unique same-actor effects',()=>{
 const b=beginLifeFishingCast(session(),actor(),now,()=>0),first=endLifeFishingCast(b.cast,b.actor,'complete','completed',now+60000),n=beginLifeFishingCast({...b.session,currentCastId:null},first.actor,now+60000,max=>max-1),second=endLifeFishingCast(n.cast,n.actor,'cancel','agent_cancelled',now+65000);
 const effect=(kind:LifeCommerceEffect['kind'],id:string):LifeCommerceEffect=>({id:kind+id,kind,sourceId:id,actorRef:ref,occurredAt:now,moneyDelta:0,itemIds:[],baitConsumed:kind==='fishing.start'?1:0,baitReturned:0});
 const effects=[effect('fishing.start',first.cast.id),effect('fishing.settle',first.cast.id),effect('fishing.start',second.cast.id),effect('fishing.settle',second.cast.id)];
 const result=fishingResult(session(),[first.cast,second.cast],effects);assert.equal(result.noCatchCount,1);assert.equal(result.completedCasts,1);assert.equal(result.interruptedCasts,1);assert.equal(result.unstartedCasts,1);assert.deepEqual(result.catches,[]);assert.deepEqual(result.actualCosts,{bait:2,energy:4});
 assert.throws(()=>fishingResult(session(),[first.cast,second.cast],effects.slice(1)),{code:'life_fishing_source_unavailable'});
});
