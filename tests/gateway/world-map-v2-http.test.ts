import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import Fastify from 'fastify';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {worldGatewayGuide,worldGatewayOperations,worldPublicReads} from '../../apps/platform/application/agent-gateway-world.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerWorldObservationRoutes} from '../../apps/platform/transport/http/agent-gateway-world-routes.ts';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {townV2Rules,TOWN_V2_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-v2.ts';
import type {GridPoint} from '../../apps/platform/domains/world/types.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';

const key=(p:GridPoint)=>p.x+','+p.y;
/** Test-host planner only: production accepts explicit paths and supplies no automatic navigation. */
function route(rules:ReturnType<typeof townV2Rules>,from:GridPoint,to:GridPoint){
 const forbidden=new Set([...rules.blocked,...rules.unopened!].map(key)),previous=new Map<string,GridPoint|null>([[key(from),null]]),queue=[from],bounds=rules.bounds!;
 for(let at=0;at<queue.length&&!previous.has(key(to));at++){const p=queue[at]!;for(const next of [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}])if(next.x>=bounds.minX&&next.x<=bounds.maxX&&next.y>=bounds.minY&&next.y<=bounds.maxY&&!forbidden.has(key(next))&&!previous.has(key(next))){previous.set(key(next),p);queue.push(next);}}
 assert(previous.has(key(to)));const path:GridPoint[]=[];let cursor=to;while(key(cursor)!==key(from)){path.unshift(cursor);cursor=previous.get(key(cursor))!;}return path;
}

