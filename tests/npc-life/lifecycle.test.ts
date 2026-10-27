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
 const f=await npcLifeFixture(),a=await f.add('a'),b=await f.add('b'),ra=await f.invoke(a,'life.plans.submit',await f.input());await f.until(async()=>f.extra.introductions.size===1);
 const rejected=await f.invoke(b,'life.plans.submit',await f.input());await f.until(async()=>[...f.state.activities.values()].some(v=>v.actorId==='a'&&v.actionId==='care.perform'&&v.state==='active'));const active=[...f.state.activities.values()].find(v=>v.actionId==='care.perform')!;assert.equal(rejected.outcome,'committed');await f.until(async()=>!['running','queued'].includes((await f.repo.getPlan((rejected.result.plan as any).planId))!.state));assert.equal(f.extra.introductions.size,2);assert.equal([...f.extra.introductions.values()].filter(v=>v.consumedByActivityId).length,1);assert.equal([...f.state.activities.values()].filter(v=>v.actorId==='b'&&v.actionId==='care.perform').length,0);assert.equal((await f.repo.getActor({kind:'agent',id:'b'}))!.reservedEnergy,0);
 f.f.membership('a',{ownerPaused:true,ownerPauseVersion:1});f.now=active.startedAt+60000;await f.run(0);assert.equal((await f.repo.getActivity(active.id))!.state,'cancelled');assert.equal((await f.repo.getActor({kind:'agent',id:'a'}))!.reservedEnergy,0);assert.equal((await f.npcRepo.getPoint(active.care!.pointId))!.activeActivityId,null);
 // The independent gardener controller commits only actual adjacent movement; it owns no Agent runtime or free wallet.
 await f.store.transaction(async ctx=>{const n=(await f.repo.getNpc('npc-gardener'))!;await f.repo.saveNpc({...n,version:n.version+1,nextDecisionAt:ctx.now(),currentGoal:null},n.version);await f.service.lifeExtension.advanceNpc(ctx,'npc-gardener');});const npc=(await f.repo.getNpc('npc-gardener'))!;assert(npc.motion);assert.equal(npc.motion.arriveAt-npc.motion.startedAt,500);assert.equal((await f.repo.getActor({kind:'npc',id:'npc-gardener'}))!.body,null);
 assert.equal((await f.repo.getPlan((ra.result.plan as any).planId))!.state,'partially_completed');
});

test('care options suppress a stale introduction during a real two-plan point-version race without consuming it or weakening start',async()=>{
 const f=await npcLifeFixture(),a=await f.add('options-a'),b=await f.add('options-b');
 const first=await f.invoke(a,'life.plans.submit',await f.input());assert.equal(first.outcome,'committed');
 await f.until(async()=>f.extra.introductions.size===1);
 const second=await f.invoke(b,'life.plans.submit',await f.input());assert.equal(second.outcome,'committed');
 const planId=(second.result.plan as any).planId;
 await f.until(async()=>f.extra.introductions.size===2);
 const original=[...f.extra.introductions.values()].find(ref=>ref.agentId==='options-b')!;
 const {readNpcCareOptions}=await import(new URL('../../apps/web/public/hud/npc-life-reader.js',import.meta.url).href);
 const query=()=>f.service.query(f.context,b,'npc_life.care.options',{});
 const decode=(data:unknown)=>readNpcCareOptions({protocolVersion:1,instanceId:f.context.instanceId,data},'options-b');
 const before=decode(await query());assert.equal(before.data.points.find((point:any)=>point.pointId===original.pointId).introduction.introductionId,original.introductionId);
 await f.until(async()=>[...f.state.activities.values()].some(v=>v.actorId==='options-a'&&v.actionId==='care.perform'&&v.state==='active'));
 const point=(await f.npcRepo.getPoint(original.pointId))!,plan=(await f.repo.getPlan(planId))!;
 assert.equal(plan.state,'running');assert.equal(plan.currentActivityId,null);assert(point.version>original.pointVersion);
 const current=decode(await query()).data.points.find((p:any)=>p.pointId===point.pointId);
 assert.equal(current.version,point.version);assert.equal(current.available,false);assert.equal(current.reason,'care_point_busy');assert.equal(current.introduction,null);
 assert.deepEqual(await f.npcRepo.getIntroduction(original.introductionId),original);
 // Even substituting the new point version cannot turn the old same-plan reference into current start authority.
 await assert.rejects(f.store.transaction(ctx=>f.service.lifeExtension.careTerms(ctx,{kind:'agent',id:'options-b'},{placeId:f.d.carePoints[0]!.placeId,planId,params:{pointId:point.pointId,expectedPointVersion:point.version,introductionId:original.introductionId,expectedIntroductionVersion:original.version}},plan.qualification)),{code:'care_introduction_unavailable'});
 await f.until(async()=>!['running','queued'].includes((await f.repo.getPlan(planId))!.state));
 assert.equal((await f.repo.getPlan(planId))!.stopCode,'version_conflict');assert.equal((await f.repo.getActor({kind:'agent',id:'options-b'}))!.reservedEnergy,0);
 assert.equal([...f.state.activities.values()].filter(v=>v.actorId==='options-b'&&v.actionId==='care.perform').length,0);
 assert.deepEqual(await f.npcRepo.getIntroduction(original.introductionId),original);
});
