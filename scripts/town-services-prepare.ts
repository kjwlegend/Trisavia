import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {checkedWorldDatabase} from './world-core-database.ts';
import {verifySchema,type PostgresScope} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {runtimeSql} from '../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import {createTownRepository} from '../apps/platform/infrastructure/postgresql/town-services-repository.ts';
import {createWorldRepository} from '../apps/platform/infrastructure/postgresql/world-repository.ts';
import {createBehaviorRepository} from '../apps/platform/infrastructure/postgresql/behavior-repository.ts';
import {createRuntimeRepositories} from '../apps/platform/infrastructure/postgresql/runtime-repositories.ts';
import {prepareTownItemDefinitions} from '../apps/platform/infrastructure/postgresql/service-inventory-repository.ts';
import {createPostgresSession} from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {residentWelcomeTownCatalog as townCatalog} from '../apps/platform/domains/town-services/catalog.ts';
import {NEW_RESIDENT_GIFT_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/new-resident-gift-migration.ts';
import {TOWN_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/town-services-migration.ts';
import {BEHAVIOR_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/behavior-migration.ts';
import {POSTGRES_SCHEMA_SIGNATURE} from '../apps/platform/infrastructure/postgresql/migrations.ts';
/** Explicit paired activation. No Agent, item instance, relation, claim, service, or scheduled job is created. */
export async function prepareTownServices(connectionFile:string,identityFile:string,database:string,options:{activate?:boolean;now?:()=>number}={}){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile))throw new Error('Absolute paired private files required');checkedWorldDatabase(database);const connectionString=(await requirePrivateFile(connectionFile)).trim(),url=new URL(connectionString),identity=JSON.parse(await requirePrivateFile(identityFile));if(/[?#\u0000-\u0020\u007f]/u.test(connectionString)||!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!/^[1-9][0-9]{0,4}$/.test(url.port)||Number(url.port)>65535||url.username!=='connet_migrator'||url.pathname!=='/'+database||identity.version!==1||!identity.instanceId||!identity.recoveryEpoch)throw new Error('Town target identity differs');
 const pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{await client.query('BEGIN');await verifySchema(client,{connectionString,...identity});const gate=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1 FOR UPDATE')).rows[0];if(gate?.instance_id!==identity.instanceId||gate?.recovery_epoch!==identity.recoveryEpoch||gate?.writes_enabled!==false)throw new Error('Town preparation requires the same closed World');
  await client.query(TOWN_PERMISSIONS_SQL);await client.query(NEW_RESIDENT_GIFT_PERMISSIONS_SQL);await client.query(BEHAVIOR_PERMISSIONS_SQL);const clock=options.now??Date.now,scope:PostgresScope={client,write:true,alive:()=>alive,beforeCommit(){throw new Error('Unexpected maintenance check');},async attempt(work){return work();}},sql=runtimeSql(scope,clock),town=createTownRepository(sql).writer,world=createWorldRepository(sql).writer,behavior=createBehaviorRepository(sql).writer;
  if(options.activate){const w=await world.getWorld('default'),rules=w&&await world.getRuleset('default',w.rulesetVersion);if(!rules)throw new Error('The current map is absent');const now=clock(),before=await town.getCatalog();await town.activateCatalog(townCatalog(rules,now));await prepareTownItemDefinitions(createPostgresSession(client,true,()=>alive));await behavior.activateCoverage('town_services',now);const tasks=createRuntimeRepositories(sql,identity.recoveryEpoch).tasks;if(await tasks.currentGeneration('town_services')===0)await tasks.advanceGeneration('town_services',0);if(before?.version!==2)await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');}
  const current=await town.getCatalog(),coverage=await behavior.getCoverage();await client.query('COMMIT');return {database,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,catalogVersion:current?.version??null,activatedAt:current?.activatedAt??null,coverage,createdAgentState:false,writeGate:false};
 }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[c,i,d,flag,...extra]=process.argv.slice(2);(async()=>{if(!c||!i||!d||flag!==undefined&&flag!=='--activate'||extra.length)throw new Error('Usage: town-services-prepare.ts PRIVATE_MIGRATION_FILE PAIRED_IDENTITY_FILE WORLD_DATABASE [--activate]');return prepareTownServices(c,i,d,{activate:flag==='--activate'});})().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(()=>{process.stderr.write('town_services_prepare_failed; paired target retained with write gate closed\n');process.exitCode=1;});}
