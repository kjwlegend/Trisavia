import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {StorageError,type JsonObject} from '../contracts/store.ts';
import type {RuntimeReadContext,RuntimeStore} from '../contracts/runtime-store.ts';
import {PUBLIC_WORLD_READ_REVISION,publicWorldReadPool,type PublicWorldReadCut} from '../domains/world/public-read-revision.ts';
import {createPublicWorldDbQueue,PublicWorldLimitError,PublicWorldTokens,waitPublicWorld} from './public-world-read-budget.ts';

export interface PublicWorldBundle {instanceId:string;asOf:number;results:Record<string,JsonObject>}
export interface PublicWorldRequest {id:string;input:JsonObject}
type Artifact={cut:PublicWorldReadCut;value:PublicWorldBundle;expires:number;expressionExpiresAt:number|null;bytes:number};
type Flight={users:number;controller:AbortController;promise:Promise<{owner:symbol;artifact?:Artifact;closed?:true}>};
type Projection=(ctx:RuntimeReadContext,requests:readonly PublicWorldRequest[])=>Promise<PublicWorldBundle>;
const status=new WeakMap<RuntimeStore,()=>unknown>();
/** Internal engineering observation only, never a discovery operation or response field. */
export function publicWorldReadStatus(store:RuntimeStore){return status.get(store)?.();}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function lifespan(value:PublicWorldBundle,started:number){
 const scene=value.results['world.public_scene'],expressions=scene?.expressions;
 if(!scene||!Object.hasOwn(scene,'expressions'))return{expires:started+250,expressionExpiresAt:null};
 if(!Array.isArray(expressions)||expressions.length>16||Buffer.byteLength(JSON.stringify(expressions))>8192||typeof scene.asOf!=='number'||!Number.isSafeInteger(scene.asOf))throw new StorageError('invalid_usage','Invalid public expression expiration source');
 let earliest=Infinity;
 for(const expression of expressions){if(!expression||typeof expression!=='object'||Array.isArray(expression)||typeof expression.expiresAt!=='number'||!Number.isSafeInteger(expression.expiresAt))throw new StorageError('invalid_usage','Invalid public expression expiration source');earliest=Math.min(earliest,expression.expiresAt);}
 // Count the entire build against both lifetimes; reading the same expression never renews it.
 return{expires:started+Math.min(250,Math.max(0,earliest-scene.asOf)),expressionExpiresAt:earliest===Infinity?null:earliest};
}

