import './asset-kit.js';
import {loadPixelAssets} from './assets.js';
import {createPixelRenderLayer} from './render-layer.js';
import {HUMAN_GEOMETRY,drawHuman,drawHumanFoot} from './human.js';
import {PIXEL_MAP,pixelPoint,PIXEL_LAYOUT_SHA256} from './map.js';
import {createTownV2Art} from './town-v2-art.js';
export {PIXEL_LAYOUT_SHA256};
export const COMMONS_PLACE=Object.freeze({kind:'world-place',id:'commons',name:'公共庭',area:'小镇',icon:'○',x:640,y:768,w:256,h:256,anchor:{x:128,y:256},description:'小镇中央的公共庭。角色的实际地点以当前服务器位置与场所记录为准。',note:'建筑室内尚未开放。'});
const cancelled=()=>new DOMException('Pixel town cancelled','AbortError');
export function validatePixelLayout(layout,kit){
 if(layout?.mapId!=='pixel-town-expansion-proposal@2'||layout.tileSize!==16||JSON.stringify(layout.origin?.source)!=='[520,520]'||JSON.stringify(layout.bounds)!=='{"minX":-28,"minY":-28,"maxX":59,"maxY":35}'||layout.source?.width!==1536||layout.source.height!==1152||layout.walkableMask?.length!==64||layout.walkableMask.some(row=>typeof row!=='string'||row.length!==88||/[^01]/u.test(row))||layout.buildings?.length!==31||layout.stats?.totalWalkable!==1150||!kit?.sprites||!kit?.modules)throw new Error('pixel_layout_invalid');
 return layout;
}
export function createPixelTown(assets,layout,{makeCanvas=()=>document.createElement('canvas')}={}){
 validatePixelLayout(layout,assets.kit);const art=createTownV2Art(assets,layout,{makeCanvas}),npcs=[];
 const places=[COMMONS_PLACE,...layout.buildings.map(b=>({kind:'world-place',id:b.id,name:b.name,area:layout.districts.find(d=>d.id===b.district)?.name?.replace(/^[ABC] · /u,'')||'小镇',icon:'⌂',x:b.topLeft[0]+b.size[0]/2,y:b.groundAnchor[1],w:b.size[0],h:b.size[1],anchor:{x:b.size[0]/2,y:b.groundAnchor[1]-b.topLeft[1]},description:'可到达建筑门前。室内和相关服务尚未开放。',note:'建筑外观不表示角色已到达或拥有该建筑。'}))];
 const layer=createPixelRenderLayer({assets,avatarGeometry:HUMAN_GEOMETRY,objects:art.objects,places,drawAvatar(ctx,entry,frame){ctx.save();ctx.filter=`brightness(${frame.lighting?.people??1})`;drawHuman(ctx,entry,frame,assets);ctx.restore();},drawSelection:(ctx,entry,_scale,frame)=>drawHumanFoot(ctx,entry,true,frame?.theme),drawGround(ctx,frame){ctx.fillStyle='#839e65';ctx.fillRect(frame.viewport.left-16,frame.viewport.top-16,frame.viewport.right-frame.viewport.left+32,frame.viewport.bottom-frame.viewport.top+32);ctx.drawImage(art.ground,0,0);for(const entry of frame.avatars)drawHumanFoot(ctx,entry);}});
 return{...layer,projectAvatars(rows,rules){const legal=p=>layout.walkableMask[p.y-layout.bounds.minY]?.[p.x-layout.bounds.minX]==='1';for(const row of rows)if(!legal(row.position)||row.motion&&(!legal(row.motion.from)||!legal(row.motion.to)))throw new Error('pixel_position_unopened');return layer.projectAvatars(rows,rules);},buildingCount:31,sourceVersion:assets.kit.version,imageCount:assets.images.size,npcs,
  setNpcs(rows,rules){npcs.splice(0,npcs.length,...rows.map(row=>{const point=pixelPoint(row.position,rules),design=layout.npcServicePoints.find(value=>value.id===row.npcId),entry={...point,walking:false,fact:{id:row.npcId,profile:{appearance:row.appearance}}};return{kind:'world-npc',id:row.npcId,name:row.name,area:'NPC · 服务点',icon:'○',x:point.x,y:point.y,w:24,h:40,anchor:{x:12,y:39},description:row.role+'。服务暂未开放。',note:'服务器管理的 NPC，不是真实 Agent。',draw(ctx,frame){drawHumanFoot(ctx,entry);drawHuman(ctx,entry,frame,assets);if(design){const x=Math.round(point.x),y=Math.round(point.y);ctx.fillStyle='#715d43';ctx.fillRect(x+9,y-17,11,12);ctx.fillRect(x+13,y-5,2,6);ctx.fillStyle='#decea0';ctx.fillRect(x+10,y-16,9,9);}ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.fillStyle='#172b22';ctx.fillRect(point.x-11,point.y-31,22,11);ctx.fillStyle='#eee8cd';ctx.fillText('NPC',point.x,point.y-23);}};}));},
  drawEffects(ctx,frame){const light=frame.lighting;if(light.opacity>0){ctx.fillStyle=`rgba(${light.color.join(',')},${light.opacity})`;ctx.fillRect(frame.viewport.left-16,frame.viewport.top-16,frame.viewport.right-frame.viewport.left+32,frame.viewport.bottom-frame.viewport.top+32);}art.drawLamps(ctx,light.lamps);},
  dispose(){art.dispose();assets.dispose();npcs.length=0;},
 };
}
export async function loadPixelTown({signal,baseURL=new URL('./',import.meta.url).href}={}){
 const active=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]);let assets;
 try{const response=await fetch(new URL('/world-map-v2.json',baseURL),{credentials:'omit',cache:'no-store',signal:active});if(!response.ok)throw new Error('pixel_layout_unavailable');const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(hash!==PIXEL_LAYOUT_SHA256)throw new Error('pixel_layout_hash_mismatch');if(active.aborted)throw cancelled();const layout=validatePixelLayout(JSON.parse(new TextDecoder().decode(bytes)),globalThis.PIXEL_ASSETS);assets=await loadPixelAssets(globalThis.PIXEL_ASSETS,{baseURL,signal:active});if(active.aborted)throw cancelled();return createPixelTown(assets,layout);}catch(error){assets?.dispose();throw error;}
}
