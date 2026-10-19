import { readFile, lstat, writeFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openM1Store } from '../apps/platform/infrastructure/relational/sqlite-store.ts';
import { seedWs02DemoData } from '../apps/platform/application/perception-seed.ts';

/** Explicit administrative operation. No default DB, network, runtime credential or clock override. */
export async function runSeed(args:string[]) {
 const values:Record<string,string>={};for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!flag||!value||!['--database','--identity','--operator','--manifest'].includes(flag)||values[flag])throw new Error('Explicit database, identity, operator and new manifest are required');values[flag]=value;}
 for(const flag of ['--database','--identity','--manifest'])if(!values[flag]||!isAbsolute(values[flag]!))throw new Error('Absolute paths are required');
 const databasePath=await realpath(values['--database']!),identityPath=await realpath(values['--identity']!),manifestPath=resolve(values['--manifest']!);
 if(manifestPath===databasePath||manifestPath===identityPath||(await realpath(dirname(manifestPath)))!==dirname(manifestPath))throw new Error('Unsafe manifest path');
 try{await lstat(manifestPath);throw new Error('Manifest must be a new file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const identity=JSON.parse(await readFile(identityPath,'utf8')) as Record<string,unknown>;
 if(identity.version!==1||typeof identity.instanceId!=='string'||typeof identity.recoveryEpoch!=='string')throw new Error('Existing paired identity is required');
 const store=openM1Store({databasePath,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch});
 try{const manifest=seedWs02DemoData(store,{actorId:values['--operator']??''});await writeFile(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx',mode:0o600});return {status:'committed',instanceId:store.instanceId,counts:manifest.counts,agents:Array.isArray(manifest.agents)?manifest.agents.length:0,manifestPath};}finally{store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runSeed(process.argv.slice(2)).then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(()=>{process.stderr.write('ws02_seed_failed; retain the database and inspect the original manifest or retry idempotently.\n');process.exitCode=1;});
