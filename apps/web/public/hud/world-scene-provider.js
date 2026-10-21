import {api} from '../common.js';
import {readWorldRules,readWorldPage} from './world-scene-projection.js';
const abortError=()=>new DOMException('World read cancelled','AbortError');
const failure=code=>Object.assign(new Error(code),{code});
const temporary=error=>!['world_not_available','world_not_accessible'].includes(error.code)&&(error.status===429||error.status>=500||['network_unknown','request_timeout','busy','unavailable'].includes(error.code)||error.name==='AbortError');

// Public GETs only. Metadata is bounded, never an authority substitute for a
// current scene response; reconnect/manual/visible boundaries rediscover it.
export function createWorldSceneProvider({request=api,worldId='default',intervalMs=1000,maxPages=10,metadataTtlMs=30000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  const listeners=new Set();let revision=0,controller=null,timer=null,visible=false,started=false,disposed=false,failures=0,metadata=null,notBefore=0,retryError=null;
  let state={phase:'loading',enabled:null,worldId,rules:null,avatars:[],worldRevision:null,asOf:null,instanceId:null,complete:false,nextCursor:null,errorCode:null,errorStatus:null,lastSuccessAt:null,retryAt:null};
  const snapshot=()=>structuredClone(state);
  function emit(next){state={...state,...next};for(const listener of listeners)listener(snapshot());}
  function stop(){revision++;controller?.abort();controller=null;if(timer!==null)clearTimer(timer);timer=null;}
  function cleared(){return{rules:null,avatars:[],worldRevision:null,asOf:null,complete:false,nextCursor:null,lastSuccessAt:null};}
  const backoff=()=>Math.max(1000,intervalMs)*Math.min(30,2**Math.min(failures,5));
  const delay=()=>notBefore>now()?notBefore-now():failures?backoff():Math.max(1000,intervalMs);
  function schedule(){if(disposed||!visible||!started||state.phase==='partial')return;if(timer!==null)clearTimer(timer);timer=setTimer(()=>{timer=null;void refresh();},delay());}
  async function refresh({more=false,force=false}={}){
    if(disposed||!visible||!started||controller)return;
    if(now()<notBefore){if(state.phase==='paused')emit({phase:'error',...retryError,retryAt:notBefore});schedule();return;}
    const previous=state;let preserveAuthority=true;stop();const generation=revision,active=new AbortController();controller=active;
    const current=()=>!disposed&&visible&&generation===revision&&!active.signal.aborted;
    const read=async path=>{const result=await request(path,{signal:active.signal});if(!current())throw abortError();return result;};
    emit({phase:more?'partial':state.rules?'refreshing':'loading',errorCode:null,errorStatus:null,retryAt:null});
    try{
      if(force||failures>0||!metadata||now()>=metadata.expiresAt){
        const caps=await read('/capabilities');
        if(caps?.apiVersion!=='v1'||typeof caps.instanceId!=='string')throw failure('world_response_invalid');
        if(!caps.gateway||caps.gateway.protocolVersion!==1||caps.gateway.worldSimulation?.enabled!==true||!caps.gateway.modules?.includes('world')){emit({enabled:false});throw failure('world_not_available');}
        if(previous.instanceId&&previous.instanceId!==caps.instanceId){preserveAuthority=false;emit({phase:'loading',...cleared(),instanceId:caps.instanceId});}
        const result=await read(`/world/rules?${new URLSearchParams({worldId})}`);
        if(result?.protocolVersion!==1||result.instanceId!==caps.instanceId||!result.data)throw failure('world_response_invalid');
        const rules=readWorldRules(result.data,worldId);
        if(previous.rules&&JSON.stringify(previous.rules)!==JSON.stringify(rules)){preserveAuthority=false;emit({phase:'loading',...cleared()});}
        metadata={caps,rules,expiresAt:now()+Math.min(30000,Math.max(1000,metadataTtlMs))};
      }
      const {caps,rules}=metadata;emit({enabled:true,instanceId:caps.instanceId});
      const unwrap=result=>{if(result?.protocolVersion!==1||result.instanceId!==caps.instanceId||!result.data)throw failure('world_response_invalid');return result.data;};
      let cursor=more?previous.nextCursor:null,avatars=more?[...previous.avatars]:[],worldRevision=more?previous.worldRevision:null,asOf=more?previous.asOf:null;
      if(more&&(!cursor||JSON.stringify(rules)!==JSON.stringify(previous.rules)))throw failure('world_scene_changed');
      const seenCursors=new Set(),seenAgents=new Set(avatars.map(row=>row.agentId));let complete=false;
      for(let page=0;page<maxPages;page++){
        const query=new URLSearchParams({worldId,limit:'50'});if(cursor)query.set('cursor',cursor);
        const batch=readWorldPage(unwrap(await read(`/world/scene?${query}`)),rules);
        if(worldRevision!==null&&worldRevision!==batch.worldRevision)throw failure('world_scene_changed');
        worldRevision=batch.worldRevision;asOf=batch.asOf;
        for(const avatar of batch.avatars){if(seenAgents.has(avatar.agentId))throw failure('world_response_invalid');seenAgents.add(avatar.agentId);avatars.push(avatar);}
        complete=batch.complete;cursor=batch.nextCursor;
        if(complete)break;
        if(seenCursors.has(cursor))throw failure('world_response_invalid');seenCursors.add(cursor);
      }
      if(!current())throw abortError();
      failures=0;notBefore=0;retryError=null;emit({phase:complete?'ready':'partial',enabled:true,rules,avatars,worldRevision,asOf,instanceId:caps.instanceId,complete,nextCursor:cursor,errorCode:null,errorStatus:null,lastSuccessAt:complete?now():null,retryAt:null});
    }catch(error){
      if(!current())return;
      failures++;metadata=null;
      const serverWait=error.status===429&&Number.isFinite(error.retryAfterMs)&&error.retryAfterMs>=0?error.retryAfterMs:0;
      // One deadline gates every entry point, including manual and visible
      // recovery. Missing metadata must not turn a retry into a faster poll.
      const recoverable=temporary(error),keep=recoverable&&preserveAuthority&&previous.complete&&previous.rules;
      notBefore=recoverable?Math.max(notBefore,now()+Math.max(backoff(),serverWait)):0;
      const code=error.code||(error.name==='AbortError'?'network_unknown':'world_response_invalid');
      retryError={errorCode:code,errorStatus:error.status??null};
      emit({phase:keep?'recovering':['world_not_accessible','world_not_available'].includes(code)?'unavailable':'error',enabled:state.enabled,...(keep?{rules:previous.rules,avatars:previous.avatars,worldRevision:previous.worldRevision,asOf:previous.asOf,instanceId:previous.instanceId,complete:true,nextCursor:null,lastSuccessAt:previous.lastSuccessAt}:cleared()),errorCode:code,errorStatus:error.status??null,retryAt:now()+delay()});
    }finally{if(current()){controller=null;schedule();}}
  }
  return{snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    start(){if(disposed||started)return;started=true;if(visible)void refresh({force:true});},
    setVisible(value){value=Boolean(value);if(disposed||value===visible)return;visible=value;if(!visible){stop();metadata=null;emit({phase:'paused',...cleared(),errorCode:null,errorStatus:null});}else if(started)void refresh({force:true});},
    refresh:()=>refresh({force:true}),loadMore:()=>state.phase==='partial'?refresh({more:true}):Promise.resolve(),
    dispose(){if(disposed)return;disposed=true;stop();metadata=null;state={...state,phase:'paused',...cleared()};listeners.clear();},
  };
}
