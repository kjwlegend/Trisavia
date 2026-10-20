import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {createWorldSceneProvider} from '../../apps/web/public/hud/world-scene-provider.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {readWorldRules,readWorldPage,projectWorldAvatars,WORLD_PROJECTION_VERSION} from '../../apps/web/public/hud/world-scene-projection.js';

const caps={apiVersion:'v1',instanceId:'test-world-instance',gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}};
const rulesData={world:{worldId:'default',active:true,revision:1,rulesetVersion:1},rules:{worldId:'default',version:1,topologyVersion:1,width:20,height:12},asOf:1000};
const avatar=(id:string,x=1,y=2)=>({id:`avatar-${id}`,worldId:'default',agentId:id,version:1,status:'idle',position:{x,y},placeId:null,rulesetVersion:1,createdAt:10,updatedAt:20,profile:{agentId:id,publishedVersion:1,displayName:`真实 ${id}`,appearance:{template:'basic',color:'blue'}}});
const page=(avatars:unknown[]=[],worldRevision=1,complete=true,nextCursor:string|null=null)=>({worldId:'default',worldRevision,asOf:1000,scope:'world',avatars,complete,nextCursor});
const envelope=(data:unknown)=>({protocolVersion:1,instanceId:caps.instanceId,data});
type Request=(path:string,options:{signal:AbortSignal})=>Promise<unknown>;
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function clock(){let sequence=0;const pending=new Map<number,{callback:()=>void;delay:number}>();return{
 setTimer(callback:()=>void,delay:number){pending.set(++sequence,{callback,delay});return sequence;},clearTimer(id:number){pending.delete(id);},pending,
 fire(){const [id,timer]=pending.entries().next().value!;pending.delete(id);timer.callback();},
};}
function harness(scene:(path:string,signal:AbortSignal)=>Promise<unknown>=async()=>envelope(page()),options:Record<string,unknown>={}){
 const timers=clock(),calls:Array<{path:string;signal:AbortSignal}>=[];
 const request:Request=async(path,{signal})=>{calls.push({path,signal});if(path==='/capabilities')return caps;if(path.startsWith('/world/rules?'))return envelope(rulesData);return scene(path,signal);};
 const provider=createWorldSceneProvider({request,...timers,...options});provider.setVisible(true);provider.start();return{provider,timers,calls};
}

test('logical projection has an explicit version and preserves authoritative cells without scenery or invented motion',()=>{
 const rules=readWorldRules(rulesData),rows=readWorldPage(page([avatar('first',0,0),avatar('last',19,11)]),rules).avatars;
 const projected=projectWorldAvatars(rows,rules);
 assert.equal(WORLD_PROJECTION_VERSION,'logical-grid-to-town@1');
 assert.deepEqual(projected.map((row:any)=>({x:row.x,y:row.y})),[{x:384,y:256},{x:1152,y:768}]);
 assert.deepEqual(projected.map((row:any)=>row.fact.position),[{x:0,y:0},{x:19,y:11}]);
 assert.ok(projected.every((row:any)=>row.walking===false));
 assert.deepEqual(projectWorldAvatars(rows,rules),projected,'Rendering time cannot move a received fact');
});

test('public mapping allowlists fields and rejects stale rules, invalid cells and missing profile authority',()=>{
 const rules=readWorldRules(rulesData),row={...avatar('one'),runtimeToken:'PRIVATE_RUNTIME',profile:{...avatar('one').profile,ownerId:'PRIVATE_OWNER'}};
 assert.doesNotMatch(JSON.stringify(readWorldPage(page([row]),rules)),/PRIVATE_/u);
 assert.equal(readWorldPage(page([{...row,status:'left'}]),rules).avatars.length,0);
 for(const broken of [{...row,position:{x:20,y:2}},{...row,rulesetVersion:2},{...row,profile:{...row.profile,agentId:'other'}}])assert.throws(()=>readWorldPage(page([broken]),rules),/world_response_invalid/u);
});

test('one round reads opaque pages completely with only public credential-free GETs',async()=>{
 const {provider,calls,timers}=harness(async path=>envelope(path.includes('cursor=opaque-next')?page([avatar('two')]):page([avatar('one')],1,false,'opaque-next')));
 await flush();assert.equal(provider.snapshot().phase,'ready');assert.equal(provider.snapshot().complete,true);
 assert.deepEqual(provider.snapshot().avatars.map((row:any)=>row.agentId),['one','two']);
 assert.equal(calls.filter(call=>call.path.startsWith('/world/scene?')).length,2);
 assert.ok(calls.every(call=>call.signal instanceof AbortSignal));assert.equal(timers.pending.size,1);provider.dispose();assert.equal(timers.pending.size,0);
});

test('only the actual gateway.worldSimulation flag enables reads; a misplaced top-level flag cannot authorize the source',async()=>{
 for(const gateway of [{protocolVersion:1,modules:['world']},{...caps.gateway,worldSimulation:{enabled:false}}]){
  const requested:string[]=[];
  const {provider}=harness(undefined,{request:async(path:string)=>{requested.push(path);return{...caps,gateway,worldSimulation:{enabled:true}};}});
  await flush();assert.equal(provider.snapshot().phase,'unavailable');assert.equal(provider.snapshot().errorCode,'world_not_available');assert.deepEqual(provider.snapshot().avatars,[]);assert.deepEqual(requested,['/capabilities']);provider.dispose();
 }
});

