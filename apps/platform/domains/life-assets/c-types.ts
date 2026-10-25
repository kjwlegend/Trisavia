import type {WalletActorRef} from '../wallet/life-wallet.ts';
import type {LifeAssetCatalog,LifeItemId,LifeItemInstance,LifeTradeSource} from './types.ts';

export type LifeCItemId=LifeItemId|'bread_meal'|'herbal_tea'|'grilled_fish'|'harbor_handbook';
export interface LifeCItemInstance extends Omit<LifeItemInstance,'itemId'> {itemId:LifeCItemId}
export interface LifeCResources {
 actorRef:WalletActorRef;wallet:{balance:number;reserved:number;available:number;version:number};
 totals:{itemId:LifeCItemId;available:number;reserved:number}[];items:LifeCItemInstance[];nextCursor:string|null;complete:boolean;
}
export interface LifeCAssetCatalog extends LifeAssetCatalog {
 services:{mealPreparation:{placeId:string;fishUnits:number;fee:number;durationSeconds:number;outputItemId:string};innRest:{placeId:string;price:number;durationSeconds:number}};
 items:readonly (LifeAssetCatalog['items'][number]&{durationSeconds?:number})[];
}
/** Read only through the source owner's same-transaction callback. Never accepted as a command payload. */
export interface LifeCActivitySource {
 id:string;actorKind:WalletActorRef['kind'];actorId:string;actionId:'meal.prepare'|'meal.eat'|'rest.inn';state:'active'|'completed'|'cancelled'|'interrupted';
 catalogRevision:number;ruleVersion:number;placeId:string;itemInstanceId:string|null;maxSpend:number;
 startedAt:number;scheduledEndAt:number;endedAt:number|null;resultId:string|null;sourceEventId:string|null;
}
/** Relationship/consent source. acceptedByAgentId must be source-owned authenticated evidence, never an input assertion.
 * The source owner guards current participation/friendship/blocking/qualifications and the terminal row in this same transaction.
 * Preparing/delivering a notice is never acceptance. NPCs and legacy service items are outside this contract. */
export interface LifeCGiftSource {
 id:string;fromAgentId:string;toAgentId:string;itemInstanceIds:readonly string[];
 state:'pending'|'accepted'|'declined'|'withdrawn'|'expired'|'unavailable';catalogRevision:number;ruleVersion:number;
 createdAt:number;deadlineAt:number;resolvedAt:number|null;sourceEventId:string|null;acceptedByAgentId:string|null;
}
export interface LifeCCommerceSources {
 catalog:LifeCAssetCatalog;
 readTradeSource(activityId:string):Promise<LifeTradeSource|undefined>;
 readCActivitySource(activityId:string):Promise<LifeCActivitySource|undefined>;
 readGiftSource(giftId:string):Promise<LifeCGiftSource|undefined>;
}
export type LifeCEffectKind='c.buy'|'c.activity.reserve'|'c.activity.settle'|'c.gift.reserve'|'c.gift.settle';
export interface LifeCEffect {
 id:string;kind:LifeCEffectKind;sourceId:string;actorRef:WalletActorRef;recipientAgentId:string|null;occurredAt:number;
 moneyDelta:number;reservedCoinsDelta:number;reservedItemIds:string[];releasedItemIds:string[];consumedItemIds:string[];createdItemIds:string[];transferredItemIds:string[];
}
export interface LifeCReservationTerms {money:number;itemInstanceId:string|null;durationMs:number;outputItemId:'grilled_fish'|null}
