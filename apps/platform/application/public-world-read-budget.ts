import {performance} from 'node:perf_hooks';
import {M1Error} from '../domains/common/errors.ts';

export const PUBLIC_WORLD_PATHS=new Set(['/v1/world/startup','/v1/world/rules','/v1/world/scene']);
export class PublicWorldLimitError extends M1Error {
 readonly retryAfterSeconds:number;
 constructor(seconds=1){super('rate_limited',429,'Public observation capacity is in use');this.retryAfterSeconds=Math.min(60,Math.max(1,Math.ceil(seconds)));}
}
export class PublicWorldTokens {
 private tokens:number;private at:number;private readonly rate:number;private readonly burst:number;private readonly now:()=>number;
 constructor(rate:number,burst:number,now:()=>number=()=>performance.now()){this.rate=rate;this.burst=burst;this.now=now;this.tokens=burst;this.at=now();}
 take(){const at=this.now();this.tokens=Math.min(this.burst,this.tokens+Math.max(0,at-this.at)*this.rate/1000);this.at=Math.max(this.at,at);if(this.tokens<1)throw new PublicWorldLimitError((1-this.tokens)/this.rate);this.tokens--;}
}
/** Flat HTTP abuse accounting is separate from projection work; cookies and self-reported labels have no effect. */
export function createPublicWorldHttpBudget(now:()=>number=()=>performance.now()){
 const ips=new Map<string,{bucket:PublicWorldTokens;at:number}>();let swept=now();
 return{take(ip:string){const at=now();if(at-swept>=60_000){for(const[k,v]of ips)if(at-v.at>=60_000)ips.delete(k);swept=at;}
  let entry=ips.get(ip);if(!entry){if(ips.size>=10_000)throw new PublicWorldLimitError(60);entry={bucket:new PublicWorldTokens(10,20,now),at};ips.set(ip,entry);}entry.at=at;entry.bucket.take();},size:()=>ips.size};
}

function cancelled(){return new DOMException('Public world read cancelled','AbortError');}
export function waitPublicWorld<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return promise;if(signal.aborted)return Promise.reject(cancelled());
 return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(cancelled());},cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});promise.then(v=>{cleanup();resolve(v);},e=>{cleanup();reject(e);});});
}
/** No callback is invoked (and no DB scope acquired) while waiting in this queue. */
export function createPublicWorldDbQueue(concurrency:number){
 type Job={run:()=>void;cancel:()=>void};const queue:Job[]=[];let active=0,maximumActive=0;
 const drain=()=>{while(active<concurrency&&queue.length)queue.shift()!.run();};
 function run<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(concurrency<1)return Promise.reject(new M1Error('busy',503,'Public observation needs spare runtime pool capacity'));
  if(signal?.aborted)return Promise.reject(cancelled());if(active>=concurrency&&queue.length>=16)return Promise.reject(new PublicWorldLimitError());
  return new Promise<T>((resolve,reject)=>{
   let queued=true;const abort=()=>{if(!queued)return;const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);queued=false;signal?.removeEventListener('abort',abort);reject(cancelled());};
   const job:Job={cancel:abort,run(){if(!queued)return;queued=false;signal?.removeEventListener('abort',abort);if(signal?.aborted){reject(cancelled());return;}active++;maximumActive=Math.max(maximumActive,active);
    void(async()=>{try{resolve(await work());}catch(e){reject(e);}finally{active--;drain();}})();}};
   signal?.addEventListener('abort',abort,{once:true});queue.push(job);drain();
  });
 }
 return{run,inspect:()=>({active,queued:queue.length,maximumActive}),close(){for(const job of [...queue])job.cancel();}};
}
