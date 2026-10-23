import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapInteraction,createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {relationshipsGatewayGuide,relationshipsGatewayOperations} from '../../apps/platform/application/agent-gateway-relationships.ts';
import {interactionGatewayGuide,interactionGatewayOperations} from '../../apps/platform/application/agent-gateway-interaction.ts';
import {worldGatewayGuide,worldGatewayOperations} from '../../apps/platform/application/agent-gateway-world.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';
import type {IdentityAccess,Principal} from '../../apps/platform/domains/access/public.ts';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

/** Synthetic sources and actors only; no real profile, message, account or service is used. */
async function fixture(){
 const f=coreFixture(),a=f.addAgent('agent-a'),b=f.addAgent('agent-b'),c=f.addAgent('agent-c');
 const bindings=new Map([['agent-a',{ownerId:'owner-a',version:1}],['agent-c',{ownerId:'owner-a',version:1}],['agent-b',{ownerId:'owner-b',version:1}]]);
 const owner=(id:string):Principal=>({kind:'owner',ownerId:id,ownerAuthVersion:1,source:'owner',credentialId:id,credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:id,expiresAt:null});
 const oa=owner('owner-a'),ob=owner('owner-b'),tokens=new Map([['owner-a',oa],['owner-b',ob],['agent-a',a],['agent-b',b],['agent-c',c]]);
 const identity:IdentityAccess<RuntimeReadContext>={...f.identity,async authenticate(_ctx,token,kinds){const p=tokens.get(String(token));if(!p)fail('authentication_failed',401,'Authentication failed');if(!kinds.includes(p.kind==='owner'?'owner_session':'runtime'))fail('insufficient_scope',403,'Credential does not permit this action');return p;},async authorizeAgent(ctx,p,agentId){if(p.kind==='agent')return f.identity.authorizeAgent(ctx,p,agentId);const binding=bindings.get(agentId);if(!binding||binding.ownerId!==p.ownerId)fail('target_not_accessible',404,'Target is not accessible');return {agentId,binding:{id:'binding-'+agentId,version:binding.version},authorizationVersion:p.ownerId+':'+agentId+':'+binding.version};}};
 const relationships=createRelationshipsService(identity),interaction=createInteractionService(identity,f.decisions,{onCompletedFeedback:(ctx,fact)=>relationships.recordCompletedFeedback(ctx,fact)});await f.store.transaction(bootstrapInteraction);
 const world=createWorldService(identity),operations=[...relationshipsGatewayOperations(relationships),...interactionGatewayOperations(interaction,identity),...worldGatewayOperations(world)];
 const gateway=createAgentGateway({store:f.store,identity,operations,guides:[relationshipsGatewayGuide,interactionGatewayGuide,worldGatewayGuide]}),app=Fastify(),validator=Fastify();registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now});
 for(const op of gateway.discovery().operations)validator.post('/'+op.id,{schema:{body:gateway.schema(op.id+'.output',String(op.outputSchema.version)).document}},async()=>({ok:true}));
 async function call(subject:string,operation:string,input:JsonObject,commandId?:string){const response=await app.inject({method:'POST',url:commandId?'/v1/gateway/commands':'/v1/gateway/query',headers:{authorization:'Bearer '+subject},payload:{protocolVersion:1,consumerId:'friendship-synthetic',purpose:subject.startsWith('owner-')?'human-inspect':'agent-manual',operation,input,...(commandId?{commandId}:{})}});if(response.statusCode===200)assert.equal((await validator.inject({method:'POST',url:'/'+operation,payload:response.json()})).statusCode,200,operation+' exact output schema');return {status:response.statusCode,data:response.json().data,error:response.json().error};}
 const command=(subject:string,verb:string,input:JsonObject,id=randomUUID())=>call(subject,'relationships.invitation.'+verb,input,id);
 const query=(subject:string,operation:string,input:JsonObject={})=>call(subject,'relationships.'+operation,input);
 const text=(p:Principal,action:string,input:JsonObject,id?:string)=>f.store.transaction(ctx=>interaction.execute(ctx,p,f.key(p,action,id),input));
 async function textInvitation(){const work=await text(a,'interaction.artifact.create',{title:'Synthetic source','body':'Synthetic authored text only'}),invitation=await text(a,'interaction.invitation.send',{worldId:'default',toAgentId:'agent-b',artifact:work.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'Synthetic exchange'});return invitation.result.invitationId as string;}
 async function feedback(invitationId:string){const accepted=await text(b,'interaction.invitation.accept',{invitationId,expectedVersion:1}),activityId=accepted.result.activityId as string;await text(b,'interaction.activity.submit_feedback',{activityId,expectedVersion:1,body:'Synthetic actual reply'});return activityId;}
 return {f,a,b,c,oa,ob,bindings,identity,relationships,interaction,gateway,app,call,query,command,text,textInvitation,feedback,close:async()=>{await app.close();await validator.close();}};
}

