import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {join} from 'node:path';
import {worldFixture} from './postgresql-fixture.ts';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {townV2Rules} from '../../apps/platform/domains/world/town-v2.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {WORLD_REPOSITORY} from '../../apps/platform/domains/world/repository.ts';
import {createDeterministicScheduler} from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import {activateTownV2} from '../../scripts/world-town-v2-activate.ts';
import {prepareFriendshipLifecycle} from '../../scripts/friendships-prepare.ts';
import {assertCell} from '../../apps/platform/domains/world/rules.ts';
import type {GridPoint} from '../../apps/platform/domains/world/types.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

// Synthetic isolated identities only. No source material or credentials from the running World.
test('isolated signed topology activation preserves existing state and advances real legal steps',async t=>{
 const f=await worldFixture();try{
  const bytes=readFileSync(new URL('../../apps/web/public/world-map-v2.json',import.meta.url)),rules=townV2Rules(JSON.parse(bytes.toString()),createHash('sha256').update(bytes).digest('hex')),service=createWorldService(f.access);await f.runtime.transaction(ctx=>bootstrapWorld(ctx));
  const agents=await Promise.all(Array.from({length:4},()=>f.register()));
  const act=(i:number,action:string,input:JsonObject)=>f.runtime.transaction(async ctx=>service.execute(ctx,await f.access.authenticate(ctx,agents[i]!.runtimeToken,['runtime']),{domain:'world',action,commandId:randomUUID(),principal:{kind:'agent',id:agents[i]!.agentId},recoveryEpoch:ctx.recoveryEpoch},input));
  for(let i=0;i<agents.length;i++)assert.equal((await act(i,'world.avatar.create',{worldId:'default',expectedRulesetVersion:1})).outcome,'committed');
  const avatar=(i:number)=>f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getAvatar('default',agents[i]!.agentId)).then(a=>a!);
  const start=await avatar(0),dx=start.position.x<14?1:-1;
  const legacy=await act(0,'world.avatar.move',{worldId:'default',expectedVersion:start.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:start.position.x+dx,y:start.position.y},{x:start.position.x+2*dx,y:start.position.y}]});assert.equal(legacy.outcome,'committed');
  const snapshot=()=>f.legacy.read(async tx=>{const tables=['agents','owners','bindings','credentials','profiles','memberships','wallet_accounts','friendships','friendship_invitations'] as const;const rows:Record<string,unknown>={};for(const table of tables)rows[table]=await tx.find(table);return rows;});
  const rowsBefore=await snapshot(),avatarsBefore=await f.query('SELECT * FROM world.avatars ORDER BY id'),planBefore=await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getMovement(String(legacy.result.movementId)));
  await t.test('paired maintenance activates one immutable version without rebuilding Avatars or identities',async()=>{
   await assert.rejects(()=>activateTownV2(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database));
   await f.gate(false);const activated=await activateTownV2(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database);assert.equal(activated.changed,true);assert.equal(activated.rulesetVersion,2);assert.equal(activated.writeGate,false);
   const again=await activateTownV2(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database);assert.equal(again.changed,false);assert.equal(again.worldRevision,activated.worldRevision);
   assert.deepEqual(await snapshot(),rowsBefore);assert.deepEqual(await f.query('SELECT * FROM world.avatars ORDER BY id'),avatarsBefore);assert.deepEqual(await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getMovement(String(legacy.result.movementId))),planBefore);
   await prepareFriendshipLifecycle(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database);
   const current=await f.runtime.read(ctx=>service.readPublicRules(ctx,'default'));assert.equal(current.rules.unopened!.length,2860);assert.equal(current.rules.blocked.length,1622);assert.deepEqual(current.rules.bounds,rules.bounds);
   const scene=await f.runtime.read(ctx=>service.readPublicScene(ctx,'default'));assert.equal(scene.avatars.length,4);assert.equal(scene.npcs.length,3);assert(scene.npcs.every(n=>n.countsAsAgent===false&&n.actions.length===0));
   await f.gate(true);
  });
  const scheduler=createDeterministicScheduler({store:f.runtime,workerId:'town-v2-synthetic',batchLimit:10,handlers:[{kind:'world.movement.step',version:1,run:service.handleTask},{kind:'world.idle.step',version:1,run:service.handleIdleTask}]});
  await t.test('old commons plan keeps its frozen rules/path and yields stable committed motion through the final step',async()=>{
   for(let i=0;i<2;i++){f.tick(1000);await scheduler.runDue();const current=await avatar(0);assert.equal(current.position.x,start.position.x+(i+1)*dx);assert.equal(current.position.y,start.position.y);assert.equal(current.rulesetVersion,2);assert.equal(current.motion!.movementId,legacy.result.movementId);assert.equal(current.motion!.startedAt,f.now());assert.equal(current.motion!.arriveAt,f.now()+1000);}
   const plan=(await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getMovement(String(legacy.result.movementId))))!;assert.equal(plan.state,'completed');assert.equal(plan.rulesetVersion,1);assert.equal(plan.topologyVersion,1);assert.deepEqual(plan.path,planBefore!.path);
   const one=await f.runtime.read(ctx=>service.readPublicScene(ctx,'default'));f.tick(100);const two=await f.runtime.read(ctx=>service.readPublicScene(ctx,'default'));assert.deepEqual(one.avatars.find(a=>a.agentId===agents[0]!.agentId)!.motion,two.avatars.find(a=>a.agentId===agents[0]!.agentId)!.motion);assert.equal(one.avatars.find(a=>a.agentId===agents[0]!.agentId)!.motion!.status,'committed');
  });
  // Arrange independent synthetic fixtures at legal route starts; tested movement itself is the real service/task path.
  const arrange=async(i:number,position:GridPoint)=>f.runtime.transaction(async ctx=>{const repo=ctx.repository(WORLD_REPOSITORY),old=(await repo.getAvatar('default',agents[i]!.agentId))!;assertCell(rules,position);await repo.saveAvatar({...old,version:old.version+1,position,placeId:null,rulesetVersion:2,updatedAt:f.now(),motion:null},old.version);});
  await t.test('negative stairs and bridge deck use authoritative persisted movement; forbidden classes reject independently',async()=>{
   for(const [index,origin,path]of [[1,{x:-7,y:-10},Array.from({length:4},(_,i)=>({x:-7,y:-11-i}))],[2,{x:28,y:0},Array.from({length:14},(_,i)=>({x:29+i,y:0}))]] as const){await arrange(index,origin);const av=await avatar(index),move=await act(index,'world.avatar.move',{worldId:'default',expectedVersion:av.version,expectedRulesetVersion:2,expectedTopologyVersion:2,path:[...path]});assert.equal(move.outcome,'committed');for(let i=0;i<path.length;i++){f.tick(1000);await scheduler.runDue();const current=await avatar(index);assert.deepEqual(current.position,path[i]);assert.equal(current.motion!.source,'explicit');}assert.deepEqual((await avatar(index)).position,path.at(-1));}
   for(const [kind,cells]of [['physical',rules.blocked],['unopened',rules.unopened!]] as const){let origin:GridPoint|undefined,target:GridPoint|undefined;for(const cell of cells){for(const candidate of [{x:cell.x+1,y:cell.y},{x:cell.x-1,y:cell.y},{x:cell.x,y:cell.y+1},{x:cell.x,y:cell.y-1}])try{assertCell(rules,candidate);origin=candidate;target=cell;break;}catch{}if(origin)break;}assert(origin&&target);await arrange(2,origin);const av=await avatar(2),denied=await act(2,'world.avatar.move',{worldId:'default',expectedVersion:av.version,expectedRulesetVersion:2,expectedTopologyVersion:2,path:[{...target}]});assert.equal(denied.outcome,'conflict');assert.equal(denied.result.code,kind==='unopened'?'cell_unopened':'path_invalid');assert.deepEqual((await avatar(2)).position,origin);}
  });
  await t.test('idle uses signed topology and still obeys observe/pause; restart reads the same manifest and rule records',async()=>{
   await f.legacy.transaction(async tx=>{const row=(await tx.get('agents',agents[3]!.agentId))!;assert(await tx.update('agents',{...row,version:row.version+1,data:{...row.data,worldActionPolicy:{version:1,mode:'observe',updatedAt:f.now()}}},row.version));const member=(await tx.get('memberships',agents[0]!.agentId))!;assert(await tx.update('memberships',{...member,version:member.version+1,data:{...member.data,ownerPaused:true,ownerPauseVersion:2}},member.version));});
   const observed=await avatar(3),paused=await avatar(0);f.tick(40000);await scheduler.runDue();assert.deepEqual((await avatar(3)).position,observed.position);assert.deepEqual((await avatar(0)).position,paused.position);
   const scene=await f.runtime.read(ctx=>service.readPublicScene(ctx,'default'));assert.equal(scene.avatars.find(a=>a.agentId===agents[0]!.agentId)!.motion,null);
   const reopened=await f.openRuntime(),manifest=await reopened.read(ctx=>service.readPublicMapManifest(ctx,'default'));assert.equal(manifest.manifest?.layoutSha256,rules.mapManifest!.layoutSha256);assert.equal(manifest.manifest?.geometryDigest,rules.mapManifest!.geometryDigest);
   const classes=await f.query('SELECT cell_kind,count(*)::integer AS count FROM world.blocked_cells WHERE ruleset_version=2 GROUP BY cell_kind ORDER BY cell_kind');assert.deepEqual(classes,[{cell_kind:'physical',count:1622},{cell_kind:'unopened',count:2860}]);
  });
 }finally{await f.dispose();}
});
