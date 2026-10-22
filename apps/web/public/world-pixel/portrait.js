import {resolveLook,drawLook,drawLookPlaceholder} from './look.js';
import {loadLookAssets} from './look-assets.js';
// Static thumbnails use the same sprite composition as the world. The caller
// supplies the current authorized projection; Agent ids never choose a look.
export function mountPortrait(node,appearance,{label='角色形象',avatarId}={}){
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.className='avatar';canvas.style.objectFit='contain';canvas.style.imageRendering='pixelated';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);node.replaceChildren(canvas);
  const ctx=canvas.getContext('2d'),look=resolveLook(appearance,{avatarId});canvas.dataset.lookId=look?.key||'';node.dataset.appearanceState=canvas.dataset.appearanceState=look?'loading':'unresolved';
  drawLookPlaceholder(ctx,{x:32,y:60,scale:2});
  if(!look){canvas.title='暂无法显示';return canvas;}
  void loadLookAssets().then(assets=>{if(node.firstChild!==canvas)return;ctx.clearRect(0,0,64,64);drawLook(ctx,look,assets.images,{x:32,y:60,scale:2,still:true});node.dataset.appearanceState=canvas.dataset.appearanceState='ready';}).catch(()=>{if(node.firstChild!==canvas)return;node.dataset.appearanceState=canvas.dataset.appearanceState='error';canvas.title='形象素材暂时无法显示';});return canvas;
}
