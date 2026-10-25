import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module.
import {createPublicCapabilitiesReader} from '../../apps/web/public/public-capabilities.js';
// @ts-expect-error Browser module.
import {createWorldSceneProvider} from '../../apps/web/public/hud/world-scene-provider.js';
const flush=()=>new Promise<void>(done=>setImmediate(done));
const deferred=()=>{let resolve:(value:any)=>void=()=>{},reject:(error:any)=>void=()=>{};const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const caps={apiVersion:'v1',instanceId:'startup-contract',gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}};
const rules=(version=1)=>({world:{worldId:'default',active:true,revision:version,rulesetVersion:version},rules:{worldId:'default',version,topologyVersion:1,width:16,height:16},asOf:1});
const scene=(version=1)=>({worldId:'default',scope:'world',worldRevision:version,asOf:1,avatars:[{id:'avatar-startup',agentId:'startup',worldId:'default',version:1,rulesetVersion:version,status:'idle',position:{x:0,y:0},placeId:'commons',createdAt:1,updatedAt:1,profile:{agentId:'startup',publishedVersion:1,displayName:'verified scene',appearance:{template:'basic',color:'blue'}}}],complete:true,nextCursor:null});
const envelope=(data:any,instanceId=caps.instanceId)=>({protocolVersion:1,instanceId,data});

test('anonymous in-flight discovery shares one read, isolates cancellation and never caches a completed result',async()=>{
 const waiting=deferred(),signals:AbortSignal[]=[],read=createPublicCapabilitiesReader({request:async(_path:string,options:any)=>{signals.push(options.signal);return waiting.promise;}}),a=new AbortController(),b=new AbortController();
 const first=read({signal:a.signal}),second=read({signal:b.signal});await flush();assert.equal(signals.length,1);a.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(signals[0]!.aborted,false);waiting.resolve(caps);const result=await second;assert.equal(result.instanceId,caps.instanceId);result.gateway.modules.push('mutated');assert.deepEqual(caps.gateway.modules,['world']);
 await read();assert.equal(signals.length,2,'The next discovery must contact the server again');
});
test('the last cancelled reader aborts its request, while identity-bearing reads never join the public request',async()=>{
 const signals:AbortSignal[]=[],read=createPublicCapabilitiesReader({request:async(_path:string,options:any)=>{signals.push(options.signal);if(options.token||new Headers(options.headers).has('authorization'))return caps;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError'))));}}),a=new AbortController(),b=new AbortController();
 const one=read({signal:a.signal}),two=read({signal:b.signal});await flush();await read({token:'synthetic-token'});await read({headers:{Authorization:'Bearer synthetic-header'}});assert.equal(signals.length,3);a.abort();assert.equal(signals[0]!.aborted,false);b.abort();await Promise.all([assert.rejects(one,{name:'AbortError'}),assert.rejects(two,{name:'AbortError'})]);assert.equal(signals[0]!.aborted,true);
});
test('a failed shared discovery leaves no cached failure and the next attempt can observe a new instance',async()=>{
 let calls=0;const read=createPublicCapabilitiesReader({request:async()=>{if(++calls===1)throw Object.assign(Error('offline'),{status:503});return{...caps,instanceId:'replacement-instance'};}});await assert.rejects(read());assert.equal((await read()).instanceId,'replacement-instance');assert.equal(calls,2);
});
test('parallel first scene cannot publish before matching rules, and mismatched rule or instance clears instead of downgrading',async()=>{
 for(const mismatch of ['none','rules','instance','denied']){
  const pendingRules=deferred(),pendingScene=deferred(),calls:string[]=[],provider=createWorldSceneProvider({request:async(path:string)=>{calls.push(path);if(path==='/capabilities')return caps;return path.startsWith('/world/rules')?pendingRules.promise:pendingScene.promise;},setTimer:()=>1,clearTimer:()=>{}});provider.setVisible(true);provider.start();await flush();assert.equal(calls.length,3,'Rules and scene are both dispatched after enabled capabilities');assert.equal(provider.snapshot().complete,false);
  pendingScene.resolve(envelope(scene(mismatch==='rules'?2:1),mismatch==='instance'?'foreign-instance':caps.instanceId));await flush();assert.equal(provider.snapshot().complete,false,'An early scene alone has no authority');assert.deepEqual(provider.snapshot().avatars,[]);
  if(mismatch==='denied')pendingRules.reject({status:403,code:'insufficient_scope'});else pendingRules.resolve(envelope(rules()));await flush();assert.equal(provider.snapshot().phase,mismatch==='none'?'ready':'error');assert.equal(provider.snapshot().avatars.length,mismatch==='none'?1:0);provider.dispose();
 }
});
