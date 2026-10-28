import {el} from '../common.js';
import {msg} from '../i18n/core.js';
import {createLifePresentation,lifeNameSource,lifeTime,lifeDuration} from './life-presentation.js';
import {publicIdLabel} from '../public-id.js';
import {createLifeActionsReader,createLifeOptionsReader} from './life-readers.js';
import {buildWorkRestIntent,buildBenchRestIntent} from './life-intent.js';
import {createLifeCPlace} from './life-c-place.js';
import {createLifeBPlace} from './life-b-place.js';
import {icon} from './icons.js';
import {createNpcLifePlace,npcLifePlace} from './npc-life-place.js';
const supportedBuildings=['h-warehouse','h-tavern','g-pavilion','e-stall','g-lodge','n-blue'];
export const lifeBuilding=place=>npcLifePlace(place)||place?.kind==='life-place'||supportedBuildings.includes(place?.buildingId||place?.npc?.buildingId||place?.serviceNpc?.buildingId||place?.id);
const m=(key,params)=>msg('public:life.'+key,params);
const reasonNames={body_occupied:'body_occupied',energy_insufficient:'energy_insufficient',energy_full:'energy_full',work_quota_reached:'work_quota_reached',station_full:'station_full',participation_unavailable:'participation_unavailable',world_action_not_allowed:'world_action_not_allowed',autonomous_not_allowed:'world_action_not_allowed',observation_only:'observation_only'};
const control=(label,run)=>{const node=el('button','',label);node.type='button';node.addEventListener('click',run);return node;};
const selected=context=>context?.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(agent=>agent.agentId===context.selectedAgentId):null;
function facts(rows){const node=el('dl','life-facts');for(const [name,value]of rows)node.append(el('dt','',name),el('dd','',value));return node;}
export function createLifePlaceCard(session,{getWorldState,chooseAgent=()=>{},npcLifeDirectory}={}){
 const presentation=createLifePresentation(),node=el('section','life-place-card'),reader=createLifeActionsReader({getRules:()=>getWorldState()?.rules}),bPlace=createLifeBPlace(session,{chooseAgent}),cPlace=createLifeCPlace(session,{chooseAgent,getScrollHost:()=>node.closest('.world-detail-body')}),npcPlace=createNpcLifePlace(session,{directoryReader:npcLifeDirectory,getRules:()=>getWorldState()?.rules,chooseAgent});let active=false,target=null,state=reader.snapshot(),context=session.snapshot(),optionRows=[],offerKey='',message='',copied='',npcStale=false,worldStale=false;
 function clearOptions(){for(const row of optionRows){row.stop();row.reader.dispose();}optionRows=[];offerKey='';}
 function match(){return state.data?.places.find(place=>target?.placeId?place.placeId===target.placeId:place.anchorBuildingId===target?.buildingId);}
 function prepare(){
  const place=match(),offers=state.data?.actions.filter(action=>action.placeId===place?.placeId&&['work.shift','rest.bench'].includes(action.actionId))||[],key=JSON.stringify(offers);
  if(key===offerKey)return;clearOptions();offerKey=key;
  optionRows=offers.map(offer=>{const source=createLifeOptionsReader(session,offer);return{offer,reader:source,state:source.snapshot(),stop:()=>{}};});
  for(const row of optionRows){row.state=row.reader.snapshot();row.stop=row.reader.subscribe(value=>{row.state=value;render();});row.reader.setActive(active&&Boolean(selected(context)));}
 }
 function intent(offer){const catalog=state.data,place=match(),agent=selected(context),bench=catalog?.actions.find(action=>action.actionId==='rest.bench'),benchPlace=catalog?.places.find(row=>row.placeId===bench?.placeId);if(!bench||!benchPlace)throw Error('life_intent_unavailable');const rest={placeName:benchPlace.name,durationSeconds:bench.durationSeconds,price:bench.costs.star_coin},agentLabel=agent?`${agent.name} · ${publicIdLabel(agent.publicId)}`:'';return offer.actionId==='work.shift'?buildWorkRestIntent({origin:location.origin,agentLabel,job:{id:offer.jobId,name:offer.name,placeName:place.name,durationSeconds:offer.durationSeconds},rest}):buildBenchRestIntent({origin:location.origin,agentLabel,rest});}
 async function copy(offer){
  const originalTarget=target,originalIdentity=context.observationRevision;
  try{copied=intent(offer);message='';render();await navigator.clipboard.writeText(copied);if(!active||target!==originalTarget||context.observationRevision!==originalIdentity)return;message='copyDone';}
  catch{if(!active||target!==originalTarget||context.observationRevision!==originalIdentity)return;message=copied?'copyFailed':'guideUnavailable';}
  render();
 }
 function render(){
  const focus=document.activeElement?.dataset?.lifeBField,scrollHost=node.closest('.world-detail-body'),scrollTop=scrollHost?.scrollTop;presentation.clear();node.replaceChildren();node.hidden=!active;if(!active)return;if(target.npcLife){node.append(npcPlace.node);return;}node.dataset.lifePhase=state.phase;
  if(worldStale)node.append(el('p','life-status',m('worldStale')));
  if(npcStale)node.append(el('p','life-status',m('npcStale')));
  const statusKey=state.stale?'termsStale':state.phase==='loading'?'loading':state.phase==='refreshing'?'refreshing':['error','changed','forbidden'].includes(state.phase)?'unavailable':null,status=el('p','life-status',statusKey?m(statusKey):'');status.setAttribute('role','status');status.hidden=!statusKey;node.append(status);
  const place=match();if(state.data&&place){const heading=el('div','life-place-heading'),aPlace=['harbor_work','harbor_tavern','garden_bench'].includes(place.placeId),image=aPlace?el('img'):icon('location');if(aPlace){image.src=`/assets/world-life/assets/place-${place.placeId}.svg`;image.alt='';image.width=32;image.height=32;}heading.append(image,presentation.label(el('h3'),'public:life.placeTitle',{name:place.name},{name:lifeNameSource(state.data,place,'place')}));node.append(heading,el('p','hud-muted',m('beforeCopy')));
   if(['fisher_shop','harbor_shore','harbor_pier'].includes(place.placeId)){bPlace.update({catalog:state.data,place,worldStale:worldStale||npcStale||state.stale});node.append(bPlace.node);}else bPlace.close();if(state.data.catalogRevision===3&&state.data.actions.some(a=>a.placeId===place.placeId&&['meal.prepare','meal.eat','rest.inn','book.read','visit.place'].includes(a.actionId))){cPlace.update({catalog:state.data,place,worldStale:worldStale||npcStale||state.stale});node.append(cPlace.node);}else cPlace.close();
   for(const row of optionRows){const offer=row.offer,option=row.state.data,agent=selected(context),section=el('article','life-card');section.append(presentation.label(el('h4'),'public:life.name',{name:offer.name},{name:lifeNameSource(state.data,offer)}));const total=place.stations.filter(station=>station.actionIds.includes(offer.actionId)).reduce((sum,station)=>sum+station.capacity,0);
    const lines=[[m('duration'),m('time',()=>({time:lifeDuration(offer.durationSeconds)}))],[m('cost'),m('free')],[m('capacity'),m('capacity.total',{count:total})],[m('presence'),m('presenceRequired')]];
    if(offer.actionId==='work.shift')lines.push([m('wage'),m('money',{count:offer.reward.star_coin})],[m('energyRule'),m('reserveEnergy',{count:offer.costs.energy})]);else lines.push([m('recovery'),m('recoverUpTo',{count:offer.reward.energy})],[m('energyCondition'),m('notFullAndFree')]);section.append(facts(lines));
    const current=el('section','life-current-options');current.append(el('h5','',m('currentConditions')));
    if(!agent)current.append(el('p','hud-muted',m(context.authenticated?'chooseForConditions':'loginForConditions')),control(msg(context.authenticated?'public:content.chooseAgent':'shell:nav.account'),chooseAgent));
    else if(option){current.append(el('p','',m(row.state.stale?'capacity.stale':'capacity.current',{available:option.capacity.available,total:option.capacity.total})),el('p','hud-muted',m('conditionsAsOf',()=>({time:lifeTime(option.asOf)}))));if(option.workQuota)current.append(el('p','hud-muted',m('workQuota',()=>({starts:option.workQuota.starts,max:option.workQuota.max,time:lifeTime(option.workQuota.nextResetAt)}))));if(option.reasons.length)for(const reason of option.reasons)current.append(el('p','life-condition',m('reason.'+(reasonNames[reason]||'other'))));else current.append(el('p','',m('canTry')));}
    else current.append(el('p','hud-muted',m(['loading','refreshing'].includes(row.state.phase)?'checkingConditions':row.state.phase==='forbidden'?'conditionsForbidden':'conditionsUnknown')));
    if(row.state.stale)current.append(el('p','life-status',m('conditionsStale')));section.append(current);
    const cancellation=el('details','life-cancellation');cancellation.append(el('summary','',m('cancellation')),el('p','hud-muted',m(offer.actionId==='work.shift'?'workCancellation':'restCancellation')));section.append(cancellation);
    const button=control(m('copy'),()=>void copy(offer));presentation.attribute(button,'aria-label',offer.actionId==='work.shift'?'public:life.copyWorkRest':'public:life.copyRest',{name:offer.name},offer.actionId==='work.shift'?{name:lifeNameSource(state.data,offer)}:{});button.disabled=state.phase!=='ready'||state.stale||npcStale||worldStale||getWorldState()?.worldScene?.stale||Boolean(agent&&(row.state.phase!=='ready'||row.state.stale||!option?.available));section.append(button,el('p','hud-muted',m(offer.actionId==='work.shift'?'workScope':'restScope')));node.append(section);
   }
  }else{bPlace.close();cPlace.close();if(state.phase==='ready')node.append(el('p','hud-muted',m('noActivities')));}
  const refresh=control(m('refresh'),()=>{void reader.refresh();for(const row of optionRows)void row.reader.refresh();bPlace.refresh();cPlace.refresh();});refresh.disabled=['loading','refreshing'].includes(state.phase);node.append(refresh);
  if(message){const line=el('p','life-copy-status',m(message));line.setAttribute('role','status');node.append(line);}if(copied){const guide=el('details','life-copy-guide');guide.open=true;guide.append(el('summary','',m('guide')),el('pre','',copied));node.append(guide);}node.append(presentation.note);if(focus)node.querySelector(`[data-life-b-field="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});if(scrollHost)scrollHost.scrollTop=scrollTop;
 }
 const stop=reader.subscribe(value=>{state=value;if(value.data)prepare();else clearOptions();render();});
 const stopSession=session.subscribe(value=>{const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){message=copied='';for(const row of optionRows)row.state={...row.state,data:null,phase:'loading',stale:false};render();}});
 return{node,open(value){target={npcLife:npcLifePlace(value),placeId:value.placeId||null,buildingId:value.buildingId||value.npc?.buildingId||value.serviceNpc?.buildingId||value.id,npc:value.npc||value.serviceNpc||null};active=true;npcStale=false;worldStale=getWorldState()?.worldScene?.stale===true;message=copied='';if(target.npcLife){bPlace.close();cPlace.close();clearOptions();reader.setActive(false);npcPlace.open();}else{npcPlace.close();reader.setActive(true);}render();},observeWorld(value){if(!active)return;npcPlace.observeWorld(value);const next=value.stale===true||value.phase==='paused';if(next!==worldStale){worldStale=next;render();}},observeNpc(npc,{stale=false}={}){if(!active||target.npc?.npcId!==npc.npcId)return;const changed=JSON.stringify([target.npc.activity,npcStale])!==JSON.stringify([npc.activity,stale]);target.npc=npc;npcStale=stale;if(changed)render();},close(){active=false;reader.setActive(false);npcPlace.close();bPlace.close();cPlace.close();clearOptions();target=null;copied=message='';render();},dispose(){active=false;presentation.dispose();stop();stopSession();npcPlace.dispose();bPlace.dispose();cPlace.dispose();clearOptions();reader.dispose();}};
}
