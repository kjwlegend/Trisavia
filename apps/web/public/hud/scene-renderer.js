import {$,el} from '../common.js';
import {createWorldScene,places,placeDetails} from '../world-scene.js';
import {createOwnedAgentBinding} from './owned-agents.js';
import {createPanelTransition} from './panel-transition.js';
import {createWorldSceneProvider} from './world-scene-provider.js';
let scene=null;
export function initSceneRenderer({session,onSelectAgent=()=>{}}={}){
let mapReady=false,mapFailed=false,pageActive=true;
let sceneGeneration=0,sceneAbort=null;
const ownedAgents=session?createOwnedAgentBinding(session,onSelectAgent):null;
const worldProvider=createWorldSceneProvider();let worldData=worldProvider.snapshot();
let returnFocus = null;
let currentPlace = null;
const detail=$('#world-detail'),detailTransition=createPanelTransition(detail);
const list = $('#world-place-list');
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
  const details = placeDetails(place);
  $('#world-detail-area').textContent = details.area;
  $('#world-detail-title').textContent = details.name;
  $('#world-detail-icon').textContent = details.icon;
  $('#world-detail-description').textContent = details.description;
  $('#world-detail-note').textContent = details.note;
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
  const text = state.worldScene?.phase!=='demo'?'服务器角色位置按读取结果显示 · 画布动画不代表在线':state.paused ? state.pauseReason === 'reduced' ? '静止展示 · 已遵循系统的减少动态设置' : state.pauseReason === 'performance' ? '静止展示 · 可手动播放演示' : '静止展示 · 演示动态已暂停' : !state.visible ? '演示动态在地图可见时继续' : '人物与环境为演示动态';
  if ($('#world-motion-status').textContent !== text) $('#world-motion-status').textContent = text;
}
async function startScene() {
  const generation=++sceneGeneration;sceneAbort?.abort();sceneAbort=new AbortController();ownedAgents?.attach(null);
  scene?.destroy(); scene = null;mapReady=false;mapFailed=false;setMapAvailable(false);
  $('#world-fallback').hidden = true;
  $('#world-motion-status').textContent = '正在载入世界画布…';
  try {
    const next = await createWorldScene($('#world-scene'), {worldSource:'pending',signal:sceneAbort.signal,onSelect: openPlace, onOwnedSelect:(agentId,origin)=>ownedAgents?.select(agentId,origin), onChange: updateControls, onError:()=>{if(generation===sceneGeneration)mapError();}});
    if(generation!==sceneGeneration){next.destroy();return;}
    scene=next;scene.setWorldScene(worldData);if(!mapFailed)ownedAgents?.attach(scene);
    if(!mapFailed){setMapAvailable(true);updateControls(scene.getState());}
    if (currentPlace) scene.select(currentPlace);
  } catch { if(generation===sceneGeneration)mapError(); }
}
function setMapAvailable(value){mapReady=value;for(const id of ['world-zoom-out','world-zoom-in','world-fit','world-pause','world-explore','world-reset'])$(`#${id}`).disabled=!value;$('#world-gesture-hint').hidden=!value;document.dispatchEvent(new CustomEvent('world:availability',{detail:{available:value}}));}
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
const refreshWorld=el('button','','刷新世界'),moreWorld=el('button','','继续载入角色');refreshWorld.id='world-refresh';moreWorld.id='world-load-more';refreshWorld.type=moreWorld.type='button';moreWorld.hidden=true;
($('#hud-map-menu')||$('.world-controls')).append(refreshWorld,moreWorld);
refreshWorld.addEventListener('click',()=>void worldProvider.refresh());moreWorld.addEventListener('click',()=>void worldProvider.loadMore());
worldProvider.subscribe(value=>{
  worldData=value;scene?.setWorldScene(value);refreshWorld.hidden=value.phase==='demo';moreWorld.hidden=value.phase!=='partial';
  const source=$('.world-demo'),summary=$('summary',source),body=$('p',source);source.dataset.worldPhase=value.phase;
  summary.textContent=value.phase==='demo'?'演示世界 · 客户端动画不代表在线':value.phase==='ready'?`服务器世界 · ${value.avatars.length} 个公开角色`:value.phase==='partial'?`服务器世界 · 已载入 ${value.avatars.length} 个角色（未完整）`:value.phase==='refreshing'?'服务器世界 · 正在刷新':value.phase==='paused'?'世界读取已暂停':value.phase==='loading'?'正在读取服务器世界…':'服务器世界暂不可用 · 可重试';
  body.textContent=value.phase==='demo'?'当前服务未启用世界核心。人物与环境为本地演示，自有角色动画不代表在线。':['ready','partial','refreshing'].includes(value.phase)?`${value.avatars.length===0&&value.complete?'当前公开世界没有可显示的角色。':''}角色名称与位置来自服务器；${value.complete?'本次集合已完整读取。':'当前集合尚未完整。'}读取时间：${new Date(value.asOf).toLocaleString('zh-CN',{hour12:false})}。逻辑坐标采用 logical-grid-to-town@1 投影，背景道路与场所仅为演示，不代表真实到访、在线或移动目的地。`:value.phase==='paused'?'场景不可见时停止读取，返回后重新取得服务器事实。':value.phase==='loading'?'正在取得当前世界规则与公开角色，不使用演示角色补齐。':value.errorCode==='world_cursor_invalid'||value.errorCode==='world_scene_changed'?'世界集合已变化，旧角色资料已清除。请刷新世界，从头读取。':'当前无法确认公开角色，旧角色资料已清除。请通过更多地图工具中的“刷新世界”重试。';
  if(currentPlace?.kind==='world-avatar'){
    const row=value.avatars.find(avatar=>avatar.agentId===currentPlace.agentId);
    if(!row)closePlace(false);
    else{const rendered=scene?.getState().worldScene.avatars.find(avatar=>avatar.fact.agentId===row.agentId);currentPlace={...row,kind:'world-avatar',x:rendered?.x??currentPlace.x,y:rendered?.y??currentPlace.y};const details=placeDetails(currentPlace);$('#world-detail-title').textContent=details.name;$('#world-detail-description').textContent=details.description;scene?.select(currentPlace);}
  }
});
for (const link of document.querySelectorAll('a[href="#connect"]')) link.addEventListener('click', () => { $('#connect').open = true; });
if (location.hash === '#connect') $('#connect').open = true;
startScene();worldProvider.start();
window.addEventListener('pagehide', event => {pageActive=false;worldProvider.setVisible(false);if (!event.persisted){sceneGeneration++;sceneAbort?.abort();worldProvider.dispose();ownedAgents?.dispose();detailTransition.destroy();scene?.destroy();} });
window.addEventListener('pageshow',()=>{pageActive=true;if(scene&&!mapFailed)worldProvider.setVisible(scene.getState().visible);});
return{locateAgent(agentId){return mapReady&&scene?.locateOwnedAgent(agentId)||false;}};
}
export function getWorldState(){return scene?.getState()??null;}
