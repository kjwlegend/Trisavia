import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createWorldDatabase, dropWorldTestDatabase } from '../../scripts/world-core-database.ts';
import { prepareWorldCoreDatabase } from '../../scripts/world-core-prepare.ts';
import { readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';
import { openRuntimeStore, runtimeIdentitySession } from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { openPostgresStore, setPostgresWriteGate } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { bootstrapPlatformCatalog } from '../../apps/platform/application/bootstrap.ts';
import { createM1Service } from '../../apps/platform/application/m1-service.ts';
import { createIdentityAccess } from '../../apps/platform/domains/access/facade.ts';
import type { RuntimeReadContext } from '../../apps/platform/contracts/runtime-store.ts';
export async function worldFixture(){
 const runtimeFile=process.env.WORLD_CORE_TEST_RUNTIME;if(!runtimeFile)throw new Error('Set WORLD_CORE_TEST_RUNTIME to the explicit private local PG runtime');
 const config=await readRuntime(runtimeFile),directory=await mkdtemp(join(tmpdir(),'world-core-b-')),database='world_core_b_'+randomBytes(10).toString('hex');
 const identity={instanceId:'instance_'+randomUUID(),recoveryEpoch:'epoch_'+randomUUID()};let connections:string|undefined;
 const stores=new Set<{close():Promise<void>}>();let clock=1740000000000;
 const dispose=async()=>{for(const store of stores)await store.close();stores.clear();if(connections)await dropWorldTestDatabase(config,connections);await rm(directory,{recursive:true,force:true});};
 try{
  connections=(await createWorldDatabase(config,database,join(directory,'connections'))).privateConnections;
  const prepared=await prepareWorldCoreDatabase(config,connections,identity);
  const migrationOptions={connectionString:(await requirePrivateFile(join(connections,'migration-database-url'))).trim(),...identity};
  const options={...migrationOptions,connectionString:(await requirePrivateFile(join(connections,'application-database-url'))).trim(),now:()=>clock};
  const runtime=await openRuntimeStore(options);stores.add(runtime);const legacy=await openPostgresStore(options);stores.add(legacy);
  const query=async(sql:string,values:unknown[]=[])=>{const pool=new Pool({connectionString:migrationOptions.connectionString,max:1});try{return(await pool.query(sql,values)).rows;}finally{await pool.end();}};
  const appQuery=async(sql:string,values:unknown[]=[])=>{const pool=new Pool({connectionString:options.connectionString,max:1});try{return(await pool.query(sql,values)).rows;}finally{await pool.end();}};
  await setPostgresWriteGate(migrationOptions,{enabled:true});await bootstrapPlatformCatalog(legacy);
  const service=createM1Service(legacy,{now:()=>clock,email:{mode:'experience'}}),access=createIdentityAccess<RuntimeReadContext>({session:runtimeIdentitySession,recoveryEpoch:identity.recoveryEpoch,now:()=>clock});
  const register=async()=>{const runtimeToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),continuationToken=randomUUID()+'.'+randomBytes(32).toString('base64url');const result=await service.invoke('register',{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken});return {agentId:result.agentId as string,ownerId:result.ownerId as string,runtimeToken};};
  return {database,identity,options,migrationOptions,runtime,legacy,service,access,register,query,appQuery,prepared,now:()=>clock,tick:(ms:number)=>{clock+=ms;},gate:(enabled:boolean)=>setPostgresWriteGate(migrationOptions,{enabled}),openRuntime:async()=>{const store=await openRuntimeStore(options);stores.add(store);return store;},dispose};
 }catch(error){await dispose();throw error;}
}
