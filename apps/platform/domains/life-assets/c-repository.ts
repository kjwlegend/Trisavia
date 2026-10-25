import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {WalletActorRef} from '../wallet/life-wallet.ts';
import type {LifeCEffect,LifeCEffectKind,LifeCItemId,LifeCItemInstance,LifeCResources} from './c-types.ts';
export interface LifeCCommerceReader {
 resources(actorRef:WalletActorRef,options?:{itemIds?:readonly LifeCItemId[];limit?:number;afterId?:string}):Promise<LifeCResources>;
 getItem(actorRef:WalletActorRef,itemInstanceId:string):Promise<LifeCItemInstance|undefined>;
 availableItems(actorRef:WalletActorRef,options:{itemIds:readonly LifeCItemId[];limit:number}):Promise<LifeCItemInstance[]>;
 reservedCoins(actorRef:WalletActorRef):Promise<number>;
 getEffect(kind:LifeCEffectKind,sourceId:string):Promise<LifeCEffect|undefined>;
}
/** Inactive until the composition owner supplies real C sources and catalog3; no external mint/consent endpoint. */
export interface LifeCCommerceRepository extends LifeCCommerceReader {
 buyFromActivity(input:{actorRef:WalletActorRef;activityId:string}):Promise<LifeCEffect>;
 reserveActivity(input:{actorRef:WalletActorRef;activityId:string}):Promise<LifeCEffect>;
 settleActivity(input:{actorRef:WalletActorRef;activityId:string}):Promise<LifeCEffect>;
 reserveGift(input:{giftId:string}):Promise<LifeCEffect>;
 settleGift(input:{giftId:string}):Promise<LifeCEffect>;
}
export const LIFE_C_COMMERCE_REPOSITORY=defineRuntimeRepository<LifeCCommerceReader,LifeCCommerceRepository>('life.commerce.c');
