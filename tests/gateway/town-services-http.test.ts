import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {buildApp} from '../../apps/platform/app.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {publishPerceptionCatalog} from '../../apps/platform/application/perception-catalog.ts';
import {catalogRepository} from '../../apps/platform/domains/perception/repository.ts';
import {AGENT_WORLD_MAP_V2_GUIDE} from '../../apps/platform/application/agent-human-voice.ts';
import {createDeterministicScheduler} from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import {townV2Rules,TOWN_V2_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-v2.ts';
import type {GridPoint} from '../../apps/platform/domains/world/types.ts';
import {prepareBehaviorSources} from '../../scripts/behavior-prepare.ts';
import {prepareTownServices} from '../../scripts/town-services-prepare.ts';
import {runNpcServiceReaders} from '../../scripts/npc-service-readers.ts';
import {credential,injectApi,ok,ownerFixture,registrationCommand} from '../../scripts/agent-manager-qa-fixture.ts';
import {gatewayFixture} from './postgresql-fixture.ts';

const pointKey=(p:GridPoint)=>p.x+','+p.y;
/** An isolated host planner, not a server navigation feature. */
function route(rules:ReturnType<typeof townV2Rules>,from:GridPoint,to:GridPoint){
 const blocked=new Set([...rules.blocked,...rules.unopened!].map(pointKey)),previous=new Map<string,GridPoint|null>([[pointKey(from),null]]),queue=[from],b=rules.bounds!;
 for(let i=0;i<queue.length&&!previous.has(pointKey(to));i++){const p=queue[i]!;for(const n of [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}])if(n.x>=b.minX&&n.x<=b.maxX&&n.y>=b.minY&&n.y<=b.maxY&&!blocked.has(pointKey(n))&&!previous.has(pointKey(n))){previous.set(pointKey(n),p);queue.push(n);}}
 assert(previous.has(pointKey(to)));const path:GridPoint[]=[];for(let p=to;pointKey(p)!==pointKey(from);p=previous.get(pointKey(p))!)path.unshift(p);return path;
}

