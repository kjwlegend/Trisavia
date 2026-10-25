import assert from 'node:assert/strict';import test from 'node:test';import {readFile,writeFile,mkdir} from 'node:fs/promises';import Fastify from 'fastify';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
// @ts-expect-error Browser module.
import {createWorldSceneProvider} from '../../apps/web/public/hud/world-scene-provider.js';
// @ts-expect-error Browser module.
import {api,isUnknown} from '../../apps/web/public/common.js';
// @ts-expect-error Browser status projection.
import {sceneStatus} from '../../apps/web/public/hud/world-status.js';
const f=JSON.parse(await readFile(new URL('./fixtures/world-core-read-reasons.json',import.meta.url),'utf8'));
const flush=async()=>{for(let i=0;i<4;i++)await new Promise<void>(done=>setImmediate(done));};
function clock(){let at=Date.parse('2026-10-26T00:40:00+08:00'),id=0;const pending=new Map<number,{at:number;fn:()=>void}>();return{now:()=>at,pending,setTimer(fn:()=>void,ms:number){pending.set(++id,{at:at+ms,fn});return id;},clearTimer(key:number){pending.delete(key);},async advance(to:number){for(let n=0;n<12000;n++){const first=[...pending].sort((a,b)=>a[1].at-b[1].at)[0];if(!first||first[1].at>to)break;at=first[1].at;pending.delete(first[0]);first[1].fn();await flush();if(n===11999)throw Error('Clock budget exceeded');}at=to;await flush();}};}
test('one/five public readers recover within the unchanged IP budget, retain slower cadence for two complete windows and bound excess load',async t=>{
 const originalDate=Date.now,originalFetch=globalThis.fetch,results:any[]=[];
 for(const n of [1,5,20]){
  const timer=clock(),start=timer.now(),calls:any[]=[],denials:any[]=[],cadences:any[]=[],observations:any[]=[],app=Fastify({logger:false});Date.now=timer.now;
  const http=registerAgentGatewayRoutes(app,{} as any,{instanceId:f.rules.instanceId,now:timer.now},{write:line=>{observations.push(JSON.parse(line));}}),pause=()=>new Promise<void>(done=>timer.setTimer(done,60)),rules=()=>({...structuredClone(f.rules.data),asOf:timer.now()}),scene=()=>({...structuredClone(f.scene.data),asOf:timer.now()});
  http.route('GET','/v1/world/rules',async()=>{await pause();return rules();});http.route('GET','/v1/world/scene',async()=>{await pause();return scene();});
  http.route('GET','/v1/world/startup',async()=>{await pause();return{startupVersion:1,publicOnly:true,instanceId:f.rules.instanceId,worldId:'default',gatewayCatalogRevision:'gateway-'+'a'.repeat(24),rulesetVersion:1,topologyVersion:1,worldRevision:29,asOf:timer.now(),rules:rules(),scene:scene()};});app.get('/v1/capabilities',()=>structuredClone(f.capabilities));
  globalThis.fetch=async(url,options={})=>{assert.equal(options.credentials,'omit');assert.equal(options.method,'GET');const response=await app.inject({method:'GET',url:String(url),headers:Object.fromEntries(new Headers(options.headers))});return new Response(response.body,{status:response.statusCode,headers:response.headers as any});};
  const providers=Array.from({length:n},(_,reader)=>createWorldSceneProvider({...timer,random:()=>((reader*7)%10)/10,canReadStartup:()=>true,request:async(path:string,options:any)=>{const call:any={reader,at:timer.now(),path:path.split('?')[0],reason:options.headers['X-World-Read-Reason']};calls.push(call);try{return await api(path,options);}catch(error:any){call.status=error.status;if(error.status===429)denials.push({reader,at:timer.now(),retryAfterMs:error.retryAfterMs});throw error;}}}));
  const stops=providers.map((p,reader)=>p.subscribe((s:any)=>{if(s.phase==='ready')cadences.push({reader,at:timer.now(),cadence:s.readCadenceMs,asOf:s.asOf,lastSuccessAt:s.lastSuccessAt});}));
  try{
   for(const p of providers){p.setVisible(true);p.start();}await flush();await timer.advance(start+59000);const first=denials[0],before=calls.length;let gate:any=null;
   if(n===1){assert.equal(denials.length,0);assert.equal(providers[0].snapshot().phase,'ready');assert.equal(providers[0].snapshot().readCadenceMs,1000);await timer.advance(start+190000);assert.equal(denials.length,0);}
   else{
    assert.ok(first);assert.ok(providers.every(p=>p.snapshot().stale));const old=providers[0].snapshot(),deadline=Math.min(...providers.map(p=>p.snapshot().retryAt));assert.match(sceneStatus(old).status,/已过期/);for(const p of providers){await p.refresh();p.setVisible(false);p.setVisible(true);}await flush();assert.equal(calls.length,before);assert.equal(providers[0].snapshot().lastSuccessAt,old.lastSuccessAt);
    await timer.advance(deadline-1);assert.equal(calls.length,before,'Manual, visibility and timer paths cannot bypass Retry-After');await timer.advance(deadline+500);assert.ok(providers.every(p=>p.snapshot().phase==='ready'));assert.ok(providers.every(p=>p.snapshot().readCadenceMs===2000));assert.match(sceneStatus(providers[0].snapshot()).status,/每 2 秒/);
    const recoveredAt=cadences.find(c=>c.reader===0&&c.at>=deadline)!.at,rejections=denials.length;const manual=providers[0].refresh();await flush();await timer.advance(timer.now()+100);await manual;assert.equal(providers[0].snapshot().readCadenceMs,2000,'A manual 200 does not clear the slow cadence');
    const secondWindowEnd=recoveredAt+120000;await timer.advance(secondWindowEnd-1);
    if(n===5){assert.equal(denials.length,rejections,'No renewed 49-second/11-second cycle in the next two complete windows');assert.ok(providers.every(p=>p.snapshot().phase==='ready'&&p.snapshot().readCadenceMs===2000));assert.ok(cadences.filter(c=>c.at>=deadline&&c.at<secondWindowEnd).every(c=>c.cadence===2000));}
    await timer.advance(secondWindowEnd+15000);
    if(n===5){assert.equal(denials.length,rejections);assert.ok(providers.every(p=>p.snapshot().readCadenceMs===1500),'Only after two stable full windows does cadence recover one step');assert.ok(cadences.every(c=>c.cadence<=4000));}
    else{assert.ok(denials.length>rejections,'Over-capacity consumers remain subject to real server admission');assert.ok(cadences.some(c=>c.cadence===4000));assert.ok(cadences.every(c=>c.cadence<=4000));}
    gate={first429OffsetMs:first.at-start,retryAfterMs:first.retryAfterMs,deadlineOffsetMs:deadline-start,requestsBeforeDeadline:0,recoveredAtOffsetMs:recoveredAt-start,verifiedStableWindowEndOffsetMs:secondWindowEnd-start,rejectionsAfterRecovery:denials.length-rejections,finalCadences:providers.map(p=>p.snapshot().readCadenceMs)};
   }
   assert.ok(cadences.every(c=>c.lastSuccessAt===c.at&&c.asOf===c.at),'Only a newly accepted real observation advances freshness');assert.ok(observations.every(o=>o.quota.allowed===240&&o.quota.limit===240));
   results.push({readers:n,scope:'Unchanged Gateway/IP quota, real common GET/body handling, Fastify inject and virtual clock with60ms public handler latency. No production traffic.',denials:denials.length,gate,cadenceTransitions:cadences.filter((c,i)=>!cadences.slice(0,i).some(old=>old.reader===c.reader&&old.cadence===c.cadence)).map(c=>({reader:c.reader,atOffsetMs:c.at-start,cadence:c.cadence})),allowedWindows:observations.map(o=>({allowed:o.quota.allowed,limit:o.quota.limit,retryAfterSeconds:o.quota.retryAfterSeconds}))});
  }finally{for(const stop of stops)stop();for(const p of providers)p.dispose();assert.equal(timer.pending.size,0);await app.close();Date.now=originalDate;globalThis.fetch=originalFetch;}
 }
 const output=new URL('../../outputs/scene-429-investigation/private/',import.meta.url);await mkdir(output,{recursive:true});await writeFile(new URL('v052-results.json',output),JSON.stringify({sourceBase:'c79605ced03e851c81c408d9a753c0245b43741d',scope:'v0.5.2 author candidate; original replay-results.json untouched',results},null,2)+'\n',{mode:0o600});for(const r of results)t.diagnostic(JSON.stringify({readers:r.readers,denials:r.denials,gate:r.gate}));
});
test('slower cadence never extends the five-second view age; pending slow reads and hidden time cannot qualify as stable windows',async()=>{
 const timer=clock(),start=timer.now();let rateLimited=false,slow=false;
 const provider=createWorldSceneProvider({...timer,random:()=>.5,request:async(path:string)=>{if(path==='/capabilities')return structuredClone(f.capabilities);const raw=structuredClone(path.startsWith('/world/rules')?f.rules:f.scene);raw.serverTime=timer.now();raw.data.asOf=timer.now();if(path.startsWith('/world/scene')){if(rateLimited)throw{status:429,code:'rate_limited',retryAfterMs:11000};if(slow)await new Promise<void>(done=>timer.setTimer(done,2180));}return raw;}});
 try{
  provider.setVisible(true);provider.start();await flush();for(let i=0;i<2;i++){rateLimited=true;await provider.refresh();assert.equal(provider.snapshot().stale,true);rateLimited=false;await timer.advance(provider.snapshot().retryAt);assert.equal(provider.snapshot().readCadenceMs,i?4000:2000);}
  const before=provider.snapshot();slow=true;await timer.advance(before.lastSuccessAt+4999);assert.equal(provider.snapshot().stale,false);await timer.advance(before.lastSuccessAt+5000);let s=provider.snapshot();assert.equal(s.phase,'refreshing');assert.equal(s.stale,true);assert.equal(s.lastSuccessAt,before.lastSuccessAt);assert.equal(s.asOf,before.asOf);assert.match(sceneStatus(s).status,/已过期/);
  await timer.advance(before.lastSuccessAt+6305);s=provider.snapshot();assert.equal(s.phase,'ready');assert.equal(s.stale,false);assert.equal(s.lastSuccessAt,before.lastSuccessAt+6305);assert.equal(s.asOf,before.lastSuccessAt+4125,'Network time remains distinct from the real observation timestamp');
  slow=false;provider.setVisible(false);await timer.advance(start+250000);provider.setVisible(true);await flush();assert.equal(provider.snapshot().readCadenceMs,4000,'Hidden time cannot earn a faster cadence');const visibleAt=timer.now();await timer.advance(visibleAt+119999);assert.equal(provider.snapshot().readCadenceMs,4000);assert.equal(provider.snapshot().phase,'ready');
 }finally{provider.dispose();assert.equal(timer.pending.size,0);}
});
test('known Retry-After survives a broken 429 body without retrying or changing an original write payload',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 for(const bodyFailure of ['invalid-json','read-failure']){
  let count=0;const input={operationId:'own-original-operation',fields:{displayName:'own-synthetic-sample'}},before=structuredClone(input);
  globalThis.fetch=async(_url,options)=>{count++;assert.equal(options!.body,JSON.stringify(before));const response=new Response('not-json',{status:429,headers:{'Retry-After':'11'}});if(bodyFailure==='read-failure')response.text=async()=>{throw new TypeError('Connection lost after headers');};return response;};
  await assert.rejects(api('/own-synthetic-write',{method:'POST',body:input}),(error:any)=>error.status===429&&error.retryAfterMs===11000&&isUnknown(error));assert.equal(count,1);assert.deepEqual(input,before);
 }
});
