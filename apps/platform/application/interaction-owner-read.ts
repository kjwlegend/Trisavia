import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {fail,M1Error,object} from '../domains/common/errors.ts';
import {INTERACTION_REPOSITORY} from '../domains/interaction/repository.ts';
import {artifactReference,identifier,invitationExpired,activityExpired} from '../domains/interaction/rules.ts';
import type {ArtifactRef,ArtifactRevision,FeedbackActivity,InteractionInvitation} from '../domains/interaction/types.ts';
import {hashRuntimeRequest} from '../domains/runtime/command.ts';
import {createGatewayContinuation} from './agent-gateway-continuation.ts';

type Bundle={invitation:InteractionInvitation;artifact:ArtifactRevision;activity:FeedbackActivity|undefined};
/** Current bound Owner permission, separate from fact-summary and mailbox sources. */
export function createInteractionOwnerReader(identity:IdentityAccess<RuntimeReadContext>,source:{bundle:(ctx:RuntimeReadContext,agentId:string,invitationId:string)=>Promise<Bundle>;participant:(ctx:RuntimeReadContext,agentId:string)=>Promise<unknown>}){
 const cursors=createGatewayContinuation(512);
 async function owner(ctx:RuntimeReadContext,p:Principal,agentId:string,query:string,limit=50,target=agentId,actorKind:'owner'|'agent'='owner'){
  if(p.kind!==actorKind)fail('owner_identity_required',403,'This read requires the current Owner identity');
  identifier(agentId,'agentId');const authority=await identity.authorizeAgent(ctx,p,agentId);await source.participant(ctx,agentId);
  const participation=await identity.readParticipation(ctx,agentId);
  return {instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,principal:p.kind==='owner'?p.ownerId:p.agentId,authorizationVersion:hashRuntimeRequest({authority:authority.authorizationVersion,participation:{...participation,membership:{...participation.membership}}}),query,target,limit};
 }
 function limitOf(value:unknown){const limit=value??50;if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('invalid_request',400,'Invalid owner read limit');return limit;}
 function artifactSummary(artifact:ArtifactRevision):JsonObject{return {artifact:{artifactId:artifact.artifactId,revision:artifact.revision},version:artifact.version,authorAgentId:artifact.authorAgentId,title:artifact.title,createdAt:artifact.createdAt,withdrawnAt:artifact.withdrawnAt,contentAvailable:artifact.withdrawnAt===null};}
 async function own(ctx:RuntimeReadContext,agentId:string,raw:unknown){const artifact=await ctx.repository(INTERACTION_REPOSITORY).getArtifact(artifactReference(raw));if(!artifact||artifact.authorAgentId!==agentId)fail('target_not_accessible',404,'Target is not accessible');return artifact;}
 async function exchange(ctx:RuntimeReadContext,agentId:string,invitationId:string){
  const {invitation,artifact,activity}=await source.bundle(ctx,agentId,identifier(invitationId)),repository=ctx.repository(INTERACTION_REPOSITORY);
  if(artifact.authorAgentId!==invitation.fromAgentId||artifact.artifactId!==invitation.artifact.artifactId||artifact.revision!==invitation.artifact.revision||activity&&(activity.invitationId!==invitation.id||activity.id!==invitation.activityId))fail('source_unavailable',503,'The interaction source references differ');
  if((invitation.activityId===null)!==(activity===undefined))fail('source_unavailable',503,'The activity source reference is missing');
  const feedback=activity?.feedbackId?await repository.getFeedback(activity.feedbackId):undefined;
  if(activity?.feedbackId&&!feedback)fail('source_unavailable',503,'The feedback source reference is missing');
  if(feedback&&(!activity||feedback.activityId!==activity.id||feedback.authorAgentId!==invitation.toAgentId||feedback.id!==activity.feedbackId))fail('source_unavailable',503,'The feedback source references differ');
  const invitationState=invitationExpired(invitation,ctx.now())?'expired':invitation.state,activityState=activity&&(activityExpired(activity,ctx.now())?'expired':activity.state),visibleFeedback=feedback?.withdrawnAt===null?feedback:undefined;
  if(invitationState==='unavailable'||activityState==='unavailable')fail('target_not_accessible',404,'Target is not accessible');
  const status=invitationState==='withdrawn'?'withdrawn':invitationState==='declined'?'declined':invitationState==='expired'||activityState==='expired'?'expired':activityState==='cancelled'||feedback&&!visibleFeedback?'withdrawn':visibleFeedback?(activityState==='closed'&&activity?.outcome==='received_confirmed'?'receipt_confirmed':'reply_received'):activityState==='waiting_feedback'?'awaiting_feedback':'awaiting_response';
  const contentAvailable=!['withdrawn','expired','unavailable'].includes(invitationState)&&activityState!=='expired'&&activityState!=='cancelled';
  const counterpartId=invitation.fromAgentId===agentId?invitation.toAgentId:invitation.fromAgentId,profile=contentAvailable?await identity.readPublicAgent(ctx,counterpartId):null;
  const summary:JsonObject={invitationId:invitation.id,direction:invitation.fromAgentId===agentId?'sent':'received',artifact:contentAvailable?{artifactId:artifact.artifactId,revision:artifact.revision}:null,title:contentAvailable?artifact.title:null,counterpart:contentAvailable?{agentId:counterpartId,displayName:profile?.displayName??null}:null,status,createdAt:invitation.createdAt,respondedAt:invitation.respondedAt,activityId:activity?.id??null,feedbackSubmittedAt:contentAvailable&&visibleFeedback?visibleFeedback.submittedAt:null,contentAvailable};
  return {agentId,exchange:summary,artifact:contentAvailable?{...artifact}:null,intent:contentAvailable?invitation.intent:null,feedback:contentAvailable&&visibleFeedback?{...visibleFeedback}:null,asOf:ctx.now()};
 }
 const readers={
  async listOwnerArtifacts(ctx:RuntimeReadContext,p:Principal,agentId:string,options:{cursor?:string;limit?:number}={},actorKind:'owner'|'agent'='owner'){
   object(options,['cursor','limit']);const limit=limitOf(options.limit),scope=await owner(ctx,p,agentId,actorKind==='owner'?'interaction.owner_artifacts':'interaction.artifacts',limit,agentId,actorKind);
   let after:ArtifactRef|undefined;if(options.cursor!==undefined){try{after=artifactReference(JSON.parse(cursors.decode(options.cursor,scope,ctx.now())));}catch{fail('invalid_cursor',409,'Restart the current works query');}}
   const rows=await ctx.repository(INTERACTION_REPOSITORY).listArtifacts(agentId,{limit,...(after?{after}:{})});
   if(rows.some(row=>row.authorAgentId!==agentId))fail('source_unavailable',503,'The author-scoped source differs');
   return {agentId,items:rows.map(artifactSummary),complete:rows.length<limit,nextCursor:rows.length===limit?cursors.encode(JSON.stringify({artifactId:rows.at(-1)!.artifactId,revision:rows.at(-1)!.revision}),scope,ctx.now()):null,asOf:ctx.now()};
  },
  async readOwnerArtifact(ctx:RuntimeReadContext,p:Principal,agentId:string,ref:unknown){
   await owner(ctx,p,agentId,'interaction.owner_artifact');const artifact=await own(ctx,agentId,ref);
   return {agentId,artifact:{...artifact,body:artifact.withdrawnAt===null?artifact.body:null},contentAvailable:artifact.withdrawnAt===null,asOf:ctx.now()};
  },
  async listOwnerExchanges(ctx:RuntimeReadContext,p:Principal,agentId:string,options:{direction:'sent'|'received';artifact?:ArtifactRef;cursor?:string;limit?:number}){
   object(options,['direction','artifact','cursor','limit']);if(!['sent','received'].includes(options.direction))fail('invalid_request',400,'Choose sent or received exchanges');
   const limit=limitOf(options.limit),ref=options.artifact===undefined?undefined:artifactReference(options.artifact),scope=await owner(ctx,p,agentId,'interaction.owner_exchanges',limit,JSON.stringify([agentId,options.direction,ref??null]));
   if(ref&&options.direction==='sent')await own(ctx,agentId,ref);
   let afterId=options.cursor===undefined?undefined:cursors.decode(options.cursor,scope,ctx.now()),scanned=0,complete=false;const items:JsonObject[]=[];
   while(items.length<limit&&scanned<500&&!complete){
    const batchSize=Math.min(50,500-scanned),rows=await ctx.repository(INTERACTION_REPOSITORY).listInvitations(agentId,{limit:batchSize,...(afterId?{afterId}:{}),...(ref?{artifact:ref}:{})});
    if(!rows.length){complete=true;break;}
    for(let index=0;index<rows.length;index++){
     const row=rows[index]!;afterId=row.id;scanned++;
     if(options.direction==='sent'?row.fromAgentId!==agentId:row.toAgentId!==agentId)continue;
     try{items.push((await exchange(ctx,agentId,row.id)).exchange);}catch(error){if(!(error instanceof M1Error)||error.code!=='target_not_accessible'||error.statusCode!==404)throw error;}
     if(items.length===limit){complete=index===rows.length-1&&rows.length<batchSize;break;}
    }
    if(items.length<limit&&rows.length<batchSize)complete=true;
   }
   return {agentId,direction:options.direction,items,complete,nextCursor:!complete&&afterId?cursors.encode(afterId,scope,ctx.now()):null,asOf:ctx.now()};
  },
  async readOwnerExchange(ctx:RuntimeReadContext,p:Principal,agentId:string,invitationId:string){await owner(ctx,p,agentId,'interaction.owner_exchange');return await exchange(ctx,agentId,invitationId);},
 };
 return {...readers,async listOwnArtifacts(ctx:RuntimeReadContext,p:Principal,options:{cursor?:string;limit?:number}={}){if(p.kind!=='agent')fail('agent_identity_required',403,'This read requires the Agent identity');return await readers.listOwnerArtifacts(ctx,p,p.agentId,options,'agent');}};
}
