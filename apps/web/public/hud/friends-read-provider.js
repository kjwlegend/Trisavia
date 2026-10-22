import {createFriendshipSource,readFriendshipResponse} from './friendship-source.js';
export const readFriendsResponse=(value,agentId)=>readFriendshipResponse(value,'friends',agentId);
export function createFriendsReadProvider(session){
 const source=createFriendshipSource(session,{view:'friends'}),listeners=new Set();let active=false,state={phase:'idle',friends:[],agentId:'',asOf:null,complete:false,nextCursor:null,errorCode:null,errorStatus:null};
 const snapshot=()=>structuredClone(state),stop=source.subscribe(value=>{state={phase:value.phase,friends:value.data?.friends||[],agentId:value.data?.agentId||'',asOf:value.data?.asOf??null,complete:value.data?.complete??false,nextCursor:value.data?.nextCursor??null,errorCode:value.error?.code??null,errorStatus:value.error?.status??null};for(const listener of listeners)listener(snapshot());});
 return{snapshot,load(){if(!active){active=true;return source.setActive(true);}return source.load();},loadMore:()=>source.loadMore(),cancel(){active=false;source.setActive(false);},subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},dispose(){stop();source.dispose();listeners.clear();}};
}
