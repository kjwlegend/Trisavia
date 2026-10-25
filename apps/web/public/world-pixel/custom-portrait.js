import {createClipPlayer} from './clip-player.js';
import {customAppearanceKey,customAppearanceState,drawCustomAppearance,drawCustomUnavailable,retryCustomAppearance} from './custom-appearance.js';
const mounted=new WeakMap();
export function clearCustomPortrait(node){mounted.get(node)?.dispose();mounted.delete(node);}
export function mountCustomPortrait(node,appearance,{label='角色形象',activity=null,stale=false}={}){
 const key=customAppearanceKey(appearance),previous=mounted.get(node);if(previous?.key===key&&node.contains(previous.canvas)){previous.update(activity,stale,label);return previous.canvas;}clearCustomPortrait(node);
 const canvas=document.createElement('canvas'),status=document.createElement('span'),retry=document.createElement('button');canvas.width=96;canvas.height=64;canvas.className='avatar custom-avatar';canvas.style.objectFit='contain';canvas.style.imageRendering='pixelated';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);canvas.dataset.resourceKey=key;status.className='custom-avatar-status';status.setAttribute('role','status');retry.type='button';retry.className='custom-avatar-retry';retry.textContent='重试形象显示';node.replaceChildren(canvas,status,retry);
 const player=createClipPlayer(),motion=matchMedia('(prefers-reduced-motion: reduce)');let currentActivity=activity,frozen=stale,visible=true,disposed=false,raf=0;
 const action=()=>currentActivity?.state==='active'?currentActivity.actionId==='work.shift'?'work':['rest.bench','rest.voucher'].includes(currentActivity.actionId)?'rest':'idle':'idle';
 function paint(time=performance.now()){
  if(disposed||!node.contains(canvas))return;const state=customAppearanceState(appearance),ctx=canvas.getContext('2d');ctx.clearRect(0,0,96,64);canvas.dataset.appearanceState=state.phase;retry.hidden=state.phase!=='error';
  if(state.resource){const shown=drawCustomAppearance(ctx,state.resource,player,{x:48,y:39,action:action(),time,paused:frozen,reducedMotion:motion.matches});canvas.dataset.clip=shown.action;canvas.dataset.frame=String(shown.frameIndex);status.textContent=shown.fallback?`未提供${action()==='work'?'工作':'休息'}专用动作，使用本角色待机。`:'';}
  else{drawCustomUnavailable(ctx,{x:48,y:39});status.textContent=state.phase==='error'?'已应用，形象暂未显示':'正在读取已应用形象…';}
  status.hidden=!status.textContent;canvas.title=status.textContent;
 }
 function frame(time){paint(time);if(!disposed&&visible&&!document.hidden&&!motion.matches&&!frozen&&node.contains(canvas))raf=requestAnimationFrame(frame);}
 function reconcile(){cancelAnimationFrame(raf);paint();if(!disposed&&visible&&!document.hidden&&!motion.matches&&!frozen&&node.contains(canvas))raf=requestAnimationFrame(frame);}
 retry.addEventListener('click',()=>{void retryCustomAppearance(appearance).catch(()=>{});reconcile();});const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;reconcile();});observer.observe(canvas);window.addEventListener('avatar:resource',reconcile);document.addEventListener('visibilitychange',reconcile);motion.addEventListener('change',reconcile);
 const entry={key,canvas,update(value,isStale,text){currentActivity=value;frozen=isStale;canvas.setAttribute('aria-label',text);reconcile();},dispose(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();window.removeEventListener('avatar:resource',reconcile);document.removeEventListener('visibilitychange',reconcile);motion.removeEventListener('change',reconcile);}};mounted.set(node,entry);reconcile();return canvas;
}
