import assert from 'node:assert/strict';
import test from 'node:test';
import {worldActionPolicy,worldActionAuthority,assertWorldActionAllowed} from '../../apps/platform/domains/access/world-action-policy.ts';
import {lifeFixture} from '../life/fixture.ts';

test('manual has the same bounded world action authority; legacy and stored authority generations validate without backfill',()=>{
 const legacy={version:7,mode:'autonomous' as const,updatedAt:10};
 const manual={version:8,mode:'manual' as const,updatedAt:20,actionVersion:7,actionUpdatedAt:10};
 assert.deepEqual(worldActionAuthority(manual),legacy);
 assert.doesNotThrow(()=>assertWorldActionAllowed(manual,'life.plans.submit'));
 assert.throws(()=>assertWorldActionAllowed(manual,'future.unapproved'),{code:'world_action_not_allowed'});
 assert.throws(()=>assertWorldActionAllowed({...manual,mode:'observe'},'life.plans.submit'),{code:'world_action_observe_only'});
 for(const field of [{actionVersion:-1,actionUpdatedAt:10},{actionVersion:9,actionUpdatedAt:10},{actionVersion:7,actionUpdatedAt:21},{actionVersion:7},{actionUpdatedAt:10}])assert.throws(()=>worldActionPolicy({id:'synthetic',version:1,data:{worldActionPolicy:{...legacy,...field}}}),{code:'world_action_policy_unavailable'});
});

test('a submitted finite Life plan retains legacy numeric qualification across auto/manual; true pause still interrupts it',async()=>{
 const f=await lifeFixture(),p=await f.add('manual-life-agent');if(p.kind!=='agent')throw Error('Synthetic Agent required');
 const start=await f.invoke(p,'life.activities.start',f.startInput);assert.equal(start.outcome,'committed');
 const activity=[...f.state.activities.values()][0]!;assert.equal(activity.qualification!.policyVersion,0);
 const current=f.f.state.participants.get(p.agentId)!;
 f.f.state.participants.set(p.agentId,{...current,actionPolicy:{mode:'manual',version:1,updatedAt:f.now,actionVersion:0,actionUpdatedAt:null}});
 await f.run(600001);
 assert.equal(f.state.activities.get(activity.id)!.state,'completed');assert.equal(f.state.balances.get('agent:'+p.agentId),36);
 const again=await f.invoke(p,'life.activities.start',f.startInput);assert.equal(again.outcome,'committed');
 const latest=[...f.state.activities.values()].find(v=>v.id!==activity.id)!;
 f.f.membership(p.agentId,{ownerPaused:true,ownerPauseVersion:2});await f.run(600001);
 assert.notEqual(f.state.activities.get(latest.id)!.state,'completed');assert.equal(f.state.balances.get('agent:'+p.agentId),36);
});
