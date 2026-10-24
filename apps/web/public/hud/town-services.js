import {api,el} from '../common.js';
import {avatar} from '../scene.js';
import {PIXEL_LAYOUT_SHA256,PIXEL_GEOMETRY_DIGEST} from '../world-pixel/map.js';
const invalid=()=>Object.assign(new Error('town_response_invalid'),{code:'town_response_invalid'});
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max=1000)=>typeof value==='string'&&value.length<=max;
const serviceIds=['welcome.claim','tavern.host','inn.rest','greet'];
const names={tavern_voucher:'招待券',inn_voucher:'休息券'};
const control=(label,run)=>{const button=el('button','',label);button.type='button';button.addEventListener('click',run);return button;};
const selected=context=>context?.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(agent=>agent.agentId===context.selectedAgentId):null;
const operationValid=value=>value===null||value&&text(value.operationId,180)&&value.operationId&&integer(value.version)&&value.version>0&&text(value.npcId,180)&&serviceIds.includes(value.serviceId)&&integer(value.catalogVersion)&&['active','completed','cancelled'].includes(value.state)&&integer(value.startedAt)&&(value.endedAt===null||integer(value.endedAt))&&(value.response===null||text(value.response,4000));
export function readTownPublic(envelope){
 const data=envelope?.data,map=data?.map;if(envelope?.protocolVersion!==1||!integer(data?.catalogVersion)||data.catalogVersion<1||!integer(data.asOf)||map?.mapId!=='pixel-town-v2'||map.layoutSha256!==PIXEL_LAYOUT_SHA256||map.geometryDigest!==PIXEL_GEOMETRY_DIGEST||map.rulesetVersion!==2||map.topologyVersion!==2)throw invalid();return data;
}
export async function readTownNotice({signal}={}){const data=readTownPublic(await api('/town/notice',{signal})),n=data.notice;if(n?.objectId!=='notice'||!text(n.name,100)||!text(n.title,200)||!text(n.text,8000)||!integer(n.version)||!Array.isArray(n.serviceIds)||n.serviceIds.some(id=>!serviceIds.includes(id))||!n.position||!Number.isSafeInteger(n.position.x)||!Number.isSafeInteger(n.position.y)||!Array.isArray(n.approachCells))throw invalid();return data;}
async function readService(serviceId,signal){
 const data=readTownPublic(await api(`/town/service?${new URLSearchParams({serviceId})}`,{signal})),s=data.service;
 if(s?.serviceId!==serviceId||!text(s.name,100)||!text(s.description,4000)||!text(s.action,180)||!integer(s.durationMs)||!(s.itemCost===null||Object.hasOwn(names,s.itemCost))||!Array.isArray(s.topics)||s.topics.length>10||s.topics.some(topic=>!text(topic.id,100)||!text(topic.label,100))||data.npc?.npcId!==s.npcId||data.npc.serverManaged!==true||data.npc.countsAsAgent!==false)throw invalid();return data;
}
export async function readTownOwner(session,operation,input={},options={}){
 const agentId=session.snapshot().selectedAgentId,envelope=await session.readTownService(operation,input,options),data=envelope?.data;
 if(envelope?.protocolVersion!==1||data?.agentId!==agentId||!integer(data.asOf))throw invalid();
 if(operation==='relationships'&&(!Array.isArray(data.relationships)||data.relationships.length>50||typeof data.complete!=='boolean'||(data.complete?data.nextAfterNpcId!==null:!text(data.nextAfterNpcId,180)||!data.nextAfterNpcId)||data.relationships.some(row=>!text(row.npcId,180)||!integer(row.familiarity)||row.familiarity>100)))throw invalid();
 if(operation==='inventory'&&(!Array.isArray(data.items)||data.items.length>50||typeof data.complete!=='boolean'||(data.complete?data.nextAfterId!==null:!text(data.nextAfterId,180)||!data.nextAfterId)||data.items.some(row=>!text(row.itemInstanceId,180)||!Object.hasOwn(names,row.itemKind)||!['available','reserved','consumed'].includes(row.state)||row.availableQuantity!==(row.state==='available'?1:0)||row.quantity!==(row.state==='consumed'?0:1)||row.transferable!==false)))throw invalid();
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
function townIcon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('town-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',townPaths[name]||townPaths.info);svg.append(path);return svg;}
function sectionTitle(number,label){const title=el('h3','town-section-title'),badge=el('span','town-section-number',number);badge.setAttribute('aria-hidden','true');title.append(badge,document.createTextNode(label));return title;}
function familiarity(value){const box=el('div','town-familiarity'),meter=el('progress');meter.max=100;meter.value=value;meter.setAttribute('aria-label',`熟悉度 ${value} / 100`);box.append(el('span','',`熟悉度 ${value} / 100`),meter);return box;}
function factLine(label,kind='info'){const line=el('p','town-fact');line.append(townIcon(kind),document.createTextNode(label));return line;}
function portrait(fields,className){const picture=el('span',className);avatar(picture,fields);return picture;}