test('a bounded partial round can continue manually, and a changed page revision clears every old visible name',async()=>{
 let changed=false;
 const {provider,timers}=harness(async path=>envelope(path.includes('cursor=next')?page([avatar('two')],changed?2:1):page([avatar('one')],1,false,'next')),{maxPages:1});
 await flush();assert.equal(provider.snapshot().phase,'partial');assert.equal(timers.pending.size,0);
 changed=true;await provider.loadMore();assert.equal(provider.snapshot().errorCode,'world_scene_changed');assert.deepEqual(provider.snapshot().avatars,[]);
 changed=false;await provider.refresh();await provider.loadMore();assert.equal(provider.snapshot().phase,'ready');assert.equal(provider.snapshot().avatars.length,2);provider.dispose();
});

test('expired continuation and repeated cursors do not loop; the next retry starts at the collection root',async()=>{
 let expired=true;const paths:string[]=[];
 const {provider}=harness(async path=>{paths.push(path);if(path.includes('cursor=')){if(expired)throw Object.assign(new Error('expired'),{code:'world_cursor_invalid',status:409});return envelope(page([avatar('two')]));}return envelope(page([avatar('one')],1,false,'next'));});
 await flush();assert.equal(provider.snapshot().errorCode,'world_cursor_invalid');assert.deepEqual(provider.snapshot().avatars,[]);
 expired=false;await provider.refresh();assert.equal(paths[2]?.includes('cursor='),false);assert.equal(provider.snapshot().phase,'ready');provider.dispose();
 const repeated=harness(async path=>envelope(page(path.includes('cursor=')?[avatar('two')]:[avatar('one')],1,false,'same')));
 await flush();assert.equal(repeated.provider.snapshot().errorCode,'world_response_invalid');assert.equal(repeated.calls.filter(call=>call.path.startsWith('/world/scene?')).length,2);repeated.provider.dispose();
});

test('visible refresh never overlaps, is capped at one second and failures back off while clearing facts',async()=>{
 let release:(value:unknown)=>void=()=>{},reject=false;
 const {provider,timers,calls}=harness(async()=>{if(reject)throw Object.assign(new Error('busy'),{code:'busy',status:503});return new Promise(resolve=>{release=resolve;});},{intervalMs:10});
 await flush();assert.equal(timers.pending.size,0);assert.equal(calls.length,3);
 release(envelope(page([avatar('first')])));await flush();assert.equal([...timers.pending.values()][0]?.delay,1000);
 reject=true;timers.fire();await flush();assert.deepEqual(provider.snapshot().avatars,[]);assert.equal([...timers.pending.values()][0]?.delay,2000);
 timers.fire();await flush();assert.equal([...timers.pending.values()][0]?.delay,4000);provider.dispose();
});

test('hidden or destroyed scenes cancel immediately; late old pages cannot replace the fresh visible round',async()=>{
 let release:(value:unknown)=>void=()=>{},round=0;
 const {provider,calls,timers}=harness(async()=>++round===1?new Promise(resolve=>{release=resolve;}):envelope(page([avatar('fresh')],2)));
 await flush();const oldSignal=calls.at(-1)!.signal;provider.setVisible(false);assert.equal(oldSignal.aborted,true);assert.equal(timers.pending.size,0);assert.deepEqual(provider.snapshot().avatars,[]);
 provider.setVisible(true);await flush();assert.equal(provider.snapshot().avatars[0].agentId,'fresh');
 release(envelope(page([avatar('stale')])));await flush();assert.equal(provider.snapshot().avatars[0].agentId,'fresh');
 provider.dispose();assert.equal(timers.pending.size,0);await provider.refresh();assert.equal(provider.snapshot().avatars.length,0);
});

test('withdrawn public rows disappear, 403 clears all rows, and unknown source never falls back to demo',async()=>{
 let response:unknown=envelope(page([avatar('old')]));let denied=false;
 const {provider}=harness(async()=>{if(denied)throw Object.assign(new Error('denied'),{code:'insufficient_scope',status:403});return response;});
 await flush();response=envelope(page([],2));await provider.refresh();assert.equal(provider.snapshot().phase,'ready');assert.deepEqual(provider.snapshot().avatars,[]);
 response=envelope(page([avatar('old')],3));await provider.refresh();denied=true;await provider.refresh();assert.equal(provider.snapshot().phase,'error');assert.deepEqual(provider.snapshot().avatars,[]);provider.dispose();
 const unknown=harness(undefined,{request:async()=>{throw new Error('offline');}});await flush();assert.equal(unknown.provider.snapshot().phase,'error');assert.notEqual(unknown.provider.snapshot().enabled,false);unknown.provider.dispose();
 const legacy=harness(undefined,{request:async()=>({apiVersion:'v1',instanceId:'legacy'})});await flush();assert.equal(legacy.provider.snapshot().phase,'demo');legacy.provider.dispose();
});
