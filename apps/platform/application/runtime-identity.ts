import type {RuntimeReadContext,RuntimeTransaction} from '../contracts/runtime-store.ts';
import {createIdentityAccess} from '../domains/access/facade.ts';
import {runtimeIdentitySession} from '../infrastructure/postgresql/runtime-store.ts';
/** This is composition code: the guarded identity resolver and commit hook never enter a business DTO. */
export function createRuntimeIdentity(recoveryEpoch:string,now:()=>number=Date.now){
 return createIdentityAccess<RuntimeReadContext>({session:runtimeIdentitySession,recoveryEpoch,now,registerCommitValidation(ctx,check){if('validateBeforeCommit'in ctx)(ctx as RuntimeTransaction).validateBeforeCommit(async()=>{await check();});}});
}
