import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {worldFixture} from './postgresql-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {bootstrapInteraction,createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {createDeterministicScheduler} from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import {BEHAVIOR_REPOSITORY} from '../../apps/platform/domains/behavior/repository.ts';
import {BEHAVIOR_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/behavior-migration.ts';
import {WORLD_REPOSITORY} from '../../apps/platform/domains/world/repository.ts';
import {prepareBehaviorSources} from '../../scripts/behavior-prepare.ts';
import {prepareFriendshipLifecycle} from '../../scripts/friendships-prepare.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

test('one isolated PG target: atomic source projections, stable cuts, persisted idle cadence and minimum permissions',async t=>{
 const f=await worldFixture();try{
  const world=createWorldService(f.access),relationships=createRelationshipsService(f.access);let intent=0;
  const interaction=createInteractionService(f.access,{async ensure(){return {decisionId:'synthetic-'+(++intent),version:1};},async cancel(){}});
  await f.runtime.transaction(async ctx=>{await bootstrapWorld(ctx);await bootstrapInteraction(ctx);});const a=await f.register(),b=await f.register();
  const move=(action:string,input:JsonObject,id=randomUUID())=>f.runtime.transaction(async ctx=>world.execute(ctx,await f.access.authenticate(ctx,a.runtimeToken,['runtime']),{domain:'world',action,commandId:id,principal:{kind:'agent',id:a.agentId},recoveryEpoch:ctx.recoveryEpoch},input));
  const social=(action:string,input:JsonObject)=>f.runtime.transaction(async ctx=>interaction.execute(ctx,await f.access.authenticate(ctx,a.runtimeToken,['runtime']),{domain:'interaction',action,commandId:randomUUID(),principal:{kind:'agent',id:a.agentId},recoveryEpoch:ctx.recoveryEpoch},input));
  const scheduler=createDeterministicScheduler({store:f.runtime,workerId:'behavior-pg',batchLimit:10,handlers:[{kind:'world.movement.step',version:1,run:world.handleTask},{kind:'world.idle.step',version:1,run:world.handleIdleTask}]});
  const avatar=()=>f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getAvatar('default',a.agentId)).then(a=>a!);
  const records=()=>f.runtime.read(async ctx=>{const repo=ctx.repository(BEHAVIOR_REPOSITORY),cut=await repo.cut();return repo.list({maxSequence:cut.maxSequence,limit:100});});
  await move('world.avatar.create',{worldId:'default',expectedRulesetVersion:1});let current=await avatar(),dx=current.position.x<13?1:-1;
  await move('world.avatar.move',{worldId:'default',expectedVersion:current.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:current.position.x+dx,y:current.position.y}]});f.tick(1000);await scheduler.runDue();assert.equal((await records()).length,0);
  await t.test('coverage is real activation, no backfill, frozen keyset excludes later records, and indexes are present',async()=>{
   const before=await f.query('SELECT * FROM world.avatars ORDER BY id');await f.gate(false);
   const activated=await prepareBehaviorSources(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database,{activate:true,now:f.now});assert.equal(activated.coverage.length,4);assert(activated.coverage.every(c=>c.fromAt===f.now()));assert.equal(activated.coverage.find(c=>c.scope==='world_idle')!.partial,true);
   f.tick(1);const again=await prepareBehaviorSources(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database,{activate:true,now:f.now});assert.deepEqual(again.coverage,activated.coverage);assert.deepEqual(await f.query('SELECT * FROM world.avatars ORDER BY id'),before);assert.equal((await records()).length,0);
   await prepareFriendshipLifecycle(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database);await f.gate(true);
   current=await avatar();dx=current.position.x<13?1:-1;await move('world.avatar.move',{worldId:'default',expectedVersion:current.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[1,2,3].map(i=>({x:current.position.x+i*dx,y:current.position.y}))});for(let i=0;i<3;i++){f.tick(1000);await scheduler.runDue();}
   const logged=await records();assert.deepEqual(logged.map(r=>r.node).sort(),['world.movement.completed','world.movement.received','world.movement.started']);assert(logged.every(r=>r.ownerAudience===null));assert.equal(logged.filter(r=>r.publicProjection!==null).length,2);assert.equal(logged.find(r=>r.node==='world.movement.started')!.origin,'external_agent');
   const frozen=await f.runtime.read(ctx=>ctx.repository(BEHAVIOR_REPOSITORY).cut());
   await f.runtime.transaction(async ctx=>relationships.execute(ctx,await f.access.authenticate(ctx,a.runtimeToken,['runtime']),{domain:'relationships',action:'relationships.invitation.send',commandId:randomUUID(),principal:{kind:'agent',id:a.agentId},recoveryEpoch:ctx.recoveryEpoch},{toAgentId:b.agentId,message:'PRIVATE SYNTHETIC NOTE'}));
   const paged:string[]=[];let after:{occurredAt:number;id:string}|undefined;for(let i=0;i<10;i++){const page=await f.runtime.read(ctx=>ctx.repository(BEHAVIOR_REPOSITORY).list({agentId:a.agentId,maxSequence:frozen.maxSequence,limit:1,...(after?{after}:{})}));if(!page.length)break;paged.push(page[0]!.id);after={occurredAt:page[0]!.occurredAt,id:page[0]!.id};}assert.equal(paged.length,3);assert.equal(new Set(paged).size,3);assert.deepEqual(paged,logged.map(r=>r.id));
   const indexes=await f.query("SELECT indexname FROM pg_indexes WHERE schemaname='behavior'");for(const name of ['behavior_agent_time','behavior_public_time','behavior_idle_cadence'])assert(indexes.some(i=>i.indexname===name));
  });
  await t.test('projection failure rolls back the real movement/event/receipt and app cannot rewrite history or activate coverage',async()=>{
   const before=await f.query("SELECT (SELECT count(*) FROM world.movements)::integer AS movements,(SELECT count(*) FROM runtime.events)::integer AS events,(SELECT count(*) FROM behavior.records)::integer AS records");
   await f.query('REVOKE INSERT ON behavior.records FROM connet_app');current=await avatar();const destination={x:current.position.x-dx,y:current.position.y};
   await assert.rejects(()=>move('world.avatar.move',{worldId:'default',expectedVersion:current.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[destination]}));
   assert.deepEqual(await f.query("SELECT (SELECT count(*) FROM world.movements)::integer AS movements,(SELECT count(*) FROM runtime.events)::integer AS events,(SELECT count(*) FROM behavior.records)::integer AS records"),before);assert.deepEqual((await avatar()).position,current.position);await f.query(BEHAVIOR_PERMISSIONS_SQL);
   const permission=await f.appQuery("SELECT has_table_privilege(current_user,'behavior.records','INSERT') AS insert_record,has_table_privilege(current_user,'behavior.records','UPDATE') AS update_record,has_table_privilege(current_user,'behavior.records','DELETE') AS delete_record,has_table_privilege(current_user,'behavior.coverage','INSERT') AS activate");assert.deepEqual(permission,[{insert_record:true,update_record:false,delete_record:false,activate:false}]);
   await assert.rejects(()=>f.runtime.transaction(ctx=>ctx.repository(BEHAVIOR_REPOSITORY).activateCoverage('world_idle',f.now())));
   const row=(await records())[0]!;await assert.rejects(()=>f.query('UPDATE behavior.records SET node=node WHERE id=$1',[row.id]));
   await assert.rejects(()=>f.runtime.transaction(ctx=>ctx.repository(BEHAVIOR_REPOSITORY).append({...row,sourceEventId:'invented-event'})));
  });
  await t.test('sparse idle completion survives reopen and source withdrawals change cursor visibility without private-body copies',async()=>{
   const tick=async()=>{const task=await f.runtime.read(ctx=>ctx.tasks.get('world-idle:'+(current.id)+':1'));assert(task);f.tick(Math.max(0,task.dueAt-f.now()));await scheduler.runDue();};
   for(let i=0;i<10&&!(await records()).some(r=>r.node==='world.idle.completed');i++)await tick();let daily=(await records()).filter(r=>r.node==='world.idle.completed');assert.equal(daily.length,1);const first=daily[0]!;
   const reopened=await f.openRuntime();assert.equal(await reopened.transaction(ctx=>ctx.repository(BEHAVIOR_REPOSITORY).shouldRecordIdle(a.agentId,first.occurredAt+299999)),false);
   for(let i=0;i<3;i++)await tick();assert.equal((await records()).filter(r=>r.node==='world.idle.completed').length,1);f.tick(Math.max(0,first.occurredAt+300001-f.now()));for(let i=0;i<10&&(await records()).filter(r=>r.node==='world.idle.completed').length<2;i++)await tick();daily=(await records()).filter(r=>r.node==='world.idle.completed');assert.equal(daily.length,2);assert(Math.abs(daily[0]!.occurredAt-daily[1]!.occurredAt)>=300000);
   const actual=await f.query("SELECT count(*)::integer AS count FROM runtime.events WHERE kind='world.idle.completed'");assert.equal(actual[0]!.count,2);
   const work=await social('interaction.artifact.create',{body:'PRIVATE SYNTHETIC WORK BODY',title:'PRIVATE SYNTHETIC TITLE'});const invite=await social('interaction.invitation.send',{worldId:'default',toAgentId:b.agentId,artifact:work.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'PRIVATE INTENT'});assert.equal(invite.outcome,'committed');
   const oldVersion=await f.runtime.read(ctx=>ctx.repository(BEHAVIOR_REPOSITORY).visibilityVersion(b.agentId));await social('interaction.artifact.withdraw',{artifact:work.result.artifact!,expectedVersion:1});assert((await f.runtime.read(ctx=>ctx.repository(BEHAVIOR_REPOSITORY).visibilityVersion(b.agentId)))>oldVersion);
   const log=(await records()).find(r=>r.node==='interaction.invitation.received'&&r.agentId===b.agentId)!;assert.equal(await f.runtime.read(ctx=>interaction.canObserveBehavior(ctx,log,'owner')),false);assert(!JSON.stringify(await records()).includes('PRIVATE'));
  });
 }finally{await f.dispose();}
});
