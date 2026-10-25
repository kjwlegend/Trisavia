import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';import type {LifeActorRef} from './types.ts';import type {LifeReadingRecord,LifeVisitRecord} from './c-types.ts';
export interface LifeCObservationReader {getReading(actor:LifeActorRef,bookId:string,version:number):Promise<LifeReadingRecord|undefined>;getVisit(actor:LifeActorRef,placeId:string):Promise<LifeVisitRecord|undefined>}
export interface LifeCObservationRepository extends LifeCObservationReader {recordReading(activityId:string):Promise<LifeReadingRecord>;recordVisit(activityId:string):Promise<{first:boolean;recorded:boolean}>}
export const LIFE_C_OBSERVATION_REPOSITORY=defineRuntimeRepository<LifeCObservationReader,LifeCObservationRepository>('life.c_observation');
