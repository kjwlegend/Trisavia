import {msg,isMessage,t,clearBinding,ensureNamespaces,applyI18n,onLocaleChange} from './i18n/core.js';
import {el} from './common.js';

const displays=new WeakMap(),displayNodes=new Set(),markupRoots=new Set();let ready=false,loading=null;
function display(node,attribute,value){
  let bindings=displays.get(node);if(!bindings){bindings=new Map();displays.set(node,bindings);displayNodes.add(new WeakRef(node));}
  bindings.set(attribute,value);clearBinding(node,attribute);
  const next=typeof value==='function'?value():value;
  if(!ready&&isMessage(next))return;
  const text=isMessage(next)?t(next.key,typeof next.params==='function'?next.params():next.params):String(next??'');
  if(attribute)node.setAttribute(attribute,text);else node.textContent=text;
}
function refreshDisplays(){for(const reference of displayNodes){const node=reference.deref();if(!node){displayNodes.delete(reference);continue;}for(const [attribute,value]of displays.get(node)||[])display(node,attribute,value);}}
onLocaleChange(refreshDisplays);

// Only explicitly keyed account copy is translated. User/profile/prompt text is
// passed through unchanged, and a plain value always clears an older binding.
export function accountMessage(key,params){
  const values=()=>Object.fromEntries(Object.entries(typeof params==='function'?params():params||{}).map(([name,value])=>[name,isMessage(value)?t(value.key,typeof value.params==='function'?value.params():value.params):value]));
  const value=msg(key.includes(':')?key:'account:'+key,values);
  return Object.freeze({...value,toString:()=>t(value.key,values()),[Symbol.toPrimitive]:()=>t(value.key,values())});
}
export function accountLabel(key,params){return String(accountMessage(key,params));}
export function accountElement(tag,className,value){
  // Labels/buttons may receive controls, counters or icons after creation.
  // Bind a dedicated text span so a locale switch never removes those nodes.
  if(isMessage(value)&&!['option','pre','textarea'].includes(tag)){
    const node=el(tag,className),text=el('span');accountText(text,value);node.append(text);return node;
  }
  if(isMessage(value)){const node=el(tag,className);accountText(node,value);return node;}
  return el(tag,className,value);
}
export function accountText(node,value){
  if(typeof value==='function')return display(node,null,value);
  displays.get(node)?.delete(null);
  if(isMessage(value))return display(node,null,value);
  clearBinding(node);node.textContent=value??'';
}
export function accountAttribute(node,attribute,value){
  if(typeof value==='function')return display(node,attribute,value);
  displays.get(node)?.delete(attribute);
  if(isMessage(value))return display(node,attribute,value);
  clearBinding(node,attribute);node.setAttribute(attribute,String(value??''));
}
export function accountMarkup(root){
  markupRoots.add(new WeakRef(root));if(ready)applyI18n(root);else root.setAttribute('data-i18n-deferred','account');return root;
}
export function activateAccountI18n(root){
  if(!root?.isConnected||root.closest('[hidden],[data-panel-state="closed"],[data-panel-state="closing"]'))return;
  loading??=ensureNamespaces(['common','account']).then(()=>{
    ready=true;for(const reference of markupRoots){const node=reference.deref();if(!node){markupRoots.delete(reference);continue;}node.removeAttribute('data-i18n-deferred');for(const child of node.querySelectorAll('[data-i18n-deferred="account"]'))child.removeAttribute('data-i18n-deferred');applyI18n(node);}refreshDisplays();
  }).catch(()=>{loading=null;});return loading;
}
export function accountNotice(node,value,tone=''){
  node.hidden=!value;node.className=`notice ${tone}`;accountText(node,value);
}
export {onLocaleChange};