// One read-only source card. Opening it never greets, claims, consumes or rests.
export function createTownServiceCard(session,{chooseAgent=()=>{},getWorldState=()=>null}={}){
 const node=el('section','town-service-card');
 let target=null,context=session.snapshot(),active=false,generation=0,abort=null,publicData=null,privateData=null,phase='idle',privatePhase='idle',message='',messageNode=null;
 function cancel(){generation++;abort?.abort();abort=null;}
 function footer(){const box=el('footer','town-card-footer');messageNode=el('p','town-card-message',message||'复制后交给 Agent 执行。');messageNode.setAttribute('role','status');messageNode.setAttribute('aria-live','polite');box.append(townIcon('info'),messageNode);return box;}
 async function copy(service,topic=null,kind='service'){
  const turn=generation,npc=publicData.npc,agent=selected(context);
  const intent=kind==='cancel'?'取消你当前尚未完成的这次休息':kind==='greet'?'向它打个招呼':service.serviceId==='welcome.claim'?'领取尚未领取的新邻居礼包':service.serviceId==='inn.rest'?'使用一张休息券休息一分钟':`使用一张招待券，聊聊「${topic.label}」`;
  try{await navigator.clipboard.writeText(`请先阅读 ${location.origin}/agent/entry.md 的最新世界指南，${agent?`以${agent.name}的身份`:'以自己的身份'}拜访${npc.name}，${intent}。请先确认当前服务条件，再到实际服务交互处，按当前参与和权限设置行动，并如实告诉我结果。`);if(turn!==generation||!active)return;message='已复制。交给你的 Agent 后，由它按当前条件决定和行动。';}
  catch{if(turn!==generation||!active)return;message='暂时无法复制，请稍后重试。';}
  if(messageNode)messageNode.textContent=message;
 }
 function actionRow(label,iconName,run,{disabled=false,reason='',ariaLabel=`复制${label}指令`}={}){
  const row=el('div','town-action-row'),title=el('span','town-action-label'),button=control('复制指令',run);title.append(townIcon(iconName),document.createTextNode(label));button.setAttribute('aria-label',ariaLabel);button.disabled=disabled;if(reason)button.title=reason;row.classList.toggle('is-disabled',disabled);row.append(title,button);return row;
 }
 function arrival(agent,npc){
  const world=getWorldState()?.worldScene,row=world?.avatars?.find(row=>row.fact.agentId===agent.agentId)?.fact;
  const fresh=world?.complete&&['ready','refreshing'].includes(world.phase)&&Date.now()-world.lastSuccessAt<=5000;
  return fresh&&row?npc.approachCells.some(cell=>cell.x===row.position.x&&cell.y===row.position.y)?'已到服务附近。':'尚未到服务附近。':'当前位置尚未确认。';
 }
 function currentAgentSection(){
  const box=el('section','town-section town-personal-state'),agent=selected(context);box.append(sectionTitle('2',agent?`与${agent.name}的关系`:'与当前 Agent 的关系'));
  if(!agent){box.append(el('p','hud-muted',context.authenticated?'选择一位自己的 Agent，可查看它的券和服务进度。':context.phase==='expired'?'登录已失效，请重新登录后查看。':'登录后，可观察自己 Agent 的券和服务进度。'),control(context.authenticated?'选择 Agent':'登录／注册',chooseAgent));return box;}
  const row=el('div','town-agent-relation'),identity=el('div','town-current-agent'),identityText=el('div','town-agent-identity');
  identityText.append(el('strong','',agent.name),control('切换 Agent',chooseAgent));identity.append(portrait({appearance:agent.appearance??agent.avatar,displayName:agent.name},'town-agent-picture'),identityText);row.append(identity);
  const facts=el('div','town-relation-facts');
  if(privatePhase==='ready'){
   const relation=privateData.relationships.relationships.find(row=>row.npcId===publicData.npc.npcId);
   const line=el('div','town-relationship-fact');line.append(factLine(relation?'已结识':privateData.relationships.complete?'尚未结识':'结识情况尚未全部读取',relation?'check':'info'));if(relation)line.append(familiarity(relation.familiarity));facts.append(line);
  }else facts.append(el('p','hud-muted',privatePhase==='loading'?'正在读取关系…':'关系暂未取得。'));
  const participation=el('div','town-participation-facts');participation.append(factLine(arrival(agent,publicData.npc),'location'));
  if(privatePhase==='ready'&&privateData.progress.activeRest?.npcId===publicData.npc.npcId)participation.append(factLine('正在休息','rest'));facts.append(participation);
  if(agent.ownerPaused)facts.append(el('p','hud-muted','主人已暂停参与。'));else if(agent.platformRestricted)facts.append(el('p','hud-muted','当前参与受到限制。'));
  row.append(facts);box.append(row);return box;
 }
 function statusBox(service){
  const box=el('div','town-service-status');box.setAttribute('role','status');const content=el('div','town-status-copy');box.append(townIcon('info'),content);
  if(!selected(context))content.append(el('p','','登录并选择 Agent 后，可查看实际状态。'));
  else if(privatePhase==='loading')content.append(el('p','','正在读取当前情况…'));
  else if(privatePhase!=='ready')content.append(el('p','',privatePhase==='forbidden'?'当前情况暂不可查看，请重新选择 Agent。':'当前情况暂时无法读取。'));
  else{
   const {progress,operation}=privateData,rest=progress.activeRest;
   if(rest?.npcId===publicData.npc.npcId)content.append(el('p','','正在休息，券已保留。'),el('p','hud-muted','完成后扣除；取消则释放。'));
   else if(operation?.state==='completed'){
    if(service.serviceId!=='tavern.host'||!operation.response)content.append(el('p','',service.serviceId==='welcome.claim'?'新邻居礼包已领取，招待券和休息券各一张。':service.serviceId==='inn.rest'?'本次休息已完成。':'本次招待已完成。'));
    if(text(operation.response,4000)&&operation.response)content.append(el('p','town-response',operation.response));
   }else if(operation?.state==='cancelled')content.append(el('p','','这次服务已取消。保留的券已按实际结果处理。'));
   else content.append(el('p','',service.serviceId==='welcome.claim'?'当前状态：尚未领取新邻居礼包。':service.serviceId==='inn.rest'?'当前没有正在进行的休息。':'尚未读取到这项服务的完成结果。'));
  }
  if(selected(context)){const retry=control('',()=>void load());retry.className='town-status-refresh';retry.setAttribute('aria-label',privatePhase==='error'||privatePhase==='forbidden'?'重新读取':'刷新当前情况');retry.title='重新读取当前情况';retry.append(townIcon('refresh'));retry.disabled=privatePhase==='loading';box.append(retry);}
  return box;
 }
 function guideSection(service,npc){
  const box=el('section','town-section town-action-guide');box.append(sectionTitle('3','行动指引'));
  const plan=el('div','town-service-plan'),offer=el('div','town-service-offer'),offerText=el('div');offer.append(townIcon(service.serviceId==='welcome.claim'?'gift':service.serviceId==='inn.rest'?'rest':'tea'));offerText.append(el('h4','',service.name));
  let condition=service.itemCost?`需要 1 张${names[service.itemCost]}`:'每位 Agent 限领一次，无需用券';
  if(service.durationMs)condition+=` · 约 ${service.durationMs/1000} 秒`;
  if(service.itemCost&&privatePhase==='ready'){
   const items=privateData.inventory.items.filter(item=>item.itemKind===service.itemCost),count=items.reduce((sum,item)=>sum+item.availableQuantity,0);condition+=` · ${names[service.itemCost]}：${count} 张可用${privateData.inventory.complete?'':'（已读取部分）'}`;
  }
  offerText.append(el('p','hud-muted',condition));if(service.serviceId==='welcome.claim')offerText.append(el('p','town-gift-contents','招待券 ×1 · 休息券 ×1'));offer.append(offerText);plan.append(offer);
  if(npc.actions.includes('town_services.npc.greet'))plan.append(actionRow('打个招呼','greet',()=>void copy(service,null,'greet'),{ariaLabel:'复制问候指令'}));
  const resting=privatePhase==='ready'&&privateData.progress.activeRest?.npcId===npc.npcId;
  const claimed=privatePhase==='ready'&&service.serviceId==='welcome.claim'&&privateData.progress.claim?.state==='completed';
  const unknownState=Boolean(selected(context))&&privatePhase!=='ready';
  if(npc.actions.includes(service.action)){
   if(service.topics.length)for(const topic of service.topics)plan.append(actionRow(topic.label,topic.id==='town'?'location':'tea',()=>void copy(service,topic),{ariaLabel:`复制「${topic.label}」指令`}));
   else plan.append(actionRow(service.serviceId==='inn.rest'?'开始休息':'领取新邻居礼包',service.serviceId==='inn.rest'?'rest':'gift',()=>void copy(service),{disabled:Boolean(resting||claimed||unknownState),reason:resting?'正在休息，请等待实际结果或复制取消指令。':claimed?'本期礼包已经领取。':unknownState?'请先取得当前服务状态。':'',ariaLabel:service.serviceId==='inn.rest'?'复制开始休息指令':'复制领取新邻居礼包指令'}));
  }
  if(service.serviceId==='inn.rest'&&npc.actions.includes('town_services.inn.rest.cancel'))plan.append(actionRow('取消休息','cancel',()=>void copy(service,null,'cancel'),{disabled:!resting,reason:resting?'':'当前没有获准取消的进行中休息。',ariaLabel:'复制取消休息指令'}));
  plan.append(statusBox(service));box.append(plan);return box;
 }
 function render(){
  node.replaceChildren();messageNode=null;if(!active)return;node.dataset.townKind=target?.notice&&phase!=='ready'?'notice':'npc';node.setAttribute('aria-busy',String(phase==='loading'));
  if(phase==='loading'||phase==='error'){
   const state=el('div','town-card-state');state.append(el('p','hud-muted',phase==='loading'?'正在读取小镇服务…':'小镇服务暂时无法读取。'));if(phase==='error')state.append(control('重试服务说明',()=>void load()));node.append(state,footer());return;
  }
  if(phase==='notice'){
   const n=publicData.notice,notice=el('article','town-notice');notice.append(el('p','town-notice-source','小镇公告牌 · 小镇物件'),el('h3','',n.title),el('p','town-notice-text',n.text));
   const links=el('nav','town-notice-services');links.setAttribute('aria-label','公告中的服务说明');for(const id of n.serviceIds)links.append(control(({'welcome.claim':'新邻居礼包','tavern.host':'酒馆招待','inn.rest':'旅社休息'})[id]||'服务说明',()=>open({serviceId:id,catalogVersion:publicData.catalogVersion})));notice.append(links);node.append(notice);return;
  }
  if(!publicData)return;
  const {npc,service}=publicData,intro=el('section','town-section town-introduction'),heading=el('div','town-service-heading'),identity=el('div','town-npc-identity');intro.append(sectionTitle('1','NPC 介绍'));
  identity.append(el('h4','town-npc-name',npc.name),el('p','hud-muted',npc.role),el('p','town-npc-description',service.description));
  const building=getWorldState()?.rules?.mapManifest?.buildings.find(row=>row.id===npc.buildingId);identity.append(factLine(building?`地点：${building.name}附近。`:'地点说明暂未取得。','location'));
  heading.append(portrait({appearance:npc.appearance,displayName:npc.name},'town-npc-picture'),identity);intro.append(heading);
  node.append(intro,currentAgentSection(),guideSection(service,npc),footer());
 }
 async function load(){
  if(!active||!target)return;cancel();const turn=generation,controller=new AbortController();abort=controller;phase='loading';privatePhase='idle';publicData=null;privateData=null;message='';render();
  try{
   const response=target.notice?await readTownNotice({signal:controller.signal}):await readService(target.serviceId||target.npc.serviceIds[0],controller.signal);if(turn!==generation||!active)return;
   if(response.catalogVersion!==target.catalogVersion||target.npc&&response.npc.npcId!==target.npc.npcId)throw invalid();publicData=response;phase=target.notice?'notice':'ready';render();if(target.notice||!selected(context))return;
   const agentId=context.selectedAgentId;privatePhase='loading';render();
   try{
    const [progress,inventory,relationships]=await Promise.all(['progress','inventory','relationships'].map(operation=>readTownOwner(session,operation,{}, {signal:controller.signal})));if(turn!==generation||agentId!==context.selectedAgentId||!active)return;
    let operation=progress.activeRest?.npcId===response.npc.npcId?progress.activeRest:progress.claim?.npcId===response.npc.npcId?progress.claim:null;
    const latest=progress.completedServices.filter(row=>row.npcId===response.npc.npcId&&row.serviceId===response.service.serviceId).sort((a,b)=>b.completedAt-a.completedAt)[0];
    if(!operation&&latest)operation=(await readTownOwner(session,'operation',{operationId:latest.operationId},{signal:controller.signal})).operation;
    if(turn!==generation||agentId!==context.selectedAgentId||!active)return;
    if(operation&&(operation.npcId!==response.npc.npcId||operation.serviceId!==response.service.serviceId))throw invalid();
    privateData={progress,inventory,relationships,operation};privatePhase='ready';
   }catch(error){if(turn!==generation||controller.signal.aborted)return;privateData=null;privatePhase=[401,403,404].includes(error.status)?'forbidden':'error';}
   render();
  }catch(error){if(turn!==generation||controller.signal.aborted)return;publicData=null;privateData=null;phase='error';render();}
 }
 function open(value){target=value;active=true;void load();}
 const stop=session.subscribe(value=>{const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){privateData=null;privatePhase='idle';if(active)void load();}});
 return{node,open,close(){active=false;cancel();target=publicData=privateData=null;messageNode=null;node.replaceChildren();},dispose(){active=false;cancel();stop();}};
}
export function createTownRelationships(session,{openNpc=()=>{}}={}){
 const node=el('section','town-relationships');let active=false,context=session.snapshot(),rows=[],complete=false,cursor=null,phase='idle',revision=0,abort=null;
 function clear(){revision++;abort?.abort();abort=null;rows=[];cursor=null;complete=false;phase='idle';render();}
 function render(){
  node.replaceChildren();if(!active)return;node.append(el('h3','','镇民关系 · 熟悉度'),el('p','hud-muted','这里只显示当前 Agent 已结识的镇民。熟悉度最高为 100。'));
  if(phase==='loading'&&!rows.length){node.append(el('p','hud-muted','正在读取已结识的镇民…'));return;}
  if(phase==='error'){node.append(el('p','hud-muted','镇民关系暂时无法读取。'),control('重试镇民关系',()=>void load()));return;}
  if(phase!=='ready')return;if(!rows.length)node.append(el('p','hud-muted','还没有结识镇民。可以让 Agent 先去打个招呼。'));
  for(const relation of rows){const row=el('div','town-relationship'),npc=relation.npc,copy=el('div');if(npc)row.append(portrait({appearance:npc.appearance,displayName:npc.name},'town-relationship-picture'));copy.append(el('strong','',npc?.name||'一位已结识的镇民'),familiarity(relation.familiarity));row.append(copy);if(npc)row.append(control('服务说明',()=>openNpc(npc)));node.append(row);}
  if(!complete)node.append(control('继续载入镇民',()=>void load(true)));node.append(control('刷新镇民关系',()=>void load()));
 }
 async function load(more=false){
  if(!active||!selected(context))return;revision++;abort?.abort();const turn=revision,controller=new AbortController();abort=controller;if(!more){rows=[];cursor=null;}phase='loading';render();
  try{const result=await readTownOwner(session,'relationships',cursor?{afterNpcId:cursor}:{},{signal:controller.signal});if(turn!==revision||!active)return;rows=more?[...rows,...result.relationships]:result.relationships;complete=result.complete;cursor=result.nextAfterNpcId;phase='ready';render();}
  catch(error){if(turn!==revision||controller.signal.aborted)return;rows=[];phase='error';render();}
 }
 return{node,activate(){active=true;void load();},deactivate(){active=false;clear();},setContext(value){const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){clear();if(active)void load();}},dispose(){active=false;clear();}};
}
