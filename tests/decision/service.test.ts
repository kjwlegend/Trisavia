import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {gatewayFixture} from '../gateway/postgresql-fixture.ts';
import {createDecisionService} from '../../apps/platform/application/decision-service.ts';
import {createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {decisionRepository} from '../../apps/platform/domains/decision/repository.ts';
import {membershipRepository} from '../../apps/platform/domains/access/repository.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';
const data=(value:unknown)=>value as Record<string,any>;
async function setup(){
 const f=await gatewayFixture();
 let interaction:ReturnType<typeof createInteractionService>;
 const decision=createDecisionService({identity:f.access,target:{inspect:(...args)=>interaction.decisionTarget.inspect(...args),execute:(...args)=>interaction.decisionTarget.execute(...args)}});
 interaction=createInteractionService(f.access,decision.sink);
 const a=await f.register(),b=await f.register();
 const act=async(who:typeof a,action:string,input:JsonObject,commandId=randomUUID())=>await f.runtime.transaction(async ctx=>{const p=await f.access.authenticate(ctx,who.runtimeToken,['runtime']);return interaction.execute(ctx,p,{domain:'interaction',action,commandId,principal:{kind:'agent',id:who.agentId},recoveryEpoch:ctx.recoveryEpoch},input);});
 const list=async(who:typeof a,input:JsonObject={})=>await f.runtime.read(async ctx=>decision.query(ctx,await f.access.authenticate(ctx,who.runtimeToken,['runtime']),input));
 const claim=async(who:typeof a,input:JsonObject,commandId=randomUUID())=>await f.runtime.transaction(async ctx=>decision.claim(ctx,await f.access.authenticate(ctx,who.runtimeToken,['runtime']),commandId,input));
 const respond=async(who:typeof a,input:JsonObject,commandId=randomUUID())=>await f.runtime.transaction(async ctx=>decision.respond(ctx,await f.access.authenticate(ctx,who.runtimeToken,['runtime']),commandId,input));
 const artifact=await act(a,'interaction.artifact.create',{title:'Private test work',body:'Immutable isolated text; never public.'});
 const invitation=await act(a,'interaction.invitation.send',{worldId:'default',toAgentId:b.agentId,artifact:artifact.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'Please give text feedback.'});
 return {...f,a,b,decision,interaction,act,list,claim,respond,invitation};
}
test('three manual Decision stages bind actual domain receipts and preserve an unbound Agent identity',async()=>{
 const f=await setup();try{
  const first=data(data(await f.list(f.b)).records[0]);assert.equal(first.stage,'invitation_response');assert.equal(first.budget.ownerBudgetRequired,false);
  const claimInput={decisionId:first.decisionId,expectedVersion:first.version},claimId=randomUUID(),claimed=await f.claim(f.b,claimInput,claimId);
  assert.equal(claimed.outcome,'committed');assert.deepEqual(await f.claim(f.b,claimInput,claimId),claimed);
  const acceptInput={decisionId:first.decisionId,expectedVersion:claimed.result.version!,claimId:claimed.result.claimId!,action:'interaction.invitation.accept'},respondId=randomUUID();
  const accepted=await f.respond(f.b,acceptInput,respondId);assert.equal(accepted.result.businessSucceeded,true);assert.equal(data(accepted.result.resolution).outcome,'committed');assert.deepEqual(await f.respond(f.b,acceptInput,respondId),accepted);
  const feedback=data(data(await f.list(f.b)).records.find((row:any)=>row.stage==='feedback'));assert(feedback);const feedbackClaim=await f.claim(f.b,{decisionId:feedback.decisionId,expectedVersion:feedback.version});
  const submitted=await f.respond(f.b,{decisionId:feedback.decisionId,expectedVersion:feedbackClaim.result.version!,claimId:feedbackClaim.result.claimId!,action:'interaction.activity.submit_feedback',input:{body:'A considered external-host response.'}});assert.equal(submitted.result.businessSucceeded,true);
  const ack=data(data(await f.list(f.a)).records[0]);assert.equal(ack.stage,'acknowledgement');const ackClaim=await f.claim(f.a,{decisionId:ack.decisionId,expectedVersion:ack.version});
  const closed=await f.respond(f.a,{decisionId:ack.decisionId,expectedVersion:ackClaim.result.version!,claimId:ackClaim.result.claimId!,action:'interaction.activity.close'});assert.equal(data(data(closed.result.resolution).result).outcome,'received_confirmed');
  const stored=await f.runtime.read(ctx=>ctx.repository(decisionRepository).get(first.decisionId));assert.equal(stored?.status,'resolved');assert.equal(stored?.invalidation,null);
  assert(!JSON.stringify(stored).includes('Immutable isolated'));assert(!JSON.stringify(stored).includes('considered external-host'));
  await f.runtime.read(async ctx=>{const p=await f.access.authenticate(ctx,f.b.runtimeToken,['runtime']);await f.decision.authorizeReceipt(ctx,p,accepted);});
 }finally{await f.dispose();}
});
test('no_action consumes one bounded dispatch but changes no invitation and never redispatches the same reason',async()=>{
 const f=await setup();try{
  const first=data(data(await f.list(f.b)).records[0]),claimed=await f.claim(f.b,{decisionId:first.decisionId,expectedVersion:first.version});
  const resolved=await f.respond(f.b,{decisionId:first.decisionId,expectedVersion:claimed.result.version!,claimId:claimed.result.claimId!,action:'no_action'});
  assert.equal(resolved.result.businessSucceeded,false);assert.equal(data(resolved.result.resolution).outcome,'no_action');assert.equal(data(data(resolved.result.resolution).result).businessStateChanged,false);
  await f.runtime.transaction(async ctx=>{const row=(await ctx.repository(decisionRepository).get(first.decisionId))!;const original=await f.decision.sink.ensure(ctx,row,{actor:{kind:'agent',id:f.a.agentId},source:'external_agent',commandId:'same-original-reason',correlationId:'same-original-reason'});assert.equal(original.decisionId,row.id);});
  const view=await f.runtime.read(async ctx=>f.interaction.readInvitation(ctx,await f.access.authenticate(ctx,f.b.runtimeToken,['runtime']),String(f.invitation.result.invitationId)));assert.equal(data(view).state,'pending');
  assert.equal(data(await f.list(f.b)).records.length,1);
 }finally{await f.dispose();}
});
test('unknown host execution retains its original claim and budget until explicit reconciliation',async()=>{
 const f=await setup();try{
  const first=data(data(await f.list(f.b)).records[0]),claimed=await f.claim(f.b,{decisionId:first.decisionId,expectedVersion:first.version});
  const unknown=await f.respond(f.b,{decisionId:first.decisionId,expectedVersion:claimed.result.version!,claimId:claimed.result.claimId!,executionId:'external-execution-original',executionOutcome:'unknown'});
  assert.equal(unknown.result.status,'responded');const observed=data(data(await f.list(f.b)).records[0]);assert.equal(observed.nextAction,'query_original_execution');assert.equal(observed.canReconcile,true);assert.equal(observed.actionable,false);
  const wrong=await f.respond(f.b,{decisionId:first.decisionId,expectedVersion:unknown.result.version!,claimId:claimed.result.claimId!,executionId:'different-execution',executionOutcome:'completed',action:'no_action'});assert.equal(wrong.outcome,'conflict');
  const reconciled=await f.respond(f.b,{decisionId:first.decisionId,expectedVersion:unknown.result.version!,claimId:claimed.result.claimId!,executionId:'external-execution-original',executionOutcome:'completed',action:'no_action'});assert.equal(reconciled.result.status,'resolved');
  const row=await f.runtime.read(ctx=>ctx.repository(decisionRepository).get(first.decisionId));assert(row?.claim);assert(await f.runtime.read(ctx=>ctx.repository(decisionRepository).reservation(row.claim!.reservationId)));
 }finally{await f.dispose();}
});
test('pause and resume invalidate an old claim without permanently cancelling a still visible business invitation',async()=>{
 const f=await setup();try{
  const first=data(data(await f.list(f.b)).records[0]),claimed=await f.claim(f.b,{decisionId:first.decisionId,expectedVersion:first.version});
  for(const paused of [true,false])await f.legacy.transaction(async tx=>{const repo=membershipRepository(tx),row=(await repo.get(f.b.agentId))!;await repo.replace({...row,version:row.version+1,data:{...row.data,ownerPaused:paused,ownerPauseVersion:Number(row.data.ownerPauseVersion)+1}},row.version);});
  const view=data(data(await f.list(f.b)).records[0]);assert.equal(view.status,'cancelled');assert.equal(view.claimId,null);
  const rejected=await f.respond(f.b,{decisionId:first.decisionId,expectedVersion:claimed.result.version!,claimId:claimed.result.claimId!,action:'interaction.invitation.accept'});assert.equal(rejected.outcome,'conflict');assert.equal(data(rejected.result.error).code,'decision_scope_changed');
  const invitation=await f.runtime.read(async ctx=>f.interaction.readInvitation(ctx,await f.access.authenticate(ctx,f.b.runtimeToken,['runtime']),String(f.invitation.result.invitationId)));assert.equal(data(invitation).state,'pending');
 }finally{await f.dispose();}
});
