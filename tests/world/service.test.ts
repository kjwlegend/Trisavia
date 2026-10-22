import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapWorld, createWorldService, verifyWorldReadiness } from '../../apps/platform/application/world-service.ts';
import { DEFAULT_WORLD_RULES } from '../../apps/platform/domains/world/rules.ts';
import type { WorldRuleset } from '../../apps/platform/domains/world/types.ts';
import type { Principal } from '../../apps/platform/domains/access/public.ts';
import { M1Error } from '../../apps/platform/domains/common/errors.ts';
import { coreFixture } from './runtime-fixture.ts';

// Movement tests use offsets from the actual dispersed birth cell.
function cell(f:ReturnType<typeof coreFixture>,id:string,offset:{x:number;y:number}) {
  const event=f.state.events.find(e=>e.kind==='world.avatar.created'&&e.payload.agentId===id)!;
  const origin=event.payload.position as {x:number;y:number};
  return {x:origin.x+(origin.x>7?-offset.x:offset.x),y:origin.y+(origin.y>7?-offset.y:offset.y)};
}
function route(f:ReturnType<typeof coreFixture>,id:string,path:{x:number;y:number}[]){return path.map(point=>cell(f,id,point));}

async function fixture() { const f=coreFixture(), a=f.addAgent('agent-a'), b=f.addAgent('agent-b'), service=createWorldService(f.identity);await f.store.transaction(ctx=>bootstrapWorld(ctx));return{f,a,b,service}; }
async function runStep(f:ReturnType<typeof coreFixture>,service:ReturnType<typeof createWorldService>) {
  const pending=[...f.state.tasks.values()].filter(t=>t.kind==='world.movement.step'&&t.state==='pending').sort((a,b)=>a.dueAt-b.dueAt)[0];assert.ok(pending);
  f.now=Math.max(f.now,pending.dueAt);const task=(await f.context.tasks.claimDue({now:f.now,workerId:'world-core-c',leaseMs:1000,limit:1,kinds:['world.movement.step']}))[0]!;
  await f.store.transaction(async ctx=>{await service.handleTask(ctx,task);await ctx.tasks.complete(task.lease!,ctx.now());});return task;
}
test('unbound runtime creates one stable Avatar, moves authoritative logical position and recovers exact receipt',async()=>{
  const {f,a,service}=await fixture(), key=f.key(a,'world.avatar.create','create-once');
  const first=await f.store.transaction(ctx=>service.execute(ctx,a,key,{worldId:'default',expectedRulesetVersion:1}));
  assert.equal(first.outcome,'committed');assert.equal(f.state.avatars.size,1);assert.equal(f.state.events.length,1);assert.equal(f.state.outbox.size,1);
  assert.deepEqual(await f.store.transaction(ctx=>service.execute(ctx,a,key,{worldId:'default',expectedRulesetVersion:1})),first);
  await assert.rejects(f.store.transaction(ctx=>service.execute(ctx,a,key,{worldId:'default',expectedRulesetVersion:2})),{code:'command_conflict'});
  const moved=await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:route(f,'agent-a',[{x:1,y:0},{x:1,y:1}])}));
  assert.equal(moved.result.state,'pending');assert.equal(moved.result.version,1);assert.deepEqual((await f.store.read(ctx=>service.readAvatar(ctx,a,'default'))).avatar.position,cell(f,'agent-a',{x:0,y:0}));await runStep(f,service);await runStep(f,service);assert.deepEqual((await f.store.read(ctx=>service.readAvatar(ctx,a,'default'))).avatar.position,cell(f,'agent-a',{x:1,y:1}));
  const noop=await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}));assert.equal(noop.result.changed,false);assert.equal(f.state.avatars.size,1);
});
test('movement rejects stale versions, walls, unavailable places and capacity without changing a partial path',async()=>{
  const f=coreFixture(),a=f.addAgent('agent-a'),b=f.addAgent('agent-b'),service=createWorldService(f.identity);const rules:WorldRuleset=structuredClone(DEFAULT_WORLD_RULES);
  rules.blocked=[{x:2,y:0}];rules.places=[{id:'commons',bounds:{left:0,right:0,top:0,bottom:0},access:'members',capacity:null},{id:'limited',bounds:{left:1,right:1,top:0,bottom:0},access:'members',capacity:1}];
  await f.store.transaction(ctx=>bootstrapWorld(ctx,rules));for(const p of [a,b])await f.store.transaction(ctx=>service.execute(ctx,p,f.key(p,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}));
  for(const avatar of f.state.avatars.values()){avatar.position={x:0,y:0};avatar.placeId='commons';}
  const move=(p:Principal,path:{x:number;y:number}[],v=1)=>f.store.transaction(ctx=>service.execute(ctx,p,f.key(p,'world.avatar.move'),{worldId:'default',expectedVersion:v,expectedRulesetVersion:1,expectedTopologyVersion:1,path}));
  assert.equal((await move(a,[{x:1,y:0}])).outcome,'committed');await runStep(f,service);const before=f.state.events.length;
  assert.equal((await move(b,[{x:1,y:0}])).result.code,'place_capacity_reached');assert.equal((await move(b,[{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:2,y:0}])).result.code,'path_invalid');
  assert.equal((await move(a,[{x:1,y:1}],1)).result.code,'version_conflict');assert.equal(f.state.events.length,before);assert.deepEqual((await service.readAvatar(f.context,b,'default')).avatar.position,{x:0,y:0});
});
test('World owner cannot sign; pause/restriction/left are current authority gates, while leave/recreate preserves Avatar identity',async()=>{
  const {f,a,service}=await fixture(),created=await service.execute(f.context,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});
  const owner:Principal={kind:'owner',ownerId:'owner-agent-a',ownerAuthVersion:1,source:'owner',credentialId:'owner',credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:'owner',expiresAt:null};
  await assert.rejects(service.execute(f.context,owner,f.key(owner,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}),{code:'invalid_request'});
  f.membership('agent-a',{ownerPaused:true});
  assert.equal((await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:route(f,'agent-a',[{x:1,y:0}])}))).result.code,'participation_paused');
  f.membership('agent-a',{ownerPaused:false});
  await service.execute(f.context,a,f.key(a,'world.avatar.leave'),{worldId:'default',expectedVersion:1});
  const recreated=await service.execute(f.context,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});assert.equal(recreated.result.avatarId,created.result.avatarId);assert.equal(recreated.result.version,3);
  f.membership('agent-a',{state:'left'});await assert.rejects(service.authorizeReceipt(f.context,a,created),{code:'world_not_accessible'});
});
test('World initialization is explicit; event/outbox/receipt storage failures roll back the entire authoritative move',async()=>{
  const f=coreFixture(),a=f.addAgent('agent-a'),service=createWorldService(f.identity);await assert.rejects(verifyWorldReadiness(f.context),{code:'world_not_available'});await f.store.transaction(ctx=>bootstrapWorld(ctx));await verifyWorldReadiness(f.context);
  for(const at of ['event','outbox','receipt']) {f.failAt=at;await assert.rejects(f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1})),/injected storage failure/);assert.equal(f.state.avatars.size,0);assert.equal(f.state.events.length,0);assert.equal(f.state.receipts.size,0);assert.equal(f.state.worlds.get('default')!.revision,1);}
});
test('inaccessible Avatar targets share one error; opaque scene pages cross hidden records without publishing their identities',async()=>{
  const {f,a,b,service}=await fixture();f.addAgent('agent-c');
  for(const id of ['agent-a','agent-b','agent-c']) {const principal=id==='agent-a'?a:id==='agent-b'?b:f.addAgent(id);await service.execute(f.context,principal,f.key(principal,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});}
  f.membership('agent-b',{platformRestricted:true});
  const errors=[];for(const target of ['agent-missing','agent-b'])try{await service.readAvatar(f.context,a,'default',target);}catch(error){const e=error as Error & {code:string;statusCode:number};errors.push([e.code,e.statusCode,e.message]);}
  assert.deepEqual(errors[0],errors[1]);
  const first=await service.readScene(f.context,a,'default',{limit:1});assert.deepEqual(first.avatars.map(x=>x.agentId),['agent-a']);assert.equal('nextAfterAgentId' in first,false);assert.ok(first.nextCursor);
  assert.equal(first.nextCursor.includes('agent-'),false);
  const second=await service.readScene(f.context,a,'default',{limit:1,cursor:first.nextCursor});assert.deepEqual(second.avatars.map(x=>x.agentId),['agent-c']);assert.equal(second.complete,true);
  await assert.rejects(service.readScene(f.context,b,'default',{limit:1,cursor:first.nextCursor}));
  await assert.rejects(service.readScene(f.context,a,'default',{limit:2,cursor:first.nextCursor}),{code:'world_cursor_invalid'});
  const restarted=createWorldService(f.identity);await assert.rejects(restarted.readScene(f.context,a,'default',{limit:1,cursor:first.nextCursor}),{code:'world_cursor_invalid'});
  f.now+=300000;await assert.rejects(service.readScene(f.context,a,'default',{limit:1,cursor:first.nextCursor}),{code:'world_cursor_invalid'});
});

