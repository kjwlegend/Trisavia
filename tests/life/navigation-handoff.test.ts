import test from 'node:test';import assert from 'node:assert/strict';
import {lifeFixture} from './fixture.ts';

test('a transfer longer than five seconds reaches the real destination, then only its arrival starts the act handoff window',async()=>{
 for(const late of [false,true]){
  const f=await lifeFixture(),bench=f.c.places.find(p=>p.placeId==='garden_bench')!;
  // Explicit synthetic geometry lengthens the work-to-rest walk; runtime coordinates are unchanged.
  for(const cells of [bench.cells,bench.approachCells,bench.entrances,bench.waitingCells,...bench.stations.flatMap(s=>[s.cells,s.approachCells??[]])])for(const cell of cells)cell.y+=7;
  const p=await f.add('transfer'),accepted=await f.invoke(p,'life.plans.submit',{expectedCatalogRevision:1,deadlineAt:f.now+7200000,maxSpendByCurrency:{star_coin:0},maxConsumeByItem:{},steps:[{stepId:'go-work',type:'move.to',placeId:'harbor_work'},{stepId:'work',type:'act',actionId:'work.shift',placeId:'harbor_work',jobId:'harbor_shift'},{stepId:'go-rest',type:'move.to',placeId:'garden_bench'},{stepId:'rest',type:'act',actionId:'rest.bench',placeId:'garden_bench'}]}),id=(accepted.result.plan as any).planId;
  for(let i=0;i<700;i++){const plan=(await f.repo.getPlan(id))!;if(plan.nextStep===3||plan.state!=='running')break;await f.run(1000);}
  const arrival=(await f.repo.getPlan(id))!,work=[...f.state.activities.values()].find(a=>a.actionId==='work.shift')!;assert.equal(arrival.state,'running');assert.equal(arrival.nextStep,3);assert.ok(arrival.results[2]!.completedAt-work.endedAt!>5000);const actual=(await f.f.world.getAvatar('default','transfer'))!.position;assert.ok(bench.approachCells.some(c=>actual.x===c.x&&actual.y===c.y));
  await f.run(late?6001:1000);const next=(await f.repo.getPlan(id))!;
  if(late){assert.equal(next.state,'partially_completed');assert.equal(next.stopCode,'life_handoff_expired');assert.equal([...f.state.activities.values()].filter(a=>a.actionId==='rest.bench').length,0);}
  else{assert.ok(next.currentActivityId);const rest=(await f.repo.getActivity(next.currentActivityId!))!;assert.equal(rest.actionId,'rest.bench');assert.ok(rest.startedAt-arrival.results[2]!.completedAt<=5000);await f.run(300000);assert.equal((await f.repo.getPlan(id))!.state,'completed');assert.equal((await f.repo.getActor({kind:'agent',id:'transfer'}))!.energy,100);}
  assert.equal(f.state.balances.get('agent:transfer'),36);
 }
});
