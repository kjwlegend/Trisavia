import {getLocale,getLocaleSource,onLocaleChange,setLocale} from './i18n/core.js';
import {id,isUnknown} from './common.js';
import {accountElement as el,accountMessage,accountText} from './owner-i18n.js';

const locales=['zh-CN','en'],positive=value=>Number.isSafeInteger(value)&&value>0;
const validView=(value,ownerId)=>value?.ownerId===ownerId&&(value.uiLocale===null||locales.includes(value.uiLocale))&&positive(value.version)&&(value.updatedAt===null||Number.isSafeInteger(value.updatedAt)&&value.updatedAt>=0)&&Number.isSafeInteger(value.asOf)&&value.asOf>=0;

// Account preference is a human display setting. Device/browser discovery never
// writes it. A pending explicit write keeps one owner, operation and payload.
export function createOwnerLocaleSync({context,request,storage=globalThis.sessionStorage,origin=globalThis.location?.origin,locale={getLocale,getLocaleSource,onLocaleChange,setLocale},operationId=id,onStatus=()=>{},onExpired=()=>{}}){
 let identity='',generation=0,record=null,pending=null,intent=null,work=Promise.resolve(),disposed=false,phase='idle';
 const key=ownerId=>'connet.owner.ui-preference.v1:'+JSON.stringify([origin,ownerId]);
 const current=(c,turn)=>!disposed&&turn===generation&&context().authenticated===true&&context().ownerId===c.ownerId&&context().sessionToken===c.sessionToken;
 const status=value=>{phase=value;onStatus({phase,uiLocale:record?.uiLocale??null,canRetry:['pending','error','conflict'].includes(value)});};
 function savePending(c,value){const text=JSON.stringify(value);storage.setItem(key(c.ownerId),text);if(storage.getItem(key(c.ownerId))!==text)throw Error('private_storage_unavailable');pending=value;}
 function clearPending(c){storage.removeItem(key(c.ownerId));pending=null;}
 function readPending(c){const value=JSON.parse(storage.getItem(key(c.ownerId))||'null');if(!value)return null;if(value.ownerId!==c.ownerId||typeof value.operationId!=='string'||!/^[A-Za-z0-9_.:-]{8,100}$/.test(value.operationId)||!positive(value.expectedVersion)||!locales.includes(value.uiLocale)||Object.keys(value).sort().join(',')!=='expectedVersion,operationId,ownerId,uiLocale')throw Error('private_storage_unavailable');return value;}
 async function call(c,turn,path,options={}){try{const value=await request(path,{...options,token:c.sessionToken});if(!current(c,turn))throw new DOMException('Account changed','AbortError');return value;}catch(error){if(current(c,turn)&&error.status===401)onExpired(c);throw error;}}
 async function load(c,turn){status('loading');const value=await call(c,turn,'/owner/ui-preferences');if(!validView(value,c.ownerId))throw Error('ui_preferences_response_invalid');record=value;if(value.uiLocale)await locale.setLocale(value.uiLocale,{source:'account',persist:false,isCurrent:()=>current(c,turn)});if(current(c,turn))status('ready');}
 function accept(c,value,original){if(!validView(value,c.ownerId)||value.operationId!==original.operationId||value.outcome!=='committed'||value.uiLocale!==original.uiLocale||typeof value.receiptId!=='string'||!value.receiptId||typeof value.changed!=='boolean')throw Error('ui_preferences_response_invalid');record=value;clearPending(c);status('ready');}
 async function receipt(c,turn,original){const query=new URLSearchParams({scope:'owner:'+c.ownerId,action:'saveUiPreferences'});return call(c,turn,`/operations/${encodeURIComponent(original.operationId)}?${query}`);}
 async function submit(c,turn,original){status('saving');try{accept(c,await call(c,turn,'/owner/ui-preferences',{method:'POST',body:{operationId:original.operationId,expectedVersion:original.expectedVersion,uiLocale:original.uiLocale}}),original);}catch(error){if(!current(c,turn))return;if(isUnknown(error)||error.message==='ui_preferences_response_invalid'){try{accept(c,await receipt(c,turn,original),original);return;}catch{if(current(c,turn))status('pending');}return;}clearPending(c);intent=null;record=null;status(error.status===409?'conflict':'error');}}
 async function persist(c,turn){if(pending){status('pending');return;}if(!intent)return;if(!record)await load(c,turn);if(!current(c,turn)||!intent)return;const chosen=intent;intent=null;const original={ownerId:c.ownerId,operationId:operationId(),expectedVersion:record.version,uiLocale:chosen};savePending(c,original);await submit(c,turn,original);if(current(c,turn)&&intent&&!pending)await persist(c,turn);}
 async function recover(c,turn,resubmit){const original=pending;if(!original)return load(c,turn);try{accept(c,await receipt(c,turn,original),original);}catch(error){if(!current(c,turn))return;if(error.status===404&&resubmit)await submit(c,turn,original);else status('pending');}if(current(c,turn)&&intent&&!pending)await persist(c,turn);}
 function enqueue(fn){const c=context(),turn=generation;work=work.catch(()=>{}).then(async()=>{if(!current(c,turn))return;try{await fn(c,turn);}catch(error){if(current(c,turn))status(pending?'pending':'error');}});return work;}
 function syncContext(){const c=context(),next=c.authenticated?JSON.stringify([c.ownerId,c.sessionToken]):'';if(next===identity)return work;identity=next;generation++;record=null;pending=null;intent=null;work=Promise.resolve();if(!next){status('idle');return work;}try{pending=readPending(c);}catch{status('error');return work;}return enqueue((c,turn)=>pending?recover(c,turn,false):load(c,turn));}
 const stop=locale.onLocaleChange(()=>{const c=context();if(!c.authenticated||locale.getLocaleSource()!=='explicit')return;intent=locale.getLocale();void enqueue(persist);});
 return{syncContext,retry:()=>enqueue((c,turn)=>pending?recover(c,turn,true):load(c,turn)),settled:()=>work,snapshot:()=>({phase,pending:pending?{...pending}:null}),dispose(){disposed=true;generation++;stop();}};
}

export function mountOwnerLocalePreferences(node,options){
 const status=el('p','small-text'),retry=el('button','text-button',accountMessage('preferences.retry'));retry.type='button';retry.hidden=true;node?.append(el('h3','',accountMessage('preferences.title')),status,retry);
 const service=createOwnerLocaleSync({...options,onStatus(value){retry.hidden=!value.canRetry;retry.disabled=['loading','saving'].includes(value.phase);accountText(status,value.phase==='idle'?'':value.phase==='ready'&&value.uiLocale===null?accountMessage('common:state.notRecorded'):accountMessage(({loading:'preferences.loading',ready:'preferences.saved',saving:'common:state.saving',pending:'preferences.pending',conflict:'preferences.conflict',error:'preferences.unavailable'})[value.phase]));options.onStatus?.(value);}});retry.addEventListener('click',()=>void service.retry());return service;
}
