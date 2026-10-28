import {validToken,ApiError} from './common.js';
import {stripLocalePath,localePath} from './i18n/core.js';
const key='connet.owner.entries.v1';
// Only this private store and the account controller receive entry capabilities.
// HUD events and route modes never contain these records.
export function createOwnerEntryStore(){
  // Public view intent survives reload; it never authorizes an Agent or request.
  function target(){const value=history.state?.accountTarget;return value&&typeof value.agentId==='string'&&value.agentId.length>=8&&value.agentId.length<=100&&(!value.ownerId||typeof value.ownerId==='string')?value:null;}
  function clearTarget(){const state={...history.state};delete state.accountTarget;history.replaceState(state,'',location.href);}
  function read(){let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{throw new ApiError('private_storage_unavailable',400);}if(!saved)return[];if(saved.origin!==location.origin||!Array.isArray(saved.entries)||saved.entries.some(item=>!['handoff','assistance'].includes(item.kind)||!validToken(item.proof)))throw new ApiError('private_storage_unavailable',400);return saved.entries;}
  function save(entries){try{const text=JSON.stringify({origin:location.origin,entries});sessionStorage.setItem(key,text);if(sessionStorage.getItem(key)!==text)throw new Error();}catch{throw new ApiError('private_storage_unavailable',400);}}
  function capture(){const raw=location.hash,params=new URLSearchParams(raw.slice(1)),handoff=params.get('handoff'),assistance=params.get('assistance'),path=stripLocalePath(location.pathname),locale=path!==location.pathname?location.pathname.split('/')[1]:null;let mode=path==='/owner'?'account':'';let agentId='';
    if(handoff&&assistance)throw new ApiError('invalid_request',400);
    const proof=handoff||assistance;
    if(proof){if(!validToken(proof))throw new ApiError('authentication_failed',401);const item={kind:handoff?'handoff':'assistance',proof},entries=read();if(!entries.some(old=>old.kind===item.kind&&old.proof===proof))entries.push(item);save(entries);mode='account';}
    else if(raw==='#register')mode='register';else if(raw==='#login')mode='login';else if(params.get('agent')){mode='profile';agentId=params.get('agent');}else if(raw==='#account'){const previous=target();mode=previous?'profile':'account';agentId=previous?.agentId||'';}
    if(mode){const previous=target(),state=agentId?{accountTarget:params.get('agent')?{agentId}:previous}:null;history.replaceState(state,'',`${locale?localePath('/',locale):'/'}#${mode==='register'?'register':mode==='login'?'login':'account'}`);}
    return{mode,agentId};
  }
  return{capture,peek:()=>read()[0]||null,target,clearTarget,rememberTarget(ownerId,agentId){history.replaceState({...history.state,accountTarget:{ownerId,agentId}},'',location.href);},retain(item){if(!['handoff','assistance'].includes(item.kind)||!validToken(item.proof))throw new ApiError('invalid_request',400);const entries=read();if(!entries.some(old=>old.kind===item.kind&&old.proof===item.proof))save([...entries,item]);},consume(item){const entries=read();if(entries[0]?.kind===item.kind&&entries[0]?.proof===item.proof)save(entries.slice(1));},get pending(){return read().length>0;},clear(){try{sessionStorage.removeItem(key);}catch{}try{clearTarget();}catch{}}};
}
