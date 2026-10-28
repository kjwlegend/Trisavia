import {publicIdLabel,readPublicId} from '../public-id.js';
import {api,el} from '../common.js';
import {msg,t,isMessage,bindText,bindAttribute,clearBinding} from '../i18n/core.js';
import {createLifePresentation} from './life-presentation.js';
import {iconBodies} from '../paper-ui/icons.js';
import {avatar} from '../scene.js';
import {PIXEL_LAYOUT_SHA256,PIXEL_GEOMETRY_DIGEST,PIXEL_MAP} from '../world-pixel/map.js';
import {readWorldNpcs} from './world-scene-projection.js';
const invalid=()=>Object.assign(new Error('town_response_invalid'),{code:'town_response_invalid'});
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max=1000)=>typeof value==='string'&&value.length<=max;
const named=(value,max)=>text(value,max)&&Boolean(value.trim());
const townPoint=value=>Number.isSafeInteger(value?.x)&&Number.isSafeInteger(value?.y)&&value.x>=PIXEL_MAP.bounds.minX&&value.x<=PIXEL_MAP.bounds.maxX&&value.y>=PIXEL_MAP.bounds.minY&&value.y<=PIXEL_MAP.bounds.maxY;
const serviceIds=['welcome.claim','tavern.host','inn.rest','greet'];
const names={tavern_voucher:'招待券',inn_voucher:'休息券'};
const nullableId=value=>value===null||named(value,100);
const itemRefValid=(value,moduleId,type)=>value?.moduleId===moduleId&&value.type===type&&named(value.id,180);
function inventoryItemValid(row,agentId){
 if(!row||!named(row.itemInstanceId,100)||!integer(row.version)||row.version<1||!(Object.hasOwn(names,row.itemKind)||row.itemKind==='resident_card')||!named(row.title,180)||!['available','reserved','consumed'].includes(row.state)||row.availableQuantity!==(row.state==='available'?1:0)||row.quantity!==(row.state==='consumed'?0:1)||row.transferable!==false||!integer(row.issuedAt)||!integer(row.updatedAt)||!nullableId(row.sourceOperationId)||(row.sourceGiftId!==undefined&&!nullableId(row.sourceGiftId))||!nullableId(row.reservationId)||!nullableId(row.consumedBy)||!itemRefValid(row.holdingRef,'inventory','inventory.holding@1')||!itemRefValid(row.itemRef,'items','items.item@1'))return false;
 const card=row.residentCard;
 if(card?.publicId!==undefined&&card.publicId!==null&&!readPublicId(card.publicId))return false;
 if(row.itemKind!=='resident_card')return card===undefined||card===null;
 return Boolean(card&&named(row.sourceGiftId,100)&&row.state==='available'&&row.reservationId===null&&row.consumedBy===null&&card.agentId===agentId&&named(card.displayName,240)&&(card.firstWorldJoinedAt===null||integer(card.firstWorldJoinedAt))&&integer(card.issuedAt)&&card.issuedAt===row.issuedAt);
}
const control=(label,run)=>{const button=el('button','',label);button.type='button';button.addEventListener('click',run);return button;};
const selected=context=>context?.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(agent=>agent.agentId===context.selectedAgentId):null;
const operationValid=value=>value===null||value&&text(value.operationId,180)&&value.operationId&&integer(value.version)&&value.version>0&&text(value.npcId,180)&&serviceIds.includes(value.serviceId)&&integer(value.catalogVersion)&&['active','completed','cancelled'].includes(value.state)&&integer(value.startedAt)&&(value.endedAt===null||integer(value.endedAt))&&(value.response===null||text(value.response,4000));
export function readTownPublic(envelope){
 const data=envelope?.data,map=data?.map;if(envelope?.protocolVersion!==1||!integer(data?.catalogVersion)||data.catalogVersion<1||!integer(data.asOf)||map?.mapId!=='pixel-town-v2'||map.layoutSha256!==PIXEL_LAYOUT_SHA256||map.geometryDigest!==PIXEL_GEOMETRY_DIGEST||map.rulesetVersion!==PIXEL_MAP.rulesetVersion||map.topologyVersion!==PIXEL_MAP.topologyVersion)throw invalid();return data;
}
export async function readTownNotice({signal}={}){const data=readTownPublic(await api('/town/notice',{signal})),n=data.notice;if(n?.objectId!=='notice'||!named(n.name,100)||!named(n.title,200)||!text(n.text,8000)||!integer(n.version)||n.version<1||!Array.isArray(n.serviceIds)||n.serviceIds.length>4||n.serviceIds.some(id=>!serviceIds.includes(id))||!townPoint(n.position)||!Array.isArray(n.approachCells)||!n.approachCells.length||n.approachCells.length>8||n.approachCells.some(point=>!townPoint(point)))throw invalid();return {...data,notice:{objectId:n.objectId,name:n.name,title:n.title,text:n.text,version:n.version,position:{...n.position},approachCells:n.approachCells.map(point=>({...point})),serviceIds:[...n.serviceIds]}};}
export function readTownService(envelope,serviceId){
 const data=readTownPublic(envelope),s=data.service,facility=data.facility;
 if(facility?.kind!=='facility'||!townPoint(facility.position)||!Array.isArray(facility.approachCells)||!facility.approachCells.length||facility.approachCells.length>32||facility.approachCells.some(point=>!townPoint(point))||typeof facility.providerRequired!=='boolean'||typeof facility.providerPresent!=='boolean'||!integer(facility.nextCheckAt))throw invalid();
 if(s?.serviceId!==serviceId||!named(s.name,100)||!text(s.description,4000)||!named(s.action,180)||!integer(s.durationMs)||!(s.itemCost===null||Object.hasOwn(names,s.itemCost))||!Array.isArray(s.topics)||s.topics.length>10||s.topics.some(topic=>!named(topic?.id,100)||!named(topic?.label,100)))throw invalid();
 const npc=readWorldNpcs([data.npc],{bounds:PIXEL_MAP.bounds,version:PIXEL_MAP.rulesetVersion,topologyVersion:PIXEL_MAP.topologyVersion})[0];
 if(npc.npcId!==s.npcId||!named(npc.npcId,180)||!named(npc.name,100)||!named(npc.role,100)||!(named(npc.buildingId,100)||serviceId==='greet'&&npc.buildingId===null)||npc.readOnly!==false||npc.status!=='available'||!npc.approachCells.length||npc.approachCells.length>8||npc.actions.length>20||npc.actions.some(action=>!named(action,180))||!npc.serviceIds.includes(serviceId)||npc.serviceIds.length>4||!named(npc.appearance.lookId,100)||!named(npc.appearance.catalogVersion,100))throw invalid();
 return {...data,npc,facility:{kind:'facility',position:{...facility.position},approachCells:facility.approachCells.map(point=>({...point})),providerRequired:facility.providerRequired,providerPresent:facility.providerPresent,nextCheckAt:facility.nextCheckAt}};
}
async function readService(serviceId,signal){return readTownService(await api(`/town/service?${new URLSearchParams({serviceId})}`,{signal}),serviceId);}
export async function readTownOwner(session,operation,input={},options={}){
 const agentId=session.snapshot().selectedAgentId,envelope=await session.readTownService(operation,input,options),data=envelope?.data;
 if(envelope?.protocolVersion!==1||data?.agentId!==agentId||!integer(data.asOf))throw invalid();
 if(operation==='relationships'&&(!Array.isArray(data.relationships)||data.relationships.length>50||typeof data.complete!=='boolean'||(data.complete?data.nextAfterNpcId!==null:!text(data.nextAfterNpcId,180)||!data.nextAfterNpcId)||data.relationships.some(row=>!text(row.npcId,180)||!integer(row.familiarity)||row.familiarity>100)))throw invalid();
 if(operation==='inventory'&&(!Array.isArray(data.items)||data.items.length>50||typeof data.complete!=='boolean'||(data.complete?data.nextAfterId!==null:!text(data.nextAfterId,180)||!data.nextAfterId)||data.items.some(row=>!inventoryItemValid(row,agentId))))throw invalid();
 if(operation==='progress'&&(!integer(data.catalogVersion)||!Array.isArray(data.completedServices)||data.completedServices.some(row=>!text(row.npcId,180)||!serviceIds.includes(row.serviceId)||!text(row.operationId,180)||!integer(row.completedAt))||!operationValid(data.claim)||!operationValid(data.activeRest)))throw invalid();
 if(operation==='operation'&&!operationValid(data.operation))throw invalid();
 return data;
}
const townPaths={
 greet:'M4 4h16v12H9l-5 4V4zm4 5h8m-8 3h5',
 gift:'M3 9h18v4H3zm2 4h14v9H5zm7-4v13M12 9H8a3 3 0 1 1 3-3l1 3zm0 0h4a3 3 0 1 0-3-3l-1 3z',
 tea:'M4 7h13v12H4zM17 9h2a3 3 0 0 1 0 6h-2M7 3v2m4-2v2m4-2v2',
 rest:'M3 4v17m18-9v9M3 17h18M6 9h5v5H6zm5 3h10v5H11z',
 location:'M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13zm0-16a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
 info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-10v1',
 refresh:'M20 8a8 8 0 0 0-14-3L3 8m0-6v6h6m-5 8a8 8 0 0 0 14 3l3-3m0 6v-6h-6',
 cancel:'m5 5 14 14M19 5 5 19',
 check:'m4 12 5 5L20 6',
};
function townIcon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('town-icon');const body=iconBodies[({greet:'speech',cancel:'close'})[name]||name];if(body){svg.setAttribute('stroke','none');svg.innerHTML=body;return svg;}const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',townPaths[name]||townPaths.info);svg.append(path);return svg;}
const m=(key,params)=>msg('public:town.'+key,params);
const translated=value=>isMessage(value)?t(value.key,typeof value.params==='function'?value.params():value.params):value;
function attribute(node,name,value){if(isMessage(value))bindAttribute(node,name,value.key,value.params);else{clearBinding(node,name);node.setAttribute(name,value);}}
function familiarity(value){const box=el('div','town-familiarity'),meter=el('progress');meter.max=100;meter.value=value;bindAttribute(meter,'aria-label','public:town.familiarity',{count:value});box.append(el('span','',m('familiarity',{count:value})),meter);return box;}
function factLine(label,kind='info'){const line=el('p','town-fact');line.append(townIcon(kind),el('span','',label));return line;}
function portrait(fields,className){const picture=el('span',className);avatar(picture,fields);return picture;}

