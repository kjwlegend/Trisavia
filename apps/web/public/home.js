import {$,el} from './common.js';
import {bindOnboardingPrompt} from './onboarding-prompt.js';
import {createOwnerController} from './owner.js';
import {mountOwnerPanel,createOwnerPresentation} from './owner-panel.js';
import {createSessionApi} from './hud/session-api.js';
import {createHud} from './hud/shell.js';
import {initSceneRenderer,getWorldState} from './hud/scene-renderer.js';
import {mountWorldAudio} from './world-audio-ui.js';
import {mountWorldAtlas} from './hud/world-atlas.js';
import {mountPublicNavigation} from './public-navigation.js';
import {stripLocalePath,msg} from './i18n/core.js';
export async function boot({entryStore,intent}){
bindOnboardingPrompt({text:$('#agent-prompt'),copy:$('#copy-prompt'),retry:$('#retry-prompt'),status:$('#copy-status')});

const accountNode=mountOwnerPanel();let hud=null,controller=null,renderer=null;
const presentation=createOwnerPresentation(accountNode,{setTitle:value=>hud?.setAccountTitle(value),close:()=>hud?.close(),onChange:()=>controller?.notifyPresentation()});
controller=createOwnerController(accountNode,{entryStore,isVisible:()=>hud?.isAccountOpen()||false,focusTitle:()=>hud?.focusAccountTitle(),onView:()=>hud?.setAccountTitle(controller?.getTitle()||'账户'),onLogout:()=>hud?.close(),confirmAction:(...args)=>presentation.confirm(...args)});controller.attachPresentation(presentation);
const session=createSessionApi(controller);
hud=createHud({session,accountNode,canLeaveAccount:()=>controller.leaveEditing(),onLocateAgent:agentId=>renderer?.locateAgent(agentId),onOpenAccount:(mode,agentId)=>controller.open(mode,agentId),getAccountTitle:()=>controller.getTitle()});
mountPublicNavigation({namespaces:['shell','help']});
const humanHelp=el('details','human-entry-help');humanHelp.append(el('summary','',msg('help:humanGuide.label')),el('p','',msg('help:humanGuide.boundary')));for(const step of ['start','connect','permissions'])humanHelp.append(el('h3','',msg(`help:${step}.title`)),el('p','',msg(`help:${step}.body`)));humanHelp.append(el('p','',msg('help:connect.originalNotice')));$('.world-entry-copy').append(humanHelp);
renderer=initSceneRenderer({session,onSelectAgent:(agentId,origin)=>hud.openAccount('profile',agentId,origin)});
const atlas=mountWorldAtlas({beforeOpen:async()=>{if(controller.snapshot().interactionLocked||!await controller.leaveEditing())return false;hud.close(false);document.dispatchEvent(new CustomEvent('hud:open'));return true;},onReturnToTown:()=>renderer.returnToTown()});
const publicUrl=new URL(location.href),publicTargets=publicUrl.searchParams.getAll('resident');let publicTarget=null;
const atlasTargets=publicUrl.searchParams.getAll('atlas'),atlasRequested=stripLocalePath(publicUrl.pathname)==='/'&&atlasTargets.length===1&&atlasTargets[0]==='1';
if(stripLocalePath(publicUrl.pathname)==='/'&&atlasTargets.length){publicUrl.searchParams.delete('atlas');history.replaceState(history.state,'',publicUrl.pathname+publicUrl.search+publicUrl.hash);}
if(stripLocalePath(publicUrl.pathname)==='/'&&publicTargets.length){publicUrl.searchParams.delete('resident');history.replaceState(history.state,'',publicUrl.pathname+publicUrl.search+publicUrl.hash);publicTarget=publicTargets.length===1&&/^[A-Za-z0-9_-]{8,100}$/.test(publicTargets[0])?publicTargets[0]:'';renderer.focusPublicResident(publicTarget);}
const audio=mountWorldAudio();let audioIdentity=session.snapshot().observationRevision;session.subscribe(state=>{if(audioIdentity!==state.observationRevision){audioIdentity=state.observationRevision;audio.clearEffects();}});
const hadPrivateEntry=entryStore.pending;
let entryRevision=0;
window.addEventListener('hashchange',()=>{entryRevision++;try{const next=entryStore.capture();if(next.mode)hud.openAccount(next.mode,next.agentId);}catch{const alert=document.createElement('p');alert.className='notice error world-startup-error';alert.setAttribute('role','alert');alert.textContent='无法安全保存这次入口，请允许会话存储后重新打开。原任务保持不变。';$('#main').prepend(alert);}});
document.addEventListener('click',event=>{if(event.defaultPrevented)return;const link=event.target.closest('a[href]');if(!link)return;const url=new URL(link.href,location.origin);if(url.origin!==location.origin)return;if(stripLocalePath(url.pathname)===stripLocalePath(location.pathname)&&['#world-entry','#connect'].includes(url.hash)){event.preventDefault();hud.openAccount('entry','',link);return;}if(stripLocalePath(url.pathname)!=='/owner')return;const privateParams=new URLSearchParams(url.hash.slice(1));if(privateParams.has('handoff')||privateParams.has('assistance'))return;event.preventDefault();const params=new URLSearchParams(url.hash.slice(1));hud.openAccount(url.hash==='#register'?'register':url.hash==='#login'?'login':params.get('agent')?'profile':'account',params.get('agent')||'',link);});
$('.brand').addEventListener('click',event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();hud.close(false);$('#world-canvas')?.focus({preventScroll:true});});
if(publicTarget===null&&(intent.mode||controller.snapshot().continuation))hud.openAccount('resume');
await controller.start(intent);
if(publicTarget===null&&!entryRevision&&intent.mode&&intent.mode!=='profile'&&!hadPrivateEntry&&!controller.snapshot().continuation)hud.openAccount(intent.mode,intent.agentId);
hud.setAccountTitle(controller.getTitle());
document.body.classList.add('paper-app-ready');
if(publicTarget===null&&!intent.mode&&['#world-entry','#connect'].includes(location.hash))hud.openAccount('entry');
if(atlasRequested&&publicTarget===null&&!intent.mode&&!hadPrivateEntry&&!controller.snapshot().continuation&&!entryRevision&&!['#world-entry','#connect'].includes(location.hash))void atlas.open();
}
export {getWorldState};
