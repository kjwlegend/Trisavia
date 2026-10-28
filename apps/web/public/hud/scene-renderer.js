import {createLifePlaceCard,lifeBuilding} from './life-place-card.js';
import {readPublicId} from '../public-id.js';
import {$,el,api} from '../common.js';
import {msg,t,isMessage,bindText,bindAttribute,clearBinding} from '../i18n/core.js';
import {readPublicCapabilities} from '../public-capabilities.js';
import {createWorldScene,placeDetails} from '../world-scene.js';
import {loadPixelTown,COMMONS_PLACE,placeListSource} from '../world-pixel/town.js';
import {createOwnedAgentBinding} from './owned-agents.js';
import {createPanelTransition} from './panel-transition.js';
import {createWorldSceneProvider} from './world-scene-provider.js';
import {nativeFrame} from '../world-pixel/native-ui.js';
import {getPanelEnvironment} from './panel-environment.js';
import {createWorldStatusHud} from './world-status.js';
import {createPublicCharacterReader} from './public-character-reader.js';
import {createPublicCharacterCard} from './public-character-card.js';
import {freeAreas} from '../world-safe-area.js';
import {emitWorldAudio} from '../world-audio.js';
import {createTownServiceCard,readTownNotice} from './town-services.js';
import {pixelPoint} from '../world-pixel/map.js';
import {icon} from './icons.js';
import {createNpcLifeDirectoryReader} from './npc-life-reader.js';
import {npcLifePlace} from './npc-life-place.js';
import {createNpcPersonCard} from './npc-person-card.js';
import {createPlaceProfileCard,placeProfileTargetId} from './place-profile-card.js';
import {bindOfficialFields} from './official-content.js';
let scene=null;
export function initSceneRenderer({session,onSelectAgent=()=>{},rendering=null}={}){
let mapReady=false,mapFailed=false,pageActive=true,firstSceneMarked=false;
let sceneGeneration=0,sceneAbort=null;
const ownedAgents=session?createOwnedAgentBinding(session,onSelectAgent):null;
const worldProvider=createWorldSceneProvider({canReadStartup:()=>!session||session.hudContext?.()?.kind==='guest'});let worldData=worldProvider.snapshot();const npcLifeDirectory=createNpcLifeDirectoryReader({getRules:()=>worldData.rules,request:async(path,options)=>{const instance=worldData.instanceId,result=await api(path,options);if(instance!==worldData.instanceId||result.instanceId!==instance)throw Object.assign(Error('npc_life_instance_changed'),{code:'npc_life_instance_changed'});return result;}});
function syncNpcLifeDirectory(visible=scene?.getState().visible??true){npcLifeDirectory.setActive(visible&&!mapFailed&&pageActive&&!document.hidden&&worldData.complete&&!worldData.stale&&['ready','refreshing'].includes(worldData.phase)&&worldData.npcs.some(n=>n.npcId==='npc-gardener'));}
const stopNpcLifeDirectory=npcLifeDirectory.subscribe(value=>scene?.setNpcLifeDirectory(value));
const statusHud=createWorldStatusHud($('#world-status-hud'),{onTime:epoch=>scene?.setTime(epoch)}),stopStatusSession=session?.subscribe(value=>statusHud.select(value.authenticated?value.selectedAgentId:''));
let returnFocus = null;
let currentPlace = null,currentTownVersion=null;
let publicFocus=null,publicFocusGeneration=0;
const focusNotice=el('section','world-public-focus-notice'),focusText=el('p'),focusRetry=el('button','','重试定位');focusNotice.hidden=true;focusNotice.setAttribute('role','status');focusRetry.type='button';focusNotice.append(focusText,focusRetry);$('#world-scene').parentNode.append(focusNotice);
const uiBindings=new WeakMap();
function uiText(node,key,original,params){const old=uiBindings.get(node);if(old?.key===key&&old.params===params)return;clearBinding(node);node.removeAttribute('data-i18n');node.textContent=original;bindText(node,key,params);uiBindings.set(node,{key,params});}
function focusMessage(text,retry=false,key){focusNotice.hidden=!text;if(key)uiText(focusText,'public:'+key,text);else{uiBindings.delete(focusText);clearBinding(focusText);focusText.textContent=text;}focusRetry.hidden=!retry;}
uiText(focusRetry,'public:scene.retryLocate','重试定位');
function cancelPublicFocus(){publicFocusGeneration++;publicFocus=null;focusMessage('');}
function publicPlace(row){const state=scene?.getState().worldScene,rendered=state?.avatars.find(avatar=>avatar.fact.agentId===row.agentId);return rendered?{...row,sceneStale:worldData.stale===true,kind:'world-avatar',projectionVersion:state.projectionVersion,x:rendered.x,y:rendered.y}:null;}
async function tryPublicFocus(){
  const pending=publicFocus;if(!pending||pending.reading||!pending.waiting||!mapReady)return;
  if(['error','unavailable','recovering'].includes(worldData.phase)){pending.waiting=false;focusMessage('当前无法取得这位居民的最新公开位置，请稍后重试。',true,'scene.locateUnavailable');return;}
  if(worldData.phase!=='ready')return;
  if(!worldData.complete||!worldData.lastSuccessAt||Date.now()-worldData.lastSuccessAt>5000){pending.waiting=false;focusMessage('公开位置尚未更新，暂时无法定位，请重试。',true,'scene.locateStale');return;}
  const row=worldData.avatars.find(avatar=>(avatar.agentId===pending.agentId||avatar.publicId===pending.agentId));if(!row){pending.waiting=false;focusMessage('当前公开场景中没有这位居民的可定位位置。',true,'scene.locateMissing');return;}
  const initialPlace=publicPlace(row);if(!initialPlace){pending.waiting=false;focusMessage('地图暂时无法定位这位居民，请重试。',true,'scene.locateMapUnavailable');return;}
  pending.reading=true;const turn=publicFocusGeneration;await publicCharacter.open(initialPlace);
  if(turn!==publicFocusGeneration||publicFocus!==pending)return;pending.reading=false;pending.waiting=false;
  const profile=publicCharacter.snapshot(),latest=worldData.phase==='ready'&&worldData.complete&&Date.now()-worldData.lastSuccessAt<=5000?worldData.avatars.find(avatar=>(avatar.agentId===pending.agentId||avatar.publicId===pending.agentId)):null;
  if(profile.phase!=='ready'){focusMessage([403,404].includes(profile.errorStatus)?'这位居民的公开档案暂不可查看。':'暂时无法确认公开资料，请重试定位。',true,[403,404].includes(profile.errorStatus)?'scene.locateHidden':'scene.locateProfileUnknown');return;}
  if(!latest||profile.data.publishedVersion<latest.profile.publishedVersion){focusMessage('公开位置或资料已更新，暂时无法定位，请重试。',true,'scene.locateChanged');return;}
  const place=publicPlace(latest);if(!place||!scene.locateOwnedAgent(latest.agentId)){focusMessage('地图暂时无法定位这位居民，请重试。',true,'scene.locateMapUnavailable');return;}
  publicCharacter.observe(place);publicFocus=null;focusMessage('');openPlace(place,scene.canvas,{reuseProfile:true,fromPublicFocus:true});
}
function focusPublicResident(agentId){cancelPublicFocus();if(!readPublicId(agentId)&&!/^[A-Za-z0-9_-]{8,100}$/.test(agentId)){focusMessage('这个居民档案链接暂时无法定位。',false,'scene.locateInvalid');return;}publicFocus={agentId,waiting:true,reading:false};focusMessage('正在寻找这位居民的公开位置…',false,'scene.locating');void tryPublicFocus();}
focusRetry.addEventListener('click',()=>{if(!publicFocus)return;publicFocus.waiting=true;focusMessage('正在重新确认公开位置…',false,'scene.relocating');void worldProvider.refresh();});
function detailText(selector,value,key){const node=$(selector);clearBinding(node);node.textContent=value;if(key)bindText(node,'public:'+key);}
function detailClose(key,fallback){const node=$('#world-detail-close');clearBinding(node,'aria-label');node.setAttribute('aria-label',fallback);bindAttribute(node,'aria-label','public:'+key);}
const detail=$('#world-detail'),detailTransition=createPanelTransition(detail),environment=getPanelEnvironment();detail.prepend(nativeFrame('lightWood'));$('#world-detail-close').replaceChildren(icon('close'));$('#world-detail-close').removeAttribute('data-i18n-aria-label');
const placeProfile=createPlaceProfileCard({getRules:()=>worldData.rules,request:api}),npcPerson=createNpcPersonCard(),publicCharacter=createPublicCharacterReader(),characterCard=createPublicCharacterCard(publicCharacter,{session,getExpressions:()=>scene?.getExpressions()||[]});const townCard=createTownServiceCard(session,{chooseAgent:()=>document.dispatchEvent(new CustomEvent('hud:choose-agent')),getWorldState:()=>scene?{...scene.getState(),rules:worldData.rules}:null,onContextChange:townContextChanged});townCard.node.hidden=true;const lifeCard=createLifePlaceCard(session,{npcLifeDirectory,chooseAgent:()=>document.dispatchEvent(new CustomEvent('hud:choose-agent')),getWorldState:()=>scene?{...scene.getState(),rules:worldData.rules}:null});lifeCard.node.hidden=true;$('.world-detail-body',detail).prepend(placeProfile.node,npcPerson.node,characterCard.node,townCard.node,lifeCard.node);
const profileMapKey=()=>JSON.stringify([worldData.instanceId,worldData.rules?.mapManifest]);let currentProfileMap=null;
let noticeVersion=null,noticeAbort=null;
async function syncTownNotice(){const version=worldData.npcCatalogVersion;if(!mapReady||!worldData.complete||!version||noticeVersion===version)return;noticeVersion=version;noticeAbort?.abort();const controller=new AbortController();noticeAbort=controller;try{const data=await readTownNotice({signal:controller.signal});if(!controller.signal.aborted&&worldData.npcCatalogVersion===data.catalogVersion)scene?.setTownNotice(data);}catch{/* The map never invents a missing object's location. */}}
function townContextChanged(value){
  if(!currentPlace||!detail.classList.contains('is-town-service'))return;
  const notice=value.kind==='notice',source=notice?value.notice:value.npc;
  currentTownVersion=value.catalogVersion;
  if(!notice&&placeProfileTargetId(currentPlace)){currentPlace={...currentPlace,...(currentPlace.serviceNpc?{serviceNpc:source}:{npc:source})};scene?.select(currentPlace);return;}
  currentPlace={...currentPlace,...(worldData.rules?pixelPoint(source.position,worldData.rules):{}),id:notice?'notice':source.npcId,name:source.name,kind:notice?'town-notice':'world-npc',...(notice?{notice:source,serviceNpc:null,npc:null}:{npc:source,serviceNpc:null})};
  if(!notice)npcPerson.set(source,{stale:worldData.stale===true});
  detailText('#world-detail-area',notice?'小镇公告':'镇民服务',notice?'scene.area.notice':'scene.area.services');detailText('#world-detail-title',notice?source.name:'镇民',notice?null:'scene.title.npc');
  detailClose(notice?'scene.close.notice':'scene.close.services',notice?'关闭公告牌':'关闭镇民服务');scene?.select(currentPlace);
}
function renderDetails(place){
  const character=place.kind==='world-avatar',provider=place.serviceNpc||place.npc,town=place.kind==='town-notice'||Boolean(provider&&!provider.readOnly&&provider.serviceIds?.length),life=lifeBuilding(place);detail.classList.toggle('is-life-place',life);lifeCard.node.hidden=!life;detail.classList.toggle('is-town-service',town);townCard.node.hidden=!town;detail.classList.toggle('is-character-card',character);characterCard.node.hidden=!character;
  npcPerson.set(place.kind==='world-npc'?provider:null,{stale:worldData.stale===true});detail.classList.toggle('is-npc-person',place.kind==='world-npc');clearBinding(detail,'aria-label');if(place.kind==='world-npc'){detail.setAttribute('aria-label',`${provider.name}的镇民详情`);bindAttribute(detail,'aria-label','public:scene.npcDetails',{name:provider.name});}else detail.removeAttribute('aria-label');
  const profile=placeProfileTargetId(place);detail.classList.toggle('is-place-profile',Boolean(profile));
  detailClose(character?'scene.close.character':'home.closePlace',character?'关闭角色详情':'关闭场所说明');detail.dataset.agentId=character?place.agentId:'';
  if(character){detailText('#world-detail-area','');detailText('#world-detail-title','角色资料','scene.title.character');detailText('#world-detail-description','');detailText('#world-detail-note','');return{links:[]};}
  if(profile){detailText('#world-detail-area','');detailText('#world-detail-title','场所','scene.title.place');detailText('#world-detail-icon','');detailText('#world-detail-description','');detailText('#world-detail-note','');return{links:placeDetails(place).links||[]};}
  if(npcLifePlace(place)){detailText('#world-detail-area','园务照料','scene.area.care');detailText('#world-detail-title','镇民','scene.title.npc');detailText('#world-detail-icon','');detailText('#world-detail-description','读取园务牌，了解当前照料点与真实资格。','scene.careDescription');detailText('#world-detail-note','网页只提供查看与复制意图，由 Agent 按现有权限执行。','scene.careNote');return{links:[]};}
  if(life&&!town){detailText('#world-detail-area',place.kind==='world-npc'?'镇民与场所活动':'场所活动',place.kind==='world-npc'?'scene.area.npcActivities':'scene.area.activities');detailText('#world-detail-title',place.kind==='world-npc'?'镇民':place.name,place.kind==='world-npc'?'scene.title.npc':null);detailText('#world-detail-icon','');detailText('#world-detail-description','活动位于建筑外场，条件与名额以当前目录为准。','scene.activityDescription');detailText('#world-detail-note','建筑室内尚未开放。','scene.interiorsClosed');return{links:[]};}
  if(town){detailText('#world-detail-area',place.kind==='town-notice'?'小镇公告':'镇民服务',place.kind==='town-notice'?'scene.area.notice':'scene.area.services');detailText('#world-detail-title',place.kind==='world-npc'?'镇民':place.name,place.kind==='world-npc'?'scene.title.npc':null);return{links:[]};}
  const details=placeDetails(place);detailText('#world-detail-area',details.area);detailText('#world-detail-title',place.kind==='world-npc'?'镇民':details.name,place.kind==='world-npc'?'scene.title.npc':null);detailText('#world-detail-icon',details.icon);detailText('#world-detail-description',details.description);detailText('#world-detail-note',details.note);return details;
}
const list = $('#world-place-list'),listBindings=[],listStarts=[];
function clearPlaceList(){for(const stop of listBindings.splice(0))stop();listStarts.length=0;}
function localizePlaceList(){if($('#world-place-directory').open)for(const start of listStarts)start();}
$('#world-place-directory').addEventListener('toggle',localizePlaceList);
function bindListPlace(place,nodes){let closed=false,started=false,stop=()=>{};listBindings.push(()=>{closed=true;stop();});listStarts.push(()=>{if(started||closed)return;started=true;void placeListSource(place).then(source=>{if(!closed&&source)stop=bindOfficialFields(nodes,'world-content',source);});});}
function renderPlaceList(places){clearPlaceList();list.replaceChildren();
for (const area of [...new Set(places.map(place => place.area))]) {
  const group = el('section', 'world-place-group');
  const areaTitle=el('h3','',area);group.append(areaTitle);let first=true;
  const buttons = el('div');
  for (const place of places.filter(item => item.area === area)) {
    const button = el('button', 'world-place-button'),name=el('span','',place.name);button.append(name);if(place.kind==='life-place')button.append(document.createTextNode(' · '),el('span','',msg('public:life.heading')));bindListPlace(place,{name,...(first?{area:areaTitle}:{})});first=false;
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
localizePlaceList();
}
renderPlaceList(rendering?.places||[COMMONS_PLACE]);
function positionCharacterCard(){
  if(currentPlace?.kind!=='world-avatar'||detail.hidden||!scene)return;
  const state=scene.getState(),camera=state.camera,box=scene.canvas.getBoundingClientRect(),phone=camera.width<760;
  const anchor={x:box.left+camera.width/2+(currentPlace.x-camera.x)*camera.scale,y:box.top+(state.mode==='overview'?(camera.height+(phone?112:88)-(phone?116:126))/2:camera.height/2)+(currentPlace.y-camera.y)*camera.scale};
  const bounds={left:phone?12:24,right:innerWidth-(phone?12:24),top:Math.max(phone?12:24,(document.querySelector('header')?.getBoundingClientRect().bottom||0)+12),bottom:phone?Math.min(innerHeight-12,$('#hud-dock')?.getBoundingClientRect().top-12||innerHeight-12):innerHeight-24};
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
function openPlace(place, origin,{reuseProfile=false,fromPublicFocus=false}={}) {
  if(!fromPublicFocus)cancelPublicFocus();
  if(place.kind==='world-avatar')place={...place,sceneStale:worldData.stale===true};
  $('#world-place-directory').open=false;
  if(place.kind==='world-avatar')emitWorldAudio('world-focus');
  document.dispatchEvent(new CustomEvent('world:place-open'));
  currentPlace = place;
  returnFocus = origin;
  currentProfileMap=profileMapKey();if(placeProfileTargetId(place))void placeProfile.open(place);else placeProfile.close();
  const details = renderDetails(place);lifeCard.close();if(lifeBuilding(place))lifeCard.open(place);currentTownVersion=detail.classList.contains('is-town-service')?worldData.npcCatalogVersion:null;townCard.close();if(detail.classList.contains('is-town-service'))townCard.open(place.kind==='town-notice'?{notice:true,catalogVersion:worldData.npcCatalogVersion}:{npc:place.serviceNpc||place.npc,catalogVersion:worldData.npcCatalogVersion});if(place.kind==='world-avatar'){if(!reuseProfile)void publicCharacter.open(place);}else publicCharacter.clear();
  const links = $('#world-detail-links'); links.replaceChildren();
  for (const link of details.links || []) { const node = el('a', '', `${link.label} ↗`); node.href = link.href; links.append(node); }
  if(place.id==='noticeboard')for(const [category,key]of [['announcements','public:town.announcements'],['events','public:scene.events']]){const control=el('button','',msg(key));control.type='button';control.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('hud:world-content',{detail:{category}})));links.append(control);}
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.placeId === place.id));
  environment.set('world',detail);detailTransition.show();positionCharacterCard();
  $('#world-layout').classList.add('has-detail');
  scene?.select(place);
  $('#world-detail').focus({preventScroll: true});

}
function closePlace(restoreFocus=true) {
  if (!currentPlace) return;
  currentPlace = null;currentProfileMap=null;placeProfile.close();npcPerson.clear();publicCharacter.clear();townCard.close();lifeCard.close();
  environment.set('world',null);detailTransition.hide();
  $('#world-layout').classList.remove('has-detail');
  for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
  scene?.select(null);
  if(!restoreFocus)return;
  const target = returnFocus?.isConnected&&returnFocus.getClientRects().length ? returnFocus : scene?.canvas || $('#world-place-directory > summary');
  target?.focus({preventScroll: true});

}
function updateControls(state) {
  syncNpcLifeDirectory(state.visible);
  worldProvider.setVisible(pageActive&&!document.hidden&&!mapFailed&&state.visible);statusHud.setVisible(pageActive&&!document.hidden);
  document.dispatchEvent(new CustomEvent('world:state',{detail:{exploring:state.exploring,reducedMotion:state.reducedMotion}}));
  uiText($('#world-explore'),state.exploring?'public:scene.exploreExit':'public:home.explore',state.exploring?'退出探索':'探索地图');
  $('#world-explore').setAttribute('aria-pressed',String(state.exploring));
  $('#world-explore').hidden=state.mode==='overview';$('#world-reset').hidden=state.mode!=='overview';
  uiText($('#world-gesture-hint'),state.exploring?'public:scene.exploringHint':'public:scene.normalHint',state.exploring?'探索中 · 单指拖动地图 · 退出探索后可向下浏览':'向下浏览了解与接入 · 选择探索地图后可单指拖动');
  $('#world-zoom').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#world-zoom-out').disabled = !mapReady || state.zoom <= state.minZoom + .001;
  $('#world-zoom-in').disabled = !mapReady || state.zoom >= 3;
  uiText($('#world-pause'),state.paused?'public:home.resumeMotion':'public:home.pauseMotion',state.paused?'播放动态':'暂停动态');
  $('#world-pause').setAttribute('aria-pressed', String(state.paused));
  reduceMotion.setAttribute('aria-pressed',String(state.reducedMotion));
  const text = state.worldScene?.stale?'上次画面已过期 · 位置停止更新，正在恢复连接':state.worldScene?.phase!=='demo'?'服务器角色位置按读取结果显示 · 画布动画不代表在线':state.paused ? state.pauseReason === 'reduced' ? '静止展示 · 已遵循系统的减少动态设置' : state.pauseReason === 'performance' ? '静止展示 · 可手动播放演示' : '静止展示 · 演示动态已暂停' : !state.visible ? '演示动态在地图可见时继续' : '人物与环境为演示动态';
  const motionKey=state.worldScene?.stale?'motionStale':state.worldScene?.phase!=='demo'?'motionServer':state.paused?state.pauseReason==='reduced'?'motionReduced':state.pauseReason==='performance'?'motionPerformance':'motionPaused':!state.visible?'motionInvisible':'motionDemo';uiText($('#world-motion-status'),'public:scene.'+motionKey,text);
  positionCharacterCard();
}
async function startScene() {
  const generation=++sceneGeneration;sceneAbort?.abort();sceneAbort=new AbortController();ownedAgents?.attach(null);
  scene?.destroy(); scene = null;mapReady=false;mapFailed=false;setMapAvailable(false);
  $('#world-fallback').hidden = true;
  uiText($('#world-motion-status'),'public:scene.loadingCanvas','正在载入世界画布…');
  let loaded;
  try {
    loaded=rendering||await loadPixelTown({signal:sceneAbort.signal});
    if(generation===sceneGeneration)renderPlaceList([...(loaded.places||[]),...(loaded.lifeTargets||[])]);
    if(generation!==sceneGeneration||sceneAbort.signal.aborted){loaded.dispose?.();return;}
    const next = await createWorldScene($('#world-scene'), {rendering:loaded,worldSource:'pending',initialTime:statusHud.clock.now(),clock:statusHud.clock,signal:sceneAbort.signal,onSelect: openPlace, onOwnedSelect:(agentId,origin)=>ownedAgents?.select(agentId,origin), onChange: updateControls, onError:()=>{if(generation===sceneGeneration)mapError();}});
    if(generation!==sceneGeneration){next.destroy();return;}
    scene=next;scene.setNpcLifeDirectory(npcLifeDirectory.snapshot());const applied=scene.setWorldScene(worldData);if(applied?.accepted===false){worldData={...worldData,phase:'unavailable',complete:false,avatars:[],npcs:[],errorCode:applied.reason};statusHud.update(worldData);}if(!mapFailed)ownedAgents?.attach(scene);
    if(!mapFailed){setMapAvailable(true);updateControls(scene.getState());markFirstScene();void tryPublicFocus();void syncTownNotice();}
    if (currentPlace) scene.select(currentPlace);
  } catch {loaded?.dispose?.();if(generation===sceneGeneration)mapError(); }
}
function setMapAvailable(value){mapReady=value;for(const id of ['world-zoom-out','world-zoom-in','world-fit','world-pause','world-explore','world-reset','world-reduce-motion'])$(`#${id}`).disabled=!value;$('#world-gesture-hint').hidden=!value;document.dispatchEvent(new CustomEvent('world:availability',{detail:{available:value}}));}
function markFirstScene(){if(firstSceneMarked||!mapReady||mapFailed||worldData.phase!=='ready'||worldData.stale||!worldData.complete||!scene||Date.now()-worldData.lastSuccessAt>5000)return;const shown=scene.getState().worldScene;if(shown.phase!=='ready'||!shown.complete||shown.stale||shown.worldRevision!==worldData.worldRevision)return;firstSceneMarked=true;performance.mark('trisavia:first-scene-ready',{detail:{instanceId:worldData.instanceId,worldRevision:worldData.worldRevision,rulesVersion:worldData.rules.version}});}
function mapError() {
  mapFailed=true;worldProvider.setVisible(false);ownedAgents?.attach(null);setMapAvailable(false);
  if(publicFocus){publicFocus.waiting=false;focusMessage('地图暂不可用，恢复地图后可重试定位。',true,'scene.locateMapRecover');}
  $('#world-fallback').hidden = false;
  $('#world-place-directory').open = true;
  uiText($('#world-motion-status'),'public:scene.mapUnavailable','地图暂不可用 · 场所列表仍可查看');
}
document.addEventListener('hud:open',()=>{cancelPublicFocus();closePlace(false);});
document.addEventListener('world:town-service',event=>{const row=worldData.complete&&worldData.npcs.find(row=>row.npcId===event.detail?.npcId);if(!row||row.readOnly||!scene)return;const point=pixelPoint(row.position,worldData.rules);openPlace({kind:'world-npc',id:row.npcId,name:row.name,npc:row,...point},scene.canvas);});
$('#world-detail-close').addEventListener('click', closePlace);
$('#world-back').addEventListener('click', closePlace);
document.addEventListener('keydown', event => {if(event.key==='Escape'&&!event.defaultPrevented&&$('#world-place-directory').open){$('#world-place-directory').open=false;$('#world-open-list').focus({preventScroll:true});event.preventDefault();return;}if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('#hud-window:not([hidden]):not([data-panel-state=closing])')||detailTransition.state==='closing'||event.target.closest?.('input,textarea,select,[contenteditable=true]'))return;if(currentPlace){event.preventDefault();closePlace();}else if(scene?.getState().exploring){event.preventDefault();scene.setExploring(false);scene.canvas.focus({preventScroll:true});}});
$('#world-zoom-out').addEventListener('click', () => scene?.zoomBy(-1));
$('#world-zoom-in').addEventListener('click', () => scene?.zoomBy(1));
$('#world-fit').addEventListener('click', () => scene?.fit());
$('#world-explore').addEventListener('click',()=>scene?.setExploring(!scene.getState().exploring));
$('#world-reset').addEventListener('click',()=>scene?.reset());
document.addEventListener('pointerdown',event=>{const directory=$('#world-place-directory');if(directory.open&&!directory.contains(event.target)&&!$('#world-open-list').contains(event.target))directory.open=false;});
$('#world-open-list').addEventListener('click',()=>{$('#world-place-directory').open=true;if(!document.body.classList.contains('paper-app-ready'))$('#world-place-directory').scrollIntoView({block:'start',behavior:'instant'});$('#world-place-directory > summary').focus({preventScroll:true});});
$('#world-pause').addEventListener('click', () => { if (scene) scene.setPaused(!scene.getState().paused); });
$('#world-retry').addEventListener('click', startScene);
const reduceMotion=el('button','','减少动态');reduceMotion.id='world-reduce-motion';uiText(reduceMotion,'public:scene.reducedMotion','减少动态');reduceMotion.type='button';reduceMotion.setAttribute('aria-pressed','false');reduceMotion.addEventListener('click',()=>{if(scene)scene.setReducedMotion(!scene.getState().reducedMotion);});($('#hud-map-menu')||$('.world-controls')).append(reduceMotion);
const refreshWorld=el('button','','刷新世界'),moreWorld=el('button','','继续载入角色');refreshWorld.id='world-refresh';moreWorld.id='world-load-more';uiText(refreshWorld,'public:scene.refresh','刷新世界');uiText(moreWorld,'public:scene.moreResidents','继续载入角色');refreshWorld.type=moreWorld.type='button';moreWorld.hidden=true;
($('#hud-map-menu')||$('.world-controls')).append(refreshWorld,moreWorld);
refreshWorld.addEventListener('click',()=>{noticeVersion=null;noticeAbort?.abort();void worldProvider.refresh();});moreWorld.addEventListener('click',()=>void worldProvider.loadMore());
worldProvider.subscribe(value=>{
  worldData=value;statusHud.update(value);const applied=scene?.setWorldScene(value);if(applied?.accepted===false)value={...value,phase:'unavailable',avatars:[],complete:false,errorCode:applied.reason};refreshWorld.hidden=false;refreshWorld.disabled=Boolean(value.errorStatus===429&&value.retryAt&&value.retryAt>Date.now());moreWorld.hidden=value.phase!=='partial';
  worldData=value;syncNpcLifeDirectory();if(applied?.accepted===false)statusHud.update(value);markFirstScene();
  if(placeProfileTargetId(currentPlace)&&value.rules&&currentProfileMap!==profileMapKey()){currentProfileMap=profileMapKey();void placeProfile.refresh();}
  void tryPublicFocus();void syncTownNotice();
  if(currentPlace&&detail.classList.contains('is-town-service')&&(!value.complete||value.npcCatalogVersion!==currentTownVersion))closePlace(false);
  if(currentPlace&&detail.classList.contains('is-life-place')){if(!value.complete)closePlace(false);else lifeCard.observeWorld(value);}
  townCard.observeWorld(value);
  if(currentPlace?.kind==='world-npc'&&value.complete){const npc=value.npcs?.find(row=>row.npcId===currentPlace.id);if(npc){npcPerson.set(npc,{stale:value.stale===true});lifeCard.observeNpc(npc,{stale:value.stale===true});}}
  if(currentPlace?.kind==='world-npc'&&(!value.complete||!value.npcs?.some(npc=>npc.npcId===currentPlace.id)))closePlace(false);
  if(currentPlace?.kind==='world-avatar'){
    const row=value.complete?value.avatars.find(avatar=>avatar.agentId===currentPlace.agentId):null;
    if(!row)closePlace(false);
    else{const renderedState=scene?.getState().worldScene,rendered=renderedState?.avatars.find(avatar=>avatar.fact.agentId===row.agentId);currentPlace={...row,sceneStale:value.stale===true,kind:'world-avatar',projectionVersion:renderedState?.projectionVersion,x:rendered?.x??currentPlace.x,y:rendered?.y??currentPlace.y};void publicCharacter.observe(currentPlace);scene?.select(currentPlace);}
  }
});
const entryCopy=$('#world-entry-capabilities');entryCopy?.removeAttribute('data-i18n');function putEntry(value){if(!entryCopy)return;clearBinding(entryCopy);if(isMessage(value))bindText(entryCopy,value.key,value.params);else entryCopy.textContent=value;}let entryVisible=false,entryGeneration=0,entryAbort=null;
function stopEntryRead(){entryGeneration++;entryAbort?.abort();entryAbort=null;}
async function readEntryCapabilities(){
  stopEntryRead();if(!entryCopy||!entryVisible||!pageActive||document.hidden)return;
  const generation=entryGeneration,controller=new AbortController();entryAbort=controller;putEntry(entryCapabilityText(null));
  try{const caps=await readPublicCapabilities({signal:controller.signal});if(generation===entryGeneration&&!controller.signal.aborted&&pageActive&&!document.hidden)putEntry(entryCapabilityText(caps));}
  catch(error){if(generation===entryGeneration&&!controller.signal.aborted&&error.name!=='AbortError')putEntry(entryCapabilityText(null));}
}
const entryObserver=entryCopy?new IntersectionObserver(entries=>{const next=entries[0].isIntersecting;if(next===entryVisible)return;entryVisible=next;if(next)void readEntryCapabilities();else stopEntryRead();},{threshold:.01}):null;if(entryCopy)entryObserver.observe(entryCopy);
document.addEventListener('visibilitychange',()=>{syncNpcLifeDirectory();worldProvider.setVisible(pageActive&&!document.hidden&&!mapFailed&&(!scene||scene.getState().visible));statusHud.setVisible(pageActive&&!document.hidden);if(document.hidden)stopEntryRead();else if(entryVisible)void readEntryCapabilities();});
for (const link of document.querySelectorAll('a[href="#connect"]')) link.addEventListener('click', () => { $('#connect').open = true; });
if (location.hash === '#connect') $('#connect').open = true;
worldProvider.setVisible(!document.hidden);worldProvider.start();startScene();
window.addEventListener('pagehide', event => {pageActive=false;syncNpcLifeDirectory(false);stopEntryRead();worldProvider.setVisible(false);statusHud.setVisible(false);if (!event.persisted){clearPlaceList();$('#world-place-directory').removeEventListener('toggle',localizePlaceList);stopNpcLifeDirectory();npcLifeDirectory.dispose();cancelPublicFocus();noticeAbort?.abort();placeProfile.dispose();townCard.dispose();lifeCard.dispose();entryObserver?.disconnect();sceneGeneration++;sceneAbort?.abort();worldProvider.dispose();statusHud.dispose();stopStatusSession?.();ownedAgents?.dispose();characterCard.dispose();publicCharacter.dispose();window.removeEventListener('resize',positionCharacterCard);characterSize.disconnect();detailTransition.destroy();scene?.destroy();} });
window.addEventListener('pageshow',()=>{pageActive=true;syncNpcLifeDirectory();if(scene&&!mapFailed){worldProvider.setVisible(scene.getState().visible);statusHud.setVisible(scene.getState().visible&&!document.hidden);}if(entryVisible)void readEntryCapabilities();});
return{focusPublicResident,returnToTown(){if(!mapReady||!scene)return false;closePlace(false);scene.fit();$('#world-canvas')?.focus({preventScroll:true});return true;},locateAgent(agentId){return mapReady&&scene?.locateOwnedAgent(agentId)||false;}};
}
export function getWorldState(){return scene?.getState()??null;}
function entryCapabilityText(caps){
 if(caps?.apiVersion!=='v1')return msg('public:scene.entryUnknown');
 const interaction=caps.gateway?.protocolVersion===1&&Array.isArray(caps.gateway.modules)?caps.gateway.modules.includes('interaction'):caps.interaction;
 return msg('public:scene.entryAvailable',()=>({perception:t(caps.perception===true?'public:scene.perceptionOpen':caps.perception===false?'public:scene.perceptionClosed':'public:scene.perceptionUnknown'),interaction:t(interaction===true?'public:scene.interactionOpen':interaction===false?'public:scene.interactionClosed':'public:scene.interactionUnknown'),movement:caps.gateway?.worldSimulation?.enabled===true?t('public:scene.movementEnabled'):''}));
}
