import type {OwnerAudienceProof} from '../access/public.ts';
import type {LifeCItemId,LifeCItemInstance} from '../life-assets/c-types.ts';
import type {LifeQualification} from '../life/types.ts';
export const GIFT_COMMANDS=['relationships.gifts.offer','relationships.gifts.respond','relationships.gifts.withdraw'] as const;
export const GIFT_QUERIES=['relationships.gifts.get','relationships.gifts.inbox'] as const;
export type GiftState='pending'|'accepted'|'declined'|'withdrawn'|'expired'|'unavailable';
export interface RelationshipGift {
 id:string;version:number;fromAgentId:string;toAgentId:string;itemInstanceIds:string[];state:GiftState;catalogRevision:3;ruleVersion:1;moduleGeneration:number;
 items:{itemInstanceId:string;itemId:LifeCItemId;name:string;fish:LifeCItemInstance['fish']}[];
 createdAt:number;deadlineAt:number;resolvedAt:number|null;resultId:string|null;sourceEventId:string|null;acceptedByAgentId:string|null;
 /** Stable original authority, not a stored bearer; a new credential never silently continues this offer. */
 senderQualification:LifeQualification;recipientQualification:LifeQualification|null;
 friendshipId:string;friendshipVersion:number;pairGeneration:number;participantGenerations:{from:number;to:number};
 createdAudience:{from:OwnerAudienceProof|null;to:OwnerAudienceProof|null};terminalAudience:{from:OwnerAudienceProof|null;to:OwnerAudienceProof|null}|null;
 stopCode:string|null;
}

export type GiftAccessProof=Pick<RelationshipGift,'friendshipId'|'friendshipVersion'|'pairGeneration'|'participantGenerations'>;
