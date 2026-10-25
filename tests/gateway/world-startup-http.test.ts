import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import Fastify from 'fastify';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {createAgentGateway,type GatewayPublicRead} from '../../apps/platform/application/agent-gateway.ts';
import {worldGatewayGuide,worldGatewayOperations,worldPublicReads} from '../../apps/platform/application/agent-gateway-world.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerWorldObservationRoutes} from '../../apps/platform/transport/http/agent-gateway-world-routes.ts';
import {townV2Rules,TOWN_V2_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-v2.ts';
import type {RuntimeReadContext,RuntimeStore} from '../../apps/platform/contracts/runtime-store.ts';

async function fixture(input:{mutate?:(read:GatewayPublicRead)=>GatewayPublicRead;httpInstanceId?:string}={}){
 const f=coreFixture();let reads=0,authentications=0;const contexts:RuntimeReadContext[]=[];
 const identity={...f.identity,async authenticate(){authentications++;throw new Error('Startup must never authenticate a private actor');}};
 const service=createWorldService(identity),rules=townV2Rules(JSON.parse(readFileSync(new URL('../../apps/web/public/world-map-v2.json',import.meta.url),'utf8')),TOWN_V2_LAYOUT_SHA256);await f.store.transaction(ctx=>bootstrapWorld(ctx,rules));
 for(const id of ['visible-a','visible-b','withdrawn']){const principal=f.addAgent(id);const receipt=await f.store.transaction(ctx=>service.execute(ctx,principal,f.key(principal,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:rules.version}));assert.equal(receipt.outcome,'committed',JSON.stringify(receipt.result));}
 f.state.publicAgents.delete('withdrawn');
 const store:RuntimeStore={...f.store,async read(work){reads++;return f.store.read(work);}};
 const publicReads=worldPublicReads(service).map(read=>({...read,read:async(ctx:RuntimeReadContext,payload:Parameters<GatewayPublicRead['read']>[1])=>{contexts.push(ctx);return read.read(ctx,payload);}})).map(read=>input.mutate?.(read)??read);
 const gateway=createAgentGateway({store,identity,operations:worldGatewayOperations(service),publicReads,guides:[worldGatewayGuide]}),app=Fastify({logger:false});
 registerWorldObservationRoutes(gateway,registerAgentGatewayRoutes(app,gateway,{instanceId:input.httpInstanceId??f.context.instanceId,now:()=>f.now}));
 return{f,app,gateway,contexts,get reads(){return reads;},get authentications(){return authentications;}};
}
const url='/v1/world/startup?version=1&worldId=default&limit=1';

test('anonymous startup reuses exact public readers in one scope, preserves filtering and continues through the old scene endpoint',async()=>{
 const x=await fixture();try{
  const before=structuredClone(x.f.state),response=await x.app.inject(url);assert.equal(response.statusCode,200,response.body);const body=response.json(),d=body.data;
  assert.equal(x.reads,1);assert.equal(x.contexts.length,2);assert.equal(x.contexts[0],x.contexts[1]);assert.equal(x.authentications,0);assert.deepEqual(x.f.state,before,'No domain, event, task, receipt or outbox write');
  assert.equal(body.instanceId,d.instanceId);assert.equal(body.instanceId,x.f.context.instanceId);assert.equal(d.startupVersion,1);assert.equal(d.publicOnly,true);assert.equal(d.gatewayCatalogRevision,x.gateway.catalogRevision);assert.equal(d.rulesetVersion,d.rules.rules.version);assert.equal(d.topologyVersion,d.rules.rules.topologyVersion);assert.equal(d.worldRevision,d.scene.worldRevision);assert.equal(d.worldRevision,d.rules.world.revision);assert.equal(d.scene.avatars.length,1);assert.equal(d.scene.avatars[0].agentId,'visible-a');assert.equal(d.scene.complete,false);assert.equal(typeof d.scene.nextCursor,'string');
  const rules=await x.app.inject('/v1/world/rules?worldId=default');assert.deepEqual(d.rules,rules.json().data);
  const next=await x.app.inject('/v1/world/scene?'+new URLSearchParams({worldId:'default',limit:'1',cursor:d.scene.nextCursor}));assert.equal(next.statusCode,200);assert.deepEqual(next.json().data.avatars.map((a:any)=>a.agentId),['visible-b']);
  assert(!JSON.stringify(d).includes('withdrawn'));assert(!JSON.stringify(d).includes('recoveryEpoch'));assert(!JSON.stringify(d).includes('runtimeToken'));assert(!JSON.stringify(d).includes('"path":'));
  x.f.state.publicAgents.delete('visible-a');const refreshed=await x.app.inject(url);assert.equal(refreshed.statusCode,200);assert.equal(refreshed.json().data.scene.avatars[0].agentId,'visible-b','The next request reads current visibility, never the previous startup snapshot');
 }finally{await x.app.close();}
});

test('startup is bounded and anonymous only; private operations cannot enter the internal public bundle',async()=>{
 const x=await fixture();try{
  for(const headers of [{authorization:'Bearer synthetic-header-only'},{cookie:'synthetic=header-only'}]){const denied=await x.app.inject({url,headers});assert.equal(denied.statusCode,400);assert.equal(denied.json().error.code,'anonymous_startup_only');assert.equal(denied.headers['cache-control'],'no-store');}
  assert.equal(x.reads,0);assert.equal(x.authentications,0);
  for(const query of ['worldId=default','version=2&worldId=default','version=1&worldId=default&limit=0','version=1&worldId=default&limit=101','version=1&worldId=default&limit=1x','version=1&worldId=default&cursor=not-a-first-page','version=1&worldId=default&agentId=private-target']){const r=await x.app.inject('/v1/world/startup?'+query);assert.equal(r.statusCode,400,query);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.json().data,undefined);}
  assert.equal(x.reads,0);
  await assert.rejects(x.gateway.publicReadBundle([{id:'world.avatar',input:{worldId:'default'}}],()=>true),(e:any)=>e.code==='capability_not_available');
  await assert.rejects(x.gateway.publicReadBundle(Array(5).fill({id:'world.public_rules',input:{worldId:'default'}}),()=>true),(e:any)=>e.code==='invalid_request');
  assert.equal(x.reads,0);
  const absent=await x.app.inject('/v1/gateway/public-bundle');assert.equal(absent.statusCode,404);
 }finally{await x.app.close();}
});