test('the same pre-map runtime discovers signed schemas, traverses stairs/bridge in bounded segments, and reads separate readonly NPCs',async()=>{
 const f=coreFixture(),principal=f.addAgent('legacy-map-agent'),identity={...f.identity,async authenticate(_ctx:unknown,bearer:unknown,kinds:readonly string[]){if(bearer!=='existing-map-runtime'||!kinds.includes('runtime'))fail('authentication_failed',401,'Invalid synthetic credential');return principal;}};
 const service=createWorldService(identity);await f.store.transaction(bootstrapWorld);
 const gateway=createAgentGateway({store:f.store,identity,operations:worldGatewayOperations(service),publicReads:worldPublicReads(service),guides:[worldGatewayGuide]}),app=Fastify(),validator=Fastify({bodyLimit:1024*1024});
 registerWorldObservationRoutes(gateway,registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now}));registerSiteRoutes(app);
 for(const op of gateway.discovery().operations)validator.post('/'+op.id,{schema:{body:gateway.schema(op.outputSchema.id,String(op.outputSchema.version)).document}},async()=>({ok:true}));
 async function call(operation:string,input:JsonObject,command=false){const response=await app.inject({method:'POST',url:'/v1/gateway/'+(command?'commands':'query'),headers:{authorization:'Bearer existing-map-runtime'},payload:{protocolVersion:1,consumerId:'map-v2-http',purpose:'agent-manual',operation,input,...(command?{commandId:randomUUID()}:{})}});if(response.statusCode===200)assert.equal((await validator.inject({method:'POST',url:'/'+operation,payload:response.json()})).statusCode,200,operation+' exact output schema');return {status:response.statusCode,data:response.json().data};}
 async function publicRead(path:string,operation:string){const response=await app.inject({method:'GET',url:path+'?worldId=default'});assert.equal(response.statusCode,200);assert.equal((await validator.inject({method:'POST',url:'/'+operation,payload:response.json()})).statusCode,200,operation+' exact output schema');return response.json().data;}
 try{
  assert.equal((await publicRead('/v1/world/map-manifest','world.public_map_manifest')).manifest,null);assert.deepEqual((await publicRead('/v1/world/npcs','world.public_npcs')).npcs,[]);
  const created=await call('world.avatar.create',{worldId:'default',expectedRulesetVersion:1},true);assert.equal(created.data.outcome,'committed');const initial=(await call('world.avatar',{worldId:'default'})).data.avatar;
  const bytes=readFileSync(new URL('../../apps/web/public/world-map-v2.json',import.meta.url)),rules=townV2Rules(JSON.parse(bytes.toString()),createHash('sha256').update(bytes).digest('hex'));
  await f.store.transaction(async()=>{const world=(await f.world.getWorld('default'))!;await f.world.activateRuleset(rules,world.revision);});
  const unchanged=(await call('world.avatar',{worldId:'default'})).data.avatar;assert.equal(unchanged.id,initial.id);assert.equal(unchanged.version,initial.version);assert.deepEqual(unchanged.position,initial.position);assert.equal(unchanged.rulesetVersion,1,'Activation preserves the old Avatar record until a real new step');
  const discovery=(await app.inject({method:'GET',url:'/v1/gateway/discovery'})).json().data;for(const id of ['world.map_manifest','world.npcs','world.public_map_manifest','world.public_npcs'])assert(discovery.operations.some((op:any)=>op.id===id));assert.equal(discovery.operations.find((op:any)=>op.id==='world.avatar.move').inputSchema.version,2);assert.equal(discovery.operations.find((op:any)=>op.id==='world.scene').outputSchema.version,3);
  for(const id of ['world.avatar.move.input','world.public_rules.output']){const response=await app.inject({method:'GET',url:`/v1/gateway/schemas/${id}?version=2`});const data=response.json().data;assert.equal(createHash('sha256').update(data.canonicalDocument).digest('hex'),data.digest);}assert.equal((await app.inject({method:'GET',url:'/v1/gateway/schemas/world.avatar.move.input?version=1'})).statusCode,404,'The changed point/path schema is never relabeled as old exact v1');
  const current=(await call('world.rules',{worldId:'default'})).data.rules,map=(await call('world.map_manifest',{worldId:'default'})).data.manifest;assert.deepEqual(current.bounds,{minX:-28,minY:-28,maxX:59,maxY:35});assert.equal(current.blocked.length,1622);assert.equal(current.unopened.length,2860);assert.deepEqual(map.counts,{walkable:1150,physicalBlocked:1622,unopened:2860});assert.equal(map.geometryDigest,'b2c52a8a77dcf352670d5fb95a755d442c5a424c27d4762b921e0ce817d4f772');
  const raw=await app.inject({method:'GET',url:map.layoutUrl});assert.equal(raw.statusCode,200);assert.equal(createHash('sha256').update(raw.rawPayload).digest('hex'),TOWN_V2_LAYOUT_SHA256);assert.equal(map.layoutSha256,TOWN_V2_LAYOUT_SHA256);assert.equal((await publicRead('/v1/world/map-manifest','world.public_map_manifest')).manifest.geometryDigest,map.geometryDigest);
  const npcs=(await call('world.npcs',{worldId:'default'})).data.npcs;assert.equal(npcs.length,3);assert(npcs.every((npc:any)=>npc.serverManaged&&npc.readOnly&&!npc.countsAsAgent&&npc.actions.length===0&&npc.status==='service_unavailable'));const scene=await publicRead('/v1/world/scene','world.public_scene');assert.equal(scene.avatars.length,1);assert.equal(scene.npcs.length,3);assert.equal(f.state.participants.size,1);
  const first=route(rules,unchanged.position,{x:-7,y:-14}),path=[...first,...route(rules,{x:-7,y:-14},{x:42,y:0})];assert(path.length>64);assert(path.some(p=>p.x===-7&&p.y===-12));assert(path.some(p=>p.x===35&&p.y===0));
  assert.equal((await call('world.avatar.move',{worldId:'default',expectedVersion:unchanged.version,expectedRulesetVersion:2,expectedTopologyVersion:2,path:path.slice(0,65).map(p=>({...p}))},true)).status,400);
  for(let offset=0;offset<path.length;offset+=64){const actual=(await call('world.avatar',{worldId:'default'})).data.avatar,live=(await call('world.rules',{worldId:'default'})).data.rules,segment=path.slice(offset,offset+64),receipt=await call('world.avatar.move',{worldId:'default',expectedVersion:actual.version,expectedRulesetVersion:live.version,expectedTopologyVersion:live.topologyVersion,path:segment.map(p=>({...p}))},true);assert.equal(receipt.data.outcome,'committed');assert.equal(receipt.data.result.state,'pending');assert.deepEqual((await call('world.avatar',{worldId:'default'})).data.avatar.position,actual.position);
   for(let step=0;step<segment.length;step++){const pending=[...f.state.tasks.values()].filter(t=>t.kind==='world.movement.step'&&t.state==='pending').sort((a,b)=>a.dueAt-b.dueAt)[0]!;assert(pending);f.now=pending.dueAt;const task=(await f.context.tasks.claimDue({now:f.now,workerId:'map-http-core',leaseMs:30000,limit:1,kinds:['world.movement.step']}))[0]!;await f.store.transaction(async ctx=>{await service.handleTask(ctx,task);await ctx.tasks.complete(task.lease!,ctx.now());});}
   assert.equal((await call('world.movement',{worldId:'default',movementId:receipt.data.result.movementId})).data.state,'completed');assert.deepEqual((await call('world.avatar',{worldId:'default'})).data.avatar.position,segment.at(-1));
  }
  const final=(await call('world.avatar',{worldId:'default'})).data.avatar;assert.deepEqual(final.position,{x:42,y:0});assert.equal(final.motion.status,'committed');assert.equal(final.motion.arriveAt-final.motion.startedAt,1000);assert.deepEqual(final.motion.to,final.position);f.now+=10;assert.deepEqual((await publicRead('/v1/world/scene','world.public_scene')).avatars[0].motion,final.motion,'Repeated HTTP does not reset the submitted edge time or ID');
  const denied=await call('world.avatar.move',{worldId:'default',expectedVersion:final.version,expectedRulesetVersion:2,expectedTopologyVersion:2,path:[{x:42,y:-1}]},true);assert.equal(denied.data.outcome,'conflict');assert.equal(denied.data.result.code,'cell_unopened');assert.deepEqual((await call('world.avatar',{worldId:'default'})).data.avatar.position,final.position);
 }finally{await app.close();await validator.close();}
});
