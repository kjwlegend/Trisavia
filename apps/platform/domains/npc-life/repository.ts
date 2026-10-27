import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {NpcLifeDefinition,CarePoint,CareIntroduction,CareFact} from './types.ts';
export interface NpcLifeReader {
 getDefinition():Promise<NpcLifeDefinition|undefined>;
 getPoint(id:string):Promise<CarePoint|undefined>;listPoints():Promise<CarePoint[]>;
 getIntroduction(id:string):Promise<CareIntroduction|undefined>;
 findIntroduction(planId:string,pointId:string):Promise<CareIntroduction|undefined>;
 lastCare(agentId:string,pointId:string):Promise<CareFact|undefined>;
 getCare(activityId:string):Promise<CareFact|undefined>;
}
export interface NpcLifeRepository extends NpcLifeReader {
 activateDefinition(value:NpcLifeDefinition):Promise<void>;
 lockPoint(id:string):Promise<void>;
 savePoint(value:CarePoint,expected:number|null):Promise<void>;
 saveIntroduction(value:CareIntroduction,expected:number|null):Promise<void>;
 insertCare(value:CareFact):Promise<void>;
}
export const NPC_LIFE_REPOSITORY=defineRuntimeRepository<NpcLifeReader,NpcLifeRepository>('npc_life');
