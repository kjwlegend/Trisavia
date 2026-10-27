import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {activateNpcLife,readNpcLifeActivation} from '../apps/platform/application/npc-life-activation.ts';
import {gardenerDefinition,NPC_LIFE_ART_SHA256,NPC_LIFE_SPATIAL_SHA256} from '../apps/platform/domains/npc-life/definition.ts';
import {NPC_LIFE_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/npc-life-migration.ts';
import {WORLD_REPOSITORY} from '../apps/platform/domains/world/repository.ts';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {publicIdentifierMaintenanceConnection} from './public-identifiers-prepare.ts';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {verifySchema} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {createPostgresSession} from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {POSTGRES_SCHEMA_SIGNATURE} from '../apps/platform/infrastructure/postgresql/migrations.ts';
import {verifyApplicationReadinessInSession} from '../apps/platform/application/bootstrap.ts';
import {createPostgresRuntimeContext} from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {verifyWorldReadiness} from '../apps/platform/application/world-service.ts';
export async function prepareNpcLife(connectionFile:string,identityFile:string,database:string,instanceId:string,recoveryEpoch:string,o:{operator:string;operationId:string;expectedGuideVersion:number},mode:'activate'|'receipt'='activate'){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile))throw new Error('Absolute private pairing required');const connectionString=publicIdentifierMaintenanceConnection(await requirePrivateFile(connectionFile),database),identity=JSON.parse(await requirePrivateFile(identityFile));if(identity.version!==1||identity.instanceId!==instanceId||identity.recoveryEpoch!==recoveryEpoch)throw new Error('World pairing differs');const pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{await client.query(mode==='receipt'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL REPEATABLE READ');const target=(await client.query('SELECT current_database() AS database,current_user AS role,session_user AS login_role')).rows[0],gate=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1'+(mode==='activate'?' FOR UPDATE':''))).rows[0];if(target.database!==database||target.role!=='connet_migrator'||target.login_role!=='connet_migrator'||gate?.instance_id!==instanceId||gate.recovery_epoch!==recoveryEpoch||gate.writes_enabled!==false)throw new Error('The paired same closed World is required');await verifySchema(client,{connectionString,instanceId,recoveryEpoch});const tx=createPostgresSession(client,mode==='activate',()=>alive),options={...o,instanceId,recoveryEpoch},prior=await readNpcLifeActivation(tx,options);
  if(mode==='receipt'){await client.query('COMMIT');return{database,instanceId,recoveryEpoch,writeGate:false,found:!!prior,activation:prior??null};}
  const ctx=createPostgresRuntimeContext({client,write:true,alive:()=>alive,beforeCommit(){},async attempt(work){return work();}},{connectionString,instanceId,recoveryEpoch});
  const load=async(name:string,sha:string)=>{const bytes=await readFile(new URL('../apps/web/public/npc-life-v1/'+name,import.meta.url));if(bytes.length>2*1024*1024||createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('Frozen NPC life source differs');return JSON.parse(bytes.toString('utf8'));};
  await client.query(NPC_LIFE_PERMISSIONS_SQL);
  const art=await load('manifest.json',NPC_LIFE_ART_SHA256),spatial=await load('spatial-addon-v1.json',NPC_LIFE_SPATIAL_SHA256);if(art.version!=='1.0.1')throw Error('The final approved NPC life art is required');
  // Validate only this enabled NPC and its visible water tools/ground. Future-character assets do not enable future behaviors.
  const gardener=art.characters.find((n:any)=>n.npcId==='npc-gardener'),files=[...Object.values(gardener.actions),art.environment.watering,art.environment['shared-water']] as {file:string;sha256:string}[];for(const file of files){if(!/^assets\/[a-z0-9-]+\.png$/.test(file.file))throw Error('A bounded local NPC asset is required');const bytes=await readFile(new URL('../apps/web/public/npc-life-v1/'+file.file,import.meta.url));if(bytes.length>262144||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('An enabled NPC life asset differs');}
  const world=ctx.repository(WORLD_REPOSITORY),w=await world.getWorld('default'),rules=w&&await world.getRuleset('default',w.rulesetVersion);if(!rules)throw Error('The real current World is missing');const definition=gardenerDefinition(spatial,rules,ctx.now());
  const activation=await activateNpcLife(ctx,tx,definition,options);await verifyApplicationReadinessInSession(tx);await verifyWorldReadiness(ctx);if(!prior)await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');await client.query('COMMIT');return{database,instanceId,recoveryEpoch,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,writeGate:false,activation,replayed:!!prior,ready:true};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[c,i,d,instance,epoch,mode,operator,operationId,guide,...extra]=process.argv.slice(2);(async()=>{if(!c||!i||!d||!instance||!epoch||!['--activate','--receipt'].includes(mode??'')||!operator||!operationId||!guide||extra.length)throw new Error('Usage: npc-life-prepare.ts MIGRATION_FILE IDENTITY_FILE DB INSTANCE EPOCH --activate|--receipt OPERATOR ORIGINAL_OPERATION_ID EXPECTED_GUIDE');return prepareNpcLife(c,i,d,instance,epoch,{operator,operationId,expectedGuideVersion:Number(guide)},mode==='--receipt'?'receipt':'activate');})().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(()=>{process.stderr.write('npc_life_prepare_failed; keep the paired World closed and recover the original operation\n');process.exitCode=1;});}
