import {el} from '../common.js';
import {publicIdLabel} from '../public-id.js';
import {createNpcLifeDirectoryReader,createNpcCareOptionsReader,buildNpcCareIntent} from './npc-life-reader.js';

export const npcLifePlace=place=>place?.kind==='npc-care-point'||(place?.npc||place?.serviceNpc)?.npcId==='npc-gardener';
const when=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const reasonText={care_point_busy:'这处照料点正在使用。',care_point_cooldown:'这处照料点正在冷却。',care_personal_cooldown:'本人今天已完成过这处照料。',care_npc_away:'青禾暂时不在接待处。',care_npc_busy:'青禾正在接待，请稍后再看。',care_energy_insufficient:'本人可用体力不足。',body_occupied:'本人正在进行其他身体活动。',care_not_enabled:'这项照料尚未开放。',care_material_unavailable:'这里当前没有实际可清理的待办。',care_participation_unavailable:'本人当前未获准参与照料。'};
const reason=value=>reasonText[value]||'当前条件不允许开始，请由 Agent 读取最新原因。';
function facts(node,rows){node.replaceChildren();for(const[label,value]of rows)node.append(el('dt','',label),el('dd','',value));}
function control(label,run){const node=el('button','',label);node.type='button';node.addEventListener('click',run);return node;}

