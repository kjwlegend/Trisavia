import {PIXEL_MAP,assertPixelRules,pixelPoint} from './map.js';
import {nextPixelScale,pixelFitScale} from './camera.js';
import {projectWorldAvatars} from '../hud/world-scene-projection.js';
export function avatarBounds(geometry){
  const {width,height,anchor,hitBox}=geometry||{};
  if(!(width>0&&height>0&&Number.isFinite(anchor?.x)&&Number.isFinite(anchor?.y)&&anchor.x>=0&&anchor.x<=width&&anchor.y>=0&&anchor.y<=height&&hitBox&&[hitBox.left,hitBox.top,hitBox.right,hitBox.bottom].every(Number.isFinite)&&hitBox.right>hitBox.left&&hitBox.bottom>hitBox.top&&hitBox.left>=-anchor.x&&hitBox.right<=width-anchor.x&&hitBox.top>=-anchor.y&&hitBox.bottom<=height-anchor.y))throw new Error('pixel_avatar_geometry_invalid');
  return{width,height,anchor:{x:anchor.x,y:anchor.y},hitBox:{...hitBox},...(geometry.minHit?{minHit:{...geometry.minHit}}:{}),...(geometry.hitPadding?{hitPadding:{...geometry.hitPadding}}:{})};
}
// Decoration instructions and the final human renderer arrive from the audited
// design dictionary. This interface supplies native coordinates, not a layout.
export function createPixelRenderLayer({assets,avatarGeometry,drawAvatar,drawGround,drawSelection,objects=[],places=[]}){
  const geometry=avatarBounds(avatarGeometry);
  if(!assets?.kit||typeof drawAvatar!=='function'||typeof drawGround!=='function'||typeof drawSelection!=='function')throw new Error('pixel_renderer_incomplete');
  if(objects.some(object=>!Number.isFinite(object?.x)||!Number.isFinite(object?.y)||typeof object.draw!=='function'))throw new Error('pixel_scenery_incomplete');
  function drawSprite(ctx,key,x,y){
    const spec=assets.kit.sprites?.[key],image=assets.images.get(spec?.image),rect=spec?.rect,anchor=spec?.groundAnchor;
    if(!image||!Array.isArray(rect)||rect.length!==4||!Array.isArray(anchor)||anchor.length!==2||![...rect,...anchor,x,y].every(Number.isFinite)||rect[0]<0||rect[1]<0||rect[2]<=0||rect[3]<=0||rect[0]+rect[2]>image.width||rect[1]+rect[3]>image.height)throw new Error('pixel_sprite_invalid');
    ctx.imageSmoothingEnabled=false;ctx.drawImage(image,...rect,x-anchor[0],y-anchor[1],rect[2],rect[3]);
  }
  return{mapSpec:PIXEL_MAP,objects,places,camera:{fit:pixelFitScale,nextScale:nextPixelScale},validateRules:assertPixelRules,
    projectAvatars(avatars,rules){assertPixelRules(rules);return projectWorldAvatars(avatars,rules,{projectionVersion:PIXEL_MAP.version,projectPoint:point=>pixelPoint(point,rules)});},
    avatarGeometry:()=>structuredClone(geometry),drawAvatar(ctx,entry,frame){ctx.imageSmoothingEnabled=false;drawAvatar(ctx,entry,frame,{assets,geometry,drawSprite});},drawSelection,
    drawGround(ctx,frame){ctx.imageSmoothingEnabled=false;drawGround(ctx,frame,{assets,drawSprite});},drawSprite,
  };
}
