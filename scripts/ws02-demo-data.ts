import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { administrativeTarget } from './ws02-admin-target.ts';
import { seedWs02DemoData } from '../apps/platform/application/perception-seed.ts';
/** Explicit administrative seed on an existing current PG target only. */
export async function runSeed(args:string[]) {
 const {values,manifestPath,store}=await administrativeTarget(args);
 try{const manifest=await seedWs02DemoData(store,{actorId:values['--operator']!});await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return {status:'committed',instanceId:store.instanceId,counts:manifest.counts,agents:Array.isArray(manifest.agents)?manifest.agents.length:0,manifestPath};}finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runSeed(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('ws02_seed_failed; retain the target and inspect the original manifest or retry the same command.\n');process.exitCode=1;});
