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

test('ordinary movement keeps authoritative states, runtime facts and receipts without user behavior process records',async()=>{
 const {f,a,move,records,enable,scheduler}=await setup();await move('world.avatar.create',{worldId:'default',expectedRulesetVersion:1});await enable();
 const avatar=(await f.world.getAvatar('default','logs-a'))!,dx=avatar.position.x<13?1:-1,path=[1,2,3].map(i=>({x:avatar.position.x+i*dx,y:avatar.position.y}));
 f.failAt='behavior';const pending=await move('world.avatar.move',{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path},'stable-log-move');
 assert.equal(pending.outcome,'committed');for(let i=0;i<3;i++){f.now+=1000;await scheduler.runDue();}
 assert.equal(records().length,0);assert.equal((await f.world.getMovement(String(pending.result.movementId)))?.state,'completed');assert.deepEqual((await f.world.getAvatar('default','logs-a'))?.position,path.at(-1));
 const events=f.state.events.filter(e=>e.subject.id===pending.result.movementId);assert.deepEqual(events.map(e=>e.kind),['world.movement.pending','world.movement.running','world.movement.running','world.movement.completed']);assert(events.every(e=>e.audience.kind==='agents'&&e.payload.behaviorDetails===undefined));assert(events.every(e=>[...f.state.outbox.values()].some(o=>o.eventId===e.eventId)));
 const replay=await f.store.transaction(ctx=>createWorldService(f.identity).execute(ctx,a,pending.key,{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path}));assert.deepEqual(replay,pending);assert.equal(records().length,0);
 const current=(await f.world.getAvatar('default','logs-a'))!;const stop=await move('world.avatar.move',{worldId:'default',expectedVersion:current.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:current.position.x-dx,y:current.position.y}]});
 const stopped=await move('world.movement.stop',{worldId:'default',movementId:stop.result.movementId!,expectedVersion:1});assert.equal(stopped.result.state,'stopped');assert(f.state.events.some(e=>e.subject.id===stop.result.movementId&&e.kind==='world.movement.stopped'));assert.equal(records().length,0);
 f.failAt='event';const before={events:f.state.events.length,movements:f.state.movements.size,receipts:f.state.receipts.size};await assert.rejects(()=>move('world.avatar.move',{worldId:'default',expectedVersion:current.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:current.position.x-dx,y:current.position.y}]}));assert.deepEqual({events:f.state.events.length,movements:f.state.movements.size,receipts:f.state.receipts.size},before);
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

test('ordinary idle still moves across restart and accepts legacy task payloads without accumulating log details',async()=>{
 const {f,move,records,enable,scheduler}=await setup();await move('world.avatar.create',{worldId:'default',expectedRulesetVersion:1});await enable();f.failAt='behavior';
 const original=(await f.world.getAvatar('default','logs-a'))!,eventsBefore=f.state.events.length;
 const tick=async(driver=scheduler)=>{const task=[...f.state.tasks.values()].find(t=>t.kind==='world.idle.step')!;f.now=Math.max(f.now,task.dueAt);await driver.runDue();};
 for(let i=0;i<6;i++)await tick();assert((await f.world.getAvatar('default','logs-a'))!.version>original.version);assert.equal(records().length,0);assert.equal(f.state.events.length,eventsBefore);
 const task=[...f.state.tasks.values()].find(t=>t.kind==='world.idle.step')!;task.payload.behaviorJourney={origin:{x:0,y:0},startedAt:1,path:[{x:1,y:0}]};
 const resumed=createWorldService(f.identity),afterRestart=createDeterministicScheduler({store:f.store,workerId:'resumed-noise',batchLimit:10,handlers:[{kind:'world.idle.step',version:1,run:resumed.handleIdleTask}]});
 const beforeRestart=(await f.world.getAvatar('default','logs-a'))!.version;for(let i=0;i<6;i++)await tick(afterRestart);assert((await f.world.getAvatar('default','logs-a'))!.version>beforeRestart);assert.equal(records().length,0);assert.equal(f.state.events.length,eventsBefore);assert([...f.state.tasks.values()].filter(t=>t.kind==='world.idle.step').every(t=>t.payload.behaviorJourney===undefined));
 const paused=(await f.world.getAvatar('default','logs-a'))!.version;f.membership('logs-a',{ownerPaused:true});f.now+=600000;await tick(afterRestart);assert.equal((await f.world.getAvatar('default','logs-a'))!.version,paused);assert.equal(records().length,0);
});