test('exact friend and request HTTP schemas expose whole-source search, effective state, totals and scope-bound cursors',async()=>{
 const t=await fixture();try{
  for(const agentId of ['agent-b','agent-c']){const sent=await t.command('owner-a','send',{agentId:'agent-a',toAgentId:agentId});assert.equal(sent.data.outcome,'committed');const accepted=await t.command(agentId==='agent-b'?'owner-b':'owner-a','accept',{agentId,requestId:sent.data.result.request.requestId,expectedVersion:1});assert.equal(accepted.data.outcome,'committed');t.f.now+=10;}
  const first=await t.query('owner-a','friends',{agentId:'agent-a',limit:1,order:'oldest'});assert.equal(first.status,200);assert.equal(first.data.total,2);assert.equal(first.data.complete,false);assert(first.data.nextCursor);
  const second=await t.query('owner-a','friends',{agentId:'agent-a',limit:1,order:'oldest',cursor:first.data.nextCursor});assert.equal(second.status,200);assert.equal(second.data.friends.length,1);assert.notEqual(second.data.friends[0].agentId,first.data.friends[0].agentId);
  const searched=await t.query('owner-a','friends',{agentId:'agent-a',search:second.data.friends[0].agentId,limit:1});assert.equal(searched.status,200);assert.equal(searched.data.total,1);assert.equal(searched.data.friends[0].agentId,second.data.friends[0].agentId);
  assert.equal((await t.query('owner-a','friends',{agentId:'agent-a',limit:1,order:'newest',cursor:first.data.nextCursor})).status,409);
  const accepted=await t.query('owner-a','inbox',{agentId:'agent-a',direction:'sent',state:'accepted',search:'AGENT',order:'newest',limit:1});assert.equal(accepted.status,200);assert.equal(accepted.data.total,2);assert.equal(accepted.data.items[0].state,'accepted');
  const empty=await t.query('owner-a','inbox',{agentId:'agent-a',direction:'sent',state:'pending'});assert.equal(empty.data.total,0);assert.deepEqual(empty.data.items,[]);assert.equal(empty.data.complete,true);
  const discovery=t.gateway.discovery();for(const id of ['relationships.friends','relationships.inbox'])assert.equal(discovery.operations.find(op=>op.id===id)!.inputSchema.version,2);assert.equal(t.gateway.guide('relationships','3').document.version,3);
 }finally{await t.close();}
});

