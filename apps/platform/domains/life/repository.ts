import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {LifeActor,LifeActorRef,LifeActivity,LifeCatalog,LifeNpc,LifePlan,LifeSeat} from './types.ts';
export interface LifeReader {
 getCatalog():Promise<LifeCatalog|undefined>;getActor(actor:LifeActorRef):Promise<LifeActor|undefined>;
 getActivity(id:string):Promise<LifeActivity|undefined>;getPlan(id:string):Promise<LifePlan|undefined>;
 listResults(actor:LifeActorRef,limit:number):Promise<LifeActivity[]>;seats(placeId:string):Promise<LifeSeat[]>;
 getNpc(id:string):Promise<LifeNpc|undefined>;listNpcs():Promise<LifeNpc[]>;
 listBusyActors(options:{afterKey?:string;limit:number}):Promise<LifeActor[]>;
}
export interface LifeRepository extends LifeReader {
 lockActor(actor:LifeActorRef):Promise<void>;lockPlace(placeId:string):Promise<void>;
 saveActor(value:LifeActor,expected:number|null):Promise<void>;saveActivity(value:LifeActivity,expected:number|null):Promise<void>;savePlan(value:LifePlan,expected:number|null):Promise<void>;saveNpc(value:LifeNpc,expected:number|null):Promise<void>;
 activateCatalog(value:LifeCatalog):Promise<void>;
}
export const LIFE_REPOSITORY=defineRuntimeRepository<LifeReader,LifeRepository>('life');
