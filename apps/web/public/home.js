import {$} from './common.js';
import {bindOnboardingPrompt} from './onboarding-prompt.js';
import {createOwnerController} from './owner.js';
import {mountOwnerPanel,createOwnerPresentation} from './owner-panel.js';
import {createSessionApi} from './hud/session-api.js';
import {createHud} from './hud/shell.js';
import {initSceneRenderer,getWorldState} from './hud/scene-renderer.js';
export async function boot({entryStore,intent}){
bindOnboardingPrompt({text:$('#agent-prompt'),copy:$('#copy-prompt'),retry:$('#retry-prompt'),status:$('#copy-status')});

const accountNode=mountOwnerPanel();let hud=null,controller=null,renderer=null;
const presentation=createOwnerPresentation(accountNode,{setTitle:value=>hud?.setAccountTitle(value),close:()=>hud?.close(),onChange:()=>controller?.notifyPresentation()});
controller=createOwnerController(accountNode,{entryStore,isVisible:()=>hud?.isAccountOpen()||false,focusTitle:()=>hud?.focusAccountTitle(),onView:()=>hud?.setAccountTitle(controller?.getTitle()||'账户'),onLogout:()=>hud?.close(),confirmAction:(...args)=>presentation.confirm(...args)});controller.attachPresentation(presentation);
const session=createSessionApi(controller);
hud=createHud({session,accountNode,canLeaveAccount:()=>controller.leaveEditing(),onLocateAgent:agentId=>renderer?.locateAgent(agentId),onOpenAccount:(mode,agentId)=>controller.open(mode,agentId),getAccountTitle:()=>controller.getTitle()});
renderer=initSceneRenderer({session,onSelectAgent:(agentId,origin)=>hud.openAccount('profile',agentId,origin)});
const hadPrivateEntry=entryStore.pending;
let entryRevision=0;
window.addEventListener('hashchange',()=>{entryRevision++;try{const next=entryStore.capture();if(next.mode)hud.openAccount(next.mode,next.agentId);}catch{const alert=document.createElement('p');alert.className='notice error world-startup-error';alert.setAttribute('role','alert');alert.textContent='无法安全保存这次入口，请允许会话存储后重新打开。原任务保持不变。';$('#main').prepend(alert);}});
document.addEventListener('click',event=>{if(event.defaultPrevented)return;const link=event.target.closest('a[href]');if(!link)return;const url=new URL(link.href,location.origin);if(url.origin!==location.origin||url.pathname!=='/owner')return;const privateParams=new URLSearchParams(url.hash.slice(1));if(privateParams.has('handoff')||privateParams.has('assistance'))return;event.preventDefault();const params=new URLSearchParams(url.hash.slice(1));hud.openAccount(url.hash==='#register'?'register':url.hash==='#login'?'login':params.get('agent')?'profile':'account',params.get('agent')||'',link);});
$('.brand').addEventListener('click',event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();hud.close(false);$('#world-canvas')?.focus({preventScroll:true});});
if(intent.mode||controller.snapshot().continuation)hud.openAccount('resume');
await controller.start(intent);
if(!entryRevision&&intent.mode&&intent.mode!=='profile'&&!hadPrivateEntry&&!controller.snapshot().continuation)hud.openAccount(intent.mode,intent.agentId);
hud.setAccountTitle(controller.getTitle());
}
export {getWorldState};
