import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import Fastify from 'fastify';
import type {AgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import type {M1Service} from '../../apps/platform/application/m1-service.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerWorldObservationRoutes} from '../../apps/platform/transport/http/agent-gateway-world-routes.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {registerPerceptionRoutes} from '../../apps/platform/transport/http/perception-routes.ts';

async function fixture(t:TestContext,write?:(line:string)=>void|Promise<void>){
 let now=1_790_000_000_000;const lines:string[]=[];
 t.mock.method(Date,'now',()=>now);
 const app=Fastify({logger:false}),gateway={discovery:()=>({}),schema:()=>({}),guide:()=>({}),publicRead:async()=>({}),query:async()=>({}),command:async()=>({}),receipt:async()=>({})} as unknown as AgentGateway;
 registerWorldObservationRoutes(gateway,registerAgentGatewayRoutes(app,gateway,{instanceId:'isolated_observation',now:()=>now},{write:write??(line=>{lines.push(line);})}));
 const service={invokeHttp:async()=>({})} as unknown as M1Service;registerM1Routes(app,service);registerPerceptionRoutes(app,service);
 t.after(async()=>{await app.close();});
 return {app,lines,advance(ms:number){now+=ms;},get now(){return now;},request:(url='/v1/world/scene?worldId=default',remoteAddress='192.0.2.10',headers:Record<string,string|string[]>={})=>app.inject({method:'GET',url,remoteAddress,headers}),records:()=>lines.map(line=>JSON.parse(line))};
}
async function fill(f:Awaited<ReturnType<typeof fixture>>,n=240){for(let i=0;i<n;i++)assert.equal((await f.request()).statusCode,200);}
const BUILD='world-provider-20261022-v1';
const hintHeaders=(reason:string,build:string=BUILD)=>({'X-World-Read-Build':build,'X-World-Read-Reason':reason});

await test('only finite self-reported World hints enter cumulative diagnostics; missing, invalid, long and multiple values become unknown',async t=>{
 const f=await fixture(t);await fill(f,232);
 const long='PRIVATE_OVERSIZED_HEADER_'+ 'x'.repeat(1_024);
 for(const [url,headers]of [
  ['/v1/world/scene?worldId=default',hintHeaders('start')],
  ['/v1/world/rules?worldId=default',hintHeaders('visible')],
  ['/v1/world/scene?worldId=default',hintHeaders('PRIVATE_ARBITRARY_REASON')],
  ['/v1/world/rules?worldId=default',hintHeaders('timer','PRIVATE_ARBITRARY_BUILD')],
  ['/v1/world/scene?worldId=default',{'X-World-Read-Build':[BUILD,'PRIVATE_EXTRA_BUILD'],'X-World-Read-Reason':'manual'}],
  ['/v1/world/scene?worldId=default',{'X-World-Read-Build':BUILD,'X-World-Read-Reason':['manual','timer']}],
  ['/v1/world/rules?worldId=default',hintHeaders(long,long)],
  ['/v1/gateway/discovery',hintHeaders('manual')],
 ] as const)assert.equal((await f.request(url,undefined,headers as Record<string,string|string[]>)).statusCode,200);
 assert.equal(f.lines.length,0);
 const denied=await f.request(undefined,undefined,hintHeaders('recovery'));assert.equal(denied.statusCode,429);assert.equal(denied.headers['retry-after'],'60');assert.deepEqual(Object.keys(denied.json().error).sort(),['code','message']);
 const record=f.records()[0],hints=record.quota.worldReadHints;
 assert(Array.isArray(hints));assert.equal(record.quota.allowed,240);assert.equal(record.quota.rejected,1);assert.equal(hints.reduce((sum:number,row:any)=>sum+row.allowed,0),239);assert.equal(hints.reduce((sum:number,row:any)=>sum+row.rejected,0),1);
 const count=(route:string,build:string,reason:string)=>hints.find((row:any)=>row.route===route&&row.build===build&&row.reason===reason);
 assert.deepEqual(count('/v1/world/scene','unknown','unknown'),{route:'/v1/world/scene',build:'unknown',reason:'unknown',allowed:232,rejected:0});
 assert.equal(count('/v1/world/scene',BUILD,'unknown').allowed,2);assert.equal(count('/v1/world/scene','unknown','manual').allowed,1);assert.equal(count('/v1/world/rules','unknown','unknown').allowed,1);assert.equal(count('/v1/world/rules','unknown','timer').allowed,1);
 assert.equal(count('/v1/world/scene',BUILD,'recovery').rejected,1);
 assert(hints.every((row:any)=>['/v1/world/rules','/v1/world/scene'].includes(row.route)&&[BUILD,'unknown'].includes(row.build)&&['start','timer','manual','visible','recovery','unknown'].includes(row.reason)));
 assert.doesNotMatch(f.lines.join(''),/PRIVATE_|X-World-Read|192\.0\.2\.|authorization|Bearer|requestId|params|body|stack/iu);
});

await test('all 24 hint buckets share the original quota and reset with its fixed window without extra reports',async t=>{
 const f=await fixture(t),start=f.now,reasons=['start','timer','manual','visible','recovery','unknown'];
 for(const route of ['/v1/world/rules','/v1/world/scene'])for(const build of [BUILD,'unknown'])for(const reason of reasons)assert.equal((await f.request(route+'?worldId=default',undefined,hintHeaders(reason,build))).statusCode,200);
 await fill(f,216);
 assert.equal((await f.request(undefined,undefined,hintHeaders('timer'))).statusCode,429);assert.equal(f.lines.length,1);assert.equal(f.records()[0].quota.worldReadHints.length,24);
 for(const reason of reasons)assert.equal((await f.request(undefined,undefined,hintHeaders(reason,'PRIVATE_NOT_A_BUILD'))).statusCode,429);
 assert.equal(f.lines.length,1);f.advance(10_000);assert.equal((await f.request('/v1/world/rules?worldId=default',undefined,hintHeaders('manual'))).statusCode,429);assert.equal(f.lines.length,2);
 const snapshot=f.records()[1];assert.equal(snapshot.quota.allowed,240);assert.equal(snapshot.quota.rejected,8);assert.equal(snapshot.quota.worldReadHints.length,24);assert.equal(snapshot.quota.worldReadHints.reduce((sum:number,row:any)=>sum+row.allowed+row.rejected,0),248);assert.equal(snapshot.quota.windowStartedAt,start);assert.equal(snapshot.quota.windowEndsAt,start+60_000);assert.equal(snapshot.quota.retryAfterSeconds,50);
 f.advance(50_000);await fill(f);assert.equal((await f.request()).statusCode,429);assert.equal(f.lines.length,3);const next=f.records()[2];assert.equal(next.quota.windowStartedAt,start+60_000);assert.deepEqual(next.quota.worldReadHints,[{route:'/v1/world/scene',build:'unknown',reason:'unknown',allowed:240,rejected:1}]);assert.doesNotMatch(f.lines.join(''),/PRIVATE_NOT_A_BUILD/);
});

await test('429 snapshots count every registered Gateway route attempt and contain only templates and anonymous route classes',async t=>{
 const f=await fixture(t);await fill(f,228);
 for(const [url,n]of [['/v1/world/rules?worldId=private-world-value',3],['/v1/gateway/discovery',2],['/v1/gateway/schemas/private-schema-value?version=9',3],['/v1/gateway/guides/private-module-value?version=9',1]] as const)for(let i=0;i<n;i++)assert.equal((await f.request(url)).statusCode,200);
 for(const url of ['/v1/gateway/query','/v1/gateway/commands','/v1/gateway/receipts/query'])assert.equal((await f.app.inject({method:'POST',url,remoteAddress:'192.0.2.10',headers:{authorization:'Bearer private-credential-value'},payload:{private:'private-body-value'}})).statusCode,200);
 assert.equal(f.lines.length,0,'Only quota refusals create diagnostic output');
 const denied=await f.request('/v1/world/scene?worldId=private-denied-query-value');assert.equal(denied.statusCode,429);
 const record=f.records()[0];assert.deepEqual(Object.keys(record).sort(),['event','method','quota','requestClass','route','snapshotKind','status','time']);
 assert.deepEqual({...record,quota:undefined},{event:'gateway_quota_rejected',snapshotKind:'cumulative',time:new Date(f.now).toISOString(),method:'GET',route:'/v1/world/scene',requestClass:'public_read',status:429,quota:undefined});
 assert.equal(record.quota.reason,'window_limit');assert.equal(record.quota.attempts,241);assert.equal(record.quota.allowed,240);assert.equal(record.quota.rejected,1);assert.equal(record.quota.retryAfterSeconds,60);
 assert.equal(record.quota.routes.reduce((sum:number,row:{allowed:number;rejected:number})=>sum+row.allowed+row.rejected,0),241);
 assert.deepEqual(record.quota.routes.find((row:{route:string})=>row.route==='/v1/gateway/schemas/:schemaId'),{method:'GET',route:'/v1/gateway/schemas/:schemaId',requestClass:'public_read',allowed:3,rejected:0});
 assert.equal(record.quota.routes.filter((row:{requestClass:string})=>row.requestClass==='gateway_operation').length,3);
 assert.doesNotMatch(f.lines.join(''),/private-|192\.0\.2\.10|requestId|authorization|Bearer|params|body|stack/iu);
 assert.equal(denied.headers['retry-after'],'60');assert.deepEqual(Object.keys(denied.json().error).sort(),['code','message']);
});

await test('repeated rejection is cumulative, bounded to ten-second reports and never extends the original quota window',async t=>{
 const f=await fixture(t),start=f.now;await fill(f);
 for(let i=0;i<20;i++)assert.equal((await f.request()).statusCode,429);
 assert.equal(f.lines.length,1);assert.equal(f.records()[0].quota.rejected,1);
 f.advance(9_999);assert.equal((await f.request()).headers['retry-after'],'51');assert.equal(f.lines.length,1);
 f.advance(1);assert.equal((await f.request()).headers['retry-after'],'50');assert.equal(f.lines.length,2);
 const second=f.records()[1];assert.equal(second.quota.rejected,22);assert.equal(second.quota.attempts,262);assert.equal(second.quota.windowStartedAt,start);assert.equal(second.quota.windowEndsAt,start+60_000);
 for(let i=0;i<4;i++){f.advance(10_000);assert.equal((await f.request()).statusCode,429);}
 f.advance(9_999);assert.equal((await f.request()).headers['retry-after'],'1');assert.equal(f.lines.length,6,'At most six snapshots within one quota window');
 f.advance(1);assert.equal((await f.request()).statusCode,200);
 await fill(f,239);assert.equal((await f.request()).statusCode,429);assert.equal(f.lines.length,7);
 const next=f.records()[6];assert.equal(next.quota.windowStartedAt,start+60_000);assert.equal(next.quota.allowed,240);assert.equal(next.quota.rejected,1);
});

await test('Gateway IP buckets remain independent, and capabilities and Perception retain their separate quota maps',async t=>{
 const f=await fixture(t);await fill(f);assert.equal((await f.request()).statusCode,429);
 assert.equal((await f.request(undefined,'192.0.2.11')).statusCode,200);
 assert.equal((await f.request('/v1/capabilities')).statusCode,200);assert.equal((await f.request('/v1/perception/discovery')).statusCode,200);
 assert.equal(f.lines.length,1,'Other transports are not silently added to Gateway observation or accounting');
 const response=await f.app.inject({method:'POST',url:'/v1/gateway/commands',remoteAddress:'192.0.2.11',payload:{}});assert.equal(response.statusCode,401);assert.equal(response.json().error.code,'authentication_failed');
});

await test('map-capacity observations distinguish unknown window deadlines and limit reporting without losing attempt counts',async t=>{
 const f=await fixture(t);
 for(let n=0;n<10_000;n++)assert.equal((await f.request('/v1/gateway/discovery',`10.${(n>>>16)&255}.${(n>>>8)&255}.${n&255}`)).statusCode,200);
 for(let n=0;n<30;n++){const response=await f.request('/v1/gateway/schemas/private-capacity-value?version=2','192.0.2.99');assert.equal(response.statusCode,429);assert.equal(response.headers['retry-after'],'60');}
 assert.equal(f.lines.length,1);const first=f.records()[0];assert.equal(first.quota.reason,'map_capacity');assert.equal(first.quota.windowStartedAt,null);assert.equal(first.quota.windowEndsAt,null);assert.equal(first.quota.trackedWindows,10_000);assert.equal(first.quota.allowed,0);assert.equal(first.quota.rejected,1);
 assert.deepEqual(first.quota.worldReadHints,[]);
 f.advance(10_000);assert.equal((await f.request('/v1/world/scene?worldId=default','192.0.2.100',hintHeaders('recovery'))).statusCode,429);assert.equal(f.lines.length,2);assert.equal(f.records()[1].quota.rejected,31);
 assert.deepEqual(f.records()[1].quota.worldReadHints,[{route:'/v1/world/scene',build:BUILD,reason:'recovery',allowed:0,rejected:1}]);
 assert.doesNotMatch(f.lines.join(''),/192\.0\.2\.|10\.0\.|private-capacity-value/);
 assert.equal((await f.request('/v1/gateway/discovery','10.0.0.1')).statusCode,200);
 f.advance(50_000);assert.equal((await f.request('/v1/gateway/discovery','192.0.2.99')).statusCode,200);assert.equal(f.lines.length,2);
});

await test('a throwing diagnostic sink cannot alter HTTP quota, retry delay, authentication or reset behavior',async t=>{
 let calls=0;const f=await fixture(t,()=>{calls++;throw new Error('private-sink-error-material');});await fill(f);
 const denied=await f.request();assert.equal(denied.statusCode,429);assert.equal(denied.headers['retry-after'],'60');assert.equal(denied.json().error.code,'rate_limited');assert.doesNotMatch(denied.body,/private-sink/);assert.equal(calls,1);
 assert.equal((await f.request()).statusCode,429);assert.equal(calls,1);
 f.advance(60_000);assert.equal((await f.request()).statusCode,200);
 const response=await f.app.inject({method:'POST',url:'/v1/gateway/commands',remoteAddress:'192.0.2.10',payload:{}});assert.equal(response.statusCode,401);assert.equal(response.json().error.code,'authentication_failed');
});

await test('quota admission includes rejected authentication, and asynchronous sink rejection is isolated',async t=>{
 let calls=0;let diagnostic:any;const f=await fixture(t,async line=>{diagnostic=JSON.parse(line);calls++;throw new Error('private-async-sink-error');});await fill(f,239);
 const unauthorized=await f.app.inject({method:'POST',url:'/v1/gateway/commands',remoteAddress:'192.0.2.10',payload:{}});assert.equal(unauthorized.statusCode,401);
 const response=await f.request();assert.equal(response.statusCode,429);assert.equal(response.headers['retry-after'],'60');assert.equal(calls,1);
 assert.equal(diagnostic.quota.allowed,240);assert.deepEqual(diagnostic.quota.routes.find((row:{route:string})=>row.route==='/v1/gateway/commands'),{method:'POST',route:'/v1/gateway/commands',requestClass:'gateway_operation',allowed:1,rejected:0});
 await new Promise<void>(resolve=>setImmediate(resolve));
 f.advance(60_000);assert.equal((await f.request()).statusCode,200);
});
