import test from 'node:test';import assert from 'node:assert/strict';import {Ajv} from 'ajv';
import {coreFixture} from './runtime-fixture.ts';import {lifeFixture} from '../life/fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {worldGatewayOperations,worldGatewayLegacyOperations} from '../../apps/platform/application/agent-gateway-world.ts';
import {createDeterministicScheduler} from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import {MOVEMENT_POLICY_V1,type WorldRuleset} from '../../apps/platform/domains/world/types.ts';
import {CURRENT_MOVEMENT_POLICY} from '../../apps/platform/domains/world/movement-policy.ts';
import {IDLE_LIFE_POLICY_V1,CURRENT_IDLE_LIFE_POLICY,roamingPath} from '../../apps/platform/domains/world/idle-life.ts';
import {validatePath} from '../../apps/platform/domains/world/rules.ts';
import {createRuntimeRepositories} from '../../apps/platform/infrastructure/postgresql/runtime-repositories.ts';
import type {RuntimeSql} from '../../apps/platform/infrastructure/postgresql/runtime-sql.ts';
const rules:WorldRuleset={worldId:'default',version:1,topologyVersion:1,width:40,height:6,spawn:{x:1,y:1},blocked:[],places:[],maxPathLength:64};
async function worldFixture(){const f=coreFixture(),busy=new Set<string>(),service=createWorldService(f.identity,{activities:{async isOccupied(_ctx,_w,id){return busy.has(id);},async interrupt(){}}});await f.store.transaction(ctx=>bootstrapWorld(ctx,rules));const add=async(id:string)=>{const p=f.addAgent(id);assert(p.kind==='agent');await f.store.transaction(ctx=>service.execute(ctx,p,f.key(p,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}));return p;};const scheduler=createDeterministicScheduler({store:f.store,workerId:'policy-080',batchLimit:20,handlers:[{kind:'world.movement.step',version:1,run:service.handleTask},{kind:'world.idle.step',version:1,run:service.handleIdleTask}]});return{f,service,add,scheduler,busy};}

test('new V2 explicit moves advance at 500ms; persisted V1 stays 1000ms with uninterrupted versions and motion',async()=>{
 const x=await worldFixture(),{f}=x;try{
  const ids:string[]=[];for(const id of ['new','persisted']){const p=await x.add(id),a=(await f.world.getAvatar('default',id))!,dx=a.position.x<37?1:-1;const r=await f.store.transaction(ctx=>x.service.execute(ctx,p,f.key(p,'world.avatar.move'),{worldId:'default',expectedVersion:a.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[1,2].map(n=>({x:a.position.x+n*dx,y:a.position.y}))}));ids.push(String(r.result.movementId));assert.equal(r.result.policyVersion,2);assert.equal(r.result.stepIntervalMs,500);}
  // Exact persisted legacy fixture, not a migration/rewrite performed by runtime code.
  const old=f.state.movements.get(ids[1]!)!;Object.assign(old,{policyVersion:1,stepIntervalMs:1000,nextDueAt:f.now+1000});const oldTask=[...f.state.tasks.values()].find(t=>t.target.id===old.id)!;oldTask.dueAt=old.nextDueAt!;
  const start=f.now;f.now=start+499;assert.equal((await x.scheduler.runDue()).claimed,0);f.now=start+500;await x.scheduler.runDue();assert.equal(f.state.movements.get(ids[0]!)!.nextStep,1);assert.equal(f.state.movements.get(ids[1]!)!.nextStep,0);assert.equal((await f.world.getAvatar('default','new'))!.motion!.arriveAt-start,1000);
  f.now=start+1000;await x.scheduler.runDue();assert.equal(f.state.movements.get(ids[0]!)!.state,'completed');assert.equal(f.state.movements.get(ids[1]!)!.nextStep,1);const motion=(await f.world.getAvatar('default','persisted'))!.motion!;assert.equal(motion.arriveAt-motion.startedAt,1000);
  f.now=start+1500;await x.scheduler.runDue();assert.equal(f.state.movements.get(ids[1]!)!.nextStep,1);f.now=start+2000;await x.scheduler.runDue();assert.equal(f.state.movements.get(ids[1]!)!.state,'completed');assert.equal(f.state.movements.get(ids[1]!)!.stoppedCode,null);
  assert.deepEqual(MOVEMENT_POLICY_V1,{version:1,stepIntervalMs:1000});assert.equal(IDLE_LIFE_POLICY_V1.stepIntervalMs,4000);
 }finally{await x.scheduler.close();}
});

