import './asset-kit.js';
import {loadPixelAssets} from './assets.js';
import {createPixelRenderLayer} from './render-layer.js';
import {HUMAN_GEOMETRY,drawHuman,drawHumanFoot} from './human.js';
export const PIXEL_LAYOUT_SHA256='30abc430606ed7eda79200e340a4bf54dab8eef2e727d6efd971911cbcc6aec1';
export const COMMONS_PLACE=Object.freeze({kind:'world-place',id:'commons',name:'公共庭',area:'当前开放',icon:'○',x:384,y:384,w:256,h:256,anchor:{x:128,y:256},description:'公开角色当前在公共庭活动。周边街区为景观预览，尚未开放为可到访场所。',note:'角色位置来自服务器；景观与视觉主题不表示在线、到访或互动结果。'});
const cancelled=()=>new DOMException('Pixel town cancelled','AbortError');
export function validatePixelLayout(layout,kit){
  if(layout?.coordinateSpace!=='source-pixel'||layout.mapId!=='pixel-town-commons@1'||JSON.stringify(layout.bounds)!=='[0,0,768,512]'||JSON.stringify(layout.commons)!=='[256,128,256,256]'||layout.ground?.tiles?.length!==1536||!Array.isArray(layout.modules))throw new Error('pixel_layout_invalid');
  for(const item of layout.modules)if(!kit.modules[item.key]||!Array.isArray(item.anchor)||item.anchor.length!==2||!item.anchor.every(Number.isFinite)||item.footY!==item.anchor[1])throw new Error('pixel_module_invalid');
  return layout;
}
// Layout and textures are the frozen designer export, never generated roads or
// inferred service destinations. Sprite x/y below are native top-left positions.
export function createPixelTown(assets,layout,{makeCanvas=()=>document.createElement('canvas')}={}){
  const kit=assets.kit;validatePixelLayout(layout,kit);
  function sprite(ctx,key,x,y,flags={}){const spec=kit.sprites[key],image=assets.images.get(spec?.image);if(!spec||!image)throw new Error('pixel_sprite_missing');const [sx,sy,w,h]=spec.rect;
    if(flags.flipX||flags.flipY||flags.rotate90){ctx.save();ctx.translate(x+w/2,y+h/2);if(flags.rotate90)ctx.rotate(Math.PI/2);ctx.scale(flags.flipX?-1:1,flags.flipY?-1:1);ctx.drawImage(image,sx,sy,w,h,-w/2,-h/2,w,h);ctx.restore();}else ctx.drawImage(image,sx,sy,w,h,Math.round(x),Math.round(y),w,h);
  }
  function shore(ctx,x,y,side){ctx.save();if(side==='south'){ctx.translate(x+16,y+16);ctx.rotate(Math.PI);}else if(side==='west'){ctx.translate(x,y+16);ctx.rotate(-Math.PI/2);}else if(side==='east'){ctx.translate(x+16,y);ctx.rotate(Math.PI/2);}else ctx.translate(x,y);sprite(ctx,kit.shoreline.sprite,0,0);ctx.restore();}
  function grade(ctx,x,y,w,h,value=layout.ground.grassGrade){ctx.save();ctx.globalAlpha=value.alpha;ctx.fillStyle=value.color;ctx.fillRect(x,y,w,h);ctx.restore();}
  const modules=layout.modules.map(item=>({...item,module:kit.modules[item.key],left:item.anchor[0]-kit.modules[item.key].groundAnchor[0],top:item.anchor[1]-kit.modules[item.key].groundAnchor[1]}));
  const ground=makeCanvas();ground.width=768;ground.height=512;const g=ground.getContext('2d');if(!g)throw new Error('pixel_canvas_unavailable');g.imageSmoothingEnabled=false;g.fillStyle='#91b85c';g.fillRect(0,0,768,512);
  for(const tile of layout.ground.tiles){for(const key of tile.sprites)sprite(g,key,tile.x,tile.y);if(tile.grade)grade(g,tile.x,tile.y,16,16,tile.grade);}
  for(const segment of layout.ground.shorelineSegments)shore(g,segment.x,segment.y,segment.side);
  function parts(ctx,item,groundOnly){for(const part of item.module.parts){if((part.layer==='ground')!==groundOnly)continue;sprite(ctx,part.sprite,item.left+part.offset[0],item.top+part.offset[1],part);}}
  for(const item of modules)parts(g,item,true);
  const grass=makeCanvas();grass.width=grass.height=16;const grassContext=grass.getContext('2d');if(!grassContext)throw new Error('pixel_canvas_unavailable');sprite(grassContext,kit.terrain.grass.center,0,0);grade(grassContext,0,0,16,16);
  const terminals=new Set(['scenery-north-green','scenery-east-blue','scenery-south-purple']);
  const objects=modules.map(item=>({kind:'pixel-scenery',id:item.id,x:item.anchor[0],y:item.footY,draw(ctx,frame){parts(ctx,item,false);if(terminals.has(item.id)){const x=item.left+item.module.entrance[0]+10,y=item.footY-14;ctx.fillStyle='#3d5d5c';ctx.fillRect(x,y,9,5);ctx.fillStyle=frame.theme==='dusk'?'#f4d58b':'#9bd3ba';ctx.fillRect(x+2,y+2,5,1);}}}));
  const layer=createPixelRenderLayer({assets,avatarGeometry:HUMAN_GEOMETRY,objects,places:[COMMONS_PLACE],drawAvatar:(ctx,entry,frame)=>drawHuman(ctx,entry,frame,assets),drawSelection:(ctx,entry,_scale,frame)=>drawHumanFoot(ctx,entry,true,frame?.theme),drawGround(ctx,frame){
    const pattern=ctx.createPattern(grass,'repeat');if(pattern){ctx.fillStyle=pattern;ctx.fillRect(-2048,-2048,4864,4608);}
    const river=layout.background.river,top=Math.floor(frame.viewport.top/16)*16-16,bottom=frame.viewport.bottom+16,water=kit.terrain.water.tiles||kit.terrain.water;
    for(let y=top;y<bottom;y+=16){for(const x of river.bankX)sprite(ctx,kit.terrain.sand.center,x,y);for(let x=river.x;x<river.x+river.width;x+=16)sprite(ctx,water[x===river.x?'left':x===river.x+river.width-16?'right':'center'],x,y);shore(ctx,river.x,y,'west');shore(ctx,river.x+river.width-16,y,'east');}
    ctx.drawImage(ground,0,0);ctx.fillStyle=frame.theme==='dusk'?'#91d0bf':'#779c86';for(const light of layout.guideLights){const [x,y]=light.position;for(const dx of [0,5,10])ctx.fillRect(x+dx,y,3,1);}for(const entry of frame.avatars)drawHumanFoot(ctx,entry);
  }});
  return{...layer,buildingCount:modules.filter(item=>item.id.startsWith('scenery-')).length,sourceVersion:kit.version,imageCount:assets.images.size,
    drawUpper(ctx){for(const item of modules)for(const part of item.module.foregroundParts||[])sprite(ctx,part.sprite,item.left+part.offset[0],item.top+part.offset[1],part);},
    drawEffects(ctx,frame){if(frame.theme!=='dusk')return;ctx.fillStyle='#263d6847';ctx.fillRect(-2048,-2048,4864,4608);if(frame.reducedMotion||frame.quality)return;for(const light of layout.doorwayLights){const[x,y]=light.position;for(const[size,alpha]of [[30,.055],[22,.075],[14,.10],[6,.15]]){ctx.fillStyle=`rgba(255,215,124,${alpha})`;ctx.fillRect(x-size/2,y-size/3,size,size*2/3);}}},
    dispose(){assets.dispose();ground.width=grass.width=0;},
  };
}
export async function loadPixelTown({signal,baseURL=new URL('./',import.meta.url).href}={}){
  const active=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]);let assets;
  try{const response=await fetch(new URL('scene-layout.json',baseURL),{credentials:'omit',cache:'no-store',signal:active});if(!response.ok)throw new Error('pixel_layout_unavailable');const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(hash!==PIXEL_LAYOUT_SHA256)throw new Error('pixel_layout_hash_mismatch');if(active.aborted)throw cancelled();const layout=validatePixelLayout(JSON.parse(new TextDecoder().decode(bytes)),globalThis.PIXEL_ASSETS);assets=await loadPixelAssets(globalThis.PIXEL_ASSETS,{baseURL,signal:active});if(active.aborted)throw cancelled();return createPixelTown(assets,layout);}catch(error){assets?.dispose();throw error;}
}
