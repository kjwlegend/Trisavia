import {mountCustomPortrait,clearCustomPortrait} from './custom-portrait.js';
import {resolveLook,drawLook,drawLookPlaceholder} from './look.js';
import {loadLookAssets} from './look-assets.js';
// Static thumbnails use the same sprite composition as the world. The caller
// supplies the current authorized projection; Agent ids never choose a look.
export function mountPortrait(node,appearance,{label='角色形象',avatarId,activity=null,stale=false}={}){
  if(appearance?.kind==='custom')return mountCustomPortrait(node,appearance,{label,activity,stale});clearCustomPortrait(node);
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.className='avatar';canvas.style.objectFit='contain';canvas.style.imageRendering='pixelated';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);node.replaceChildren(canvas);
  const ctx=canvas.getContext('2d'),look=resolveLook(appearance,{avatarId});canvas.dataset.lookId=look?.key||'';node.dataset.appearanceState=canvas.dataset.appearanceState=look?'loading':'unresolved';
  drawLookPlaceholder(ctx,{x:32,y:60,scale:2});
  if(!look){canvas.title='暂无法显示';return canvas;}
  void loadLookAssets().then(assets=>{if(node.firstChild!==canvas)return;const frame=document.createElement('canvas');frame.width=96;frame.height=64;const source=frame.getContext('2d');drawLook(source,look,assets.images,{x:48,y:39,still:true});const pixels=source.getImageData(0,0,96,64).data;let left=96,right=-1,top=64,bottom=-1;for(let y=0;y<64;y++)for(let x=0;x<96;x++)if(pixels[(y*96+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}ctx.clearRect(0,0,64,64);ctx.imageSmoothingEnabled=false;if(right>=left){const width=right-left+1,height=bottom-top+1,scale=Math.min(56/width,56/height),w=width*scale,h=height*scale;ctx.drawImage(frame,left,top,width,height,(64-w)/2,(64-h)/2,w,h);}node.dataset.appearanceState=canvas.dataset.appearanceState='ready';}).catch(()=>{if(node.firstChild!==canvas)return;node.dataset.appearanceState=canvas.dataset.appearanceState='error';canvas.title='形象素材暂时无法显示';});return canvas;
}
