import {el,button} from './shared.js';
const date=value=>Number.isSafeInteger(value)?new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'发布时间未提供';
const validItem=(value,detail=false)=>value&&typeof value.id==='string'&&typeof value.title==='string'&&Number.isSafeInteger(value.version)&&(value.author===null||typeof value.author==='string')&&(value.publishedAt===null||Number.isSafeInteger(value.publishedAt))&&(!detail||typeof value.body==='string');
export function createWorldAnnouncementsFeature({detailHost}){
 const node=el('section','world-announcements');node.id='hud-feature-announcements';
 const toolbar=el('div','world-announcements-toolbar'),intro=el('div'),refresh=button('刷新公告',()=>void load());intro.append(el('strong','','小镇公告'),el('p','','了解小镇的新消息。'));toolbar.append(intro,refresh);
 const list=el('ol','world-announcements-list'),status=el('div','world-announcements-status');list.setAttribute('aria-label','公开公告');status.setAttribute('role','status');node.append(toolbar,list,status);
 let active=false,disposed=false,items=[],nextAfterId=null,complete=false,request=null,revision=0,phase='idle',opened=null,detailRequest=null,detailRevision=0;
 async function read(path,signal){
  const response=await fetch(path,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  const result=await response.json();if(!response.ok)throw Object.assign(new Error('announcement_unavailable'),{status:response.status});if(result?.protocolVersion!==1||result?.data?.worldId!=='default')throw new Error('announcement_invalid');return result.data;
 }
 function render(){
  const top=list.scrollTop;list.replaceChildren();status.replaceChildren();node.setAttribute('aria-busy',String(phase==='loading'));refresh.disabled=phase==='loading';
  for(const item of items){const row=el('li'),control=button('',()=>void openDetail(item,control),'world-announcement-row'),copy=el('span','world-announcement-copy'),meta=el('span','world-announcement-meta');control.dataset.announcementId=item.id;copy.append(el('strong','',item.title));meta.append(el('span','',item.author||'发布者未提供'),el('time','',date(item.publishedAt)));copy.append(meta);if(item.dataMode==='demo')copy.append(el('span','world-announcement-demo','演示内容'));control.append(copy,el('span','world-announcement-arrow','›'));row.append(control);list.append(row);}
  if(phase==='loading')status.append(el('p','','正在读取公告…'));
  else if(phase==='error')status.append(el('p','',items.length?'后续公告暂时无法读取。':'公告暂时无法读取。'),button('重新读取公告',()=>void load(Boolean(items.length))));
  else if(phase==='ready'&&!items.length&&complete)status.append(el('p','','暂无公告。'));
  else if(!complete&&nextAfterId)status.append(button('更多公告',()=>void load(true)));
  list.scrollTop=top;
 }
 async function load(more=false){
  if(!active||disposed||phase==='loading')return;request?.abort();const turn=++revision,controller=new AbortController();request=controller;
  if(!more){items=[];complete=false;nextAfterId=null;}phase='loading';render();
  try{const data=await read('/v1/world/announcements?worldId=default'+(more&&nextAfterId?'&afterId='+encodeURIComponent(nextAfterId):''),controller.signal);if(!active||turn!==revision)return;
   if(!Array.isArray(data.items)||data.items.some(item=>!validItem(item))||typeof data.complete!=='boolean'||(data.complete?data.nextAfterId!==null:typeof data.nextAfterId!=='string'||data.nextAfterId===nextAfterId))throw new Error('announcement_invalid');
   items=more?[...items,...data.items.filter(item=>!items.some(previous=>previous.id===item.id))]:data.items;complete=data.complete;nextAfterId=data.nextAfterId;phase='ready';
  }catch(error){if(controller.signal.aborted||turn!==revision)return;phase='error';}finally{if(turn===revision&&active){request=null;render();}}
 }
 function closeDetail(restore=true){detailRequest?.abort();detailRequest=null;detailRevision++;const origin=opened?.origin;opened=null;delete detailHost.node.dataset.announcements;if(restore&&origin?.isConnected)origin.focus({preventScroll:true});}
 function detailContent(item,phase,body){
  const content=el('article','world-announcement-detail'),meta=el('p','world-announcement-meta');meta.append(el('span','',item.author||'发布者未提供'),el('time','',date(item.publishedAt)));content.append(meta);
  if(item.dataMode==='demo')content.append(el('p','world-announcement-demo','演示内容'));
  if(phase==='ready')content.append(el('p','world-announcement-body',body));else{const feedback=el('div','world-announcements-status');feedback.setAttribute('role','status');feedback.append(el('p','',phase==='loading'?'正在读取公告正文…':'公告正文暂时无法读取。'));if(phase==='error')feedback.append(button('重试公告正文',()=>void openDetail(item,opened?.origin)));content.append(feedback);}return content;
 }
 async function openDetail(item,origin){
  detailRequest?.abort();const turn=++detailRevision,controller=new AbortController();detailRequest=controller;const already=Boolean(opened);opened={item,origin};detailHost.node.dataset.announcements='true';
  if(already)detailHost.update(item.title,detailContent(item,'loading'));else detailHost.open(item.title,detailContent(item,'loading'),restore=>closeDetail(restore));detailHost.setBack('← 返回公告',()=>detailHost.close());
  try{const data=await read('/v1/world/announcements/'+encodeURIComponent(item.id)+'?worldId=default',controller.signal);if(!active||turn!==detailRevision)return;if(!validItem(data.item,true)||data.item.id!==item.id)throw new Error('announcement_invalid');detailHost.update(data.item.title,detailContent(data.item,'ready',data.item.body));}
  catch(error){if(controller.signal.aborted||turn!==detailRevision)return;detailHost.update(item.title,detailContent(item,'error'));}
 }
 return {node,activate(){active=true;phase='idle';void load();},deactivate(){active=false;revision++;request?.abort();request=null;phase='idle';if(opened)detailHost.close(false);},setContext(){},back:()=>false,dispose(){disposed=true;active=false;revision++;request?.abort();if(opened)detailHost.close(false);}};
}
