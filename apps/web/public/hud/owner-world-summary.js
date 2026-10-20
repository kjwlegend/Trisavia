import {el} from '../common.js';
const failure=code=>Object.assign(new Error(code),{code});
const cancelled=()=>new DOMException('Owner observation changed','AbortError');
const invitations=['pending','accepted','declined','withdrawn','expired','unavailable'];
const activities=['waiting_feedback','waiting_ack','closed','cancelled','expired','unavailable'];
const outcomes=['received_confirmed','submitted_unconfirmed','no_feedback'];
export function readOwnerWorldSummary(data,agentId){
  const source=data?.source;
  if(data?.agentId!==agentId||data.scope!=='own-agent-fact-summary'||!Number.isSafeInteger(data.asOf)||source?.kind!=='interaction_fact_summary'||source.version!==1||source.ownerObservation!=='current-binding-fact-summary'||source.privateText!==false||!Array.isArray(data.items)||typeof data.complete!=='boolean'||(data.complete?data.nextCursor!==null:typeof data.nextCursor!=='string'||!data.nextCursor))throw failure('summary_response_invalid');
  const ids=new Set(),items=[];
  for(const item of data.items){
    if(typeof item?.invitationId!=='string'||!item.invitationId||ids.has(item.invitationId)||!invitations.includes(item.invitationState)||!(item.activityId===null||typeof item.activityId==='string')||!(item.activityState===null||activities.includes(item.activityState))||!outcomes.includes(item.outcome)||!Number.isSafeInteger(item.createdAt))throw failure('summary_response_invalid');
    ids.add(item.invitationId);items.push({invitationId:item.invitationId,invitationState:item.invitationState,activityId:item.activityId,activityState:item.activityState,outcome:item.outcome,createdAt:item.createdAt});
  }
  return{agentId,asOf:data.asOf,items,complete:data.complete,nextCursor:data.nextCursor};
}

// The controller supplies this restricted read function; this reader has no
// credential, arbitrary URL or command interface and keeps no persistent data.
export function createOwnerWorldSummaryReader(session){
  let active=false,disposed=false,revision=0,abort=null,key='',agentId='';const listeners=new Set();
  let state={phase:'idle',items:[],complete:false,nextCursor:null,asOf:null,errorCode:null};
  const snapshot=()=>structuredClone(state);
  const emit=next=>{state={...state,...next};for(const listener of listeners)listener(snapshot());};
  function clear(phase='idle'){revision++;abort?.abort();abort=null;emit({phase,items:[],complete:false,nextCursor:null,asOf:null,errorCode:null});}
  async function load(more=false){
    if(disposed||!active||!key)return;
    const previous=state;revision++;abort?.abort();const generation=revision,target=agentId,controller=new AbortController();abort=controller;
    const current=()=>!disposed&&active&&generation===revision&&!controller.signal.aborted;
    const read=async(operation,input={})=>{const result=await session.read(operation,input,{signal:controller.signal});if(!current())throw cancelled();return result;};
    emit({phase:'loading',...(more?{}:{items:[],complete:false,nextCursor:null,asOf:null}),errorCode:null});
    try{
      const caps=await read('capabilities');
      if(caps?.gateway?.protocolVersion!==1||!caps.gateway.modules?.includes('interaction'))throw failure('summary_not_enabled');
      const unwrap=result=>{if(result?.protocolVersion!==1||result.instanceId!==caps.instanceId||!result.data)throw failure('summary_response_invalid');return result.data;};
      const discovery=unwrap(await read('discovery'));
      const operation=discovery.operations?.find(item=>item.id==='interaction.owner_summary');
      if(discovery.catalogRevision!==caps.gateway.catalogRevision||operation?.moduleId!=='interaction'||operation.kind!=='query'||!operation.actors?.includes('owner')||operation.http?.method!=='POST'||operation.http.path!=='/v1/gateway/query')throw failure('summary_not_enabled');
      for(const [field,id]of [['inputSchema','interaction.owner_summary.input'],['outputSchema','interaction.owner_summary.output']]){
        const ref=operation[field];if(ref?.id!==id||!Number.isSafeInteger(ref.version)||ref.version<1)throw failure('summary_not_enabled');
        const document=unwrap(await read('schema',{schemaId:ref.id,version:ref.version}));
        if(document.schemaId!==ref.id||document.version!==ref.version||!document.document)throw failure('summary_response_invalid');
      }
      const guideRef=operation.usageGuide;if(guideRef?.moduleId!=='interaction'||!Number.isSafeInteger(guideRef.version)||guideRef.version<1)throw failure('summary_not_enabled');
      const guide=unwrap(await read('guide',{moduleId:guideRef.moduleId,version:guideRef.version}));
      if(guide.moduleId!==guideRef.moduleId||guide.version!==guideRef.version||!guide.document)throw failure('summary_response_invalid');
      const batch=readOwnerWorldSummary(unwrap(await read('summary',more?{cursor:previous.nextCursor}:{})),target);
      const items=more?[...previous.items,...batch.items]:batch.items;
      if(new Set(items.map(item=>item.invitationId)).size!==items.length||more&&!batch.complete&&batch.nextCursor===previous.nextCursor)throw failure('summary_response_invalid');
      if(!current())throw cancelled();emit({...batch,items,phase:batch.complete?'ready':'partial',errorCode:null});
    }catch(error){if(!current()||error.name==='AbortError')return;emit({phase:error.code==='summary_not_enabled'?'unavailable':'error',items:[],complete:false,nextCursor:null,asOf:null,errorCode:error.code||'network_unknown'});}
  }
  const unsubscribe=session.subscribe(context=>{
    if(disposed)return;const target=context.authenticated===true&&['ready','refreshing'].includes(context.phase)&&context.agents?.some(item=>item.agentId===context.selectedAgentId)?context.selectedAgentId:'';
    const next=target?JSON.stringify([context.observationRevision,target]):'';if(next===key)return;
    key=next;agentId=target;clear(target?'idle':'unauthorized');if(active&&key)void load();
  });
  return{snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    setActive(value){value=Boolean(value);if(disposed||active===value)return;active=value;clear(key?'idle':'unauthorized');if(active&&key)void load();},
    refresh:()=>load(),loadMore:()=>state.phase==='partial'?load(true):Promise.resolve(),
    dispose(){if(disposed)return;disposed=true;unsubscribe?.();clear();listeners.clear();},
  };
}

