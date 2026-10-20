import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { privateFile, readRuntime, requirePrivateFile, type RuntimeConfig } from './postgresql/runtime.ts';
import { checkedWorldDatabase } from './world-core-database.ts';
import { grantWorldCorePermissions } from './world-core-prepare.ts';
import { migratePostgres, POSTGRES_SCHEMA_SIGNATURE } from '../apps/platform/infrastructure/postgresql/migrations.ts';
import { openPostgresStore } from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { openRuntimeStore } from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { verifyApplicationReadiness } from '../apps/platform/application/bootstrap.ts';
import { verifyWorldReadiness } from '../apps/platform/application/world-service.ts';
/** Explicit in-place module upgrade. No reset, database recreation, identity change, or business re-seed. */
export async function upgradeWorldCore(config:RuntimeConfig,privateConnections:string){
 const manifest=JSON.parse(await requirePrivateFile(join(privateConnections,'created-database.json'))) as {format:string;database:string;oid:number;owner:string;project:string;context:string};checkedWorldDatabase(manifest.database);
 if(manifest.format!=='world-core-isolated-pg-database-v1'||manifest.project!==config.project||manifest.context!==config.context||manifest.owner!=='connet_migrator'||!Number.isSafeInteger(manifest.oid))throw new Error('World upgrade manifest mismatch');
 const identity=JSON.parse(await requirePrivateFile(join(privateConnections,'identity.json'))) as {version:number;instanceId:string;recoveryEpoch:string};if(identity.version!==1)throw new Error('World identity must already exist');
 const connectionString=(await requirePrivateFile(join(privateConnections,'migration-database-url'))).trim(),url=new URL(connectionString);if(url.hostname!=='127.0.0.1'||Number(url.port)!==config.port||url.pathname.slice(1)!==manifest.database)throw new Error('World upgrade connection mismatch');
 const options={connectionString,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch};
 const pool=new Pool({connectionString,max:1}),client=await pool.connect();
 try{await client.query('BEGIN');const observed=(await client.query("SELECT oid::bigint,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()")).rows[0];if(Number(observed?.oid)!==manifest.oid||observed?.owner!==manifest.owner)throw new Error('World upgrade target identity changed');const guard=(await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1 FOR UPDATE')).rows[0];if(guard?.instance_id!==identity.instanceId||guard?.recovery_epoch!==identity.recoveryEpoch)throw new Error('World upgrade deployment identity mismatch');await client.query('UPDATE platform.instance_state SET writes_enabled=false,write_generation=write_generation+1 WHERE singleton=1');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();await pool.end();}
 await migratePostgres(options);await grantWorldCorePermissions(config,manifest.database);
 const application={...options,connectionString:(await requirePrivateFile(join(privateConnections,'application-database-url'))).trim()},legacy=await openPostgresStore(application),runtime=await openRuntimeStore(application);
 try{await verifyApplicationReadiness(legacy);await runtime.read(ctx=>verifyWorldReadiness(ctx));}finally{await legacy.close();await runtime.close();}
 const result={database:manifest.database,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,writeGate:false,ready:true};
 await privateFile(join(privateConnections,'upgrade-'+Date.now()+'.json'),JSON.stringify(result)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const[runtime,directory,...extra]=process.argv.slice(2);(async()=>{if(!runtime||!directory||extra.length)throw new Error('Usage: world-core-upgrade.ts RUNTIME_JSON EXISTING_PRIVATE_CONNECTIONS');return upgradeWorldCore(await readRuntime(runtime),directory);})().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('world_core_upgrade_failed; target retained and write gate remains closed after quiescing\n');process.exitCode=1;});}
