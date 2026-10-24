import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {administrativeTarget} from './ws02-admin-target.ts';
import {publishWelcomeAnnouncement} from '../apps/platform/application/world-announcements.ts';

// Explicit private connection + paired identity, expected instance/epoch, operator, new receipt file.
// Re-running against the same target with a new manifest returns the original publication unchanged.
export async function runWorldAnnouncement(args:string[]){
 const {values,manifestPath,store}=await administrativeTarget(args,['--expected-instance','--expected-epoch']);
 try{
  const receipt=await publishWelcomeAnnouncement(store,{actorId:values['--operator']!,expectedInstanceId:values['--expected-instance']!,expectedRecoveryEpoch:values['--expected-epoch']!});
  await writeFile(manifestPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return {receipt,manifestPath};
 }finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runWorldAnnouncement(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write((error?.code==='publication_conflict'?'world_announcement_publication_conflict':'world_announcement_publication_failed')+'; retain the explicit target and original publication identity.\n');process.exitCode=1;});
