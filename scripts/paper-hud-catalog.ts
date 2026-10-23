import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {administrativeTarget} from './ws02-admin-target.ts';
import {publishPaperHudCatalog} from '../apps/platform/application/perception-admin.ts';
import {catalogRepository} from '../apps/platform/domains/perception/repository.ts';

/** Application-role publication after physical migration, while the actual application remains stopped. */
export async function runPaperHudCatalog(args:string[]){
 const {values,manifestPath,store}=await administrativeTarget(args,['--expected-instance','--expected-epoch','--expected-catalog-revision','--revision','--expected-guide-version','--guide-version','--operation-id'],async target=>{await target.read(async tx=>{const current=await catalogRepository(tx).get('current');if(!current||![5,6].includes(Number(current.data.schemaVersion)))throw new Error('The current paper HUD predecessor or successor catalog is required');});});
 try{
  if(values['--expected-guide-version']!=='11'||values['--guide-version']!=='12')throw new Error('The exact next guide version is required');
  const receipt=await publishPaperHudCatalog(store,{actorId:values['--operator']!,operationId:values['--operation-id']!,expectedInstanceId:values['--expected-instance']!,expectedRecoveryEpoch:values['--expected-epoch']!,expectedCatalogRevision:values['--expected-catalog-revision']!,revision:values['--revision']!,expectedGuideVersion:11,guideVersion:12});
  await writeFile(manifestPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return {status:'committed',receipt,manifestPath};
 }finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runPaperHudCatalog(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('paper_hud_catalog_publication_failed; retain the target and original operation ID.\n');process.exitCode=1;});
