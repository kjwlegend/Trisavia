import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser read-state module is plain JavaScript.
import {createLifeReadState} from '../../apps/web/public/hud/life-read-state.js';
const view=(agentId:string)=>({instanceId:'own-fixture',data:{agentId,activity:null,energy:82}});
const flush=()=>new Promise<void>(done=>setImmediate(done));
function fixture(){let context={authenticated:true,phase:'ready',selectedAgentId:'own-a',observationRevision:1,agents:[{agentId:'own-a'},{agentId:'own-b'}]};const listeners=new Set<(value:any)=>void>();return{session:{snapshot:()=>structuredClone(context),subscribe(listener:(value:any)=>void){listeners.add(listener);listener(structuredClone(context));return()=>listeners.delete(listener);}},set(id:string){context={...context,selectedAgentId:id,observationRevision:context.observationRevision+1};for(const listener of listeners)listener(structuredClone(context));}};}
const validate=(value:any,agentId:string)=>{if(value.data.agentId!==agentId)throw {code:'life_response_invalid',status:200};return value;};
test('life private reader clears on A/B selection and ignores late old-scope body',async()=>{
 const f=fixture();let release:(value:any)=>void=()=>{};const signals:AbortSignal[]=[];const reader=createLifeReadState({session:f.session,privateScope:true,refreshMs:0,read:async({agentId,signal}:any)=>{signals.push(signal);return agentId==='own-a'?new Promise(done=>{release=done;}):view(agentId);},validate});reader.setActive(true);f.set('own-b');await flush();release(view('own-a'));await flush();assert.equal(signals[0]!.aborted,true);assert.equal(reader.snapshot().data.agentId,'own-b');reader.dispose();
});
test('life temporary failures freeze the last success; permissions, protocol and instance changes remove it',async()=>{
 const f=fixture();let error:any=null,body=view('own-a');const reader=createLifeReadState({session:f.session,privateScope:true,refreshMs:0,now:()=>1234,read:async()=>{if(error)throw error;return body;},validate});reader.setActive(true);await flush();error={code:'request_timeout',status:200};await reader.refresh();assert.equal(reader.snapshot().stale,true);assert.equal(reader.snapshot().data.energy,82);assert.equal(reader.snapshot().lastSuccessAt,1234);error={status:403};await reader.refresh();assert.equal(reader.snapshot().data,null);error=null;await reader.refresh();body={...body,instanceId:'another-instance'};await reader.refresh();assert.equal(reader.snapshot().phase,'changed');assert.equal(reader.snapshot().data,null);body=view('own-a');await reader.refresh();body=view('own-b');await reader.refresh();assert.equal(reader.snapshot().data,null);reader.dispose();
});
test('inactive life cards do not read and cancellation of an open request cannot refill the view',async()=>{
 let reads=0,release:(value:any)=>void=()=>{};const reader=createLifeReadState({refreshMs:0,read:async()=>{reads++;return new Promise(done=>{release=done;});},validate:(value:any)=>value});await reader.refresh();assert.equal(reads,0);reader.setActive(true);reader.setActive(false);release(view('own-a'));await flush();assert.equal(reader.snapshot().data,null);assert.equal(reader.snapshot().phase,'idle');reader.dispose();
});
test('temporary life read retries are bounded while the last authoritative body remains frozen',async()=>{
 let fail=false;const timers=new Map<number,{run:()=>void,delay:number}>();let sequence=0;
 const reader=createLifeReadState({read:async()=>{if(fail)throw {status:503};return view('public-fixture');},validate:(value:any)=>value,setTimer:(run:()=>void,delay:number)=>{const id=++sequence;timers.set(id,{run,delay});return id;},clearTimer:(id:number)=>timers.delete(id)});reader.setActive(true);await flush();fail=true;await reader.refresh();
 for(const delay of [2000,5000,15000]){assert.equal(timers.size,1);const [id,timer]=[...timers][0]!;assert.equal(timer.delay,delay);timers.delete(id);timer.run();await flush();}
 assert.equal(timers.size,0);assert.equal(reader.snapshot().stale,true);assert.equal(reader.snapshot().data.energy,82);reader.dispose();
});
