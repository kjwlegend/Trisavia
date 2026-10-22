import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapInteraction,createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {interactionGatewayGuide,interactionGatewayOperations} from '../../apps/platform/application/agent-gateway-interaction.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';
import type {IdentityAccess,Principal} from '../../apps/platform/domains/access/public.ts';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

/** Synthetic private text only. Real user text/credentials and current services are never used. */
async function fixture(){
 const f=coreFixture(),a=f.addAgent('agent-a'),b=f.addAgent('agent-b'),c=f.addAgent('agent-c'),bindings=new Map([['agent-a',{ownerId:'owner-a',version:1}],['agent-c',{ownerId:'owner-a',version:1}],['agent-b',{ownerId:'owner-b',version:1}]]);
 const owner=(id:string):Principal=>({kind:'owner',ownerId:id,ownerAuthVersion:1,source:'owner',credentialId:id,credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:id,expiresAt:null});
 const oa=owner('owner-a'),ob=owner('owner-b'),tokens=new Map([['owner-a',oa],['owner-b',ob],['agent-a',a],['agent-b',b],['agent-c',c]]);
 const identity:IdentityAccess<RuntimeReadContext>={...f.identity,async authenticate(_ctx,token,kinds){const p=tokens.get(String(token));if(!p)fail('authentication_failed',401,'Authentication failed');if(!kinds.includes(p.kind==='owner'?'owner_session':'runtime'))fail('insufficient_scope',403,'Credential does not permit this action');return p;},async authorizeAgent(ctx,p,agentId){if(p.kind==='agent')return await f.identity.authorizeAgent(ctx,p,agentId);const binding=bindings.get(agentId);if(!binding||binding.ownerId!==p.ownerId)fail('target_not_accessible',404,'Target is not accessible');return {agentId,binding:{id:'binding-'+agentId,version:binding.version},authorizationVersion:p.ownerId+':'+agentId+':'+binding.version};}};
 const service=createInteractionService(identity,f.decisions);await f.store.transaction(ctx=>bootstrapInteraction(ctx));
 const gateway=createAgentGateway({store:f.store,identity,operations:interactionGatewayOperations(service,identity),guides:[interactionGatewayGuide]}),app=Fastify(),validator=Fastify();registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now});
 for(const op of gateway.discovery().operations)validator.post('/'+op.id,{schema:{body:gateway.schema(op.id+'.output',String(op.outputSchema.version)).document}},async()=>({ok:true}));
 const query=async(subject:string,operation:string,input:JsonObject)=>{const response=await app.inject({method:'POST',url:'/v1/gateway/query',headers:{authorization:'Bearer '+subject},payload:{protocolVersion:1,consumerId:'owner-text-test',purpose:subject.startsWith('owner-')?'human-inspect':'agent-manual',operation,input}});if(response.statusCode===200)assert.equal((await validator.inject({method:'POST',url:'/'+operation,payload:response.json()})).statusCode,200,operation+' exact output schema');return {status:response.statusCode,data:response.json().data,error:response.json().error};};
 const send=(p:Principal,action:string,input:JsonObject)=>f.store.transaction(ctx=>service.execute(ctx,p,f.key(p,action),input));
 const work=async(title:string,body:string)=>{const receipt=await send(a,'interaction.artifact.create',{title,body});return receipt.result.artifact as {artifactId:string;revision:number};};
 const invite=async(artifact:{artifactId:string;revision:number},toAgentId='agent-b')=>{const receipt=await send(a,'interaction.invitation.send',{worldId:'default',toAgentId,artifact,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'Synthetic invitation explanation'});assert.equal(receipt.outcome,'committed');return receipt.result.invitationId as string;};
 return {f,a,b,c,oa,ob,bindings,service,gateway,app,query,send,work,invite,close:async()=>{await app.close();await validator.close();}};
}

