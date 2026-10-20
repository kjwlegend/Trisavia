import type {JsonObject,M1ReadSession,StoredRow} from '../../contracts/store.ts';
import {parseToken,equalDigest,verifier} from './credentials.ts';
import {agentRepository,credentialRepository,humanAccountRepository} from './repository.ts';
import {fail} from '../common/errors.ts';
export interface AccessCredential extends JsonObject {
 kind:string;fingerprint:string;verifier:string;epoch:string;active:boolean;
 agentId:string|null;ownerId:string|null;expiresAt:number|null;
}
export type AccessCredentialRow=StoredRow<AccessCredential>;
/** Identity-owned credential verification. This raw row is internal to access/M1 adapters. */
export async function authenticateCredential(tx:M1ReadSession,raw:unknown,kinds:readonly string[],options:{recoveryEpoch:string;now:()=>number}):Promise<AccessCredentialRow>{
 const parsed=parseToken(raw),credential=await credentialRepository(tx).get<AccessCredential>(parsed.id);
 if(!credential||!equalDigest(credential.data.verifier,verifier(typeof credential.data.verifierKind==='string'?credential.data.verifierKind:credential.data.kind,parsed))||!credential.data.active)fail('authentication_failed',401,'Authentication failed');
 if(credential.data.epoch!==options.recoveryEpoch)fail('restore_access_unsupported',403,'Identity is retained; access cannot be restored from old credentials');
 if(credential.data.expiresAt!==null&&credential.data.expiresAt<=options.now())fail('authentication_failed',401,'Authentication failed');
 if(!kinds.includes(credential.data.kind))fail('insufficient_scope',403,'Credential does not permit this action');
 if(['owner_session','owner_recovery','invite'].includes(credential.data.kind)){
  const owner=await humanAccountRepository(tx).get(credential.data.ownerId??'');
  if(!owner||owner.data.status!=='active'||owner.data.epoch!==options.recoveryEpoch||owner.data.authVersion!==credential.data.ownerAuthVersion)fail('authentication_failed',401,'Authentication failed');
 }
 if(credential.data.kind==='runtime'){
  const agent=await agentRepository(tx).get(credential.data.agentId??'');
  if(!agent||agent.data.runtimeVersion!==credential.data.runtimeVersion)fail('authentication_failed',401,'Authentication failed');
 }
 if(['bootstrap','handoff','setup'].includes(credential.data.kind)){
  const owner=await humanAccountRepository(tx).get(credential.data.ownerId??'');
  if(!owner||owner.data.status!=='pending_setup')fail('authentication_failed',401,'Authentication failed');
  if(credential.data.kind!=='bootstrap'&&owner.data.handoffGeneration!==credential.data.handoffGeneration)fail('authentication_failed',401,'Authentication failed');
 }
 return credential;
}
