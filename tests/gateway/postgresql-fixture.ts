import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorldDatabase,dropWorldTestDatabase} from '../../scripts/world-core-database.ts';
import {prepareWorldCoreDatabase} from '../../scripts/world-core-prepare.ts';
import {readRuntime,requirePrivateFile} from '../../scripts/postgresql/runtime.ts';
import {openPostgresRuntimeStore} from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {openPostgresStore,setPostgresWriteGate} from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {bootstrapPlatformCatalog} from '../../apps/platform/application/bootstrap.ts';
import {bootstrapWorld} from '../../apps/platform/application/world-service.ts';
import {bootstrapInteraction} from '../../apps/platform/application/interaction-service.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {createRuntimeIdentity} from '../../apps/platform/application/runtime-identity.ts';
/** Each case owns a fresh A database, least-privilege application pools, and manifest/OID checked cleanup. */
export async function gatewayFixture(){
 const runtimeFile=process.env.WORLD_CORE_TEST_RUNTIME;if(!runtimeFile)throw new Error('An explicit private World PG test runtime is required');
 const config=await readRuntime(runtimeFile),directory=await mkdtemp(join(tmpdir(),'world-core-a-')),database='world_core_a_'+randomBytes(10).toString('hex');
 const identity={instanceId:'instance_'+randomUUID(),recoveryEpoch:'epoch_'+randomUUID()};let connections:string|undefined;let clock=Date.UTC(2026,9,21);
 const stores=new Set<{close():Promise<void>}>();
 const dispose=async()=>{for(const store of stores)await store.close();stores.clear();if(connections)await dropWorldTestDatabase(config,connections,'a');await rm(directory,{recursive:true,force:true});};
 try{
  connections=(await createWorldDatabase(config,database,join(directory,'connections'),'a')).privateConnections;
  await prepareWorldCoreDatabase(config,connections,identity);
  const maintenance={...identity,connectionString:(await requirePrivateFile(join(connections,'migration-database-url'))).trim()};
  const options={...identity,connectionString:(await requirePrivateFile(join(connections,'application-database-url'))).trim()};
  const runtime=await openPostgresRuntimeStore({...options,now:()=>clock});stores.add(runtime);const legacy=await openPostgresStore(options);stores.add(legacy);
  await setPostgresWriteGate(maintenance,{enabled:true});await bootstrapPlatformCatalog(legacy);
  await runtime.transaction(async ctx=>{await bootstrapWorld(ctx);await bootstrapInteraction(ctx);if(await ctx.tasks.currentGeneration('decision')===0)await ctx.tasks.advanceGeneration('decision',0);});
  const service=createM1Service(legacy,{now:()=>clock,email:{mode:'experience'}}),access=createRuntimeIdentity(identity.recoveryEpoch,()=>clock);
  const register=async()=>{const runtimeToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),continuationToken=randomUUID()+'.'+randomBytes(32).toString('base64url');const result=await service.invoke('register',{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken});return {agentId:result.agentId as string,ownerId:result.ownerId as string,runtimeToken};};
  return {database,identity,options,runtime,legacy,service,access,register,now:()=>clock,tick:(ms:number)=>{clock+=ms;},gate:(enabled:boolean)=>setPostgresWriteGate(maintenance,{enabled}),dispose};
 }catch(error){await dispose();throw error;}
}