test('Owner and Agent enumerate exact own works; each sent invitation reads fixed text and actual feedback without confirming it',async()=>{
 const t=await fixture();try{
  const ref=await t.work('Sent synthetic work','Original fixed text'),unsent=await t.work('Unsent synthetic work','Unsent private text'),first=await t.invite(ref),second=await t.invite(ref,'agent-c');
  const original=(await t.f.interaction.getArtifact(ref))!;await t.f.interaction.saveArtifact({...original,revision:2,title:'Later revision',body:'Never substitute this later version'},null);
  const accepted=await t.send(t.b,'interaction.invitation.accept',{invitationId:first,expectedVersion:1}),activityId=accepted.result.activityId as string;
  await t.send(t.b,'interaction.activity.submit_feedback',{activityId,expectedVersion:1,body:'Synthetic actual feedback'});
  const before=structuredClone(t.f.state);
  const works=await t.query('owner-a','interaction.owner_artifacts',{agentId:'agent-a'});assert.equal(works.status,200);assert.equal(works.data.items.length,3);assert(works.data.items.some((item:any)=>item.artifact.artifactId===unsent.artifactId));assert(!JSON.stringify(works.data).includes('Unsent private text'));
  const agentWorks=await t.query('agent-a','interaction.artifacts',{});assert.equal(agentWorks.data.items.length,3);assert.equal((await t.query('agent-a','interaction.artifact',{artifact:unsent})).data.body,'Unsent private text');
  const sent=await t.query('owner-a','interaction.owner_exchanges',{agentId:'agent-a',direction:'sent',artifact:ref});assert.equal(sent.status,200);assert.deepEqual(sent.data.items.map((item:any)=>item.invitationId).sort(),[first,second].sort());assert(sent.data.items.every((item:any)=>item.artifact.revision===1));assert.equal(sent.data.items.find((item:any)=>item.invitationId===first).status,'reply_received');
  const detail=await t.query('owner-a','interaction.owner_exchange',{agentId:'agent-a',invitationId:first});assert.equal(detail.data.artifact.body,'Original fixed text');assert.equal(detail.data.artifact.revision,1);assert.equal(detail.data.feedback.body,'Synthetic actual feedback');assert.equal(detail.data.intent,'Synthetic invitation explanation');assert.equal(detail.data.exchange.counterpart.agentId,'agent-b');
  const received=await t.query('owner-b','interaction.owner_exchanges',{agentId:'agent-b',direction:'received'});assert.equal(received.data.items[0].status,'reply_received');assert.equal((await t.query('owner-b','interaction.owner_exchange',{agentId:'agent-b',invitationId:first})).data.feedback.body,'Synthetic actual feedback');
  assert.deepEqual(t.f.state,before,'Owner and Agent observations write no business state, receipt, event or acknowledgement');
  const summary=await t.service.readOwnerSummary(t.f.context,t.oa,'agent-a');assert(!JSON.stringify(summary).includes('Original fixed text'));assert(!JSON.stringify(summary).includes('Synthetic actual feedback'));
  await t.send(t.a,'interaction.activity.close',{activityId,expectedVersion:2});assert.equal((await t.query('owner-a','interaction.owner_exchange',{agentId:'agent-a',invitationId:first})).data.exchange.status,'receipt_confirmed');
  const current=await t.query('agent-a','interaction.current_items',{});assert(current.data.items.some((item:any)=>item.activity?.state==='closed'),'Existing Agent current_items includes completed, currently authorized exchanges');assert.equal((await t.query('agent-a','interaction.invitation',{invitationId:first})).data.artifact.body,'Original fixed text');
 }finally{await t.close();}
});

