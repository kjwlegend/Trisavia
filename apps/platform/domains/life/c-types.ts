import type {LifeActorRef} from './types.ts';import type {OwnerAudienceProof} from '../access/public.ts';
export type LifeCActionId='meal.prepare'|'meal.eat'|'rest.inn'|'book.read'|'visit.place';
export interface LifeBookReference {bookId:'qingzhou_life_guide'|'harbor_handbook';version:1;title:string;authorDisplay:string;digest:string;itemInstanceId:string|null}
export interface LifeCActivitySnapshot {itemInstanceId:string|null;itemId:string|null;maxSpend:number;book:LifeBookReference|null}
export interface LifeCResult {effectId:string|null;moneyDelta:number;consumedItemIds:string[];createdItemIds:string[];releasedItemIds:string[];book:LifeBookReference|null;visit:{first:boolean;recorded:boolean}|null}
export interface LifeReadingRecord {actor:LifeActorRef;book:LifeBookReference;activityId:string;sourceEventId:string;completedAt:number;ownerAudience:OwnerAudienceProof|null}
export interface LifeVisitRecord {actor:LifeActorRef;placeId:string;version:number;firstActivityId:string;lastActivityId:string;firstVisitedAt:number;lastRecordedAt:number}
export interface LifeCQuote {quoteId:string;catalogRevision:3;ruleVersion:1;placeId:'harbor_tavern'|'blue_library';side:'buy';itemId:'bread_meal'|'herbal_tea'|'harbor_handbook';unitPrice:number;issuedAt:number;expiresAt:number}
export interface LifeCTradeTerms {side:'buy';quote:LifeCQuote;itemId:LifeCQuote['itemId'];quantity:number;maxTotalPrice:number;totalPrice:number}
export type LifeConsumableId='bait'|'sardine'|'mackerel'|'sea_bass'|'bread_meal'|'herbal_tea'|'grilled_fish';
export interface LifeCOutputReference {stepId:string;output:'preparedMeal'|'purchasedItems';index:number}
