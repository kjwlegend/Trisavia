import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { MODELS } from '../../apps/platform/infrastructure/postgresql/model.ts';
import { openPostgresStore, setPostgresWriteGate, type OpenPostgresStoreOptions } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';

function privateUrl(name:string):string {
  const path=process.env[name];if(!path)throw new Error(`Set ${name} to the private URL file for an isolated storage-test database`);
  return readFileSync(path,'utf8').trim();
}
export const options:OpenPostgresStoreOptions={connectionString:privateUrl('PG_STORAGE_TEST_MIGRATION_URL_FILE'),instanceId:'storage-tests',recoveryEpoch:'epoch-test',statementTimeoutMillis:3000,connectionTimeoutMillis:3000};
export const applicationOptions:OpenPostgresStoreOptions={...options,connectionString:privateUrl('PG_STORAGE_TEST_APPLICATION_URL_FILE')};
export const admin=new Pool({connectionString:options.connectionString,max:4});
export const row=(id:string,data:Record<string,any>={},version=1)=>({id,version,data});
export const errorCode=(code:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===code);
export async function resetFixture():Promise<void>{
  const database=(await admin.query('SELECT current_database() AS name')).rows[0].name as string;
  if(!/^connet_storage_tests(?:_[A-Za-z0-9]+)*$/.test(database))throw new Error('Storage fixture refuses a non-storage-test database');
  await admin.query(`TRUNCATE ${[...MODELS.map(model=>model.table),'mailbox.messages','mailbox.verified_senders','perception.reference_aliases'].join(',')} CASCADE`);
  await admin.query('DELETE FROM platform.legacy_schema_migrations');
  await setPostgresWriteGate(options,{enabled:true});
}
export async function testStore(){return openPostgresStore(applicationOptions);}
