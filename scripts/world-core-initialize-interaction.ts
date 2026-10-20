import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requirePrivateFile } from './postgresql/runtime.ts';
import { setWorldWriteGate } from './world-core-write-gate.ts';
import { openRuntimeStore } from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { bootstrapInteraction } from '../apps/platform/application/interaction-service.ts';
import { INTERACTION_REPOSITORY } from '../apps/platform/domains/interaction/repository.ts';
/** Explicit maintenance initialization of C's immutable template. No world/catalog/identity re-seed or feature publication. */
export async function initializeWorldInteraction(privateConnections:string){
 const identity=JSON.parse(await requirePrivateFile(join(privateConnections,'identity.json'))) as {instanceId:string;recoveryEpoch:string};
 const connectionString=(await requirePrivateFile(join(privateConnections,'application-database-url'))).trim();
 await setWorldWriteGate(privateConnections,false);
 const runtime=await openRuntimeStore({connectionString,...identity});
 try{await setWorldWriteGate(privateConnections,true);await runtime.transaction(ctx=>bootstrapInteraction(ctx));}
 finally{try{await setWorldWriteGate(privateConnections,false);}finally{await runtime.close();}}
 const verified=await openRuntimeStore({connectionString,...identity});
 try{const configuration=await verified.read(async ctx=>{const config=await ctx.repository(INTERACTION_REPOSITORY).getConfiguration(1);if(!config||await ctx.tasks.currentGeneration('interaction')<1||await ctx.tasks.currentGeneration('decision')<1)throw new Error('Interaction lifecycle is not initialized');return config;});return {templateId:configuration.templateId,templateVersion:configuration.templateVersion,configVersion:configuration.configVersion,writeGate:false};}finally{await verified.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const[directory,...extra]=process.argv.slice(2);(async()=>{if(!directory||extra.length)throw new Error('Usage: world-core-initialize-interaction.ts EXISTING_PRIVATE_CONNECTIONS');return initializeWorldInteraction(directory);})().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('world_core_interaction_initialization_failed\n');process.exitCode=1;});}