test('social detail keeps per-node outcomes and source participant references without body copies or public access',async()=>{
 const {f,a,b,relationships,interaction,social,records,enable}=await setup();await enable();
 const friendship=(who:typeof a,action:string,input:JsonObject)=>f.store.transaction(ctx=>relationships.execute(ctx,who,{...f.key(who,action),domain:'relationships'},input));
 const sent=await friendship(a,'relationships.invitation.send',{toAgentId:'logs-b',message:'PRIVATE NOTE'}),request=(sent.result.request as JsonObject).requestId!;const sentAt=f.now;
 f.now+=2500;await friendship(b,'relationships.invitation.decline',{requestId:request,expectedVersion:1});
 const send=records().find(r=>r.agentId==='logs-a'&&r.node==='relationships.invitation.sent')!,declined=records().find(r=>r.agentId==='logs-a'&&r.node==='relationships.invitation.declined')!;
 const sentDetails=(await f.store.read(ctx=>relationships.describeBehavior(ctx,send,'owner')))!;assert.equal(sentDetails.resultCode,'friendship_pending');assert.equal(sentDetails.endedAt,null);
 const declinedDetails=(await f.store.read(ctx=>relationships.describeBehavior(ctx,declined,'owner')))!;assert.equal(declinedDetails.durationMs,2500);assert.equal(declinedDetails.startedAt,sentAt);assert.equal(declinedDetails.resultCode,'friendship_declined');assert.deepEqual(declinedDetails.participants,[{agentId:'logs-a',role:'sender'},{agentId:'logs-b',role:'recipient'}]);assert.equal(await f.store.read(ctx=>relationships.describeBehavior(ctx,declined,'public')),null);
 const work=await social(a,'interaction.artifact.create',{title:'PRIVATE TITLE',body:'PRIVATE BODY'}),inv=await social(a,'interaction.invitation.send',{worldId:'default',toAgentId:'logs-b',artifact:work.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'PRIVATE INTENT'});
 f.now+=1000;const accepted=await social(b,'interaction.invitation.accept',{invitationId:inv.result.invitationId!,expectedVersion:1}),activity=accepted.result.activity as JsonObject,acceptedAt=f.now;
 f.now+=2000;await social(b,'interaction.activity.submit_feedback',{activityId:activity.activityId!,expectedVersion:1,body:'PRIVATE FEEDBACK'});const submitted=records().find(r=>r.agentId==='logs-a'&&r.node==='interaction.feedback.submitted')!;
 f.now+=3000;await social(a,'interaction.activity.close',{activityId:activity.activityId!,expectedVersion:2});const closed=records().find(r=>r.agentId==='logs-a'&&r.node==='interaction.activity.closed')!;
 const before=(await f.store.read(ctx=>interaction.describeBehavior(ctx,submitted,'owner')))!,after=(await f.store.read(ctx=>interaction.describeBehavior(ctx,closed,'owner')))!;
 assert.equal(before.resultCode,'waiting_ack_submitted_unconfirmed');assert.equal(before.endedAt,null);assert.equal(after.resultCode,'closed_received_confirmed');assert.equal(after.startedAt,acceptedAt);assert.equal(after.durationMs,5000);assert(!JSON.stringify([sentDetails,declinedDetails,before,after]).includes('PRIVATE'));
 delete f.state.events.find(e=>e.eventId===submitted.sourceEventId)!.payload.behaviorDetails;assert.deepEqual(await f.store.read(ctx=>interaction.describeBehavior(ctx,submitted,'owner')),before);
 assert.equal(await f.store.read(ctx=>interaction.describeBehavior(ctx,closed,'public')),null);
 await social(b,'interaction.policy.block',{agentId:'logs-a',expectedVersion:1});assert.equal(await f.store.read(ctx=>interaction.describeBehavior(ctx,closed,'owner')),null);assert.equal(await f.store.read(ctx=>relationships.describeBehavior(ctx,declined,'owner')),null);
});
