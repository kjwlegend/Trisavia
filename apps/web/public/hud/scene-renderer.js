import {$,el,api} from '../common.js';
import {createWorldScene,placeDetails} from '../world-scene.js';
import {loadPixelTown,COMMONS_PLACE} from '../world-pixel/town.js';
import {createOwnedAgentBinding} from './owned-agents.js';
import {createPanelTransition} from './panel-transition.js';
import {createWorldSceneProvider} from './world-scene-provider.js';
import {nativeFrame} from '../world-pixel/native-ui.js';
import {getPanelEnvironment} from './panel-environment.js';
import {createWorldStatusHud} from './world-status.js';
import {createPublicCharacterReader} from './public-character-reader.js';
import {createPublicCharacterCard} from './public-character-card.js';
import {freeAreas} from '../world-safe-area.js';
let scene=null;
export function initSceneRenderer({session,onSelectAgent=()=>{},rendering=null}={}){
let mapReady=false,mapFailed=false,pageActive=true;
let sceneGeneration=0,sceneAbort=null;
const ownedAgents=session?createOwnedAgentBinding(session,onSelectAgent):null;
const worldProvider=createWorldSceneProvider();let worldData=worldProvider.snapshot();
const statusHud=createWorldStatusHud($('#world-status-hud'),{onTime:epoch=>scene?.setTime(epoch)}),stopStatusSession=session?.subscribe(value=>statusHud.select(value.authenticated?value.selectedAgentId:''));
let returnFocus = null;
let currentPlace = null;
const detail=$('#world-detail'),detailTransition=createPanelTransition(detail),environment=getPanelEnvironment();detail.prepend(nativeFrame('lightWood'));
const publicCharacter=createPublicCharacterReader(),characterCard=createPublicCharacterCard(publicCharacter,{session});$('.world-detail-body',detail).prepend(characterCard.node);
function renderDetails(place){
  const character=place.kind==='world-avatar';detail.classList.toggle('is-character-card',character);characterCard.node.hidden=!character;
  $('#world-detail-close').setAttribute('aria-label',character?'关闭角色详情':'关闭场所说明');detail.dataset.agentId=character?place.agentId:'';
  if(character){$('#world-detail-area').textContent='';$('#world-detail-title').textContent='角色资料';$('#world-detail-description').textContent='';$('#world-detail-note').textContent='';return{links:[]};}
  const details=placeDetails(place);$('#world-detail-area').textContent=details.area;$('#world-detail-title').textContent=details.name;$('#world-detail-icon').textContent=details.icon;$('#world-detail-description').textContent=details.description;$('#world-detail-note').textContent=details.note;return details;
}
const list = $('#world-place-list'),places=rendering?.places||[COMMONS_PLACE];
for (const area of [...new Set(places.map(place => place.area))]) {
  const group = el('section', 'world-place-group');
  group.append(el('h3', '', area));
  const buttons = el('div');
  for (const place of places.filter(item => item.area === area)) {
    const button = el('button', 'world-place-button', place.name);
    button.type = 'button';
    button.id = `world-place-${place.id}`;
    button.dataset.placeId = place.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'world-detail');
    button.addEventListener('click', () => openPlace(place, button));
    buttons.append(button);
  }
  group.append(buttons); list.append(group);
}
function positionCharacterCard(){
  if(currentPlace?.kind!=='world-avatar'||detail.hidden||!scene)return;
  const state=scene.getState(),camera=state.camera,box=scene.canvas.getBoundingClientRect(),phone=camera.width<760;
  const anchor={x:box.left+camera.width/2+(currentPlace.x-camera.x)*camera.scale,y:box.top+(state.mode==='overview'?(camera.height+(phone?112:88)-(phone?116:126))/2:camera.height/2)+(currentPlace.y-camera.y)*camera.scale};
  const bounds={left:phone?12:24,right:innerWidth-(phone?12:24),top:phone?Math.max(12,document.querySelector('header')?.getBoundingClientRect().bottom+12||12):24,bottom:phone?Math.min(innerHeight-12,$('#hud-dock')?.getBoundingClientRect().top-12||innerHeight-12):innerHeight-24};
  const maxHeight=Math.min(phone?360:600,bounds.bottom-bounds.top),width=Math.min(phone?320:440,bounds.right-bounds.left);detail.style.setProperty('--character-card-max-height',`${maxHeight}px`);
  const height=Math.min(maxHeight,detail.offsetHeight||maxHeight);
  const blocked=['#world-status-hud','#hud-agent','#hud-locate-agent','.hud-map-tools'].flatMap(selector=>{const node=$(selector);if(!node||node.hidden||!node.getClientRects().length)return[];const rect=node.getBoundingClientRect();return[{left:rect.left-12,right:rect.right+12,top:rect.top-12,bottom:rect.bottom+12}];});
  const areas=freeAreas(bounds,blocked).filter(area=>area.right-area.left>=width&&area.bottom-area.top>=height);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const candidates=(areas.length?areas:[bounds]).flatMap(area=>[anchor.x+12,anchor.x-width-12].map(x=>({x:clamp(x,area.left,area.right-width),y:clamp(anchor.y-80,area.top,area.bottom-height)})));
  candidates.sort((a,b)=>Math.hypot(a.x+width/2-anchor.x,a.y+80-anchor.y)-Math.hypot(b.x+width/2-anchor.x,b.y+80-anchor.y));
  detail.style.setProperty('--character-card-left',`${Math.round(candidates[0].x)}px`);detail.style.setProperty('--character-card-top',`${Math.round(candidates[0].y)}px`);
}
const characterSize=new ResizeObserver(positionCharacterCard);characterSize.observe(characterCard.node);
window.addEventListener('resize',positionCharacterCard);
function openPlace(place, origin) {
  document.dispatchEvent(new CustomEvent('world:place-open'));
  currentPlace = place;
  returnFocus = origin;
  const details = renderDetails(place);if(place.kind==='world-avatar')void publicCharacter.open(place);else publicCharacter.clear();
  const links = $('#world-detail-links'); links.replaceChildren();
  for (const link of details.links || []) { const node = el('a', '', `${link.label} ↗`); node.href = link.href; links.append(node); }
  if(place.id==='noticeboard')for(const [category,label]of [['announcements','查看公开公告'],['events','查看事件计划与发生记录']]){const control=el('button','',label);control.type='button';control.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('hud:world-content',{detail:{category}})));links.append(control);}
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.placeId === place.id));
  environment.set('world',detail);detailTransition.show();positionCharacterCard();
  $('#world-layout').classList.add('has-detail');
  scene?.select(place);
  $('#world-detail').focus({preventScroll: true});

}
function closePlace(restoreFocus=true) {
  if (!currentPlace) return;
  currentPlace = null;publicCharacter.clear();
  environment.set('world',null);detailTransition.hide();
  $('#world-layout').classList.remove('has-detail');
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
  scene?.select(null);
  if(!restoreFocus)return;
  const target = returnFocus?.isConnected ? returnFocus : scene?.canvas || $('#world-place-directory > summary');
  target?.focus({preventScroll: true});

}
function updateControls(state) {
  worldProvider.setVisible(pageActive&&!mapFailed&&state.visible);statusHud.setVisible(pageActive&&!document.hidden&&state.visible);
  document.dispatchEvent(new CustomEvent('world:state',{detail:{exploring:state.exploring,reducedMotion:state.reducedMotion}}));
  $('#world-explore').textContent=state.exploring?'退出探索':'探索地图';
  $('#world-explore').setAttribute('aria-pressed',String(state.exploring));
  $('#world-explore').hidden=state.mode==='overview';$('#world-reset').hidden=state.mode!=='overview';
  $('#world-gesture-hint').textContent=state.exploring?'探索中 · 单指拖动地图 · 退出探索后可向下浏览':'向下浏览了解与接入 · 选择探索地图后可单指拖动';
  $('#world-zoom').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#world-zoom-out').disabled = !mapReady || state.zoom <= state.minZoom + .001;
  $('#world-zoom-in').disabled = !mapReady || state.zoom >= 3;
  $('#world-pause').textContent = state.paused ? '播放动态' : '暂停动态';
  $('#world-pause').setAttribute('aria-pressed', String(state.paused));
  reduceMotion.setAttribute('aria-pressed',String(state.reducedMotion));
  const text = state.worldScene?.phase==='recovering'?'连接正在恢复 · 角色保留最近读取的位置':state.worldScene?.phase!=='demo'?'服务器角色位置按读取结果显示 · 画布动画不代表在线':state.paused ? state.pauseReason === 'reduced' ? '静止展示 · 已遵循系统的减少动态设置' : state.pauseReason === 'performance' ? '静止展示 · 可手动播放演示' : '静止展示 · 演示动态已暂停' : !state.visible ? '演示动态在地图可见时继续' : '人物与环境为演示动态';
  if ($('#world-motion-status').textContent !== text) $('#world-motion-status').textContent = text;
}
async function startScene() {
  const generation=++sceneGeneration;sceneAbort?.abort();sceneAbort=new AbortController();ownedAgents?.attach(null);
  scene?.destroy(); scene = null;mapReady=false;mapFailed=false;setMapAvailable(false);
  $('#world-fallback').hidden = true;
  $('#world-motion-status').textContent = '正在载入世界画布…';
  let loaded;
  try {
    loaded=rendering||await loadPixelTown({signal:sceneAbort.signal});
    if(generation!==sceneGeneration||sceneAbort.signal.aborted){loaded.dispose?.();return;}
    const next = await createWorldScene($('#world-scene'), {rendering:loaded,worldSource:'pending',initialTime:statusHud.clock.now(),clock:statusHud.clock,signal:sceneAbort.signal,onSelect: openPlace, onOwnedSelect:(agentId,origin)=>ownedAgents?.select(agentId,origin), onChange: updateControls, onError:()=>{if(generation===sceneGeneration)mapError();}});
    if(generation!==sceneGeneration){next.destroy();return;}
    scene=next;scene.setWorldScene(worldData);if(!mapFailed)ownedAgents?.attach(scene);
    if(!mapFailed){setMapAvailable(true);updateControls(scene.getState());}
    if (currentPlace) scene.select(currentPlace);
  } catch {loaded?.dispose?.();if(generation===sceneGeneration)mapError(); }
}
function setMapAvailable(value){mapReady=value;for(const id of ['world-zoom-out','world-zoom-in','world-fit','world-pause','world-explore','world-reset','world-reduce-motion'])$(`#${id}`).disabled=!value;$('#world-gesture-hint').hidden=!value;document.dispatchEvent(new CustomEvent('world:availability',{detail:{available:value}}));}
function mapError() {
  mapFailed=true;worldProvider.setVisible(false);ownedAgents?.attach(null);setMapAvailable(false);
  $('#world-fallback').hidden = false;
  $('#world-place-directory').open = true;
  $('#world-motion-status').textContent = '地图暂不可用 · 场所列表仍可查看';
}
document.addEventListener('hud:open',()=>closePlace(false));
$('#world-detail-close').addEventListener('click', closePlace);
$('#world-back').addEventListener('click', closePlace);
document.addEventListener('keydown', event => {if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('#hud-window:not([hidden]):not([data-panel-state=closing])')||detailTransition.state==='closing'||event.target.closest?.('input,textarea,select,[contenteditable=true]'))return;if(currentPlace){event.preventDefault();closePlace();}else if(scene?.getState().exploring){event.preventDefault();scene.setExploring(false);scene.canvas.focus({preventScroll:true});}});
$('#world-zoom-out').addEventListener('click', () => { if (scene) scene.setZoom(scene.getState().zoom - .25); });
$('#world-zoom-in').addEventListener('click', () => { if (scene) scene.setZoom(scene.getState().zoom + .25); });
$('#world-fit').addEventListener('click', () => scene?.fit());
$('#world-explore').addEventListener('click',()=>scene?.setExploring(!scene.getState().exploring));
$('#world-reset').addEventListener('click',()=>scene?.reset());
$('#world-open-list').addEventListener('click',()=>{$('#world-place-directory').open=true;$('#world-place-directory').scrollIntoView({block:'start',behavior:'instant'});$('#world-place-directory > summary').focus({preventScroll:true});});
$('#world-pause').addEventListener('click', () => { if (scene) scene.setPaused(!scene.getState().paused); });
$('#world-retry').addEventListener('click', startScene);
const reduceMotion=el('button','','减少动态');reduceMotion.id='world-reduce-motion';reduceMotion.type='button';reduceMotion.setAttribute('aria-pressed','false');reduceMotion.addEventListener('click',()=>{if(scene)scene.setReducedMotion(!scene.getState().reducedMotion);});($('#hud-map-menu')||$('.world-controls')).append(reduceMotion);
const refreshWorld=el('button','','刷新世界'),moreWorld=el('button','','继续载入角色');refreshWorld.id='world-refresh';moreWorld.id='world-load-more';refreshWorld.type=moreWorld.type='button';moreWorld.hidden=true;
($('#hud-map-menu')||$('.world-controls')).append(refreshWorld,moreWorld);
refreshWorld.addEventListener('click',()=>void worldProvider.refresh());moreWorld.addEventListener('click',()=>void worldProvider.loadMore());
worldProvider.subscribe(value=>{
  worldData=value;statusHud.update(value);const applied=scene?.setWorldScene(value);if(applied?.accepted===false)value={...value,phase:'unavailable',avatars:[],complete:false,errorCode:applied.reason};refreshWorld.hidden=false;refreshWorld.disabled=Boolean(value.errorStatus===429&&value.retryAt&&value.retryAt>Date.now());moreWorld.hidden=value.phase!=='partial';
  worldData=value;if(applied?.accepted===false)statusHud.update(value);
  if(currentPlace?.kind==='world-npc'&&(!value.complete||!value.npcs?.some(npc=>npc.npcId===currentPlace.id)))closePlace(false);
  if(currentPlace?.kind==='world-avatar'){
    const row=value.complete?value.avatars.find(avatar=>avatar.agentId===currentPlace.agentId):null;
    if(!row)closePlace(false);
    else{const renderedState=scene?.getState().worldScene,rendered=renderedState?.avatars.find(avatar=>avatar.fact.agentId===row.agentId);currentPlace={...row,kind:'world-avatar',projectionVersion:renderedState?.projectionVersion,x:rendered?.x??currentPlace.x,y:rendered?.y??currentPlace.y};void publicCharacter.observe(currentPlace);scene?.select(currentPlace);}
  }
});
const entryCopy=$('#world-entry-capabilities');let entryVisible=false,entryGeneration=0,entryAbort=null;
function stopEntryRead(){entryGeneration++;entryAbort?.abort();entryAbort=null;}
async function readEntryCapabilities(){
  stopEntryRead();if(!entryCopy||!entryVisible||!pageActive||document.hidden)return;
  const generation=entryGeneration,controller=new AbortController();entryAbort=controller;entryCopy.textContent=entryCapabilityText(null);
  try{const caps=await api('/capabilities',{signal:controller.signal});if(generation===entryGeneration&&!controller.signal.aborted&&pageActive&&!document.hidden)entryCopy.textContent=entryCapabilityText(caps);}
  catch(error){if(generation===entryGeneration&&!controller.signal.aborted&&error.name!=='AbortError')entryCopy.textContent=entryCapabilityText(null);}
}
const entryObserver=entryCopy?new IntersectionObserver(entries=>{const next=entries[0].isIntersecting;if(next===entryVisible)return;entryVisible=next;if(next)void readEntryCapabilities();else stopEntryRead();},{threshold:.01}):null;if(entryCopy)entryObserver.observe(entryCopy);
document.addEventListener('visibilitychange',()=>{statusHud.setVisible(pageActive&&!document.hidden&&scene?.getState().visible!==false);if(document.hidden)stopEntryRead();else if(entryVisible)void readEntryCapabilities();});
for (const link of document.querySelectorAll('a[href="#connect"]')) link.addEventListener('click', () => { $('#connect').open = true; });
if (location.hash === '#connect') $('#connect').open = true;
startScene();worldProvider.start();
window.addEventListener('pagehide', event => {pageActive=false;stopEntryRead();worldProvider.setVisible(false);statusHud.setVisible(false);if (!event.persisted){entryObserver?.disconnect();sceneGeneration++;sceneAbort?.abort();worldProvider.dispose();statusHud.dispose();stopStatusSession?.();ownedAgents?.dispose();characterCard.dispose();publicCharacter.dispose();window.removeEventListener('resize',positionCharacterCard);characterSize.disconnect();detailTransition.destroy();scene?.destroy();} });
window.addEventListener('pageshow',()=>{pageActive=true;if(scene&&!mapFailed){worldProvider.setVisible(scene.getState().visible);statusHud.setVisible(scene.getState().visible&&!document.hidden);}if(entryVisible)void readEntryCapabilities();});
return{locateAgent(agentId){return mapReady&&scene?.locateOwnedAgent(agentId)||false;}};
}
export function getWorldState(){return scene?.getState()??null;}
function entryCapabilityText(caps){
  if(caps?.apiVersion!=='v1')return'当前暂时无法确认感知与互动是否开放。可先阅读接入说明；Agent 仍在自己的工具中运行，由它自行发起访问，平台不会代为唤醒它。';
  const interaction=caps.gateway?.protocolVersion===1&&Array.isArray(caps.gateway.modules)?caps.gateway.modules.includes('interaction'):caps.interaction;
  const perception=caps.perception===true?'感知读取已开放':caps.perception===false?'感知读取暂未开放':'感知读取状态尚待确认',interactions=interaction===true?'互动已开放':interaction===false?'互动暂未开放':'互动状态尚待确认';
  return`可让自己的 Agent 注册、设定角色、加入与关联主人。${perception}，${interactions}，实际操作仍须符合当前权限。Agent 在自己的工具中运行，需要自行发起访问与互动；平台不会代为唤醒它。${caps.gateway?.worldSimulation?.enabled===true?'已提交的移动安排会由世界规则推进位置。':''}`;
}
