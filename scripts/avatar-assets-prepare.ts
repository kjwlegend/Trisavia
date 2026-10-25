import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {publicIdentifierMaintenanceConnection} from './public-identifiers-prepare.ts';
import {AVATAR_ASSETS_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/avatar-assets-migration.ts';
import {verifySchema} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {createPostgresSession} from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {createPostgresRuntimeContext} from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {verifyApplicationReadinessInSession} from '../apps/platform/application/bootstrap.ts';
import {verifyWorldReadiness} from '../apps/platform/application/world-service.ts';
import {publishAvatarAssetsInTransaction} from '../apps/platform/application/perception-catalog.ts';
import {POSTGRES_SCHEMA_SIGNATURE} from '../apps/platform/infrastructure/postgresql/migrations.ts';
/** Explicit closed-gate publication, after physical migration; never creates a user or material. */
export async function prepareAvatarAssets(connectionFile:string,identityFile:string,database:string,instanceId:string,recoveryEpoch:string,publication:{operator:string;operationId:string;expectedGuideVersion:number}){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile))throw new Error('Absolute private pairing required');
 const connectionString=publicIdentifierMaintenanceConnection(await requirePrivateFile(connectionFile),database),identity=JSON.parse(await requirePrivateFile(identityFile));
 if(identity.version!==1||identity.instanceId!==instanceId||identity.recoveryEpoch!==recoveryEpoch)throw new Error('Explicit World pairing differs');
 const pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const target=(await client.query('SELECT current_database() AS database,current_user AS role,session_user AS login_role')).rows[0],gate=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1 FOR UPDATE')).rows[0];
  if(target?.database!==database||target.role!=='connet_migrator'||target.login_role!=='connet_migrator'||gate?.instance_id!==instanceId||gate.recovery_epoch!==recoveryEpoch||gate.writes_enabled!==false)throw new Error('The paired closed World and migration role are required');
  await verifySchema(client,{connectionString,instanceId,recoveryEpoch});await client.query(AVATAR_ASSETS_PERMISSIONS_SQL);
  const session=createPostgresSession(client,true,()=>alive),published=await publishAvatarAssetsInTransaction(session,{instanceId,recoveryEpoch,...publication});
  await verifyApplicationReadinessInSession(session);
  await verifyWorldReadiness(createPostgresRuntimeContext({client,write:false,alive:()=>alive,beforeCommit(){throw new Error('Readiness is read-only');},async attempt(){throw new Error('Readiness is read-only');}},{connectionString,instanceId,recoveryEpoch}));
  await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');await client.query('COMMIT');
  return {database,instanceId,recoveryEpoch,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,publication:published,writeGate:false,createdUsers:0,createdAssets:0,businessFactsChanged:false,ready:true};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[c,i,d,instance,epoch,flag,operator,operationId,expected,...extra]=process.argv.slice(2);(async()=>{if(!c||!i||!d||!instance||!epoch||flag!=='--publish'||!operator||!operationId||!expected||extra.length)throw new Error('Usage: avatar-assets-prepare.ts PRIVATE_MIGRATION_FILE PAIRED_IDENTITY_FILE DATABASE INSTANCE EPOCH --publish OPERATOR STABLE_OPERATION_ID EXPECTED_GUIDE_VERSION');return prepareAvatarAssets(c,i,d,instance,epoch,{operator,operationId,expectedGuideVersion:Number(expected)});})().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(()=>{process.stderr.write('avatar_assets_prepare_failed; closed paired target retained; recover the same operation\n');process.exitCode=1;});}