test('a mismatched revision, rules or HTTP instance fails the entire startup instead of publishing half a view',async()=>{
 for(const mismatch of ['scene','rules','instance']){
  const x=await fixture({...(mismatch==='instance'?{httpInstanceId:'synthetic-other-instance'}:{}),mutate:read=>({...read,read:async(ctx,input)=>{const result=await read.read(ctx,input);if(mismatch==='scene'&&read.id==='world.public_scene')return{...result,worldRevision:Number(result.worldRevision)+1};if(mismatch==='rules'&&read.id==='world.public_rules')return{...result,world:{...(result.world as object),rulesetVersion:999}};return result;}})});
  try{const r=await x.app.inject(url);assert.equal(r.statusCode,503,mismatch);assert.equal(r.json().error.code,'world_startup_inconsistent');assert.equal(r.json().data,undefined);assert.equal(r.headers['cache-control'],'no-store');assert.equal(x.reads,1);}finally{await x.app.close();}
 }
});

test('same-response timing reports only measured handler/public-read elapsed time and pairs with its request ID',async()=>{
 const x=await fixture({mutate:read=>({...read,read:async(ctx,input)=>{if(read.id==='world.public_rules')await new Promise(resolve=>setTimeout(resolve,5));return read.read(ctx,input);}})});
 try{const r=await x.app.inject({url,headers:{'x-request-id':'synthetic-untrusted-request','server-timing':'not-a-server-measurement'}});assert.equal(r.statusCode,200);assert.equal(r.headers['x-request-id'],r.json().requestId);assert.notEqual(r.headers['x-request-id'],'synthetic-untrusted-request');assert.equal(r.headers['cache-control'],'no-store');
  const timing=String(r.headers['server-timing']);assert.match(timing,/^app;dur=\d+\.\d{2};desc="Gateway handler", public_read;dur=\d+\.\d{2};desc="Public read including store"$/);assert(!timing.includes('not-a-server-measurement'));const values=[...timing.matchAll(/dur=([0-9.]+)/g)].map(m=>Number(m[1]));assert(values[0]!>=values[1]!-0.02);assert(values[1]!>=4);
  const error=await x.app.inject('/v1/world/startup?version=2&worldId=default');assert.equal(error.statusCode,400);assert.equal(error.headers['x-request-id'],error.json().requestId);assert.match(String(error.headers['server-timing']),/^app;dur=/);assert(!String(error.headers['server-timing']).includes('public_read'));
 }finally{await x.app.close();}
});