test('roaming reaches only authored reachable entrances with bounded legal legs; occupancy, pause and explicit bodies retain priority',async()=>{
 const geometry={...structuredClone(rules),blocked:[...Array.from({length:5},(_,y)=>({x:10,y})),{x:35,y:4},{x:36,y:3},{x:37,y:4},{x:36,y:5}],mapManifest:{buildings:[{entrance:{x:30,y:1}},{entrance:{x:36,y:4}}]}} as unknown as WorldRuleset;
 const path=roamingPath(geometry,{x:1,y:1},[{x:11,y:4}],0);assert(path.length>3);assert(path.length<=24);validatePath(geometry,{x:1,y:1},path);assert(path.every(p=>p.x!==11||p.y!==4));
 const x=await worldFixture(),p=await x.add('roaming'),{f}=x;try{
  const task=()=>[...f.state.tasks.values()].find(t=>t.kind==='world.idle.step')!,avatar=()=>f.world.getAvatar('default',p.agentId);x.busy.add(p.agentId);const before=(await avatar())!;f.now=task().dueAt;await x.scheduler.runDue();assert.deepEqual(await avatar(),before);assert.deepEqual(task().payload.path,[]);
  x.busy.clear();f.membership(p.agentId,{ownerPaused:true,ownerPauseVersion:2});f.now=task().dueAt;await x.scheduler.runDue();assert.deepEqual(await avatar(),before);
  f.membership(p.agentId,{ownerPaused:false,ownerPauseVersion:3});const eventCount=f.state.events.length;f.now=task().dueAt;await x.scheduler.runDue();const after=(await avatar())!;assert.equal(after.motion!.arriveAt-after.motion!.startedAt,1000);assert.equal(task().payload.idlePolicyVersion,2);assert.equal(f.state.events.length,eventCount,'Roaming still produces no user-log or source events');
  const dx=after.position.x<39?1:-1,move=await f.store.transaction(ctx=>x.service.execute(ctx,p,f.key(p,'world.avatar.move'),{worldId:'default',expectedVersion:after.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:after.position.x+dx,y:after.position.y}]}));assert.equal(move.result.nextDueAt,after.motion!.arriveAt+500,'Finish the old committed segment before another leg');
  f.now=task().dueAt;await x.scheduler.runDue();const explicit=f.state.movements.get(String(move.result.movementId))!;assert(explicit.state==='pending'||explicit.state==='completed');assert.deepEqual(task().payload.path,[],'Roam never takes an explicit path');
 }finally{await x.scheduler.close();}
});

