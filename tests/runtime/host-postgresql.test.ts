import assert from 'node:assert/strict';
import test from 'node:test';
import { worldFixture } from './postgresql-fixture.ts';
import { openRuntimeStore } from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { commitRuntimeCommandIn, hashRuntimeRequest } from '../../apps/platform/domains/runtime/command.ts';
import { loseFirstCommitAcknowledgement } from './commit-fault-proxy.ts';
import type { CommandKey, RuntimeTransaction } from '../../apps/platform/contracts/runtime-store.ts';
const code=(value:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===value);
const key=(epoch:string):CommandKey=>({domain:'test',action:'commit',commandId:'original',principal:{kind:'system',id:'rules'},recoveryEpoch:epoch});
test('lost real COMMIT acknowledgement does not replay; original receipt recovers once after reopening',async t=>{
 const f=await worldFixture();t.after(f.dispose);const proxy=await loseFirstCommitAcknowledgement(f.options.connectionString),store=await openRuntimeStore({...f.options,connectionString:proxy.connectionString});t.after(async()=>{await store.close();await proxy.close();});let calls=0;
 const options={key:key(f.identity.recoveryEpoch),requestHash:hashRuntimeRequest({once:1}),authorize:async()=>{},handle:async()=>{calls++;return {result:{id:'durable'},eventIds:[]};}};
 await assert.rejects(store.transaction(ctx=>commitRuntimeCommandIn(ctx,options)),code('unknown_commit'));assert.equal(proxy.dropped,true);assert.equal(calls,1);
 assert.equal((await f.runtime.transaction(ctx=>commitRuntimeCommandIn(ctx,options))).result.id,'durable');assert.equal(calls,1);assert.equal((await f.appQuery("SELECT count(*) AS total FROM runtime.command_receipts WHERE command_id='original'"))[0]!.total,'1');
});
test('three complete 40001 attempts roll back every partial event and receipt, with no fourth callback',async t=>{
 const f=await worldFixture();t.after(f.dispose);let calls=0;
 await f.query("CREATE FUNCTION runtime.test_serialization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated retry fixture' USING ERRCODE='40001'; END $$;CREATE TRIGGER test_serialization BEFORE INSERT ON runtime.command_receipts FOR EACH ROW EXECUTE FUNCTION runtime.test_serialization();");
 await assert.rejects(f.runtime.transaction(ctx=>commitRuntimeCommandIn(ctx,{key:key(f.identity.recoveryEpoch),requestHash:hashRuntimeRequest({once:1}),authorize:async()=>{},handle:async current=>{calls++;await current.events.append({eventId:'partial',domain:'test',kind:'test',schemaVersion:1,subject:{type:'fixture',id:'id',version:1},actor:{kind:'system',id:'rules'},source:'rules',occurredAt:current.now(),causationId:'original',correlationId:'original',audience:{kind:'private',agentIds:[]},payload:{}});return {result:{},eventIds:['partial']};}})),code('busy'));
 assert.equal(calls,3);assert.equal(await f.runtime.read(ctx=>ctx.events.get('partial')),undefined);assert.equal(await f.runtime.read(ctx=>ctx.commands.get(key(f.identity.recoveryEpoch))),undefined);
});
test('a changed database recovery epoch fences existing read/write pools, while explicit new-epoch store reads',async t=>{
 const f=await worldFixture();t.after(f.dispose);await f.query("UPDATE platform.instance_state SET recovery_epoch='explicit-next-epoch',write_generation=write_generation+1 WHERE singleton=1");
 await assert.rejects(f.runtime.read(async()=>true),code('conflict'));await assert.rejects(f.runtime.transaction(async()=>true),code('conflict'));await assert.rejects(f.legacy.read(async()=>true),code('conflict'));
 const next=await openRuntimeStore({...f.options,recoveryEpoch:'explicit-next-epoch'});try{assert.equal(await next.read(async ctx=>ctx.recoveryEpoch),'explicit-next-epoch');}finally{await next.close();}
});
test('runtime close drains accepted scopes and queued clients before pool shutdown; retained context expires',async t=>{
 const f=await worldFixture();t.after(f.dispose);const store=await openRuntimeStore({...f.options,poolMax:1});let release!:()=>void,entered!:()=>void,ended=false,retained:RuntimeTransaction|undefined;
 const hold=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});const active=store.transaction(async ctx=>{retained=ctx;entered();await hold;return ctx.now();});await ready;
 const queued=store.read(async ctx=>ctx.now()),closing=store.close().then(()=>{ended=true;});await assert.rejects(store.read(async()=>true),code('closed'));assert.equal(ended,false);release();await active;await queued;await closing;assert.equal(ended,true);assert.throws(()=>retained!.now(),code('closed'));await store.close();
});
