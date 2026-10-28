import {el} from '../common.js';
import {msg,t,isMessage,bindText,clearBinding} from '../i18n/core.js';
import {createLifePresentation,lifeTime} from './life-presentation.js';
import {publicIdLabel} from '../public-id.js';
import {createNpcLifeDirectoryReader,createNpcCareOptionsReader,buildNpcCareIntent} from './npc-life-reader.js';

export const npcLifePlace=place=>place?.kind==='npc-care-point'||(place?.npc||place?.serviceNpc)?.npcId==='npc-gardener';
const m=(key,params)=>msg('public:npcCare.'+key,params);
const reasonKeys=new Set(['care_point_busy','care_point_cooldown','care_personal_cooldown','care_npc_away','care_npc_busy','care_energy_insufficient','body_occupied','care_not_enabled','care_material_unavailable','care_participation_unavailable']);
const reason=value=>'public:npcCare.reason.'+(reasonKeys.has(value)?value:'other');
function put(node,value){clearBinding(node);if(isMessage(value))bindText(node,value.key,value.params);else node.textContent=value;}
function facts(node,rows){node.replaceChildren();for(const[label,value]of rows)node.append(el('dt','',label),el('dd','',value));}
function control(label,run){const node=el('button','',label);node.type='button';node.addEventListener('click',run);return node;}

