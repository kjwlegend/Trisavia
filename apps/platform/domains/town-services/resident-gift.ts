import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
export interface ResidentGift {id:string;agentId:string;createdAt:number;sourceOperationId:string|null;initiatorKind:'agent'|'administrator';initiatorId:string}
export interface ResidentGiftReader {get(agentId:string):Promise<ResidentGift|undefined>;byId(id:string):Promise<ResidentGift|undefined>}
export interface ResidentGiftRepository extends ResidentGiftReader {ensure(value:ResidentGift):Promise<ResidentGift>}
export const RESIDENT_GIFT_REPOSITORY=defineRuntimeRepository<ResidentGiftReader,ResidentGiftRepository>('town_services.resident_gift');
