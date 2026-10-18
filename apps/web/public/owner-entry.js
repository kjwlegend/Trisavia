import {validToken,ApiError} from './common.js';
const key='connet.owner.entries.v1';
// Only this private store and the account controller receive entry capabilities.
// HUD events and route modes never contain these records.
export function createOwnerEntryStore(){
  function read(){let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{throw new ApiError('private_storage_unavailable',400);}if(!saved)return[];if(saved.origin!==location.origin||!Array.isArray(saved.entries)||saved.entries.some(item=>!['handoff','assistance'].includes(item.kind)||!validToken(item.proof)))throw new ApiError('private_storage_unavailable',400);return saved.entries;}
  function save(entries){try{const text=JSON.stringify({origin:location.origin,entries});sessionStorage.setItem(key,text);if(sessionStorage.getItem(key)!==text)throw new Error();}catch{throw new ApiError('private_storage_unavailable',400);}}
  function capture(){const raw=location.hash,params=new URLSearchParams(raw.slice(1)),handoff=params.get('handoff'),assistance=params.get('assistance');let mode=location.pathname==='/owner'?'account':'';let agentId='';
    if(handoff&&assistance)throw new ApiError('invalid_request',400);
    const proof=handoff||assistance;
    if(proof){if(!validToken(proof))throw new ApiError('authentication_failed',401);const item={kind:handoff?'handoff':'assistance',proof},entries=read();if(!entries.some(old=>old.kind===item.kind&&old.proof===proof))entries.push(item);save(entries);mode='account';}
    else if(raw==='#register')mode='register';else if(raw==='#login')mode='login';else if(raw==='#account')mode='account';else if(params.get('agent')){mode='profile';agentId=params.get('agent');}
    if(mode)history.replaceState(null,'',`/#${mode==='register'?'register':mode==='login'?'login':'account'}`);
    return{mode,agentId};
  }
  return{capture,peek:()=>read()[0]||null,retain(item){if(!['handoff','assistance'].includes(item.kind)||!validToken(item.proof))throw new ApiError('invalid_request',400);const entries=read();if(!entries.some(old=>old.kind===item.kind&&old.proof===item.proof))save([...entries,item]);},consume(item){const entries=read();if(entries[0]?.kind===item.kind&&entries[0]?.proof===item.proof)save(entries.slice(1));},get pending(){return read().length>0;},clear(){try{sessionStorage.removeItem(key);}catch{}}};
}
