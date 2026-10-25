import {el} from '../common.js';
import {resolveLook,drawLook,drawLookPlaceholder} from './look.js';
import {loadLookAssets} from './look-assets.js';
import {nativeFrame} from './native-ui.js';
import {createClipPlayer} from './clip-player.js';
import {customAppearanceState,drawCustomAppearance,drawCustomUnavailable,retryCustomAppearance} from './custom-appearance.js';
export function createLookStage(){
 const node=el('section','character-stage'),top=el('div','stage-title'),title=el('span','','角色预览'),status=el('span','stage-status'),scene=el('div','stage-scene'),canvas=el('canvas'),ground=el('div','stage-ground'),caption=el('div','stage-caption'),copy=el('div'),name=el('strong'),description=el('p'),controls=el('div','stage-action-controls');canvas.width=768;canvas.height=512;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','完整人物预览');canvas.dataset.lookStage='';top.append(title,status);scene.append(canvas,ground);copy.append(name,description);caption.append(copy,controls);node.append(nativeFrame('lightWood'),top,scene,caption);
 const small=el('div','stage-native-size'),nativeCanvas=el('canvas');nativeCanvas.width=96;nativeCanvas.height=64;nativeCanvas.setAttribute('aria-label','原尺寸世界比例预览');small.append(el('span','','1× 世界比例'),nativeCanvas);scene.append(small);
 let appearance=null,override=null,dirty=false,active=false,visible=false,assets=null,action='idle',facing='right',raf=0,disposed=false,failed=false,loading=false,playing=true,manualFrame=null,worldReduced=false;const motion=matchMedia('(prefers-reduced-motion: reduce)'),player=createClipPlayer(),buttons=new Map();
 const reduced=()=>motion.matches||worldReduced,custom=()=>Boolean(override||appearance?.kind==='custom'),resource=()=>override||(appearance?.kind==='custom'?customAppearanceState(appearance).resource:null),clip=()=>{const value=resource();return value?.manifest.clips[action]||value?.manifest.clips.idle;};
 for(const [key,label]of [['idle','待机'],['walk','行走'],['work','工作'],['rest','休息'],['turn','↔'],['play','暂停'],['previous','上一帧'],['next','下一帧']]){
  const button=el('button','',label);button.type='button';button.dataset.previewAction=key;if(key==='turn')button.setAttribute('aria-label','切换人物朝向');button.addEventListener('click',()=>{
   if(key==='turn')facing=facing==='left'?'right':'left';else if(key==='play'){playing=!playing;manualFrame=null;}else if(['previous','next'].includes(key)){const value=clip();if(!value)return;playing=false;manualFrame=(Number(canvas.dataset.frame||0)+(key==='next'?1:-1)+value.frames)%value.frames;player.seek(manualFrame,{frameMs:value.frameMs,time:performance.now()});}else{action=key;manualFrame=null;}
   reconcile();
  });controls.append(button);buttons.set(key,button);
 }
 function paint(time=performance.now()){
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,768,512);small.hidden=!custom();
  if(custom()){
   const value=resource(),mini=nativeCanvas.getContext('2d');mini.clearRect(0,0,96,64);
   if(value){const shown=drawCustomAppearance(ctx,value,player,{x:384,y:312,scale:8,action,facing,time,paused:!playing,reducedMotion:reduced(),frameIndex:manualFrame});drawCustomAppearance(mini,value,player,{x:48,y:39,action,facing,time,paused:!playing,reducedMotion:reduced(),frameIndex:shown.frameIndex});canvas.dataset.resourceKey=value.key;canvas.dataset.frame=String(shown.frameIndex);canvas.dataset.clip=shown.action;canvas.dataset.facing=facing;description.textContent=shown.fallback?`未提供${action==='work'?'工作':'休息'}专用动作，将使用本角色待机；实际活动由服务器显示。`:`${action==='idle'?'待机':action==='walk'?'行走':action==='work'?'工作':'休息'} · 第 ${shown.frameIndex+1} / ${clip().frames} 帧${clip().frames===1?'（静止姿态）':''}`;}
   else{drawCustomUnavailable(ctx,{x:384,y:312,scale:8});description.textContent='完整角色素材尚未载入。';}
  }else{const look=resolveLook(appearance);if(assets&&look&&!failed)drawLook(ctx,look,assets.images,{x:384,y:310,scale:8,action:['idle','walk'].includes(action)?action:'idle',facing,elapsed:time,still:reduced()||!playing});else drawLookPlaceholder(ctx,{x:384,y:310,scale:8});}
 }
 function labels(){
  const look=resolveLook(appearance),state=appearance?.kind==='custom'?customAppearanceState(appearance):null;for(const [key,button]of buttons){if(['idle','walk','work','rest'].includes(key))button.setAttribute('aria-pressed',String(action===key));if(['work','rest','play','previous','next'].includes(key))button.hidden=!custom();if(['previous','next'].includes(key))button.disabled=!resource();}buttons.get('play').textContent=playing?'暂停':'播放';canvas.dataset.lookId=custom()?'custom':look?.key||'';
  status.textContent=custom()?(state?.phase==='error'?'已应用，形象暂未显示':!resource()?'正在读取形象…':dirty?'检查通过 · 素材预览':'已保存'):!appearance?'尚未取得':failed?(dirty?'选择已保留':'已保存 · 图像暂不可用'):dirty?'预览中':'已保存';status.classList.toggle('previewing',dirty);if(!custom())description.textContent=failed?'形象素材暂时无法显示':look?`${look.label} · ${dirty?'尚未保存':'当前角色'}`:'暂无法显示';retry.hidden=custom()?state?.phase!=='error':!failed;
 }
 const animate=()=>active&&visible&&!document.hidden&&!reduced()&&!disposed&&playing&&(custom()?Boolean(resource()):assets&&!failed&&resolveLook(appearance));
 function frame(time){paint(time);if(animate())raf=requestAnimationFrame(frame);}
 function reconcile(){cancelAnimationFrame(raf);raf=0;if(disposed)return;labels();paint();if(animate())raf=requestAnimationFrame(frame);if(!custom()&&active&&visible&&!assets&&!loading&&!failed)void load();}
 async function load(){loading=true;try{assets=await loadLookAssets();failed=false;}catch{failed=true;}finally{loading=false;if(!disposed)reconcile();}}
 const retry=el('button','stage-asset-retry','重试形象显示');retry.type='button';retry.hidden=true;retry.addEventListener('click',()=>{if(appearance?.kind==='custom'){void retryCustomAppearance(appearance).catch(()=>{});reconcile();}else{failed=false;void load();}});node.append(retry);
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;reconcile();});observer.observe(node);document.addEventListener('visibilitychange',reconcile);motion.addEventListener('change',reconcile);window.addEventListener('avatar:resource',reconcile);const worldMotion=event=>{const next=Boolean(event.detail?.reducedMotion);if(next===worldReduced)return;worldReduced=next;reconcile();};document.addEventListener('world:state',worldMotion);
 return{node,update(value,{displayName='',isDirty=false}={}){if(JSON.stringify(value)!==JSON.stringify(appearance)){override=null;manualFrame=null;player.clear();}appearance=value;dirty=isDirty;name.textContent=displayName||'当前角色';reconcile();},preview(value,{displayName='当前草稿',isDirty=true}={}){if(override?.key!==value.key){player.clear();manualFrame=null;action='idle';}override=value;dirty=isDirty;name.textContent=displayName;reconcile();},clearPreview(){override=null;player.clear();manualFrame=null;reconcile();},active(value){active=value;reconcile();},dispose(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener('visibilitychange',reconcile);motion.removeEventListener('change',reconcile);window.removeEventListener('avatar:resource',reconcile);document.removeEventListener('world:state',worldMotion);}};
}
