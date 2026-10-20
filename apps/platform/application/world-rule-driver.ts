/** Internal world rules only. No external Agent wakeup, model, tool, HTTP call, or uncontrolled interval. */
export function createWorldRuleDriver(worker:{runDue():Promise<unknown>;close():Promise<void>},intervalMs=1000){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<100||intervalMs>60000)throw new Error('Invalid bounded world rule interval');
 let stopped=false,started=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined;
 const schedule=()=>{if(!stopped){timer=setTimeout(run,intervalMs);timer.unref();}};
 const run=()=>{timer=undefined;if(stopped)return;inFlight=(async()=>{try{await worker.runDue();}catch{/* Current persisted task/fence owns recovery. Never manufacture a replacement execution. */}finally{inFlight=undefined;schedule();}})();};
 return {start(){if(stopped||started)return;started=true;schedule();},async close(){stopped=true;if(timer)clearTimeout(timer);timer=undefined;await inFlight;await worker.close();}};
}
