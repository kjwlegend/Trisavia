import assert from 'node:assert/strict';
import test from 'node:test';
import { worldFixture } from './postgresql-fixture.ts';
import { createDeterministicScheduler } from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import type { RuntimeTaskDraft, RuntimeTransaction } from '../../apps/platform/contracts/runtime-store.ts';
const code=(value:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===value);
async function setup(){const f=await worldFixture();await f.runtime.transaction(async ctx=>{await ctx.tasks.advanceGeneration('test',0);});return f;}
const draft=(now:number,maxAttempts=3):RuntimeTaskDraft=>({taskId:'step',domain:'test',kind:'test.step',handlerVersion:1,dedupeKey:'step',target:{type:'plan',id:'plan',version:1},timeKind:'utc',dueAt:now,generation:1,maxAttempts,payloadVersion:1,payload:{}});
async function fact(ctx:RuntimeTransaction,id:string){return ctx.events.append({eventId:id,domain:'test',kind:'test.progress',schemaVersion:1,subject:{type:'plan',id:'plan',version:1},actor:{kind:'system',id:'rules'},source:'rules',occurredAt:ctx.now(),causationId:'step',correlationId:'step',audience:{kind:'private',agentIds:[]},payload:{step:1}});}
test('lease reclaim advances fencing; stale worker cannot commit one step twice or use an old caller time',async t=>{
 const f=await setup();t.after(f.dispose);await f.runtime.transaction(async ctx=>{await ctx.tasks.schedule(draft(ctx.now()));});
 const first=(await f.runtime.transaction(ctx=>ctx.tasks.claimDue({now:ctx.now(),workerId:'first',leaseMs:10,limit:1})))[0]!;f.tick(11);
 const second=(await f.runtime.transaction(ctx=>ctx.tasks.claimDue({now:ctx.now(),workerId:'second',leaseMs:100,limit:1})))[0]!;assert.equal(second.fence,first.fence+1);assert.notEqual(second.lease!.token,first.lease!.token);
 await assert.rejects(f.runtime.transaction(ctx=>ctx.tasks.assertLease(first.lease!,0)),code('lease_lost'));
 await f.runtime.transaction(async ctx=>{await ctx.tasks.assertLease(second.lease!,ctx.now());await fact(ctx,'only-step');await ctx.tasks.complete(second.lease!,ctx.now());});
 await assert.rejects(f.runtime.transaction(ctx=>ctx.tasks.complete(first.lease!,0)),code('lease_lost'));
 assert.equal((await f.runtime.read(ctx=>ctx.tasks.get('step')))?.state,'completed');assert.equal((await f.runtime.read(ctx=>ctx.events.list({domain:'test',limit:10}))).length,1);
 await assert.rejects(f.appQuery("UPDATE runtime.tasks SET version=version+1,state='pending' WHERE task_id='step'"),code('23514'));
});
test('lease expiry at final commit rolls back handler fact and next task; generation invalidates old work',async t=>{
 const f=await setup();t.after(f.dispose);await f.runtime.transaction(async ctx=>{await ctx.tasks.schedule(draft(ctx.now()));});
 const claimed=(await f.runtime.transaction(ctx=>ctx.tasks.claimDue({now:ctx.now(),workerId:'worker',leaseMs:10,limit:1})))[0]!;
 await assert.rejects(f.runtime.transaction(async ctx=>{await fact(ctx,'must-rollback');await ctx.tasks.schedule({...draft(ctx.now()),taskId:'next',dedupeKey:'next'});await ctx.tasks.complete(claimed.lease!,ctx.now());f.tick(11);}),code('lease_lost'));
 assert.equal(await f.runtime.read(ctx=>ctx.events.get('must-rollback')),undefined);assert.equal(await f.runtime.read(ctx=>ctx.tasks.get('next')),undefined);
 const newer=(await f.runtime.transaction(ctx=>ctx.tasks.claimDue({now:ctx.now(),workerId:'newer',leaseMs:100,limit:1})))[0]!;
 await f.runtime.transaction(async ctx=>{await ctx.tasks.advanceGeneration('test',1);});await assert.rejects(f.runtime.transaction(ctx=>ctx.tasks.complete(newer.lease!,ctx.now())),code('lease_lost'));
 assert.deepEqual(await f.runtime.transaction(ctx=>ctx.tasks.claimDue({now:ctx.now(),workerId:'none',leaseMs:100,limit:10})),[]);
 await assert.rejects(f.appQuery("UPDATE runtime.module_generations SET generation=1 WHERE domain='test'"),code('23514'));
});
test('bounded deterministic failures keep original due time and deduplication, then terminate without handler side effects',async t=>{
 const f=await setup();t.after(f.dispose);const original=draft(f.now(),2);await f.runtime.transaction(async ctx=>{await ctx.tasks.schedule(original);});
 const scheduler=createDeterministicScheduler({store:f.runtime,workerId:'bounded',leaseMs:10000,retryBaseMs:10,retryMaxMs:20,handlers:[{kind:'test.step',version:1,run:async ctx=>{await fact(ctx,'failed-fact');throw new Error('simulated domain handler failure');}}]});t.after(()=>scheduler.close());
 assert.deepEqual(await scheduler.runDue(),{claimed:1,completed:0,retried:1,failed:0,leaseLost:0});assert.equal((await f.runtime.read(ctx=>ctx.tasks.get('step')))?.dueAt,original.dueAt);
 assert.equal((await f.runtime.transaction(ctx=>ctx.tasks.schedule(original))).attempts,1);assert.equal((await scheduler.runDue()).claimed,0);f.tick(10);
 assert.deepEqual(await scheduler.runDue(),{claimed:1,completed:0,retried:0,failed:1,leaseLost:0});assert.equal((await f.runtime.read(ctx=>ctx.tasks.get('step')))?.state,'failed');assert.equal(await f.runtime.read(ctx=>ctx.events.get('failed-fact')),undefined);
 f.tick(100);assert.equal((await scheduler.runDue()).claimed,0);await scheduler.close();await assert.rejects(scheduler.runDue(),code('closed'));
});
test('Outbox event/consumer is deduplicated; delivery completion is fenced and separate from Agent confirmation',async t=>{
 const f=await setup();t.after(f.dispose);await f.runtime.transaction(async ctx=>{const e=await fact(ctx,'outbox-event');const entry={outboxId:'delivery',eventId:e.eventId,consumerId:'projection',dedupeKey:e.eventId,generation:1,dueAt:ctx.now(),maxAttempts:2};await ctx.outbox.enqueue(entry);assert.equal((await ctx.outbox.enqueue(entry)).version,1);});
 const claimed=(await f.runtime.transaction(ctx=>ctx.outbox.claimDue({consumerId:'projection',now:ctx.now(),workerId:'projection',leaseMs:10,limit:1})))[0]!;f.tick(11);
 const reclaimed=(await f.runtime.transaction(ctx=>ctx.outbox.claimDue({consumerId:'projection',now:ctx.now(),workerId:'replacement',leaseMs:100,limit:1})))[0]!;
 await assert.rejects(f.runtime.transaction(ctx=>ctx.outbox.complete(claimed.lease!,ctx.now())),code('lease_lost'));await f.runtime.transaction(ctx=>ctx.outbox.complete(reclaimed.lease!,ctx.now()));
 assert.equal((await f.runtime.read(ctx=>ctx.outbox.get('delivery')))?.state,'completed');assert.equal((await f.runtime.read(ctx=>ctx.events.get('outbox-event')))?.eventId,'outbox-event');assert.equal(await f.legacy.read(tx=>tx.count('perception_states',{},10)),0);
});
test('only registered module kinds are claimed; a disabled/empty registry leaves all pending work untouched',async t=>{
 const f=await setup();t.after(f.dispose);await f.runtime.transaction(async ctx=>{await ctx.tasks.schedule(draft(ctx.now()));await ctx.tasks.schedule({...draft(ctx.now()),taskId:'other-module',kind:'interaction.expire',dedupeKey:'other-module'});});
 const empty=createDeterministicScheduler({store:f.runtime,workerId:'empty',handlers:[]});assert.equal((await empty.runDue()).claimed,0);await empty.close();
 const only=createDeterministicScheduler({store:f.runtime,workerId:'enabled',handlers:[{kind:'test.step',version:1,run:async()=>{}}]});try{assert.equal((await only.runDue()).completed,1);}finally{await only.close();}
 assert.equal((await f.runtime.read(ctx=>ctx.tasks.get('other-module')))?.state,'pending');assert.equal((await f.runtime.read(ctx=>ctx.tasks.get('other-module')))?.attempts,0);
});
