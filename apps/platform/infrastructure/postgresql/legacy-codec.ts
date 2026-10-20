import { Pool } from 'pg';
import { M1_TABLES, StorageError, type M1Table, type StoredRow, type M1ReadSession } from '../../contracts/store.ts';
import { createPostgresSession, openPostgresStore, type OpenPostgresStoreOptions } from './postgres-store.ts';
import { MODELS, resolveModel } from './model.ts';
import { encode } from './codec.ts';

export const LEGACY_BUSINESS_TABLES=M1_TABLES;
export const LEGACY_SOURCE_TABLES=['instance_state','schema_migrations',...LEGACY_BUSINESS_TABLES] as const;
export interface LegacyMigration {version:number;name:string;checksum:string;applied_at:string}
export interface LegacySnapshot {
  instance:{instance_id:string;recovery_epoch:string};
  migrations:LegacyMigration[];
  tables:Record<M1Table,StoredRow[]>;
}

function validateSnapshot(options:OpenPostgresStoreOptions,snapshot:LegacySnapshot):void{
  if(Object.keys(snapshot).sort().join(',')!=='instance,migrations,tables')throw new StorageError('invalid_usage','Unknown snapshot field');
  if(snapshot.instance.instance_id!==options.instanceId||snapshot.instance.recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','Source and target identity do not match');
  if(Object.keys(snapshot.tables).sort().join(',')!==[...LEGACY_BUSINESS_TABLES].sort().join(','))throw new StorageError('invalid_usage','The complete schema6 table set is required');
  if(snapshot.migrations.length!==6||snapshot.migrations.some((row,index)=>row.version!==index+1||typeof row.name!=='string'||typeof row.checksum!=='string'||typeof row.applied_at!=='string'))throw new StorageError('invalid_usage','Exact schema1–6 source migration history is required');
  for(const table of LEGACY_BUSINESS_TABLES){const ids=new Set<string>();if(!Array.isArray(snapshot.tables[table]))throw new StorageError('invalid_usage','Expected source rows');
    for(const row of snapshot.tables[table]){
      if(Object.keys(row).sort().join(',')!=='data,id,version'||ids.has(row.id))throw new StorageError('invalid_usage','Invalid or duplicate source row');
      ids.add(row.id);encode(resolveModel(table,row),row);
    }
  }
}

/** Private import seam. No permanent source JSON/shadow table is created. */
export async function importLegacySnapshot(options:OpenPostgresStoreOptions,snapshot:LegacySnapshot):Promise<{tables:number;rows:number}>{
  validateSnapshot(options,snapshot);
  // Read-only open checks the expected module checksums before the import scope.
  const verification=await openPostgresStore(options);await verification.close();
  const pool=new Pool({connectionString:options.connectionString,max:1,connectionTimeoutMillis:5000});const client=await pool.connect();let alive=true;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const guard=await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1 FOR UPDATE');
    if(guard.rows[0]?.instance_id!==options.instanceId||guard.rows[0]?.recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','Target identity changed before import');
    for(const model of MODELS){const existing=await client.query(`SELECT 1 FROM ${model.table} LIMIT 1`);if(existing.rowCount)throw new StorageError('conflict','Import requires an empty target');}
    if((await client.query('SELECT 1 FROM platform.legacy_schema_migrations LIMIT 1')).rowCount)throw new StorageError('conflict','Source history was already imported');
    for(const migration of snapshot.migrations)await client.query('INSERT INTO platform.legacy_schema_migrations(version,name,checksum,applied_at) VALUES($1,$2,$3,$4)',[migration.version,migration.name,migration.checksum,migration.applied_at]);
    const tx=createPostgresSession(client,true,()=>alive);let rows=0;
    for(const table of LEGACY_BUSINESS_TABLES)for(const row of snapshot.tables[table]){await tx.insert(table,row);rows++;}
    await client.query('COMMIT');return {tables:LEGACY_SOURCE_TABLES.length,rows};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{alive=false;client.release();await pool.end();}
}

export async function exportLegacyRows(tx:M1ReadSession,table:M1Table):Promise<StoredRow[]>{
  if(!LEGACY_BUSINESS_TABLES.includes(table))throw new StorageError('invalid_usage','Unknown business source table');
  return tx.find(table);
}

export async function exportLegacySnapshot(options:OpenPostgresStoreOptions):Promise<LegacySnapshot>{
  const store=await openPostgresStore(options),pool=new Pool({connectionString:options.connectionString,max:1,connectionTimeoutMillis:5000});
  const client=await pool.connect();let alive=true;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const guard=await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1 FOR SHARE');
    if(guard.rows[0]?.instance_id!==options.instanceId||guard.rows[0]?.recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','Target identity changed before export');
    const tx=createPostgresSession(client,false,()=>alive),tables={} as LegacySnapshot['tables'];
    for(const table of LEGACY_BUSINESS_TABLES)tables[table]=await exportLegacyRows(tx,table);
    const history=await client.query('SELECT version,name,checksum,applied_at FROM platform.legacy_schema_migrations ORDER BY version');
    await client.query('COMMIT');return {instance:{instance_id:options.instanceId,recovery_epoch:options.recoveryEpoch},migrations:history.rows as LegacyMigration[],tables};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{alive=false;client.release();await pool.end();await store.close();}
}
