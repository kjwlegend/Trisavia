import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {administrativeTarget} from './ws02-admin-target.ts';
import {publishFriendshipGuide} from '../apps/platform/application/perception-admin.ts';
import {catalogRepository} from '../apps/platform/domains/perception/repository.ts';
import {PERCEPTION_SCHEMA_VERSION} from '../apps/platform/domains/perception/schemas.ts';

/** Explicit paired guide maintenance only; no migration, seed, identity change or application start. */
export async function runFriendshipGuide(args:string[]){
 const selected=(flag:string)=>{const at=args.indexOf(flag);return at<0?undefined:args[at+1];};
 const expectedInstanceId=selected('--expected-instance'),expectedRecoveryEpoch=selected('--expected-epoch'),expectedCatalogRevision=selected('--expected-catalog-revision'),revision=selected('--revision'),before=selected('--expected-guide-version'),after=selected('--guide-version'),operationId=selected('--operation-id');
 if(!expectedInstanceId||!/^[A-Za-z0-9_-]{1,128}$/.test(expectedInstanceId)||!expectedRecoveryEpoch||!/^[A-Za-z0-9_-]{1,128}$/.test(expectedRecoveryEpoch)||!expectedCatalogRevision||!/^[A-Za-z0-9_-]{1,80}$/.test(expectedCatalogRevision)||revision!==`${expectedCatalogRevision}-friendship-1`||!before||!/^[1-9][0-9]{0,8}$/.test(before)||!after||Number(after)!==Number(before)+1||!operationId||!/^.{8,100}$/u.test(operationId))throw new Error('An explicit target, current revision, next guide version and operation ID are required');
 const {values,manifestPath,store}=await administrativeTarget(args,['--expected-instance','--expected-epoch','--expected-catalog-revision','--revision','--expected-guide-version','--guide-version','--operation-id'],async target=>{
  await target.read(async tx=>{const current=await catalogRepository(tx).get('current');if(!current||current.data.schemaVersion!==PERCEPTION_SCHEMA_VERSION)throw new Error('The supported catalog must already exist; this release never migrates it');});
 });
 try{
  const receipt=await publishFriendshipGuide(store,{actorId:values['--operator']!,operationId,expectedInstanceId,expectedRecoveryEpoch,expectedCatalogRevision,revision,expectedGuideVersion:Number(before),guideVersion:Number(after)});
  await writeFile(manifestPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return {status:'committed',instanceId:store.instanceId,receipt,manifestPath};
 }finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runFriendshipGuide(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('friendship_publication_failed; retain the target and recover using the original operation ID.\n');process.exitCode=1;});
