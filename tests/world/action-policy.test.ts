import assert from 'node:assert/strict';
import test from 'node:test';
import {assertWorldActionAllowed,worldActionPolicy} from '../../apps/platform/domains/access/world-action-policy.ts';
import {createWorldService,bootstrapWorld} from '../../apps/platform/application/world-service.ts';
import {createInteractionService,bootstrapInteraction} from '../../apps/platform/application/interaction-service.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {createDeterministicScheduler} from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import {coreFixture} from './runtime-fixture.ts';
import {M1Error} from '../../apps/platform/domains/common/errors.ts';
const failure=(code:string)=>(e:unknown)=>e instanceof M1Error&&e.code===code;
test('legacy autonomy is explicit and unknown actions or invalid persisted policy fail closed',()=>{
 const policy=worldActionPolicy({id:'synthetic-agent',version:1,data:{}});
 assert.deepEqual(policy,{version:0,mode:'autonomous',updatedAt:null});
 assert.doesNotThrow(()=>assertWorldActionAllowed(policy,'interaction.activity.close'));
 assert.throws(()=>assertWorldActionAllowed(policy,'future_module.transfer'),failure('world_action_not_allowed'));
 assert.throws(()=>worldActionPolicy({id:'synthetic-agent',version:1,data:{worldActionPolicy:{version:1,mode:'unrestricted',updatedAt:1}}}),failure('world_action_policy_unavailable'));
});
test('direct service writes and idle rules obey observe while current reads and original receipts remain available',async()=>{
 const f=coreFixture(),a=f.addAgent('policy-agent-a'),b=f.addAgent('policy-agent-b'),world=createWorldService(f.identity),interaction=createInteractionService(f.identity,f.decisions),relationships=createRelationshipsService(f.identity);
 await f.store.transaction(async ctx=>{await bootstrapWorld(ctx);await bootstrapInteraction(ctx);});
 const created=await f.store.transaction(ctx=>world.execute(ctx,a,f.key(a,'world.avatar.create','original-create'),{worldId:'default',expectedRulesetVersion:1}));
 const before=structuredClone((await f.world.getAvatar('default','policy-agent-a'))!);
 const status=f.state.participants.get('policy-agent-a')!;f.state.participants.set('policy-agent-a',{...status,actionPolicy:{version:1,mode:'observe',updatedAt:f.now}});
 for(const action of ['world.avatar.move','world.movement.stop']){
  const receipt=await f.store.transaction(ctx=>world.execute(ctx,a,f.key(a,action),{worldId:'default',...(action.endsWith('.move')?{expectedVersion:before.version,expectedRulesetVersion:1,path:[{x:before.position.x===15?14:before.position.x+1,y:before.position.y}]}:{})}));
  assert.equal(receipt.outcome,'rejected');assert.equal(receipt.result.code,'world_action_observe_only');
 }
 const artifact=await f.store.transaction(ctx=>interaction.execute(ctx,a,f.key(a,'interaction.artifact.create'),{title:'Synthetic only',body:'Synthetic fixture body.'}));assert.equal(artifact.result.code,'world_action_observe_only');assert.equal(f.state.artifacts.size,0);
 const key={...f.key(a,'relationships.invitation.send'),domain:'relationships'};
 const invitation=await f.store.transaction(ctx=>relationships.execute(ctx,a,key,{toAgentId:'policy-agent-b',message:'Synthetic'}));assert.equal(invitation.result.code,'world_action_observe_only');assert.equal(f.state.friendshipInvitations.size,0);
 const scheduler=createDeterministicScheduler({store:f.store,workerId:'policy-test',batchLimit:2,handlers:[{kind:'world.idle.step',version:1,run:world.handleIdleTask}]});
 f.now=[...f.state.tasks.values()][0]!.dueAt;await scheduler.runDue();assert.deepEqual(await f.world.getAvatar('default','policy-agent-a'),before);
 await f.store.read(ctx=>world.readAvatar(ctx,a,'default'));
 assert.deepEqual(await f.store.transaction(ctx=>world.execute(ctx,a,{...created.key},{worldId:'default',expectedRulesetVersion:1})),created);
 const owner={kind:'owner' as const,ownerId:'owner-policy-agent-a',ownerAuthVersion:1,source:'owner' as const,credentialId:'owner',credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:'owner-auth',expiresAt:null};
 const ownerRequest=await f.store.transaction(ctx=>relationships.execute(ctx,owner,{...key,commandId:'owner-explicit-send',principal:{kind:'owner',id:owner.ownerId}},{agentId:'policy-agent-a',toAgentId:'policy-agent-b',message:'Owner named command'}));assert.equal(ownerRequest.outcome,'committed');
 const current=f.state.participants.get('policy-agent-a')!;f.state.participants.set('policy-agent-a',{...current,actionPolicy:{version:2,mode:'autonomous',updatedAt:f.now}});f.membership('policy-agent-a',{ownerPaused:true,ownerPauseVersion:2});
 const paused=await f.store.transaction(ctx=>interaction.execute(ctx,a,f.key(a,'interaction.artifact.create'),{body:'Synthetic'}));assert.equal(paused.result.code,'participation_paused');assert.equal(f.state.friendships.size,0);
});
