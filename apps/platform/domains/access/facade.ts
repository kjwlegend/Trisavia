import type {M1ReadSession} from '../../contracts/store.ts';
import {authenticateCredential} from './authentication.ts';
import {agentRepository,credentialRepository,humanAccountRepository,managementBindingRepository,membershipRepository} from './repository.ts';
import {payloadHash} from './credentials.ts';
import {fail} from '../common/errors.ts';
import type {IdentityAccess,Principal} from './public.ts';
/** The composition root supplies the identity session from the SAME guarded PG client. */
export function createIdentityAccess<Context extends object>(options:{session:(context:Context)=>M1ReadSession;recoveryEpoch:string;now?:()=>number}):IdentityAccess<Context>{
 const now=options.now??Date.now,issued=new WeakMap<Principal,Context>();
 async function current(context:Context,principal:Principal){
  if(issued.get(principal)!==context)fail('authentication_failed',401,'Authenticate in the current transaction');
  const tx=options.session(context),credential=await credentialRepository(tx).get(principal.credentialId);
  if(!credential||!credential.data.active||credential.version!==principal.credentialVersion||credential.data.epoch!==options.recoveryEpoch||typeof credential.data.expiresAt==='number'&&credential.data.expiresAt<=now())fail('authentication_failed',401,'Authentication failed');
  if(principal.kind==='agent'){
   const agent=await agentRepository(tx).get(principal.agentId);
   if(credential.data.kind!=='runtime'||credential.data.agentId!==principal.agentId||!agent||agent.data.runtimeActive!==true||agent.data.runtimeVersion!==principal.runtimeVersion)fail('authentication_failed',401,'Authentication failed');
  }else{
   const owner=await humanAccountRepository(tx).get(principal.ownerId);
   if(credential.data.kind!=='owner_session'||credential.data.ownerId!==principal.ownerId||!owner||owner.data.status!=='active'||owner.data.epoch!==options.recoveryEpoch||owner.data.authVersion!==principal.ownerAuthVersion)fail('authentication_failed',401,'Authentication failed');
  }
  return tx;
 }
 return {
  async authenticate(context,bearer,allowedKinds){
   const tx=options.session(context),row=await authenticateCredential(tx,bearer,allowedKinds,{recoveryEpoch:options.recoveryEpoch,now});
   const common={credentialId:row.id,credentialVersion:row.version,recoveryEpoch:options.recoveryEpoch,expiresAt:row.data.expiresAt??null,authorizationVersion:payloadHash({credentialId:row.id,version:row.version,epoch:options.recoveryEpoch,runtimeVersion:row.data.runtimeVersion??null,ownerAuthVersion:row.data.ownerAuthVersion??null})};
   const principal:Principal=Object.freeze(row.data.kind==='runtime'?{...common,kind:'agent',agentId:row.data.agentId!,runtimeVersion:Number(row.data.runtimeVersion),source:'external_agent'}:{...common,kind:'owner',ownerId:row.data.ownerId!,ownerAuthVersion:Number(row.data.ownerAuthVersion),source:'owner'});
   issued.set(principal,context);await current(context,principal);return principal;
  },
  async authorizeAgent(context,principal,agentId){
   const tx=await current(context,principal);
   if(principal.kind==='agent'&&principal.agentId!==agentId)fail('target_not_accessible',404,'Target is not accessible');
   const binding=principal.kind==='owner'?(await managementBindingRepository(tx).pageByActiveAndAgentIdAndOwnerId(true,agentId,principal.ownerId,{limit:1}))[0]:undefined;
   if(principal.kind==='owner'&&!binding||!await agentRepository(tx).get(agentId))fail('target_not_accessible',404,'Target is not accessible');
   const reference=binding?{id:binding.id,version:binding.version}:null;
   return Object.freeze({agentId,binding:reference,authorizationVersion:payloadHash({principal:principal.authorizationVersion,agentId,binding:reference})});
  },
  async readParticipation(context,agentId){
   const tx=options.session(context),agent=await agentRepository(tx).get(agentId),member=await membershipRepository(tx).get(agentId);
   if(!agent||!member)fail('target_not_accessible',404,'Target is not accessible');
   return Object.freeze({agentId,runtimeActive:agent.data.runtimeActive===true,runtimeVersion:Number(agent.data.runtimeVersion),membership:Object.freeze({worldId:String(member.data.worldId),version:member.version,state:String(member.data.state),ownerPaused:member.data.ownerPaused===true,ownerPauseVersion:Number(member.data.ownerPauseVersion),platformRestricted:member.data.platformRestricted===true,platformVersion:Number(member.data.platformVersion)})});
  },
 };
}
