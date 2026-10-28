import {IntlMessageFormat} from './vendor/formatjs.js';

export const SUPPORTED_LOCALES=Object.freeze(['zh-CN','en']);
const namespacePattern=/^[a-z][a-z0-9-]{0,47}$/,keyPattern=/^[A-Za-z0-9_.:\/-]{1,200}$/,descriptorTag=Symbol('i18n.message');
const localeRanks={fallback:0,browser:1,account:2,device:3,explicit:4};
const validLocale=value=>SUPPORTED_LOCALES.includes(value);
function splitKey(key){const i=typeof key==='string'?key.indexOf(':'):-1,namespace=key?.slice(0,i),name=key?.slice(i+1);if(i<1||!namespacePattern.test(namespace)||!keyPattern.test(name)||['__proto__','constructor','prototype'].includes(name))throw new TypeError('An explicit namespace:message key is required');return [namespace,name];}
function logicalPath(path){return path.replace(/^\/(?:zh-CN|en)(?=\/|$)/,'')||'/';}
export function stripLocalePath(pathname){return typeof pathname==='string'&&pathname.startsWith('/')&&!pathname.startsWith('//')?logicalPath(pathname):pathname;}
function publicPath(path){return path==='/'||/^\/(?:owner|releases|kanban)\/?$/.test(path)||/^\/residents\/[^/]+\/?$/.test(path);}
export function isMessage(value){return !!value&&value[descriptorTag]===true;}
export function msg(key,params){splitKey(key);return Object.freeze({[descriptorTag]:true,key,params});}

