import {fail} from '../common/errors.ts';
import type {FriendshipInvitationState} from './types.ts';

export type RelationshipOrder = 'newest' | 'oldest';
export interface RelationshipAnchor {at:number;id:string}
export interface RelationshipPage {
 afterId?:string;
 /** Time/ID seek is opt-in; legacy named source readers keep their ID order. */
 order?:RelationshipOrder;
 after?:RelationshipAnchor;
 search?:string;
 limit:number;
}
export interface InvitationPage extends RelationshipPage {
 direction?:'incoming'|'outgoing';
 state?:FriendshipInvitationState;
 asOf?:number;
}
export function relationshipSearch(raw:unknown):string {
 if(raw===undefined)return '';
 if(typeof raw!=='string'||[...raw].length>100||raw.includes('\0'))fail('invalid_request',400,'Search must be at most 100 Unicode characters');
 return raw.trim().toLowerCase();
}
export function relationshipOrder(raw:unknown):RelationshipOrder {
 if(raw===undefined)return 'newest';
 if(raw!=='newest'&&raw!=='oldest')fail('invalid_request',400,'Choose newest or oldest order');
 return raw;
}
export function relationshipState(raw:unknown):FriendshipInvitationState|undefined {
 if(raw===undefined||raw==='all')return undefined;
 if(typeof raw!=='string'||!['pending','accepted','declined','cancelled','expired'].includes(raw))fail('invalid_request',400,'Choose a friendship request state');
 return raw as FriendshipInvitationState;
}
export const matchesRelationshipSearch=(search:string,agentId:string,displayName:string)=>!search||agentId.toLowerCase().includes(search)||displayName.toLowerCase().includes(search);
export const compareRelationshipAnchor=(a:RelationshipAnchor,b:RelationshipAnchor)=>a.at-b.at||(a.id<b.id?-1:a.id>b.id?1:0);
export function decodeRelationshipAnchor(raw:string):RelationshipAnchor {
 try{const value=JSON.parse(raw);if(Number.isSafeInteger(value.at)&&value.at>=0&&typeof value.id==='string'&&value.id.length>0&&value.id.length<=100)return {at:value.at,id:value.id};}catch{}
 return fail('invalid_cursor',409,'Continuation is invalid; restart the current query');
}
