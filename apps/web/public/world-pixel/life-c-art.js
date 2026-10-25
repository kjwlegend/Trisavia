import manifest from '../world-life/c/assets-manifest.json' with {type:'json'};
import spatial from '../world-life/spatial-manifest-c-v1.json' with {type:'json'};
import {resolveLook} from './look.js';
import {appearanceLayer} from './appearance-palette.js';
const refs=new Map([...manifest.fixtures,...manifest.poses,...manifest.items.map(i=>i.sprite)].map(ref=>[ref.path,ref]));
const stations=new Map(spatial.places.flatMap(p=>p.stations.flatMap(s=>s.cells.map(c=>[c[0]+':'+c[1],s]))));
function stationAt(entry){const p=entry.fact?.position;return p?stations.get(p.x+':'+p.y):null;}
export function lifeCPose(entry){
 const a=entry.fact?.activity;if(a?.state!=='active'||entry.walking)return null;const station=stationAt(entry);if(!station)return null;
 if(['rest.inn','rest.voucher'].includes(a.actionId)&&station.assetRef==='rest-chair')return'rest';
 if(a.actionId==='book.read'&&station.assetRef==='read-chair')return'read';
 if(a.actionId==='meal.eat'&&['meal-chair','rest-bench'].includes(station.assetRef))return'meal';if(a.actionId==='meal.prepare'&&station.assetRef==='kitchen-counter')return'prepare';return null;
}
export async function loadLifeCArt({signal}={}){
 const controller=new AbortController(),images=new Map(),active=AbortSignal.any([...(signal?[signal]:[]),controller.signal]);let pending=null,failed=false,disposed=false;
 async function load(list){const settled=await Promise.allSettled(list.map(async path=>{try{const ref=refs.get(path),response=await fetch('/assets/world-life/c/'+path,{credentials:'omit',cache:'no-cache',signal:AbortSignal.any([active,AbortSignal.timeout(15000)])});if(!response.ok)throw Error('life_c_art_unavailable');const bytes=await response.arrayBuffer(),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(sha!==ref.sha256||bytes.byteLength!==ref.bytes)throw Error('life_c_art_hash_mismatch');const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));if(image.width!==ref.size[0]||image.height!==ref.size[1]||active.aborted){image.close();throw Error('life_c_art_size_mismatch');}return[path,image];}catch(error){controller.abort();throw error;}}));const result=settled.filter(r=>r.status==='fulfilled').map(r=>r.value),error=settled.find(r=>r.status==='rejected');if(error||active.aborted||disposed){for(const [,image]of result)image.close();throw error?.reason||active.reason;}for(const [path,image]of result)images.set(path,image);}
 function poses(){if(pending||failed||disposed)return;pending=load(manifest.poses.map(p=>p.path)).catch(()=>{failed=true;}).finally(()=>pending=null);}
 const dispose=()=>{if(disposed)return;disposed=true;controller.abort();for(const image of images.values())image.close();images.clear();};
 try{await load(manifest.fixtures.map(f=>f.path).filter(p=>!p.endsWith('seated-legs.png')).concat('items/bread_meal.png'));}catch(error){dispose();throw error;}
 return{images,poses,dispose};
}
// Already-composed native strips include one chair. Custom residents retain their
// complete own image; only a separate book/plate is placed beside them.
export function drawLifeC(ctx,entry,frame,art,{toolsOnly=false}={}){
 const observed=lifeCPose(entry),pose=frame.stale?(entry.lastCPose??null):observed;if(!frame.stale)entry.lastCPose=observed;if(!pose||!art?.images)return false;
 if(!frame.stale)entry.facing=stationAt(entry)?.facing||entry.facing;const custom=entry.fact?.profile?.appearance?.kind==='custom',look=resolveLook(entry.fact?.profile?.appearance),hair=look?.nativeHairKey;
 if(custom){if(!toolsOnly)return false;const path=pose==='read'?'fixtures/open-book.png':['meal','prepare'].includes(pose)?'items/bread_meal.png':null,image=path&&art.images.get(path);if(image){ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(image,entry.x+8,entry.y-11,14,['meal','prepare'].includes(pose)?14:9);ctx.restore();}return true;}
 if(toolsOnly||!hair||pose==='prepare')return false;const path=`poses/${hair}-${pose}.png`,ref=refs.get(path),source=art.images.get(path);if(!source){art.poses();return false;}
 if(!frame.stale&&!frame.paused)entry.lifeCPhase=Math.floor(Math.max(0,frame.serverTime-entry.fact.activity.startedAt)/ref.frameDurationMs);const index=frame.reducedMotion?0:(entry.lifeCPhase||0)%ref.frames;
 const clothed=appearanceLayer(source,'clothing',look.colors.clothingColorId,`human-${hair}-${pose}`),image=appearanceLayer(clothed,'hair',look.colors.hairColorId,`human-${hair}-${pose}`),station=stationAt(entry);ctx.save();ctx.imageSmoothingEnabled=false;ctx.translate(Math.round(entry.x),Math.round(entry.y));ctx.scale(station?.facing==='left'?-1:1,1);ctx.drawImage(image,index*96,0,96,64,-48,-39,96,64);ctx.restore();return true;
}
export function lifeCObjects(art,npcs){
 const active=(row,s)=>row?.activity?.state==='active'&&s.cells.some(c=>row.position?.x===c[0]&&row.position?.y===c[1]),occupied=(frame,s)=>frame.avatars.some(e=>!e.walking&&e.fact.profile.appearance?.kind!=='custom'&&active(e.fact,s))||npcs.some(n=>!n.walking&&active(n.npc,s));
 return[...manifest.fixturePlacement.map(p=>({kind:'life-fixture',id:'life-c:'+p.asset,x:p.source[0],y:p.source[1]-2,draw(ctx){ctx.drawImage(art.images.get('fixtures/'+p.asset+'.png'),p.source[0]+p.imageOffset[0],p.source[1]+p.imageOffset[1]);}})),...spatial.places.flatMap(p=>p.stations.filter(s=>['rest-chair','read-chair','meal-chair'].includes(s.assetRef)).map(s=>{const [x,y]=s.visualAnchor.source;return{kind:'life-station',id:s.id,x,y,draw(ctx,frame){if(!occupied(frame,s))ctx.drawImage(art.images.get('fixtures/chair.png'),x-7,y-13);}};}))];
}
