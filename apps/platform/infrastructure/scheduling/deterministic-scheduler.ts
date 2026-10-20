import type { RuntimeStore, RuntimeTask, RuntimeTransaction } from '../../contracts/runtime-store.ts';
import { RuntimeError } from '../../contracts/runtime-store.ts';
import { StorageError } from '../../contracts/store.ts';

export interface DeterministicTaskHandler {
 readonly kind:string;readonly version:number;
 /** Domain-owned deterministic rules only. No external model, tools, network, or nested transaction. */
 run(context:RuntimeTransaction,task:RuntimeTask):Promise<void>;
}
export interface SchedulerOptions {
 store:RuntimeStore;workerId:string;handlers:readonly DeterministicTaskHandler[];
 leaseMs?:number;batchLimit?:number;retryBaseMs?:number;retryMaxMs?:number;
}
export interface SchedulerRun {claimed:number;completed:number;retried:number;failed:number;leaseLost:number}
function bounded(value:number,min:number,max:number){if(!Number.isSafeInteger(value)||value<min||value>max)throw new RuntimeError('invalid_usage','Invalid bounded scheduler option');return value;}
/** A manual bounded worker. Composition root owns any explicit internal polling lifecycle. */
export function createDeterministicScheduler(options:SchedulerOptions){
 const leaseMs=bounded(options.leaseMs??30000,1,300000),batchLimit=bounded(options.batchLimit??10,1,100),base=bounded(options.retryBaseMs??1000,1,60000),maximum=bounded(options.retryMaxMs??60000,base,3600000);
 if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(options.workerId))throw new RuntimeError('invalid_usage','Invalid worker identity');
 const handlers=new Map<string,DeterministicTaskHandler>();for(const handler of options.handlers){if(!/^[a-z][a-z0-9_.-]{0,127}$/.test(handler.kind)||typeof handler.run!=='function')throw new RuntimeError('invalid_usage','Invalid deterministic handler');bounded(handler.version,1,1000000);const key=handler.kind+':'+handler.version;if(handlers.has(key))throw new RuntimeError('invalid_usage','Duplicate deterministic handler');handlers.set(key,handler);}
 let stopped=false,inFlight:Promise<SchedulerRun>|undefined;
 async function execute(limit:number):Promise<SchedulerRun>{
  const result:SchedulerRun={claimed:0,completed:0,retried:0,failed:0,leaseLost:0};
  const tasks=await options.store.transaction(async ctx=>ctx.tasks.claimDue({now:ctx.now(),workerId:options.workerId,leaseMs,limit}));result.claimed=tasks.length;
  for(const task of tasks){const lease=task.lease!;
   try{
    await options.store.transaction(async ctx=>{const current=await ctx.tasks.assertLease(lease,ctx.now()),handler=handlers.get(current.kind+':'+current.handlerVersion);if(!handler)throw new RuntimeError('task_failed','Deterministic handler is not registered');await handler.run(ctx,current);await ctx.tasks.complete(lease,ctx.now());});result.completed++;
   }catch(error){
    // Unknown COMMIT is recovered from the original persisted task/receipt;
    // never replay it as a fresh operation or turn it into a failure update.
    if(error instanceof StorageError&&error.code==='unknown_commit')throw error;
    if(error instanceof RuntimeError&&error.code==='lease_lost'){result.leaseLost++;continue;}
    const errorCode=error instanceof RuntimeError?error.code:error instanceof StorageError?error.code:'handler_failed';
    try{const failed=await options.store.transaction(async ctx=>{const current=await ctx.tasks.assertLease(lease,ctx.now());await ctx.tasks.retry(lease,{now:ctx.now(),dueAt:ctx.now()+Math.min(maximum,base*2**Math.min(current.attempts-1,20)),errorCode});return current.attempts>=current.maxAttempts;});if(failed)result.failed++;else result.retried++;}
    catch(retryError){if(retryError instanceof RuntimeError&&retryError.code==='lease_lost'){result.leaseLost++;continue;}throw retryError;}
   }
  }
  return result;
 }
 return Object.freeze({
  runDue(input:{limit?:number}={}):Promise<SchedulerRun>{if(stopped)return Promise.reject(new StorageError('closed','Deterministic scheduler is stopped'));if(inFlight)return Promise.reject(new RuntimeError('invalid_usage','A scheduler run is already active'));const limit=bounded(input.limit??batchLimit,1,batchLimit),pending=execute(limit);inFlight=pending;void pending.finally(()=>{if(inFlight===pending)inFlight=undefined;}).catch(()=>{});return pending;},
  async close():Promise<void>{stopped=true;await inFlight;},
 });
}
