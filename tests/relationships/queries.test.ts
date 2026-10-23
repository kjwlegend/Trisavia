import assert from 'node:assert/strict';
import test from 'node:test';
import {coreFixture} from '../world/runtime-fixture.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {makeFriendshipInvitation} from '../../apps/platform/domains/relationships/transitions.ts';
import {compareRelationshipAnchor} from '../../apps/platform/domains/relationships/queries.ts';
import type {FriendshipInvitationState} from '../../apps/platform/domains/relationships/types.ts';
import type {IdentityAccess,Principal} from '../../apps/platform/domains/access/public.ts';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

function fixture(friendCount=126){
 const f=coreFixture(),principal=f.addAgent('selected-agent'),sibling=f.addAgent('sibling-agent');let bindingVersion=1,bound=true;
 const owner:Principal={kind:'owner',ownerId:'synthetic-owner',ownerAuthVersion:1,source:'owner',credentialId:'owner-credential',credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:'owner-auth',expiresAt:null};
 const identity:IdentityAccess<RuntimeReadContext>={...f.identity,async authorizeAgent(ctx,p,id){if(p.kind==='agent')return f.identity.authorizeAgent(ctx,p,id);if(!bound||!['selected-agent','sibling-agent'].includes(id))throw Object.assign(new Error('Not accessible'),{code:'target_not_accessible'});return {agentId:id,binding:{id:'binding-'+id,version:bindingVersion},authorizationVersion:'binding-'+id+'-'+bindingVersion};}};
 for(let i=0;i<friendCount;i++){
  const suffix=String(i).padStart(4,'0'),id='friend-agent-'+suffix;f.addAgent(id);
  f.state.publicAgents.set(id,{...f.state.publicAgents.get(id)!,displayName:i===125?'Final Needle_%':'Synthetic Friend '+suffix});
  const pair=['selected-agent',id].sort();f.state.friendships.set('friendship-'+suffix,{id:'friendship-'+suffix,version:1,firstAgentId:pair[0]!,secondAgentId:pair[1]!,status:'confirmed',confirmedAt:f.now+Math.floor((friendCount-i)/3),firstConfirmationId:'first-'+suffix,secondConfirmationId:'second-'+suffix,intimacyScore:i%101});
 }
 for(let i=0;i<60;i++){
  const other='request-agent-'+String(i).padStart(3,'0');f.addAgent(other);f.state.publicAgents.set(other,{...f.state.publicAgents.get(other)!,displayName:i===58?'Last Request Needle':'Synthetic Request '+i});
  const stateIndex=Math.floor(i/2)%6,state:FriendshipInvitationState=['pending','pending','accepted','declined','cancelled','expired'][stateIndex] as FriendshipInvitationState;
  const createdAt=stateIndex===1?f.now-604800000-100:Math.max(0,f.now-1000+Math.floor(i/4)),from=i%2? 'selected-agent':other,to=i%2?other:'selected-agent';
  const value=makeFriendshipInvitation({id:'request-'+String(i).padStart(3,'0'),fromAgentId:from,toAgentId:to,message:'note-only-private-keyword',sentBy:{kind:'agent',id:from},senderConfirmationId:'sent-'+i,sharedGeneration:0,participantGenerations:{from:1,to:1},now:Math.max(0,createdAt)});
  if(stateIndex===1)value.deadline=f.now-1;
  if(state!=='pending'){value.state=state;value.respondedAt=f.now-1;value.respondedBy={kind:'agent',id:state==='cancelled'?from:to};value.responseConfirmationId='reply-'+i;}
  f.state.friendshipInvitations.set(value.id,value);
 }
 const service=createRelationshipsService(identity),friends=(input:JsonObject={},p:Principal=owner)=>f.store.read(ctx=>service.friends(ctx,p,{agentId:'selected-agent',...input})),inbox=(input:JsonObject={},p:Principal=owner)=>f.store.read(ctx=>service.inbox(ctx,p,{agentId:'selected-agent',direction:'received',...input}));
 return {f,service,owner,principal,sibling,friends,inbox,rebind(){bindingVersion++;},unbind(){bound=false;}};
}

test('126 authorized friends: full-source literal name/ID search, exact totals and stable time/ID seek through the last page',async()=>{
 const t=fixture(),expected=[...t.f.state.friendships.values()].sort((a,b)=>-compareRelationshipAnchor({at:a.confirmedAt,id:a.id},{at:b.confirmedAt,id:b.id})).map(r=>r.id);
 let cursor:string|null=null,ids:string[]=[];do{const page=await t.friends({limit:17,...(cursor?{cursor}:{})});assert.equal(page.total,126);assert.equal(page.totalAsOf,page.asOf);ids.push(...page.friends.map(v=>String(v.relationshipId)));cursor=page.nextCursor;assert.equal(page.complete,cursor===null);}while(cursor);
 assert.deepEqual(ids,expected);assert.equal(new Set(ids).size,126);assert(!ids.slice(0,17).includes('friendship-0125'));
 const name=await t.friends({search:'  NEEDLE_%  ',limit:1});assert.equal(name.total,1);assert.equal(name.friends[0]!.agentId,'friend-agent-0125');assert.equal(name.complete,true);
 const stableId=await t.friends({search:'FRIEND-AGENT-0125'});assert.equal(stableId.total,1);assert.equal(stableId.friends[0]!.relationshipId,'friendship-0125');
 assert.equal((await t.friends({search:'no visible match'})).total,0);
 const oldest=await t.friends({order:'oldest',limit:20});assert.deepEqual(oldest.friends.map(v=>v.relationshipId),[...expected].reverse().slice(0,20));
});

