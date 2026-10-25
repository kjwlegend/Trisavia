import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module.
import {createPublicCapabilitiesReader} from '../../apps/web/public/public-capabilities.js';
// @ts-expect-error Browser module.
import {createWorldSceneProvider} from '../../apps/web/public/hud/world-scene-provider.js';
// @ts-expect-error Browser module.
import {readWorldStartup} from '../../apps/web/public/hud/world-startup.js';
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
const startup=():any=>({protocolVersion:1,requestId:'own-startup-request',instanceId:caps.instanceId,serverTime:1,data:{startupVersion:1,publicOnly:true,instanceId:caps.instanceId,worldId:'default',gatewayCatalogRevision:'gateway-'+'a'.repeat(24),rulesetVersion:1,topologyVersion:1,worldRevision:1,asOf:1,rules:rules(),scene:scene()}});
test('startup validates one exact public observation, including historical rows, and rejects mismatched metadata or private shape',()=>{
 assert.equal(readWorldStartup(startup()).instanceId,caps.instanceId);
 const changes=[(s:any)=>s.data.instanceId='another-instance',(s:any)=>s.data.topologyVersion=2,(s:any)=>s.data.worldRevision=2,(s:any)=>s.data.scene.worldRevision=2,(s:any)=>s.data.rules.world.rulesetVersion=2,(s:any)=>s.data.publicOnly=false,(s:any)=>s.data.ownerId='unexpected-private',(s:any)=>s.data.scene.avatars[0].activity={coinReward:42},(s:any)=>s.data.scene.avatars[0].rulesetVersion=2,(s:any)=>delete s.requestId];
 for(const change of changes){const raw=startup();change(raw);assert.throws(()=>readWorldStartup(raw),/(world_response|life_public_state)_invalid/);}
 const historical=startup();historical.data.rules=rules(2);historical.data.rules.rules.topologyVersion=2;historical.data.rulesetVersion=2;historical.data.topologyVersion=2;historical.data.worldRevision=2;historical.data.scene.worldRevision=2;assert.equal(readWorldStartup(historical).sceneEnvelope.data.avatars[0].rulesetVersion,1,'Old still-authoritative rows do not become new movements');
});
test('one anonymous startup supplies the first page; continuation and later discovery keep the original routes and guards',async()=>{
 for(const mismatch of [false,true]){
  const calls:string[]=[],first=startup();first.data.scene.complete=false;first.data.scene.nextCursor='opaque-original-page';
  const provider=createWorldSceneProvider({canReadStartup:()=>true,maxPages:1,request:async(path:string)=>{calls.push(path);if(path.startsWith('/world/startup?'))return first;if(path==='/capabilities')return caps;if(path.startsWith('/world/rules?'))return envelope(rules());const next=scene();next.avatars=[{...next.avatars[0]!,id:'avatar-next',agentId:'next',profile:{...next.avatars[0]!.profile,agentId:'next'}}];return envelope(next,mismatch?'foreign-instance':caps.instanceId);},setTimer:()=>1,clearTimer:()=>{}});
  provider.setVisible(true);provider.start();await flush();assert.equal(provider.snapshot().phase,'partial');assert.deepEqual(calls,['/world/startup?version=1&worldId=default&limit=50']);assert.equal(provider.snapshot().lastSuccessAt,null);await provider.loadMore();assert.match(calls[1]!,/world\/scene\?worldId=default&limit=50&cursor=opaque-original-page$/);assert.equal(provider.snapshot().phase,mismatch?'error':'ready');assert.equal(provider.snapshot().avatars.length,mismatch?0:2);
  if(!mismatch){await provider.refresh();assert.equal(calls.filter(p=>p.startsWith('/world/startup')).length,1);assert.ok(calls.includes('/capabilities'));assert.ok(calls.some(p=>p.startsWith('/world/rules?')));}
  provider.dispose();
 }
});
test('only exact unsupported responses fall back once; denial, body failure, unavailable targets and inconsistency never bypass startup',async()=>{
 for(const error of [{status:404,code:'not_found'},{status:404,code:'capability_not_available'},{status:400,code:'world_startup_version_required'},{status:404,code:'world_not_accessible'},{status:403,code:'request_timeout'},{status:400,code:'anonymous_startup_only'},{status:503,code:'world_startup_inconsistent'},{status:200,code:'response_unknown'}]){
  const calls:string[]=[],timers=new Map<number,()=>void>();let time=0,id=0;
  const provider=createWorldSceneProvider({canReadStartup:()=>true,now:()=>time,setTimer:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimer:(key:number)=>timers.delete(key),request:async(path:string)=>{calls.push(path);if(path.startsWith('/world/startup?'))throw error;return path==='/capabilities'?caps:envelope(path.startsWith('/world/rules?')?rules():scene());}});
  provider.setVisible(true);provider.start();await flush();const allowed=['not_found','capability_not_available','world_startup_version_required'].includes(error.code);assert.equal(provider.snapshot().phase,allowed?'ready':error.code==='world_not_accessible'?'unavailable':'error',error.code);assert.equal(calls.length,allowed?4:1,error.code);assert.equal(provider.snapshot().avatars.length,allowed?1:0);
  if(allowed){await provider.refresh();assert.equal(calls.filter(p=>p.startsWith('/world/startup?')).length,1);}else if(error.status===503){await provider.refresh();assert.equal(calls.length,1,'Manual refresh respects the existing cooling gate');time=2000;await provider.refresh();assert.equal(calls.length,2);assert.ok(calls.every(p=>p.startsWith('/world/startup?')),'Recovery must not turn inconsistency into a legacy fallback');}
  provider.dispose();assert.equal(timers.size,0);
 }
});
test('anonymous startup cancellation discards late data; identified entry never requests the anonymous endpoint',async()=>{
 const pending=deferred(),calls:string[]=[],signals:AbortSignal[]=[];let anonymous=true;
 const provider=createWorldSceneProvider({canReadStartup:()=>anonymous,request:async(path:string,options:any)=>{calls.push(path);signals.push(options.signal);if(path.startsWith('/world/startup?'))return pending.promise;return path==='/capabilities'?caps:envelope(path.startsWith('/world/rules?')?rules():scene());},setTimer:()=>1,clearTimer:()=>{}});
 provider.setVisible(true);provider.start();await flush();provider.setVisible(false);assert.equal(signals[0]!.aborted,true);anonymous=false;provider.setVisible(true);await flush();assert.equal(provider.snapshot().phase,'ready');assert.equal(calls.filter(p=>p.startsWith('/world/startup?')).length,1);pending.resolve({...startup(),instanceId:'late-old-instance'});await flush();assert.equal(provider.snapshot().instanceId,caps.instanceId);provider.dispose();
 const identifiedCalls:string[]=[],identified=createWorldSceneProvider({canReadStartup:()=>false,request:async(path:string)=>{identifiedCalls.push(path);return path==='/capabilities'?caps:envelope(path.startsWith('/world/rules?')?rules():scene());},setTimer:()=>1,clearTimer:()=>{}});identified.setVisible(true);identified.start();await flush();assert.equal(identified.snapshot().phase,'ready');assert.equal(identifiedCalls.length,3);assert.equal(identifiedCalls[0],'/capabilities');identified.dispose();
});
test('real startup transport is a credential-free uncached GET, without account or write paths',async t=>{
 const original=globalThis.fetch,calls:any[]=[];t.after(()=>globalThis.fetch=original);globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response(JSON.stringify(startup()),{status:200});};
 const provider=createWorldSceneProvider({canReadStartup:()=>true,setTimer:()=>1,clearTimer:()=>{}});t.after(()=>provider.dispose());provider.setVisible(true);provider.start();await flush();assert.equal(provider.snapshot().phase,'ready');assert.equal(calls.length,1);const {url,init}=calls[0];assert.equal(url,'/v1/world/startup?version=1&worldId=default&limit=50');assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);for(const key of ['authorization','cookie'])assert.equal(new Headers(init.headers).get(key),null);
});
