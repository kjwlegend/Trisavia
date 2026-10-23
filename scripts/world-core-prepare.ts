import {BEHAVIOR_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/behavior-migration.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateFile, readRuntime, requirePrivateFile, docker, type RuntimeConfig } from './postgresql/runtime.ts';
import { applicationSchemas } from './postgresql/permissions.ts';
import { checkedWorldDatabase } from './world-core-database.ts';
import { migratePostgres, POSTGRES_SCHEMA_SIGNATURE } from '../apps/platform/infrastructure/postgresql/migrations.ts';

export const worldCoreSchemas=[...applicationSchemas,'runtime','world','interaction','decision','behavior'] as const;
/** Maintenance entry only. The application role cannot migrate or alter identity/write gates. */
export async function grantWorldCorePermissions(config:RuntimeConfig,database:string):Promise<void>{
 checkedWorldDatabase(database);const old=applicationSchemas.join(','),added='runtime,world,interaction,decision,behavior';
 const sql=`BEGIN;
 REVOKE ALL ON SCHEMA ${old},${added} FROM connet_app;
 GRANT USAGE ON SCHEMA ${old},${added} TO connet_app;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${old} TO connet_app;
 GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${added} TO connet_app;
 REVOKE ALL ON platform.module_migrations,platform.legacy_schema_migrations,platform.instance_state FROM connet_app;
 GRANT SELECT ON platform.module_migrations,platform.legacy_schema_migrations,platform.instance_state TO connet_app;
 GRANT UPDATE(write_generation) ON platform.instance_state TO connet_app;
 REVOKE ALL ON runtime.event_clock FROM connet_app;GRANT SELECT,UPDATE(position) ON runtime.event_clock TO connet_app;
 ${BEHAVIOR_PERMISSIONS_SQL}
 COMMIT;`;
 await docker(['exec','-i',`${config.project}-server`,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:sql});
}
/** Creates no database; uses an explicitly created, privately paired target. No hidden business seed. */
export async function prepareWorldCoreDatabase(config:RuntimeConfig,privateConnections:string,identity:{instanceId:string;recoveryEpoch:string}):Promise<{database:string;schemaSignature:string}>{
 const manifest=JSON.parse(await requirePrivateFile(join(privateConnections,'created-database.json'))) as {format:string;database:string;context:string;project:string};
 checkedWorldDatabase(manifest.database);if(manifest.format!=='world-core-isolated-pg-database-v1'||manifest.context!==config.context||manifest.project!==config.project)throw new Error('World database manifest mismatch');
 const connectionString=(await requirePrivateFile(join(privateConnections,'migration-database-url'))).trim();
 const connection=new URL(connectionString);if(decodeURIComponent(connection.pathname.slice(1))!==manifest.database||connection.hostname!=='127.0.0.1'||Number(connection.port)!==config.port)throw new Error('World target connection mismatch');
 await migratePostgres({connectionString,...identity});await grantWorldCorePermissions(config,manifest.database);
 await privateFile(join(privateConnections,'identity.json'),JSON.stringify({version:1,...identity})+'\n');
 return {database:manifest.database,schemaSignature:POSTGRES_SCHEMA_SIGNATURE};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [runtime,privateConnections,instanceId,recoveryEpoch,...extra]=process.argv.slice(2);
 (async()=>{if(!runtime||!privateConnections||!instanceId||!recoveryEpoch||extra.length)throw new Error('Usage: world-core-prepare.ts RUNTIME_JSON PRIVATE_CONNECTIONS INSTANCE_ID RECOVERY_EPOCH');return prepareWorldCoreDatabase(await readRuntime(runtime),privateConnections,{instanceId,recoveryEpoch});})().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write('world_core_prepare_failed: '+(error instanceof Error?error.message:'unknown')+'\n');process.exitCode=1;});
}
