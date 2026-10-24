import manifest from '../world-life/asset-manifest.json' with {type:'json'};
import spatial from '../world-life/spatial-manifest.json' with {type:'json'};
import {resolveLook,drawLook} from './look.js';
import {appearanceLayer} from './appearance-palette.js';
const needed=['human-base-doing','human-shorthair-doing','human-curlyhair-doing','human-longhair-doing','human-bowlhair-doing','human-mophair-doing','human-spikeyhair-doing','crate','tray','bench-back','bench-front','seated-legs'];
export const LIFE_SPATIAL=spatial;
export async function loadLifeArt({signal}={}){
 const controller=new AbortController(),active=AbortSignal.any([...(signal?[signal]:[]),controller.signal,AbortSignal.timeout(15000)]);
 const refs=needed.map(id=>manifest.assets.find(asset=>asset.id===id));if(refs.some(ref=>!ref))throw Error('life_art_manifest_invalid');
 const settled=await Promise.allSettled(refs.map(async ref=>{try{const response=await fetch('/assets/world-life/'+ref.path,{credentials:'omit',cache:'no-cache',signal:active});if(!response.ok)throw Error('life_art_unavailable');const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(hash!==ref.sha256||bytes.byteLength!==ref.bytes)throw Error('life_art_hash_mismatch');const type=ref.path.endsWith('.svg')?'image/svg+xml':'image/png',url=URL.createObjectURL(new Blob([bytes],{type})),image=new Image();try{image.src=url;await image.decode();if(active.aborted)throw active.reason;if(image.naturalWidth!==ref.dimensions[0]||image.naturalHeight!==ref.dimensions[1])throw Error('life_art_size_mismatch');return image;}finally{URL.revokeObjectURL(url);}}catch(error){controller.abort();throw error;}}));
 const failed=settled.find(row=>row.status==='rejected');if(failed||active.aborted){controller.abort();for(const row of settled)if(row.status==='fulfilled')row.value.src='';throw failed?.reason||active.reason;}
 const images=new Map(settled.map((row,index)=>[refs[index].id,row.value]));let disposed=false;
 return{images,dispose(){if(disposed)return;disposed=true;controller.abort();for(const image of images.values())image.src='';images.clear();}};
}
function poseFor(entry){const activity=entry.fact?.activity;if(activity?.state!=='active'||entry.walking)return null;if(activity.actionId==='work.shift')return activity.placeId==='harbor_work'?'work-crate':'work-tray';if(activity.actionId==='rest.bench')return'rest-bench';if(activity.actionId==='npc.duty')return'duty';return null;}
export function lifeSortOffset(entry){return poseFor(entry)==='rest-bench'?5:0;}
export function drawLifeHuman(ctx,entry,frame,pixelAssets,lifeAssets){
 const observedPose=poseFor(entry),pose=frame.stale?(entry.lastLifePose??null):observedPose;if(!frame.stale)entry.lastLifePose=observedPose;const look=resolveLook(entry.fact?.profile?.appearance,{avatarId:entry.fact?.id});if(!pose||!look||!lifeAssets?.images)return false;
 const recipe=manifest.poses[pose],still=frame.reducedMotion||frame.paused||frame.stale;
 if(!still)entry.lifePhase=Math.floor(Math.max(0,frame.serverTime-entry.fact.activity.startedAt)/(recipe.frameMs||1));
 const phase=frame.reducedMotion?0:entry.lifePhase||0,index=recipe.frames[phase%recipe.frames.length],images=lifeAssets.images;
 if(pose==='duty'){drawLook(ctx,look,pixelAssets.images,{x:entry.x,y:entry.y,facing:entry.facing,still:true});return true;}
 ctx.save();ctx.translate(Math.round(entry.x),Math.round(entry.y));ctx.imageSmoothingEnabled=false;
 if(pose==='rest-bench'){ctx.drawImage(images.get('bench-back'),-14,-13);ctx.drawImage(images.get('bench-front'),-14,-2);}
 ctx.save();if(entry.facing==='left')ctx.scale(-1,1);
 const hair=look.nativeHairKey,rest=pose==='rest-bench',base=rest?pixelAssets.images.get('human_base_idle'):images.get('human-base-doing'),top=rest?pixelAssets.images.get(`human_${hair}_idle`):images.get(`human-${hair}-doing`);
 for(const [image,kind,key]of [[base,'clothing',rest?'human_base_idle':'human_base_doing'],[top,'hair',`human_${hair}_${rest?'idle':'doing'}`]]){const layer=appearanceLayer(image,kind,look.colors?.[kind==='hair'?'hairColorId':'clothingColorId']||'original',key);ctx.drawImage(layer,index*96,0,96,rest?36:64,-48,rest?-38:-39,96,rest?36:64);}
 if(rest)ctx.drawImage(images.get('seated-legs'),-4,-3);else ctx.drawImage(images.get(recipe.prop),recipe.propOffset[0],recipe.propOffset[1]+recipe.propYOffsets[phase%recipe.frames.length]);
 ctx.restore();ctx.restore();return true;
}
const activeAt=(actor,cell)=>actor?.activity?.state==='active'&&actor.position?.x===cell[0]&&actor.position?.y===cell[1];
export function lifeSeatOccupied(frame,npcs,station,stillOnly=false){const cell=station.cells[0];return frame.avatars.some(row=>(!stillOnly||!row.walking)&&activeAt(row.fact,cell))||npcs.some(row=>(!stillOnly||!row.walking)&&activeAt(row.npc,cell));}
export function fadeGardenBuilding(frame,npcs){const garden=spatial.places.find(place=>place.placeId==='garden_bench');return frame.selectedBuildingId==='g-pavilion'||garden.stations.filter(station=>['garden_bench-03','garden_bench-06'].includes(station.id)).some(station=>lifeSeatOccupied(frame,npcs,station));}
export function lifeStationObjects(lifeAssets,npcs){return spatial.places.flatMap(place=>place.stations.map(station=>{const [x,y]=station.visualAnchor.source,rest=station.actionIds.includes('rest.bench');return{kind:'life-station',id:station.id,x,y:y+(rest?5:0),draw(ctx,frame){if(lifeSeatOccupied(frame,npcs,station,true))return;const images=lifeAssets.images;if(rest){ctx.drawImage(images.get('bench-back'),x-14,y-13);ctx.drawImage(images.get('bench-front'),x-14,y-2);}else ctx.drawImage(images.get(station.assetRef==='work-crate'?'crate':'tray'),x+5,y-11);}};}));}
export function lifePlaceTargets(){return spatial.places.map(place=>{const points=place.stations.map(station=>station.visualAnchor.source),left=Math.min(...points.map(point=>point[0]))-14,right=Math.max(...points.map(point=>point[0]))+14,top=Math.min(...points.map(point=>point[1]))-24,bottom=Math.max(...points.map(point=>point[1]))+6;return{kind:'life-place',id:'life-place:'+place.placeId,buildingId:place.anchorBuildingId,name:place.name,area:'小镇外场',x:(left+right)/2,y:bottom,w:right-left,h:bottom-top,anchor:{x:(right-left)/2,y:bottom-top},description:'查看这里当前已启用的工作或免费休息活动。',note:'活动发生在可见外场，建筑室内尚未开放。'};});}
