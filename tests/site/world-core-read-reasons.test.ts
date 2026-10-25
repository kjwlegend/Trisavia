import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
// @ts-expect-error Browser module is plain JavaScript.
import {createWorldSceneProvider} from '../../apps/web/public/hud/world-scene-provider.js';
// @ts-expect-error Browser module is plain JavaScript.
import {api} from '../../apps/web/public/common.js';

const BUILD='world-provider-20261022-v1',reasons=['start','timer','manual','visible','recovery'];
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/world-core-read-reasons.json',import.meta.url),'utf8'));
const sourceHashes:Record<string,string>={};
if(process.env.WORLD_CORE_READ_DTO_DIR){
 for(const key of ['capabilities','rules','scene']){
  const bytes=readFileSync(resolve(process.env.WORLD_CORE_READ_DTO_DIR,`recovered-${key}.json`));
  fixtures[key]=JSON.parse(bytes.toString());sourceHashes[key]=createHash('sha256').update(bytes).digest('hex');
 }
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const problem=(code:string,status:number,extra:Record<string,unknown>={})=>Object.assign(new Error('synthetic private detail must never enter diagnostic headers'),{code,status,...extra});
function clock(){
 let time=0,id=0;const pending=new Map<number,{at:number;callback:()=>void}>();
 return{now:()=>time,pending,setTimer(callback:()=>void,delay:number){pending.set(++id,{at:time+delay,callback});return id;},clearTimer(key:number){pending.delete(key);},jump(to:number){time=to;},async advance(to:number){
  for(let steps=0;steps<1000;steps++){const next=[...pending].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>to)break;time=next[1].at;pending.delete(next[0]);next[1].callback();await flush();}time=to;
 }};
}
type ReadOptions={signal:AbortSignal;headers?:Record<string,string>};
type Call={at:number;route:string;headers:Record<string,string>};
const routeOf=(path:string)=>path==='/capabilities'?'capabilities':path.startsWith('/world/rules?')?'rules':'scene';
function requestLog(timers:ReturnType<typeof clock>,calls:Call[],respond?:(route:string,options:ReadOptions)=>unknown){
 return async(path:string,options:ReadOptions)=>{const route=routeOf(path);calls.push({at:timers.now(),route,headers:{...options.headers}});return structuredClone(respond?await respond(route,options):fixtures[route]);};
}
function assertHints(calls:Call[],expected?:string){
 for(const call of calls){assert.deepEqual(Object.keys(call.headers).sort(),['X-World-Read-Build','X-World-Read-Reason']);assert.equal(call.headers['X-World-Read-Build'],BUILD);assert.ok(reasons.includes(call.headers['X-World-Read-Reason']||''));if(expected)assert.equal(call.headers['X-World-Read-Reason'],expected);}
}
function start(request:ReturnType<typeof requestLog>,timers:ReturnType<typeof clock>,options:Record<string,unknown>={}){
 const provider=createWorldSceneProvider({request,...timers,...options});provider.setVisible(true);provider.start();return provider;
}

test('archived e005 DTO replay keeps the two-document request timeline and bounded metadata budget unchanged',async t=>{
 async function replay(factory:typeof createWorldSceneProvider){
  const timers=clock(),calls:Call[]=[],providers=Array.from({length:2},()=>{const provider=factory({request:requestLog(timers,calls),...timers});provider.setVisible(true);provider.start();return provider;});
  await flush();await timers.advance(59000);assert.ok(providers.every(provider=>provider.snapshot().phase==='ready'));assert.equal(timers.pending.size,2);for(const provider of providers)provider.dispose();assert.equal(timers.pending.size,0);return calls;
 }
 const calls=await replay(createWorldSceneProvider),counts=Object.fromEntries(['capabilities','rules','scene'].map(route=>[route,calls.filter(call=>call.route===route).length]));
 assert.deepEqual(counts,{capabilities:4,rules:4,scene:120});assertHints(calls);assertHints(calls.filter(call=>call.at===0),'start');assertHints(calls.filter(call=>call.at>0),'timer');
 if(process.env.WORLD_CORE_READ_BASELINE_MODULE){
  const {createWorldSceneProvider:baseline}=await import(pathToFileURL(resolve(process.env.WORLD_CORE_READ_BASELINE_MODULE)).href),before=await replay(baseline);
  const timeline=(rows:Call[])=>rows.map(({at,route})=>({at,route}));assert.deepEqual(timeline(calls),timeline(before),'Labels add no requests, timing changes, or metadata refreshes');t.diagnostic('Exact baseline replay: 128 requests before and after; identical route/time timeline.');
 }
 t.diagnostic(JSON.stringify({source:process.env.WORLD_CORE_READ_DTO_DIR?'exact archived public e005 DTOs':'redacted archived DTO fixture',sourceHashes,counts}));
});

