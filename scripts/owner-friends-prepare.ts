import {Pool} from 'pg';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {checkedWorldDatabase} from './world-core-database.ts';
import {migratePostgres,POSTGRES_SCHEMA_SIGNATURE} from '../apps/platform/infrastructure/postgresql/migrations.ts';
import {FRIENDSHIPS_READ_PERMISSIONS_SQL} from '../apps/platform/infrastructure/postgresql/friendships-migration.ts';

/** Run after generic grants, using the same paired World database. No seed, identity or gate change. */
export async function prepareOwnerFriendsRead(connectionFile:string,identityFile:string,expectedDatabase:string){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile))throw new Error('Absolute private connection and paired identity files are required');
 checkedWorldDatabase(expectedDatabase);
 const connectionString=(await requirePrivateFile(connectionFile)).trim(),connection=new URL(connectionString),identity=JSON.parse(await requirePrivateFile(identityFile)) as {version:number;instanceId:string;recoveryEpoch:string};
 if(connection.hostname!=='127.0.0.1'||decodeURIComponent(connection.pathname.slice(1))!==expectedDatabase||identity.version!==1||typeof identity.instanceId!=='string'||typeof identity.recoveryEpoch!=='string'||!identity.instanceId||!identity.recoveryEpoch)throw new Error('The explicit database or paired identity differs');
 // Existing migrations and the new schema append atomically; mismatched identity rolls the transaction back.
 await migratePostgres({connectionString,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch});
 const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:5000}),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const paired=await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1 FOR SHARE');
  if(paired.rows[0]?.instance_id!==identity.instanceId||paired.rows[0]?.recovery_epoch!==identity.recoveryEpoch)throw new Error('World identity changed');
  await client.query(FRIENDSHIPS_READ_PERMISSIONS_SQL);
  const privileges=await client.query("SELECT has_table_privilege('connet_app','relationships.friendships','SELECT') AS can_select,has_table_privilege('connet_app','relationships.friendships','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS can_write,has_schema_privilege('connet_app','relationships','CREATE') AS can_create");
  if(privileges.rows[0]?.can_select!==true||privileges.rows[0]?.can_write!==false||privileges.rows[0]?.can_create!==false)throw new Error('Friendship read-only permissions differ');
  await client.query('COMMIT');return {database:expectedDatabase,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,friendships:'owner-confirmed-read',select:true,write:false,seeded:false};
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [connectionFile,identityFile,database,...extra]=process.argv.slice(2);
 (async()=>{if(!connectionFile||!identityFile||!database||extra.length)throw new Error('Usage: owner-friends-prepare.ts PRIVATE_MIGRATION_CONNECTION_FILE PAIRED_IDENTITY_FILE EXPECTED_WORLD_DATABASE');return await prepareOwnerFriendsRead(connectionFile,identityFile,database);})().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('owner_friends_prepare_failed; retain the paired target and retry the same source.\n');process.exitCode=1;});
}
