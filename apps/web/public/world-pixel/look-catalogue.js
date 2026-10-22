import {api} from '../common.js';
import {APPEARANCE_VERSION,APPEARANCE_DIGEST,lookFor} from './look.js';
const sameFields=(value,expected)=>value&&Object.keys(value).length===Object.keys(expected).length&&Object.entries(expected).every(([key,item])=>value[key]===item);
export function readLookCatalogue(data){
  if(data?.version!==2||data.catalogVersion!==APPEARANCE_VERSION||data.assetVersion!=='2026-10-21.r3'||data.catalogDigest!==APPEARANCE_DIGEST||!Array.isArray(data.looks)||!lookFor(data.defaultLookId))throw new Error('appearance_catalog_unavailable');
  const ids=new Set();const looks=data.looks.map(item=>{
    const art=lookFor(item.lookId),preview=item.preview;
    const layers=art?.clips.idle.layers.map(layer=>'/assets/world-pixel/'+globalThis.PIXEL_APPEARANCE_CATALOG.images[layer.imageKey].url);
    if(!art||ids.has(item.lookId)||typeof item.displayName!=='string'||!item.displayName.trim()||typeof item.selectable!=='boolean'||preview?.kind!=='layered-sprite'||JSON.stringify(preview.layers)!==JSON.stringify(layers)||!sameFields(preview.frame,{x:0,y:0,width:96,height:64})||!sameFields(preview.anchor,{x:48,y:39}))throw new Error('appearance_catalog_unavailable');
    ids.add(item.lookId);return{lookId:item.lookId,displayName:item.displayName,selectable:item.selectable};
  });
  return{catalogVersion:data.catalogVersion,defaultLookId:data.defaultLookId,looks};
}
export function createLookCatalogue({request=api}={}){
  let state={phase:'idle',data:null},generation=0,abort=null;const listeners=new Set();const snapshot=()=>structuredClone(state),emit=value=>{state=value;for(const listener of listeners)listener(snapshot());};
  return{snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},async load(){const turn=++generation;abort?.abort();abort=new AbortController();emit({phase:'loading',data:state.data});try{const data=readLookCatalogue(await request('/avatar-catalog',{signal:abort.signal}));if(turn===generation)emit({phase:'ready',data});}catch(error){if(turn===generation&&error.name!=='AbortError')emit({phase:'error',data:null});}},cancel(){generation++;abort?.abort();abort=null;},dispose(){generation++;abort?.abort();listeners.clear();}};
}
