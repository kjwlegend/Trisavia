import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {POSTGRES_MIGRATIONS} from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import {openPostgresTransactionHost} from '../../apps/platform/infrastructure/postgresql/transaction-host.ts';

/** Actual host orchestration, with a query-recording client; no socket or PG fixture. */
async function fixture(t:TestContext){
 const identity={instanceId:'isolation-instance',recoveryEpoch:'isolation-epoch'},queries:string[]=[],released:boolean[]=[];
 let wrongEpoch=false,loseCommit=false;
 class Client extends EventEmitter {
  async query(sql:string){
   queries.push(sql);
   if(sql==='SELECT module_id,migration_version,name,checksum FROM platform.module_migrations')return{rowCount:POSTGRES_MIGRATIONS.length,rows:POSTGRES_MIGRATIONS.map(row=>({module_id:row.moduleId,migration_version:row.version,name:row.name,checksum:createHash('sha256').update(row.sql).digest('hex')}))};
   if(sql==='SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1')return{rowCount:1,rows:[{instance_id:identity.instanceId,recovery_epoch:identity.recoveryEpoch}]};
   if(sql.startsWith('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state'))return{rowCount:1,rows:[{instance_id:identity.instanceId,recovery_epoch:wrongEpoch?'revoked-epoch':identity.recoveryEpoch,writes_enabled:true}]};
   if(sql==='COMMIT'&&loseCommit){const error=new Error('Synthetic acknowledgement loss');Object.assign(error,{code:'08006'});throw error;}
   return{rowCount:0,rows:[]};
  }
  release(destroy=false){released.push(destroy);}
 }
 t.mock.method(Pool.prototype,'connect',async()=>new Client() as unknown as PoolClient);
 const host=await openPostgresTransactionHost({...identity,connectionString:'postgresql://offline-invalid/no-network'});
 queries.length=0;released.length=0;
 return{host,queries,released,wrongEpoch(){wrongEpoch=true;},loseCommit(){loseCommit=true;}};
}

test('read scope keeps the first SHARE fence through COMMIT while using a current read-committed guard',async t=>{
 const f=await fixture(t);
 try{
  assert.equal(await f.host.read(async scope=>{assert.equal(scope.write,false);await scope.client.query('SELECT callback_source');return 'current-result';}),'current-result');
  assert.deepEqual(f.queries,[
   'BEGIN ISOLATION LEVEL READ COMMITTED',
   'SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1 FOR SHARE',
   'SELECT callback_source','COMMIT',
  ]);assert.deepEqual(f.released,[false]);
 }finally{await f.host.close();}
});

test('write scope retains RR, UPDATE fence, generation update and before-commit validation',async t=>{
 const f=await fixture(t);
 try{
  await f.host.transaction(async scope=>{assert.equal(scope.write,true);scope.beforeCommit(async()=>{await scope.client.query('SELECT current_authority');});await scope.client.query('SELECT write_callback');});
  assert.deepEqual(f.queries,[
   'BEGIN ISOLATION LEVEL REPEATABLE READ',
   'SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1 FOR UPDATE',
   'UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1',
   'SELECT write_callback','SELECT current_authority','COMMIT',
  ]);
 }finally{await f.host.close();}
});

test('changed epoch still rejects read and write callbacks before any generation or source write',async t=>{
 const f=await fixture(t);f.wrongEpoch();let calls=0;
 try{
  await assert.rejects(f.host.read(async()=>{calls++;}),{code:'conflict'});
  await assert.rejects(f.host.transaction(async()=>{calls++;}),{code:'conflict'});
  assert.equal(calls,0);assert.equal(f.queries.filter(sql=>sql==='ROLLBACK').length,2);assert(!f.queries.some(sql=>sql.startsWith('UPDATE')));assert(!f.queries.includes('COMMIT'));
 }finally{await f.host.close();}
});

test('unknown write commit still destroys its client and never reruns the accepted callback',async t=>{
 const f=await fixture(t);f.loseCommit();let calls=0;
 try{
  await assert.rejects(f.host.transaction(async()=>{calls++;}),{code:'unknown_commit'});
  assert.equal(calls,1);assert.equal(f.queries.filter(sql=>sql==='BEGIN ISOLATION LEVEL REPEATABLE READ').length,1);assert.deepEqual(f.released,[true]);
 }finally{await f.host.close();}
});
