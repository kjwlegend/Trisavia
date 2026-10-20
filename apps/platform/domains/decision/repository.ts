import type {JsonObject} from '../../contracts/store.ts';
import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
export type DecisionStage='invitation_response'|'feedback'|'acknowledgement';
export type DecisionStatus='pending'|'claimed'|'responded'|'resolved'|'expired'|'cancelled'|'failed';
export interface DecisionIntent {
 deduplicationKey:string;agentId:string;stage:DecisionStage;
 target:{kind:'invitation'|'activity';id:string;version:number};
 worldId:string;templateVersion:number;configVersion:number;deadline:number;
 allowedActions:string[];contextRefs:{kind:'invitation'|'artifact'|'activity';id:string;version:number}[];
}
/** Decision owns orchestration only. Original text and feedback remain in Interaction. */
export interface DecisionRequest extends DecisionIntent {
 id:string;version:number;recoveryEpoch:string;createdAt:number;status:DecisionStatus;
 claim:{id:string;commandId:string;authorizationVersion:string;claimedAt:number;reservationId:string}|null;
 response:{commandId:string;action:string|null;inputHash:string;respondedAt:number;executionId:string|null;executionOutcome:'completed'|'unknown'|'not_reported'}|null;
 resolution:{targetCommandId:string|null;domain:string;action:string;outcome:'committed'|'rejected'|'conflict'|'expired'|'no_action';result:JsonObject;eventIds:string[];resolvedAt:number}|null;
 invalidation:{code:string;at:number}|null;
}
export interface DecisionDispatchReservation {
 id:string;decisionId:string;agentId:string;periodStart:number;reservedAt:number;
 agentLimit:number;platformLimit:number;
}
export interface DecisionReader {
 get(id:string):Promise<DecisionRequest|undefined>;
 findByReason(agentId:string,deduplicationKey:string):Promise<DecisionRequest|undefined>;
 listForAgent(agentId:string,input:{afterId?:string;limit:number;statuses?:DecisionStatus[]}):Promise<DecisionRequest[]>;
 reservation(id:string):Promise<DecisionDispatchReservation|undefined>;
}
export interface DecisionRepository extends DecisionReader {
 save(request:DecisionRequest,expectedVersion:number|null):Promise<void>;
 /** Same ID/same reservation is idempotent. Atomic Agent+platform counters; never infer an Owner budget. */
 reserveDispatch(reservation:DecisionDispatchReservation):Promise<boolean>;
}
export const decisionRepository=defineRuntimeRepository<DecisionReader,DecisionRepository>('decision');