test('Life navigation uses actual 500ms committed segments, waits legacy motion and only then hands off; activity duration remains fixed',async()=>{
 const x=await lifeFixture(),p=await x.add('life-speed',{x:12,y:2});assert(p.kind==='agent');const a=(await x.f.world.getAvatar('default',p.agentId))!;a.motion={segmentId:a.id+':1',movementId:'old-life-segment',source:'explicit',from:{x:13,y:2},to:{x:12,y:2},startedAt:x.now,arriveAt:x.now+1000,rulesetVersion:1,topologyVersion:1,status:'committed'};x.f.state.avatars.set(JSON.stringify(['default',p.agentId]),a);
 try{
  const accepted=await x.invoke(p,'life.plans.submit',{expectedCatalogRevision:1,deadlineAt:x.now+7200000,maxSpendByCurrency:{star_coin:0},maxConsumeByItem:{},steps:[{stepId:'go',type:'move.to',placeId:'harbor_work'},{stepId:'work',type:'act',actionId:'work.shift',placeId:'harbor_work',jobId:'harbor_shift'}]}),id=(accepted.result.plan as any).planId;
  const oldPosition=structuredClone(a.position);await x.run(500);assert.deepEqual((await x.f.world.getAvatar('default',p.agentId))!.position,oldPosition);await x.run(500);let previous=(await x.f.world.getAvatar('default',p.agentId))!.motion!;assert.equal(previous.arriveAt-previous.startedAt,500);
  for(let i=0;i<40&&!(await x.repo.getPlan(id))!.currentActivityId;i++){await x.run(500);const current=(await x.f.world.getAvatar('default',p.agentId))!.motion!;if(current.segmentId!==previous.segmentId){assert(current.startedAt>=previous.arriveAt);previous=current;}}
  const plan=(await x.repo.getPlan(id))!,work=(await x.repo.getActivity(plan.currentActivityId!))!;assert.equal(work.actionId,'work.shift');assert.equal(work.scheduledEndAt-work.startedAt,600000);assert(plan.results[0]!.completedAt<=work.startedAt);assert.equal(x.state.balances.size,0);
 }finally{await x.scheduler.close();}
});

test('current movement schema accepts only valid V1/V2 pairs without changing exact legacy schemas',async()=>{
 const x=await worldFixture();try{const legacy=worldGatewayLegacyOperations(x.service),bytes=JSON.stringify(legacy.map(o=>[o.id,o.input,o.output])),current=worldGatewayOperations(x.service),old=legacy.find(o=>o.id==='world.movement')!,now=current.find(o=>o.id==='world.movement')!;assert.equal(old.schemaVersion,2);assert.equal(now.schemaVersion,3);const properties=(now.output.properties as any),base=Object.fromEntries(Object.entries(properties).map(([k,v]:any)=>[k,v.anyOf?null:v.enum?v.enum[0]:v.type==='string'?'x':1]));const valid=new Ajv().compile(now.output);for(const[policyVersion,stepIntervalMs]of[[1,1000],[2,500]])assert(valid({...base,policyVersion,stepIntervalMs}),JSON.stringify(valid.errors));for(const[policyVersion,stepIntervalMs]of[[1,500],[2,1000],[3,250]])assert(!valid({...base,policyVersion,stepIntervalMs}));assert.equal(JSON.stringify(legacy.map(o=>[o.id,o.input,o.output])),bytes);assert.equal(CURRENT_MOVEMENT_POLICY.stepIntervalMs,500);assert.equal(CURRENT_IDLE_LIFE_POLICY.maxPathLength,24);}finally{await x.scheduler.close();}
});

test('actual runtime recurrence adapter lowers only the named Life tick bound and keeps generation/fence checks',async()=>{
 for(const domain of ['life','world']){const at=100000,updates:unknown[][]=[],checks:(()=>Promise<void>)[]=[],row={domain,kind:domain==='life'?'life.actor.tick':'world.idle.step',target_type:domain==='life'?'agent':'avatar',handler_version:1,payload_version:1,state:'leased',due_at:at-1,lease_token:'token',lease_worker:'worker',lease_expires_at:at+10000,fence:2,generation:1};
  const sql={now:()=>at,writable(){},query:async()=>[{generation:1}],mutate:async(statement:string,values:unknown[])=>{if(statement.startsWith('SELECT *'))return[row];updates.push(values);return[];},scope:{beforeCommit(check:()=>Promise<void>){checks.push(check);}}} as unknown as RuntimeSql;
  const repo=createRuntimeRepositories(sql,'epoch').tasks,lease={id:'task',token:'token',workerId:'worker',fence:2,generation:1,expiresAt:at+10000};await repo.recurIdle(lease,{now:at,dueAt:at+1,payload:{}});assert.equal(updates[0]![1],at+(domain==='life'?500:1000));await checks[0]!();await assert.rejects(repo.recurIdle({...lease,fence:1},{now:at,dueAt:at+500,payload:{}}),{code:'lease_lost'});assert.equal(updates.length,1);
 }
});