test('current binding, selected Agent, source revocation and opaque pagination protect every full-text route',async()=>{
 const t=await fixture();try{
  const ref=await t.work('Synthetic private title','Synthetic guarded body'),other=await t.work('Another work','Another body'),id=await t.invite(ref),otherId=await t.invite(other,'agent-c');
  for(const operation of ['interaction.owner_artifacts','interaction.owner_artifact','interaction.owner_exchanges','interaction.owner_exchange']){const input:JsonObject={agentId:'agent-a',...(operation.endsWith('_artifact')?{artifact:ref}:operation.endsWith('_exchanges')?{direction:'sent'}:operation.endsWith('_exchange')?{invitationId:id}:{})};assert.equal((await t.query('owner-b',operation,input)).status,404);assert.equal((await t.query('agent-a',operation,input)).status,403);}
  assert.equal((await t.query('owner-a','interaction.owner_artifact',{agentId:'agent-c',artifact:ref})).status,404,'Same Owner cannot use a sibling Agent to read another author');assert.equal((await t.query('owner-a','interaction.owner_exchange',{agentId:'agent-c',invitationId:id})).status,404,'Same Owner still cannot cross the selected participant');
  const page=await t.query('owner-a','interaction.owner_artifacts',{agentId:'agent-a',limit:1});assert(page.data.nextCursor);assert.equal((await t.query('owner-a','interaction.owner_artifacts',{agentId:'agent-c',limit:1,cursor:page.data.nextCursor})).status,409);
  t.bindings.delete('agent-a');assert.equal((await t.query('owner-a','interaction.owner_artifacts',{agentId:'agent-a',limit:1,cursor:page.data.nextCursor})).status,404);t.bindings.set('agent-a',{ownerId:'owner-a',version:2});assert.equal((await t.query('owner-a','interaction.owner_artifacts',{agentId:'agent-a',limit:1,cursor:page.data.nextCursor})).status,409);
  await t.send(t.a,'interaction.policy.block',{agentId:'agent-b',expectedVersion:1});const list=await t.query('owner-a','interaction.owner_exchanges',{agentId:'agent-a',direction:'sent'});assert.deepEqual(list.data.items.map((item:any)=>item.invitationId),[otherId]);assert(!JSON.stringify(list.data).includes(id));assert.equal((await t.query('owner-a','interaction.owner_exchange',{agentId:'agent-a',invitationId:id})).status,404);
  await t.send(t.a,'interaction.artifact.withdraw',{artifact:other,expectedVersion:1});assert.deepEqual((await t.query('owner-a','interaction.owner_exchanges',{agentId:'agent-a',direction:'sent'})).data.items,[]);assert.equal((await t.query('owner-a','interaction.owner_artifact',{agentId:'agent-a',artifact:other})).data.artifact.body,null);
  t.f.membership('agent-a',{state:'left',sharingGeneration:2});assert.equal((await t.query('owner-a','interaction.owner_artifacts',{agentId:'agent-a'})).status,404);
 }finally{await t.close();}
});

test('expiry suppresses shared body while precise ended state and current exact guide remain discoverable',async()=>{
 const t=await fixture();try{
  const ref=await t.work('Synthetic expiring work','Private expiring source body'),id=await t.invite(ref);t.f.now=t.f.state.invitations.get(id)!.deadline;
  const detail=await t.query('owner-a','interaction.owner_exchange',{agentId:'agent-a',invitationId:id});assert.equal(detail.data.exchange.status,'expired');assert.equal(detail.data.exchange.contentAvailable,false);assert.equal(detail.data.artifact,null);assert.equal(detail.data.intent,null);assert.equal(detail.data.feedback,null);assert(!JSON.stringify(detail.data).includes('Private expiring source body'));
  const guide=(await t.app.inject({method:'GET',url:'/v1/gateway/guides/interaction?version=4'})).json().data;assert.equal(createHash('sha256').update(guide.canonicalDocument).digest('hex'),guide.digest);assert.match(guide.document.textExchangeAndFriendship.instruction,/完成作品→邀请→接受→反馈→确认，也不会自动加入好友名单/);
  const discovery=t.gateway.discovery();for(const id of ['interaction.artifacts','interaction.owner_artifacts','interaction.owner_artifact','interaction.owner_exchanges','interaction.owner_exchange'])assert(discovery.operations.some(op=>op.id===id));
 }finally{await t.close();}
});
