import type {OwnerAudienceProof,OwnerObservationDomain} from '../access/public.ts';
import type {RuntimeActor,RuntimeSource} from '../../contracts/runtime-store.ts';
export type {OwnerAudienceProof} from '../access/public.ts';
export const BEHAVIOR_SCOPES=['world_explicit','world_idle','relationships','interaction'] as const;
export type BehaviorScope=typeof BEHAVIOR_SCOPES[number];
export const BEHAVIOR_NODES=[
 'world.movement.received','world.movement.started','world.movement.completed','world.movement.stopped','world.idle.completed',
 'relationships.invitation.sent','relationships.invitation.received','relationships.invitation.accepted','relationships.invitation.declined','relationships.invitation.cancelled','relationships.invitation.expired',
 'interaction.invitation.sent','interaction.invitation.received','interaction.invitation.accepted','interaction.invitation.declined','interaction.invitation.withdrawn','interaction.invitation.expired',
 'interaction.feedback.submitted','interaction.activity.closed','interaction.activity.left','interaction.activity.expired',
] as const;
export type BehaviorNode=typeof BEHAVIOR_NODES[number];
export interface BehaviorObservationAccess<C extends object>{capture(context:C,agentId:string,sourceDomain:OwnerObservationDomain):Promise<OwnerAudienceProof|null>}
export interface BehaviorCoverage {scope:BehaviorScope;fromAt:number;policyVersion:1;partial:boolean}
export interface BehaviorPublicProjection {policyVersion:1;worldId:string;sharingGeneration:number;placeId:string|null;placeName:string|null}
export interface BehaviorRecordDraft {
 scope:BehaviorScope;sourceDomain:OwnerObservationDomain;sourceEventId:string;
 sourceRef:{type:'movement'|'avatar'|'friendship_invitation'|'interaction_invitation'|'interaction_activity';id:string;version:number};
 node:BehaviorNode;agentId:string;occurredAt:number;recordedAt:number;causationId:string;correlationId:string;
 initiator:RuntimeActor;executor:RuntimeActor;origin:RuntimeSource;
 ownerAudience:OwnerAudienceProof|null;publicProjection:BehaviorPublicProjection|null;
}
export interface BehaviorRecord extends BehaviorRecordDraft {id:string;sequence:number}
export interface BehaviorListInput {agentId?:string;publicOnly?:boolean;maxSequence:number;fromAt?:number;toAt?:number;after?:{occurredAt:number;id:string};limit:number}
export const IDLE_BEHAVIOR_INTERVAL_MS=300000;