/** Explicit bindings only. This runtime never reads credentials, form values or arbitrary page text. */
export function createI18n({window:win=globalThis.window,document:doc=globalThis.document,navigator:nav=globalThis.navigator,storage,fetch:fetcher=globalThis.fetch,manifestUrl='/assets/i18n/manifest.json'}={}){
 let localStorage=storage;try{localStorage??=win?.localStorage;}catch{}
 const fromPath=win?.location?.pathname?.match(/^\/(zh-CN|en)(?=\/|$)/)?.[1];
 let device;try{device=localStorage?.getItem('trisavia.locale');}catch{}
 const browser=(nav?.languages??[nav?.language]).find(value=>typeof value==='string'&&/^(?:zh|en)(?:-|$)/i.test(value));
 let locale=fromPath??(validLocale(device)?device:browser?.toLowerCase().startsWith('zh')?'zh-CN':'en');
 let source=fromPath?'explicit':validLocale(device)?'device':browser?'browser':'fallback',switchGeneration=0,manifestPromise,initPromise;
 const active=new Set(),resources=new Map(),inflight=new Map(),listeners=new Set(),bindings=new WeakMap(),nodes=new Set();
 const getLocale=()=>locale,getLocaleSource=()=>source;
 const localePath=(pathname,current=locale)=>{
  if(!validLocale(current)||typeof pathname!=='string'||!pathname.startsWith('/')||pathname.startsWith('//'))return pathname;
  const match=pathname.match(/^([^?#]*)([\s\S]*)$/),path=logicalPath(match[1]);return publicPath(path)?'/'+current+(path==='/'?'/':path)+match[2]:pathname;
 };
 const missing=key=>'[missing '+key+']';
 async function jsonResponse(url,maxBytes,expected){
  const response=await fetcher(url,{credentials:'omit',cache:expected?'force-cache':'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('i18n_resource_unavailable');
  const length=Number(response.headers?.get('content-length'));if(Number.isFinite(length)&&length>maxBytes)throw new Error('i18n_resource_too_large');
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>maxBytes||expected&&bytes.length!==expected.bytes)throw new Error('i18n_resource_size_mismatch');
  if(expected){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==expected.sha256)throw new Error('i18n_resource_digest_mismatch');}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }
 async function manifest(){
  manifestPromise??=jsonResponse(manifestUrl,131072).then(value=>{
   if(value?.version!==1||!['icu-message-v1','icu-ast-v1'].includes(value.format)||!value.namespaces||typeof value.namespaces!=='object'||Array.isArray(value.namespaces)||Object.keys(value.namespaces).length>32)throw new Error('i18n_manifest_invalid');
   for(const [ns,locales]of Object.entries(value.namespaces)){
    if(!namespacePattern.test(ns)||!locales||Object.keys(locales).sort().join(',')!=='en,zh-CN')throw new Error('i18n_manifest_invalid');
    for(const language of SUPPORTED_LOCALES){const entry=locales[language];if(!entry||Object.keys(entry).sort().join(',')!=='bytes,sha256,url'||typeof entry.url!=='string'||!(entry.url.startsWith('/assets/build/')&&/^\/assets\/build\/[A-Za-z0-9_.-]+\.json$/.test(entry.url)||entry.url===`/assets/locales/${ns}/${language}.json`)||!Number.isSafeInteger(entry.bytes)||entry.bytes<2||entry.bytes>262144||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('i18n_manifest_invalid');}
   }
   return value;
  }).catch(error=>{manifestPromise=undefined;throw error;});return manifestPromise;
 }
 async function load(language,ns){
  const id=language+'/'+ns;if(resources.has(id))return resources.get(id);if(inflight.has(id))return inflight.get(id);
  const pending=(async()=>{
   const m=await manifest(),entry=m.namespaces[ns]?.[language];if(!entry)throw new Error('i18n_namespace_unavailable');
   const body=await jsonResponse(entry.url,262144,entry),messages=m.format==='icu-ast-v1'?body?.messages:body;
   if(m.format==='icu-ast-v1'&&(body.version!==1||body.locale!==language||body.namespace!==ns))throw new Error('i18n_dictionary_invalid');
   if(!messages||typeof messages!=='object'||Array.isArray(messages)||Object.keys(messages).length>4000)throw new Error('i18n_dictionary_invalid');
   const compiled=new Map();
   for(const [key,message]of Object.entries(messages)){
    if(!keyPattern.test(key)||['__proto__','constructor','prototype'].includes(key)||m.format==='icu-message-v1'&&typeof message!=='string'||m.format==='icu-ast-v1'&&!Array.isArray(message))throw new Error('i18n_dictionary_invalid');
    compiled.set(key,new IntlMessageFormat(message,language,undefined,{ignoreTag:true}));
   }
   resources.set(id,compiled);return compiled;
  })();inflight.set(id,pending);try{return await pending;}finally{inflight.delete(id);}
 }
 function t(key,params){
  let ns,name;try{[ns,name]=splitKey(key);}catch{return missing(String(key));}
  const formatter=resources.get(locale+'/'+ns)?.get(name);if(!formatter)return missing(key);
  try{const value=formatter.format(params);return typeof value==='string'?value:typeof value==='number'?String(value):missing(key);}catch{return missing(key);}
 }
 function render(node,binding){
  const [ns]=splitKey(binding.key),loaded=resources.has(locale+'/'+ns);
  // An asynchronous first load must not erase an already readable source label.
  if(!loaded&&binding.original)return;
  let params=binding.params;try{if(typeof params==='function')params=params();}catch{params=undefined;}
  let text=t(binding.key,params);
  if(text===missing(binding.key)&&binding.original)text=binding.original+' '+text;
  if(binding.attribute)node.setAttribute(binding.attribute,text);else node.textContent=text;
 }
 function renderAll(){for(const reference of nodes){const node=reference.deref();if(!node){nodes.delete(reference);continue;}for(const binding of bindings.get(node)?.values()??[])render(node,binding);}}
 async function ensureNamespaces(namespaces){
  if(!Array.isArray(namespaces)||namespaces.some(ns=>!namespacePattern.test(ns))||new Set([...active,...namespaces]).size>32)throw new TypeError('Invalid i18n namespaces');
  const current=locale;await Promise.all(namespaces.map(ns=>load(current,ns)));
  if(current!==locale)return ensureNamespaces(namespaces);
  for(const ns of namespaces)active.add(ns);renderAll();
 }
 function bind(node,attribute,key,params){
  const [ns]=splitKey(key);if(attribute&&!['placeholder','title','aria-label','alt'].includes(attribute))throw new TypeError('Unsupported translated attribute');
  let records=bindings.get(node);if(!records){records=new Map();bindings.set(node,records);nodes.add(new WeakRef(node));}
  const previous=records.get(attribute??'text'),original=previous?.key===key?previous.original:attribute?node.getAttribute(attribute):node.textContent;
  const record={attribute,key,params,original:original??''};records.set(attribute??'text',record);render(node,record);
  void ensureNamespaces([ns]).catch(()=>{});return ()=>{if(records.get(attribute??'text')===record)records.delete(attribute??'text');};
 }
 const bindText=(node,key,params)=>bind(node,null,key,params),bindAttribute=(node,attribute,key,params)=>bind(node,attribute,key,params);
 function clearBinding(node,attribute=null){bindings.get(node)?.delete(attribute??'text');}
 function applyI18n(root=doc){
  if(!root)return;const declared=[...(root.matches?.('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]')?[root]:[]),...root.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]')];
  for(const node of declared){if(node.closest?.('[data-i18n-deferred]'))continue;const key=node.getAttribute('data-i18n');if(key)bindText(node,key);for(const attr of ['placeholder','title','aria-label']){const key=node.getAttribute('data-i18n-'+attr);if(key)bindAttribute(node,attr,key);}}
 }
 function onLocaleChange(callback){listeners.add(callback);return ()=>listeners.delete(callback);}
 async function setLocale(next,{source:nextSource='explicit',persist=nextSource==='explicit',isCurrent=()=>true}={}){
  const currentRequest=()=>{try{return typeof isCurrent==='function'&&isCurrent()===true;}catch{return false;}};
  // Reject an obsolete identity before advancing the shared switch generation.
  if(!currentRequest())return false;
  if(!validLocale(next)||!['explicit','account','browser','fallback'].includes(nextSource))return false;
  if(localeRanks[nextSource]<localeRanks[source])return false;
  const generation=++switchGeneration;
  try{
   // Include namespaces registered while a switch was loading, before committing any label.
   for(;;){const wanted=[...active];await Promise.all(wanted.map(ns=>load(next,ns)));if(generation!==switchGeneration||!currentRequest())return false;if(wanted.length===active.size)break;}
  }catch{return false;}
  if(generation!==switchGeneration||!currentRequest())return false;
  if(nextSource==='explicit'&&win?.history&&win?.location){const {pathname,search='',hash=''}=win.location;try{win.history.replaceState(win.history.state,'',localePath(pathname,next)+search+hash);}catch{return false;}}
  locale=next;source=nextSource;if(doc?.documentElement)doc.documentElement.lang=locale;
  if(persist&&nextSource==='explicit')try{localStorage?.setItem('trisavia.locale',locale);}catch{}
  renderAll();for(const callback of listeners)try{callback(locale);}catch{}return true;
 }
 function initI18n({namespaces=[]}={}){
  initPromise??=ensureNamespaces(['common',...namespaces]).then(()=>{if(doc?.documentElement)doc.documentElement.lang=locale;applyI18n(doc);}).catch(error=>{initPromise=undefined;throw error;});return initPromise;
 }
 return {getLocale,getLocaleSource,initI18n,ensureNamespaces,t,msg,bindText,bindAttribute,clearBinding,applyI18n,onLocaleChange,setLocale,localePath};
}
const current=createI18n();
export const {getLocale,getLocaleSource,initI18n,ensureNamespaces,t,bindText,bindAttribute,clearBinding,applyI18n,onLocaleChange,setLocale,localePath}=current;
