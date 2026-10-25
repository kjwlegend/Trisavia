import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {publicIdentifierMaintenanceConnection} from './public-identifiers-prepare.ts';
import {verifySchema} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {createPostgresSession} from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {createPostgresRuntimeContext} from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {verifyApplicationReadinessInSession} from '../apps/platform/application/bootstrap.ts';
import {verifyWorldReadiness} from '../apps/platform/application/world-service.ts';
import {publishRecurringBootstrapInTransaction,readRecurringBootstrapReceipt} from '../apps/platform/application/perception-catalog.ts';

/** Closed, paired, text-only publication. Never migrates, initializes modules or creates a host job. */
export async function prepareRecurringBootstrap(connectionFile:string,identityFile:string,database:string,instanceId:string,recoveryEpoch:string,publication:{operator:string;operationId:string;expectedGuideVersion:number},mode:'publish'|'receipt'='publish'){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile)||!['publish','receipt'].includes(mode))throw new Error('Absolute private pairing and a named mode required');
 const connectionString=publicIdentifierMaintenanceConnection(await requirePrivateFile(connectionFile),database),identity=JSON.parse(await requirePrivateFile(identityFile));
 if(identity.version!==1||identity.instanceId!==instanceId||identity.recoveryEpoch!==recoveryEpoch)throw new Error('Explicit World pairing differs');
 const pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'+(mode==='receipt'?' READ ONLY':''));
  const target=(await client.query('SELECT current_database() AS database,current_user AS role,session_user AS login_role')).rows[0],gate=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1'+(mode==='publish'?' FOR UPDATE':''))).rows[0];
  if(target?.database!==database||target.role!=='connet_migrator'||target.login_role!=='connet_migrator'||gate?.instance_id!==instanceId||gate.recovery_epoch!==recoveryEpoch||gate.writes_enabled!==false)throw new Error('Paired closed World and maintenance role required');
  await verifySchema(client,{connectionString,instanceId,recoveryEpoch});
  const session=createPostgresSession(client,mode==='publish',()=>alive),options={instanceId,recoveryEpoch,...publication},prior=await readRecurringBootstrapReceipt(session,options);
  if(mode==='receipt'){await client.query('COMMIT');return{database,instanceId,recoveryEpoch,writeGate:false,found:!!prior,publication:prior??null,recovery:'Use the original operation and payload; never replace an unknown result with a new operation ID.'};}
  const published=prior??await publishRecurringBootstrapInTransaction(session,options);
  await verifyApplicationReadinessInSession(session);
  await verifyWorldReadiness(createPostgresRuntimeContext({client,write:false,alive:()=>alive,beforeCommit(){throw new Error('Readiness is read-only');},async attempt(){throw new Error('Readiness is read-only');}},{connectionString,instanceId,recoveryEpoch}));
  if(!prior)await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');
  await client.query('COMMIT');return{database,instanceId,recoveryEpoch,writeGate:false,publication:published,replayed:!!prior,ready:true};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const[c,i,d,instance,epoch,flag,operator,operationId,expected,...extra]=process.argv.slice(2);
 (async()=>{if(!c||!i||!d||!instance||!epoch||!['--publish','--receipt'].includes(flag??'')||!operator||!operationId||!expected||extra.length||!/^[1-9][0-9]{0,5}$/.test(expected))throw new Error('Usage: agent-recurring-guide.ts PRIVATE_MIGRATION_FILE PAIRED_IDENTITY_FILE DATABASE INSTANCE EPOCH --publish|--receipt OPERATOR STABLE_OPERATION_ID EXPECTED_GUIDE_VERSION');return prepareRecurringBootstrap(c,i,d,instance,epoch,{operator,operationId,expectedGuideVersion:Number(expected)},flag==='--receipt'?'receipt':'publish');})().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(()=>{process.stderr.write('agent_recurring_guide_failed; retain the closed target and query the original operation with --receipt\n');process.exitCode=1;});
}
