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
// One read-only source card. Opening it never greets, claims, consumes or rests.
export function createTownServiceCard(session,{chooseAgent=()=>{},getWorldState=()=>null}={}){
 const node=el('section','town-service-card');let target=null,context=session.snapshot(),active=false,generation=0,abort=null,publicData=null,privateData=null,phase='idle',privatePhase='idle',message='';
 function cancel(){generation++;abort?.abort();abort=null;}
 async function copy(service,topic=null,greet=false,cancelRest=false){
  const turn=generation,npc=publicData.npc,agent=selected(context),intent=cancelRest?'取消当前尚未完成的休息':greet||service.serviceId==='greet'?'向它打个招呼':service.serviceId==='welcome.claim'?'领取尚未领取的新邻居礼包':service.serviceId==='inn.rest'?'使用一张休息券休息一分钟':`使用一张招待券，聊聊「${topic?.label||'欢迎新邻居'}」`;
  try{await navigator.clipboard.writeText(`请先阅读 ${location.origin}/agent/entry.md 的最新世界指南，${agent?`以${agent.name}的身份`:'以自己的身份'}拜访${npc.name}，${intent}。请遵守当前参与和权限设置，按实际条件行动，并如实告诉我结果。`);if(turn!==generation)return;message='已复制。交给你的 Agent 后，由它按当前条件决定和行动。';}catch{if(turn!==generation)return;message='暂时无法复制，请稍后重试。';}render();
 }
 function progressNodes(service){
  const box=el('section','town-personal-state'),agent=selected(context);box.append(el('h4','',agent?`${agent.name} 的当前情况`:'我的 Agent'));
  if(!agent){box.append(el('p','hud-muted',context.authenticated?'选择一位自己的 Agent，可查看它的券和服务进度。':context.phase==='expired'?'登录已失效，请重新登录后查看。':'登录后，可观察自己 Agent 的券和服务进度。'),control(context.authenticated?'选择 Agent':'登录／注册',chooseAgent));return box;}
  if(privatePhase==='loading'){box.append(el('p','hud-muted','正在读取当前情况…'));return box;}
  if(privatePhase!=='ready'){box.append(el('p','hud-muted',privatePhase==='forbidden'?'当前情况暂不可查看，请重新选择 Agent。':'当前情况暂时无法读取。'),control('重新读取',()=>void load()));return box;}
  const {progress,inventory,relationships,operation}=privateData,npc=publicData.npc,relation=relationships.relationships.find(row=>row.npcId===npc.npcId);
  box.append(el('p','',relation?`已结识 · 熟悉度 ${relation.familiarity} / 100`:relationships.complete?'尚未结识':'结识情况尚未全部读取'));
  const world=getWorldState()?.worldScene,row=world?.avatars.find(row=>row.fact.agentId===agent.agentId)?.fact,fresh=world?.complete&&['ready','refreshing'].includes(world.phase)&&Date.now()-world.lastSuccessAt<=5000;
  box.append(el('p','hud-muted',agent.ownerPaused?'主人已暂停参与。':agent.platformRestricted?'当前参与受到限制。':fresh&&row?npc.approachCells.some(cell=>cell.x===row.position.x&&cell.y===row.position.y)?'已到服务附近。':'还没有到服务附近。':'当前位置尚未确认。'));
  if(service.itemCost){const items=inventory.items.filter(item=>item.itemKind===service.itemCost),count=items.reduce((sum,item)=>sum+item.availableQuantity,0);box.append(el('p','',`${names[service.itemCost]}：${count} 张可用${inventory.complete?'':'（已读取部分）'}`));if(items.some(item=>item.state==='reserved'))box.append(el('p','hud-muted','有一张券正在为休息保留。'));}
  if(service.serviceId==='welcome.claim')box.append(el('p','',progress.claim?.state==='completed'?'新邻居礼包已领取。':'尚未领取本期新邻居礼包。'));
  const rest=progress.activeRest;if(rest&&rest.npcId===npc.npcId){box.append(el('p','','正在休息，券已保留；实际完成后才会扣除。'),...(npc.actions.includes('town_services.inn.rest.cancel')?[control('复制取消休息指令',()=>void copy(service,null,false,true))]:[]));}
  if(operation?.state==='completed'){box.append(el('h4','','实际结果'),el('p','',service.serviceId==='welcome.claim'?'已领取招待券和休息券各一张。':service.serviceId==='inn.rest'?'本次休息已完成。':'本次招待已完成。'));if(text(operation.response,4000)&&operation.response)box.append(el('p','town-response',operation.response));}
  else if(operation?.state==='cancelled')box.append(el('p','hud-muted','这次服务已取消。保留的券已按实际结果处理。'));
  box.append(control('刷新当前情况',()=>void load()));return box;
 }
 function render(){
  node.replaceChildren();if(!active)return;node.append(el('p','town-card-message',message));
  if(phase==='loading'){node.append(el('p','hud-muted','正在读取小镇服务…'));return;}
  if(phase==='error'){node.append(el('p','hud-muted','小镇服务暂时无法读取。'),control('重试服务说明',()=>void load()));return;}
  if(phase==='notice'){const n=publicData.notice;node.append(el('h3','',n.title),el('p','town-notice-text',n.text));for(const id of n.serviceIds)node.append(control(({ 'welcome.claim':'新邻居礼包','tavern.host':'酒馆招待','inn.rest':'旅社休息'})[id]||'服务说明',()=>open({serviceId:id,catalogVersion:publicData.catalogVersion})));node.append(el('p','hud-muted','公告牌 · 小镇物件'));return;}
  if(!publicData)return;const {npc,service}=publicData,head=el('div','town-service-heading'),picture=el('span');avatar(picture,{appearance:npc.appearance,displayName:npc.name});const title=el('div');title.append(el('h3','',npc.name),el('p','hud-muted',`${npc.role} · 小镇规则角色`));head.append(picture,title);node.append(head,el('h3','',service.name),el('p','',service.description));const building=getWorldState()?.rules?.mapManifest?.buildings.find(row=>row.id===npc.buildingId);node.append(el('p','hud-muted',building?`地点：${building.name}附近。`:'地点说明暂未取得。'));
  node.append(el('p','hud-muted',`需要：${service.itemCost?`1 张${names[service.itemCost]}`:'无需用券'}${service.durationMs?` · 约 ${service.durationMs/1000} 秒`:''}。先让 Agent 到附近，能否办理以实际条件为准。`));
  if(npc.actions.includes('town_services.npc.greet'))node.append(control('复制问候指令',()=>void copy(service,null,true)));
  if(npc.actions.includes(service.action)){if(service.topics.length)for(const topic of service.topics)node.append(control(`复制「${topic.label}」指令`,()=>void copy(service,topic)));else node.append(control('复制给 Agent',()=>void copy(service)));}
  node.append(el('p','hud-muted','网页只供观察，不会替 Agent 领取、消费或开始服务。'),progressNodes(service));
 }
 async function load(){
  if(!active||!target)return;cancel();const turn=generation,controller=new AbortController();abort=controller;phase='loading';privatePhase='idle';publicData=null;privateData=null;message='';render();
  try{
   const response=target.notice?await readTownNotice({signal:controller.signal}):await readService(target.serviceId||target.npc.serviceIds[0],controller.signal);if(turn!==generation||!active)return;
   if(response.catalogVersion!==target.catalogVersion||target.npc&&response.npc.npcId!==target.npc.npcId)throw invalid();publicData=response;phase=target.notice?'notice':'ready';render();if(target.notice||!selected(context))return;
   const agentId=context.selectedAgentId;privatePhase='loading';render();
   try{const [progress,inventory,relationships]=await Promise.all(['progress','inventory','relationships'].map(operation=>readTownOwner(session,operation,{}, {signal:controller.signal})));if(turn!==generation||agentId!==context.selectedAgentId)return;let operation=progress.claim?.npcId===response.npc.npcId?progress.claim:progress.activeRest?.npcId===response.npc.npcId?progress.activeRest:null;const latest=progress.completedServices.filter(row=>row.npcId===response.npc.npcId&&row.serviceId===response.service.serviceId).sort((a,b)=>b.completedAt-a.completedAt)[0];if(latest)operation=(await readTownOwner(session,'operation',{operationId:latest.operationId},{signal:controller.signal})).operation;if(turn!==generation||agentId!==context.selectedAgentId)return;privateData={progress,inventory,relationships,operation};privatePhase='ready';}
   catch(error){if(turn!==generation||controller.signal.aborted)return;privateData=null;privatePhase=[401,403,404].includes(error.status)?'forbidden':'error';}render();
  }catch(error){if(turn!==generation||controller.signal.aborted)return;publicData=null;phase='error';render();}
 }
 function open(value){target=value;active=true;void load();}
 const stop=session.subscribe(value=>{const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){privateData=null;privatePhase='idle';if(active)void load();}});
 return{node,open,close(){active=false;cancel();target=publicData=privateData=null;node.replaceChildren();},dispose(){active=false;cancel();stop();}};
}
export function createTownRelationships(session,{openNpc=()=>{}}={}){
 const node=el('section','town-relationships');let active=false,context=session.snapshot(),rows=[],complete=false,cursor=null,phase='idle',revision=0,abort=null;
 function clear(){revision++;abort?.abort();abort=null;rows=[];cursor=null;complete=false;phase='idle';render();}
 function render(){node.replaceChildren();if(!active)return;node.append(el('h3','','镇民关系 · 熟悉度'),el('p','hud-muted','镇民是小镇规则角色。打招呼后从 0 开始，首次完成具名服务增加 1；熟悉度最高 100。'));
  if(phase==='loading'&&!rows.length){node.append(el('p','hud-muted','正在读取已结识的镇民…'));return;}if(phase==='error'){node.append(el('p','hud-muted','镇民关系暂时无法读取。'),control('重试镇民关系',()=>void load()));return;}if(phase!=='ready')return;
  if(!rows.length)node.append(el('p','hud-muted','还没有结识镇民。可以让 Agent 先去打个招呼。'));
  for(const relation of rows){const row=el('div','town-relationship'),npc=relation.npc,picture=el('span'),copy=el('div');if(npc)avatar(picture,{appearance:npc.appearance,displayName:npc.name});copy.append(el('strong','',npc?.name||'一位已结识的镇民'),el('p','hud-muted',`熟悉度 ${relation.familiarity} / 100`));row.append(picture,copy);if(npc)row.append(control('服务说明',()=>openNpc(npc)));node.append(row);}if(!complete)node.append(control('继续载入镇民',()=>void load(true)));node.append(control('刷新镇民关系',()=>void load()));
 }
 async function load(more=false){if(!active||!selected(context))return;revision++;abort?.abort();const turn=revision,controller=new AbortController();abort=controller;if(!more){rows=[];cursor=null;}phase='loading';render();try{const result=await readTownOwner(session,'relationships',cursor?{afterNpcId:cursor}:{},{signal:controller.signal});if(turn!==revision||!active)return;rows=more?[...rows,...result.relationships]:result.relationships;complete=result.complete;cursor=result.nextAfterNpcId;phase='ready';render();}catch(error){if(turn!==revision||controller.signal.aborted)return;rows=[];phase='error';render();}}
 return{node,activate(){active=true;void load();},deactivate(){active=false;clear();},setContext(value){const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){clear();if(active)void load();}},dispose(){active=false;clear();}};
}
