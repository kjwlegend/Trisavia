import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {LifeFishingSession,LifeFishingCast} from './b-types.ts';
export interface LifeFishingReader {
 getSession(id:string):Promise<LifeFishingSession|undefined>;
 getCast(id:string):Promise<LifeFishingCast|undefined>;
 listCasts(sessionId:string):Promise<LifeFishingCast[]>;
}
export interface LifeFishingRepository extends LifeFishingReader {
 saveSession(value:LifeFishingSession,expected:number|null):Promise<void>;
 saveCast(value:LifeFishingCast,expected:number|null):Promise<void>;
}
export const LIFE_FISHING_REPOSITORY=defineRuntimeRepository<LifeFishingReader,LifeFishingRepository>('life.fishing');
