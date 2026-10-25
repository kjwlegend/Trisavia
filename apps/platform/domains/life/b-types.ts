import type {LifeActorRef,LifeQualification,LifeState} from './types.ts';
import type {OwnerAudienceProof} from '../access/public.ts';

/** Slice B's source-owned facts. Asset participants read these on the caller's same transaction. */
export type LifeBItemId='basic_rod'|'bait'|'sardine'|'mackerel'|'sea_bass';
export type LifeFishId='sardine'|'mackerel'|'sea_bass';
export type LifeSpotId='shore_spot'|'pier_spot';
export interface LifeQuote {
 quoteId:string;catalogRevision:2;ruleVersion:1;placeId:'fisher_shop';side:'buy'|'sell';itemId:LifeBItemId;
 unitPrice:number;issuedAt:number;expiresAt:number;
}
export interface LifeTradeLine {itemInstanceId:string;itemId:LifeFishId;unitPrice:number}
export type LifeTradeTerms={side:'buy';quote:LifeQuote;itemId:'basic_rod'|'bait';quantity:number;maxTotalPrice:number;totalPrice:number}
 |{side:'sell';quote:LifeQuote|null;itemInstanceIds:string[];lines:LifeTradeLine[];minTotalProceeds:number;totalProceeds:number};
export interface LifeTradeSource {
 id:string;actorKind:LifeActorRef['kind'];actorId:string;catalogRevision:2;ruleVersion:1;
 actionId:'shop.buy'|'shop.sell';placeId:'fisher_shop';state:'completed';startedAt:number;endedAt:number;
 resultId:string;sourceEventId:string;terms:LifeTradeTerms;
}
export interface LifeFishingSession {
 id:string;version:number;actorKind:LifeActorRef['kind'];actorId:string;catalogRevision:2;ruleVersion:1;
 actionId:'fish.session';activityId:string;spotId:LifeSpotId;rodInstanceId:string;requestedCasts:number;nextCastIndex:number;
 state:LifeState;startedAt:number;endedAt:number|null;currentCastId:string|null;castIds:string[];
 energyBefore:number;
 qualification:LifeQualification|null;ownerAudience:OwnerAudienceProof|null;resultId:string|null;sourceEventId:string|null;
}
export interface LifeFishingCast {
 id:string;version:number;sessionId:string;index:number;actorKind:LifeActorRef['kind'];actorId:string;
 catalogRevision:2;ruleVersion:1;spotId:LifeSpotId;state:LifeState;startDay:string;
 startedAt:number;scheduledEndAt:number;endedAt:number|null;resultId:string|null;sourceEventId:string|null;
 /** Private until this individual cast has durably completed. Never projected in active reads. */
 outcome:{itemId:LifeFishId|null;weightGrams:number|null};baitQuantity:1;energyCost:2;stopCode:string|null;
}
export interface LifeFishingResult {
 requestedCasts:number;completedCasts:number;interruptedCasts:number;noCatchCount:number;
 catches:{castId:string;itemInstanceId:string;itemId:LifeFishId;weightGrams:number;caughtAt:number}[];
 actualCosts:{bait:number;energy:number};refundedCosts:{bait:number;energy:number};
}
export type LifeBActionParams={actionId:'shop.buy';params:{itemId:'basic_rod'|'bait';quantity:number;quoteRef:string;maxTotalPrice:number}}
 |{actionId:'shop.sell';params:{itemInstanceIds:string[];minTotalProceeds:number;quoteRef?:string}}
 |{actionId:'fish.session';params:{spotId:LifeSpotId;castCount:number;rodInstanceId:string}};
export interface LifeOutputReference {stepId:string;output:'caughtFish'}
export interface LifeBudget {maxSpendByCurrency:{star_coin:number};maxConsumeByItem:Partial<Record<'bait'|'sardine'|'mackerel'|'sea_bass'|'bread_meal'|'herbal_tea'|'grilled_fish',number>>}
export interface LifeBudgetProgress {committedSpend:number;reservedSpend:number;committedBait:number;reservedBait:number}