// The public board and private eligibility stay separate; this view never writes
// an activity, creates an introduction, or treats a copied goal as a receipt.
export function createNpcLifePlace(session,{directoryReader,getRules,chooseAgent=()=>{}}={}){
 const directory=directoryReader||createNpcLifeDirectoryReader({getRules}),ownDirectory=!directoryReader,options=createNpcCareOptionsReader(session),node=el('section','npc-life-place'),heading=el('h3','','园务牌'),presence=el('p'),status=el('p','life-status'),pointsHost=el('div','npc-care-points'),empty=el('p','hud-muted'),terms=el('details','life-cancellation'),termsText=el('p','hud-muted'),copyStatus=el('p','life-copy-status'),copyDetail=el('details','life-copy-guide'),copyText=el('pre'),refresh=control('刷新园务牌',()=>{void directory.refresh();void options.refresh();}),choose=control('选择自己的 Agent',chooseAgent);
 status.setAttribute('role','status');copyStatus.setAttribute('role','status');terms.append(el('summary','','取消与冷却规则'),termsText);copyDetail.append(el('summary','','给 Agent 的完整照料意图'),copyText);node.append(heading,presence,status,pointsHost,empty,terms,choose,refresh,copyStatus,copyDetail);node.hidden=true;
 let context=session.snapshot(),publicState=directory.snapshot(),privateState=options.snapshot(),active=false,worldStale=false,revision=0,message='',copied='',pointOrder='',sourceKey='';const cards=new Map();
 const selected=()=>context.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(a=>a.agentId===context.selectedAgentId):null;
 function invalidate(){revision++;message=copied='';}
 function ready(){return active&&!worldStale&&publicState.phase==='ready'&&!publicState.stale&&privateState.phase==='ready'&&!privateState.stale&&selected();}
 async function copy(pointId){
  const point=publicState.data?.carePoints.find(p=>p.pointId===pointId),eligibility=privateState.data?.points.find(p=>p.pointId===pointId&&p.version===point?.version),agent=selected();if(!ready()||!point?.available||!eligibility?.available)return;
  const turn=revision;let text;try{text=buildNpcCareIntent({origin:location.origin,agentLabel:`${agent.name} · ${publicIdLabel(agent.publicId)}`,directory:publicState.data,point,options:privateState.data});}catch{message='照料资料尚未确认，请刷新园务牌。';render();return;}
  copied=text;try{await navigator.clipboard.writeText(text);if(turn!==revision||!active)return;message='照料意图已复制，请交给你自己的 Agent。';}catch{if(turn!==revision||!active)return;message='浏览器未允许复制，可在下方手动复制完整意图。';}copyDetail.open=true;render();
 }
 function pointView(point){
  let view=cards.get(point.pointId);if(view)return view;
  const card=el('article','life-card npc-care-point'),title=el('h4'),publicStatus=el('p','life-condition'),publicFacts=el('dl','life-facts'),personal=el('p','hud-muted'),intro=el('p','hud-muted'),guide=el('details'),guideTitle=el('summary'),guideBody=el('p','npc-care-guide-body'),button=control('复制照料意图给 Agent',()=>void copy(point.pointId));card.dataset.pointId=point.pointId;guide.append(guideTitle,guideBody);card.append(title,publicStatus,publicFacts,personal,intro,guide,button);view={card,title,publicStatus,publicFacts,personal,intro,guideTitle,guideBody,button};cards.set(point.pointId,view);return view;
 }
 function render(){
  node.hidden=!active;if(!active)return;const data=publicState.data,agent=selected(),npc=data?.npcs.find(n=>n.npcId==='npc-gardener');heading.textContent='园务互动';
  presence.hidden=!npc;presence.textContent=npc?`${npc.present?npc.busy?'青禾正在接待。':'青禾在接待处，可按当前规则了解照料方法。':'青禾暂时不在接待处；园务说明仍可阅读。'}${data?`（确认于 ${when(data.asOf)}）`:''}`:'';
  status.textContent=worldStale||publicState.stale?'上次园务状态已过期，不能据此开始照料。':['idle','loading'].includes(publicState.phase)?'正在读取真实园务状态…':publicState.phase==='refreshing'?'正在更新园务状态…':!data?publicState.errorStatus===404?'园务照料当前尚未启用。':'园务来源暂时无法读取，请重试。':'';status.hidden=!status.textContent;
  empty.hidden=Boolean(data?.carePoints.length)||!data;empty.textContent='当前目录没有已启用的照料点。';choose.hidden=Boolean(agent)||!data;choose.textContent=context.authenticated?'选择自己的 Agent':'登录／注册';
  terms.hidden=!data;termsText.textContent=data?`开始时预留体力；主动取消或失去参与资格时，按实际已用时间比例结算体力，不写成照料完成。系统中断按真实结果处理。完成后点位冷却 ${data.rules.pointCooldownMs/60000} 分钟；本人对同一点下次参与至少间隔 ${data.rules.actorPointCooldownMs/3600000} 小时。复制只交付意图，不会由主人开始活动。`:'';
  if(!data){pointsHost.replaceChildren();cards.clear();pointOrder='';}else{
   const ids=data.carePoints.map(p=>p.pointId).join('|');if(ids!==pointOrder){for(const[id,view]of cards)if(!data.carePoints.some(p=>p.pointId===id)){view.card.remove();cards.delete(id);}pointsHost.replaceChildren(...data.carePoints.map(p=>pointView(p).card));pointOrder=ids;}
   for(const point of data.carePoints){const view=pointView(point),own=privateState.data?.points.find(p=>p.pointId===point.pointId&&p.version===point.version),guide=data.guides.find(g=>g.id===point.guideRef.id&&g.version===point.guideRef.version&&g.digest===point.guideRef.digest),intro=own?.introduction;view.title.textContent=point.name;view.publicStatus.textContent=point.available?'公共照料点当前可用；本人资格另行核对。':reason(point.reason);
    facts(view.publicFacts,[['照料方式',point.careKind==='water'?'给花圃浇水':'清理小径边'],['本次时长',`${data.rules.durationMs/1000} 秒`],['预留体力',String(data.rules.energyCost)],['星币与背包物品','不收费，不发币或工具'],['上次照料',point.lastCareAt===null?'尚无已提交的照料记录':`${point.careKind==='water'?'已浇水':'已清理'} · ${when(point.lastCareAt)}`],...(point.nextEligibleAt===null?[]:[['点位冷却截止',when(point.nextEligibleAt)]])]);
    view.personal.textContent=!agent?'登录并选择自己的 Agent 后，可查看本人的照料资格。':!privateState.data?privateState.phase==='forbidden'?'当前无权查看这位 Agent 的照料资格。':['loading','refreshing'].includes(privateState.phase)?'正在读取本人的照料资格…':'本人资格尚未取得，不推定可以开始。':privateState.stale?'上次本人资格已过期，请重新读取。':own?`${own.available?'本人当前符合照料条件。':reason(own.reason)}${own.nextEligibleAt===null?'':` 本人下次可参与时间：${when(own.nextEligibleAt)}。`}`:'本人的这处照料资格尚未取得。';
    view.intro.hidden=!intro;view.intro.textContent=intro?intro.consumedByActivityId?'本计划的介绍已用于已提交的照料活动，不代表活动已经完成。':`本计划已有真实介绍，有效至 ${when(intro.expiresAt)}。`:'';view.guideTitle.textContent=guide?.title||'说明暂未取得';view.guideBody.textContent=guide?.body||'';view.button.disabled=!ready()||!point.available||!own?.available||!guide;
   }
  }
  refresh.disabled=['loading','refreshing'].includes(publicState.phase);copyStatus.hidden=!message;copyStatus.textContent=message;copyDetail.hidden=!copied;copyText.textContent=copied;
 }
 const stopPublic=directory.subscribe(value=>{publicState=value;const key=value.data?JSON.stringify([value.data.definitionVersion,value.data.npcs.map(n=>[n.npcId,n.version]),value.data.carePoints.map(p=>[p.pointId,p.version])]):'';if(!value.data||value.stale||key!==sourceKey){sourceKey=key;invalidate();}render();});
 const stopPrivate=options.subscribe(value=>{privateState=value;if(!value.data||value.stale)invalidate();render();});
 const stopSession=session.subscribe(value=>{if(value.observationRevision!==context.observationRevision||value.selectedAgentId!==context.selectedAgentId||value.authenticated!==context.authenticated)invalidate();context=value;render();});
 return{node,open(){active=true;node.hidden=false;if(ownDirectory)directory.setActive(true);options.setActive(true);render();},observeWorld(value){const next=value.stale===true||value.phase==='paused';if(next!==worldStale){worldStale=next;invalidate();render();}},refresh(){void directory.refresh();void options.refresh();},close(){active=false;invalidate();options.setActive(false);if(ownDirectory)directory.setActive(false);node.hidden=true;},dispose(){active=false;invalidate();stopPublic();stopPrivate();stopSession();options.dispose();if(ownDirectory)directory.dispose();cards.clear();node.replaceChildren();}};
}
