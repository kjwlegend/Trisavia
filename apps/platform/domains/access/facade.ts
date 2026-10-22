import type {M1ReadSession} from '../../contracts/store.ts';
import {authenticateCredential} from './authentication.ts';
import {agentRepository,credentialRepository,humanAccountRepository,managementBindingRepository,membershipRepository} from './repository.ts';
import {payloadHash} from './credentials.ts';
import {fail} from '../common/errors.ts';
import type {IdentityAccess,Principal} from './public.ts';
import {profileRepository} from '../profile/repository.ts';
import {projectAvatar,readAppearance,type LegacyAvatarIdentityReader} from '../profile/appearance.ts';
/** The composition root supplies the identity session from the SAME guarded PG client. */
export function createIdentityAccess<Context extends object>(options:{session:(context:Context)=>M1ReadSession;recoveryEpoch:string;now?:()=>number;legacyAvatarIdentity?:LegacyAvatarIdentityReader<M1ReadSession>;registerCommitValidation?:(context:Context,check:()=>Promise<void>)=>void}):IdentityAccess<Context>{
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
   issued.set(principal,context);await current(context,principal);
   // Recheck only identity/expiry at commit. A legitimate withdraw/block may change target visibility.
   options.registerCommitValidation?.(context,async()=>{await current(context,principal);});return principal;
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
   return Object.freeze({agentId,runtimeActive:agent.data.runtimeActive===true,runtimeVersion:Number(agent.data.runtimeVersion),membership:Object.freeze({worldId:String(member.data.worldId),version:member.version,state:String(member.data.state),ownerPaused:member.data.ownerPaused===true,ownerPauseVersion:Number(member.data.ownerPauseVersion),platformRestricted:member.data.platformRestricted===true,platformVersion:Number(member.data.platformVersion),sharingGeneration:Number(member.data.sharingGeneration??1)})});
  },
  async readPublicAgent(context,agentId){
   const tx=options.session(context),agent=await agentRepository(tx).get(agentId),profile=await profileRepository(tx).get(agentId),member=await membershipRepository(tx).get(agentId);
   if(!agent||!profile||!member||profile.data.published===null||member.data.state!=='joined'||member.data.platformRestricted!==false)return null;
   const published=profile.data.published;if(!published||typeof published!=='object'||Array.isArray(published))return null;
   const avatar=projectAvatar(published.avatar);if(typeof published.displayName!=='string'||!published.displayName.trim()||!avatar||!Number.isSafeInteger(profile.data.publishedVersion))return null;
   const appearance=await readAppearance(tx,agentId,avatar,options.legacyAvatarIdentity);if(!appearance)return null;
   return Object.freeze({agentId,publishedVersion:Number(profile.data.publishedVersion),displayName:published.displayName,appearance:Object.freeze(appearance)});
  },
 };
}