test('60 requests: direction/counterpart search and effective state precede page/count; reads never expire or respond',async()=>{
 const t=fixture(),before=structuredClone(t.f.state);
 for(const direction of ['received','sent']){
  const page=await t.inbox({direction,limit:7});assert.equal(page.total,30);assert.equal(page.items.length,7);
  for(const state of ['pending','accepted','declined','cancelled','expired']){
   const filtered=await t.inbox({direction,state,limit:100});assert.equal(filtered.total,state==='expired'?10:5);assert(filtered.items.every(v=>v.state===state));assert.equal(filtered.complete,true);
  }
 }
 const needle=await t.inbox({search:' LAST REQUEST NEEDLE ',limit:1});assert.equal(needle.total,1);assert.equal(needle.items[0]!.requestId,'request-058');
 assert.equal((await t.inbox({search:'REQUEST-AGENT-058'})).total,1);
 assert.equal((await t.inbox({search:'note-only-private-keyword'})).total,0,'Private notes are not searchable');
 assert.equal((await t.inbox({direction:'sent',search:'Last Request Needle'})).total,0);
 assert.deepEqual(t.f.state,before,'Filtering is a pure read, including effective expiry');
});

test('query-scoped continuation rejects cross query/limit/order/state/Agent/caller/rebinding; current source revocations filter both rows and totals',async()=>{
 const t=fixture(),page=await t.friends({limit:5});assert(page.nextCursor);
 for(const change of [{search:'Friend'},{order:'oldest'},{limit:6},{agentId:'sibling-agent'}])await assert.rejects(t.friends({limit:5,cursor:page.nextCursor,...change}),{code:'invalid_cursor'});
 await assert.rejects(t.friends({limit:5,cursor:page.nextCursor},t.principal),{code:'invalid_cursor'});
 const request=await t.inbox({limit:5});assert(request.nextCursor);
 await assert.rejects(t.inbox({limit:5,cursor:request.nextCursor,state:'pending'}),{code:'invalid_cursor'});
 await assert.rejects(t.inbox({limit:5,cursor:request.nextCursor,direction:'sent'}),{code:'invalid_cursor'});
 assert.equal((await t.friends({agentId:'sibling-agent'})).total,0);
 await assert.rejects(t.friends({agentId:'friend-agent-0001'},t.principal),{code:'target_not_accessible'});
 t.f.state.publicAgents.delete('friend-agent-0000');t.f.membership('friend-agent-0001',{platformRestricted:true});
 const pair=['selected-agent','friend-agent-0002'].sort();t.f.state.pairs.set(JSON.stringify(pair),{firstAgentId:pair[0]!,secondAgentId:pair[1]!,version:1,blockedByAgentIds:['selected-agent'],sharedGeneration:1,updatedAt:t.f.now});
 const current=await t.friends({limit:100});assert.equal(current.total,123);assert(!current.friends.some(v=>['friend-agent-0000','friend-agent-0001','friend-agent-0002'].includes(String(v.agentId))));
 const inv=t.f.state.friendshipInvitations.get('request-058')!;inv.sharedGeneration=1;
 assert.equal((await t.inbox({search:'Last Request Needle'})).total,0,'Revoked sharing is not counted or returned');
 t.rebind();await assert.rejects(t.friends({limit:5,cursor:page.nextCursor}),{code:'invalid_cursor'});
 t.unbind();await assert.rejects(t.friends(),{code:'target_not_accessible'});
});

test('unknown bounded totals never truncate continuation; malformed filters and a real source error do not become an empty result',async()=>{
 const t=fixture(1001),first=await t.friends({limit:100});assert.equal(first.total,null);assert(first.nextCursor);
 let cursor:string|null=first.nextCursor,count=first.friends.length,pages=1;while(cursor){const page=await t.friends({limit:100,cursor});count+=page.friends.length;cursor=page.nextCursor;pages++;}assert.equal(count,1001);assert.equal(pages,11);
 for(const input of [{search:'x'.repeat(101)},{search:[]},{order:'intimacy'},{limit:101},{state:'pending'}])await assert.rejects(t.friends(input),{code:'invalid_request'});
 await assert.rejects(t.inbox({state:['pending']}),{code:'invalid_request'});
 t.f.relationships.listConfirmed=async()=>{throw new Error('Synthetic unavailable source');};await assert.rejects(t.friends(),/unavailable source/);
});
