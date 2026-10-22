import {APPEARANCE_CATALOG} from './look.js';
import {loadPixelAssets} from './assets.js';
let pending=null,loaded=null,controller=null,generation=0;
// Immutable image bytes are shared for this document. Profile and selection
// state are never cached here; every consumer keeps its own target generation.
export function loadLookAssets(){
  if(loaded)return Promise.resolve(loaded);if(pending)return pending;
  const images=Object.fromEntries(Object.entries(APPEARANCE_CATALOG.images).filter(([key])=>key.startsWith('human_')).map(([key,value])=>[key,{...value,width:value.size[0],height:value.size[1]}]));
  const turn=generation;controller=new AbortController();
  const request=loadPixelAssets({version:APPEARANCE_CATALOG.version,sourcePixelSize:16,images},{baseURL:new URL('./',import.meta.url).href,signal:controller.signal}).then(value=>{if(turn!==generation){value.dispose();throw new DOMException('Asset loading cancelled','AbortError');}loaded=value;return value;}).finally(()=>{if(pending===request)pending=null;});pending=request;return request;
}
export function disposeLookAssets(){generation++;controller?.abort();controller=null;pending=null;loaded?.dispose();loaded=null;}
if(typeof window!=='undefined')window.addEventListener('pagehide',event=>{if(!event.persisted)disposeLookAssets();});