test('deferred initial visibility is start, later manual/visible entries retain their trigger, and expiry remains timer',async()=>{
 const timers=clock(),calls:Call[]=[],provider=createWorldSceneProvider({request:requestLog(timers,calls),...timers});
 provider.start();await provider.refresh();provider.setVisible(false);assert.equal(calls.length,0,'Hidden and blocked entry points do not consume the first actual automatic chain');provider.setVisible(true);await flush();assert.equal(calls.length,3);assertHints(calls,'start');
 let mark=calls.length;await provider.refresh();assert.equal(calls.length-mark,3);assertHints(calls.slice(mark),'manual');
 mark=calls.length;provider.setVisible(false);provider.setVisible(true);await flush();assert.equal(calls.length-mark,3);assertHints(calls.slice(mark),'visible');
 mark=calls.length;await timers.advance(30000);assertHints(calls.slice(mark),'timer');assert.equal(calls.slice(mark).filter(call=>call.route==='rules').length,1);provider.dispose();assert.equal(timers.pending.size,0);
});

test('transient and unknown-network failures keep all cooling gates and label only the due automatic chain recovery',async()=>{
 for(const error of [problem('network_unknown',0),problem('rate_limited',429),problem('rate_limited',429,{retryAfterMs:NaN}),problem('rate_limited',429,{retryAfterMs:5000}),problem('response_unknown',503),problem('',503)]){
  const timers=clock(),calls:Call[]=[];let fail=false;const provider=start(requestLog(timers,calls,route=>{if(route==='scene'&&fail)throw error;return fixtures[route];}),timers);
  await flush();fail=true;await timers.advance(1000);assert.equal(provider.snapshot().phase,'recovering');const before=calls.length,deadline=provider.snapshot().retryAt;assertHints(calls.slice(-1),'timer');
  await provider.refresh();provider.setVisible(false);provider.setVisible(true);await flush();await timers.advance(deadline-1);await provider.refresh();assert.equal(calls.length,before,'Manual and visible cannot bypass local or server deadlines');
  fail=false;await timers.advance(deadline);assert.equal(provider.snapshot().phase,'ready');assert.equal(calls.length-before,3);assertHints(calls.slice(before),'recovery');
  const recovered=calls.length;await timers.advance(deadline+1000);assert.equal(calls.length-recovered,error.status===429?0:1);if(error.status===429){assert.equal(provider.snapshot().readCadenceMs,2000,'One success cannot clear the slower post-limit cadence');await timers.advance(deadline+2200);assert.equal(calls.length-recovered,1);}assertHints(calls.slice(recovered),'timer');assertHints(calls);provider.dispose();assert.equal(timers.pending.size,0);
 }
});

test('explicit manual and visible recovery at the original deadline retain entry priority',async()=>{
 for(const entry of ['manual','visible']){
  const timers=clock(),calls:Call[]=[];let fail=false;const provider=start(requestLog(timers,calls,route=>{if(route==='scene'&&fail)throw problem('busy',503);return fixtures[route];}),timers);
  await flush();fail=true;await timers.advance(1000);const before=calls.length,deadline=provider.snapshot().retryAt;
  if(entry==='visible')provider.setVisible(false);timers.jump(deadline);fail=false;
  if(entry==='manual')await provider.refresh();else{provider.setVisible(true);await flush();}
  assert.equal(calls.length-before,3);assertHints(calls.slice(before),entry);assert.equal(provider.snapshot().phase,'ready');await timers.advance(deadline+1000);assertHints(calls.slice(-1),'timer');provider.dispose();
 }
});

