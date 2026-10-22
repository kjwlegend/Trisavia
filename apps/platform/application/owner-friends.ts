import type {JsonObject,M1ReadSession,M1Store} from '../contracts/store.ts';
import {createIdentityAccess} from '../domains/access/facade.ts';
import {friendshipsRepository} from '../domains/relationships/repository.ts';
import {M1Error,fail,object,text} from '../domains/common/errors.ts';
import type {LegacyAvatarIdentityReader} from '../domains/profile/appearance.ts';

/** Owner observation only. Uses the current binding and the existing public-profile authority in one read scope. */
export function createOwnerFriendsReader(store:M1Store,options:{now?:()=>number;legacyAvatarIdentity?:LegacyAvatarIdentityReader<M1ReadSession>}={}){
 const now=options.now??Date.now,identity=createIdentityAccess<M1ReadSession>({session:session=>session,recoveryEpoch:store.recoveryEpoch,now,...(options.legacyAvatarIdentity?{legacyAvatarIdentity:options.legacyAvatarIdentity}:{})});
 return async(raw:unknown,token:unknown):Promise<JsonObject>=>{
  try{return await store.read(async tx=>{
   const input=object(raw,['agentId']),agentId=text(input.agentId,'agentId',8,100);
   const principal=await identity.authenticate(tx,token,['owner_session']);
   await identity.authorizeAgent(tx,principal,agentId);
   const friends:JsonObject[]=[];
   for(const row of await friendshipsRepository(tx).confirmedForAgent(agentId)){
    const {firstAgentId,secondAgentId,status,confirmedAt,firstConfirmationId,secondConfirmationId}=row.data;
    if(typeof firstAgentId!=='string'||typeof secondAgentId!=='string'||firstAgentId>=secondAgentId||status!=='confirmed'||!Number.isSafeInteger(confirmedAt)||Number(confirmedAt)<0||typeof firstConfirmationId!=='string'||!firstConfirmationId||typeof secondConfirmationId!=='string'||!secondConfirmationId||firstConfirmationId===secondConfirmationId)fail('source_unavailable',503,'The confirmed relationship source is invalid');
    const friendAgentId=firstAgentId===agentId?secondAgentId:firstAgentId;
    const profile=await identity.readPublicAgent(tx,friendAgentId);
    if(profile)friends.push({agentId:friendAgentId,relationshipId:row.id,status:'confirmed',confirmedAt:confirmedAt!,profile:{displayName:profile.displayName,appearance:{...profile.appearance},publishedVersion:profile.publishedVersion}});
   }
   return {agentId,friends,complete:true,asOf:now()};
  });}catch(error){if(error instanceof M1Error)throw error;fail('source_unavailable',503,'Friends are temporarily unavailable');}
 };
}
