import {MOVEMENT_POLICY_V1} from './types.ts';
/** Frozen V1 remains a valid persisted contract; only newly accepted moves choose current. */
export const MOVEMENT_POLICY_V2=Object.freeze({version:2,stepIntervalMs:500});
export const CURRENT_MOVEMENT_POLICY=MOVEMENT_POLICY_V2;
export const CURRENT_WORLD_RULE_INTERVAL_MS=250;
export function supportedMovementPolicy(version:number,stepIntervalMs:number):boolean {
 return [MOVEMENT_POLICY_V1,MOVEMENT_POLICY_V2].some(p=>p.version===version&&p.stepIntervalMs===stepIntervalMs);
}