test('independent invitation, direct-source inbox and explicit recipient consent retain the real Owner actor',async()=>{
 const t=await fixture();try{
  const empty=await t.query('owner-a','pair',{agentId:'agent-a',otherAgentId:'agent-b'});assert.deepEqual(empty.data.allowedActions,['relationships.invitation.send']);
  const id=randomUUID(),input={agentId:'agent-a',toAgentId:'agent-b',message:'Synthetic private friendship note 💬'},sent=await t.command('owner-a','send',input,id);assert.equal(sent.status,200);assert.equal(sent.data.outcome,'committed');assert.deepEqual(sent.data.key.principal,{kind:'owner',id:'owner-a'});const requestId=sent.data.result.request.requestId;
  assert.deepEqual((await t.command('owner-a','send',input,id)).data,sent.data);assert.equal(t.f.state.friendshipInvitations.size,1);assert.equal(t.f.state.friendships.size,0);assert.equal(t.f.state.artifacts.size,0);assert.equal(t.f.state.outbox.size,0);
  const source=t.f.state.friendshipInvitations.get(requestId)!;assert.deepEqual(source.sentBy,{kind:'owner',id:'owner-a'});assert.equal(source.deadline-source.createdAt,7*24*60*60*1000);assert(t.f.state.events.every(e=>e.actor.kind==='owner'&&e.actor.id==='owner-a'&&e.source==='owner'));assert(!JSON.stringify(t.f.state.events).includes(input.message),'Event facts do not duplicate the private note');
  const duplicate=await t.command('agent-a','send',{toAgentId:'agent-b',message:'Different new note'});assert.equal(duplicate.data.result.disposition,'existing_request');assert.equal(duplicate.data.result.request.message,input.message);
  const reverse=await t.command('agent-b','send',{toAgentId:'agent-a'});assert.equal(reverse.data.result.disposition,'incoming_request');assert.equal(t.f.state.friendships.size,0);
  const overview=await t.query('agent-b','overview');assert.equal(overview.data.pendingCount,1);const inbox=await t.query('owner-b','inbox',{agentId:'agent-b',direction:'received'}),request=inbox.data.items[0];assert.equal(request.requestId,requestId);assert.equal(request.message,input.message);assert.deepEqual(request.allowedActions,['relationships.invitation.accept','relationships.invitation.decline']);assert(!JSON.stringify(request).includes('owner-a'));assert.equal((await t.query('agent-b','invitation',{requestId})).data.request.notificationId,request.notificationId);
  const before=structuredClone(t.f.state);await t.query('agent-b','inbox',{direction:'received'});await t.query('agent-b','overview');assert.deepEqual(t.f.state,before,'Reading is not consent or a write');
  const accepted=await t.command('owner-b','accept',{agentId:'agent-b',requestId,expectedVersion:1});assert.equal(accepted.data.result.disposition,'accepted');assert.deepEqual(accepted.data.key.principal,{kind:'owner',id:'owner-b'});assert.equal(accepted.data.result.relationship.intimacyScore,0);assert.notEqual([...t.f.state.friendships.values()][0]!.firstConfirmationId,[...t.f.state.friendships.values()][0]!.secondConfirmationId);
  const first=(await t.query('agent-a','friends')).data.friends[0],second=(await t.query('owner-b','friends',{agentId:'agent-b'})).data.friends[0];assert.equal(first.relationshipId,second.relationshipId);assert.equal(first.intimacyScore,second.intimacyScore);assert.equal((await t.query('agent-b','overview')).data.pendingCount,0);assert.deepEqual((await t.query('agent-b','invitation',{requestId})).data.request.allowedActions,[]);
  assert.equal((await t.command('agent-a','send',{toAgentId:'agent-b'})).data.result.disposition,'already_friends');
 }finally{await t.close();}
});

