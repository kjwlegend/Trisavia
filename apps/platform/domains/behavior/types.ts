import type {OwnerAudienceProof,OwnerObservationDomain} from '../access/public.ts';
import type {RuntimeActor,RuntimeSource} from '../../contracts/runtime-store.ts';
export type {OwnerAudienceProof} from '../access/public.ts';
export const BEHAVIOR_SCOPES=['world_explicit','world_idle','relationships','interaction','town_services','life'] as const;
export type BehaviorScope=typeof BEHAVIOR_SCOPES[number];
export const BEHAVIOR_NODES=[
 'world.movement.received','world.movement.started','world.movement.completed','world.movement.stopped','world.idle.completed',
 'relationships.invitation.sent','relationships.invitation.received','relationships.invitation.accepted','relationships.invitation.declined','relationships.invitation.cancelled','relationships.invitation.expired',
 'interaction.invitation.sent','interaction.invitation.received','interaction.invitation.accepted','interaction.invitation.declined','interaction.invitation.withdrawn','interaction.invitation.expired',
 'interaction.feedback.submitted','interaction.activity.closed','interaction.activity.left','interaction.activity.expired',
 'town_services.greeted','town_services.service.started','town_services.service.completed','town_services.service.cancelled',
 'relationships.gift.offered','relationships.gift.received','relationships.gift.accepted','relationships.gift.declined','relationships.gift.withdrawn','relationships.gift.expired','relationships.gift.unavailable',
 'life.meal.prepared','life.meal.completed','life.reading.completed','life.visit.completed',
 'life.work.completed','life.rest.completed','life.activity.interrupted','life.fishing.finished','life.purchase.completed','life.sale.completed',
] as const;
export type BehaviorNode=typeof BEHAVIOR_NODES[number];
/** Internal user-log selection, never a client-supplied list of filters. */
export const USER_LOG_PROCESS_NODES:readonly BehaviorNode[]=Object.freeze(['world.movement.received','world.movement.started','world.movement.completed','world.movement.stopped','world.idle.completed']);
export interface BehaviorObservationAccess<C extends object>{capture(context:C,agentId:string,sourceDomain:OwnerObservationDomain):Promise<OwnerAudienceProof|null>}
export interface BehaviorCoverage {scope:BehaviorScope;fromAt:number;policyVersion:1;partial:boolean}
export interface BehaviorPublicProjection {policyVersion:1;worldId:string;sharingGeneration:number;placeId:string|null;placeName:string|null}
export interface BehaviorRecordDraft {
 scope:BehaviorScope;sourceDomain:OwnerObservationDomain;sourceEventId:string;
 sourceRef:{type:'movement'|'avatar'|'friendship_invitation'|'interaction_invitation'|'interaction_activity'|'town_service'|'resident_gift'|'life_activity'|'relationship_gift';id:string;version:number};
 node:BehaviorNode;agentId:string|null;npcId?:string;occurredAt:number;recordedAt:number;causationId:string;correlationId:string;
 initiator:RuntimeActor;executor:RuntimeActor;origin:RuntimeSource;
 ownerAudience:OwnerAudienceProof|null;publicProjection:BehaviorPublicProjection|null;
}
export interface BehaviorRecord extends BehaviorRecordDraft {id:string;sequence:number}
/** Source facts only. Display names and natural summaries remain in the authorized read model. */
export interface BehaviorLocation {kind:'place'|'entrance'|'bridge'|'stairs'|'map_region';name:string}
export interface BehaviorDetails {
 version:1;completeness:'recorded'|'partial';phase:'movement'|'wander'|'friendship_request'|'text_invitation'|'text_feedback'|'npc_service'|'life_work'|'life_rest'|'life_fishing'|'life_trade'|'life_meal'|'life_reading'|'life_visit'|'gift';
 startedAt:number|null;endedAt:number|null;durationMs:number|null;
 location:{from:BehaviorLocation|null;to:BehaviorLocation|null;via:BehaviorLocation[];mapId:string|null;rulesetVersion:number|null;topologyVersion:number|null}|null;
 journey:{completedSteps:number|null;plannedSteps:number|null}|null;
 participants:{agentId:string;role:'sender'|'recipient'}[];
 resultCode:string;gaps:string[];
 service?:{npcId:string;npcName:string;serviceId:string;serviceName:string;choice:string|null;response:string|null};
 gift?:{giftId:string;state:string;direction:'sent'|'received';items:{itemInstanceId:string;itemId:string;name:string}[]};
 life?:{activityId:string;actionId:string;jobId:string|null;resultId:string;scheduledEndAt:number;energySpent:number|null;energyRestored:number|null;coinReward:number|null;fishing?:import('../life/b-types.ts').LifeFishingResult&{unstartedCasts:number}|null;trade?:{moneyDelta:number;quantity:number}|null;c?:{book:{bookId:string;version:number;title:string;authorDisplay:string;digest:string}|null;visit:{first:boolean;recorded:boolean}|null;moneyDelta:number|null;consumedItems:number|null;createdItems:number|null}|null};
}
export interface BehaviorListInput {agentId?:string;publicOnly?:boolean;userLogOnly?:true;maxSequence:number;fromAt?:number;toAt?:number;after?:{occurredAt:number;id:string};limit:number}
export const IDLE_BEHAVIOR_INTERVAL_MS=300000;
