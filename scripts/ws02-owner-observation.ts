import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { administrativeTarget } from './ws02-admin-target.ts';
import { authorizeWs02SeedOwnerObservation } from '../apps/platform/application/perception-owner-observation.ts';
/** Explicit source-scoped command; paired PG preflight precedes every write. */
export async function runOwnerObservation(args:string[]) {
 // Validate source actor fields before any target is opened.
 const selected=(flag:string)=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};const source=selected('--source-administrator'),operationId=selected('--operation-id');
 if(!source||!/^[A-Za-z0-9_.:@-]{1,100}$/.test(source)||!operationId||!/^.{8,100}$/u.test(operationId))throw new Error('Explicit source administrator and operation ID are required');
 const {values,manifestPath,store}=await administrativeTarget(args,['--source-administrator','--operation-id']);
 try{const receipt=await authorizeWs02SeedOwnerObservation(store,{actorId:values['--operator']!,operationId,expectedSourceAdministrator:source});await writeFile(manifestPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return {status:'committed',instanceId:store.instanceId,receipt,manifestPath};}finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runOwnerObservation(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('ws02_owner_observation_failed; retain the target and recover using the original operation ID.\n');process.exitCode=1;});
