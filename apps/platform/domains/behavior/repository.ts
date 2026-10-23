import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {BehaviorCoverage,BehaviorListInput,BehaviorRecord,BehaviorRecordDraft,BehaviorScope} from './types.ts';
export interface BehaviorReader {
 visibilityVersion(agentId:string):Promise<number>;
 getCoverage():Promise<BehaviorCoverage[]>;
 cut():Promise<{maxSequence:number;asOf:number}>;
 get(id:string):Promise<BehaviorRecord|undefined>;
 list(input:BehaviorListInput):Promise<BehaviorRecord[]>;
}
export interface BehaviorRepository extends BehaviorReader {
 invalidateVisibility(agentIds:readonly string[]):Promise<void>;
 append(draft:BehaviorRecordDraft):Promise<BehaviorRecord>;
 /** Same transaction holds the cadence lock until the eventual event/projection commit. */
 shouldRecordIdle(agentId:string,occurredAt:number):Promise<boolean>;
 /** Maintenance role only; the application role has no INSERT/UPDATE on coverage. */
 activateCoverage(scope:BehaviorScope,fromAt:number):Promise<BehaviorCoverage>;
}
export const BEHAVIOR_REPOSITORY=defineRuntimeRepository<BehaviorReader,BehaviorRepository>('behavior');