// The public board and private eligibility stay separate; this view never writes
// an activity, creates an introduction, or treats a copied goal as a receipt.
export function createNpcLifePlace(session,{directoryReader,getRules,chooseAgent=()=>{}}={}){
 const presentation=createLifePresentation(),directory=directoryReader||createNpcLifeDirectoryReader({getRules}),ownDirectory=!directoryReader,options=createNpcCareOptionsReader(session),node=el('section','npc-life-place'),heading=el('h3','',m('board')),presence=el('p'),status=el('p','life-status'),pointsHost=el('div','npc-care-points'),empty=el('p','hud-muted'),terms=el('details','life-cancellation'),termsText=el('p','hud-muted'),copyStatus=el('p','life-copy-status'),copyDetail=el('details','life-copy-guide'),copyText=el('pre'),refresh=control(m('refresh'),()=>{void directory.refresh();void options.refresh();}),choose=control(m('chooseAgent'),chooseAgent);
 status.setAttribute('role','status');copyStatus.setAttribute('role','status');terms.append(el('summary','',m('terms')),termsText);copyDetail.append(el('summary','',m('intent')),copyText);node.append(heading,presence,status,pointsHost,empty,terms,choose,refresh,copyStatus,copyDetail);node.hidden=true;
 let context=session.snapshot(),publicState=directory.snapshot(),privateState=options.snapshot(),active=false,worldStale=false,revision=0,message='',copied='',pointOrder='',sourceKey='';const cards=new Map();
 const selected=()=>context.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(a=>a.agentId===context.selectedAgentId):null;
 function invalidate(){revision++;message=copied='';}
 function ready(){return active&&!worldStale&&publicState.phase==='ready'&&!publicState.stale&&privateState.phase==='ready'&&!privateState.stale&&selected();}
 async function copy(pointId){
  const point=publicState.data?.carePoints.find(p=>p.pointId===pointId),eligibility=privateState.data?.points.find(p=>p.pointId===pointId&&p.version===point?.version),agent=selected();if(!ready()||!point?.available||!eligibility?.available)return;
  const turn=revision;let text;try{text=buildNpcCareIntent({origin:location.origin,agentLabel:`${agent.name} · ${publicIdLabel(agent.publicId)}`,directory:publicState.data,point,options:privateState.data});}catch{message='guideUnconfirmed';render();return;}
  copied=text;try{await navigator.clipboard.writeText(text);if(turn!==revision||!active)return;message='copyDone';}catch{if(turn!==revision||!active)return;message='copyFailed';}copyDetail.open=true;render();
 }
 function pointView(point){
  let view=cards.get(point.pointId);if(view)return view;
  const card=el('article','life-card npc-care-point'),title=el('h4'),publicStatus=el('p','life-condition'),publicFacts=el('dl','life-facts'),personal=el('p','hud-muted'),intro=el('p','hud-muted'),guide=el('details'),guideTitle=el('summary'),guideBody=el('p','npc-care-guide-body'),button=control(m('copy'),()=>void copy(point.pointId));card.dataset.pointId=point.pointId;guide.append(guideTitle,guideBody);card.append(title,publicStatus,publicFacts,personal,intro,guide,button);view={card,title,publicStatus,publicFacts,personal,intro,guideTitle,guideBody,button};cards.set(point.pointId,view);return view;
 }
 function render(){
  presentation.clear();node.hidden=!active;if(!active)return;const data=publicState.data,agent=selected(),npc=data?.npcs.find(n=>n.npcId==='npc-gardener');put(heading,m('heading'));
  presence.hidden=!npc;put(presence,npc?m('presenceAsOf',()=>({state:t('public:npcCare.'+(npc.present?npc.busy?'busy':'present':'away')),time:lifeTime(data.asOf)})):'');
  const statusKey=worldStale||publicState.stale?'stale':['idle','loading'].includes(publicState.phase)?'loading':publicState.phase==='refreshing'?'refreshing':!data?publicState.errorStatus===404?'notEnabled':'error':null;put(status,statusKey?m(statusKey):'');status.hidden=!statusKey;
  empty.hidden=Boolean(data?.carePoints.length)||!data;put(empty,m('empty'));choose.hidden=Boolean(agent)||!data;put(choose,context.authenticated?m('chooseAgent'):msg('shell:nav.account'));
  terms.hidden=!data;put(termsText,data?m('termsBody',{minutes:data.rules.pointCooldownMs/60000,hours:data.rules.actorPointCooldownMs/3600000}):'');
  if(!data){pointsHost.replaceChildren();cards.clear();pointOrder='';}else{
   const ids=data.carePoints.map(p=>p.pointId).join('|');if(ids!==pointOrder){for(const[id,view]of cards)if(!data.carePoints.some(p=>p.pointId===id)){view.card.remove();cards.delete(id);}pointsHost.replaceChildren(...data.carePoints.map(p=>pointView(p).card));pointOrder=ids;}
   for(const point of data.carePoints){const view=pointView(point),own=privateState.data?.points.find(p=>p.pointId===point.pointId&&p.version===point.version),guide=data.guides.find(g=>g.id===point.guideRef.id&&g.version===point.guideRef.version&&g.digest===point.guideRef.digest),intro=own?.introduction;point.careKind==='water'?presentation.label(view.title,'public:life.name',{name:point.name},{name:{namespace:'life-content',spec:{id:point.pointId,ref:point.pointId,version:data.definitionVersion,selector:{pointId:point.pointId},values:{name:point.name}},field:'name'}}):put(view.title,point.name);put(view.publicStatus,point.available?m('available'):msg(reason(point.reason)));
    facts(view.publicFacts,[[m('kind'),m(point.careKind==='water'?'water':'clean')],[m('duration'),msg('public:life.duration.seconds',{count:data.rules.durationMs/1000})],[m('energy'),String(data.rules.energyCost)],[m('moneyItems'),m('noCost')],[m('last'),point.lastCareAt===null?m('noLast'):m('lastAt',()=>({state:t(point.careKind==='water'?'public:npcCare.watered':'public:npcCare.cleaned'),time:lifeTime(point.lastCareAt)}))],...(point.nextEligibleAt===null?[]:[[m('next'),msg('public:life.time',()=>({time:lifeTime(point.nextEligibleAt)}))]])]);
    const personalKey=!agent?'personalSession':!privateState.data?privateState.phase==='forbidden'?'personalForbidden':['loading','refreshing'].includes(privateState.phase)?'personalLoading':'personalUnknown':privateState.stale?'personalStale':!own?'pointUnknown':null;put(view.personal,personalKey?m(personalKey):own.nextEligibleAt===null?own.available?m('personalAvailable'):msg(reason(own.reason)):m('personalNext',()=>({state:t(own.available?'public:npcCare.personalAvailable':reason(own.reason)),time:lifeTime(own.nextEligibleAt)})));
    view.intro.hidden=!intro;put(view.intro,intro?intro.consumedByActivityId?m('introductionUsed'):m('introductionValid',()=>({time:lifeTime(intro.expiresAt)})):'');put(view.guideTitle,guide?.title||m('guideUnknown'));view.guideBody.textContent=guide?.body||'';view.button.disabled=!ready()||!point.available||!own?.available||!guide;
   }
  }
  refresh.disabled=['loading','refreshing'].includes(publicState.phase);copyStatus.hidden=!message;put(copyStatus,message?m(message):'');copyDetail.hidden=!copied;copyText.textContent=copied;node.append(presentation.note);
 }
 const stopPublic=directory.subscribe(value=>{publicState=value;const key=value.data?JSON.stringify([value.data.definitionVersion,value.data.npcs.map(n=>[n.npcId,n.version]),value.data.carePoints.map(p=>[p.pointId,p.version])]):'';if(!value.data||value.stale||key!==sourceKey){sourceKey=key;invalidate();}render();});
 const stopPrivate=options.subscribe(value=>{privateState=value;if(!value.data||value.stale)invalidate();render();});
 const stopSession=session.subscribe(value=>{if(value.observationRevision!==context.observationRevision||value.selectedAgentId!==context.selectedAgentId||value.authenticated!==context.authenticated)invalidate();context=value;render();});
 return{node,open(){active=true;node.hidden=false;if(ownDirectory)directory.setActive(true);options.setActive(true);render();},observeWorld(value){const next=value.stale===true||value.phase==='paused';if(next!==worldStale){worldStale=next;invalidate();render();}},refresh(){void directory.refresh();void options.refresh();},close(){active=false;presentation.clear();invalidate();options.setActive(false);if(ownDirectory)directory.setActive(false);node.hidden=true;},dispose(){active=false;presentation.dispose();invalidate();stopPublic();stopPrivate();stopSession();options.dispose();if(ownDirectory)directory.dispose();cards.clear();node.replaceChildren();}};
}
