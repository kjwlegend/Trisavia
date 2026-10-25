import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is plain JavaScript.
import {createWorldSceneProvider} from '../../apps/web/public/hud/world-scene-provider.js';
// @ts-expect-error Browser module is plain JavaScript.
import {api} from '../../apps/web/public/common.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function clock(){let time=0,id=0;const pending=new Map<number,{at:number;callback:()=>void}>();return{now:()=>time,setTimer(callback:()=>void,delay:number){pending.set(++id,{at:time+delay,callback});return id;},clearTimer(key:number){pending.delete(key);},pending,async advance(to:number){for(let steps=0;steps<1000;steps++){const next=[...pending].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>to)break;time=next[1].at;pending.delete(next[0]);next[1].callback();await flush();}time=to;}};}
const caps={apiVersion:'v1',instanceId:'public-test',gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}};
const rules={world:{worldId:'default',active:true,revision:1,rulesetVersion:1},rules:{worldId:'default',version:1,topologyVersion:1,width:16,height:16},asOf:1};
const avatar=(id:string)=>({id:`avatar-${id}`,worldId:'default',agentId:id,version:1,status:'idle',position:{x:0,y:0},placeId:'commons',rulesetVersion:1,createdAt:1,updatedAt:1,profile:{agentId:id,publishedVersion:1,displayName:id,appearance:{template:'basic',color:'blue'}}});
const envelope=(data:unknown,instanceId='public-test')=>({protocolVersion:1,instanceId,data});
const page=(ids=['old'],worldRevision=1)=>envelope({worldId:'default',worldRevision,asOf:1,scope:'world',avatars:ids.map(avatar),complete:true,nextCursor:null});
const problem=(code:string,status=503,rest:Record<string,unknown>={})=>Object.assign(new Error(code),{code,status,...rest});
function reader(request:(path:string,options:{signal:AbortSignal})=>Promise<unknown>,timers=clock()){
 const provider=createWorldSceneProvider({request,...timers});provider.setVisible(true);provider.start();return{provider,timers};
}

test('two naturally visible pages fit the shared 240/minute Gateway budget alongside one ordinary metadata lookup',async t=>{
 const timers=clock();let gatewayReads=1,limited=0,capReads=0;
 const request=async(path:string)=>{if(path==='/capabilities'){capReads++;return caps;}if(++gatewayReads>240){limited++;throw problem('rate_limited',429,{retryAfterMs:60000-timers.now()});}return path.startsWith('/world/rules')?envelope(rules):page();};
 const a=reader(request,timers),b=reader(request,timers);await flush();await timers.advance(59000);
 assert.equal(limited,0,'Two normal pages must leave budget for ordinary Gateway use');assert.ok(gatewayReads<=130,`Unexpected metadata multiplication: ${gatewayReads}`);assert.ok(capReads<=4);assert.equal(a.provider.snapshot().phase,'ready');assert.equal(b.provider.snapshot().phase,'ready');t.diagnostic(`60-second shared-window fixture: ${gatewayReads} Gateway reads including one other lookup, ${capReads} capabilities reads, ${limited} rate-limit responses`);a.provider.dispose();b.provider.dispose();
});

test('a short network failure keeps a labelled last-success snapshot, backs off, and a new complete empty result clears it',async()=>{
 let fail=false,response=page();const request=async(path:string)=>{if(path==='/capabilities')return caps;if(path.startsWith('/world/rules'))return envelope(rules);if(fail)throw problem('network_unknown',0);return response;};
 const {provider,timers}=reader(request);await flush();fail=true;await timers.advance(1000);
 assert.equal(provider.snapshot().phase,'recovering');assert.equal(provider.snapshot().errorCode,'network_unknown');assert.equal(provider.snapshot().avatars[0].agentId,'old');assert.equal(provider.snapshot().lastSuccessAt,0);
 for(const target of [3000,7000,15000,31000,61000])await timers.advance(target);
 const wait=[...timers.pending.values()][0]!.at-timers.now();assert.ok(wait>=2000&&wait<=30000,'Persistent failures remain bounded and never poll faster');
 fail=false;response=page([],2);await timers.advance([...timers.pending.values()][0]!.at);assert.equal(provider.snapshot().phase,'ready');assert.deepEqual(provider.snapshot().avatars,[]);assert.equal(provider.snapshot().errorCode,null);provider.dispose();
});

