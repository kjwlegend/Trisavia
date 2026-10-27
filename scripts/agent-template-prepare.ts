import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {publicIdentifierMaintenanceConnection} from './public-identifiers-prepare.ts';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {verifySchema} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {createPostgresSession} from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {createPostgresRuntimeContext} from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {verifyApplicationReadinessInSession} from '../apps/platform/application/bootstrap.ts';
import {verifyWorldReadiness} from '../apps/platform/application/world-service.ts';
import {POSTGRES_SCHEMA_SIGNATURE} from '../apps/platform/infrastructure/postgresql/migrations.ts';
import {publishApprovedAgentTemplates,readApprovedAgentTemplatePublication,type ApprovedAgentTemplatePublication} from '../apps/platform/application/agent-template-publication.ts';
import {readAgentRuntimeGuide,type AgentRuntimeGuideProvider} from '../apps/platform/application/agent-runtime-guide.ts';

/** Paired closed text publication only: no migration, grant, bootstrap or host-job write. */
export async function prepareAgentTemplates(connectionFile:string,identityFile:string,database:string,instanceId:string,recoveryEpoch:string,o:Pick<ApprovedAgentTemplatePublication,'operator'|'operationId'|'expectedGuideVersion'>,mode:'publish'|'receipt'='publish',provider:AgentRuntimeGuideProvider=readAgentRuntimeGuide){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile)||!['publish','receipt'].includes(mode))throw new Error('Absolute paired files and exact mode required');
 const connectionString=publicIdentifierMaintenanceConnection(await requirePrivateFile(connectionFile),database),identity=JSON.parse(await requirePrivateFile(identityFile));
 if(identity.version!==1||identity.instanceId!==instanceId||identity.recoveryEpoch!==recoveryEpoch)throw new Error('The explicit World pairing differs');
 const pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'+(mode==='receipt'?' READ ONLY':''));
  const actual=(await client.query('SELECT current_database() AS database,current_user AS role,session_user AS login_role')).rows[0],gate=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1'+(mode==='publish'?' FOR UPDATE':''))).rows[0];
  if(actual?.database!==database||actual.role!=='connet_migrator'||actual.login_role!=='connet_migrator'||gate?.instance_id!==instanceId||gate.recovery_epoch!==recoveryEpoch||gate.writes_enabled!==false)throw new Error('The same paired closed World and migrator role are required');
  await verifySchema(client,{connectionString,instanceId,recoveryEpoch});
  const tx=createPostgresSession(client,mode==='publish',()=>alive),options={...o,instanceId,recoveryEpoch},prior=await readApprovedAgentTemplatePublication(tx,options);
  if(mode==='receipt'){await client.query('COMMIT');return{database,instanceId,recoveryEpoch,writeGate:false,found:!!prior,publication:prior??null,recovery:'Use the original operator, operation ID and expected guide; an unknown result is not a new operation.'};}
  const publication=prior??await publishApprovedAgentTemplates(tx,options,provider);
  await verifyApplicationReadinessInSession(tx);
  await verifyWorldReadiness(createPostgresRuntimeContext({client,write:false,alive:()=>alive,beforeCommit(){throw new Error('Readiness is read-only');},async attempt(){throw new Error('Readiness is read-only');}},{connectionString,instanceId,recoveryEpoch}));
  if(!prior)await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');
  await client.query('COMMIT');return{database,instanceId,recoveryEpoch,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,writeGate:false,publication,replayed:!!prior,ready:true};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const[c,i,d,instance,epoch,mode,operator,operationId,guide,...extra]=process.argv.slice(2);
 (async()=>{if(!c||!i||!d||!instance||!epoch||!['--publish','--receipt'].includes(mode??'')||!operator||!operationId||!guide||!/^[1-9][0-9]{0,5}$/.test(guide)||extra.length)throw new Error('Usage: agent-template-prepare.ts MIGRATION_FILE IDENTITY_FILE DATABASE INSTANCE EPOCH --publish|--receipt OPERATOR ORIGINAL_OPERATION_ID EXPECTED_PREDECESSOR_GUIDE');return prepareAgentTemplates(c,i,d,instance,epoch,{operator,operationId,expectedGuideVersion:Number(guide)},mode==='--receipt'?'receipt':'publish');})().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('agent_template_prepare_failed; keep the paired World closed and query the original operation with --receipt\n');process.exitCode=1;});
}
