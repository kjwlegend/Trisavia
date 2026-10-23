import type {RuntimeReadContext,RuntimeTransaction} from '../contracts/runtime-store.ts';
import {createIdentityAccess} from '../domains/access/facade.ts';
import {runtimeIdentitySession} from '../infrastructure/postgresql/runtime-store.ts';
import type {M1ReadSession} from '../contracts/store.ts';
import type {LegacyAvatarIdentityReader} from '../domains/profile/appearance.ts';
import type {IdentityAccess,OwnerObservationDomain} from '../domains/access/public.ts';
/** This is composition code: the guarded identity resolver and commit hook never enter a business DTO. */
export function createRuntimeIdentity(recoveryEpoch:string,now:()=>number=Date.now,legacyAvatarIdentity?:LegacyAvatarIdentityReader<M1ReadSession>){
 return createIdentityAccess<RuntimeReadContext>({session:runtimeIdentitySession,recoveryEpoch,now,...(legacyAvatarIdentity?{legacyAvatarIdentity}:{}),registerCommitValidation(ctx,check){if('validateBeforeCommit'in ctx)(ctx as RuntimeTransaction).validateBeforeCommit(async()=>{await check();});}});
}
/** A source records this proof in its existing transaction; it grants no HTTP access by itself. */
export function createRuntimeObservation(identity:IdentityAccess<RuntimeReadContext>){
 return {async capture(context:RuntimeReadContext,agentId:string,sourceDomain:OwnerObservationDomain){return await identity.captureOwnerObservation?.(context,agentId,sourceDomain)??null;}};
}
