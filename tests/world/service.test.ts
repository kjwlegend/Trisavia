import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapWorld, createWorldService, verifyWorldReadiness } from '../../apps/platform/application/world-service.ts';
import { DEFAULT_WORLD_RULES } from '../../apps/platform/domains/world/rules.ts';
import type { WorldRuleset } from '../../apps/platform/domains/world/types.ts';
import type { Principal } from '../../apps/platform/domains/access/public.ts';
import { coreFixture } from './runtime-fixture.ts';

async function fixture() { const f=coreFixture(), a=f.addAgent('agent-a'), b=f.addAgent('agent-b'), service=createWorldService(f.identity);await f.store.transaction(ctx=>bootstrapWorld(ctx));return{f,a,b,service}; }
test('unbound runtime creates one stable Avatar, moves authoritative logical position and recovers exact receipt',async()=>{
  const {f,a,service}=await fixture(), key=f.key(a,'world.avatar.create','create-once');
  const first=await f.store.transaction(ctx=>service.execute(ctx,a,key,{worldId:'default',expectedRulesetVersion:1}));
  assert.equal(first.outcome,'committed');assert.equal(f.state.avatars.size,1);assert.equal(f.state.events.length,1);assert.equal(f.state.outbox.size,1);
  assert.deepEqual(await f.store.transaction(ctx=>service.execute(ctx,a,key,{worldId:'default',expectedRulesetVersion:1})),first);
  await assert.rejects(f.store.transaction(ctx=>service.execute(ctx,a,key,{worldId:'default',expectedRulesetVersion:2})),{code:'command_conflict'});
  const moved=await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:1,y:0},{x:1,y:1}]}));
  assert.equal(moved.result.version,2);assert.deepEqual((await f.store.read(ctx=>service.readAvatar(ctx,a,'default'))).avatar.position,{x:1,y:1});
  const noop=await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}));assert.equal(noop.result.changed,false);assert.equal(f.state.avatars.size,1);
});
test('movement rejects stale versions, walls, unavailable places and capacity without changing a partial path',async()=>{
  const f=coreFixture(),a=f.addAgent('agent-a'),b=f.addAgent('agent-b'),service=createWorldService(f.identity);const rules:WorldRuleset=structuredClone(DEFAULT_WORLD_RULES);
  rules.blocked=[{x:2,y:0}];rules.places=[{id:'commons',bounds:{left:0,right:0,top:0,bottom:0},access:'members',capacity:null},{id:'limited',bounds:{left:1,right:1,top:0,bottom:0},access:'members',capacity:1}];
  await f.store.transaction(ctx=>bootstrapWorld(ctx,rules));for(const p of [a,b])await f.store.transaction(ctx=>service.execute(ctx,p,f.key(p,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}));
  const move=(p:Principal,path:{x:number;y:number}[],v=1)=>f.store.transaction(ctx=>service.execute(ctx,p,f.key(p,'world.avatar.move'),{worldId:'default',expectedVersion:v,expectedRulesetVersion:1,expectedTopologyVersion:1,path}));
  assert.equal((await move(a,[{x:1,y:0}])).outcome,'committed');const before=f.state.events.length;
  assert.equal((await move(b,[{x:1,y:0}])).result.code,'place_capacity_reached');assert.equal((await move(b,[{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:2,y:0}])).result.code,'path_invalid');
  assert.equal((await move(a,[{x:1,y:1}],1)).result.code,'version_conflict');assert.equal(f.state.events.length,before);assert.deepEqual((await service.readAvatar(f.context,b,'default')).avatar.position,{x:0,y:0});
});
test('World owner cannot sign; pause/restriction/left are current authority gates, while leave/recreate preserves Avatar identity',async()=>{
  const {f,a,service}=await fixture(),created=await service.execute(f.context,a,f.key(a,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1});
  const owner:Principal={kind:'owner',ownerId:'owner-agent-a',ownerAuthVersion:1,source:'owner',credentialId:'owner',credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:'owner',expiresAt:null};
  await assert.rejects(service.execute(f.context,owner,f.key(owner,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}),{code:'invalid_request'});
  f.membership('agent-a',{ownerPaused:true});
  assert.equal((await f.store.transaction(ctx=>service.execute(ctx,a,f.key(a,'world.avatar.move'),{worldId:'default',expectedVersion:1,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:1,y:0}]}))).result.code,'participation_paused');
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
