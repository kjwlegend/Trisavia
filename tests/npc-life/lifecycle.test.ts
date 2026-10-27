import test from 'node:test';import assert from 'node:assert/strict';
import {npcLifeFixture} from './fixture.ts';
import {WORLD_REPOSITORY} from '../../apps/platform/domains/world/repository.ts';

test('same-plan real introduction, committed navigation and full120s care produce one result and six energy, with point/public versus personal cooldown',async()=>{
 const f=await npcLifeFixture(),p=await f.add('care-a'),body=await f.input(),r=await f.invoke(p,'life.plans.submit',body,'care-original'),planId=(r.result.plan as any).planId;
 assert.equal(r.outcome,'committed',JSON.stringify(r));assert.deepEqual(await f.invoke(p,'life.plans.submit',body,'care-original'),r);
 await f.until(async()=>!!(await f.repo.getPlan(planId))!.currentActivityId&&[...f.state.activities.values()].some(v=>v.actionId==='care.perform'&&v.state==='active'));
 const active=[...f.state.activities.values()].find(v=>v.actionId==='care.perform')!,intro=[...f.extra.introductions.values()][0]!;assert.equal(intro.planId,planId);assert.equal(intro.consumedByActivityId,active.id);assert.equal((await f.repo.getActor({kind:'npc',id:'npc-gardener'}))!.body,null);assert.equal((await f.repo.getActor({kind:'agent',id:'care-a'}))!.reservedEnergy,6);
 assert.deepEqual((await f.f.world.getAvatar('default','care-a'))!.position,f.d.carePoints[0]!.cell);
 await f.run(120000);assert.equal((await f.repo.getActivity(active.id))!.state,'completed');assert.equal((await f.repo.getActor({kind:'agent',id:'care-a'}))!.energy,94);assert.equal(f.extra.facts.size,1);assert.equal((await f.npcRepo.getPoint(active.care!.pointId))!.activeActivityId,null);
 const before=(await f.repo.getActivity(active.id))!.result;await f.run(500);assert.deepEqual((await f.repo.getActivity(active.id))!.result,before);assert.equal(f.extra.facts.size,1);
 let directory=await f.service.query(f.context,null,'npc_life.directory',{});const point=(directory.carePoints as any[])[0];assert.equal(point.lastCareAt,f.now-500);assert.equal(point.actorId,'care-a');assert.equal(point.nextEligibleAt,point.lastCareAt+3600000);
 f.now=point.nextEligibleAt;directory=await f.service.query(f.context,null,'npc_life.directory',{});assert.equal((directory.carePoints as any[])[0].available,true);assert.equal(((await f.service.query(f.context,p,'npc_life.care.options',{})).points as any[])[0].reason,'care_personal_cooldown');
 f.f.membership('care-a',{sharingGeneration:2});directory=await f.service.query(f.context,null,'npc_life.directory',{});assert.equal(Object.hasOwn((directory.carePoints as any[])[0],'actorId'),false);
});

test('cancellation consumes ceil proportion and releases the point without inventing completion; consumed intro cannot be reused',async()=>{
 const f=await npcLifeFixture(),p=await f.add('cancel-a'),r=await f.invoke(p,'life.plans.submit',await f.input()),id=(r.result.plan as any).planId;await f.until(async()=>[...f.state.activities.values()].some(v=>v.actionId==='care.perform'&&v.state==='active'));
 const a=[...f.state.activities.values()].find(v=>v.actionId==='care.perform')!;f.now=a.startedAt+60000;const request={activityId:a.id,expectedVersion:a.version},cancel=await f.invoke(p,'life.activities.cancel',request,'cancel-original');assert.equal(cancel.outcome,'committed');assert.deepEqual(await f.invoke(p,'life.activities.cancel',request,'cancel-original'),cancel);assert.equal((await f.repo.getActor({kind:'agent',id:'cancel-a'}))!.energy,97);assert.equal(f.extra.facts.size,0);const point=(await f.npcRepo.getPoint(a.care!.pointId))!;assert.equal(point.activeActivityId,null);assert.equal(point.lastCareAt,null);assert.equal((await f.repo.getPlan(id))!.state,'cancelled');assert.equal([...f.extra.introductions.values()][0]!.consumedByActivityId,a.id);
});

test('point competition fails atomically and current revocation cancels only the real active source; gardener has finite autonomous reception windows',async()=>{
 const f=await npcLifeFixture(),a=await f.add('a'),b=await f.add('b'),ra=await f.invoke(a,'life.plans.submit',await f.input());await f.until(async()=>[...f.state.activities.values()].some(v=>v.actionId==='care.perform'&&v.state==='active'));const active=[...f.state.activities.values()].find(v=>v.actionId==='care.perform')!;
 const rejected=await f.invoke(b,'life.plans.submit',await f.input());assert.equal(rejected.outcome,'committed');await f.run(500);await f.run(500);assert.equal([...f.state.activities.values()].filter(v=>v.actorId==='b'&&v.actionId==='care.perform').length,0);assert.equal((await f.repo.getActor({kind:'agent',id:'b'}))!.reservedEnergy,0);
 f.f.membership('a',{ownerPaused:true,ownerPauseVersion:1});f.now=active.startedAt+60000;await f.run(0);assert.equal((await f.repo.getActivity(active.id))!.state,'cancelled');assert.equal((await f.repo.getActor({kind:'agent',id:'a'}))!.reservedEnergy,0);assert.equal((await f.npcRepo.getPoint(active.care!.pointId))!.activeActivityId,null);
 // The independent gardener controller commits only actual adjacent movement; it owns no Agent runtime or free wallet.
 await f.store.transaction(async ctx=>{const n=(await f.repo.getNpc('npc-gardener'))!;await f.repo.saveNpc({...n,version:n.version+1,nextDecisionAt:ctx.now(),currentGoal:null},n.version);await f.service.lifeExtension.advanceNpc(ctx,'npc-gardener');});const npc=(await f.repo.getNpc('npc-gardener'))!;assert(npc.motion);assert.equal(npc.motion.arriveAt-npc.motion.startedAt,500);assert.equal((await f.repo.getActor({kind:'npc',id:'npc-gardener'}))!.body,null);
 assert.equal((await f.repo.getPlan((ra.result.plan as any).planId))!.state,'partially_completed');
});
