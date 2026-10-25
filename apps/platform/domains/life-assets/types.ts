import type {WalletActorRef} from '../wallet/life-wallet.ts';

export type LifeItemId='basic_rod'|'bait'|'sardine'|'mackerel'|'sea_bass';
export type LifeFishId=Exclude<LifeItemId,'basic_rod'|'bait'>;
export interface LifeAssetCatalog {
 revision:number;ruleVersion:number;currency:'star_coin';currencyScale:0;
 items:readonly {id:string;name:string;kind:string;buyPrice:number|null;sellPrice:number|null;weightGrams?:readonly number[]}[];
 fishing:{castSeconds:number;baitPerCast:number;spots:readonly {id:string;outcomes:readonly {itemId:string|null;probability:number}[]}[]};
}
/** These are source-owned facts read through the caller's transaction, never HTTP input. */
export interface LifeTradeSource {
 id:string;actorKind:'agent'|'npc';actorId:string;actionId:'shop.buy'|'shop.sell';state:string;placeId:string;
 ruleVersion:number;catalogRevision:number;startedAt:number;endedAt:number|null;resultId:string|null;sourceEventId:string|null;
 quote:{catalogRevision:number;ruleVersion:number;createdAt:number;expiresAt:number;items:readonly {itemId:string;unitPrice:number}[]};
 purchase?:{itemId:string;quantity:number;maxSpend:number};sale?:{instanceIds:readonly string[];minIncome:number};moneyAmount:number;
}
export interface LifeFishingSessionSource {
 id:string;actorKind:'agent'|'npc';actorId:string;actionId:'fish.session';state:string;ruleVersion:number;catalogRevision:number;
 rodInstanceId:string;requestedCasts:number;startedAt:number;endedAt:number|null;
}
export interface LifeFishingCastSource {
 id:string;sessionId:string;actorKind:'agent'|'npc';actorId:string;state:string;ruleVersion:number;catalogRevision:number;castIndex:number;
 spotId:string;startedAt:number;scheduledEndAt:number;endedAt:number|null;resultId:string|null;sourceEventId:string|null;
 outcome:{itemId:LifeFishId|null;weightGrams:number|null};
}
export interface LifeCommerceSources {
 catalog:LifeAssetCatalog;
 readTradeSource(activityId:string):Promise<LifeTradeSource|undefined>;
 readFishingSessionSource(sessionId:string):Promise<LifeFishingSessionSource|undefined>;
 readFishingCastSource(castId:string):Promise<LifeFishingCastSource|undefined>;
}
export interface LifeItemInstance {
 id:string;version:number;actorRef:WalletActorRef;itemId:LifeItemId;state:'available'|'reserved'|'consumed'|'sold';
 reservationId:string|null;sourceId:string;issuedAt:number;updatedAt:number;
 fish:{weightGrams:number;spotId:string;castId:string;caughtAt:number}|null;
}
export type LifeCommerceEffectKind='buy'|'sell'|'fishing.reserve'|'fishing.start'|'fishing.settle'|'fishing.release';
export interface LifeCommerceEffect {
 id:string;kind:LifeCommerceEffectKind;sourceId:string;actorRef:WalletActorRef;occurredAt:number;
 moneyDelta:number;itemIds:string[];baitConsumed:number; baitReturned:number;
}
export interface LifeResources {
 actorRef:WalletActorRef;wallet:{balance:number;reserved:number;available:number;version:number};
 totals:{itemId:LifeItemId;available:number;reserved:number}[];items:LifeItemInstance[];nextCursor:string|null;complete:boolean;
}
