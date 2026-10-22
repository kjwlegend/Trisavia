import {readAppearance} from './world-scene-projection.js';
const invalid=()=>Object.assign(new Error('friends_response_invalid'),{code:'friends_response_invalid'});
export function readFriendsResponse(value,agentId){
  if(value?.agentId!==agentId||value.complete!==true||!Number.isSafeInteger(value.asOf)||value.asOf<0||!Array.isArray(value.friends))throw invalid();
  const seen=new Set();
  const friends=value.friends.map(row=>{
    const profile=row?.profile;
    if(typeof row?.agentId!=='string'||!row.agentId||row.agentId===agentId||seen.has(row.agentId)||typeof row.relationshipId!=='string'||!row.relationshipId||row.status!=='confirmed'||!Number.isSafeInteger(row.confirmedAt)||row.confirmedAt<0||typeof profile?.displayName!=='string'||!profile.displayName||!Number.isSafeInteger(profile.publishedVersion)||profile.publishedVersion<1)throw invalid();
    seen.add(row.agentId);return{agentId:row.agentId,relationshipId:row.relationshipId,status:'confirmed',confirmedAt:row.confirmedAt,profile:{displayName:profile.displayName,appearance:readAppearance(profile.appearance),publishedVersion:profile.publishedVersion}};
  });
  return{agentId,friends,complete:true,asOf:value.asOf};
}
export function createFriendsReadProvider(session){
  const listeners=new Set();let identity='',revision=0,controller=null,disposed=false,state={phase:'idle',friends:[],agentId:'',asOf:null,errorCode:null,errorStatus:null};
  const snapshot=()=>structuredClone(state);
  function emit(value){state={...state,...value};for(const listener of listeners)listener(snapshot());}
  function clear(){revision++;controller?.abort();controller=null;emit({phase:'idle',friends:[],agentId:'',asOf:null,errorCode:null,errorStatus:null});}
  const stop=session.subscribe(value=>{const key=JSON.stringify([value.authenticated,value.observationRevision,value.selectedAgentId]);if(identity===key)return;identity=key;clear();});
  async function load(){
    if(disposed)return;const context=session.snapshot(),agentId=context.selectedAgentId;
    if(!context.authenticated||!['ready','refreshing'].includes(context.phase)||!context.agents.some(row=>row.agentId===agentId)){clear();return;}
    clear();const generation=revision,active=new AbortController();controller=active;emit({phase:'loading',agentId});
    try{const data=readFriendsResponse(await session.readFriends({signal:active.signal}),agentId);if(disposed||active.signal.aborted||generation!==revision)return;emit({phase:'ready',...data,errorCode:null,errorStatus:null});}
    catch(error){if(disposed||active.signal.aborted||generation!==revision)return;emit({phase:'error',friends:[],asOf:null,errorCode:error.code||'friends_unavailable',errorStatus:error.status??null});}
    finally{if(controller===active)controller=null;}
  }
  return{snapshot,load,cancel:clear,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},dispose(){disposed=true;stop();clear();listeners.clear();}};
}
