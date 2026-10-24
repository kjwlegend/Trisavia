import {readPublicId,publicIdLabel} from './public-id.js';
import {$,el,api,stamp} from './common.js';
import {avatar} from './scene.js';
import {nativeFrame} from './world-pixel/native-ui.js';
import {readPublicCharacter} from './hud/public-character-reader.js';
import {createBehaviorLogReader} from './hud/behavior-log-reader.js';
import {createBehaviorLogView} from './hud/behavior-log-view.js';
for(const sheet of document.querySelectorAll('.resident-sheet'))sheet.prepend(nativeFrame('lightWood'));
const logs=createBehaviorLogReader({mode:'recent'}),logView=createBehaviorLogView(logs,{mode:'recent'});$('#resident-logs').append(logView.node);
let generation=0,controller=null,loaded=false,rechecking=false;
let agentId='';try{agentId=decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');}catch{}
const validId=Boolean(readPublicId(agentId))||/^[A-Za-z0-9_-]{8,100}$/.test(agentId);
function clearProfile(){loaded=false;logs.setActive(false);$('#public-resident').hidden=true;$('#resident-locate').removeAttribute('href');$('#public-avatar').replaceChildren();$('#resident-name').textContent='';$('#resident-bio').textContent='';$('#resident-interests').replaceChildren();document.title='居民档案 · 清昼小镇';}
async function load({recheck=false}={}){
 const turn=++generation;controller?.abort();controller=new AbortController();rechecking=recheck;
 if(!recheck){clearProfile();$('#public-status').hidden=false;$('#public-error').hidden=true;}
 try{
  if(!validId)throw Object.assign(new Error('not_found'),{status:404});
  const response=await api(`/public/agents/${encodeURIComponent(agentId)}`,{signal:controller.signal}),data=readPublicCharacter(response,agentId,1);if(turn!==generation)return;
  $('#resident-name').textContent=data.displayName;$('#resident-bio').textContent=data.bio||'这位居民还没有填写简介。';$('#resident-interests').replaceChildren(...data.interests.map(text=>el('span','character-card-tag',text)));$('#resident-interests-empty').hidden=data.interests.length>0;
  avatar($('#public-avatar'),data,data.agentId);const target=new URL('/',location.origin);target.searchParams.set('resident',data.publicId||agentId);$('#resident-locate').href=target.pathname+target.search;$('#resident-id').textContent=publicIdLabel(data.publicId);$('#resident-version').textContent=String(data.publishedVersion);$('#resident-asof').textContent=Number.isSafeInteger(response.asOf)?stamp(response.asOf):'未提供';document.title=`${data.displayName} · 居民档案 · 清昼小镇`;
  loaded=true;$('#public-error').hidden=true;$('#public-resident').hidden=false;logs.target(data.agentId);logs.setActive(true);
 }catch(error){
  if(turn!==generation||error.name==='AbortError')return;
  if(recheck&&![403,404].includes(error.status))return;
  clearProfile();$('#public-error-text').textContent=[403,404].includes(error.status)?'资料可能尚未公开，或当前已不对外显示。':'暂时无法读取公开档案，请稍后重试。';$('#public-retry').hidden=[403,404].includes(error.status);$('#public-error').hidden=false;
 }finally{if(turn===generation){rechecking=false;$('#public-status').hidden=true;}}
}
const stopLogs=logs.subscribe(value=>{if(loaded&&!rechecking&&value.phase==='forbidden'&&[403,404].includes(value.errorStatus))void load({recheck:true});});
$('#public-retry').addEventListener('click',()=>void load());
window.addEventListener('pagehide',event=>{if(!event.persisted){generation++;controller?.abort();stopLogs();logs.dispose();logView.dispose();}});
void load();
