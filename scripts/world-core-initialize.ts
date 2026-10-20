import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateFile, readRuntime, requirePrivateFile, type RuntimeConfig } from './postgresql/runtime.ts';
import { createWorldDatabase } from './world-core-database.ts';
import { prepareWorldCoreDatabase } from './world-core-prepare.ts';
import { openPostgresStore, setPostgresWriteGate } from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { openRuntimeStore } from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { bootstrapPlatformCatalog, verifyApplicationReadiness } from '../apps/platform/application/bootstrap.ts';
import { bootstrapWorld, verifyWorldReadiness } from '../apps/platform/application/world-service.ts';

/** Fresh explicit N1 provisioning, never called by the application or readiness. Candidate data is retained on failure. */
export async function initializeWorldCore(input:{runtime:RuntimeConfig;database:string;directory:string;creator:'a'|'b'|'c'|'td';port:number}){
 const expectedPort={a:18894,b:0,c:18895,td:18893}[input.creator];if(input.port!==expectedPort)throw new Error('Use the explicit allocated World port');
 const made=await createWorldDatabase(input.runtime,input.database,input.directory,input.creator);
 const identity={instanceId:'instance_'+randomUUID(),recoveryEpoch:'epoch_'+randomUUID()};
 const prepared=await prepareWorldCoreDatabase(input.runtime,made.privateConnections,identity);
 const maintenance={connectionString:(await requirePrivateFile(join(made.privateConnections,'migration-database-url'))).trim(),...identity};
 const options={...identity,connectionString:(await requirePrivateFile(join(made.privateConnections,'application-database-url'))).trim()};
 const legacy=await openPostgresStore(options),runtime=await openRuntimeStore(options);
 try{
  await setPostgresWriteGate(maintenance,{enabled:true});await bootstrapPlatformCatalog(legacy);
  await runtime.transaction(async ctx=>{await bootstrapWorld(ctx);for(const domain of ['decision','interaction'])if(await ctx.tasks.currentGeneration(domain)===0)await ctx.tasks.advanceGeneration(domain,0);});
 }finally{await setPostgresWriteGate(maintenance,{enabled:false});await legacy.close();await runtime.close();}
 const checkLegacy=await openPostgresStore(options),checkRuntime=await openRuntimeStore(options);
 try{await verifyApplicationReadiness(checkLegacy);await checkRuntime.read(ctx=>verifyWorldReadiness(ctx));}finally{await checkLegacy.close();await checkRuntime.close();}
 const identityPath=join(made.privateConnections,'identity.json'),environmentPath=join(made.privateConnections,'backend.env');
 await privateFile(environmentPath,`M1_HOST=127.0.0.1\nM1_PORT=${input.port}\nM1_EMAIL_MODE=experience\nM1_POSTGRES_CONNECTION_FILE=${join(made.privateConnections,'application-database-url')}\nM1_IDENTITY_PATH=${identityPath}\nWORLD_CORE_ENABLED=1\n`);
 return {...prepared,...identity,privateConnections:made.privateConnections,identityPath,environmentPath,writeGate:false,initialized:['platform-catalog','world'],uninitialized:['interaction-template'],ready:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [runtime,database,directory,creator,port,...extra]=process.argv.slice(2);(async()=>{if(!runtime||!database||!directory||!creator||!['a','b','c','td'].includes(creator)||port===undefined||extra.length)throw new Error('Usage: world-core-initialize.ts RUNTIME_JSON NEW_DATABASE NEW_PRIVATE_DIRECTORY CREATOR PORT');return initializeWorldCore({runtime:await readRuntime(runtime),database,directory,creator:creator as 'a'|'b'|'c'|'td',port:Number(port)});})().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('world_core_initialization_failed; target retained, inspect private manifest\n');process.exitCode=1;});}
