import {el} from '../common.js';
import {createLifeStateReader} from './life-readers.js';
import {createBehaviorLogReader} from './behavior-log-reader.js';
import {createBehaviorLogView} from './behavior-log-view.js';
const time=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const control=(label,run)=>{const node=el('button','',label);node.type='button';node.addEventListener('click',run);return node;};
const activityName=value=>value.actionId==='work.shift'?value.jobId==='harbor_shift'?'码头短工':'酒馆帮工':value.actionId==='rest.voucher'?'休息券休憩':'免费休息';
const planNames={queued:'等待推进',running:'正在执行',waiting_condition:'等待名额',completed:'已完成',partially_completed:'部分完成',failed:'已停止',cancelled:'已取消',expired:'已到期限'};
const resultNames={completed:'已完成',cancelled:'已中止',interrupted:'系统中断'};
function facts(rows){const node=el('dl','life-facts');for(const [label,value]of rows)node.append(el('dt','',label),el('dd','',value));return node;}
function resultCard(activity){
 const r=activity.result,node=el('article','life-result');node.dataset.resultId=r.resultId;node.append(el('h4','',`${activityName(activity)} · ${resultNames[r.state]}`),el('p','hud-muted',`${activity.placeName} · 实际确认于 ${time(r.completedAt)}`));
 node.append(facts([['实际工资',`${r.coinReward} 星币`],['实际体力消耗',String(r.energySpent)],['实际体力恢复',String(r.energyRestored)],['体力变化',`${r.energyBefore} → ${r.energyAfter}`]]));
 if(r.completedAt>activity.scheduledEndAt)node.append(el('p','hud-muted',`原定 ${time(activity.scheduledEndAt)} 结束，结果以服务器实际确认时间为准。`));
 if(r.quotaRefunded)node.append(el('p','hud-muted','本班次额度已按实际中断结果退回。'));
 if(r.state!=='completed')node.append(el('p','hud-muted','未完成部分以本次结算为准；已提交的其他结果保持有效。'));
 return node;
}
export function createLifeProfile(session,{walletProvider,chooseAgent=()=>{}}={}){
 const node=el('section','life-profile'),current=el('section','life-card'),history=el('details','life-history'),reader=createLifeStateReader(session),logsReader=createBehaviorLogReader({mode:'owner',session}),logs=createBehaviorLogView(logsReader,{mode:'owner',chooseAgent});
 history.append(el('summary','','个人生活与行动历史'),logs.node);node.append(current,history);let active=false,state=reader.snapshot(),wallet=walletProvider?.snapshot(),lastResults='';
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
   if(plan){current.append(el('h4','',`有限计划 · ${planNames[plan.state]}`),el('p','',`已确认 ${plan.results.length} / ${plan.stepCount} 个步骤。`),el('p','hud-muted',`最晚期限：${time(plan.deadlineAt)}`));if(plan.state!=='completed')current.append(el('p','hud-muted','计划受理或正在执行，不代表全部步骤已经完成。'));}
   if(data.queuedPlan)current.append(el('p','hud-muted',`另有一份计划等待推进，期限 ${time(data.queuedPlan.deadlineAt)}。`));
   const money=el('section','life-wallet');money.append(el('h4','','星币钱包'));
   if(wallet?.phase==='ready')money.append(el('p','life-wallet-balance',`${wallet.data.balance} ${wallet.data.currency.displayName}`),el('p','hud-muted',`钱包单独确认于 ${time(wallet.data.asOf)}`));else money.append(el('p','hud-muted',wallet?.phase==='loading'?'正在读取真实钱包…':'当前钱包尚未取得，不推算余额。'));current.append(money);
   if(data.recentResults.length){current.append(el('h4','','最近获准结果'));for(const activity of data.recentResults)current.append(resultCard(activity));}else current.append(el('p','hud-muted','尚无当前获准查看的生活结果。'));
  }
  const button=control(['error','changed','forbidden','recovering'].includes(state.phase)?'重新读取生活状态':'刷新生活状态',refresh);button.disabled=['loading','refreshing'].includes(state.phase);current.append(button);
 }
 history.addEventListener('toggle',()=>logsReader.setActive(active&&history.open));
 const stop=reader.subscribe(value=>{state=value;const results=value.data?.recentResults.map(activity=>activity.resultId).join('|')||'';if(active&&lastResults&&results!==lastResults&&value.data?.recentResults.some(activity=>activity.result.coinReward>0))void walletProvider?.load();lastResults=results;render();});
 const stopWallet=walletProvider?.subscribe(value=>{wallet=value;render();});
 return{node,setActive(value){value=Boolean(value);if(value===active)return;active=value;reader.setActive(value);logsReader.setActive(value&&history.open);if(value)void walletProvider?.load();else{walletProvider?.cancel();history.open=false;lastResults='';}},dispose(){active=false;stop();stopWallet?.();reader.dispose();logsReader.dispose();logs.dispose();}};
}
