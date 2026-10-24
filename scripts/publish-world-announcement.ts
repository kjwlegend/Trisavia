import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {administrativeTarget} from './ws02-admin-target.ts';
import {publishWelcomeAnnouncement,reviseWelcomeAnnouncement} from '../apps/platform/application/world-announcements.ts';
import {object,text} from '../apps/platform/domains/common/errors.ts';

// Explicit private connection + paired identity, expected instance/epoch, operator, new receipt file.
// Re-running against the same target with a new manifest returns the original publication unchanged.
export async function runWorldAnnouncement(args:string[]){
 const revising=args.includes('--edition');
 const {values,manifestPath,store}=await administrativeTarget(args,['--expected-instance','--expected-epoch',...(revising?['--edition','--operation-id','--expected-version']:[])]);
 try{
  const target={actorId:values['--operator']!,expectedInstanceId:values['--expected-instance']!,expectedRecoveryEpoch:values['--expected-epoch']!};
  let receipt;
  if(revising){
   if(values['--edition']!=='welcome-story-1'||values['--expected-version']!=='1')throw new Error('The exact first welcome-story revision is required');
   const story=object(JSON.parse(await readFile(new URL('../apps/platform/application/world-welcome-story.json',import.meta.url),'utf8')),['edition','title','body']);
   if(story.edition!=='welcome-story-1'||typeof story.body!=='string')throw new Error('The approved welcome-story edition differs');
   receipt=await reviseWelcomeAnnouncement(store,{...target,operationId:text(values['--operation-id'],'operation-id',8,100),expectedVersion:1,title:text(story.title,'title',1,180),body:story.body});
  }else receipt=await publishWelcomeAnnouncement(store,target);
  await writeFile(manifestPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return {receipt,manifestPath};
 }finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runWorldAnnouncement(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write((error?.code==='publication_conflict'?'world_announcement_publication_conflict':'world_announcement_publication_failed')+'; retain the explicit target and original publication identity.\n');process.exitCode=1;});
