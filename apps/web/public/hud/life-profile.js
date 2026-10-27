import {createLifeGifts} from './life-gifts.js';
import {el} from '../common.js';
import {createLifeStateReader} from './life-readers.js';
import {createBehaviorLogReader} from './behavior-log-reader.js';
import {createBehaviorLogView} from './behavior-log-view.js';
import {lifeItemImage,lifeItemArt} from './life-item-art.js';
import {createFishingResultStage} from '../world-pixel/fishing-art.js';
const time=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const control=(label,run)=>{const node=el('button','',label);node.type='button';node.addEventListener('click',run);return node;};
const activityName=value=>value.actionId==='work.shift'?value.jobId==='harbor_shift'?'码头短工':'酒馆帮工':({'rest.voucher':'休息券休憩','rest.bench':'免费休息','fish.session':'钓鱼','shop.buy':'购买生活用品','shop.sell':'出售鱼获','meal.prepare':'加工鱼餐','meal.eat':'用餐','rest.inn':'旅舍休息','book.read':'阅读','visit.place':'到访','care.perform':'园务照料','care.introduce':'了解本次园务'}[value.actionId]||'生活活动');
const planNames={queued:'等待推进',running:'正在执行',waiting_condition:'等待名额',completed:'已完成',partially_completed:'部分完成',failed:'已停止',cancelled:'已取消',expired:'已到期限'};
const resultNames={completed:'已完成',cancelled:'已中止',interrupted:'系统中断'};
function facts(rows){const node=el('dl','life-facts');for(const [label,value]of rows)node.append(el('dt','',label),el('dd','',value));return node;}
function resultCard(activity,{appearance,play=false}={}){
 const r=activity.result,node=el('article','life-result');node.dataset.resultId=r.resultId;node.append(el('h4','',`${activityName(activity)} · ${resultNames[r.state]}`),el('p','hud-muted',`${activity.placeName} · 实际确认于 ${time(r.completedAt)}`));
 node.append(facts([...(activity.actionId==='work.shift'?[['实际工资',`${r.coinReward} 星币`]]:[]),['实际体力消耗',String(r.energySpent)],['实际体力恢复',String(r.energyRestored)],['体力变化',`${r.energyBefore} → ${r.energyAfter}`]]));
 if(r.careIntroduction)node.append(el('p','',r.careIntroduction.message.text),el('p','hud-muted','这份真实介绍只供原计划继续照料，不代表照料已经完成。'));
 if(r.care){const care=r.care;node.append(el('p','',care.message.text),el('p','hud-muted',care.completed?'本次完成事实已确认；点位冷却与本人下一次资格分别读取。':'本次未完成，不增加新的照料完成记录。'));if(care.lastCareAt!==null)node.append(el('p','hud-muted',`照料点上次完成：${time(care.lastCareAt)}`));if(care.nextEligibleAt!==null)node.append(el('p','hud-muted',`点位冷却截止：${time(care.nextEligibleAt)}`));}
 if(r.trade)node.append(facts([['实际星币变化',`${r.trade.moneyDelta>0?'+':''}${r.trade.moneyDelta}`],['实际物品实例',String(r.trade.itemIds.length)]]),el('p','hud-muted','这是本次已提交交易的变化；当前余额以钱包单独读取为准。'));
 let stage=null;if(r.fishing){const f=r.fishing;node.append(facts([['已完成竿数',`${f.completedCasts} / ${f.requestedCasts}`],['空竿',String(f.noCatchCount)],['中断竿数',String(f.interruptedCasts)],['未开始竿数',String(f.unstartedCasts)],['实际消耗',`${f.actualCosts.bait} 份鱼饵 · ${f.actualCosts.energy} 体力`],['实际退回',`${f.refundedCosts.bait} 份鱼饵 · ${f.refundedCosts.energy} 体力`]]));if(!f.catches.length)node.append(el('p','',r.state==='completed'?'这次没有钓到鱼。':'已确认部分没有鱼获，未完成部分不推算结果。'));for(const fish of f.catches){const row=el('div','life-fish-result');row.append(lifeItemImage(fish.itemId),el('span','',`${lifeItemArt(fish.itemId).name} · ${fish.weightGrams} 克`),el('time','hud-muted',time(fish.caughtAt)));node.append(row);}stage=createFishingResultStage({appearance,activity,play});node.append(stage.node);}
 if(r.c){const c=r.c;node.append(facts([['本次实际星币变化',`${c.moneyDelta>0?'+':''}${c.moneyDelta}`],['实际消耗物品',String(c.consumedItemIds.length)],['实际得到物品',String(c.createdItemIds.length)],['已释放预留',String(c.releasedItemIds.length)]]));if(c.book)node.append(el('p','',`阅读：${c.book.title} · 第 ${c.book.version} 版 · ${c.book.authorDisplay}`),el('p','hud-muted','这份结果记录实际阅读参与，不推断已理解、记住或学习。'));if(c.visit)node.append(el('p','',c.visit.recorded?c.visit.first?'首次到访记录已确认。':'本次到访记录已确认。':'实际停留已确认；冷却期内不重复增加公开到访记录。'));}
 if(r.completedAt>activity.scheduledEndAt)node.append(el('p','hud-muted',`原定 ${time(activity.scheduledEndAt)} 结束，结果以服务器实际确认时间为准。`));
 if(r.quotaRefunded&&activity.actionId==='work.shift')node.append(el('p','hud-muted','本班次额度已按实际中断结果退回。'));
 if(r.state!=='completed')node.append(el('p','hud-muted','未完成部分以本次结算为准；已提交的其他结果保持有效。'));
 return{node,dispose:()=>stage?.dispose()};
}
export function createLifeProfile(session,{walletProvider,chooseAgent=()=>{}}={}){
 const node=el('section','life-profile'),current=el('section','life-card'),history=el('details','life-history'),reader=createLifeStateReader(session),logsReader=createBehaviorLogReader({mode:'owner',session}),logs=createBehaviorLogView(logsReader,{mode:'owner',chooseAgent}),gifts=createLifeGifts(session);
 history.append(el('summary','','个人生活与行动历史'),logs.node);node.append(current,gifts.node,history);let active=false,state=reader.snapshot(),wallet=walletProvider?.snapshot(),lastResults=null;const resultViews=new Map(),animateResults=new Set(),playedResults=new Set();
 function clearResults(){for(const view of resultViews.values())view.dispose();resultViews.clear();animateResults.clear();}
 const refresh=()=>{void reader.refresh();void walletProvider?.load();};
 function render(){
  current.replaceChildren(el('h3','','当前生活'));current.dataset.lifePhase=state.phase;
  const status=el('p','life-status');status.setAttribute('role','status');
  status.textContent=state.stale?`上次确认的生活状态已过期，进展冻结。最后读取：${time(state.lastSuccessAt)}。`:state.phase==='loading'?'正在读取当前活动与体力…':state.phase==='refreshing'?'正在更新当前状态…':state.phase==='session'?'登录后可查看自己 Agent 的活动、计划与体力。':state.phase==='no_agent'?'选择自己的一位 Agent 后查看。':state.phase==='forbidden'?'当前无权查看这些生活事实。':state.phase==='changed'?'实例或读取范围已变化，请重新读取。':state.phase==='error'?'生活状态暂时无法读取，请重试。':'';status.hidden=!status.textContent;current.append(status);
  const data=state.data;
  if(data){
   current.append(facts([['体力',`${data.energy.current} / ${data.energy.max}`],['已预留体力',String(data.energy.reserved)],['可用体力',String(data.energy.available)]]),el('p','hud-muted',`生活状态确认于 ${time(data.asOf)}`));
   const activity=data.body.activity,plan=data.body.plan;
   if(activity){const pending=activity.state==='active'&&data.asOf>=activity.scheduledEndAt;current.append(el('h4','',`${activityName(activity)} · ${activity.state==='active'?pending?'结果待确认':'进行中':resultNames[activity.state]}`),el('p','',activity.placeName),el('p','hud-muted',`开始：${time(activity.startedAt)} · 预计结束：${time(activity.scheduledEndAt)}`));if(pending)current.append(el('p','hud-muted','预计时间已到，尚未读到实际完成结果。'));}
   else current.append(el('p','','当前没有可查看的进行中活动。'));
   if(activity?.fishing){const f=activity.fishing;current.append(facts([['已开始',`${f.startedCasts} / ${f.requestedCasts} 竿`],['已确认完成',String(f.completedCasts)],['已确认空竿',String(f.noCatchCount)],['实际消耗',`${f.actualCosts.bait} 份鱼饵 · ${f.actualCosts.energy} 体力`]]));if(f.currentCast)current.append(el('p','hud-muted',`${data.asOf>=f.currentCast.scheduledEndAt?'本竿结果待确认':'正在等待本竿'} · 原定 ${time(f.currentCast.scheduledEndAt)}；不会按预计时间推算鱼获。`));}
   if(plan){current.append(el('h4','',`有限计划 · ${planNames[plan.state]}`),el('p','',`已确认 ${plan.results.length} / ${plan.stepCount} 个步骤。`),el('p','hud-muted',`最晚期限：${time(plan.deadlineAt)}`));if(plan.state!=='completed')current.append(el('p','hud-muted','计划受理或正在执行，不代表全部步骤已经完成。'));}
   for(const wait of data.remotePlans||[])current.append(el('p','hud-muted',`远程等待礼物结果，不占身体 · ${planNames[wait.state]} · 期限 ${time(wait.deadlineAt)}。`));
   if(data.queuedPlan)current.append(el('p','hud-muted',`另有一份计划等待推进，期限 ${time(data.queuedPlan.deadlineAt)}。`));
   const money=el('section','life-wallet');money.append(el('h4','','星币钱包'));
   if(wallet?.phase==='ready')money.append(el('p','life-wallet-balance',`${wallet.data.balance} ${wallet.data.currency.displayName}`),el('p','hud-muted',`钱包单独确认于 ${time(wallet.data.asOf)}`));else money.append(el('p','hud-muted',wallet?.phase==='loading'?'正在读取真实钱包…':'当前钱包尚未取得，不推算余额。'));current.append(money);
   const context=session.snapshot(),agent=context.agents.find(a=>a.agentId===context.selectedAgentId),appearance=agent?.avatar??agent?.appearance,keys=new Set();if(data.recentResults.length){current.append(el('h4','','最近获准结果'));for(const activity of data.recentResults){const key=JSON.stringify([data.agentId,activity.resultId,activity.version,appearance]);keys.add(key);let view=resultViews.get(key);if(!view){const play=!state.stale&&animateResults.has(activity.resultId)&&!playedResults.has(activity.resultId);view=resultCard(activity,{appearance,play});resultViews.set(key,view);if(play)playedResults.add(activity.resultId);}current.append(view.node);}}else current.append(el('p','hud-muted','尚无当前获准查看的生活结果。'));for(const [key,view]of resultViews)if(!keys.has(key)){view.dispose();resultViews.delete(key);}
  }
  const button=control(['error','changed','forbidden','recovering'].includes(state.phase)?'重新读取生活状态':'刷新生活状态',refresh);button.disabled=['loading','refreshing'].includes(state.phase);current.append(button);
 }
 history.addEventListener('toggle',()=>logsReader.setActive(active&&history.open));
 const stop=reader.subscribe(value=>{const prior=state.data?.body.activity?.activityId;state=value;if(!value.data)clearResults();if(prior&&!value.stale&&value.data?.recentResults.some(a=>a.activityId===prior))animateResults.add(prior);const results=value.data?.recentResults.map(activity=>activity.resultId).join('|')||'';if(active&&lastResults!==null&&results!==lastResults&&value.data?.recentResults.some(activity=>activity.result.coinReward>0||activity.result.trade?.moneyDelta||activity.result.c?.moneyDelta))void walletProvider?.load();lastResults=value.data?results:null;render();});
 const stopWallet=walletProvider?.subscribe(value=>{wallet=value;render();});
 return{node,setActive(value){value=Boolean(value);if(value===active)return;active=value;reader.setActive(value);gifts.setActive(value);logsReader.setActive(value&&history.open);if(value)void walletProvider?.load();else{walletProvider?.cancel();history.open=false;lastResults=null;clearResults();}},dispose(){active=false;clearResults();stop();stopWallet?.();reader.dispose();gifts.dispose();logsReader.dispose();logs.dispose();}};
}
