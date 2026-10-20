/** Public identity contracts. No credential verifier, private account fields or storage DTOs escape. */
export type Principal = Readonly<{
 credentialId:string;credentialVersion:number;recoveryEpoch:string;authorizationVersion:string;
 expiresAt:number|null;
} & ({kind:'agent';agentId:string;runtimeVersion:number;source:'external_agent'}|{kind:'owner';ownerId:string;ownerAuthVersion:number;source:'owner'})>;
export interface AgentAuthority {readonly agentId:string;readonly authorizationVersion:string;readonly binding:Readonly<{id:string;version:number}>|null}
export interface AgentParticipation {
 readonly agentId:string;readonly runtimeActive:boolean;readonly runtimeVersion:number;
 readonly membership:Readonly<{worldId:string;version:number;state:string;ownerPaused:boolean;ownerPauseVersion:number;platformRestricted:boolean;platformVersion:number;sharingGeneration:number}>;
}
export interface PublicAgentView {readonly agentId:string;readonly publishedVersion:number;readonly displayName:string;readonly appearance:Readonly<{template:'basic';color:string}>}
/** Context is the current guarded transaction; principals must never be reused across contexts. */
export interface IdentityAccess<Context extends object>{
 authenticate(context:Context,bearer:unknown,allowedKinds:readonly ('runtime'|'owner_session')[]):Promise<Principal>;
 authorizeAgent(context:Context,principal:Principal,agentId:string):Promise<AgentAuthority>;
 readParticipation(context:Context,agentId:string):Promise<AgentParticipation>;
 /** Current public profile permission, without inventing an Agent or Owner principal. */
 readPublicAgent(context:Context,agentId:string):Promise<PublicAgentView|null>;
}
