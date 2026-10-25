import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {checkedWorldDatabase} from './world-core-database.ts';
import {verifySchema} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {createPostgresSession} from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {createPostgresRuntimeContext} from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {verifyApplicationReadinessInSession} from '../apps/platform/application/bootstrap.ts';
import {verifyWorldReadiness} from '../apps/platform/application/world-service.ts';
import {verifyLifeGuideCatalogForStartup} from '../apps/platform/app.ts';
import {publishProfilePersonalizationInTransaction,readProfilePersonalizationReceipt,type ProfilePersonalizationPublication} from '../apps/platform/application/perception-catalog.ts';
import {catalogRepository} from '../apps/platform/domains/perception/repository.ts';

export function profileGuideConnection(raw:string,database:string,role:'connet_app'|'connet_migrator'){
 checkedWorldDatabase(database);const value=raw.replace(/\r?\n$/u,'');if(/[?#\u0000-\u0020\u007f]/u.test(value))throw new Error('Explicit paired URL required');
 const u=new URL(value);if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||!u.password||u.username!==role||u.pathname!=='/'+database||!/^[1-9][0-9]{0,4}$/.test(u.port)||Number(u.port)>65535)throw new Error('Explicit loopback database and role required');return value;
}
/** Closed publication/receipt or a separately authenticated application-role read-only preflight. No listener/driver/bootstrap/migration. */
export async function prepareProfileGuide(connectionFile:string,identityFile:string,database:string,instanceId:string,recoveryEpoch:string,mode:'publish'|'receipt'|'preflight',publication:Pick<ProfilePersonalizationPublication,'operator'|'operationId'|'expectedGuideVersion'>){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile)||!['publish','receipt','preflight'].includes(mode)||!Number.isSafeInteger(publication.expectedGuideVersion)||publication.expectedGuideVersion<1)throw new Error('Absolute private pairing and exact guide required');
 const role=mode==='preflight'?'connet_app':'connet_migrator',connectionString=profileGuideConnection(await requirePrivateFile(connectionFile),database,role),identity=JSON.parse(await requirePrivateFile(identityFile));
 if(identity.version!==1||identity.instanceId!==instanceId||identity.recoveryEpoch!==recoveryEpoch)throw new Error('Explicit World pairing differs');
 const pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'+(mode==='publish'?'':' READ ONLY'));
  const actual=(await client.query('SELECT current_database() AS database,current_user AS role,session_user AS login_role')).rows[0],gate=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1'+(mode==='publish'?' FOR UPDATE':''))).rows[0];
  if(actual?.database!==database||actual.role!==role||actual.login_role!==role||gate?.instance_id!==instanceId||gate.recovery_epoch!==recoveryEpoch||gate.writes_enabled!==false)throw new Error('Same paired closed World and exact role required');
  await verifySchema(client,{connectionString,instanceId,recoveryEpoch});
  const session=createPostgresSession(client,mode==='publish',()=>alive),options={instanceId,recoveryEpoch,...publication};
  if(mode==='receipt'){const receipt=await readProfilePersonalizationReceipt(session,options);await client.query('COMMIT');return{database,instanceId,recoveryEpoch,writeGate:false,found:!!receipt,publication:receipt??null,recovery:'Keep the original operation and payload; an unknown result is not a new operation.'};}
  let result:Record<string,unknown>;
  if(mode==='preflight'){
   const current=await catalogRepository(session).get('current');if(current?.data.catalogRevision!=='catalog-profile-personalization-1'||current.data.guideVersion!==publication.expectedGuideVersion||current.data.schemaVersion!==8)throw new Error('Exact published profile-guide successor required');
   result={database,instanceId,recoveryEpoch,writeGate:false,catalogRevision:current.data.catalogRevision,guideVersion:current.data.guideVersion,schemaVersion:8,role,readOnly:true,scope:'application/world/composition-guide-readiness',listenerStarted:false,driverStarted:false};
  }else{
   const prior=await readProfilePersonalizationReceipt(session,options),published=prior??await publishProfilePersonalizationInTransaction(session,options);
   result={database,instanceId,recoveryEpoch,writeGate:false,publication:published,replayed:!!prior};
   if(!prior)await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');
  }
  await verifyApplicationReadinessInSession(session);
  await verifyWorldReadiness(createPostgresRuntimeContext({client,write:false,alive:()=>alive,beforeCommit(){throw new Error('Readiness is read-only');},async attempt(){throw new Error('Readiness is read-only');}},{connectionString,instanceId,recoveryEpoch}));
  await verifyLifeGuideCatalogForStartup({read:async work=>work(session)});
  await client.query('COMMIT');return{...result,ready:true};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const[c,i,d,instance,epoch,flag,...rest]=process.argv.slice(2);
 (async()=>{if(!c||!i||!d||!instance||!epoch||!['--publish','--receipt','--preflight'].includes(flag??''))throw new Error('Exact paired CLI parameters required');const preflight=flag==='--preflight',expected=rest[preflight?0:2];if(rest.length!==(preflight?1:3)||!expected||!/^[1-9][0-9]{0,5}$/.test(expected)||!preflight&&(!rest[0]||!rest[1]))throw new Error('Usage: agent-profile-guide.ts PRIVATE_ROLE_FILE PAIRED_IDENTITY_FILE DATABASE INSTANCE EPOCH --publish|--receipt OPERATOR STABLE_OPERATION_ID EXPECTED_PREDECESSOR_GUIDE; or --preflight EXPECTED_PUBLISHED_GUIDE with PRIVATE_APPLICATION_FILE');return prepareProfileGuide(c,i,d,instance,epoch,preflight?'preflight':flag==='--receipt'?'receipt':'publish',{operator:preflight?'read-only-preflight':rest[0]!,operationId:preflight?'read-only-preflight':rest[1]!,expectedGuideVersion:Number(expected)});})().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(()=>{process.stderr.write('agent_profile_guide_failed; keep the target closed and query the original operation with --receipt\n');process.exitCode=1;});
}
