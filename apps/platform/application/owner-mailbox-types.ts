import type {JsonObject,M1ReadSession} from '../contracts/store.ts';
import type {ObjectRef} from '../domains/perception/protocol.ts';

export type OwnerMailboxCategory='correspondence'|'message'|'notification'|'announcement'|'event';
export interface OwnerMailboxItem extends JsonObject {
 key:string;category:OwnerMailboxCategory;eventKind:'plan'|'occurrence'|null;
 source:{id:string;label:string|null};ref:ObjectRef|null;version:number;
 title:string|null;summary:string|null;counterparty:{agentId:string|null;displayName:string|null}|null;
 occurredAt:number|null;timeKind:'created'|'received'|'published'|'scheduled'|'occurred'|'unknown';
 status:{code:string;label:string}|null;
 detail:{kind:'exchange';invitationId:string}|{kind:'perception';channel:'inbox'|'world';ref:ObjectRef}|null;
}
/** Internal same-snapshot projection; it never grants a caller authority or returns source bodies. */
export interface OwnerMailboxPerceptionContext {
 authorizationVersion:string;
 legacyNotifications:boolean;
 sourceIds:string[];
 project(ref:ObjectRef,channel:'inbox'|'world'):Promise<OwnerMailboxItem|null>;
}
export type OwnerMailboxPerceptionReader=(session:M1ReadSession,token:unknown,agentId:string)=>Promise<OwnerMailboxPerceptionContext>;
export const ownerMailboxKey=(ref:ObjectRef):string=>`perception:${ref.moduleId}:${ref.type}:${ref.id}`;
