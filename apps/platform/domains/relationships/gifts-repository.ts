import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {RelationshipGift} from './gifts-types.ts';
export interface RelationshipGiftReader {
 get(id:string):Promise<RelationshipGift|undefined>;
 list(agentId:string,options:{direction:'sent'|'received';afterId?:string;limit:number}):Promise<RelationshipGift[]>;
 pendingForSender(agentId:string,limit:number):Promise<RelationshipGift[]>;
 pending(options:{afterId?:string;limit:number}):Promise<RelationshipGift[]>;
}
export interface RelationshipGiftRepository extends RelationshipGiftReader {
 lock(id:string):Promise<void>;lockSender(agentId:string):Promise<void>;
 save(value:RelationshipGift,expected:number|null):Promise<void>;
}
export const RELATIONSHIP_GIFT_REPOSITORY=defineRuntimeRepository<RelationshipGiftReader,RelationshipGiftRepository>('relationships.gifts');
