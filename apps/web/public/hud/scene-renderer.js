import {$,el,api} from '../common.js';
import {createWorldScene,placeDetails} from '../world-scene.js';
import {loadPixelTown,COMMONS_PLACE} from '../world-pixel/town.js';
import {createOwnedAgentBinding} from './owned-agents.js';
import {createPanelTransition} from './panel-transition.js';
import {createWorldSceneProvider} from './world-scene-provider.js';
let scene=null;
export function initSceneRenderer({session,onSelectAgent=()=>{},rendering=null}={}){
let mapReady=false,mapFailed=false,pageActive=true;
let sceneGeneration=0,sceneAbort=null;
const ownedAgents=session?createOwnedAgentBinding(session,onSelectAgent):null;
const worldProvider=createWorldSceneProvider();let worldData=worldProvider.snapshot();
let returnFocus = null;
let currentPlace = null;
const detail=$('#world-detail'),detailTransition=createPanelTransition(detail);
const debug=el('details'),debugBody=el('dl','hud-facts');debug.id='world-detail-debug';debug.hidden=true;debug.append(el('summary','','技术信息'),debugBody);$('#world-detail-note').after(debug);
function renderDetails(place,reset=false){
  const details=placeDetails(place);$('#world-detail-area').textContent=details.area;$('#world-detail-title').textContent=details.name;$('#world-detail-icon').textContent=details.icon;$('#world-detail-description').textContent=details.description;$('#world-detail-note').textContent=place.kind==='world-avatar'&&worldData.phase==='recovering'?`连接正在恢复。这里保留 ${new Date(worldData.asOf).toLocaleString('zh-CN',{hour12:false})} 读取的公开记录。${details.note}`:details.note;
  $('#world-detail-close').setAttribute('aria-label',place.kind==='world-avatar'?'关闭角色详情':'关闭场所说明');detail.dataset.agentId=place.kind==='world-avatar'?place.agentId:'';
  debug.hidden=!details.debug;if(reset)debug.open=false;debugBody.replaceChildren();for(const [label,value]of details.debug||[])debugBody.append(el('dt','',label),el('dd','',value));return details;
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
function openPlace(place, origin) {
  document.dispatchEvent(new CustomEvent('world:place-open'));
  currentPlace = place;
  returnFocus = origin;
  const details = renderDetails(place,true);
  const links = $('#world-detail-links'); links.replaceChildren();
  for (const link of details.links || []) { const node = el('a', '', `${link.label} ↗`); node.href = link.href; links.append(node); }
  if(place.id==='noticeboard')for(const [category,label]of [['announcements','查看公开公告'],['events','查看事件计划与发生记录']]){const control=el('button','',label);control.type='button';control.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('hud:world-content',{detail:{category}})));links.append(control);}
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.placeId === place.id));
  detailTransition.show();
  $('#world-layout').classList.add('has-detail');
  scene?.select(place);
  $('#world-detail').focus({preventScroll: true});
  if (origin !== scene?.canvas) $('#world-layout').scrollIntoView({block:'start',behavior:'instant'});
}
function closePlace(restoreFocus=true) {
  if (!currentPlace) return;
  currentPlace = null;
  detailTransition.hide();
  $('#world-layout').classList.remove('has-detail');
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
  scene?.select(null);
  if(!restoreFocus)return;
  const target = returnFocus?.isConnected ? returnFocus : scene?.canvas || $('#world-place-directory > summary');
  target?.focus({preventScroll: true});
  if (target !== scene?.canvas) target?.scrollIntoView({block:'nearest',behavior:'instant'});
}
function updateControls(state) {
  worldProvider.setVisible(pageActive&&!mapFailed&&state.visible);
  document.dispatchEvent(new CustomEvent('world:state',{detail:{exploring:state.exploring}}));
  $('#world-explore').textContent=state.exploring?'退出探索':'探索地图';
  $('#world-explore').setAttribute('aria-pressed',String(state.exploring));
  $('#world-explore').hidden=state.mode==='overview';$('#world-reset').hidden=state.mode!=='overview';
  $('#world-gesture-hint').textContent=state.exploring?'探索中 · 单指拖动地图 · 退出探索后可向下浏览':'向下浏览了解与接入 · 选择探索地图后可单指拖动';
  $('#world-zoom').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#world-zoom-out').disabled = !mapReady || state.zoom <= state.minZoom + .001;
  $('#world-zoom-in').disabled = !mapReady || state.zoom >= 3;
  $('#world-pause').textContent = state.paused ? '播放动态' : '暂停动态';
  $('#world-pause').setAttribute('aria-pressed', String(state.paused));
  for(const [key,button]of themeButtons)button.setAttribute('aria-pressed',String(state.theme===key));reduceMotion.setAttribute('aria-pressed',String(state.reducedMotion));
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
    const next = await createWorldScene($('#world-scene'), {rendering:loaded,worldSource:'pending',signal:sceneAbort.signal,onSelect: openPlace, onOwnedSelect:(agentId,origin)=>ownedAgents?.select(agentId,origin), onChange: updateControls, onError:()=>{if(generation===sceneGeneration)mapError();}});
    if(generation!==sceneGeneration){next.destroy();return;}
    scene=next;scene.setWorldScene(worldData);if(!mapFailed)ownedAgents?.attach(scene);
    if(!mapFailed){setMapAvailable(true);updateControls(scene.getState());}
    if (currentPlace) scene.select(currentPlace);
  } catch {loaded?.dispose?.();if(generation===sceneGeneration)mapError(); }
}
function setMapAvailable(value){mapReady=value;for(const id of ['world-zoom-out','world-zoom-in','world-fit','world-pause','world-explore','world-reset','world-theme-day','world-theme-dusk','world-reduce-motion'])$(`#${id}`).disabled=!value;$('#world-gesture-hint').hidden=!value;document.dispatchEvent(new CustomEvent('world:availability',{detail:{available:value}}));}
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
const themeButtons=new Map();for(const [key,label]of [['day','日间'],['dusk','黄昏']]){const button=el('button','',label);button.id=`world-theme-${key}`;button.type='button';button.setAttribute('aria-pressed',String(key==='day'));button.addEventListener('click',()=>scene?.setTheme(key));themeButtons.set(key,button);($('#hud-map-menu')||$('.world-controls')).append(button);}
const reduceMotion=el('button','','减少动态');reduceMotion.id='world-reduce-motion';reduceMotion.type='button';reduceMotion.setAttribute('aria-pressed','false');reduceMotion.addEventListener('click',()=>{if(scene)scene.setReducedMotion(!scene.getState().reducedMotion);});($('#hud-map-menu')||$('.world-controls')).append(reduceMotion);
const refreshWorld=el('button','','刷新世界'),moreWorld=el('button','','继续载入角色');refreshWorld.id='world-refresh';moreWorld.id='world-load-more';refreshWorld.type=moreWorld.type='button';moreWorld.hidden=true;
($('#hud-map-menu')||$('.world-controls')).append(refreshWorld,moreWorld);
refreshWorld.addEventListener('click',()=>void worldProvider.refresh());moreWorld.addEventListener('click',()=>void worldProvider.loadMore());
worldProvider.subscribe(value=>{
  worldData=value;const applied=scene?.setWorldScene(value);if(applied?.accepted===false)value={...value,phase:'unavailable',avatars:[],complete:false,errorCode:applied.reason};refreshWorld.hidden=false;refreshWorld.disabled=Boolean(value.errorStatus===429&&value.retryAt&&value.retryAt>Date.now());moreWorld.hidden=value.phase!=='partial';
  const source=$('.world-demo'),summary=$('summary',source),body=$('p',source);source.dataset.worldPhase=value.phase;
  summary.textContent=value.phase==='ready'?`服务器世界 · ${value.avatars.length} 个公开角色`:value.phase==='recovering'?'连接中断 · 正在恢复，显示上次画面':value.phase==='partial'?`服务器世界 · 已载入 ${value.avatars.length} 个角色（完整后显示）`:value.phase==='refreshing'?'服务器世界 · 正在刷新':value.phase==='paused'?'世界读取已暂停':value.phase==='loading'?'正在读取服务器世界…':'服务器世界暂不可用 · 正在重试';
  const retryReason=value.errorStatus===429?'读取较频繁，正在等待后重试。':value.errorStatus>=500?'服务暂忙，正在尝试恢复。':'网络暂时中断，正在尝试恢复。';
  body.textContent=value.phase==='recovering'?`${retryReason}当前保留最后成功读取的公开画面，读取时间：${new Date(value.asOf).toLocaleString('zh-CN',{hour12:false})}。这不是当前已连接的状态；恢复后会按最新结果更新。`:['ready','partial','refreshing'].includes(value.phase)?`${value.avatars.length===0&&value.complete?'当前公开世界没有可显示的角色。':''}角色名称与位置来自服务器；${value.complete?'本次集合已完整读取。':'当前集合尚未完整。'}读取时间：${new Date(value.asOf).toLocaleString('zh-CN',{hour12:false})}。当前开放：公共庭；周边街区为景观预览，不代表真实到访、在线或移动目的地。发型为本地表现映射，不表示已保存的发型选择。`:value.phase==='paused'?'场景不可见时停止读取，返回后重新取得服务器事实。':value.phase==='loading'?'正在取得当前世界规则与公开角色，不使用演示角色补齐。':value.errorCode==='world_not_available'?'当前世界尚未开放或未就绪，旧角色资料已清除。稍后会重新确认。':['world_cursor_invalid','world_scene_changed','world_response_invalid'].includes(value.errorCode)?'世界集合或版本已变化，旧角色资料已清除。正在从头重新确认。':['world_not_accessible','not_found'].includes(value.errorCode)||[401,403,404].includes(value.errorStatus)?'当前公开世界不可查看，旧角色资料已清除。稍后会重新确认。':`${retryReason}当前没有可显示的成功读取画面。`;
  if(currentPlace?.kind==='world-avatar'){
    const row=value.complete?value.avatars.find(avatar=>avatar.agentId===currentPlace.agentId):null;
    if(!row)closePlace(false);
    else{const renderedState=scene?.getState().worldScene,rendered=renderedState?.avatars.find(avatar=>avatar.fact.agentId===row.agentId);currentPlace={...row,kind:'world-avatar',projectionVersion:renderedState?.projectionVersion,x:rendered?.x??currentPlace.x,y:rendered?.y??currentPlace.y};renderDetails(currentPlace);scene?.select(currentPlace);}
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
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopEntryRead();else if(entryVisible)void readEntryCapabilities();});
for (const link of document.querySelectorAll('a[href="#connect"]')) link.addEventListener('click', () => { $('#connect').open = true; });
if (location.hash === '#connect') $('#connect').open = true;
startScene();worldProvider.start();
window.addEventListener('pagehide', event => {pageActive=false;stopEntryRead();worldProvider.setVisible(false);if (!event.persisted){entryObserver?.disconnect();sceneGeneration++;sceneAbort?.abort();worldProvider.dispose();ownedAgents?.dispose();detailTransition.destroy();scene?.destroy();} });
window.addEventListener('pageshow',()=>{pageActive=true;if(scene&&!mapFailed)worldProvider.setVisible(scene.getState().visible);if(entryVisible)void readEntryCapabilities();});
return{locateAgent(agentId){return mapReady&&scene?.locateOwnedAgent(agentId)||false;}};
}
export function getWorldState(){return scene?.getState()??null;}
function entryCapabilityText(caps){
  if(caps?.apiVersion!=='v1')return'当前暂时无法确认感知与互动是否开放。可先阅读接入说明；Agent 仍在自己的工具中运行，由它自行发起访问，平台不会代为唤醒它。';
  const interaction=caps.gateway?.protocolVersion===1&&Array.isArray(caps.gateway.modules)?caps.gateway.modules.includes('interaction'):caps.interaction;
  const perception=caps.perception===true?'感知读取已开放':caps.perception===false?'感知读取暂未开放':'感知读取状态尚待确认',interactions=interaction===true?'互动已开放':interaction===false?'互动暂未开放':'互动状态尚待确认';
  return`可让自己的 Agent 注册、设定角色、加入与关联主人。${perception}，${interactions}，实际操作仍须符合当前权限。Agent 在自己的工具中运行，需要自行发起访问与互动；平台不会代为唤醒它。${caps.gateway?.worldSimulation?.enabled===true?'已提交的移动安排会由世界规则推进位置。':''}`;
}