test('labels do not reenter an in-flight chain or let a cancelled old response restore a cleared scene',async()=>{
 const timers=clock(),calls:Call[]=[];let resolveOld:(value:unknown)=>void=()=>{},first=true,oldSignal:AbortSignal|undefined;
 const provider=start(requestLog(timers,calls,(route,options)=>{if(route==='scene'&&first){first=false;oldSignal=options.signal;return new Promise(resolve=>{resolveOld=resolve;});}if(route==='scene'){const scene=structuredClone(fixtures.scene);scene.data.worldRevision++;scene.data.avatars=[];return scene;}return fixtures[route];}),timers);
 await flush();assert.equal(calls.length,3);await provider.refresh();assert.equal(calls.length,3);provider.setVisible(false);assert.equal(oldSignal?.aborted,true);provider.setVisible(true);await flush();assert.equal(calls.length,6);assertHints(calls.slice(0,3),'start');assertHints(calls.slice(3),'visible');assert.equal(provider.snapshot().phase,'ready');assert.deepEqual(provider.snapshot().avatars,[]);
 resolveOld(fixtures.scene);await flush();assert.equal(calls.length,6);assert.deepEqual(provider.snapshot().avatars,[]);assert.equal(provider.snapshot().worldRevision,fixtures.scene.data.worldRevision+1);provider.dispose();assert.equal(timers.pending.size,0);
});

test('automatic pages retain one chain reason and an explicit bounded continuation is manual',async()=>{
 for(const maxPages of [1,2]){
  const timers=clock(),calls:Call[]=[];let sceneReads=0;const provider=start(requestLog(timers,calls,route=>{if(route!=='scene')return fixtures[route];const scene=structuredClone(fixtures.scene),first=sceneReads++===0;scene.data.avatars=scene.data.avatars.slice(first?0:1,first?1:undefined);scene.data.complete=!first;scene.data.nextCursor=first?'synthetic-opaque-continuation':null;return scene;}),timers,{maxPages});
  await flush();if(maxPages===1){assert.equal(provider.snapshot().phase,'partial');assert.equal(timers.pending.size,0);await provider.loadMore();assertHints(calls.slice(0,3),'start');assertHints(calls.slice(3),'manual');}else assertHints(calls,'start');
  assert.equal(calls.length,4);assert.equal(provider.snapshot().phase,'ready');assert.equal(provider.snapshot().avatars.length,fixtures.scene.data.avatars.length);provider.dispose();
 }
});

test('the real transport forwards hints while case-insensitive trusted headers and original write payload retain priority without retries',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const calls:{path:string;init:RequestInit}[]=[];
 globalThis.fetch=async(input,init={})=>{const path=String(input);calls.push({path,init});if(path==='/v1/synthetic-write')return new Response(JSON.stringify({error:{code:'unavailable'}}),{status:503});return new Response(JSON.stringify(fixtures[routeOf(path.slice(3))]),{status:200});};
 const timers=clock(),provider=createWorldSceneProvider({...timers});t.after(()=>provider.dispose());provider.setVisible(true);provider.start();await flush();assert.equal(provider.snapshot().phase,'ready');assert.equal(calls.length,3);
 for(const {init}of calls){const headers=new Headers(init.headers);assert.equal(headers.get('X-World-Read-Build'),BUILD);assert.equal(headers.get('X-World-Read-Reason'),'start');assert.equal(headers.get('Authorization'),null);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');}
 provider.dispose();const body={operationId:'synthetic-original-operation',fields:{displayName:'Synthetic retained input'}},extra={'authorization':'incorrect','CONTENT-TYPE':'text/plain','X-Synthetic-Test':'retained'};
 await assert.rejects(api('/synthetic-write',{method:'PUT',body,token:'synthetic-only-token',headers:extra}),(error:any)=>error.code==='unavailable');assert.equal(calls.length,4,'A failed write still has one attempt');
 const sent=calls[3]!.init,headers=new Headers(sent.headers);assert.equal(headers.get('Authorization'),'Bearer synthetic-only-token');assert.equal(headers.get('Content-Type'),'application/json');assert.equal(headers.get('X-Synthetic-Test'),'retained');assert.equal(headers.get('X-World-Read-Build'),null);assert.equal(sent.body,JSON.stringify(body));assert.equal(extra.authorization,'incorrect');
});