// One read-only source card. Opening it never greets, claims, consumes or rests.
export function createTownServiceCard(session,{chooseAgent=()=>{},getWorldState=()=>null,onContextChange=()=>{}}={}){
 const presentation=createLifePresentation(),node=el('section','town-service-card');
 let target=null,context=session.snapshot(),active=false,generation=0,abort=null,publicData=null,privateData=null,phase='idle',privatePhase='idle',message='',messageNode=null,worldStale=false;
 function cancel(){generation++;abort?.abort();abort=null;}
 function footer(){const box=el('footer','town-card-footer');messageNode=el('p','town-card-message',m(message||'footer'));messageNode.setAttribute('role','status');messageNode.setAttribute('aria-live','polite');box.append(townIcon('info'),messageNode);return box;}
 async function copy(service,topic=null,kind='service'){
  const turn=generation,npc=publicData.npc,agent=selected(context),facility=publicData.facility;
  const destination=kind==='greet'?`到 ${npc.name} 当前实际所在的合法问候区域`:`到 ${service.name} 的固定设施交互区域（${facility.position.x}, ${facility.position.y}），不要追随 NPC 的当前行走位置`;
  const intent=kind==='cancel'?'取消你当前尚未完成的这次休息':kind==='greet'?'向它打个招呼':service.serviceId==='welcome.claim'?'领取尚未领取的新邻居礼包':service.serviceId==='inn.rest'?'使用一张休息券休息一分钟':`使用一张招待券，聊聊「${topic.label}」`;
  try{await navigator.clipboard.writeText(`请先阅读 ${location.origin}/agent/entry.md 的最新世界指南，${agent?`以${agent.name}的身份`:'以自己的身份'}${destination}，${intent}。请先确认当前服务条件，再到实际服务交互处，按当前参与和权限设置行动，并如实告诉我结果。`);if(turn!==generation||!active)return;message='copyDone';}
  catch{if(turn!==generation||!active)return;message='copyFailed';}
  if(messageNode)bindText(messageNode,'public:town.'+message);
 }
 function actionRow(label,iconName,run,{disabled=false,reason='',ariaLabel=m('copyNamed',()=>({label:translated(label)}))}={}){
  const row=el('div','town-action-row'),title=el('span','town-action-label'),button=control(m('copy'),run);title.append(townIcon(iconName),el('span','',label));attribute(button,'aria-label',ariaLabel);button.disabled=disabled||worldStale;if(reason)attribute(button,'title',reason);row.classList.toggle('is-disabled',disabled);row.append(title,button);return row;
 }
 function agentContext(){
  const row=el('div','town-agent-context'),agent=selected(context);row.append(el('span','',agent?m('currentAgent',{name:agent.name}):m(context.authenticated?'noAgent':'loginConditions')),control(agent?m('switchAgent'):msg(context.authenticated?'public:content.chooseAgent':'shell:nav.account'),chooseAgent));
  if(agent?.ownerPaused)row.append(el('span','hud-muted',m('ownerPaused')));else if(agent?.platformRestricted)row.append(el('span','hud-muted',m('restricted')));return row;
 }
 function statusBox(service){
  if(!selected(context))return null;const current=privateData?.progress.activeRest,operation=privateData?.operation;if(privatePhase==='ready'&&current?.npcId!==publicData.npc.npcId&&!['completed','cancelled'].includes(operation?.state))return null;
  const box=el('div','town-service-status');box.setAttribute('role','status');const content=el('div','town-status-copy');box.append(townIcon('info'),content);
  if(!selected(context))content.append(el('p','',m('loginStatus')));
  else if(privatePhase==='loading')content.append(el('p','',m('statusLoading')));
  else if(privatePhase!=='ready')content.append(el('p','',privatePhase==='forbidden'?m('statusForbidden'):m('statusError')));
  else{
   const {progress,operation}=privateData,rest=progress.activeRest;
   if(rest?.npcId===publicData.npc.npcId)content.append(el('p','',m('resting')),el('p','hud-muted',m('restingHint')));
   else if(operation?.state==='completed'){
    if(service.serviceId!=='tavern.host'||!operation.response)content.append(el('p','',service.serviceId==='welcome.claim'?m('claimDone'):service.serviceId==='inn.rest'?m('restDone'):m('hostDone')));
    if(text(operation.response,4000)&&operation.response)content.append(el('p','town-response',operation.response));
   }else if(operation?.state==='cancelled')content.append(el('p','',m('cancelled')));
   else content.append(el('p','',service.serviceId==='welcome.claim'?m('unclaimed'):service.serviceId==='inn.rest'?m('notResting'):m('noResult')));
  }
  if(selected(context)){const retry=control('',()=>void load());retry.className='town-status-refresh';attribute(retry,'aria-label',m(privatePhase==='error'||privatePhase==='forbidden'?'rereadStatus':'refreshStatus'));attribute(retry,'title',m('rereadStatus'));retry.append(townIcon('refresh'));retry.disabled=privatePhase==='loading';box.append(retry);}
  return box;
 }
 function guideSection(service,npc){
  const box=el('section','town-section town-action-guide');box.append(el('h3','town-section-title',m('interactions')));
  const plan=el('div','town-service-plan'),offer=el('div','town-service-offer'),offerText=el('div');offer.append(townIcon(service.serviceId==='welcome.claim'?'gift':service.serviceId==='inn.rest'?'rest':'tea'));offerText.append(presentation.label(el('h4'),'public:life.name',{name:service.name},{name:{namespace:'life-content',spec:{id:service.serviceId,ref:service.serviceId,version:publicData.catalogVersion,values:service,...(service.serviceId==='welcome.claim'&&publicData.catalogVersion===6?{selector:{projection:'town_services.service'}}:{})},field:'name'}}),presentation.label(el('p','town-service-description'),'public:life.name',{name:service.description},{name:{namespace:'life-content',spec:{id:service.serviceId,ref:service.serviceId,version:publicData.catalogVersion,values:service,...(service.serviceId==='welcome.claim'&&publicData.catalogVersion===6?{selector:{projection:'town_services.service'}}:{})},field:'description'}}));
  const condition=()=>{const voucher=service.itemCost?t('public:town.voucher.'+service.itemCost):'',base=service.itemCost?t('public:town.costVoucher',{voucher}):t('public:town.freeOnce');let value=service.durationMs?t('public:town.duration',{condition:base,seconds:service.durationMs/1000}):base;if(service.itemCost&&privatePhase==='ready'){const count=privateData.inventory.items.filter(item=>item.itemKind===service.itemCost).reduce((sum,item)=>sum+item.availableQuantity,0);value=t(privateData.inventory.complete?'public:town.voucherCount':'public:town.voucherPartial',{condition:value,voucher,count});}return{name:value};};
  offerText.append(el('p','hud-muted',msg('public:life.name',condition)));if(service.serviceId==='inn.rest')offerText.append(el('p','hud-muted',m('innRules')));if(publicData.facility.providerRequired&&!publicData.facility.providerPresent)offerText.append(el('p','life-condition',m('providerAway')));if(service.serviceId==='welcome.claim')offerText.append(el('p','town-gift-contents',m('giftContents')));offer.append(offerText);plan.append(offer);
  if(npc.actions.includes('town_services.npc.greet'))plan.append(actionRow(m('greet'),'greet',()=>void copy(service,null,'greet'),{ariaLabel:m('copyGreet')}));
  const resting=privatePhase==='ready'&&privateData.progress.activeRest?.npcId===npc.npcId;
  const claimed=privatePhase==='ready'&&service.serviceId==='welcome.claim'&&privateData.progress.claim?.state==='completed';
  const unknownState=Boolean(selected(context))&&privatePhase!=='ready';
  if(npc.actions.includes(service.action)){
   if(service.topics.length)for(const topic of service.topics)plan.append(actionRow(topic.label,topic.id==='town'?'location':'tea',()=>void copy(service,topic),{disabled:publicData.facility.providerRequired&&!publicData.facility.providerPresent,reason:m('providerAwayShort'),ariaLabel:m('copyTopic',{topic:topic.label})}));
   else plan.append(actionRow(service.serviceId==='inn.rest'?m('startRest'):m('claimGift'),service.serviceId==='inn.rest'?'rest':'gift',()=>void copy(service),{disabled:Boolean(resting||claimed||unknownState),reason:resting?m('waitRest'):claimed?m('alreadyClaimed'):unknownState?m('needStatus'):'',ariaLabel:service.serviceId==='inn.rest'?m('copyRest'):m('copyGift')}));
  }
  if(service.serviceId==='inn.rest'&&npc.actions.includes('town_services.inn.rest.cancel'))plan.append(actionRow(m('cancelRest'),'cancel',()=>void copy(service,null,'cancel'),{disabled:!resting,reason:resting?'':m('noCancellableRest'),ariaLabel:m('copyCancel')}));
  const state=statusBox(service);if(state)plan.append(state);box.append(plan);return box;
 }
 function render(){
  presentation.clear();node.replaceChildren();messageNode=null;if(!active)return;node.dataset.townKind=target?.notice&&phase!=='ready'?'notice':'npc';node.setAttribute('aria-busy',String(phase==='loading'));
  if(phase==='loading'||phase==='error'){
   const state=el('div','town-card-state');state.append(el('p','hud-muted',phase==='loading'?m('loading'):m('error')));if(phase==='error')state.append(control(m('retry'),()=>void load()));node.append(state,footer());return;
  }
  if(phase==='notice'){
   const n=publicData.notice,notice=el('article','town-notice');notice.append(el('p','town-notice-source',m('noticeSource')),el('h3','',n.title),el('p','town-notice-text',n.text));
   const links=el('nav','town-notice-services');attribute(links,'aria-label',m('noticeNavigation'));links.append(control(m('announcements'),()=>document.dispatchEvent(new CustomEvent('hud:world-content',{detail:{category:'announcements'}}))));for(const id of n.serviceIds)links.append(control(m(serviceIds.includes(id)?'service.'+id:'service.other'),()=>open({serviceId:id,catalogVersion:publicData.catalogVersion})));notice.append(links);node.append(notice);return;
  }
  if(!publicData)return;
  if(worldStale)node.append(el('p','life-status',m('worldStale')));
  const {npc,service}=publicData;node.append(agentContext(),guideSection(service,npc),footer(),presentation.note);
 }
 async function load(){
  if(!active||!target)return;cancel();const turn=generation,controller=new AbortController();abort=controller;phase='loading';privatePhase='idle';publicData=null;privateData=null;message='';render();
  try{
   const response=target.notice?await readTownNotice({signal:controller.signal}):await readService(target.serviceId||target.npc.serviceIds[0],controller.signal);if(turn!==generation||!active)return;
   if(response.catalogVersion!==target.catalogVersion||target.npc&&response.npc.npcId!==target.npc.npcId)throw invalid();publicData=response;phase=target.notice?'notice':'ready';
   // The host owns its title, accessible label and map selection. Only a current,
   // validated public source may change that context; private reads never do.
   onContextChange(target.notice?{kind:'notice',catalogVersion:response.catalogVersion,notice:response.notice}:{kind:'npc',catalogVersion:response.catalogVersion,npc:response.npc,serviceId:response.service.serviceId});
   if(turn!==generation||!active)return;render();if(target.notice||!selected(context))return;
   const agentId=context.selectedAgentId;privatePhase='loading';render();
   try{
    const [progress,inventory]=await Promise.all(['progress','inventory'].map(operation=>readTownOwner(session,operation,{}, {signal:controller.signal})));if(turn!==generation||agentId!==context.selectedAgentId||!active)return;
    let operation=progress.activeRest?.npcId===response.npc.npcId?progress.activeRest:progress.claim?.npcId===response.npc.npcId?progress.claim:null;
    const latest=progress.completedServices.filter(row=>row.npcId===response.npc.npcId&&row.serviceId===response.service.serviceId).sort((a,b)=>b.completedAt-a.completedAt)[0];
    if(!operation&&latest)operation=(await readTownOwner(session,'operation',{operationId:latest.operationId},{signal:controller.signal})).operation;
    if(turn!==generation||agentId!==context.selectedAgentId||!active)return;
    if(operation&&(operation.npcId!==response.npc.npcId||operation.serviceId!==response.service.serviceId))throw invalid();
    privateData={progress,inventory,operation};privatePhase='ready';
   }catch(error){if(turn!==generation||controller.signal.aborted)return;privateData=null;privatePhase=[401,403,404].includes(error.status)?'forbidden':'error';}
   render();
  }catch(error){if(turn!==generation||controller.signal.aborted)return;publicData=null;privateData=null;phase='error';render();}
 }
 function open(value){target=value;active=true;worldStale=getWorldState()?.worldScene?.stale===true;void load();}
 const stop=session.subscribe(value=>{const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){privateData=null;privatePhase='idle';if(active)void load();}});
 return{node,open,observeWorld(value){if(!active||!publicData?.npc)return;worldStale=value.stale===true||value.phase==='paused';const npc=value.npcs?.find(row=>row.npcId===publicData.npc.npcId);if(npc){publicData.npc=npc;if(npc.providerPresent!==null&&publicData.facility){publicData.facility.providerPresent=npc.providerPresent;publicData.facility.nextCheckAt=npc.nextCheckAt;}}render();},close(){active=false;presentation.clear();cancel();target=publicData=privateData=null;messageNode=null;node.replaceChildren();},dispose(){active=false;presentation.dispose();cancel();stop();}};
}
export function createTownRelationships(session,{openNpc=()=>{}}={}){
 const presentation=createLifePresentation(),node=el('section','town-relationships');let active=false,context=session.snapshot(),rows=[],complete=false,cursor=null,phase='idle',revision=0,abort=null;
 function clear(){revision++;abort?.abort();abort=null;rows=[];cursor=null;complete=false;phase='idle';render();}
 function render(){
  presentation.clear();node.replaceChildren();if(!active)return;node.append(el('h3','',m('relationships')),el('p','hud-muted',m('relationshipScope')));
  if(phase==='loading'&&!rows.length){node.append(el('p','hud-muted',m('relationshipLoading')));return;}
  if(phase==='error'){node.append(el('p','hud-muted',m('relationshipError')),control(m('relationshipRetry'),()=>void load()));return;}
  if(phase!=='ready')return;if(!rows.length)node.append(el('p','hud-muted',m('relationshipEmpty')));
  for(const relation of rows){const row=el('div','town-relationship'),npc=relation.npc,copy=el('div');if(npc)row.append(portrait({appearance:npc.appearance,displayName:npc.name},'town-relationship-picture'));copy.append(npc?.identity?presentation.label(el('strong'),'public:life.name',{name:npc.name},{name:{namespace:'world-content',spec:{id:npc.npcId,ref:npc.identity.ref,version:npc.identity.version,values:npc.identity,nativeDigest:npc.identity.digest},field:'name'}}):el('strong','',npc?.name||m('knownNpc')),el('span','paper-stable-id',publicIdLabel(npc?.publicId,'N')),familiarity(relation.familiarity));row.append(copy);if(npc)row.append(control(m('service.other'),()=>openNpc(npc)));node.append(row);}
  if(!complete)node.append(control(m('moreNpcs'),()=>void load(true)));node.append(control(m('refreshRelationships'),()=>void load()),presentation.note);
 }
 async function load(more=false){
  if(!active||!selected(context))return;revision++;abort?.abort();const turn=revision,controller=new AbortController();abort=controller;if(!more){rows=[];cursor=null;}phase='loading';render();
  try{const result=await readTownOwner(session,'relationships',cursor?{afterNpcId:cursor}:{},{signal:controller.signal});if(turn!==revision||!active)return;rows=more?[...rows,...result.relationships]:result.relationships;complete=result.complete;cursor=result.nextAfterNpcId;phase='ready';render();}
  catch(error){if(turn!==revision||controller.signal.aborted)return;rows=[];phase='error';render();}
 }
 return{node,activate(){active=true;void load();},deactivate(){active=false;clear();},setContext(value){const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){clear();if(active)void load();}},dispose(){active=false;clear();presentation.dispose();}};
}
