import {ensureNamespaces,t,bindText,clearBinding,getLocale,onLocaleChange} from '../i18n/core.js';

// These are translation-source indices, not world facts or permission caches.
const indices={
 'world-content':'42aadf4806807d43227516f1ebd95c7e179c7ef1ab76eb4e6ef32ecea939a6d9',
 'life-content':'343d4d95a480f3db5471bc185ab2a8a0bd4d200da069df96a258714e2183f793',
};
const pending=new Map();
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const at=(value,path)=>path.split('.').reduce((v,key)=>v!==null&&typeof v==='object'&&Object.hasOwn(v,key)?v[key]:undefined,value);
const same=(a={},b={})=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
async function sourceIndex(namespace){
 if(!Object.hasOwn(indices,namespace))throw Error('official_content_namespace_invalid');
 if(!pending.has(namespace))pending.set(namespace,(async()=>{
  const response=await fetch(`/assets/i18n/content-sources/${namespace}.json`,{credentials:'omit',cache:'no-cache',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
  if(!response.ok||Number(response.headers.get('content-length'))>262144)throw Error('official_content_unavailable');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>262144||await hash(bytes)!==indices[namespace])throw Error('official_content_index_invalid');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(value.schemaVersion!==1||value.namespace!==namespace||!Array.isArray(value.groups))throw Error('official_content_index_invalid');return value;
 })().catch(error=>{pending.delete(namespace);throw error;}));
 return pending.get(namespace);
}
/** Match an explicitly identified, already permitted original. Never search by its prose. */
export async function readOfficialPresentation(namespace,spec){
 const original=structuredClone(spec.values),fallback=status=>({status,text:field=>at(original,field)??'',key:()=>null});
 try{
  const [index]=await Promise.all([sourceIndex(namespace),ensureNamespaces(['public',namespace])]);
  const groups=index.groups.filter(g=>g.sourceId===spec.id&&g.sourceRef===spec.ref&&g.version===spec.version&&same(g.selector,spec.selector));
  if(groups.length!==1)return fallback('changed');const group=groups[0];
  if(!Object.entries(group.stateGuards??{}).every(([key,value])=>spec.state?.[key]===value)||group.nativeStoryDigest&&group.nativeStoryDigest!==spec.nativeDigest)return fallback('changed');
  const fields=Object.fromEntries([...group.digestFields].sort().map(field=>[field,at(original,field)]));
  if(Object.values(fields).some(value=>typeof value!=='string'))return fallback('unavailable');
  if(await hash(new TextEncoder().encode(JSON.stringify(fields)))!==group.sourceDigest)return fallback('changed');
  return{status:'matched',key:field=>group.fields[field]?`${namespace}:${group.fields[field]}`:null,text:field=>group.fields[field]?t(`${namespace}:${group.fields[field]}`):at(original,field)??''};
 }catch{return fallback('unavailable');}
}
/** A node stays tied to this one source until its owner explicitly replaces or clears it. */
export function bindOfficialFields(nodes,namespace,spec,{note}={}){
 let disposed=false,display=null;const unbind=[];
 for(const [field,node]of Object.entries(nodes)){clearBinding(node);node.textContent=at(spec.values,field)??'';}
 if(note)note.hidden=true;
 function annotate(){if(!note)return;note.hidden=!display||display.status==='matched'||getLocale()==='zh-CN';note.textContent=note.hidden?'':t(display.status==='changed'?'public:content.sourceChanged':'public:content.unavailable');}
 const stop=onLocaleChange(annotate);
 void readOfficialPresentation(namespace,spec).then(value=>{if(disposed)return;display=value;for(const [field,node]of Object.entries(nodes)){node.dataset.contentSource=value.status;const key=value.key(field);if(key)unbind.push(bindText(node,key));}annotate();});
 return()=>{disposed=true;stop();for(const off of unbind)off();if(note)note.hidden=true;};
}
