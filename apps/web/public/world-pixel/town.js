import {loadLifeArt,drawLifeHuman,lifeSortOffset as lifeDepth,lifeStationObjects,lifePlaceTargets,fadeGardenBuilding} from './life-art.js';
import './asset-kit.js';
import {loadPixelAssets} from './assets.js';
import {createPixelRenderLayer} from './render-layer.js';
import {HUMAN_GEOMETRY,drawHuman,drawHumanFoot,receivePosition,advancePosition} from './human.js';
import {PIXEL_MAP,pixelPoint,PIXEL_LAYOUT_SHA256} from './map.js';
import {createTownV2Art} from './town-v2-art.js';
export {PIXEL_LAYOUT_SHA256};
export const COMMONS_PLACE=Object.freeze({kind:'world-place',id:'commons',name:'公共庭',area:'小镇',icon:'○',x:640,y:768,w:256,h:256,anchor:{x:128,y:256},description:'小镇中央的公共庭。角色的实际地点以当前服务器位置与场所记录为准。',note:'建筑室内尚未开放。'});
const cancelled=()=>new DOMException('Pixel town cancelled','AbortError');
export function validatePixelLayout(layout,kit){
 if(layout?.mapId!=='pixel-town-v2'||layout.tileSize!==16||JSON.stringify(layout.origin?.source)!=='[520,520]'||JSON.stringify(layout.bounds)!=='{"minX":-28,"minY":-28,"maxX":59,"maxY":35}'||layout.source?.width!==1536||layout.source.height!==1152||layout.walkableMask?.length!==64||layout.walkableMask.some(row=>typeof row!=='string'||row.length!==88||/[^01]/u.test(row))||layout.buildings?.length!==31||layout.stats?.totalWalkable!==1175||!kit?.sprites||!kit?.modules)throw new Error('pixel_layout_invalid');
 return layout;
}
export function createPixelTown(assets,layout,{makeCanvas=()=>document.createElement('canvas'),lifeAssets=null}={}){
 validatePixelLayout(layout,assets.kit);const art=createTownV2Art(assets,layout,{makeCanvas}),npcs=[],serviceTargets=[],npcEntries=new Map(),lifeTargets=lifePlaceTargets();
 const objects=art.objects.map(object=>object.id==='g-lodge'?{...object,draw(ctx,frame){ctx.save();if(fadeGardenBuilding(frame,npcs))ctx.globalAlpha=.28;object.draw(ctx,frame);ctx.restore();}}:object);if(lifeAssets)objects.push(...lifeStationObjects(lifeAssets,npcs));
 const places=[COMMONS_PLACE,...layout.buildings.map(b=>({kind:'world-place',id:b.id,name:b.name,area:layout.districts.find(d=>d.id===b.district)?.name?.replace(/^[ABC] · /u,'')||'小镇',icon:'⌂',x:b.topLeft[0]+b.size[0]/2,y:b.groundAnchor[1],w:b.size[0],h:b.size[1],anchor:{x:b.size[0]/2,y:b.groundAnchor[1]-b.topLeft[1]},description:'可到达建筑门前。室内和相关服务尚未开放。',note:'建筑外观不表示角色已到达或拥有该建筑。'}))];
 const layer=createPixelRenderLayer({assets,avatarGeometry:HUMAN_GEOMETRY,objects,places,drawAvatar(ctx,entry,frame){ctx.save();ctx.filter=`brightness(${frame.lighting?.people??1})`;if(!drawLifeHuman(ctx,entry,frame,assets,lifeAssets))drawHuman(ctx,entry,frame,assets);ctx.restore();},drawSelection:(ctx,entry,_scale,frame)=>drawHumanFoot(ctx,entry,true,frame?.theme),drawGround(ctx,frame){ctx.fillStyle='#839e65';ctx.fillRect(frame.viewport.left-16,frame.viewport.top-16,frame.viewport.right-frame.viewport.left+32,frame.viewport.bottom-frame.viewport.top+32);ctx.drawImage(art.ground,0,0);for(const entry of frame.avatars)drawHumanFoot(ctx,entry);}});
 return{...layer,projectAvatars(rows,rules){const legal=p=>layout.walkableMask[p.y-layout.bounds.minY]?.[p.x-layout.bounds.minX]==='1';for(const row of rows)if(!legal(row.position)||row.motion&&(!legal(row.motion.from)||!legal(row.motion.to)))throw new Error('pixel_position_unopened');return layer.projectAvatars(rows,rules);},buildingCount:31,sourceVersion:assets.kit.version,imageCount:assets.images.size,npcs,serviceTargets,
  lifeTargets,lifeSortOffset(entry){return lifeDepth(npcEntries.get(entry.id)||entry);},
  stepNpcs(frame){for(const target of npcs){const entry=npcEntries.get(target.id);if(!frame.stale)advancePosition(entry,performance.now(),{serverTime:frame.serverTime});else entry.walking=false;target.x=entry.x;target.y=entry.y;target.walking=entry.walking;}},
  setNpcs(rows,rules,meta={}){
   for(const place of places)delete place.serviceNpc;
   const ids=new Set(rows.map(row=>row.npcId));for(const id of npcEntries.keys())if(!ids.has(id))npcEntries.delete(id);
   npcs.splice(0,npcs.length,...rows.map(row=>{
    const place=places.find(place=>place.id===row.buildingId);if(place)place.serviceNpc=row;
    const point=pixelPoint(row.position,rules);let entry=npcEntries.get(row.npcId);if(!entry){entry={...point,walking:false};npcEntries.set(row.npcId,entry);}
    const fact={id:row.npcId,position:row.position,activity:row.activity,profile:{appearance:row.appearance}},motion=row.motion?{...row.motion,from:pixelPoint(row.motion.from,rules),to:pixelPoint(row.motion.to,rules)}:null;
    if(meta.stale){entry.fact=fact;entry.walking=false;}else{receivePosition(entry,{...point,renderMotion:motion},{serverTime:meta.serverTime??Date.now()});entry.fact=fact;}
    return{kind:'world-npc',id:row.npcId,name:row.name,area:'镇民 · '+row.role,npc:row,x:entry.x,y:entry.y,w:24,h:40,anchor:{x:12,y:39},description:row.role,note:'小镇规则角色，不是真实外部 Agent。',draw(ctx,frame){
     drawHumanFoot(ctx,entry);if(!drawLifeHuman(ctx,entry,frame,assets,lifeAssets))drawHuman(ctx,entry,frame,assets);
    }};
   }));
  },
  setNotice(data,rules){serviceTargets.length=0;if(data){const notice=data.notice,point=pixelPoint(notice.position,rules);serviceTargets.push({kind:'town-notice',id:notice.objectId,name:notice.name,area:'小镇公告',icon:'▤',...point,w:20,h:32,anchor:{x:10,y:31},townNotice:data});}},
  drawEffects(ctx,frame){const light=frame.lighting;if(light.opacity>0){ctx.fillStyle=`rgba(${light.color.join(',')},${light.opacity})`;ctx.fillRect(frame.viewport.left-16,frame.viewport.top-16,frame.viewport.right-frame.viewport.left+32,frame.viewport.bottom-frame.viewport.top+32);}art.drawLamps(ctx,light.lamps);},
  dispose(){art.dispose();assets.dispose();lifeAssets?.dispose();npcEntries.clear();npcs.length=0;serviceTargets.length=0;},
 };
}
export async function loadPixelTown({signal,baseURL=new URL('./',import.meta.url).href}={}){
 const controller=new AbortController(),active=AbortSignal.any([...(signal?[signal]:[]),controller.signal,AbortSignal.timeout(20000)]);let assets,lifeAssets;
 const layoutRead=async()=>{const response=await fetch(new URL('/world-map-life-v1.json',baseURL),{credentials:'omit',cache:'no-cache',signal:active});if(!response.ok)throw new Error('pixel_layout_unavailable');const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(hash!==PIXEL_LAYOUT_SHA256)throw new Error('pixel_layout_hash_mismatch');if(active.aborted)throw cancelled();return validatePixelLayout(JSON.parse(new TextDecoder().decode(bytes)),globalThis.PIXEL_ASSETS);};
 try{const loaded=await Promise.allSettled([layoutRead,()=>loadPixelAssets(globalThis.PIXEL_ASSETS,{baseURL,signal:active}),()=>loadLifeArt({signal:active})].map(async load=>{try{return await load();}catch(error){controller.abort();throw error;}}));if(loaded[1].status==='fulfilled')assets=loaded[1].value;if(loaded[2].status==='fulfilled')lifeAssets=loaded[2].value;const failed=loaded.find(value=>value.status==='rejected');if(failed)throw failed.reason;if(active.aborted)throw cancelled();return createPixelTown(assets,loaded[0].value,{lifeAssets});}catch(error){assets?.dispose();lifeAssets?.dispose();throw error;}
}
