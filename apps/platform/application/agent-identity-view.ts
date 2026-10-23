import type {JsonObject,StoredRow} from '../contracts/store.ts';

export function knownTimestamp(value:unknown,serverTime:number):number|null {
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=serverTime?value:null;
}
/** Source timestamps only. Neither account access nor Avatar creation proves first world membership. */
export function agentIdentityView(agent:StoredRow,membership:StoredRow,serverTime:number):JsonObject {
 const createdAt=knownTimestamp(agent.data.createdAt,serverTime),firstWorldJoinedAt=knownTimestamp(membership.data.firstJoinedAt,serverTime);
 return {version:1,createdAt,firstWorldJoinedAt,serverTime,ageDays:createdAt===null?null:Math.floor((serverTime-createdAt)/86400000),ageBasis:'identity_created_at'};
}
