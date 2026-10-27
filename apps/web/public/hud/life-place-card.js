import {el} from '../common.js';
import {publicIdLabel} from '../public-id.js';
import {createLifeActionsReader,createLifeOptionsReader} from './life-readers.js';
import {buildWorkRestIntent,buildBenchRestIntent} from './life-intent.js';
import {createLifeCPlace} from './life-c-place.js';
import {createLifeBPlace} from './life-b-place.js';
import {icon} from './icons.js';
import {createNpcLifePlace,npcLifePlace} from './npc-life-place.js';
const supportedBuildings=['h-warehouse','h-tavern','g-pavilion','e-stall','g-lodge','n-blue'];
export const lifeBuilding=place=>npcLifePlace(place)||place?.kind==='life-place'||supportedBuildings.includes(place?.buildingId||place?.npc?.buildingId||place?.serviceNpc?.buildingId||place?.id);
const reasonNames={body_occupied:'正在进行其他身体活动',energy_insufficient:'可用体力不足',energy_full:'体力已满',work_quota_reached:'今日班次额度已用完',station_full:'当前名额已满',participation_unavailable:'当前参与状态不允许开始',world_action_not_allowed:'当前行动权限受限',autonomous_not_allowed:'当前行动权限受限',observation_only:'当前仅可观察'};
const time=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const duration=seconds=>seconds%60===0?`${seconds/60} 分钟`:`${seconds} 秒`;
const control=(label,run)=>{const node=el('button','',label);node.type='button';node.addEventListener('click',run);return node;};
const selected=context=>context?.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(agent=>agent.agentId===context.selectedAgentId):null;
function facts(rows){const node=el('dl','life-facts');for(const [name,value]of rows)node.append(el('dt','',name),el('dd','',value));return node;}
export function createLifePlaceCard(session,{getWorldState,chooseAgent=()=>{},npcLifeDirectory}={}){
 const node=el('section','life-place-card'),reader=createLifeActionsReader({getRules:()=>getWorldState()?.rules}),bPlace=createLifeBPlace(session,{chooseAgent}),cPlace=createLifeCPlace(session,{chooseAgent,getScrollHost:()=>node.closest('.world-detail-body')}),npcPlace=createNpcLifePlace(session,{directoryReader:npcLifeDirectory,getRules:()=>getWorldState()?.rules,chooseAgent});let active=false,target=null,state=reader.snapshot(),context=session.snapshot(),optionRows=[],offerKey='',message='',copied='',npcStale=false,worldStale=false;
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
  try{copied=intent(offer);message='';render();await navigator.clipboard.writeText(copied);if(!active||target!==originalTarget||context.observationRevision!==originalIdentity)return;message='已复制。交给 Agent 后，由它先核对实时条件，再决定并提交有限任务。';}
  catch{if(!active||target!==originalTarget||context.observationRevision!==originalIdentity)return;message=copied?'剪贴板暂不可用，完整指引已展开，可手动复制。':'当前指引尚未取得，请重新读取。';}
  render();
 }
 function render(){
  const focus=document.activeElement?.dataset?.lifeBField,scrollHost=node.closest('.world-detail-body'),scrollTop=scrollHost?.scrollTop;node.replaceChildren();node.hidden=!active;if(!active)return;if(target.npcLife){node.append(npcPlace.node);return;}node.dataset.lifePhase=state.phase;
  if(worldStale)node.append(el('p','life-status','上次世界画面已过期，位置与动作冻结；恢复后再核对当前条件。'));
  if(npcStale)node.append(el('p','life-status','上次确认的镇民状态已过期，请重新读取。'));
  const status=el('p','life-status');status.setAttribute('role','status');status.textContent=state.stale?'上次读取的活动条款已过期，请重新确认。':state.phase==='loading'?'正在读取场所活动…':state.phase==='refreshing'?'正在更新活动条款…':['error','changed','forbidden'].includes(state.phase)?'场所活动暂时无法读取，请重试。':'';status.hidden=!status.textContent;node.append(status);
  const place=match();if(state.data&&place){const heading=el('div','life-place-heading'),aPlace=['harbor_work','harbor_tavern','garden_bench'].includes(place.placeId),image=aPlace?el('img'):icon('location');if(aPlace){image.src=`/assets/world-life/assets/place-${place.placeId}.svg`;image.alt='';image.width=32;image.height=32;}heading.append(image,el('h3','',`${place.name} · 场所活动`));node.append(heading,el('p','hud-muted','先查看条件，复制给 Agent 不会在浏览器中开始活动或交易。'));
   if(['fisher_shop','harbor_shore','harbor_pier'].includes(place.placeId)){bPlace.update({catalog:state.data,place,worldStale:worldStale||npcStale||state.stale});node.append(bPlace.node);}else bPlace.close();if(state.data.catalogRevision===3&&state.data.actions.some(a=>a.placeId===place.placeId&&['meal.prepare','meal.eat','rest.inn','book.read','visit.place'].includes(a.actionId))){cPlace.update({catalog:state.data,place,worldStale:worldStale||npcStale||state.stale});node.append(cPlace.node);}else cPlace.close();
   for(const row of optionRows){const offer=row.offer,option=row.state.data,agent=selected(context),section=el('article','life-card');section.append(el('h4','',offer.name));const total=place.stations.filter(station=>station.actionIds.includes(offer.actionId)).reduce((sum,station)=>sum+station.capacity,0);
    const lines=[['时长',duration(offer.durationSeconds)],['星币花费','免费，无星币支出'],['总名额',`${total} 位`],['在场条件','必须到达合法活动区域，并持续在场']];
    if(offer.actionId==='work.shift')lines.push(['完成工资',`${offer.reward.star_coin} 星币`],['体力规则',`开始时预留 ${offer.costs.energy}，完成时结算`]);else lines.push(['恢复规则',`完成后最多恢复 ${offer.reward.energy} 体力，实际不超过上限`],['体力条件','体力未满，且当前没有其他身体活动']);section.append(facts(lines));
    const current=el('section','life-current-options');current.append(el('h5','','当前条件'));
    if(!agent)current.append(el('p','hud-muted',context.authenticated?'选择自己的 Agent 后，可查看它的实际条件和当前余位。':'登录后可观察自己 Agent 的实际条件。Agent 执行前仍须自己核对。'),control(context.authenticated?'选择 Agent':'登录／注册',chooseAgent));
    else if(option){current.append(el('p','',`当前余位 ${option.capacity.available} / ${option.capacity.total}${row.state.stale?'（已过期）':''}`),el('p','hud-muted',`条件确认于 ${time(option.asOf)}`));if(option.workQuota)current.append(el('p','hud-muted',`今日已开始 ${option.workQuota.starts} / ${option.workQuota.max} 班，下次额度重置 ${time(option.workQuota.nextResetAt)}。`));if(option.reasons.length)for(const reason of option.reasons)current.append(el('p','life-condition',reasonNames[reason]||'当前条件不满足，请让 Agent 读取具体原因。'));else current.append(el('p','','当前可尝试，开始时仍会重新检查条件和名额。'));}
    else current.append(el('p','hud-muted',['loading','refreshing'].includes(row.state.phase)?'正在核对当前条件…':row.state.phase==='forbidden'?'当前无权查看这位 Agent 的条件。':'当前余位与个人条件尚未取得，不按零处理。'));
    if(row.state.stale)current.append(el('p','life-status','上次个人条件已过期，不能据此开始行动。'));section.append(current);
    const cancellation=el('details','life-cancellation');cancellation.append(el('summary','','取消与中断规则'),el('p','hud-muted',offer.actionId==='work.shift'?'主动取消无工资；按已用工时比例向上取整结算体力，本班仍占当日额度。系统中断按服务器实际结果处理未结算资源和额度。':'未完成不产生部分恢复；名额释放与其他效果以服务器实际结果为准。'));section.append(cancellation);
    const button=control('复制给 Agent',()=>void copy(offer));button.setAttribute('aria-label',`复制${offer.actionId==='work.shift'?offer.name+'与免费休息':'免费休息'}指引`);button.disabled=state.phase!=='ready'||state.stale||npcStale||worldStale||getWorldState()?.worldScene?.stale||Boolean(agent&&(row.state.phase!=='ready'||row.state.stale||!option?.available));section.append(button,el('p','hud-muted',offer.actionId==='work.shift'?'仅一班工作，随后一次免费休息；零星币支出，总期限最多两小时。':'仅核对当前状态、前往凉亭、免费休息一次、查询实际结果；零星币支出。'));node.append(section);
   }
  }else{bPlace.close();cPlace.close();if(state.phase==='ready')node.append(el('p','hud-muted','当前目录没有为这里提供本批可用的生活活动。'));}
  const refresh=control('刷新活动与条件',()=>{void reader.refresh();for(const row of optionRows)void row.reader.refresh();bPlace.refresh();cPlace.refresh();});refresh.disabled=['loading','refreshing'].includes(state.phase);node.append(refresh);
  if(message){const line=el('p','life-copy-status',message);line.setAttribute('role','status');node.append(line);}if(copied){const guide=el('details','life-copy-guide');guide.open=true;guide.append(el('summary','','给 Agent 的完整指引'),el('pre','',copied));node.append(guide);}if(focus)node.querySelector(`[data-life-b-field="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});if(scrollHost)scrollHost.scrollTop=scrollTop;
 }
 const stop=reader.subscribe(value=>{state=value;if(value.data)prepare();else clearOptions();render();});
 const stopSession=session.subscribe(value=>{const changed=context.observationRevision!==value.observationRevision;context=value;if(changed){message=copied='';for(const row of optionRows)row.state={...row.state,data:null,phase:'loading',stale:false};render();}});
 return{node,open(value){target={npcLife:npcLifePlace(value),placeId:value.placeId||null,buildingId:value.buildingId||value.npc?.buildingId||value.serviceNpc?.buildingId||value.id,npc:value.npc||value.serviceNpc||null};active=true;npcStale=false;worldStale=getWorldState()?.worldScene?.stale===true;message=copied='';if(target.npcLife){bPlace.close();cPlace.close();clearOptions();reader.setActive(false);npcPlace.open();}else{npcPlace.close();reader.setActive(true);}render();},observeWorld(value){if(!active)return;npcPlace.observeWorld(value);const next=value.stale===true||value.phase==='paused';if(next!==worldStale){worldStale=next;render();}},observeNpc(npc,{stale=false}={}){if(!active||target.npc?.npcId!==npc.npcId)return;const changed=JSON.stringify([target.npc.activity,npcStale])!==JSON.stringify([npc.activity,stale]);target.npc=npc;npcStale=stale;if(changed)render();},close(){active=false;reader.setActive(false);npcPlace.close();bPlace.close();cPlace.close();clearOptions();target=null;copied=message='';render();},dispose(){active=false;stop();stopSession();npcPlace.dispose();bPlace.dispose();cPlace.dispose();clearOptions();reader.dispose();}};
}
