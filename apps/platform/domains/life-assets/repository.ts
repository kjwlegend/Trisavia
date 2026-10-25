import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {WalletActorRef} from '../wallet/life-wallet.ts';
import type {LifeCommerceEffect,LifeCommerceEffectKind,LifeItemId,LifeItemInstance,LifeResources} from './types.ts';
export interface LifeCommerceReader {
 getItem(actorRef:WalletActorRef,itemInstanceId:string):Promise<LifeItemInstance|undefined>;
 availableItems(actorRef:WalletActorRef,options:{itemIds:readonly LifeItemId[];limit:number}):Promise<LifeItemInstance[]>;
 resources(actorRef:WalletActorRef,options?:{itemIds?:readonly LifeItemId[];limit?:number;afterId?:string}):Promise<LifeResources>;
 getEffect(kind:LifeCommerceEffectKind,sourceId:string):Promise<LifeCommerceEffect|undefined>;
}
/** Internal transaction participants. No connection, commit, mint, transfer or HTTP command. */
export interface LifeCommerceRepository extends LifeCommerceReader {
 buyFromActivity(input:{actorRef:WalletActorRef;activityId:string}):Promise<LifeCommerceEffect>;
 sellFromActivity(input:{actorRef:WalletActorRef;activityId:string}):Promise<LifeCommerceEffect>;
 reserveFishing(input:{actorRef:WalletActorRef;sessionId:string}):Promise<LifeCommerceEffect>;
 startFishingCast(input:{actorRef:WalletActorRef;castId:string}):Promise<LifeCommerceEffect>;
 settleFishingCast(input:{actorRef:WalletActorRef;castId:string}):Promise<LifeCommerceEffect>;
 releaseFishing(input:{actorRef:WalletActorRef;sessionId:string}):Promise<LifeCommerceEffect>;
}
export const LIFE_COMMERCE_REPOSITORY=defineRuntimeRepository<LifeCommerceReader,LifeCommerceRepository>('life.commerce');
