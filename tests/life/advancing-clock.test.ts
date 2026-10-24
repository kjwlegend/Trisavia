import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeFixture} from './fixture.ts';

// Unlike the fixed-clock suite, time advances across repository/await boundaries in one transaction.
test('an advancing clock preserves the completed source instant in behavior and releases the body once',async()=>{
 const f=await lifeFixture();f.context.now=()=>{f.now+=2;return f.now;};
 const p=await f.add('advancing-clock'),accepted=await f.invoke(p,'life.activities.start',f.startInput),id=(accepted.result.activity as any).activityId;
 const run=await f.run(600000);assert.equal(run.retried,0);assert.equal(run.failed,0);
 const activity=(await f.repo.getActivity(id))!,event=f.f.state.events.find(e=>e.eventId===activity.sourceEventId)!,row=[...f.f.state.behaviorRecords.values()].find(r=>r.sourceRef.id===id)!;
 assert.equal(activity.state,'completed');assert.equal(row.occurredAt,event.occurredAt);assert.equal(row.occurredAt,activity.endedAt);assert.ok(row.recordedAt>row.occurredAt);
 assert.equal(f.state.balances.get('agent:advancing-clock'),36);assert.equal((await f.repo.getActor({kind:'agent',id:'advancing-clock'}))!.body,null);
 await f.run(1000);assert.equal(f.state.credits.size,1);assert.equal(f.f.state.behaviorRecords.size,1);
});

test('failed-task reconciliation uses its committed interruption instant and cannot strand the next actor',async()=>{
 const f=await lifeFixture();f.context.now=()=>{f.now+=2;return f.now;};const a=await f.add('failed-source'),accepted=await f.invoke(a,'life.activities.start',f.startInput),id=(accepted.result.activity as any).activityId;
 const actor=(await f.repo.getActor({kind:'agent',id:'failed-source'}))!,task=f.f.state.tasks.get(actor.taskId!)!;task.state='failed';task.lease=null;task.lastErrorCode='attempts_exhausted';
 await f.store.transaction(ctx=>f.engine.reconcile(ctx));const ended=(await f.repo.getActivity(id))!,event=f.f.state.events.find(e=>e.eventId===ended.sourceEventId)!,row=[...f.f.state.behaviorRecords.values()].find(r=>r.sourceRef.id===id)!;
 assert.equal(ended.state,'interrupted');assert.equal(row.occurredAt,event.occurredAt);assert.equal(row.occurredAt,ended.endedAt);assert.equal(ended.result!.quotaRefunded,true);assert.equal((await f.repo.getActor({kind:'agent',id:'failed-source'}))!.body,null);
 const b=await f.add('next-actor');assert.equal((await f.invoke(b,'life.activities.start',f.startInput)).outcome,'committed');const run=await f.run(600000);assert.equal(run.failed,0);assert.equal(run.retried,0);assert.equal(f.state.balances.get('agent:next-actor'),36);
});
