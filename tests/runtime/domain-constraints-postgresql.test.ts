import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { worldFixture } from './postgresql-fixture.ts';
import { bootstrapWorld } from '../../apps/platform/application/world-service.ts';
import { bootstrapInteraction, createInteractionService } from '../../apps/platform/application/interaction-service.ts';
import { createDecisionService } from '../../apps/platform/application/decision-service.ts';
import { decisionRepository } from '../../apps/platform/domains/decision/repository.ts';
import { INTERACTION_REPOSITORY } from '../../apps/platform/domains/interaction/repository.ts';
import type { JsonObject } from '../../apps/platform/contracts/store.ts';
const code=(value:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===value);
const data=(value:unknown)=>value as Record<string,any>;
async function setup(policy?:{version:number;agentDailyLimit:number;platformDailyLimit:number;maxListSize:number}){
 const f=await worldFixture();try{
  await f.runtime.transaction(async ctx=>{await bootstrapWorld(ctx);await bootstrapInteraction(ctx);await ctx.tasks.advanceGeneration('decision',0);});
  const a=await f.register(),b=await f.register();
  for(const who of [a,b]){const metadata=await f.legacy.read(async tx=>({member:(await tx.find('memberships',{agentId:who.agentId}))[0]!,profile:(await tx.find('profiles',{agentId:who.agentId}))[0]!}));await f.service.invoke('join',{operationId:randomUUID(),agentId:who.agentId,expectedVersion:metadata.member.version,expectedProfileVersion:metadata.profile.version},who.runtimeToken);}
  let interaction:ReturnType<typeof createInteractionService>;const decision=createDecisionService({identity:f.access,target:{inspect:(...args)=>interaction.decisionTarget.inspect(...args),execute:(...args)=>interaction.decisionTarget.execute(...args)},...(policy?{policy}:{})});interaction=createInteractionService(f.access,decision.sink);
  const act=async(who:typeof a,action:string,input:JsonObject,commandId=randomUUID())=>f.runtime.transaction(async ctx=>interaction.execute(ctx,await f.access.authenticate(ctx,who.runtimeToken,['runtime']),{domain:'interaction',action,commandId,principal:{kind:'agent',id:who.agentId},recoveryEpoch:ctx.recoveryEpoch},input));
  const list=async(who:typeof a)=>data(await f.runtime.read(async ctx=>decision.query(ctx,await f.access.authenticate(ctx,who.runtimeToken,['runtime']),{}))).records as Record<string,any>[];
  const claim=async(who:typeof a,input:JsonObject,commandId=randomUUID())=>f.runtime.transaction(async ctx=>decision.claim(ctx,await f.access.authenticate(ctx,who.runtimeToken,['runtime']),commandId,input));
  const respond=async(who:typeof a,input:JsonObject,commandId=randomUUID())=>f.runtime.transaction(async ctx=>decision.respond(ctx,await f.access.authenticate(ctx,who.runtimeToken,['runtime']),commandId,input));
  async function invite(){const artifact=await act(a,'interaction.artifact.create',{title:'Fixed synthetic title',body:'PRIVATE_ARTIFACT_SENTINEL'});const invitation=await act(a,'interaction.invitation.send',{worldId:'default',toAgentId:b.agentId,artifact:artifact.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'PRIVATE_INTENT_SENTINEL'});return {artifact,invitation};}
  return {...f,a,b,interaction,decision,act,list,claim,respond,invite};
 }catch(error){await f.dispose();throw error;}
}
test('real three-stage Decision and Interaction share one transaction and references without copying private text into facts/receipts/work',async t=>{
 const f=await setup();t.after(f.dispose);const {invitation,artifact}=await f.invite(),first=(await f.list(f.b)).find(row=>row.stage==='invitation_response')!;
 const claimed=await f.claim(f.b,{decisionId:first.decisionId,expectedVersion:first.version});const accepted=await f.respond(f.b,{decisionId:first.decisionId,expectedVersion:claimed.result.version!,claimId:claimed.result.claimId!,action:'interaction.invitation.accept'});assert.equal(accepted.result.businessSucceeded,true);
 const feedback=(await f.list(f.b)).find(row=>row.stage==='feedback')!,feedbackClaim=await f.claim(f.b,{decisionId:feedback.decisionId,expectedVersion:feedback.version});const submitted=await f.respond(f.b,{decisionId:feedback.decisionId,expectedVersion:feedbackClaim.result.version!,claimId:feedbackClaim.result.claimId!,action:'interaction.activity.submit_feedback',input:{body:'PRIVATE_FEEDBACK_SENTINEL'}});assert.equal(submitted.result.businessSucceeded,true);
 const ack=(await f.list(f.a)).find(row=>row.stage==='acknowledgement')!,ackClaim=await f.claim(f.a,{decisionId:ack.decisionId,expectedVersion:ack.version});const closed=await f.respond(f.a,{decisionId:ack.decisionId,expectedVersion:ackClaim.result.version!,claimId:ackClaim.result.claimId!,action:'interaction.activity.close'});assert.equal(data(data(closed.result.resolution).result).outcome,'received_confirmed');
 const counts=await f.appQuery('SELECT (SELECT count(*) FROM interaction.activities)::integer AS activities,(SELECT count(*) FROM interaction.feedback_contributions)::integer AS feedback,(SELECT count(*) FROM decision.requests)::integer AS decisions,(SELECT count(*) FROM decision.dispatch_reservations)::integer AS reservations');assert.deepEqual(counts[0],{activities:1,feedback:1,decisions:3,reservations:3});
 const internal=JSON.stringify(await f.appQuery("SELECT row_to_json(t) AS value FROM runtime.events t UNION ALL SELECT row_to_json(t) FROM runtime.command_receipts t UNION ALL SELECT row_to_json(t) FROM runtime.tasks t UNION ALL SELECT row_to_json(t) FROM runtime.outbox t UNION ALL SELECT row_to_json(t) FROM decision.requests t"));for(const privateText of ['PRIVATE_ARTIFACT_SENTINEL','PRIVATE_INTENT_SENTINEL','PRIVATE_FEEDBACK_SENTINEL'])assert.equal(internal.includes(privateText),false);
 await assert.rejects(f.appQuery("UPDATE interaction.artifact_revisions SET body='rewritten' WHERE artifact_id=$1",[data(artifact.result.artifact).artifactId]),code('23514'));await assert.rejects(f.appQuery("UPDATE interaction.feedback_contributions SET body='rewritten'"),code('23514'));
 await assert.rejects(f.appQuery("UPDATE interaction.activities SET state='waiting_feedback'"),code('23514'));
 assert.equal((await f.runtime.read(ctx=>ctx.repository(INTERACTION_REPOSITORY).getInvitation(invitation.result.invitationId as string)))?.state,'accepted');
});
test('a later Decision SQL failure rolls back invitation/activity/event/outbox/expiry task and original receipt together',async t=>{
 const f=await setup();t.after(f.dispose);const {invitation}=await f.invite();
 const before=await f.appQuery('SELECT (SELECT count(*) FROM runtime.events)::integer AS events,(SELECT count(*) FROM runtime.command_receipts)::integer AS receipts,(SELECT count(*) FROM runtime.tasks)::integer AS tasks,(SELECT count(*) FROM runtime.outbox)::integer AS outbox,(SELECT count(*) FROM decision.requests)::integer AS decisions');
 await f.query("CREATE FUNCTION decision.test_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stage='feedback' THEN RAISE EXCEPTION 'isolated later-domain failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_late_failure BEFORE INSERT ON decision.requests FOR EACH ROW EXECUTE FUNCTION decision.test_late_failure();");
 const original=randomUUID(),input={invitationId:invitation.result.invitationId!,expectedVersion:1};await assert.rejects(f.act(f.b,'interaction.invitation.accept',input,original));
 assert.deepEqual(await f.appQuery('SELECT (SELECT count(*) FROM runtime.events)::integer AS events,(SELECT count(*) FROM runtime.command_receipts)::integer AS receipts,(SELECT count(*) FROM runtime.tasks)::integer AS tasks,(SELECT count(*) FROM runtime.outbox)::integer AS outbox,(SELECT count(*) FROM decision.requests)::integer AS decisions'),before);
 const state=await f.runtime.read(async ctx=>({invitation:(await ctx.repository(INTERACTION_REPOSITORY).getInvitation(input.invitationId as string))!,activity:await ctx.repository(INTERACTION_REPOSITORY).getActivityByInvitation(input.invitationId as string)}));assert.equal(state.invitation.state,'pending');assert.equal(state.invitation.version,1);assert.equal(state.activity,undefined);
 await f.query('DROP TRIGGER test_late_failure ON decision.requests');assert.equal((await f.act(f.b,'interaction.invitation.accept',input,original)).outcome,'committed');
});
test('membership leave/rejoin invalidates old shared text while allowing a fresh invite with the same artifact/pair generation',async t=>{
 const f=await setup();t.after(f.dispose);const {artifact,invitation}=await f.invite();
 const member=await f.legacy.read(async tx=>(await tx.find('memberships',{agentId:f.b.agentId}))[0]!);await f.service.invoke('leave',{operationId:randomUUID(),agentId:f.b.agentId,expectedVersion:member.version},f.b.runtimeToken);
 const latest=await f.legacy.read(async tx=>({member:(await tx.find('memberships',{agentId:f.b.agentId}))[0]!,profile:(await tx.find('profiles',{agentId:f.b.agentId}))[0]!}));await f.service.invoke('join',{operationId:randomUUID(),agentId:f.b.agentId,expectedVersion:latest.member.version,expectedProfileVersion:latest.profile.version},f.b.runtimeToken);
 await assert.rejects(f.runtime.read(async ctx=>f.interaction.readInvitation(ctx,await f.access.authenticate(ctx,f.b.runtimeToken,['runtime']),invitation.result.invitationId as string)),code('target_not_accessible'));
 const fresh=await f.act(f.a,'interaction.invitation.send',{worldId:'default',toAgentId:f.b.agentId,artifact:artifact.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'new sharing grant'});assert.equal(fresh.outcome,'committed');
 const rows=await f.appQuery('SELECT shared_generation,from_sharing_generation,to_sharing_generation FROM interaction.invitations ORDER BY to_sharing_generation');assert.equal(rows.length,2);assert.equal(rows[0]!.shared_generation,rows[1]!.shared_generation);assert.equal(Number(rows[1]!.to_sharing_generation),Number(rows[0]!.to_sharing_generation)+1);
});
test('concurrent bounded dispatch reservations count only success and keep unknown execution allocated without an Owner budget',async t=>{
 const f=await setup({version:1,agentDailyLimit:1,platformDailyLimit:1,maxListSize:50});t.after(f.dispose);await f.invite();await f.invite();const requests=(await f.list(f.b)).filter(row=>row.stage==='invitation_response');assert.equal(requests.length,2);
 const commands=requests.map(()=>randomUUID()),results=await Promise.all(requests.map((row,index)=>f.claim(f.b,{decisionId:row.decisionId,expectedVersion:row.version},commands[index]!)));assert.equal(results.filter(row=>row.outcome==='committed').length,1);assert.equal(results.filter(row=>row.outcome==='rejected').length,1);
 const index=results.findIndex(row=>row.outcome==='committed'),claimed=results[index]!,original=requests[index]!;assert.deepEqual(await f.claim(f.b,{decisionId:original.decisionId,expectedVersion:original.version},commands[index]!),claimed);
 const unknown=await f.respond(f.b,{decisionId:original.decisionId,expectedVersion:claimed.result.version!,claimId:claimed.result.claimId!,executionId:'external-original',executionOutcome:'unknown'});assert.equal(unknown.result.status,'responded');
 assert.equal((await f.appQuery('SELECT count(*)::integer AS total FROM decision.dispatch_reservations'))[0]!.total,1);assert.deepEqual((await f.appQuery('SELECT scope,used FROM decision.dispatch_counters ORDER BY scope')).map(row=>({scope:row.scope,used:row.used})),[{scope:'agent',used:1},{scope:'platform',used:1}]);
 const stored=await f.runtime.read(ctx=>ctx.repository(decisionRepository).get(original.decisionId));assert.equal(stored?.status,'responded');assert.equal(stored?.resolution,null);assert.equal(stored?.response?.executionOutcome,'unknown');
});
test('database relations reject linking an invitation or activity to another otherwise valid activity or feedback',async t=>{
 const f=await setup();t.after(f.dispose);const first=await f.invite(),second=await f.invite();
 const a=await f.act(f.b,'interaction.invitation.accept',{invitationId:first.invitation.result.invitationId!,expectedVersion:1}),b=await f.act(f.b,'interaction.invitation.accept',{invitationId:second.invitation.result.invitationId!,expectedVersion:1});assert.equal(a.outcome,'committed');assert.equal(b.outcome,'committed');
 await assert.rejects(f.appQuery('UPDATE interaction.invitations SET activity_id=$2 WHERE id=$1',[first.invitation.result.invitationId,b.result.activityId]),code('23503'));
 const one=await f.act(f.b,'interaction.activity.submit_feedback',{activityId:a.result.activityId!,expectedVersion:1,body:'first activity only'}),two=await f.act(f.b,'interaction.activity.submit_feedback',{activityId:b.result.activityId!,expectedVersion:1,body:'second activity only'});assert.equal(one.outcome,'committed');assert.equal(two.outcome,'committed');
 await assert.rejects(f.appQuery('UPDATE interaction.activities SET feedback_id=$2 WHERE id=$1',[a.result.activityId,two.result.feedbackId]),code('23503'));
});
