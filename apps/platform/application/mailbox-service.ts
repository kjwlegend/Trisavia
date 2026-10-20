import { randomUUID } from 'node:crypto';
import type { JsonObject, M1ReadSession, M1Store, M1Transaction, StoredRow } from '../contracts/store.ts';
import { fail, object, text, version } from '../domains/common/errors.ts';
import { key, plain, ref, type ObjectRef } from '../domains/perception/protocol.ts';
import { appendMailboxVersion, mailboxMessageId, mailboxReceiptId, mailboxRef, mailboxRepository, mailboxVersionId, saveMailboxReceipt, type MailboxMessage, type MailboxReceipt } from '../domains/mailbox/repository.ts';

export type MailboxCredentialAuth=(tx:M1ReadSession,token:unknown,kinds:readonly string[])=>StoredRow;
export interface VerifiedMailboxActor {kind:'agent'|'human';ref:ObjectRef}
export interface HumanMailboxIdentity {ref:ObjectRef;displayName:string;authorityId:string;version:number}
/** A registered, server-owned upstream adapter. No HTTP body can install one or supply a verified actor. */
export interface TrustedMailboxSource {
 sourceId:string;
 authenticate(tx:M1ReadSession,context:unknown,authenticateCredential:MailboxCredentialAuth):VerifiedMailboxActor;
 authorizeRecipient(tx:M1ReadSession,actor:VerifiedMailboxActor,recipientAgentId:string,context:unknown):boolean;
 ownerObservation?(tx:M1ReadSession,actor:VerifiedMailboxActor,recipientAgentId:string,context:unknown):JsonObject;
 humanIdentity?(tx:M1ReadSession,actorRef:ObjectRef,recipientAgentId:string):HumanMailboxIdentity|null;
}
export function validateMailboxSources(sources:readonly TrustedMailboxSource[]):void {
 if(sources.length>20||new Set(sources.map(s=>s.sourceId)).size!==sources.length||sources.some(s=>!/^[A-Za-z0-9_.:-]{1,100}$/.test(s.sourceId)||typeof s.authenticate!=='function'||typeof s.authorizeRecipient!=='function'))throw new Error('Explicit registered trusted mailbox sources are required');
}
function agentName(tx:M1ReadSession,ar:ObjectRef):string|null {
 if(ar.moduleId!=='profiles'||ar.type!=='profiles.agent@1')return null;
 const p=tx.get('profiles',ar.id),m=tx.get('memberships',ar.id),published=plain(p?.data.published),avatar=plain(published.avatar);
 return m?.data.state==='joined'&&m.data.platformRestricted===false&&avatar.template==='basic'&&['olive','cream','blue','coral'].includes(String(avatar.color))&&typeof published.displayName==='string'&&published.displayName.trim()?published.displayName:null;
}
function humanName(source:TrustedMailboxSource,tx:M1ReadSession,ar:ObjectRef,recipient:string):HumanMailboxIdentity|null {
 const identity=source.humanIdentity?.(tx,ar,recipient);
 if(!identity||key(identity.ref)!==key(ar)||!identity.displayName.trim()||identity.displayName.length>180||!identity.authorityId||!Number.isSafeInteger(identity.version)||identity.version<1)return null;
 return identity;
}
/** Current disclosure is checked again; a historical name snapshot never grants disclosure. */
export function mailboxSender(tx:M1ReadSession,message:StoredRow<MailboxMessage>,recipient:string,sources:readonly TrustedMailboxSource[]):JsonObject {
 const stored=message.data.sender,kind=stored.kind as 'human'|'agent',ar=ref(stored.ref),source=sources.find(s=>s.sourceId===message.data.sourceId);
 const displayName=source?(kind==='agent'?agentName(tx,ar):humanName(source,tx,ar,recipient)?.displayName??null):null;
 return {kind,ref:displayName?ar:null,displayName};
}
export function createTrustedMailboxReceiver(store:M1Store,sources:readonly TrustedMailboxSource[],authenticateCredential:MailboxCredentialAuth,now:()=>number=Date.now){
 validateMailboxSources(sources);
 return (sourceId:string,raw:unknown,context:unknown):JsonObject=>store.transaction(tx=>{
  const source=sources.find(s=>s.sourceId===sourceId);if(!source)fail('insufficient_scope',403,'Message source is not registered');
  const input=object(raw,['sourceMessageKey','recipientAgentId','contentVersion','title','body','attachments']);
  const sourceMessageKey=text(input.sourceMessageKey,'sourceMessageKey',8,100),recipient=text(input.recipientAgentId,'recipientAgentId',1,180),contentVersion=input.contentVersion===undefined?1:version(input.contentVersion,'contentVersion');
  const title=text(input.title,'title',1,180);if(typeof input.body!=='string'||input.body.length>100000)fail('invalid_request',400,'A bounded source body is required');
  const attachments=input.attachments===undefined?[]:input.attachments;
  if(!Array.isArray(attachments)||attachments.length>50||attachments.some(v=>!v||typeof v!=='object'||Array.isArray(v))||Buffer.byteLength(JSON.stringify(attachments))>8000)fail('invalid_request',400,'Bounded attachment descriptions are required');
  for(const attachment of attachments){const d=object(attachment,['id','name','description','mediaType','sizeBytes','href']);for(const field of ['id','name','description','mediaType','href'])if(d[field]!==undefined)text(d[field],field,field==='description'?0:1,field==='description'||field==='href'?2000:180);if(d.sizeBytes!==undefined&&(!Number.isSafeInteger(d.sizeBytes)||(d.sizeBytes as number)<0))fail('invalid_request',400,'Invalid attachment size');}
  const actor=source.authenticate(tx,context,authenticateCredential),ar=ref(actor.ref);if(!['agent','human'].includes(actor.kind)||!tx.get('agents',recipient)||!source.authorizeRecipient(tx,actor,recipient,context))fail('target_not_accessible',404,'Source may not deliver to this recipient');
  const human=actor.kind==='human'?humanName(source,tx,ar,recipient):null,displayName=actor.kind==='agent'?agentName(tx,ar):human?.displayName;
  if(!displayName)fail('sender_not_verified',403,'A currently disclosable verified sender identity is required');
  const policy=object(source.ownerObservation?.(tx,actor,recipient,context)??{},['existence','summary','body','attachments']);
  if(Object.values(policy).some(value=>typeof value!=='boolean'))fail('invalid_request',400,'Invalid source observation policy');
  const observation:JsonObject=Object.fromEntries(['existence','summary','body','attachments'].map(layer=>[layer,policy[layer]===true]));
  const messageId=mailboxMessageId(sourceId,sourceMessageKey),versionId=mailboxVersionId(messageId,contentVersion),repo=mailboxRepository(tx),previous=repo.receipt(messageId,recipient);
  const payloadHash=key({sourceId,sourceMessageKey,recipient,contentVersion,title,body:input.body,attachments,actor:{kind:actor.kind,ref:ar}}),prior=repo.message(versionId);
  const operationId=`${messageId}:${contentVersion}`,scope=`mailbox-source:${sourceId}`,operation=tx.scan('operations',{scope,action:'receiveMailboxMessage',operationId,epoch:store.recoveryEpoch},{limit:1})[0];
  if(prior){if(prior.data.payloadHash!==payloadHash||!operation)fail('operation_id_conflict',409,'Source message version payload changed');return plain(operation.data.result);}
  // The logical source key cannot silently become a different sender/recipient or skip a version.
  const original=repo.message(mailboxVersionId(messageId,1));
  if(contentVersion===1&&original||contentVersion>1&&(!previous||!original||previous.data.active!==true||key(original.data.sender.ref)!==key(ar)||original.data.sender.kind!==actor.kind||repo.message(previous.data.messageVersionId)!.data.contentVersion!==contentVersion-1))fail('version_conflict',409,'Source message revision or recipient changed');
  if(tx.count('mailbox_messages',{},50001)>=50000||!previous&&tx.count('mailbox_receipts',{},100001)>=100000)fail('storage_capacity',503,'Mailbox source capacity is exhausted');
  const stamp=now(),message:StoredRow<MailboxMessage>={id:versionId,version:1,data:{messageId,contentVersion,sourceId,sourceMessageKey,payloadHash,title,body:input.body,attachments:attachments as JsonObject[],sender:{kind:actor.kind,ref:ar,displayName,nameSource:actor.kind==='agent'?{kind:'published_profile'}:{kind:'upstream_identity',authorityId:human!.authorityId,version:human!.version}},receivedAt:stamp}};
  appendMailboxVersion(tx,message);
  const receipt:StoredRow<MailboxReceipt>={id:mailboxReceiptId(messageId,recipient),version:(previous?.version??0)+1,data:{messageId,messageVersionId:versionId,agentId:recipient,active:true,receivedAt:previous?.data.receivedAt??stamp,ownerObservation:observation,ownerObservationAudience:Object.values(observation).some(Boolean)?'current_bound_owner':null,confirmedContentVersion:previous?.data.confirmedContentVersion??null,confirmedAt:previous?.data.confirmedAt??null,stateVersion:previous?.data.stateVersion??0}};
  saveMailboxReceipt(tx,receipt,previous);
  const result:JsonObject={ref:mailboxRef(messageId),recipientAgentRef:{moduleId:'profiles',type:'profiles.agent@1',id:recipient},contentVersion,outcome:'committed',receiptId:randomUUID(),serverTime:stamp};
  tx.insert('operations',{id:randomUUID(),version:1,data:{scope,action:'receiveMailboxMessage',operationId,epoch:store.recoveryEpoch,payloadHash,result}});
  tx.insert('facts',{id:randomUUID(),version:1,data:{action:'receiveMailboxMessage',actor:{kind:actor.kind,ref:ar},sourceId,ref:mailboxRef(messageId),recipientAgentId:recipient,contentVersion,receiptId:result.receiptId!,time:stamp,visibility:'agent_private',epoch:store.recoveryEpoch}});
  return result;
 });
}