/** Public data only. All queue/singleflight waits happen outside store.read and pool checkout. */
export function createPublicWorldReader(store:RuntimeStore,catalogRevision:string,project:Projection,now:()=>number=()=>performance.now()){
 const limits=publicWorldReadPool(store);if(!limits)return;
 const db=createPublicWorldDbQueue(limits.publicConcurrency),work=new PublicWorldTokens(10,10,now),cache=new Map<string,Artifact>(),flights=new Map<string,Flight>();
 let clients=0,cacheBytes=0,hits=0,builds=0,probes=0,closed=false;
 const stats=()=>({...limits,...db.inspect(),clients,cacheEntries:cache.size,cacheBytes,flights:flights.size,hits,builds,probes});status.set(store,stats);
 const live=(entry:Artifact,serverNow:number)=>entry.expires>now()&&(entry.expressionExpiresAt===null||entry.expressionExpiresAt>serverNow);
 function prune(serverNow?:number){const at=now();for(const[k,v]of cache)if(v.expires<=at||serverNow!==undefined&&v.expressionExpiresAt!==null&&v.expressionExpiresAt<=serverNow){cache.delete(k);cacheBytes-=v.bytes;}}
 const queryKey=(requests:readonly PublicWorldRequest[])=>hash({instanceId:store.instanceId,recoveryEpoch:store.recoveryEpoch,catalogRevision,requests});
 const cacheKey=(query:string,cut:PublicWorldReadCut)=>query+':'+cut.writeGeneration;
 const same=(a:PublicWorldReadCut,b:PublicWorldReadCut)=>a.instanceId===b.instanceId&&a.recoveryEpoch===b.recoveryEpoch&&a.writeGeneration===b.writeGeneration&&a.writeGate&&b.writeGate;
 async function cut(ctx:RuntimeReadContext){const v=await ctx.repository(PUBLIC_WORLD_READ_REVISION).read();if(v.instanceId!==store.instanceId||v.recoveryEpoch!==store.recoveryEpoch)throw new StorageError('conflict','Public world identity changed');return v;}
 function find(query:string,v:PublicWorldReadCut,serverNow:number){prune(serverNow);const entry=cache.get(cacheKey(query,v));return entry&&live(entry,serverNow)&&same(v,entry.cut)?entry:undefined;}
 function remember(query:string,entry:Artifact){if(closed||entry.bytes>1_048_576||entry.expires<=now())return;prune();const key=cacheKey(query,entry.cut),old=cache.get(key);if(old){cacheBytes-=old.bytes;cache.delete(key);}
  while(cache.size>=16||cacheBytes+entry.bytes>8*1_048_576){const oldest=cache.keys().next().value;if(oldest===undefined)break;cacheBytes-=cache.get(oldest)!.bytes;cache.delete(oldest);}cache.set(key,entry);cacheBytes+=entry.bytes;
 }
 async function probe(requests:readonly PublicWorldRequest[],query:string,signal?:AbortSignal,candidate?:Artifact){
  return db.run(()=>store.read(async ctx=>{probes++;const v=await cut(ctx);
   if(!v.writeGate){cache.clear();cacheBytes=0;return{fresh:true as const};}
   const rulesAlias=requests.length===1&&requests[0]!.id==='world.public_rules'?queryKey([{id:'world.public_rules',input:{worldId:requests[0]!.input.worldId!}},{id:'world.public_scene',input:{worldId:requests[0]!.input.worldId!,limit:50}}]):undefined;
   const serverNow=ctx.now(),entry=candidate&&live(candidate,serverNow)&&same(v,candidate.cut)?candidate:find(query,v,serverNow)??(rulesAlias?find(rulesAlias,v,serverNow):undefined);
   if(entry){hits++;return{value:structuredClone(entry.value)};}return{};
  }),signal);
 }
 async function build(requests:readonly PublicWorldRequest[],query:string,owner:symbol,signal?:AbortSignal){
  if(signal?.aborted)throw new DOMException('Public world read cancelled','AbortError');
  let flight=flights.get(query);
  if(!flight){if(flights.size>=18)throw new PublicWorldLimitError();const controller=new AbortController();
   const promise=db.run(async()=>{work.take();const started=now();const result=await store.read(async ctx=>{const v=await cut(ctx);if(!v.writeGate)return{owner,closed:true as const};
     builds++;const value=await project(ctx,requests),bytes=Buffer.byteLength(JSON.stringify(value));return{owner,artifact:{cut:v,value,bytes,...lifespan(value,started)}};
    });if('artifact'in result&&result.artifact)remember(query,result.artifact);return result;
   },controller.signal).finally(()=>{if(flights.get(query)?.controller===controller)flights.delete(query);});
   flight={users:0,controller,promise};flights.set(query,flight);void promise.catch(()=>{});
  }
  flight.users++;try{return await waitPublicWorld(flight.promise,signal);}finally{flight.users--;if(flight.users===0)flight.controller.abort();}
 }
 async function fresh(requests:readonly PublicWorldRequest[],signal?:AbortSignal){return db.run(async()=>{work.take();return store.read(async ctx=>{await cut(ctx);builds++;return project(ctx,requests);});},signal);}
 return{async read(requests:readonly PublicWorldRequest[],signal?:AbortSignal):Promise<PublicWorldBundle>{
   if(closed)throw new StorageError('closed','Public observation is closing');if(clients>=64)throw new PublicWorldLimitError();clients++;const owner=Symbol(),query=queryKey(requests);
   try{for(let round=0;round<2;round++){
    const initial=await probe(requests,query,signal);if(initial.fresh)return await fresh(requests,signal);if(initial.value)return initial.value;
    const result=await build(requests,query,owner,signal);if(result.closed)continue;
    const entry=result.artifact!;
    // The leader owns this native guarded read. Large/slow results are never retained as completed cache entries.
    if(result.owner===owner)return structuredClone(entry.value);
    if(entry.bytes>1_048_576)return await fresh(requests,signal);
    const verified=await probe(requests,query,signal,entry);if(verified.fresh)return await fresh(requests,signal);if(verified.value)return verified.value;
   }throw new StorageError('busy','The current public world changed during bounded observation');
   }finally{clients--;}
  },inspect:stats,close(){closed=true;cache.clear();cacheBytes=0;for(const v of flights.values())v.controller.abort();db.close();}};
}
