import {randomUUID,createHash} from 'node:crypto';
import type {RuntimeReadContext,RuntimeTransaction,CommandKey,CommandReceipt} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {BEHAVIOR_REPOSITORY} from '../domains/behavior/repository.ts';
import {parseJournalInput,journalAudienceRef,type BehaviorJournalEntry} from '../domains/behavior/journal.ts';
import type {BehaviorRecord} from '../domains/behavior/types.ts';
import {behaviorRecordId} from '../domains/behavior/records.ts';
import {commitRuntimeCommandIn,hashRuntimeRequest} from '../domains/runtime/command.ts';
import {M1Error,fail} from '../domains/common/errors.ts';

export function createBehaviorJournal(identity:IdentityAccess<RuntimeReadContext>,canReference:(ctx:RuntimeReadContext,p:Principal,row:BehaviorRecord)=>Promise<boolean>){
 async function authorize(ctx:RuntimeReadContext,p:Principal){
  if(p.kind!=='agent')fail('agent_identity_required',403,'Only the actual Agent runtime may submit or read its final statement');
  await identity.authorizeAgent(ctx,p,p.agentId);const state=await identity.readParticipation(ctx,p.agentId);
  if(!state.runtimeActive||state.runtimeVersion!==p.runtimeVersion||p.recoveryEpoch!==ctx.recoveryEpoch||p.expiresAt!==null&&p.expiresAt<=ctx.now())fail('journal_runtime_unavailable',403,'A currently valid own runtime is required');
  if(!identity.captureExecutionAuthority||!identity.validateExecutionAuthority)fail('journal_authority_unavailable',503,'Current runtime authority validation is unavailable');
  await identity.validateExecutionAuthority(ctx,await identity.captureExecutionAuthority(ctx,p));return p.agentId;
 }
 async function authorizeJournalReceipt(ctx:RuntimeReadContext,p:Principal,receipt:CommandReceipt){const id=await authorize(ctx,p),key=receipt.key;if(key.domain!=='behavior'||key.action!=='behavior.journal.submit'||key.principal.kind!=='agent'||key.principal.id!==id)fail('target_not_accessible',404,'This statement receipt is unavailable');}
 async function submitJournal(ctx:RuntimeTransaction,p:Principal,key:CommandKey,input:JsonObject){
  if(p.kind!=='agent'||key.domain!=='behavior'||key.action!=='behavior.journal.submit'||key.principal.kind!=='agent'||key.principal.id!==p.agentId)fail('agent_identity_required',403,'Only this Agent may submit its own final statement');
  return commitRuntimeCommandIn(ctx,{key,requestHash:hashRuntimeRequest(input),authorize:async current=>{await authorize(current,p);current.validateBeforeCommit(fresh=>authorize(fresh,p).then(()=>{}));},classifyRejection:error=>error instanceof M1Error&&error.statusCode<500?{outcome:'rejected',result:{agentId:p.agentId,code:error.code}}:undefined,handle:async current=>{
   const parsed=parseJournalInput(input),repo=current.repository(BEHAVIOR_REPOSITORY),payloadHash=hashRuntimeRequest(JSON.parse(JSON.stringify(parsed))),prior=await repo.findJournal(p.agentId,parsed.clientEntryId);
   const existingResult=async(entry:BehaviorJournalEntry)=>{if(entry.payloadHash!==payloadHash)fail('client_entry_id_conflict',409,'The original client entry ID has another payload or audience');const recordId=behaviorRecordId({sourceDomain:'life',sourceEventId:entry.sourceEventId,agentId:entry.agentId,node:'life.journal.authored'});if(!await repo.get(recordId))fail('journal_source_unavailable',503,'The original statement projection is missing');return{result:{agentId:entry.agentId,entryId:entry.entryId,recordId,submittedAt:entry.submittedAt},eventIds:[entry.sourceEventId]};};
   if(prior)return existingResult(prior);
   const ownerAudience=await identity.captureOwnerObservation?.(current,p.agentId,'life')??null;if(parsed.expectedAudienceRef!==journalAudienceRef(p.agentId,ownerAudience))fail('journal_audience_changed',409,'The original draft audience changed; do not retarget this draft');
   current.validateBeforeCommit(async fresh=>{if(parsed.expectedAudienceRef!==journalAudienceRef(p.agentId,await identity.captureOwnerObservation?.(fresh,p.agentId,'life')??null))fail('journal_audience_changed',409,'The original draft audience changed');});
   const coverage=(await repo.getCoverage()).find(r=>r.scope==='life');if(!coverage)fail('journal_not_enabled',503,'The existing Life behavior source must be enabled');
   for(const ref of parsed.sourceRefs){const record=await repo.get(ref.recordId);if(!record||record.agentId!==p.agentId||record.sourceRef.type==='life_journal'||!await canReference(current,p,record))fail('journal_reference_not_accessible',404,'Use a currently visible own source record');}
   const entryId=randomUUID(),sourceEventId='life-journal:'+entryId,submittedAt=current.now(),entry:BehaviorJournalEntry={entryId,version:1,agentId:p.agentId,...parsed,payloadHash,submittedAt,sourceEventId,ownerAudience};
   const saved=await repo.insertJournal(entry);if(saved.entryId!==entry.entryId)return existingResult(saved);
   await current.events.append({eventId:sourceEventId,domain:'life',kind:'life.journal.authored',schemaVersion:1,subject:{type:'life.journal',id:entryId,version:1},actor:{kind:'agent',id:p.agentId},source:'external_agent',occurredAt:submittedAt,causationId:key.commandId,correlationId:key.commandId,audience:{kind:'agents',agentIds:[p.agentId]},payload:{entryId,agentId:p.agentId,submittedAt,textDigest:createHash('sha256').update(entry.text).digest('hex')}});
   const draft={scope:'life' as const,sourceDomain:'life' as const,sourceEventId,sourceRef:{type:'life_journal' as const,id:entryId,version:1},node:'life.journal.authored' as const,agentId:p.agentId,occurredAt:submittedAt,recordedAt:submittedAt,causationId:key.commandId,correlationId:key.commandId,initiator:{kind:'agent' as const,id:p.agentId},executor:{kind:'agent' as const,id:p.agentId},origin:'external_agent' as const,ownerAudience,publicProjection:null};
   const record=await repo.append(draft);if(record.id!==behaviorRecordId(draft))throw Error('Statement projection identity differs');
   return{result:{agentId:p.agentId,entryId,recordId:record.id,submittedAt},eventIds:[sourceEventId]};
  }});
 }
 return{authorize,submitJournal,authorizeJournalReceipt};
}
