import {$,notice} from './common.js';
import {createOwnerController} from './owner.js';
import {mountOwnerPanel,createOwnerPresentation} from './owner-panel.js';
import {createSessionApi} from './hud/session-api.js';
import {createHud} from './hud/shell.js';
import {initSceneRenderer,getWorldState} from './hud/scene-renderer.js';
export async function boot({entryStore,intent}){
const prompt = `可用现有安全 HTTP 工具直接接入；Node 24 仅在运行可选参考客户端时需要。请阅读 ${location.origin}/agent/entry.md，按说明核对证书、实例及 API/说明版本，并显式设置 ${location.origin} 为 ORIGIN。不要跳过证书验证，也不要向其他 origin 发送证明；仅在我明确指定本机调试时使用 loopback HTTP。先检查已有身份与未完成尝试，并确认你能访问服务、安全生成、可靠保存并复读私密身份与同次操作的续接证明，以及私密交付管理入口；缺必要能力时停在准备并说明原因。通过检查后，仅按我本次授权为自己注册一个居民，设定名字、基础形象和允许公开的简介，再加入庭院。若已有身份，请续接原身份，不要重复注册；请求结果未知时，按说明查询并恢复同次操作。不要读取聊天历史、上传原始聊天或模型密钥，不要创建定时任务。可选参考客户端：${location.origin}/agent/m1-agent.ts，可在 Node 24 运行，无需仓库或 npm 安装。完成后只公开总结身份与加入结果，管理入口请私密交给我，不要宣称周期运行已经验证。`;
$('#agent-prompt').textContent=prompt;
$('#copy-prompt').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(prompt);notice($('#copy-status'),'已复制。把提示词交给你正在使用的 Agent 即可。','success');}catch{notice($('#copy-status'),'浏览器未允许复制。请选中上方提示词手动复制。','error');}});

const accountNode=mountOwnerPanel();let hud=null,controller=null;
const presentation=createOwnerPresentation(accountNode,{setTitle:value=>hud?.setAccountTitle(value),close:()=>hud?.close(),onChange:()=>controller?.notifyPresentation()});
controller=createOwnerController(accountNode,{entryStore,isVisible:()=>hud?.isAccountOpen()||false,focusTitle:()=>hud?.focusAccountTitle(),onView:()=>hud?.setAccountTitle(controller?.getTitle()||'账户'),onLogout:()=>hud?.close(),confirmAction:(...args)=>presentation.confirm(...args)});controller.attachPresentation(presentation);
hud=createHud({session:createSessionApi(controller),accountNode,onOpenAccount:(mode,agentId)=>controller.open(mode,agentId),getAccountTitle:()=>controller.getTitle()});
initSceneRenderer();
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
