import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { StorageError, M1_TABLES, type M1Store, type M1ReadSession, type M1Transaction, type M1Table, type StoredRow, type JsonObject, type ExactFilters } from '../../contracts/store.ts';
import { checkedJson, decode, encode, safeInteger, writeChildren } from './codec.ts';
import { column, MODELS, modelsFor, resolveModel, type Model } from './model.ts';
import { POSTGRES_MIGRATIONS, sqlType } from './migrations.ts';
import { quotaSelection } from './quota.ts';

export interface OpenPostgresStoreOptions {
  connectionString:string; instanceId:string; recoveryEpoch:string;
  poolMax?:number; connectionTimeoutMillis?:number; statementTimeoutMillis?:number; transactionRetries?:number;
}
function state(error:unknown):string|undefined{
  if(!error||typeof error!=='object')return undefined;
  if('code'in error&&typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code))return error.code;
  return 'cause'in error?state(error.cause):undefined;
}
export function storageError(error:unknown):unknown{
  if(error instanceof StorageError)return error;
  const code=state(error);if(code?.startsWith('23'))return new StorageError('constraint','A database relationship or uniqueness constraint rejected this operation',{cause:error});
  if(code==='40001'||code==='40P01'||code==='55P03'||code==='57014')return new StorageError('busy','Database operation could not finish within its bounded concurrency window',{cause:error});
  if(code?.startsWith('08')||code==='57P01'||code==='57P02'||code==='57P03')return new StorageError('unavailable','Database connection is unavailable',{cause:error});
  if(error instanceof Error&&('code'in error&&['ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT','ENOTFOUND'].includes(String(error.code))||/connection.*(terminated|closed)|timeout exceeded|query read timeout/i.test(error.message)))return new StorageError('unavailable','Database connection is unavailable',{cause:error});
  return error;
}
function identity(options:OpenPostgresStoreOptions){if(!options.connectionString||!options.instanceId||!options.recoveryEpoch)throw new StorageError('invalid_usage','Explicit database connection and instance identity are required');}
function bounded(value:number,min:number,max:number){if(!Number.isSafeInteger(value)||value<min||value>max)throw new StorageError('invalid_usage','Invalid bounded storage option');return value;}
function tableName(table:M1Table):void{if(!M1_TABLES.includes(table))throw new StorageError('invalid_usage','Unknown logical source table');}
function id(value:string):void{if(typeof value!=='string'||!value.length)throw new StorageError('invalid_usage','Expected a nonempty stable identity');checkedJson(value);}

interface SelectionOptions {id?:string;afterId?:string;limit?:number;cutoff?:{field:'expiresAt'|'recordedAt';at:number;inclusive:boolean}}
function selection(table:M1Table,filters:ExactFilters,options:SelectionOptions={}):{sql:string;values:unknown[]}{
  tableName(table);checkedJson(filters);const values:unknown[]=[];
  function parameter(value:unknown){values.push(value);return `$${values.length}`;}
  const cutoff=options.cutoff;
  if(cutoff){
    if(typeof cutoff!=='object'||Array.isArray(cutoff)||Object.keys(cutoff).some(key=>!['field','at','inclusive'].includes(key))||typeof cutoff.inclusive!=='boolean'||typeof cutoff.at!=='number'||safeInteger(cutoff.at)<0||!Number.isFinite(new Date(cutoff.at).getTime())||!(table==='perception_sessions'&&cutoff.field==='expiresAt'||table==='perception_access'&&cutoff.field==='recordedAt'))throw new StorageError('invalid_usage','Invalid controlled expiry cutoff');
  }else if(cutoff!==undefined)throw new StorageError('invalid_usage','Invalid controlled expiry cutoff');
  const branches=modelsFor(table).map(model=>{
    const clauses:string[]=[];
    if(cutoff){const field=model.fields.find(item=>item.path===cutoff.field);if(field?.kind!=='timestamp')throw new StorageError('invalid_usage','Expiry cutoff requires a timestamp column');clauses.push(`t.${column(field.path)} ${cutoff.inclusive?'<=':'<'} ${parameter(new Date(cutoff.at))}::timestamptz`);}
    for(const[key,value]of Object.entries(filters)){
      if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new StorageError('invalid_usage','Filters require scalar JSON values');
      const field=model.fields.find(item=>item.path===key);
      if(!field){clauses.push('FALSE');continue;}
      const match=value===null||typeof value==='string'&&['text','authorization'].includes(field.kind)||typeof value==='number'&&['integer','authorization'].includes(field.kind)||typeof value==='boolean'&&field.kind==='boolean'||typeof value==='number'&&field.kind==='timestamp';
      if(!match){clauses.push('FALSE');continue;}
      clauses.push(`t._present @> ARRAY[${parameter(key)}]::text[]`);
      if(value===null)clauses.push(`t._nulls @> ARRAY[${parameter(key)}]::text[]`);
      else clauses.push(`t.${column(key)}${field.kind==='authorization'?typeof value==='number'?'_number':'_hash':''} IS NOT DISTINCT FROM ${parameter(field.kind==='timestamp'?new Date(safeInteger(value)):value)}::${field.kind==='authorization'?typeof value==='number'?'bigint':'text':sqlType(field).replace(' COLLATE "C"','')}`);
    }
    if(options.id!==undefined)clauses.push(`t.id=${parameter(options.id)}`);
    if(options.afterId!==undefined)clauses.push(`t.id > ${parameter(options.afterId)} COLLATE "C"`);
    return `SELECT '${model.table}'::text AS model,t.id,to_jsonb(t) AS stored FROM ${model.table} t${clauses.length?` WHERE ${clauses.join(' AND ')}`:''}`;
  });
  return {sql:`SELECT * FROM (${branches.join(' UNION ALL ')}) source_rows ORDER BY id COLLATE "C"${options.limit!==undefined?` LIMIT ${parameter(options.limit)}`:''}`,values};
}

