// Shared read lifecycle for the life catalog and one currently authorized actor.
// The transport and exact DTO validator are supplied by the life contract adapter.
const temporary=error=>['network_unknown','request_timeout'].includes(error?.code)||error?.status>=500||error?.status===429;
export function createLifeReadState({read,validate,session=null,privateScope=false,refreshMs=15000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,eventTarget=globalThis.document}={}){
 const listeners=new Set();let context=session?.snapshot(),active=false,disposed=false,revision=0,request=null,timer=null,failures=0,instanceId=null;
 let state={phase:'idle',data:null,stale:false,lastSuccessAt:null,errorStatus:null,errorCode:''};
 const snapshot=()=>structuredClone(state),emit=patch=>{state={...state,...patch};for(const listener of listeners)listener(snapshot());};
 const identity=()=>JSON.stringify([context?.observationRevision,context?.selectedAgentId,context?.authenticated]);let currentIdentity=identity();
 const allowed=()=>!privateScope||Boolean(context?.authenticated&&['ready','refreshing'].includes(context.phase)&&context.selectedAgentId&&context.agents?.some(agent=>agent.agentId===context.selectedAgentId));
 const visible=()=>active&&!disposed&&!eventTarget?.hidden;
 function stop(){revision++;request?.abort();request=null;if(timer!==null)clearTimer(timer);timer=null;}
 function clear(phase='idle'){stop();failures=0;instanceId=null;emit({phase,data:null,stale:false,lastSuccessAt:null,errorStatus:null,errorCode:''});}
 function schedule(delay){if(visible()&&allowed()&&refreshMs>0)timer=setTimer(()=>{timer=null;void load();},delay);}
 async function load(){
  if(!visible())return;if(!allowed()){clear(context?.authenticated?'no_agent':'session');return;}
  stop();const turn=revision,controller=new AbortController(),target=privateScope?context.selectedAgentId:null,previous=state.data;request=controller;emit({phase:previous?'refreshing':'loading',errorStatus:null,errorCode:''});
  try{
   const raw=await read({agentId:target,signal:controller.signal});if(!visible()||turn!==revision||controller.signal.aborted)return;
   const accepted=validate(raw,target);if(!accepted||typeof accepted.instanceId!=='string'||!accepted.instanceId)throw Object.assign(Error('life_response_invalid'),{code:'life_response_invalid'});
   if(instanceId!==null&&instanceId!==accepted.instanceId){clear('changed');return;}
   instanceId=accepted.instanceId;failures=0;emit({phase:'ready',data:structuredClone(accepted.data),stale:false,lastSuccessAt:now(),errorStatus:null,errorCode:''});schedule(refreshMs);
  }catch(error){
   if(!visible()||turn!==revision||controller.signal.aborted)return;
   const denied=[401,403,404].includes(error.status),retryable=!denied&&temporary(error),retain=Boolean(previous)&&retryable;failures++;
   emit({phase:denied?'forbidden':retain?'recovering':'error',data:retain?previous:null,stale:retain,lastSuccessAt:retain?state.lastSuccessAt:null,errorStatus:error.status??null,errorCode:error.code||'life_read_failed'});
   if(retryable&&failures<=3)schedule([2000,5000,15000][failures-1]);
  }finally{if(request===controller)request=null;}
 }
 const stopSession=session?.subscribe(value=>{context=value;const next=identity();if(currentIdentity===next)return;currentIdentity=next;clear(allowed()?'idle':value.authenticated?'no_agent':'session');if(visible())void load();});
 const visibility=()=>{if(eventTarget.hidden){stop();if(state.data)emit({phase:'paused',stale:true});}else if(active)void load();};eventTarget?.addEventListener('visibilitychange',visibility);
 return{snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},setActive(value){value=Boolean(value);if(value===active||disposed)return;active=value;clear(allowed()?'idle':context?.authenticated?'no_agent':'session');if(active)void load();},refresh:load,dispose(){if(disposed)return;disposed=true;active=false;clear();stopSession?.();eventTarget?.removeEventListener('visibilitychange',visibility);listeners.clear();}};
}
