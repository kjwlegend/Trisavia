import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapInteraction, createInteractionService } from '../../apps/platform/application/interaction-service.ts';
import type { JsonObject } from '../../apps/platform/contracts/store.ts';
import type { Principal } from '../../apps/platform/domains/access/public.ts';
import type { DecisionRequest } from '../../apps/platform/domains/decision/repository.ts';
import { coreFixture } from '../world/runtime-fixture.ts';

async function fixture() {
  const f=coreFixture(),a=f.addAgent('agent-a'),b=f.addAgent('agent-b'),c=f.addAgent('agent-c'),service=createInteractionService(f.identity,f.decisions);await f.store.transaction(ctx=>bootstrapInteraction(ctx));
  const send=(p:Principal,action:string,input:JsonObject,id?:string)=>f.store.transaction(ctx=>service.execute(ctx,p,f.key(p,action,id),input));
  const artifact=await send(a,'interaction.artifact.create',{title:'固定标题',body:'仅双方授权读取的独有正文🔒'}),ref=artifact.result.artifact!;
  async function invite(id?:string){return send(a,'interaction.invitation.send',{worldId:'default',toAgentId:'agent-b',artifact:ref,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'请给明确反馈'},id);}
  return {f,a,b,c,service,send,artifact,ref,invite};
}
function decision(f:ReturnType<typeof coreFixture>,stage:string):DecisionRequest {
  const intent=[...f.state.decisions.values()].find(x=>x.stage===stage)!;return {...structuredClone(intent),id:'d-'+stage,version:1,recoveryEpoch:f.context.recoveryEpoch,createdAt:f.now,status:'pending',claim:null,response:null,resolution:null,invalidation:null};
}
test('three explicit stages create one activity/contribution and shared facts; replay/unknown recovery cannot repeat transitions',async()=>{
  const {f,a,b,c,service,send,invite}=await fixture(),inv=await invite('send-once'),invitationId=inv.result.invitationId as string,request=decision(f,'invitation_response');
  assert.equal((await service.inspect(f.context,b,request))?.actionable,true);assert.equal(f.state.activities.size,0);
  await assert.rejects(service.readInvitation(f.context,c,invitationId),{code:'target_not_accessible'});
  const acceptKey=f.key(b,'interaction.invitation.accept','accept-once'),input={invitationId,expectedVersion:1};
  const accepted=await f.store.transaction(ctx=>service.execute(ctx,b,acceptKey,input));assert.equal(accepted.outcome,'committed');assert.equal(f.state.activities.size,1);assert.deepEqual(await f.store.transaction(ctx=>service.execute(ctx,b,acceptKey,input)),accepted);
  assert.equal((await service.inspect(f.context,b,request))?.actionable,false); // Still authorized to recover its historical resolution.
  const activityId=accepted.result.activityId as string, feedbackRequest=decision(f,'feedback');assert.equal(feedbackRequest.target.id,activityId);
  const submitted=await send(b,'interaction.activity.submit_feedback',{activityId,expectedVersion:1,body:'明确反馈正文🔑'});assert.equal(submitted.result.state,'waiting_ack');assert.equal(f.state.feedback.size,1);
  assert.equal((await send(b,'interaction.activity.close',{activityId,expectedVersion:2})).outcome,'rejected');
  const closed=await send(a,'interaction.activity.close',{activityId,expectedVersion:2});assert.equal(closed.result.outcome,'received_confirmed');assert.equal(f.state.decisions.size,0);
  assert.equal((await service.readActivity(f.context,a,activityId)).feedback?.body,'明确反馈正文🔑');await service.authorizeReceipt(f.context,b,accepted);
  const serialized=JSON.stringify({events:f.state.events,receipts:[...f.state.receipts.values()],outbox:[...f.state.outbox.values()],tasks:[...f.state.tasks.values()]});assert.equal(serialized.includes('独有正文'),false);assert.equal(serialized.includes('反馈正文'),false);assert.equal(serialized.includes('请给明确反馈'),false);
});
test('exact expiry boundary, rejection/no activity, and same command conflict are durable without extending frozen windows',async()=>{
  const {f,a,b,send,invite}=await fixture(),inv=await invite(),id=inv.result.invitationId as string;f.now=inv.result.deadline as number;
  const late=await send(b,'interaction.invitation.accept',{invitationId:id,expectedVersion:1},'late');assert.equal(late.outcome,'expired');assert.equal(f.state.activities.size,0);f.now--;
  assert.deepEqual(await send(b,'interaction.invitation.accept',{invitationId:id,expectedVersion:1},'late'),late);
  await assert.rejects(send(b,'interaction.invitation.accept',{invitationId:id,expectedVersion:2},'late'),{code:'command_conflict'});
  const declined=await send(b,'interaction.invitation.decline',{invitationId:id,expectedVersion:1,reason:'此时不参与'});assert.equal(declined.result.state,'declined');assert.equal(f.state.activities.size,0);
  assert.equal((await send(a,'interaction.invitation.withdraw',{invitationId:id,expectedVersion:2})).outcome,'conflict');
});
test('block wins before/after accept, blocks old receipt and Decision reads, and unblock cannot restore prior sharing',async()=>{
  const {f,a,b,service,send,invite}=await fixture(),inv=await invite(),invitationId=inv.result.invitationId as string,request=decision(f,'invitation_response');
  await send(b,'interaction.policy.block',{agentId:'agent-a',expectedVersion:1});await assert.rejects(send(b,'interaction.invitation.accept',{invitationId,expectedVersion:1}),{code:'target_not_accessible'});
  await assert.rejects(service.authorizeReceipt(f.context,a,inv),{code:'target_not_accessible'});assert.equal(await service.inspect(f.context,b,request),null);
  await send(b,'interaction.policy.unblock',{agentId:'agent-a',expectedVersion:2});await assert.rejects(service.readInvitation(f.context,b,invitationId),{code:'target_not_accessible'});
  const fresh=await invite();const accepted=await send(b,'interaction.invitation.accept',{invitationId:fresh.result.invitationId!,expectedVersion:1});assert.equal(accepted.outcome,'committed');
  await send(a,'interaction.policy.block',{agentId:'agent-b',expectedVersion:3});await assert.rejects(service.readActivity(f.context,b,accepted.result.activityId as string),{code:'target_not_accessible'});assert.equal(f.state.invitations.get(fresh.result.invitationId as string)!.state,'accepted');
});
test('leave/rejoin sharing generation revokes old text permanently; pause only temporarily affects stage actions',async()=>{
  const {f,a,b,service,send,invite}=await fixture(),inv=await invite(),invitationId=inv.result.invitationId as string,request=decision(f,'invitation_response');
  f.membership('agent-b',{ownerPaused:true,ownerPauseVersion:2});assert.equal((await service.inspect(f.context,b,request))?.actionable,false);
  assert.equal((await send(b,'interaction.invitation.accept',{invitationId,expectedVersion:1})).result.code,'participation_paused');
  f.membership('agent-b',{ownerPaused:false,ownerPauseVersion:3});assert.equal((await service.inspect(f.context,b,request))?.actionable,true);
  // M1 facade separately tests that only actual leave increments this generation; here C consumes that public fact.
  f.membership('agent-b',{sharingGeneration:2,state:'joined'});
  await assert.rejects(service.readInvitation(f.context,a,invitationId),{code:'target_not_accessible'});assert.equal(await service.inspect(f.context,b,request),null);
  assert.equal((await invite()).outcome,'committed');assert.equal(f.state.invitations.size,2);
});
test('withdrawn artifact/feedback cannot leak through detail, historical receipt, owner summary or acknowledgement',async()=>{
  const {f,a,b,service,send,artifact,invite}=await fixture(),inv=await invite(),invitationId=inv.result.invitationId as string,accepted=await send(b,'interaction.invitation.accept',{invitationId,expectedVersion:1}),activityId=accepted.result.activityId as string;
  const submitted=await send(b,'interaction.activity.submit_feedback',{activityId,expectedVersion:1,body:'撤回后不可重读的反馈'});const feedbackId=submitted.result.feedbackId as string;
  await send(b,'interaction.feedback.withdraw',{feedbackId,expectedVersion:1});assert.equal((await service.readActivity(f.context,a,activityId)).feedback,null);await assert.rejects(send(a,'interaction.activity.close',{activityId,expectedVersion:2}),{code:'target_not_accessible'});
  await assert.rejects(service.authorizeReceipt(f.context,b,submitted),{code:'target_not_accessible'});
  const owner:Principal={kind:'owner',ownerId:'owner-agent-a',ownerAuthVersion:1,source:'owner',credentialId:'owner',credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:'owner',expiresAt:null};
  const summary=await service.readOwnerSummary(f.context,owner,'agent-a');assert.equal(JSON.stringify(summary).includes('撤回后'),false);assert.equal(JSON.stringify(summary).includes('独有正文'),false);
  await send(a,'interaction.artifact.withdraw',{artifact:artifact.result.artifact!,expectedVersion:1});await assert.rejects(service.readInvitation(f.context,b,invitationId),{code:'target_not_accessible'});
});
test('accept atomically rolls back invitation, unique activity, next Decision, event, outbox, tasks and receipt on storage failure',async()=>{
  for(const at of ['activity','decision','task','event','outbox','receipt']) {
    const {f,b,send,invite}=await fixture(),inv=await invite(),before=structuredClone(f.state);f.failAt=at;
    await assert.rejects(send(b,'interaction.invitation.accept',{invitationId:inv.result.invitationId!,expectedVersion:1}),/injected storage failure/);
    assert.deepEqual(f.state,before,'partial acceptance at '+at);
  }
});
test('expiry worker revalidates current lease fencing and target version; late duplicate jobs cannot revive an expired activity',async()=>{
  const {f,a,b,service,send,invite}=await fixture(),inv=await invite(),invitationId=inv.result.invitationId as string,accepted=await send(b,'interaction.invitation.accept',{invitationId,expectedVersion:1}),activityId=accepted.result.activityId as string;
  const activity=f.state.activities.get(activityId)!;f.now=activity.feedbackDeadline;
  const first=(await f.context.tasks.claimDue({now:f.now,workerId:'old',leaseMs:5,limit:10,kinds:['interaction.activity.expire']}))[0]!.lease!;
  f.now+=5;const second=(await f.context.tasks.claimDue({now:f.now,workerId:'new',leaseMs:100,limit:10,kinds:['interaction.activity.expire']}))[0]!.lease!;
  await assert.rejects(f.store.transaction(ctx=>service.handleTask(ctx,{...f.state.tasks.get(first.id)!,lease:first})),{code:'lease_lost'});assert.equal(f.state.activities.get(activityId)!.state,'waiting_feedback');
  await f.store.transaction(async ctx=>{await service.handleTask(ctx,{...f.state.tasks.get(second.id)!,lease:second});await ctx.tasks.complete(second,ctx.now());});assert.equal(f.state.activities.get(activityId)!.state,'expired');assert.equal(f.state.activities.get(activityId)!.outcome,'no_feedback');assert.equal(f.state.invitations.get(invitationId)!.state,'accepted');
  assert.equal((await send(a,'interaction.activity.leave',{activityId,expectedVersion:2})).outcome,'conflict'); // Explicit terminal rejection; no revival.
  assert.equal(f.state.activities.get(activityId)!.state,'expired');
});
