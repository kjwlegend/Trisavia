import {readPublicId} from '../public-id.js';
import {api} from '../common.js';
import {readAppearance} from './world-scene-projection.js';
const invalid=()=>Object.assign(new Error('public_profile_invalid'),{code:'public_profile_invalid'});
export function readPublicCharacter(value,agentId,expectedVersion){
  const profile=value?.profile;
  if(typeof value?.agentId!=='string'||!value.agentId||(readPublicId(agentId)?value?.publicId!==agentId:value?.agentId!==agentId)||value.membership?.state!=='joined'||!Number.isSafeInteger(value.publishedVersion)||value.publishedVersion<expectedVersion||typeof profile?.displayName!=='string'||!profile.displayName.trim()||profile.displayName.length>60||profile.bio!==undefined&&(typeof profile.bio!=='string'||profile.bio.length>500)||profile.interests!==undefined&&(!Array.isArray(profile.interests)||profile.interests.length>10||profile.interests.some(text=>typeof text!=='string'||text.length>40)))throw invalid();
  return{agentId:value.agentId,publicId:readPublicId(value.publicId),publishedVersion:value.publishedVersion,displayName:profile.displayName,bio:profile.bio||'',interests:[...(profile.interests||[])],appearance:readAppearance(value.appearance??profile.avatar)};
}
// One selected public identity only. Movement polls update scene facts without
// re-reading or rebuilding a profile whose publication version has not changed.
export function createPublicCharacterReader({request=api}={}){
  const listeners=new Set();let revision=0,controller=null,current=null,requestedVersion=0,disposed=false,state={phase:'idle',scene:null,data:null,errorStatus:null};
  const snapshot=()=>structuredClone(state);
  function emit(value){state={...state,...value};for(const listener of listeners)listener(snapshot());}
  function cancel(){revision++;controller?.abort();controller=null;}
  async function select(scene,force=false){
    if(disposed)return;const same=current?.agentId===scene.agentId,version=scene.profile.publishedVersion;current=structuredClone(scene);
    if(same&&!force&&version<=Math.max(requestedVersion,state.data?.publishedVersion||0)){emit({scene:current});return;}
    cancel();requestedVersion=version;const generation=revision,active=new AbortController();controller=active;emit({phase:'loading',scene:current,data:null,errorStatus:null});
    try{const data=readPublicCharacter(await request(`/public/agents/${encodeURIComponent(scene.agentId)}`,{signal:active.signal}),scene.agentId,version);if(disposed||active.signal.aborted||generation!==revision)return;emit({phase:'ready',data,errorStatus:null});}
    catch(error){if(disposed||active.signal.aborted||generation!==revision)return;emit({phase:'error',data:null,errorStatus:error.status??null});}
    finally{if(controller===active)controller=null;}
  }
  return{snapshot,open:scene=>select(scene,true),observe:scene=>select(scene),retry:()=>current?select(current,true):Promise.resolve(),clear(){cancel();current=null;requestedVersion=0;emit({phase:'idle',scene:null,data:null,errorStatus:null});},subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},dispose(){disposed=true;cancel();current=null;listeners.clear();}};
}
