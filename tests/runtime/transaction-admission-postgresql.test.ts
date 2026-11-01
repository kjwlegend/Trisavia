import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { worldFixture } from './postgresql-fixture.ts';
import { openRuntimeStore } from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { openPostgresTransactionHost } from '../../apps/platform/infrastructure/postgresql/transaction-host.ts';
import { commitRuntimeCommandIn, hashRuntimeRequest } from '../../apps/platform/domains/runtime/command.ts';

// A separate process/pool models the continuously committing resident worker.
// Only private IPC carries the isolated application connection; never log it.
const workerProgram = `
import {openPostgresTransactionHost} from ${JSON.stringify(new URL('../../apps/platform/infrastructure/postgresql/transaction-host.ts', import.meta.url).href)};
import {setTimeout as delay} from 'node:timers/promises';
let stop=false;process.on('message',message=>{if(message==='stop')stop=true;});
process.once('message',async options=>{
 let host,writes=0,failures=0,ready=false;
 try{
  host=await openPostgresTransactionHost({...options,poolMax:1});
  while(!stop){
   try{await host.transaction(async scope=>{
    await scope.client.query('UPDATE runtime.event_clock SET position=position+1 WHERE singleton=1');
    if(!ready){ready=true;process.send({ready:true});}
    await delay(25);
   });writes++;}catch{failures++;}
  }
  await host.close();process.send({writes,failures});process.disconnect();
 }catch{await host?.close();process.send({failed:true});process.disconnect();process.exitCode=1;}
});`;

test('cross-process resident writes admit registration-shaped transactions and receipt reads without lost writes or bypassing the gate', async t => {
  const f = await worldFixture({bootstrap:false});
  const stores = await Promise.all(Array.from({length:6}, () => openRuntimeStore({...f.options,poolMax:1})));
  const reader = await openPostgresTransactionHost({...f.options,poolMax:1});
  t.after(async () => {await Promise.all(stores.map(store => store.close()));await reader.close();await f.dispose();});
  assert.equal(await reader.transaction(async scope=>(await scope.client.query('SHOW transaction_isolation')).rows[0].transaction_isolation),'repeatable read');
  const before = (await f.query('SELECT write_generation::text FROM platform.instance_state WHERE singleton=1'))[0]!.write_generation;
  const clock = (await f.appQuery('SELECT position::text FROM runtime.event_clock WHERE singleton=1'))[0]!.position;
  const worker = spawn(process.execPath,['--input-type=module','-e',workerProgram],{stdio:['ignore','ignore','ignore','ipc']});
  const exited = once(worker,'exit');
  let finish!: (value:{writes:number;failures:number})=>void;
  const finished = new Promise<{writes:number;failures:number}>(resolve => {finish=resolve;});
  const ready = new Promise<void>((resolve,reject) => {
    worker.on('message', (message:any) => {
      if(message.ready)resolve();
      else if(message.failed)reject(new Error('Isolated background writer failed'));
      else if(typeof message.writes==='number')finish(message);
    });
    worker.once('error',reject);worker.once('exit',code => {if(code!==0)reject(new Error('Isolated writer exited'));});
  });
  worker.send(f.options);
  const failures:string[]=[];let writes=0,receiptReads=0;
  try {
    await ready;
    await Promise.all(stores.map(async (store,index) => {
      for(let sequence=0;sequence<3;sequence++){
        const key={domain:'registration-fixture',action:'start',commandId:`attempt-${index}-${sequence}`,principal:{kind:'system' as const,id:'isolated-registration'},recoveryEpoch:f.identity.recoveryEpoch};
        try{
          const receipt=await store.transaction(ctx=>commitRuntimeCommandIn(ctx,{key,requestHash:hashRuntimeRequest({index,sequence}),authorize:async()=>{},handle:async()=>({result:{attemptId:key.commandId},eventIds:[]})}));
          assert.equal(receipt.result.attemptId,key.commandId);writes++;
          // IAM's attempt/receipt reader currently also enters a write scope.
          assert.equal((await store.transaction(ctx=>ctx.commands.get(key)))?.result.attemptId,key.commandId);receiptReads++;
          assert.equal(await reader.read(async scope=>(await scope.client.query('SHOW transaction_isolation')).rows[0].transaction_isolation),'read committed');
        }catch(error){failures.push(error&&typeof error==='object'&&'code'in error?String(error.code):'assertion');}
      }
    }));
  } finally {
    worker.send('stop');
    await exited;
  }
  const background=await finished;
  console.info(JSON.stringify({phase:'registration_contention',foregroundWrites:writes,receiptReads,foregroundFailures:failures,backgroundWrites:background.writes,backgroundFailures:background.failures}));
  assert.deepEqual(failures,[]);assert.equal(background.failures,0);assert.ok(background.writes>0);
  assert.equal((await f.appQuery("SELECT count(*)::integer AS total FROM runtime.command_receipts WHERE domain='registration-fixture'"))[0]!.total,18);
  assert.equal(BigInt((await f.appQuery('SELECT position::text FROM runtime.event_clock WHERE singleton=1'))[0]!.position)-BigInt(clock),BigInt(background.writes));
  assert.equal(BigInt((await f.query('SELECT write_generation::text FROM platform.instance_state WHERE singleton=1'))[0]!.write_generation)-BigInt(before),BigInt(writes+receiptReads+background.writes));
  // Readers still fence writes; maintenance closes the same row before a queued
  // writer may enter its callback, even though that writer has admission.
  let release!:()=>void,entered!:()=>void,called=false;
  const hold=new Promise<void>(resolve=>{release=resolve;}),inside=new Promise<void>(resolve=>{entered=resolve;});
  const reading=reader.read(async()=>{entered();await hold;});await inside;
  const closing=f.gate(false);await delay(30);
  const blocked=stores[0]!.transaction(async()=>{called=true;}).then(()=>null,error=>error.code);
  await delay(30);assert.equal(called,false);release();await reading;await closing;
  assert.equal(await blocked,'unavailable');assert.equal(called,false);
  assert.equal((await reader.read(async scope=>(await scope.client.query('SELECT writes_enabled FROM platform.instance_state WHERE singleton=1')).rows[0].writes_enabled)),false);
  await f.gate(true);
  assert.equal(await stores[1]!.transaction(async()=>true),true);
});

test('admission timeout and callback rollback release or destroy the client before another pool writes', async t => {
  const f=await worldFixture({bootstrap:false});
  const first=await openPostgresTransactionHost({...f.options,poolMax:1});
  const queued=await openPostgresTransactionHost({...f.options,poolMax:1,statementTimeoutMillis:100});
  t.after(async()=>{await first.close();await queued.close();await f.dispose();});
  let release!:()=>void,entered!:()=>void,called=false;
  const hold=new Promise<void>(resolve=>{release=resolve;}),inside=new Promise<void>(resolve=>{entered=resolve;});
  const active=first.transaction(async()=>{entered();await hold;});await inside;
  try{
    await assert.rejects(queued.transaction(async()=>{called=true;}),{code:'busy'});
    assert.equal(called,false);
  }finally{release();await active;}
  await assert.rejects(first.transaction(async()=>{throw new Error('synthetic rollback');}),/synthetic rollback/);
  assert.equal(await queued.transaction(async()=>true),true);
  assert.equal((await f.query("SELECT count(*)::integer AS total FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())"))[0]!.total,0);
});