test('server rules persist a path plan and advance one fenced logical step per due task, without catch-up teleportation',async()=>{
  const {f,a,b,service}=await fixture();await service.execute(f.context,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});
  const planned=await service.execute(f.context,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:route(f,'agent-a',[{x:1,y:0},{x:2,y:0},{x:3,y:0}])});
  assert.equal(f.state.movements.size,1);assert.equal(planned.result.nextDueAt,f.now+1000);assert.equal(planned.result.stepIntervalMs,1000);
  assert.deepEqual((await service.readAvatar(f.context,a,'default')).avatar.position,cell(f,'agent-a',{x:0,y:0}));await assert.rejects(service.readMovement(f.context,b,'default',planned.result.movementId as string),{code:'movement_not_found'});
  const restarted=createWorldService(f.identity);assert.equal((await restarted.readMovement(f.context,a,'default',planned.result.movementId as string)).nextStep,0);
  f.now+=3_600_000;await runStep(f,restarted);assert.deepEqual((await restarted.readAvatar(f.context,a,'default')).avatar.position,cell(f,'agent-a',{x:1,y:0}));
  const movement=await restarted.readMovement(f.context,a,'default');assert.equal(movement.nextDueAt,f.now+1000);assert.equal(movement.nextStep,1);assert.equal(movement.state,'running');
  const rulesEvents=f.state.events.filter(e=>e.kind==='world.avatar.moved');assert.equal(rulesEvents.length,1);assert.equal(rulesEvents[0]!.source,'rules');assert.equal(rulesEvents[0]!.actor.kind,'system');
  const scene=await restarted.readScene(f.context,a,'default');assert.equal(JSON.stringify(scene).includes('path'),false);assert.equal(JSON.stringify(scene).includes('qualification'),false);
  await runStep(f,restarted);await runStep(f,restarted);assert.equal((await restarted.readMovement(f.context,a,'default',planned.result.movementId as string)).state,'completed');assert.deepEqual((await restarted.readAvatar(f.context,a,'default')).avatar.position,cell(f,'agent-a',{x:3,y:0}));
});
test('pause/resume, runtime revocation and topology changes stop old movement instead of reviving its task',async()=>{
  for(const change of ['pause','revoke','rules']) {
    const {f,a,service}=await fixture();await service.execute(f.context,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});
    const planned=await service.execute(f.context,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:route(f,'agent-a',[{x:1,y:0},{x:2,y:0}])});
    if(change==='pause')f.membership('agent-a',{ownerPauseVersion:3,ownerPaused:false}); // A real pause followed by resume still invalidates the old qualification stamp.
    else if(change==='revoke'){const old=f.state.participants.get('agent-a')!;f.state.participants.set('agent-a',{...old,runtimeActive:false});}
    else f.state.rules.get('default:1')!.topologyVersion++;
    await runStep(f,service);assert.equal(f.state.movements.get(planned.result.movementId as string)!.state,'stopped');assert.deepEqual(f.state.avatars.values().next().value!.position,cell(f,'agent-a',{x:0,y:0}));
  }
});
test('movement storage failure rolls back the step; re-claimed old lease cannot duplicate it and explicit stop leaves position authoritative',async()=>{
  const {f,a,service}=await fixture();await service.execute(f.context,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});
  const planned=await service.execute(f.context,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:route(f,'agent-a',[{x:1,y:0},{x:2,y:0}])});
  f.now+=1000;const old=(await f.context.tasks.claimDue({now:f.now,workerId:'old',leaseMs:10,limit:1,kinds:['world.movement.step']}))[0]!;
  const before=structuredClone(f.state);f.failAt='outbox';await assert.rejects(f.store.transaction(ctx=>service.handleTask(ctx,old)),/injected storage failure/);assert.deepEqual(f.state,before);f.failAt='';
  f.now+=10;const task=(await f.context.tasks.claimDue({now:f.now,workerId:'new',leaseMs:1000,limit:1,kinds:['world.movement.step']}))[0]!;await assert.rejects(f.store.transaction(ctx=>service.handleTask(ctx,old)),{code:'lease_lost'});
  await f.store.transaction(async ctx=>{await service.handleTask(ctx,task);await ctx.tasks.complete(task.lease!,ctx.now());});assert.deepEqual((await service.readAvatar(f.context,a,'default')).avatar.position,cell(f,'agent-a',{x:1,y:0}));
  const stop=await service.execute(f.context,a,f.key(a,'world.movement.stop'),{worldId:'default',movementId:planned.result.movementId!,expectedVersion:2});assert.equal(stop.result.state,'stopped');await runStep(f,service);assert.deepEqual((await service.readAvatar(f.context,a,'default')).avatar.position,cell(f,'agent-a',{x:1,y:0}));assert.equal(f.state.movements.get(planned.result.movementId as string)!.stoppedCode,'agent_stopped');
});
test('human public scene uses current published-source permission and never forges an Agent or reveals private movement intents',async()=>{
  const {f,a,b,service}=await fixture();for(const p of [a,b])await service.execute(f.context,p,f.key(p,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});
  await service.execute(f.context,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:route(f,'agent-a',[{x:1,y:0}])});
  const publicScene=await service.readPublicScene(f.context,'default');assert.equal(publicScene.avatars.length,2);assert.equal(publicScene.avatars[0]!.profile.displayName,'Published agent-a');
  assert.equal(JSON.stringify(publicScene).includes('movementId'),false);assert.equal(JSON.stringify(publicScene).includes('qualification'),false);
  f.state.publicAgents.delete('agent-b');assert.deepEqual((await service.readPublicScene(f.context,'default')).avatars.map(x=>x.agentId),['agent-a']);await assert.rejects(service.readAvatar(f.context,a,'default','agent-b'),{code:'avatar_not_found'});
  await assert.rejects(service.readMovement(f.context,b,'default',[...f.state.movements.values()][0]!.id),{code:'movement_not_found'});
});

