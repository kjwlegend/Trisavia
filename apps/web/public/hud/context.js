import {readPublicCapabilities} from '../public-capabilities.js';

const validId=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f]/.test(value);
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}
// The instance comes from the public capability view, never a guessed hostname.
// Account identity stays inside this bridge/store; no DOM event gets this scope.
export function createHudContextBridge(session,{origin=location.origin,sourceId,sourceVersion,readInstance=readPublicCapabilities,storage=browserStorage(),newVisitorId=()=>crypto.randomUUID()}={}){
  let instanceId='',instancePhase='loading',state={phase:'loading',scope:null,revision:0,persistent:true},pending=null,readAbort=null,readGeneration=0,disposed=false,visitorId='',visitorPersistent=false;
  const listeners=new Set(),snapshot=()=>structuredClone(state);
  function update(){
    if(disposed)return;
    let phase=instancePhase,scope=null,persistent=true;
    if(instancePhase==='ready'){
      const identity=session.hudContext(),owner=identity?.kind==='owner'&&validId(identity.ownerId)&&typeof identity.agentId==='string'&&(!identity.agentId||validId(identity.agentId));
      const guest=identity?.kind==='guest'&&identity.ownerId===''&&identity.agentId==='';
      if((owner||guest)&&validId(sourceId)&&validId(sourceVersion)){
        phase='ready';scope={origin,instanceId,kind:identity.kind,ownerId:identity.ownerId,agentId:identity.agentId,sourceId,sourceVersion};
        if(guest){if(!visitorId){try{const saved=storage?.getItem('connet.hud.demo.visitor.v1');visitorId=validId(saved)?saved:newVisitorId();if(!validId(visitorId))throw new Error('visitor_unavailable');storage?.setItem('connet.hud.demo.visitor.v1',visitorId);visitorPersistent=Boolean(storage);}catch{visitorId=visitorId||newVisitorId();visitorPersistent=false;}}scope.visitorId=visitorId;persistent=visitorPersistent;}
      }else phase='pending';
    }
    if(JSON.stringify([phase,scope,persistent])===JSON.stringify([state.phase,state.scope,state.persistent]))return;
    state={phase,scope,revision:state.revision+1,persistent};for(const listener of listeners)listener(snapshot());
  }
  const unsubscribe=session.subscribe(update);
  async function load(){
    if(disposed)return;if(pending)return pending;
    const generation=++readGeneration,active=new AbortController();readAbort=active;instancePhase='loading';update();
    pending=(async()=>{
      try{const result=await Promise.resolve().then(()=>readInstance({signal:active.signal}));if(disposed||generation!==readGeneration)return;if(!validId(result?.instanceId))throw new Error('instance_unavailable');instanceId=result.instanceId;instancePhase='ready';}
      catch{if(disposed||generation!==readGeneration)return;instanceId='';instancePhase='error';}
      finally{if(!disposed&&generation===readGeneration){pending=null;readAbort=null;update();}}
    })();return pending;
  }
  return{
    snapshot,load,
    subscribe(listener){if(disposed)return()=>{};listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    dispose(){if(disposed)return;disposed=true;readGeneration++;readAbort?.abort();unsubscribe?.();listeners.clear();state={phase:'pending',scope:null,revision:state.revision+1,persistent:true};},
  };
}
