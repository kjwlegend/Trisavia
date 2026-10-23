import assert from 'node:assert/strict';
import test from 'node:test';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {bootstrapInteraction,createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {createDeterministicScheduler} from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import {BEHAVIOR_SCOPES,type BehaviorObservationAccess} from '../../apps/platform/domains/behavior/types.ts';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

async function setup(){const f=coreFixture(),a=f.addAgent('logs-a'),b=f.addAgent('logs-b');
 const observation:BehaviorObservationAccess<RuntimeReadContext>={async capture(_ctx,id,sourceDomain){return {ownerId:'owner-'+id,bindingId:'binding-'+id,bindingVersion:1,authorizationVersion:'proof-'+id,sharingGeneration:1,sourceDomain};}};
 const world=createWorldService(f.identity,{observation}),interaction=createInteractionService(f.identity,f.decisions,{observation}),relationships=createRelationshipsService(f.identity,{observation});
 await f.store.transaction(async ctx=>{await bootstrapWorld(ctx);await bootstrapInteraction(ctx);});
 const move=(action:string,input:JsonObject,id?:string)=>f.store.transaction(ctx=>world.execute(ctx,a,f.key(a,action,id),input));
 const social=(who:typeof a,action:string,input:JsonObject)=>f.store.transaction(ctx=>interaction.execute(ctx,who,f.key(who,action),input));
 const records=()=>[...f.state.behaviorRecords.values()];
 const enable=()=>f.store.transaction(async()=>{for(const scope of BEHAVIOR_SCOPES)await f.behavior.activateCoverage(scope,f.now);});
 const scheduler=createDeterministicScheduler({store:f.store,workerId:'behavior-test',batchLimit:10,handlers:[{kind:'world.movement.step',version:1,run:world.handleTask},{kind:'world.idle.step',version:1,run:world.handleIdleTask}]});
 return {f,a,b,world,interaction,relationships,move,social,records,enable,scheduler};}

test('explicit nodes start at activation, first running once, final arrival once, and one-cell plans do not invent departures',async()=>{
 const x=await setup(),{f,a,world,move,records,enable,scheduler}=x;
 await move('world.avatar.create',{worldId:'default',expectedRulesetVersion:1});assert.equal(records().length,0);await enable();
 const avatar=(await f.world.getAvatar('default','logs-a'))!,dx=avatar.position.x<13?1:-1;
 const pending=await move('world.avatar.move',{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[1,2,3].map(i=>({x:avatar.position.x+i*dx,y:avatar.position.y}))},'stable-log-move');
 for(let i=0;i<3;i++){f.now+=1000;await scheduler.runDue();}
 assert.deepEqual(records().map(r=>r.node),['world.movement.received','world.movement.started','world.movement.completed']);
 assert(records().every(r=>r.initiator.kind==='agent'&&r.origin==='external_agent'));assert.equal(records()[1]!.executor.kind,'system');assert.equal(records()[0]!.publicProjection,null);assert(records().slice(1).every(r=>r.publicProjection!==null));
 const source=f.state.events.find(e=>e.eventId===records()[1]!.sourceEventId)!;assert.equal(source.audience.kind,'agents');assert(records().every(r=>r.ownerAudience?.ownerId==='owner-logs-a'));
 await f.store.transaction(ctx=>world.execute(ctx,a,pending.key,{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[1,2,3].map(i=>({x:avatar.position.x+i*dx,y:avatar.position.y}))}));assert.equal(records().length,3);
 const current=(await f.world.getAvatar('default','logs-a'))!,target={x:current.position.x-dx,y:current.position.y};await move('world.avatar.move',{worldId:'default',expectedVersion:current.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[target]});f.now+=1000;await scheduler.runDue();assert.equal(records().filter(r=>r.node==='world.movement.started').length,1);assert.equal(records().filter(r=>r.node==='world.movement.completed').length,2);
 const stoppedAt=(await f.world.getAvatar('default','logs-a'))!;const toStop=await move('world.avatar.move',{worldId:'default',expectedVersion:stoppedAt.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:stoppedAt.position.x+dx,y:stoppedAt.position.y},{...stoppedAt.position}]});await move('world.movement.stop',{worldId:'default',movementId:toStop.result.movementId!,expectedVersion:1});assert.equal(records().at(-1)!.node,'world.movement.stopped');assert.equal(records().at(-1)!.publicProjection,null);
 f.membership('logs-a',{ownerPaused:true});f.state.publicAgents.delete('logs-a');const log=records()[1]!;assert.equal(await f.store.read(ctx=>world.canObserveBehavior(ctx,log,'owner')),true);assert.equal(await f.store.read(ctx=>world.canObserveBehavior(ctx,log,'public')),false);
 const before={records:records().length,movements:f.state.movements.size,events:f.state.events.length};f.membership('logs-a',{ownerPaused:false});f.failAt='behavior';await assert.rejects(()=>move('world.avatar.move',{worldId:'default',expectedVersion:(f.state.avatars.values().next().value!).version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:target.x+dx,y:target.y}]}));assert.deepEqual({records:records().length,movements:f.state.movements.size,events:f.state.events.length},before);
});

