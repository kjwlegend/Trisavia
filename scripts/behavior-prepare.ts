import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {checkedWorldDatabase} from './world-core-database.ts';
import {verifySchema,type PostgresScope} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {runtimeSql} from '../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import {createBehaviorRepository} from '../apps/platform/infrastructure/postgresql/behavior-repository.ts';
import {BEHAVIOR_SCOPES} from '../apps/platform/domains/behavior/types.ts';
import {BEHAVIOR_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/behavior-migration.ts';
import {POSTGRES_SCHEMA_SIGNATURE} from '../apps/platform/infrastructure/postgresql/migrations.ts';
/** Same paired World, closed write gate. This never migrates, re-seeds, backfills, or starts a task. */
export async function prepareBehaviorSources(connectionFile:string,identityFile:string,expectedDatabase:string,options:{activate?:boolean;now?:()=>number}={}){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile))throw new Error('Absolute paired private files required');checkedWorldDatabase(expectedDatabase);
 const connectionString=(await requirePrivateFile(connectionFile)).trim(),url=new URL(connectionString),identity=JSON.parse(await requirePrivateFile(identityFile)) as {version:number;instanceId:string;recoveryEpoch:string};
 if(url.hostname!=='127.0.0.1'||decodeURIComponent(url.pathname.slice(1))!==expectedDatabase||identity.version!==1||!identity.instanceId||!identity.recoveryEpoch)throw new Error('World identity pairing differs');
 const pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{await client.query('BEGIN');await verifySchema(client,{connectionString,...identity});const guard=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1 FOR UPDATE')).rows[0];
  if(guard?.instance_id!==identity.instanceId||guard?.recovery_epoch!==identity.recoveryEpoch||guard?.writes_enabled!==false)throw new Error('Behavior preparation requires the same deployment with writes closed');
  await client.query(BEHAVIOR_PERMISSIONS_SQL);const clock=options.now??Date.now,scope:PostgresScope={client,write:true,alive:()=>alive,beforeCommit(){throw new Error('Unexpected maintenance callback');},async attempt(work){return work();}},repo=createBehaviorRepository(runtimeSql(scope,clock)).writer;
  const before=await repo.getCoverage();if(options.activate){const fromAt=clock();for(const source of BEHAVIOR_SCOPES)await repo.activateCoverage(source,fromAt);}const coverage=await repo.getCoverage();if(coverage.length!==before.length)await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');
  await client.query('COMMIT');return {database:expectedDatabase,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,coverage,activated:coverage.length>0,backfilled:false,writeGate:false};
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[connectionFile,identityFile,database,flag,...extra]=process.argv.slice(2);(async()=>{if(!connectionFile||!identityFile||!database||flag!==undefined&&flag!=='--activate'||extra.length)throw new Error('Usage: behavior-prepare.ts PRIVATE_MIGRATION_CONNECTION_FILE PAIRED_IDENTITY_FILE EXPECTED_WORLD_DATABASE [--activate]');return prepareBehaviorSources(connectionFile,identityFile,database,{activate:flag==='--activate'});})().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(()=>{process.stderr.write('behavior_prepare_failed; paired target retained and write gate remains closed\n');process.exitCode=1;});}
