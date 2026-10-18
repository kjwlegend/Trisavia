import {$,el} from '../common.js';
import {createWorldScene,places,placeDetails} from '../world-scene.js';
let scene=null;
export function initSceneRenderer(){
let mapReady=false,mapFailed=false;
let returnFocus = null;
let currentPlace = null;
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
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.placeId === place.id));
  $('#world-detail').hidden = false;
  $('#world-layout').classList.add('has-detail');
  scene?.select(place);
  $('#world-detail').focus({preventScroll: true});
  if (origin !== scene?.canvas) $('#world-layout').scrollIntoView({block:'start',behavior:'instant'});
}
function closePlace(restoreFocus=true) {
  if ($('#world-detail').hidden) return;
  currentPlace = null;
  $('#world-detail').hidden = true;
  $('#world-layout').classList.remove('has-detail');
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
  scene?.select(null);
  if(!restoreFocus)return;
  const target = returnFocus?.isConnected ? returnFocus : scene?.canvas || $('#world-place-directory > summary');
  target?.focus({preventScroll: true});
  if (target !== scene?.canvas) target?.scrollIntoView({block:'nearest',behavior:'instant'});
}
function updateControls(state) {
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
  const text = state.paused ? state.pauseReason === 'reduced' ? '静止展示 · 已遵循系统的减少动态设置' : state.pauseReason === 'performance' ? '静止展示 · 可手动播放演示' : '静止展示 · 演示动态已暂停' : !state.visible ? '演示动态在地图可见时继续' : '人物与环境为演示动态';
  if ($('#world-motion-status').textContent !== text) $('#world-motion-status').textContent = text;
}
async function startScene() {
  scene?.destroy(); scene = null;mapReady=false;mapFailed=false;setMapAvailable(false);
  $('#world-fallback').hidden = true;
  $('#world-motion-status').textContent = '正在铺开演示地图…';
  try {
    scene = await createWorldScene($('#world-scene'), {onSelect: openPlace, onChange: updateControls, onError: mapError});
    if(!mapFailed){setMapAvailable(true);updateControls(scene.getState());}
    if (currentPlace) scene.select(currentPlace);
  } catch { mapError(); }
}
function setMapAvailable(value){mapReady=value;for(const id of ['world-zoom-out','world-zoom-in','world-fit','world-pause','world-explore','world-reset'])$(`#${id}`).disabled=!value;$('#world-gesture-hint').hidden=!value;}
function mapError() {
  mapFailed=true;setMapAvailable(false);
  $('#world-fallback').hidden = false;
  $('#world-place-directory').open = true;
  $('#world-motion-status').textContent = '地图暂不可用 · 场所列表仍可查看';
}
document.addEventListener('hud:open',()=>closePlace(false));
$('#world-detail-close').addEventListener('click', closePlace);
$('#world-back').addEventListener('click', closePlace);
document.addEventListener('keydown', event => {if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('#hud-window:not([hidden])')||event.target.closest?.('input,textarea,select,[contenteditable=true]'))return;if(!$('#world-detail').hidden){event.preventDefault();closePlace();}else if(scene?.getState().exploring){event.preventDefault();scene.setExploring(false);scene.canvas.focus({preventScroll:true});}});
$('#world-zoom-out').addEventListener('click', () => { if (scene) scene.setZoom(scene.getState().zoom - .25); });
$('#world-zoom-in').addEventListener('click', () => { if (scene) scene.setZoom(scene.getState().zoom + .25); });
$('#world-fit').addEventListener('click', () => scene?.fit());
$('#world-explore').addEventListener('click',()=>scene?.setExploring(!scene.getState().exploring));
$('#world-reset').addEventListener('click',()=>scene?.reset());
$('#world-open-list').addEventListener('click',()=>{$('#world-place-directory').open=true;$('#world-place-directory').scrollIntoView({block:'start',behavior:'instant'});$('#world-place-directory > summary').focus({preventScroll:true});});
$('#world-pause').addEventListener('click', () => { if (scene) scene.setPaused(!scene.getState().paused); });
$('#world-retry').addEventListener('click', startScene);
for (const link of document.querySelectorAll('a[href="#connect"]')) link.addEventListener('click', () => { $('#connect').open = true; });
if (location.hash === '#connect') $('#connect').open = true;
startScene();
window.addEventListener('pagehide', event => { if (!event.persisted) scene?.destroy(); });


}
export function getWorldState(){return scene?.getState()??null;}