export function mountOwnerWorldSummary(node,session){
  if(!node)return{dispose(){}};
  const reader=createOwnerWorldSummaryReader(session),body=el('div'),status=el('p','small-text'),refresh=el('button','text-button','读取互动摘要'),more=el('button','text-button','继续载入互动摘要');
  refresh.type=more.type='button';refresh.id='owner-world-summary-refresh';more.id='owner-world-summary-more';status.setAttribute('role','status');
  node.append(el('h3','','世界互动摘要'),el('p','small-text','仅显示当前绑定主人获准观察的互动事实；不含对方身份或私密正文。阅读不会确认反馈。'),status,body,refresh,more);
  refresh.addEventListener('click',()=>void reader.refresh());more.addEventListener('click',()=>void reader.loadMore());
  const invitationLabels={pending:'待回应',accepted:'已接受',declined:'已拒绝',withdrawn:'已撤回',expired:'已到期',unavailable:'当前不可用'},activityLabels={waiting_feedback:'等待反馈',waiting_ack:'等待 Agent 确认',closed:'已结束',cancelled:'已取消',expired:'已到期',unavailable:'当前不可用'},outcomeLabels={received_confirmed:'反馈已收到并确认',submitted_unconfirmed:'反馈已提交，尚未确认',no_feedback:'尚无反馈'};
  reader.subscribe(value=>{
    node.dataset.summaryPhase=value.phase;body.replaceChildren();refresh.disabled=value.phase==='loading';more.hidden=value.phase!=='partial';
    status.textContent=value.phase==='loading'?'正在读取当前 Agent 的互动事实…':value.phase==='unavailable'?'当前服务未开放主人互动摘要。':value.phase==='unauthorized'?'请登录并选择当前已关联的 Agent。':value.phase==='error'?'互动摘要暂不可用，旧摘要已清除。请重新读取。':value.phase==='ready'&&value.items.length===0?'当前没有获准观察的互动事实。':value.phase==='partial'?`已载入 ${value.items.length} 条，尚未完整。`:value.phase==='ready'?`已完整读取 ${value.items.length} 条 · ${new Date(value.asOf).toLocaleString('zh-CN',{hour12:false})}`:'打开角色概览后读取当前互动事实。';
    for(const item of value.items){const row=el('div','hud-record');row.dataset.interactionId=item.invitationId;row.append(el('time','',new Date(item.createdAt).toLocaleString('zh-CN',{hour12:false})),el('span','',`邀请：${invitationLabels[item.invitationState]} · 活动：${item.activityState===null?'尚无活动':activityLabels[item.activityState]} · ${outcomeLabels[item.outcome]}`));body.append(row);}
  });
  function sync(){reader.setActive(!document.hidden&&!node.closest('[hidden],[data-panel-state="closing"],[data-panel-state="closed"]')&&node.getClientRects().length>0);}
  // The Owner controller mounts before the shell moves its panel into the HUD.
  // Observe the stable shell root so a later window close also cancels reads.
  const observer=new MutationObserver(sync);observer.observe(document.querySelector('#hud-root')||node.parentNode,{subtree:true,attributes:true,attributeFilter:['hidden','class','style','data-panel-state']});
  const hide=()=>reader.setActive(false);document.addEventListener('visibilitychange',sync);window.addEventListener('pageshow',sync);window.addEventListener('pagehide',hide);sync();
  return{dispose(){observer.disconnect();document.removeEventListener('visibilitychange',sync);window.removeEventListener('pageshow',sync);window.removeEventListener('pagehide',hide);reader.dispose();}};
}