test('registered runtime discovers real NPC services after controlled publication, walks to claim and use a real voucher, and Owner only observes',async()=>{
 const rules=townV2Rules(JSON.parse(await readFile(new URL('../../apps/web/public/world-map-v2.json',import.meta.url),'utf8')),TOWN_V2_LAYOUT_SHA256),f=await gatewayFixture({worldRules:rules});
 let app=await buildApp({...f.options,clock:f.now,email:{mode:'experience'},worldCoreEnabled:true,worldCoreInteractionEnabled:true});const validator=Fastify({bodyLimit:256*1024});
 try{
  let api=injectApi(app);const owner=await ownerFixture(api,'Town'),registration=registrationCommand(),a=await ok(api,'POST','/registrations',registration),agentId=a.agentId as string,handoffToken=credential();
  const handoff=await ok(api,'POST','/agent/self/handoffs',{operationId:randomUUID(),expectedGeneration:0,handoffToken},registration.continuationToken);
  await ok(api,'POST','/owner/agent-claims',{operationId:randomUUID(),agentId,expectedGeneration:handoff.generation,handoffToken},owner.sessionToken);
  const oldCapabilities=await ok(api,'GET','/capabilities');assert(!oldCapabilities.gateway.modules.includes('town_services'));
  await app.close();
  const oldText=String(((await f.legacy.read(tx=>catalogRepository(tx).get('guide:world:2')))!.data.document as any).text)+'\n'+AGENT_WORLD_MAP_V2_GUIDE;
  await publishPerceptionCatalog(f.legacy,{revision:'catalog-map-v2-1',guideVersion:8,guideText:oldText});
  const oldGuides=await f.legacy.read(async tx=>{const rows=[];for(const id of ['perception','world','profiles','items','inventory','mailbox','wallet'])rows.push(await catalogRepository(tx).get('guide:'+id+':8'));return rows;});
  const identityFile=await f.savePrivate('town-identity.json',{version:1,...f.identity}),directory=await realpath(dirname(identityFile)),publicationArgs=['--connection',join(f.privateConnections,'application-database-url'),'--identity',identityFile,'--operator','isolated-town-maintainer','--manifest',join(directory,'publication.json'),'--expected-instance',f.identity.instanceId,'--expected-epoch',f.identity.recoveryEpoch,'--expected-catalog-revision','catalog-map-v2-1','--revision','catalog-npc-services-1','--expected-guide-version','8','--guide-version','9','--operation-id',randomUUID()];
  await f.gate(false);
  await prepareBehaviorSources(join(f.privateConnections,'migration-database-url'),identityFile,f.database,{activate:true,now:f.now});
  await prepareTownServices(join(f.privateConnections,'migration-database-url'),identityFile,f.database,{activate:true,now:f.now});
  await assert.rejects(runNpcServiceReaders(publicationArgs),(error:any)=>error.code==='unavailable','M1 administrative publication obeys the closed gate');
  assert.equal((await f.legacy.read(tx=>catalogRepository(tx).get('current')))!.data.catalogRevision,'catalog-map-v2-1');
  await f.gate(true);const publication=await runNpcServiceReaders(publicationArgs);assert.equal(publication.receipt.newGuideDocuments,7);
  const retryArgs=[...publicationArgs],manifestIndex=retryArgs.indexOf('--manifest')+1;retryArgs[manifestIndex]=join(directory,'publication-retry.json');assert.deepEqual((await runNpcServiceReaders(retryArgs)).receipt,publication.receipt);
  await f.gate(false);
  for(const row of oldGuides)assert.deepEqual(await f.legacy.read(tx=>catalogRepository(tx).get(row!.id)),row,'Old exact guides remain unchanged');
  assert.equal(await f.legacy.read(tx=>tx.count('perception_grants',{kind:'holding'},10)),0,'Publishing definitions creates no voucher or holding');
  app=await buildApp({...f.options,clock:f.now,email:{mode:'experience'},worldCoreEnabled:true,worldCoreInteractionEnabled:true});api=injectApi(app);
  const npcs=await ok(api,'GET','/town/npcs');assert.deepEqual(npcs.data.npcs.map((n:any)=>n.npcId).sort(),['npc-innkeeper','npc-mayor','npc-tavern']);
  assert.equal(npcs.data.catalogVersion,1);assert.equal((await ok(api,'GET','/world/npcs?worldId=default')).data.npcCatalogVersion,1);
  await f.gate(true);
  const capabilities=await ok(api,'GET','/capabilities');assert(capabilities.gateway.modules.includes('town_services'));assert.notEqual(capabilities.gateway.catalogRevision,oldCapabilities.gateway.catalogRevision);assert.equal(capabilities.perceptionApi.catalogRevision,'catalog-npc-services-1');
  const discovery=(await ok(api,'GET','/gateway/discovery')).data;
  for(const op of discovery.operations)if(op.moduleId==='town_services'||op.moduleId==='behavior'||['world.avatar','world.avatar.create','world.avatar.move','world.movement'].includes(op.id)){const exact=(await ok(api,'GET',op.outputSchema.path.slice(3))).data;assert.equal(createHash('sha256').update(exact.canonicalDocument).digest('hex'),exact.digest);validator.post('/'+op.id,{schema:{body:exact.document}},async()=>({valid:true}));}
  for(const moduleId of ['town_services','world','behavior']){const guide=discovery.modules.find((m:any)=>m.moduleId===moduleId).usageGuide,exact=(await ok(api,'GET',guide.path.slice(3))).data;assert.equal(createHash('sha256').update(exact.canonicalDocument).digest('hex'),exact.digest);assert.deepEqual(JSON.parse(exact.canonicalDocument),exact.document);}
  await validator.ready();
  const envelope=(operation:string,input:any,commandId?:string,purpose='agent-manual')=>({protocolVersion:1,consumerId:'isolated-town-http',purpose,operation,input,...(commandId?{commandId}:{})});
  const raw=async(operation:string,input:any,commandId?:string,bearer=registration.runtimeToken)=>api('POST','/gateway/'+(commandId?'commands':'query'),envelope(operation,input,commandId,bearer===owner.sessionToken?'human-inspect':'agent-manual'),bearer);
  const read=async(operation:string,input:any,bearer=registration.runtimeToken)=>{const value=await raw(operation,input,undefined,bearer);assert.equal(value.status,200,operation+': '+value.body.error?.code);assert.equal((await validator.inject({method:'POST',url:'/'+operation,payload:value.body})).statusCode,200,operation+' exact output');return value.body.data;};
  const command=async(operation:string,input:any,commandId=randomUUID())=>{const value=await raw(operation,input,commandId);assert.equal(value.status,200,operation+': '+value.body.error?.code);assert.equal((await validator.inject({method:'POST',url:'/'+operation,payload:value.body})).statusCode,200,operation+' exact receipt');return value.body.data;};
  await command('world.avatar.create',{worldId:'default',expectedRulesetVersion:2});
  const outOfRange=await command('town_services.welcome.claim',{npcId:'npc-mayor',expectedCatalogVersion:1});assert.equal(outOfRange.outcome,'conflict','Knowing the service does not prove arrival');assert.equal(outOfRange.result.code,'service_out_of_range');
  const world=createWorldService(f.access),scheduler=createDeterministicScheduler({store:f.runtime,workerId:'town-http-path',handlers:[{kind:'world.movement.step',version:1,run:world.handleTask}],batchLimit:10});
  const walk=async(target:GridPoint)=>{let avatar=(await read('world.avatar',{worldId:'default'})).avatar;const path=route(rules,avatar.position,target);for(let at=0;at<path.length;at+=64){const segment=path.slice(at,at+64),moved=await command('world.avatar.move',{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:2,expectedTopologyVersion:2,path:segment});assert.equal(moved.outcome,'committed');for(let i=0;i<segment.length;i++){f.tick(1000);await scheduler.runDue();}avatar=(await read('world.avatar',{worldId:'default'})).avatar;assert.deepEqual(avatar.position,segment.at(-1));}assert.deepEqual(avatar.position,target);};
  const mayor=npcs.data.npcs.find((n:any)=>n.npcId==='npc-mayor'),tavern=npcs.data.npcs.find((n:any)=>n.npcId==='npc-tavern');
  await walk(mayor.approachCells[0]);const greet=await command('town_services.npc.greet',{npcId:mayor.npcId,expectedCatalogVersion:1});assert.equal(greet.outcome,'committed');assert.equal(greet.result.relationship.familiarity,0);
  const id=randomUUID(),input={npcId:mayor.npcId,expectedCatalogVersion:1},claim=await command('town_services.welcome.claim',input,id);assert.equal(claim.outcome,'committed');assert.equal(claim.result.items.length,2);assert.deepEqual(await command('town_services.welcome.claim',input,id),claim);
  const state=await read('town_services.progress',{agentId},owner.sessionToken);assert.equal(state.claim.state,'completed');assert.equal((await read('town_services.relationships',{agentId},owner.sessionToken)).relationships[0].familiarity,1);
  assert.equal((await raw('town_services.progress',{agentId:randomUUID()},undefined,owner.sessionToken)).status,404,'Owner observation remains selected and currently bound');
  assert.equal((await raw('town_services.progress',{agentId:randomUUID()})).status,404,'A runtime cannot select another Agent');
  assert.equal((await raw('town_services.welcome.claim',input,randomUUID(),owner.sessionToken)).status,403);
  assert.equal((await api('GET','/town/progress')).status,404);
  const agentRef={moduleId:'profiles',type:'profiles.agent@1',id:agentId},perception={protocolVersion:1,consumerId:'isolated-town-owner',purpose:'human-inspect'};
  const holdings=(await ok(api,'POST','/perception/list',{...perception,channel:'inventory',agentRef,categoryId:'holdings'},owner.sessionToken)).data.records;assert.equal(holdings.length,2);
  for(const held of holdings){assert.equal(held.summary.itemKind,'prop');const detail=(await ok(api,'POST','/perception/detail',{...perception,channel:'inventory',agentRef,ref:held.ref},owner.sessionToken)).data;assert.match(detail.content.text,/当前可用/);const definition=(await ok(api,'POST','/perception/detail',{...perception,channel:'world',ref:held.summary.itemRef},owner.sessionToken)).data;assert.equal(definition.content.source.kind,'town_service_definition');}
  await walk(tavern.approachCells[0]);const voucher=claim.result.items.find((i:any)=>i.itemKind==='tavern_voucher'),used=await command('town_services.tavern.redeem',{npcId:tavern.npcId,expectedCatalogVersion:1,itemInstanceId:voucher.itemInstanceId,expectedItemVersion:voucher.version,topic:'welcome'});assert.equal(used.outcome,'committed');assert.match(used.result.operation.response,/这杯茶/);assert.equal((await read('town_services.inventory',{agentId},owner.sessionToken)).items.find((i:any)=>i.itemInstanceId===voucher.itemInstanceId).state,'consumed');
  const logs=await read('behavior.owner_history',{agentId},owner.sessionToken),tea=logs.items.find((row:any)=>row.title.includes('迎新茶'));assert(tea);assert.equal(tea.source.detail,null);assert.equal(tea.details.service.response,used.result.operation.response);assert(!logs.historyCoverage.gaps.some((text:string)=>text.includes('不纳入用户日志')));
  const publicLogs=(await ok(api,'GET','/world/logs')).data;const publicTea=publicLogs.items.find((row:any)=>row.title.includes('迎新茶'));assert(publicTea);assert.equal(publicTea.details.service.response,null);assert.equal(publicTea.details.service.choice,null);
  const policy=await ok(api,'PUT',`/owner/agents/${agentId}/world-action-policy`,{operationId:randomUUID(),expectedVersion:0,mode:'observe'},owner.sessionToken);assert.equal(policy.mode,'observe');
  const denied=await raw('town_services.npc.greet',{npcId:tavern.npcId,expectedCatalogVersion:1},randomUUID());assert.equal(denied.status,200);assert.equal(denied.body.data.outcome,'rejected');assert.equal(denied.body.data.result.code,'world_action_observe_only');assert.equal((await read('town_services.progress',{})).claim.state,'completed','Observe mode retains source reads');
 }finally{await app.close();await validator.close();await f.dispose();console.info(JSON.stringify({resource:'isolated_town_http',database:f.database,closed:true,dropped:true,listenerCreated:false}));}
});
