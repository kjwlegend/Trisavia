import {api} from './common.js';
const cancelled=()=>new DOMException('Capabilities read cancelled','AbortError');

// Share only an anonymous read that is still in flight. There is no completed
// cache: manual/visible/30-second discovery boundaries still contact the server.
export function createPublicCapabilitiesReader({request=api}={}){
 let pending=null;
 return function read({signal,headers,token}={}){
  const names=[...new Headers(headers).keys()];
  if(token||names.some(name=>!['x-world-read-build','x-world-read-reason'].includes(name)))return request('/capabilities',{signal,headers,token});
  if(signal?.aborted)return Promise.reject(cancelled());
  let job=pending;
  if(!job||job.controller.signal.aborted){
   job={controller:new AbortController(),readers:new Set(),settled:false};pending=job;
   const current=job;
   job.promise=Promise.resolve().then(()=>{if(current.controller.signal.aborted)throw cancelled();return request('/capabilities',{signal:current.controller.signal,headers});}).then(value=>{current.settled=true;return value;},error=>{current.settled=true;throw error;}).finally(()=>{if(pending===current)pending=null;});
  }
  return new Promise((resolve,reject)=>{
   const finish=()=>{signal?.removeEventListener('abort',abort);job.readers.delete(abort);if(!job.settled&&!job.readers.size){job.controller.abort();if(pending===job)pending=null;}};
   const abort=()=>{finish();reject(cancelled());};job.readers.add(abort);signal?.addEventListener('abort',abort,{once:true});
   job.promise.then(value=>{if(signal?.aborted)return;finish();resolve(structuredClone(value));},error=>{if(signal?.aborted)return;finish();reject(error);});
  });
 };
}
export const readPublicCapabilities=createPublicCapabilitiesReader();