test('selected Agent, current binding, block and sharing guards cover queries, replay, pagination and commands',async()=>{
 const t=await fixture();try{
  const id=randomUUID(),input={agentId:'agent-a',toAgentId:'agent-b',message:'Synthetic guarded source'},sent=await t.command('owner-a','send',input,id),requestId=sent.data.result.request.requestId;
  assert.equal((await t.query('owner-b','inbox',{agentId:'agent-a',direction:'sent'})).status,404);assert.equal((await t.query('owner-a','inbox',{direction:'sent'})).status,400);assert.equal((await t.query('agent-a','friends',{agentId:'agent-b'})).status,404);
  assert.equal((await t.command('owner-a','accept',{agentId:'agent-c',requestId,expectedVersion:1})).status,404);assert.equal((await t.command('owner-a','accept',{agentId:'agent-b',requestId,expectedVersion:1})).status,404);assert.equal(t.f.state.friendships.size,0);
  const page=await t.query('owner-a','inbox',{agentId:'agent-a',direction:'sent',limit:1});
  const second=await t.command('owner-a','send',{agentId:'agent-a',toAgentId:'agent-c'});const bounded=await t.query('owner-a','inbox',{agentId:'agent-a',direction:'sent',limit:1});assert(bounded.data.nextCursor);assert.equal((await t.query('owner-a','inbox',{agentId:'agent-c',direction:'sent',limit:1,cursor:bounded.data.nextCursor})).status,409);
  t.bindings.delete('agent-a');assert.equal((await t.command('owner-a','send',input,id)).status,404);t.bindings.set('agent-a',{ownerId:'owner-a',version:2});assert.equal((await t.query('owner-a','inbox',{agentId:'agent-a',direction:'sent',limit:1,cursor:bounded.data.nextCursor})).status,409);
  await t.text(t.a,'interaction.policy.block',{agentId:'agent-b',expectedVersion:1});assert.equal((await t.command('owner-a','send',input,id)).status,404);assert.equal((await t.query('agent-b','overview')).data.pendingCount,0);assert.deepEqual((await t.query('agent-b','inbox',{direction:'received'})).data.items,[]);assert.equal((await t.query('agent-b','invitation',{requestId})).status,404);
  await t.text(t.a,'interaction.policy.unblock',{agentId:'agent-b',expectedVersion:2});assert.equal((await t.query('agent-b','invitation',{requestId})).status,404,'Unblock does not restore old note access');
  const fresh=await t.command('agent-a','send',{toAgentId:'agent-b'});assert.equal(fresh.data.result.disposition,'created');assert.notEqual(fresh.data.result.request.requestId,requestId);assert.equal(t.f.state.friendshipInvitations.get(requestId)!.invalidationCode,'qualification_changed');assert.deepEqual(t.f.state.friendshipInvitations.get(requestId)!.respondedBy,{kind:'system',id:'relationships-invalidation'});
  t.bindings.set('agent-b',{ownerId:'owner-a',version:2});assert.equal((await t.command('owner-a','accept',{agentId:'agent-a',requestId:fresh.data.result.request.requestId,expectedVersion:1})).data.outcome,'rejected','One Owner controlling both Agents still must explicitly select recipient');assert.equal(t.f.state.friendships.size,0);assert.equal((await t.command('owner-a','accept',{agentId:'agent-b',requestId:fresh.data.result.request.requestId,expectedVersion:1})).data.result.disposition,'accepted');
  assert(page.data.complete);assert(second.data.result.request);
 }finally{await t.close();}
});

test('expiry, explicit cancel/decline, paused actions and source failure are represented without fabricated zero or consent',async()=>{
 const t=await fixture();try{
  assert.equal((await t.command('agent-a','send',{toAgentId:'agent-a'})).data.outcome,'rejected');assert.equal((await t.command('agent-a','send',{toAgentId:'agent-b',message:'💬'.repeat(121)})).status,400);
  const sent=await t.command('agent-a','send',{toAgentId:'agent-b',message:'💬'.repeat(120)}),request=sent.data.result.request;
  t.f.membership('agent-b',{ownerPaused:true});assert.deepEqual((await t.query('agent-b','invitation',{requestId:request.requestId})).data.request.allowedActions,[]);assert.equal((await t.command('agent-b','accept',{requestId:request.requestId,expectedVersion:1})).data.outcome,'rejected');t.f.membership('agent-b',{ownerPaused:false});
  t.f.now=request.deadline;const expired=(await t.query('agent-b','inbox',{direction:'received'})).data.items[0];assert.equal(expired.state,'expired');assert.deepEqual(expired.allowedActions,[]);assert.equal((await t.query('agent-b','overview')).data.pendingCount,0);assert.equal((await t.command('agent-b','accept',{requestId:request.requestId,expectedVersion:1})).data.outcome,'expired');assert.equal(t.f.state.friendships.size,0);
  const fresh=(await t.command('agent-a','send',{toAgentId:'agent-b'})).data.result.request;assert.equal((await t.command('agent-a','cancel',{requestId:fresh.requestId,expectedVersion:1})).data.result.disposition,'cancelled');const next=(await t.command('agent-a','send',{toAgentId:'agent-b'})).data.result.request;assert.equal((await t.command('agent-b','decline',{requestId:next.requestId,expectedVersion:1})).data.result.disposition,'declined');assert.equal((await t.command('agent-b','accept',{requestId:next.requestId,expectedVersion:2})).data.outcome,'conflict');
  t.f.relationships.listInvitations=async()=>{throw new Error('Synthetic source unavailable');};const unknown=await t.query('agent-b','overview');assert.equal(unknown.status,200);assert.equal(unknown.data.status,'unavailable');assert.equal(unknown.data.pendingCount,null);assert.equal((await t.query('agent-b','inbox',{direction:'received'})).status,503);
 }finally{await t.close();}
});