/** Internal typed-row adapter. Every query uses this scope's one checked-out client. */
export function createPostgresSession(client:PoolClient,write:boolean,alive:()=>boolean):M1Transaction{
  const cache=new Map<string,StoredRow|undefined>(),loading=new Map<string,Promise<StoredRow|undefined>>();let cacheGeneration=0;
  const cacheKey=(table:M1Table,identifier:string)=>JSON.stringify([table,identifier]);
  function invalidate():void{cacheGeneration++;cache.clear();loading.clear();}
  async function execute<T>(work:()=>Promise<T>):Promise<T>{if(!alive())throw new StorageError('closed','Storage scope has ended');try{return await work();}catch(error){throw storageError(error);}}
  function writable(){if(!write)throw new StorageError('invalid_usage','Read scopes cannot persist data');}
  async function rows<T extends JsonObject>(table:M1Table,filters:ExactFilters,options:SelectionOptions={}):Promise<StoredRow<T>[]>{
    const generation=cacheGeneration,query=selection(table,filters,options),result=await client.query(query.sql,query.values),output:StoredRow<T>[]=[];
    for(const row of result.rows){const model=MODELS.find(item=>item.table===row.model)!,decoded=await decode(client,model,row.stored) as StoredRow<T>;output.push(decoded);if(generation===cacheGeneration)cache.set(cacheKey(table,decoded.id),structuredClone(decoded));}return output;
  }
  return {
    get:async <T extends JsonObject=JsonObject>(table:M1Table,identifier:string)=>execute(async()=>{tableName(table);id(identifier);const key=cacheKey(table,identifier);
      if(cache.has(key))return structuredClone(cache.get(key)) as StoredRow<T>|undefined;
      let pending=loading.get(key);if(!pending){const generation=cacheGeneration;pending=rows<T>(table,{}, {id:identifier,limit:1}).then(result=>{const found=result[0];if(generation===cacheGeneration)cache.set(key,structuredClone(found));return found;});loading.set(key,pending);}
      try{return structuredClone(await pending) as StoredRow<T>|undefined;}finally{if(loading.get(key)===pending)loading.delete(key);}
    }),
    find:async <T extends JsonObject=JsonObject>(table:M1Table,filters:ExactFilters={})=>execute(()=>rows<T>(table,filters)),
    scan:async <T extends JsonObject=JsonObject>(table:M1Table,filters:ExactFilters,options:SelectionOptions&{limit:number})=>execute(async()=>{bounded(options.limit,1,100_001);if(options.afterId!==undefined&&typeof options.afterId!=='string')throw new StorageError('invalid_usage','Invalid stable keyset');return rows<T>(table,filters,options);}),
    count:async(table,filters,limit)=>execute(async()=>{bounded(limit,1,100_001);const query=selection(table,filters,{limit});const result=await client.query(`SELECT count(*)::integer AS total FROM (${query.sql}) bounded_count`,query.values);return result.rows[0].total as number;}),
    quotaCount:async query=>execute(async()=>{const selected=quotaSelection(query);const result=await client.query(selected.sql,selected.values);return result.rows[0].total as number;}),
    insert:async(table,row)=>execute(async()=>{writable();tableName(table);const model=resolveModel(table,row),encoded=encode(model,row);invalidate();
      await client.query(`INSERT INTO ${model.table}(${encoded.columns.join(',')}) VALUES(${encoded.values.map((_,index)=>`$${index+1}`).join(',')})`,encoded.values);
      await writeChildren(client,model,row);await auxiliary(client,model,row);
    }),
    update:async(table,row,expectedVersion)=>execute(async()=>{writable();tableName(table);safeInteger(expectedVersion);if(expectedVersion<1||row.version!==expectedVersion+1)throw new StorageError('invalid_usage','Updates must advance exactly one version');const model=resolveModel(table,row);if(model.immutable)throw new StorageError('constraint','Immutable content versions cannot be updated');
      const encoded=encode(model,row);invalidate();const result=await client.query(`UPDATE ${model.table} SET ${encoded.columns.slice(1).map((name,index)=>`${name}=$${index+1}`).join(',')} WHERE id=$${encoded.values.length} AND version=$${encoded.values.length+1}`, [...encoded.values.slice(1),row.id,expectedVersion]);
      if(result.rowCount!==1)return false;await writeChildren(client,model,row);await auxiliary(client,model,row);return true;
    }),
    remove:async(table,identifier,expectedVersion)=>execute(async()=>{writable();tableName(table);id(identifier);if(safeInteger(expectedVersion)<1)throw new StorageError('invalid_usage','Invalid expected version');
      invalidate();let changed=false;for(const model of modelsFor(table)){if(model.logical==='perception_objects')await client.query('DELETE FROM perception.reference_aliases WHERE external_id=$1 AND EXISTS(SELECT 1 FROM '+model.table+' WHERE id=$1 AND version=$2)',[identifier,expectedVersion]);const result=await client.query(`DELETE FROM ${model.table} WHERE id=$1 AND version=$2`,[identifier,expectedVersion]);changed=changed||result.rowCount===1;}return changed;
    }),
  };
}