test('Retry-After gates automatic and manual retries without turning intentional cancellation into a fault',async()=>{
 let limited=false,requests=0;const request=async(path:string)=>{requests++;if(path==='/capabilities')return caps;if(path.startsWith('/world/rules'))return envelope(rules);if(limited)throw problem('rate_limited',429,{retryAfterMs:60000});return page();};
 const {provider,timers}=reader(request);await flush();limited=true;await timers.advance(1000);assert.equal(provider.snapshot().phase,'recovering');assert.equal(provider.snapshot().retryAt,61000);
 const before=requests;await provider.refresh();assert.equal(requests,before,'Manual retry cannot bypass a server cooling window');provider.setVisible(false);provider.setVisible(true);assert.equal(provider.snapshot().phase,'recovering');assert.equal(provider.snapshot().stale,true);assert.equal(provider.snapshot().avatars[0].agentId,'old');await timers.advance(60000);assert.equal(requests,before);
 limited=false;await timers.advance(61000);assert.equal(provider.snapshot().phase,'ready');provider.setVisible(false);assert.equal(provider.snapshot().phase,'paused');assert.equal(timers.pending.size,0);provider.dispose();
});

test('missing or invalid rate-limit metadata and network failures share a deadline across manual and visible recovery',async()=>{
 for(const error of [problem('rate_limited',429),problem('rate_limited',429,{retryAfterMs:NaN}),problem('network_unknown',0)]){
  let fail=false,requests=0;const request=async(path:string)=>{requests++;if(path==='/capabilities')return caps;if(path.startsWith('/world/rules'))return envelope(rules);if(fail)throw error;return page();};
  const {provider,timers}=reader(request);await flush();fail=true;await timers.advance(1000);assert.equal(provider.snapshot().retryAt,3000);
  const before=requests;await provider.refresh();await timers.advance(1500);await provider.refresh();provider.setVisible(false);provider.setVisible(true);await flush();
  assert.equal(requests,before,error.code+' cannot bypass the fallback deadline');assert.equal(provider.snapshot().errorCode,error.code);assert.equal(provider.snapshot().errorStatus,error.status);
  await timers.advance(2999);assert.equal(requests,before);fail=false;await timers.advance(3000);assert.equal(provider.snapshot().phase,'ready');assert.ok(requests>before,'The original deadline must still allow recovery');provider.dispose();
 }
});

test('authorization, explicit unavailable source and invalid cursor clear the snapshot instead of reusing stale public names',async()=>{
 for(const error of [problem('insufficient_scope',403),problem('world_not_accessible',404),problem('world_not_available',503),problem('world_cursor_invalid',409)]){
  let fail=false;const request=async(path:string)=>{if(path==='/capabilities')return caps;if(path.startsWith('/world/rules'))return envelope(rules);if(fail)throw error;return page();};const{provider,timers}=reader(request);await flush();fail=true;await timers.advance(1000);assert.deepEqual(provider.snapshot().avatars,[],error.code);assert.notEqual(provider.snapshot().phase,'recovering');provider.dispose();
 }
});

test('metadata is revalidated on manual, visible, recovery and bounded expiry; old instance replies never restore names',async()=>{
 let capReads=0,currentCaps=caps,fail=false;const request=async(path:string)=>{if(path==='/capabilities'){capReads++;return currentCaps;}if(path.startsWith('/world/rules'))return envelope(rules,currentCaps.instanceId);if(fail)throw problem('busy',503);return page();};
 const{provider,timers}=reader(request);await flush();await timers.advance(1000);assert.equal(capReads,1);await provider.refresh();assert.equal(capReads,2);provider.setVisible(false);provider.setVisible(true);await flush();assert.equal(capReads,3);
 await timers.advance(31000);assert.ok(capReads>=4,'A visible page must not cache capabilities permanently');fail=true;await provider.refresh();fail=false;currentCaps={...caps,instanceId:'new-instance'};await timers.advance([...timers.pending.values()][0]!.at);assert.deepEqual(provider.snapshot().avatars,[],'Old-instance result is never retained on an authority change');provider.dispose();
});

test('a changed rules version cannot preserve the old names when the new scene is temporarily unavailable',async()=>{
 let changed=false;const request=async(path:string)=>{if(path==='/capabilities')return caps;if(path.startsWith('/world/rules'))return envelope(changed?{...rules,world:{...rules.world,rulesetVersion:2},rules:{...rules.rules,version:2}}:rules);if(changed)throw problem('busy',503);return page();};const{provider}=reader(request);await flush();changed=true;await provider.refresh();assert.deepEqual(provider.snapshot().avatars,[]);assert.notEqual(provider.snapshot().phase,'recovering');provider.dispose();
});

test('transport projects valid Retry-After without copying arbitrary headers or treating invalid values as zero',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 for(const [header,expected]of [['17',17000],['bad',undefined],['-1',undefined]] as const){globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'rate_limited'}}),{status:429,headers:{'Content-Type':'application/json','Retry-After':header}});await assert.rejects(api('/world/scene'),(error:any)=>error.status===429&&error.code==='rate_limited'&&error.retryAfterMs===expected);}
});
