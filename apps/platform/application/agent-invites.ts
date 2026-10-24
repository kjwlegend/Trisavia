import type {JsonObject,M1ReadSession,StoredRow} from '../contracts/store.ts';
import type {AccessCredentialRow} from '../domains/access/authentication.ts';
import {credentialRepository,humanAccountRepository} from '../domains/access/repository.ts';
import {equalDigest,parseToken,verifier} from '../domains/access/credentials.ts';
import {fail} from '../domains/common/errors.ts';

export type AgentInviteState='active'|'expired'|'consumed'|'revoked';
export function agentInviteState(row:StoredRow,currentOwnerAuthority:boolean,at:number):AgentInviteState{
 return row.data.consumedByAttemptId?'consumed':!currentOwnerAuthority||!row.data.active?'revoked':typeof row.data.expiresAt==='number'&&row.data.expiresAt<=at?'expired':'active';
}
/** A valid proof can inspect its terminal state without acquiring Owner authority. */
export async function inspectAgentInvite(tx:M1ReadSession,raw:unknown,epoch:string,at:number):Promise<{row:AccessCredentialRow;state:AgentInviteState}>{
 const parsed=parseToken(raw),row=await credentialRepository(tx).get<AccessCredentialRow['data']>(parsed.id);
 if(!row||row.data.kind!=='invite'||!equalDigest(row.data.verifier,verifier('invite',parsed)))fail('authentication_failed',401,'Authentication failed');
 const owner=typeof row.data.ownerId==='string'?await humanAccountRepository(tx).get(row.data.ownerId):undefined;
 const current=row.data.epoch===epoch&&owner?.data.status==='active'&&owner.data.epoch===epoch&&owner.data.authVersion===row.data.ownerAuthVersion;
 const state=agentInviteState(row,Boolean(current),at);
 return {row,state};
}
export function requireActiveAgentInvite(state:AgentInviteState):void{
 if(state==='expired')fail('invite_expired',410,'This invitation has expired');
 if(state==='consumed')fail('invite_consumed',409,'This invitation has already been used');
 if(state==='revoked')fail('invite_revoked',410,'This invitation has been revoked');
}
/** The same safe metadata is used by Owner lists and bearer-only preview. */
export function agentInviteView(row:StoredRow,state:AgentInviteState,asOf:number):JsonObject{
 return {inviteId:row.id,version:row.version,state,active:state==='active',expiresAt:row.data.expiresAt??null,consumed:state==='consumed',limit:1,asOf};
}
