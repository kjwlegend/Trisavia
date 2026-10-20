import {api} from '../common.js';
import {readWorldRules,readWorldPage} from './world-scene-projection.js';
const abortError=()=>new DOMException('World read cancelled','AbortError');
const failure=code=>Object.assign(new Error(code),{code});

// Only public GETs. This reader never receives Owner or Agent credentials.
export function createWorldSceneProvider({request=api,worldId='default',intervalMs=1000,maxPages=10,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  const listeners=new Set();let revision=0,controller=null,timer=null,visible=false,started=false,disposed=false,failures=0;
  let state={phase:'loading',enabled:null,worldId,rules:null,avatars:[],worldRevision:null,asOf:null,complete:false,nextCursor:null,errorCode:null};
  const snapshot=()=>structuredClone(state);
  function emit(next){state={...state,...next};for(const listener of listeners)listener(snapshot());}
  function stop(){revision++;controller?.abort();controller=null;if(timer!==null)clearTimer(timer);timer=null;}
  function cleared(){return{rules:null,avatars:[],worldRevision:null,asOf:null,complete:false,nextCursor:null};}
  function schedule(){if(disposed||!visible||!started||state.phase==='demo'||state.phase==='partial')return;timer=setTimer(()=>{timer=null;void refresh();},Math.max(1000,intervalMs)*Math.min(30,2**Math.min(failures,5)));}
  async function refresh({more=false}={}){
    if(disposed||!visible||!started)return;
    const previous=state;stop();const generation=revision,active=new AbortController();controller=active;
    const current=()=>!disposed&&visible&&generation===revision&&!active.signal.aborted;
    const read=async path=>{const result=await request(path,{signal:active.signal});if(!current())throw abortError();return result;};
    emit({phase:more?'partial':state.rules?'refreshing':'loading',errorCode:null});
    try{
      const caps=await read('/capabilities');
      if(caps?.apiVersion!=='v1'||typeof caps.instanceId!=='string')throw failure('world_response_invalid');
      if(!caps.gateway){failures=0;emit({phase:'demo',enabled:false,...cleared()});return;}
      if(caps.gateway.protocolVersion!==1||caps.worldSimulation?.enabled!==true||!caps.gateway.modules?.includes('world'))throw failure('world_not_available');
      emit({enabled:true});
      const unwrap=result=>{if(result?.protocolVersion!==1||result.instanceId!==caps.instanceId||!result.data)throw failure('world_response_invalid');return result.data;};
      const rules=readWorldRules(unwrap(await read(`/world/rules?${new URLSearchParams({worldId})}`)),worldId);
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
      failures=0;emit({phase:complete?'ready':'partial',enabled:true,rules,avatars,worldRevision,asOf,complete,nextCursor:cursor,errorCode:null});
    }catch(error){
      if(!current()||error.name==='AbortError')return;
      failures++;emit({phase:['world_not_accessible','world_not_available'].includes(error.code)?'unavailable':'error',enabled:state.enabled,errorCode:error.code||'network_unknown',...cleared()});
    }finally{if(current()){controller=null;schedule();}}
  }
  return{snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    start(){if(disposed||started)return;started=true;if(visible)void refresh();},
    setVisible(value){value=Boolean(value);if(disposed||value===visible)return;visible=value;if(!visible){stop();emit({phase:'paused',...cleared()});}else if(started)void refresh();},
    refresh:()=>refresh(),loadMore:()=>state.phase==='partial'?refresh({more:true}):Promise.resolve(),
    dispose(){if(disposed)return;disposed=true;stop();state={...state,phase:'paused',...cleared()};listeners.clear();},
  };
}
