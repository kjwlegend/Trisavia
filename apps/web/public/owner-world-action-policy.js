const modes=['autonomous','observe'];
export function readWorldActionPolicy(value,agentId){
 if(value?.source!=='current'||value.agentId!==agentId||!Number.isSafeInteger(value.version)||value.version<0||!modes.includes(value.mode)||!(value.updatedAt===null||Number.isSafeInteger(value.updatedAt)&&value.updatedAt>=0)||!Number.isSafeInteger(value.asOf)||value.asOf<0)throw Object.assign(new Error('world_action_policy_unavailable'),{code:'world_action_policy_unavailable'});
 return{agentId,version:value.version,mode:value.mode,updatedAt:value.updatedAt,asOf:value.asOf,source:'current'};
}
export function mountWorldActionPolicy(form,{session,onSave,changed=()=>{},dirty=()=>false,remember=()=>{}}){
 const options=form.querySelector('#world-autonomy-options'),status=form.querySelector('#world-autonomy-current'),save=form.querySelector('#save-world-autonomy'),inputs=[...form.querySelectorAll('input[name=world-autonomy-mode]')],retry=document.createElement('button');retry.type='button';retry.textContent='重新读取参与方式';retry.className='text-button';retry.hidden=true;status.after(retry);
 let context=session.snapshot(),identity=context.observationRevision,target='',active=false,phase='idle',data=null,generation=0,controller=null,disposed=false;
 const agent=()=>context.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(value=>value.agentId===context.selectedAgentId):null;
 const selected=()=>inputs.find(input=>input.checked)?.value;
 function controls(){
  const current=agent(),ready=phase==='ready'&&data?.agentId===current?.agentId,locked=Boolean(context.interactionLocked);
  options.disabled=!ready||locked;save.disabled=!ready||locked||!modes.includes(selected())||selected()===data.mode||!dirty();retry.disabled=locked;
  status.textContent=phase==='loading'?'正在读取参与方式…':phase==='error'?'参与方式暂时无法读取，请稍后重试。':ready?`当前方式：${data.mode==='autonomous'?'自主参与':'仅观察'}${current.platformRestricted?' · 当前存在平台限制，此设置不会解除限制。':current.ownerPaused?' · 当前已暂停，此设置不会解除暂停。':''}`:'选择自己的 Agent 后查看参与方式。';retry.hidden=phase==='loading'||!current;retry.textContent=phase==='error'?'重新读取参与方式':'读取最新状态';
 }
 function reset(){generation++;controller?.abort();controller=null;data=null;phase='idle';for(const input of inputs)input.checked=false;remember();controls();}
 async function load({reset=false}={}){
  const current=agent();if(!active||!current||disposed)return;const turn=++generation,id=current.agentId;controller?.abort();const request=new AbortController();controller=request;phase='loading';controls();
  try{const value=readWorldActionPolicy(await session.readWorldActionPolicy({signal:request.signal}),id);if(disposed||!active||generation!==turn||request.signal.aborted)return;data=value;phase='ready';if(reset||!dirty()||selected()===value.mode){for(const input of inputs)input.checked=input.value===value.mode;remember();}controls();changed();return value;}
  catch(error){if(disposed||!active||generation!==turn||request.signal.aborted||error.name==='AbortError')return;data=null;phase='error';if(!dirty()){for(const input of inputs)input.checked=false;remember();}controls();changed();}
  finally{if(controller===request)controller=null;}
 }
 function sync(){
  const next=!document.hidden&&!form.closest('[hidden],[data-panel-state="closing"],[data-panel-state="closed"]')&&form.getClientRects().length>0;
  if(next===active)return;active=next;if(!active){generation++;controller?.abort();controller=null;}else if(agent())void load();controls();
 }
 form.addEventListener('submit',event=>{event.preventDefault();if(save.disabled||!data)return;void onSave({agentId:data.agentId,expectedVersion:data.version,mode:selected()});});retry.addEventListener('click',()=>void load());
 const stop=session.subscribe(value=>{const previous=target;context=value;target=agent()?.agentId||'';if(identity!==value.observationRevision||previous!==target){identity=value.observationRevision;reset();if(active&&target)void load();}else controls();});
 const observer=new MutationObserver(sync);observer.observe(document.querySelector('#hud-root')||form.parentNode,{subtree:true,attributes:true,attributeFilter:['hidden','data-manager-page','data-panel-state']});document.addEventListener('visibilitychange',sync);sync();
 return{controls,resetInputs(){if(data){for(const input of inputs)input.checked=input.value===data.mode;}else for(const input of inputs)input.checked=false;remember();controls();},refresh:load,dispose(){disposed=true;generation++;controller?.abort();observer.disconnect();document.removeEventListener('visibilitychange',sync);stop();}};
}
