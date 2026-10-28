import {accountMessage,accountText} from './owner-i18n.js';
const modes=['autonomous','observe'];
export function readWorldActionPolicy(value,agentId){
 if(value?.source!=='current'||value.agentId!==agentId||!Number.isSafeInteger(value.version)||value.version<0||!modes.includes(value.mode)||!(value.updatedAt===null||Number.isSafeInteger(value.updatedAt)&&value.updatedAt>=0)||!Number.isSafeInteger(value.asOf)||value.asOf<0)throw Object.assign(new Error('world_action_policy_unavailable'),{code:'world_action_policy_unavailable'});
 return{agentId,version:value.version,mode:value.mode,updatedAt:value.updatedAt,asOf:value.asOf,source:'current'};
}
export function mountWorldActionPolicy(form,{session,onSave,changed=()=>{},dirty=()=>false,remember=()=>{}}){
 const options=form.querySelector('#world-autonomy-options'),status=form.querySelector('#world-autonomy-current'),save=form.querySelector('#save-world-autonomy'),inputs=[...form.querySelectorAll('input[name=world-autonomy-mode]')],retry=document.createElement('button');retry.type='button';accountText(retry,()=>(accountMessage("policy.worldAction.retry")));retry.className='text-button';retry.hidden=true;status.after(retry);
 let context=session.snapshot(),identity=context.observationRevision,target='',active=false,phase='idle',data=null,generation=0,controller=null,disposed=false;
 const agent=()=>context.authenticated&&['ready','refreshing'].includes(context.phase)?context.agents.find(value=>value.agentId===context.selectedAgentId):null;
 const selected=()=>inputs.find(input=>input.checked)?.value;
 function controls(){
  const current=agent(),ready=phase==='ready'&&data?.agentId===current?.agentId,locked=Boolean(context.interactionLocked);
  options.disabled=!ready||locked;save.disabled=!ready||locked||!modes.includes(selected())||selected()===data.mode||!dirty();retry.disabled=locked;
  accountText(status,()=>(phase==='loading'?accountMessage("policy.worldAction.loading"):phase==='error'?accountMessage("policy.worldAction.unavailable"):ready?accountMessage("policy.world.currentWithRestriction",{mode:data.mode==='autonomous'?accountMessage("access.autonomous"):accountMessage("access.observe"),restriction:current.platformRestricted?accountMessage("policy.worldAction.restrictedSuffix"):current.ownerPaused?accountMessage("policy.worldAction.pausedSuffix"):''}):accountMessage("policy.worldAction.selectAgent")));retry.hidden=phase==='loading'||!current;accountText(retry,()=>(phase==='error'?accountMessage("policy.worldAction.retry"):accountMessage("manager.reload")));
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