async function auxiliary(client:PoolClient,model:Model,row:StoredRow):Promise<void>{
  if(model.logical==='perception_objects'){
    const ref=row.data.ref as JsonObject;await client.query(`INSERT INTO perception.reference_aliases(external_id,target_table,target_key,module_id,type,ref_id) VALUES($1,$2,$1,$3,$4,$5) ON CONFLICT(external_id) DO UPDATE SET target_table=EXCLUDED.target_table,target_key=EXCLUDED.target_key,module_id=EXCLUDED.module_id,type=EXCLUDED.type,ref_id=EXCLUDED.ref_id`,[row.id,model.table,ref.moduleId,ref.type,ref.id]);
  }
  if(model.logical==='mailbox_messages'){
    const sender=row.data.sender as JsonObject,ref=sender.ref as JsonObject,nameSource=sender.nameSource as JsonObject;
    const parent=await client.query(`INSERT INTO mailbox.messages(id,source_id,source_message_key) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id WHERE mailbox.messages.source_id=EXCLUDED.source_id AND mailbox.messages.source_message_key=EXCLUDED.source_message_key RETURNING id`,[row.data.messageId,row.data.sourceId,row.data.sourceMessageKey]);
    if(parent.rowCount!==1)throw new StorageError('constraint','Message source identity changed');
    await client.query('INSERT INTO mailbox.verified_senders(id,source_id,kind,subject_module,subject_type,subject_id,display_name,authority_kind,authority_id,authority_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.id,row.data.sourceId,sender.kind,ref.moduleId,ref.type,ref.id,sender.displayName,nameSource?.kind??null,nameSource?.authorityId??null,nameSource?.version??null]);
  }
}

async function verifySchema(client:PoolClient,options:OpenPostgresStoreOptions):Promise<void>{
  const result=await client.query('SELECT module_id,migration_version,name,checksum FROM platform.module_migrations');
  if(result.rowCount!==POSTGRES_MIGRATIONS.length||POSTGRES_MIGRATIONS.some(item=>!result.rows.some(row=>row.module_id===item.moduleId&&row.migration_version===item.version&&row.name===item.name&&row.checksum===createHash('sha256').update(item.sql).digest('hex'))))throw new StorageError('conflict','PostgreSQL module schema is not this application version');
  const instance=await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1');
  if(!instance.rowCount||instance.rows[0].instance_id!==options.instanceId||instance.rows[0].recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','PostgreSQL instance identity does not match');
}

export async function openPostgresStore(options:OpenPostgresStoreOptions):Promise<M1Store>{
  identity(options);const poolMax=bounded(options.poolMax??4,1,16),timeout=bounded(options.statementTimeoutMillis??10_000,100,60_000),retries=bounded(options.transactionRetries??3,1,3);
  const pool=new Pool({connectionString:options.connectionString,max:poolMax,connectionTimeoutMillis:bounded(options.connectionTimeoutMillis??5000,100,60_000),statement_timeout:timeout,idle_in_transaction_session_timeout:timeout,application_name:'agents-era-local'});
  pool.on('error',()=>{/* The pool destroys failed idle connections; no private error payload is logged. */});
  const client=await pool.connect().catch(async error=>{await pool.end();throw storageError(error);});
  const bootstrapError=()=>{};client.on('error',bootstrapError);
  try{await verifySchema(client,options);}catch(error){client.removeListener('error',bootstrapError);client.release(true);await pool.end();throw storageError(error);}client.removeListener('error',bootstrapError);client.release();
  const context=new AsyncLocalStorage<boolean>(),accepted=new Set<Promise<unknown>>();let closed=false;let closing:Promise<void>|undefined;
  async function scope<T>(write:boolean,work:(session:M1Transaction)=>Promise<T>):Promise<T>{
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
          const session=createPostgresSession(connection,write,()=>usable),readSession:M1ReadSession={get:session.get,find:session.find,scan:session.scan,count:session.count,quotaCount:session.quotaCount};
          const value=work((write?session:readSession) as M1Transaction);
          if(!value||typeof value.then!=='function')throw new StorageError('invalid_usage','PostgreSQL callbacks must be asynchronous');
          const output=await value;usable=false;commitSent=true;await connection.query('COMMIT');return output;
        }catch(error){
          usable=false;const sqlState=state(error);
          if(commitSent&&(!sqlState||sqlState.startsWith('08')||sqlState.startsWith('57'))){destroy=true;throw new StorageError('unknown_commit','Commit result is unknown; recover with the original operation identity',{cause:error});}
          await connection.query('ROLLBACK').catch(()=>{destroy=true;});
          if(!((sqlState==='40001'||sqlState==='40P01')&&attempt<retries))throw storageError(error);
        }finally{usable=false;connection.removeListener('error',connectionError);connection.release(destroy);}
        // Retry only after releasing the failed transaction and its client.
        // Jitter prevents concurrent scopes from repeatedly rebuilding the
        // same stale RR snapshot in lock-step. At most 150ms + 300ms total.
        await delay(randomInt(50,151)*attempt);
      }
      throw new StorageError('busy','Transaction retry budget was exhausted');
    });
    accepted.add(pending);try{return await pending;}finally{accepted.delete(pending);}
  }
  return {instanceId:options.instanceId,recoveryEpoch:options.recoveryEpoch,read:work=>scope(false,work),transaction:work=>scope(true,work),close(){if(context.getStore())return Promise.reject(new StorageError('invalid_usage','Cannot close a store inside its active scope'));closed=true;closing??=(async()=>{await Promise.allSettled([...accepted]);await pool.end();})();return closing;}};
}

/** Explicit maintenance-role action; importing/opening never enables business writes. */
export async function setPostgresWriteGate(options:OpenPostgresStoreOptions,change:{enabled:boolean}):Promise<void>{
  identity(options);if(typeof change.enabled!=='boolean')throw new StorageError('invalid_usage','An explicit write-gate state is required');
  const pool=new Pool({connectionString:options.connectionString,max:1,connectionTimeoutMillis:5000});const client=await pool.connect();
  try{await client.query('BEGIN');await verifySchema(client,options);const current=await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1 FOR UPDATE');
    if(current.rows[0]?.instance_id!==options.instanceId||current.rows[0]?.recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','Deployment identity changed');
    await client.query('UPDATE platform.instance_state SET writes_enabled=$1,write_generation=write_generation+1 WHERE singleton=1',[change.enabled]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw storageError(error);}finally{client.release();await pool.end();}
}
