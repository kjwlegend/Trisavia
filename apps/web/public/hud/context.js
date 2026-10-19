import {api} from '../common.js';

const validId=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f]/.test(value);
// The instance comes from the public capability view, never a guessed hostname.
// Account identity stays inside this bridge/store; no DOM event gets this scope.
export function createHudContextBridge(session,{origin=location.origin,sourceId,sourceVersion,readInstance=()=>api('/capabilities')}={}){
  let instanceId='',instancePhase='loading',state={phase:'loading',scope:null,revision:0},pending=null,readGeneration=0,disposed=false;
  const listeners=new Set(),snapshot=()=>structuredClone(state);
  function update(){
    if(disposed)return;
    let phase=instancePhase,scope=null;
    if(instancePhase==='ready'){
      const identity=session.hudContext(),owner=identity?.kind==='owner'&&validId(identity.ownerId)&&typeof identity.agentId==='string'&&(!identity.agentId||validId(identity.agentId));
      const guest=identity?.kind==='guest'&&identity.ownerId===''&&identity.agentId==='';
      if((owner||guest)&&validId(sourceId)&&validId(sourceVersion)){
        phase='ready';scope={origin,instanceId,kind:identity.kind,ownerId:identity.ownerId,agentId:identity.agentId,sourceId,sourceVersion};
      }else phase='pending';
    }
    if(JSON.stringify([phase,scope])===JSON.stringify([state.phase,state.scope]))return;
    state={phase,scope,revision:state.revision+1};for(const listener of listeners)listener(snapshot());
  }
  const unsubscribe=session.subscribe(update);
  async function load(){
    if(disposed)return;if(pending)return pending;
    const generation=++readGeneration;instancePhase='loading';update();
    pending=(async()=>{
      try{const result=await Promise.resolve().then(readInstance);if(disposed||generation!==readGeneration)return;if(!validId(result?.instanceId))throw new Error('instance_unavailable');instanceId=result.instanceId;instancePhase='ready';}
      catch{if(disposed||generation!==readGeneration)return;instanceId='';instancePhase='error';}
      finally{if(!disposed&&generation===readGeneration){pending=null;update();}}
    })();return pending;
  }
  return{
    snapshot,load,
    subscribe(listener){if(disposed)return()=>{};listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    dispose(){if(disposed)return;disposed=true;readGeneration++;unsubscribe?.();listeners.clear();state={phase:'pending',scope:null,revision:state.revision+1};},
  };
}