test('only newly initiated and actually confirmed text completion scores once in the same atomic transaction',async()=>{
 const t=await fixture();try{
  const older=await t.textInvitation();t.f.now++;const request=(await t.command('agent-a','send',{toAgentId:'agent-b'})).data.result.request;await t.command('agent-b','accept',{requestId:request.requestId,expectedVersion:1});
  const oldActivity=await t.feedback(older);await t.text(t.a,'interaction.activity.close',{activityId:oldActivity,expectedVersion:2});assert.equal((await t.query('agent-a','friends')).data.friends[0].intimacyScore,0,'Pre-friendship exchanges do not backfill');
  t.f.now++;const invitationId=await t.textInvitation(),activityId=await t.feedback(invitationId);assert.equal((await t.query('agent-a','friends')).data.friends[0].intimacyScore,0,'Reply alone has not completed the source');const id='complete-once-command',closed=await t.text(t.a,'interaction.activity.close',{activityId,expectedVersion:2},id);assert.equal(closed.outcome,'committed');assert.equal((await t.query('agent-b','friends')).data.friends[0].intimacyScore,1);assert.deepEqual(await t.text(t.a,'interaction.activity.close',{activityId,expectedVersion:2},id),closed);assert.equal(t.f.state.intimacyFacts.size,1);assert.equal((await t.query('agent-a','friends')).data.friends[0].intimacyScore,1);
  t.f.now++;const rollbackActivity=await t.feedback(await t.textInvitation()),before=structuredClone(t.f.state);t.f.failAt='intimacy-fact';await assert.rejects(t.text(t.a,'interaction.activity.close',{activityId:rollbackActivity,expectedVersion:2}));t.f.failAt='';assert.deepEqual(t.f.state,before,'Failed scoring rolls back source close and all related writes');
 }finally{await t.close();}
});

test('current Agent capabilities and canonical exact guides discover all independent friendship reads and commands',async()=>{
 const t=await fixture();try{
  const capabilities=t.gateway.capabilities();assert(capabilities.modules.includes('relationships'));const discovery=t.gateway.discovery();assert.equal(discovery.operations.filter(op=>op.moduleId==='relationships').length,9);
  for(const moduleId of ['relationships','interaction','world']){const version=discovery.modules.find(module=>module.moduleId===moduleId)!.usageGuide.version,response=await t.app.inject({method:'GET',url:`/v1/gateway/guides/${moduleId}?version=${version}`});assert.equal(response.statusCode,200);const guide=response.json().data;assert.equal(createHash('sha256').update(guide.canonicalDocument).digest('hex'),guide.digest);assert(!guide.canonicalDocument.includes('当前好友列表只有主人只读入口，没有建立好友命令'));}
  assert.match(JSON.stringify(t.gateway.guide('relationships',String(relationshipsGatewayGuide.version)).document),/closed\/received_confirmed/);
 }finally{await t.close();}
});
