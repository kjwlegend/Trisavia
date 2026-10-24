import {randomUUID} from 'node:crypto';
import type {RuntimeTransaction,RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {IdentityAccess} from '../domains/access/public.ts';
import {RESIDENT_GIFT_REPOSITORY} from '../domains/town-services/resident-gift.ts';
import {RuntimeError} from '../contracts/runtime-store.ts';
import {TOWN_REPOSITORY,SERVICE_INVENTORY_REPOSITORY} from '../domains/town-services/repository.ts';
import {WELCOME_CREDIT_REPOSITORY} from '../domains/wallet/welcome-credit.ts';
import type {ResidentCard} from '../domains/town-services/types.ts';
import {recordBehaviorSource} from '../domains/behavior/sources.ts';
import {detailPayload} from '../domains/behavior/details.ts';
import type {BehaviorDetails} from '../domains/behavior/types.ts';
/** Same transaction as the actual claim or explicitly guarded administrator command. Never creates a visit or claim. */
export async function issueResidentGift(ctx:RuntimeTransaction,input:{resident:Omit<ResidentCard,'issuedAt'>;initiatorKind:'agent'|'administrator';initiatorId:string;sourceOperationId:string|null;operationId:string},identity:IdentityAccess<RuntimeReadContext>){
 const agentId=input.resident.agentId;let now:number;
 if(input.initiatorKind==='agent'){const claim=input.sourceOperationId&&await ctx.repository(TOWN_REPOSITORY).getOperation(input.sourceOperationId);if(!claim||claim.agentId!==agentId||input.initiatorId!==agentId||claim.serviceId!=='welcome.claim'||claim.state!=='completed'||claim.catalogVersion<2||claim.endedAt===null)throw new RuntimeError('invalid_usage','Resident issuance requires its real completed welcome claim');now=claim.endedAt;}else now=ctx.now();
 const gift=await ctx.repository(RESIDENT_GIFT_REPOSITORY).ensure({id:randomUUID(),agentId,createdAt:now,sourceOperationId:input.sourceOperationId,initiatorKind:input.initiatorKind,initiatorId:input.initiatorId}),inventory=ctx.repository(SERVICE_INVENTORY_REPOSITORY),credits=ctx.repository(WELCOME_CREDIT_REPOSITORY);
 let card=await inventory.findResidentCard(agentId),credit=await credits.get(agentId);const cardIssued=!card,creditGranted=!credit;
 if(!card){const id=randomUUID();card={id,version:1,agentId,kind:'resident_card',state:'available',sourceGiftId:gift.id,sourceOperationId:input.sourceOperationId,issuedAt:now,updatedAt:now,reservationId:null,consumedBy:null,holdingId:'town-holding:'+id,residentCard:{...input.resident,issuedAt:now}};await inventory.issue(card);}
 if(!credit)credit=await credits.grant({agentId,sourceGiftId:gift.id,sourceOperationId:input.sourceOperationId,grantedAt:now});
 const eventIds:string[]=[];
 if(input.initiatorKind==='administrator'&&(cardIssued||creditGranted)){
  const details:BehaviorDetails={version:1,completeness:'recorded',phase:'npc_service',startedAt:now,endedAt:now,durationMs:0,location:null,journey:null,participants:[],resultCode:cardIssued&&creditGranted?'resident_card_and_credit_issued':cardIssued?'resident_card_issued':'resident_credit_issued',gaps:[],service:{npcId:'npc-mayor',npcName:'镇长',serviceId:'resident.gift.backfill',serviceName:'管理员补发居民权益',choice:null,response:null}};
  const event=await ctx.events.append({eventId:'resident-gift:'+input.operationId,domain:'town_services',kind:'town_services.service.completed',schemaVersion:1,subject:{type:'resident.gift',id:gift.id,version:1},worldId:'default',actor:{kind:'system',id:input.initiatorId},source:'system',occurredAt:now,causationId:input.operationId,correlationId:gift.id,audience:{kind:'agents',agentIds:[agentId]},payload:{agentId,giftId:gift.id,cardIssued,creditAmount:creditGranted?100:0,behaviorDetails:detailPayload(details)}});
  // Private Owner history only. No administrator result broadens public sharing or implies a physical visit.
  await recordBehaviorSource(ctx,{capture:async(c,id,d)=>await identity.captureOwnerObservation?.(c,id,d)??null},{event,scope:'town_services',sourceRef:{type:'resident_gift',id:gift.id,version:1},perspectives:[{agentId,node:'town_services.service.completed',publicProjection:null}],initiator:{kind:'system',id:input.initiatorId},origin:'system'});eventIds.push(event.eventId);
 }
 return {gift,card,credit,cardIssued,creditAmount:creditGranted?100:0,eventIds};
}
