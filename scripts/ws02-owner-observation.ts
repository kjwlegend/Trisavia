import { readFile, lstat, writeFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openM1Store } from '../apps/platform/infrastructure/relational/sqlite-store.ts';
import { authorizeWs02SeedOwnerObservation } from '../apps/platform/application/perception-owner-observation.ts';

/** Explicit administrative operation. No default DB, network, runtime credential or clock override. */
export async function runOwnerObservation(args:string[]) {
 const values:Record<string,string>={};for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!flag||!value||!['--database','--identity','--operator','--manifest','--source-administrator','--operation-id'].includes(flag)||values[flag])throw new Error('Explicit database, identity, operator and new manifest are required');values[flag]=value;}
 if(!values['--operator']||!/^[A-Za-z0-9_.:@-]{1,100}$/.test(values['--operator']))throw new Error('Explicit administrative actor is required');
 if(!values['--source-administrator']||!/^[A-Za-z0-9_.:@-]{1,100}$/.test(values['--source-administrator'])||!values['--operation-id']||!/^.{8,100}$/u.test(values['--operation-id']))throw new Error('Explicit source administrator and operation ID are required');
 for(const flag of ['--database','--identity','--manifest'])if(!values[flag]||!isAbsolute(values[flag]!))throw new Error('Absolute paths are required');
 const databasePath=await realpath(values['--database']!),identityPath=await realpath(values['--identity']!),manifestPath=resolve(values['--manifest']!);
 if(databasePath===identityPath||manifestPath===databasePath||manifestPath===identityPath||(await realpath(dirname(manifestPath)))!==dirname(manifestPath))throw new Error('Unsafe manifest path');
 if(!(await lstat(databasePath)).isFile()||!(await lstat(identityPath)).isFile())throw new Error('Existing database and paired identity files are required');
 try{await lstat(manifestPath);throw new Error('Manifest must be a new file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const identity=JSON.parse(await readFile(identityPath,'utf8')) as Record<string,unknown>;
 if(identity.version!==1||typeof identity.instanceId!=='string'||!identity.instanceId.length||typeof identity.recoveryEpoch!=='string'||!identity.recoveryEpoch.length)throw new Error('Existing paired identity is required');
 // This administrative command must not exercise the store's explicit recovery
 // configuration behavior. Inspect the existing authority boundary without WAL
 // setup, migrations, epoch updates, or an implicit new database first.
 const inspection=new DatabaseSync(databasePath,{readOnly:true,allowExtension:false,enableDoubleQuotedStringLiterals:false});
 try {
  const schema=inspection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();if(schema?.version!==6)throw new Error('Existing schema-6 perception data is required; this command does not migrate or seed');
  const paired=inspection.prepare('SELECT instance_id, recovery_epoch FROM instance_state WHERE singleton = 1').get();
  if(!paired||paired.instance_id!==identity.instanceId||paired.recovery_epoch!==identity.recoveryEpoch)throw new Error('Database and identity are not paired');
 } finally {inspection.close();}
 const store=openM1Store({databasePath,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch});
 try{const manifest=authorizeWs02SeedOwnerObservation(store,{actorId:values['--operator'],operationId:values['--operation-id']!,expectedSourceAdministrator:values['--source-administrator']!});await writeFile(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx',mode:0o600});return {status:'committed',instanceId:store.instanceId,receipt:manifest,manifestPath};}finally{store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runOwnerObservation(process.argv.slice(2)).then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(()=>{process.stderr.write('ws02_owner_observation_failed; retain the database and inspect the original manifest or retry idempotently.\n');process.exitCode=1;});
