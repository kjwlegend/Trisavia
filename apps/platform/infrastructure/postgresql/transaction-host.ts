import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { StorageError } from '../../contracts/store.ts';
import { POSTGRES_MIGRATIONS } from './migrations.ts';
import { bounded, identity, state, storageError } from './errors.ts';

export interface OpenPostgresStoreOptions {
  connectionString:string; instanceId:string; recoveryEpoch:string;
  poolMax?:number; connectionTimeoutMillis?:number; statementTimeoutMillis?:number; transactionRetries?:number;
}
/** Infrastructure-only guarded client. Never exposed through a domain context. */
export interface PostgresScope {
  readonly client:PoolClient;readonly write:boolean;alive():boolean;
  beforeCommit(check:()=>Promise<void>):void;
}
export interface PostgresTransactionHost {
  readonly instanceId:string;readonly recoveryEpoch:string;
  read<T>(work:(scope:PostgresScope)=>Promise<T>):Promise<T>;
  transaction<T>(work:(scope:PostgresScope)=>Promise<T>):Promise<T>;
  close():Promise<void>;
}

export async function verifySchema(client:PoolClient,options:OpenPostgresStoreOptions):Promise<void>{
  const result=await client.query('SELECT module_id,migration_version,name,checksum FROM platform.module_migrations');
  if(result.rowCount!==POSTGRES_MIGRATIONS.length||POSTGRES_MIGRATIONS.some(item=>!result.rows.some(row=>row.module_id===item.moduleId&&row.migration_version===item.version&&row.name===item.name&&row.checksum===createHash('sha256').update(item.sql).digest('hex'))))throw new StorageError('conflict','PostgreSQL module schema is not this application version');
  const instance=await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1');
  if(!instance.rowCount||instance.rows[0].instance_id!==options.instanceId||instance.rows[0].recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','PostgreSQL instance identity does not match');
}

export async function openPostgresTransactionHost(options:OpenPostgresStoreOptions):Promise<PostgresTransactionHost>{
  identity(options);const poolMax=bounded(options.poolMax??4,1,16),timeout=bounded(options.statementTimeoutMillis??10_000,100,60_000),retries=bounded(options.transactionRetries??3,1,3);
  const pool=new Pool({connectionString:options.connectionString,max:poolMax,connectionTimeoutMillis:bounded(options.connectionTimeoutMillis??5000,100,60_000),statement_timeout:timeout,idle_in_transaction_session_timeout:timeout,application_name:'agents-era-local'});
  pool.on('error',()=>{/* The pool destroys failed idle connections; no private error payload is logged. */});
  const client=await pool.connect().catch(async error=>{await pool.end();throw storageError(error);});
  const bootstrapError=()=>{};client.on('error',bootstrapError);
  try{await verifySchema(client,options);}catch(error){client.removeListener('error',bootstrapError);client.release(true);await pool.end();throw storageError(error);}client.removeListener('error',bootstrapError);client.release();
  const context=new AsyncLocalStorage<boolean>(),accepted=new Set<Promise<unknown>>();let closed=false;let closing:Promise<void>|undefined;
  async function scope<T>(write:boolean,work:(scope:PostgresScope)=>Promise<T>):Promise<T>{
    if(closed)throw new StorageError('closed','PostgreSQL store is closing');
    if(context.getStore())throw new StorageError('invalid_usage','Nested store scopes are not supported');
    if(typeof work!=='function')throw new StorageError('invalid_usage','A storage callback is required');
    const pending=context.run(true,async()=>{
      for(let attempt=1;attempt<=retries;attempt++){
        const connection=await pool.connect().catch(error=>{throw storageError(error);});let usable=true,commitSent=false,destroy=false;
        const connectionError=()=>{destroy=true;};connection.on('error',connectionError);
        try{
          await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
          // This must be the first read: waiting on an updated row causes RR/40001,
          // so no callback is allowed to authorize against the preceding snapshot.
          const result=await connection.query(`SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1 FOR ${write?'UPDATE':'SHARE'}`);
          const guard=result.rows[0];if(!guard||guard.instance_id!==options.instanceId||guard.recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','PostgreSQL deployment identity changed; reopen the store');
          if(write){if(!guard.writes_enabled)throw new StorageError('unavailable','Business writes are closed');await connection.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');}
          const beforeCommit:Array<()=>Promise<void>>=[];
          const scope:PostgresScope={client:connection,write,alive:()=>usable,beforeCommit(check){if(!usable)throw new StorageError('closed','Storage scope has ended');beforeCommit.push(check);}};
          const value=work(scope);
          if(!value||typeof value.then!=='function')throw new StorageError('invalid_usage','PostgreSQL callbacks must be asynchronous');
          const output=await value;for(const check of beforeCommit)await check();usable=false;commitSent=true;await connection.query('COMMIT');return output;
        }catch(error){
          usable=false;const sqlState=state(error);
          if(commitSent&&(!sqlState||sqlState.startsWith('08')||sqlState.startsWith('57'))){destroy=true;throw new StorageError('unknown_commit','Commit result is unknown; recover with the original operation identity',{cause:error});}
          await connection.query('ROLLBACK').catch(()=>{destroy=true;});
          if(!((sqlState==='40001'||sqlState==='40P01')&&attempt<retries))throw storageError(error);
        }finally{usable=false;connection.removeListener('error',connectionError);connection.release(destroy);}
        // Retry only after releasing the failed transaction and its client.
        // Jitter prevents concurrent scopes from repeatedly rebuilding the
        // same stale RR snapshot in lock-step. At most 200ms + 600ms total.
        await delay(randomInt(100,201)*3**(attempt-1));
      }
      throw new StorageError('busy','Transaction retry budget was exhausted');
    });
    accepted.add(pending);try{return await pending;}finally{accepted.delete(pending);}
  }
  return {instanceId:options.instanceId,recoveryEpoch:options.recoveryEpoch,read:work=>scope(false,work),transaction:work=>scope(true,work),close(){if(context.getStore())return Promise.reject(new StorageError('invalid_usage','Cannot close a store inside its active scope'));closed=true;closing??=(async()=>{await Promise.allSettled([...accepted]);await pool.end();})();return closing;}};
}
