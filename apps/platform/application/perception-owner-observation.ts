import { randomUUID } from 'node:crypto';
import type { JsonObject, M1Store, M1Transaction, StoredRow } from '../contracts/store.ts';
import { fail } from '../domains/common/errors.ts';
import { key, plain, refId } from '../domains/perception/protocol.ts';

export const OWNER_OBSERVATION_ID='owner-observation:direct-mail:connet-hud-examples@2';
/** Source-level authority, separate from object content, deliveries and Agent confirmation. */
export function ownerObservation(tx:M1Transaction, object:StoredRow):StoredRow|undefined {
 const policy=tx.get('perception_catalog',OWNER_OBSERVATION_ID),source=plain(object.data.source);
 if(!policy||policy.data.active!==true||policy.data.sourceId!==object.data.sourceId||policy.data.sourceReference!==source.reference||policy.data.sourceAdministrator!==source.administrator||source.kind!=='demo_seed'||!Array.isArray(policy.data.objectIds)||!policy.data.objectIds.includes(object.id)||policy.data.audience!=='current_bound_owner')return undefined;
 return policy;
}
export function ownerLayer(policy:StoredRow|undefined,layer:string):boolean {return plain(policy?.data.layers)[layer]===true;}
export function ws02SeedNotificationIds():string[] {
 // Frozen source declaration for connet-hud-examples@2; never infer audience
 // from future fixture edits, demo flags or a newly added seed object.
 return [...Array.from({length:6},(_,i)=>`message-${i+1}`),...Array.from({length:25},(_,i)=>`test-message-${String(i+1).padStart(2,'0')}`)].map(id=>refId({moduleId:'mailbox',type:'mailbox.message@1',id})).sort();
}
/** Explicit local administrator command. It never seeds, rewrites content or reactivates grants/policies. */
export function authorizeWs02SeedOwnerObservation(store:M1Store,options:{actorId:string;operationId:string;expectedSourceAdministrator:string;now?:()=>number}):JsonObject {
 for(const value of [options.actorId,options.expectedSourceAdministrator])if(!/^[A-Za-z0-9_.:@-]{1,100}$/.test(value))throw new Error('Explicit administrative actor and source administrator are required');
 if(!/^.{8,100}$/u.test(options.operationId))throw new Error('Explicit operation ID is required');
 return store.transaction(tx=>{
  const payload={action:'authorizeWs02SeedOwnerObservation',sourceAdministrator:options.expectedSourceAdministrator,policyId:OWNER_OBSERVATION_ID},receiptId=`admin-operation:${key({actorId:options.actorId,operationId:options.operationId})}`,prior=tx.get('perception_catalog',receiptId);
  if(prior){if(prior.data.payloadHash!==key(payload))fail('operation_id_conflict',409,'Administrative operation payload changed');return plain(prior.data.result);}
  const current=tx.get('perception_catalog','current'),registered=current?.data.seedObjectIds,objectIds=ws02SeedNotificationIds();
  if(objectIds.length!==31||!Array.isArray(registered)||!objectIds.every(id=>registered.includes(id)))fail('target_not_accessible',404,'The exact registered seed notification set is required');
  for(const id of objectIds){const row=tx.get('perception_objects',id),source=plain(row?.data.source);if(!row||row.data.channel!=='inbox'||row.data.categoryId!=='notifications'||row.data.sourceId!=='direct-mail'||refId(plain(row.data.ref) as {moduleId:string;type:string;id:string})!==id||source.kind!=='demo_seed'||source.reference!=='connet-hud-examples@2'||source.administrator!==options.expectedSourceAdministrator)fail('target_not_accessible',404,'A registered notification does not match the explicit source');}
  const objectRefs=objectIds.map(id=>tx.get('perception_objects',id)!.data.ref!);
  const existing=tx.get('perception_catalog',OWNER_OBSERVATION_ID),stamp=(options.now??Date.now)();
  if(existing&&(existing.data.sourceAdministrator!==options.expectedSourceAdministrator||key(existing.data.objectIds)!==key(objectIds)))fail('version_conflict',409,'Existing source declaration differs');
  if(tx.count('perception_catalog',{kind:'administrative_receipt'},10_001)>=10_000)fail('storage_capacity',503,'Administrative receipt capacity is exhausted');
  if(!existing)tx.insert('perception_catalog',{id:OWNER_OBSERVATION_ID,version:1,data:{kind:'owner_observation_policy',sourceId:'direct-mail',sourceReference:'connet-hud-examples@2',sourceAdministrator:options.expectedSourceAdministrator,objectIds,audience:'current_bound_owner',layers:{existence:true,summary:true,body:true,attachments:true},active:true,declaredBy:{kind:'administrator',id:options.actorId},declaredAt:stamp}});
  const result:JsonObject={operationId:options.operationId,actor:{kind:'administrator',id:options.actorId},outcome:'committed',receiptId:randomUUID(),serverTime:stamp,instanceId:store.instanceId,policyId:OWNER_OBSERVATION_ID,source:{sourceId:'direct-mail',reference:'connet-hud-examples@2',administrator:options.expectedSourceAdministrator},refs:objectRefs,declarationVersionBefore:existing?.version??null,declarationVersionAfter:existing?.version??1,policyVersion:existing?.version??1,active:existing?.data.active??true,changed:!existing,registeredNotifications:objectIds.length};
  tx.insert('perception_catalog',{id:receiptId,version:1,data:{kind:'administrative_receipt',payloadHash:key(payload),result}});
  tx.insert('perception_access',{id:`${String(stamp).padStart(16,'0')}_admin_${randomUUID()}`,version:1,data:{actor:{kind:'administrator',id:options.actorId},agentId:null,humanAudienceOwnerId:null,operationId:options.operationId,operationRef:'authorize-ws02-seed-owner-observation',receivedAt:stamp,recordedAt:stamp,targets:[],declaration:null,result:{status:'business_committed',recordedAt:stamp,sourceReceiptRef:result.receiptId!,changed:!existing}}});
  return result;
 });
}