test('social facts are per perspective, text outcomes are distinct, and neither bodies nor counterparty profiles are copied',async()=>{
 const x=await setup(),{f,a,b,relationships,interaction,social,records,enable}=x;await enable();
 const friendship=async(who:typeof a,action:string,input:JsonObject)=>f.store.transaction(ctx=>relationships.execute(ctx,who,{...f.key(who,action),domain:'relationships'},input));
 const sent=await friendship(a,'relationships.invitation.send',{toAgentId:'logs-b',message:'PRIVATE FRIEND NOTE'});const request=(sent.result.request as JsonObject).requestId!;
 await friendship(b,'relationships.invitation.accept',{requestId:request,expectedVersion:1});assert.equal(records().filter(r=>r.node==='relationships.invitation.accepted').length,2);assert.equal(f.state.friendships.size,1);
 const work=await social(a,'interaction.artifact.create',{title:'PRIVATE TITLE',body:'PRIVATE WORK BODY'});const invitation=await social(a,'interaction.invitation.send',{worldId:'default',toAgentId:'logs-b',artifact:work.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'PRIVATE INTENT'});
 const accepted=await social(b,'interaction.invitation.accept',{invitationId:invitation.result.invitationId!,expectedVersion:1}),activity=accepted.result.activity as JsonObject;
 await social(b,'interaction.activity.submit_feedback',{activityId:activity.activityId!,expectedVersion:1,body:'PRIVATE FEEDBACK BODY'});assert.equal(records().filter(r=>r.node==='interaction.feedback.submitted').length,2);assert.equal(records().filter(r=>r.node==='interaction.activity.closed').length,0);
 await social(a,'interaction.activity.close',{activityId:activity.activityId!,expectedVersion:2});assert.equal(records().filter(r=>r.node==='interaction.activity.closed').length,2);assert(records().every(r=>r.publicProjection===null));assert(!JSON.stringify(records()).includes('PRIVATE'));
 const own=records().find(r=>r.agentId==='logs-a'&&r.node==='relationships.invitation.accepted')!;f.state.publicAgents.delete('logs-a');f.membership('logs-a',{ownerPaused:true});assert.equal(await f.store.read(ctx=>relationships.canObserveBehavior(ctx,own,'owner')),true);f.membership('logs-a',{ownerPaused:false});
 const closed=records().find(r=>r.agentId==='logs-a'&&r.node==='interaction.activity.closed')!;assert.deepEqual(await f.store.read(ctx=>interaction.behaviorDetailRef(ctx,closed)),{invitationId:invitation.result.invitationId});
 const before=await f.behavior.visibilityVersion('logs-a');await social(b,'interaction.policy.block',{agentId:'logs-a',expectedVersion:1});assert.equal(await f.behavior.visibilityVersion('logs-a'),before+1);assert.equal(await f.store.read(ctx=>relationships.canObserveBehavior(ctx,own,'owner')),false);assert.equal(await f.store.read(ctx=>interaction.canObserveBehavior(ctx,closed,'owner')),false);
});

test('idle emits only actual completed segments, persists five-minute cadence, and never backfills or logs every cell',async()=>{
 const x=await setup(),{f,move,records,enable,world,scheduler}=x;await move('world.avatar.create',{worldId:'default',expectedRulesetVersion:1});await enable();
 const tick=async()=>{const task=[...f.state.tasks.values()].find(t=>t.kind==='world.idle.step')!;f.now=Math.max(f.now,task.dueAt);await scheduler.runDue();};
 for(let i=0;i<10&&records().length===0;i++)await tick();assert.equal(records().length,1);const first=records()[0]!;assert.equal(first.node,'world.idle.completed');assert.equal(first.origin,'rules');assert.equal(first.initiator.kind,'system');assert.equal(first.sourceRef.version,(await f.world.getAvatar('default','logs-a'))!.version);
 for(let i=0;i<5;i++)await tick();assert.equal(records().length,1);assert.equal(await f.behavior.shouldRecordIdle('logs-a',first.occurredAt+299999),false);
 // Recreating the service/scheduler does not reset persisted eligibility; no timer manufactures a missed row.
 const resumed=createWorldService(f.identity),afterRestart=createDeterministicScheduler({store:f.store,workerId:'restarted-log',batchLimit:10,handlers:[{kind:'world.idle.step',version:1,run:resumed.handleIdleTask}]});f.now=first.occurredAt+300001;await afterRestart.runDue();for(let i=0;i<5&&records().length===1;i++)await tick();assert.equal(records().length,2);assert(records()[1]!.occurredAt-first.occurredAt>=300000);
 const before=records().length;f.membership('logs-a',{ownerPaused:true});f.now+=600000;await tick();assert.equal(records().length,before);const coverage=await f.behavior.getCoverage();assert.equal(coverage.find(c=>c.scope==='world_idle')!.partial,true);
});