test('event target invisibility is one public error while caller qualification and actual service failures retain their meaning',async()=>{
  const {f,a,b,service}=await fixture();await service.execute(f.context,b,f.key(b,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});const event=f.state.events[0]!;
  const errors=[];for(const state of ['restricted','left','missing']) {
    if(state==='restricted')f.membership('agent-b',{platformRestricted:true});else if(state==='left')f.membership('agent-b',{platformRestricted:false,state:'left'});else f.state.participants.delete('agent-b');
    try{await service.authorizeEvent(f.context,a,event);}catch(error){const e=error as M1Error;errors.push([e.code,e.statusCode,e.message,e.details]);}
  }
  assert.deepEqual(errors[0],errors[1]);assert.deepEqual(errors[0],errors[2]);assert.equal(errors[0]![1],404);
  const old=f.identity.readParticipation;f.identity.readParticipation=async(ctx,id)=>{if(id==='agent-b')throw new M1Error('storage_unavailable',503,'Synthetic storage failure');return old(ctx,id);};
  await assert.rejects(service.authorizeEvent(f.context,a,event),{code:'storage_unavailable',statusCode:503});
  f.identity.readParticipation=async(ctx,id)=>{if(id==='agent-b')throw new Error('Synthetic infrastructure failure');return old(ctx,id);};await assert.rejects(service.authorizeEvent(f.context,a,event),/Synthetic infrastructure failure/);
  f.membership('agent-a',{platformRestricted:true});await assert.rejects(service.authorizeEvent(f.context,a,event),{code:'platform_restricted',statusCode:403});
});
test('movement step rechecks fresh qualification before commit and rolls back positions when authority changes during the transaction',async()=>{
  const {f,a,service}=await fixture();await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}));
  await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:route(f,'agent-a',[{x:1,y:0}])}));
  f.now+=1000;const task=(await f.context.tasks.claimDue({now:f.now,workerId:'c',leaseMs:1000,limit:1,kinds:['world.movement.step']}))[0]!,before=structuredClone(f.state);
  await assert.rejects(f.store.transaction(async ctx=>{await service.handleTask(ctx,task);await ctx.tasks.complete(task.lease!,ctx.now());f.membership('agent-a',{ownerPauseVersion:3});}),{code:'world_qualification_changed'});assert.deepEqual(f.state,before);
});
