import {icon,illustration} from '../icons.js';
import {projectMailView,projectMessageDetail} from '../view-model.js';
import {el,button,demoLabel,feedback,focusNode} from './shared.js';

export function createMailFeature(provider,onEnterDemo=()=>{},{store,context,detailHost}={}){
  const node=el('section','hud-feature hud-mail'),list=el('div','hud-mail-list'),feedbackSlot=el('div','hud-mail-feedback-slot'),feedbackNode=el('div','hud-mail-feedback');
  node.id='hud-feature-mail';list.id='hud-mail-results';feedbackSlot.id='hud-mail-feedback-slot';feedbackNode.setAttribute('role','status');feedbackNode.hidden=true;
  const undoText=el('span');feedbackNode.append(undoText);let undoButton=null,feedbackLease=null;
  let local=store.snapshot(),revision=local.revision,source={phase:'idle'},demo=false,active=false,disposed=false;
  let detailId='',detailChannel='',detailIndex=0,sourcePreview=false,readOnSuccess=false,detailGeneration=0,scrollTimer=0,bodyTimer=0,undoTimer=0,listLease=null,detailLease=null,pendingScroll=null,pendingBody=null;
  const view=()=>projectMailView(local,source);
  const message=()=>projectMessageDetail(local,source,detailChannel,detailId);
  function flushScroll(){clearTimeout(scrollTimer);const pending=pendingScroll;pendingScroll=null;if(pending)store.mailView(pending.lease,{channel:pending.channel,scrollTop:pending.top});}
  function flushBody(){clearTimeout(bodyTimer);const pending=pendingBody;pendingBody=null;if(pending)store.mailPosition(pending.lease,pending.channel,pending.id,pending.top);}
  function flush(){flushScroll();flushBody();}
  function rememberScroll(){flushScroll();if(!detailHost.isOpen&&demo&&source.phase==='ready'&&listLease&&store.isCurrent(listLease)&&node.getClientRects().length)store.mailView(listLease,{scrollTop:list.scrollTop});}
  // Read filtering can temporarily shorten the inert list; that clamp is not user scrolling.
  list.addEventListener('scroll',()=>{if(detailHost.isOpen||!demo||source.phase!=='ready'||!listLease||!store.isCurrent(listLease)||!node.getClientRects().length)return;clearTimeout(scrollTimer);pendingScroll={lease:listLease,top:list.scrollTop,channel:local.state.mail.channel};scrollTimer=setTimeout(flushScroll,100);},{passive:true});
  function restoreScroll(){list.scrollTop=local.state.mail.scrollTop[local.state.mail.channel];}
  function rememberBody(){flushBody();if(detailId&&!sourcePreview&&detailLease&&store.isCurrent(detailLease)&&detailHost.body.getClientRects().length)store.mailPosition(detailLease,detailChannel,detailId,detailHost.body.scrollTop);}
  detailHost.body.addEventListener('scroll',()=>{if(!detailHost.isOpen||!detailId||sourcePreview||!detailLease||!store.isCurrent(detailLease)||source.phase!=='ready'||!detailHost.body.getClientRects().length)return;clearTimeout(bodyTimer);pendingBody={lease:detailLease,id:detailId,channel:detailChannel,top:detailHost.body.scrollTop};bodyTimer=setTimeout(flushBody,100);},{passive:true});
  function restoreFocus(){
    if(!active)return;const rows=[...list.querySelectorAll('[data-message-open]')];
    focusNode(rows.find(row=>row.dataset.messageOpen===detailId)||rows[Math.min(detailIndex,rows.length-1)]||node.querySelector('#hud-mail-list-title'));
  }
  function closeDetail(restore=true){detailHost.close(restore);}
  function updateFeedback(){
    clearTimeout(undoTimer);const group=local.state.mail.undo,remaining=group.expiresAt-Date.now();
    feedbackNode.hidden=!demo||!local.scope||!group.entries.length||remaining<=0;
    if(feedbackNode.hidden)return;
    undoText.textContent=group.entries.length===1?'已从演示信箱移除':'已移除 '+group.entries.length+' 条示例通知';
    const lease=store.lease();if(!feedbackLease||!store.isCurrent(feedbackLease)){undoButton?.remove();feedbackLease=lease;undoButton=button('撤销',()=>undo(lease));feedbackNode.append(undoButton);}undoTimer=setTimeout(()=>{if(store.expireUndo(lease))updateFeedback();},remaining+10);
  }
  function undo(lease){if(!store.undoRemoval(lease))return;render();updateFeedback();if(active)restoreFocus();else focusNode(document.querySelector('#hud-open-mail'));}
  function remove(entry,channel,lease){
    if(!entry||!store.isCurrent(lease)||!projectMessageDetail(local,source,channel,entry.id))return;
    rememberScroll();if(!store.removeMessage(lease,channel,entry.id))return;
    if(detailId===entry.id&&detailChannel===channel)closeDetail(false);render();restoreScroll();restoreFocus();updateFeedback();
  }
  function mark(entry,channel,lease){
    if(!entry||!store.isCurrent(lease)||!projectMessageDetail(local,source,channel,entry.id))return;
    rememberScroll();if(!store.markRead(lease,channel,entry.id,!entry.humanRead))return;
    if(detailHost.isOpen){patchRows();renderDetail();focusNode(detailHost.body.querySelector('[data-detail-read]'));}else{render();restoreScroll();const row=[...list.querySelectorAll('.hud-message-row')].find(row=>row.querySelector('[data-message-open]').dataset.messageOpen===entry.id);if(row)focusNode(row.querySelector('[data-row-read]'));else restoreFocus();}
  }
  function updateRow(row,entry,selectedId){
    row.querySelector('[data-message-open]').setAttribute('aria-pressed',String(entry.id===selectedId));row.dataset.read=String(entry.humanRead);
    row.querySelector('.hud-message-read').textContent=entry.humanRead?'已读':'未读';
    const action=row.querySelector('[data-row-read]'),label=entry.humanRead?'标为未读':'标为已读';action.setAttribute('aria-label',label);action.replaceChildren(icon(entry.humanRead?'unread':'read'),el('span','hud-row-action-label',label));
  }
  function createRow(entry,channel,lease){
    const row=el('div','hud-message-row');row.dataset.messageRow=entry.id;
    const current=()=>{if(!store.isCurrent(lease))return null;const projection=view();return projection.channel===channel?projection.messages.find(value=>value.id===entry.id):null;};
    const index=()=>view().messages.findIndex(value=>value.id===entry.id);
    const open=button('',()=>{const value=current();if(value)openMessage(value,index(),lease);},'hud-message-open');open.dataset.messageOpen=entry.id;open.dataset.messageId=entry.id;
    const text=el('span','hud-message-summary');text.append(el('strong','',entry.title),el('span','hud-muted',entry.source));open.append(icon(entry.source==='资料服务'?'document':'notice'),text);
    const read=el('span','hud-message-read'),markControl=rowAction('',entry.humanRead?'unread':'read',()=>{if(!current())return;detailIndex=index();mark(projectMessageDetail(local,source,channel,entry.id),channel,lease);});markControl.dataset.rowRead='';
    row.append(open,read,el('time','',entry.time),markControl,rowAction('删除','trash',()=>{const value=current();if(!value)return;detailIndex=index();remove(value,channel,lease);}));return row;
  }
  function emptyList(projection,lease){
    const all=projectMailView({...local,state:{...local.state,mail:{...local.state.mail,filters:{...local.state.mail.filters,[projection.channel]:{read:'all',pending:false}}}}},source);
    list.append(el('p','hud-feedback',all.messages.length?'没有符合条件的通知':'这里还没有通知'));
    if(all.messages.length)list.append(button('显示全部',()=>{if(store.mailView(lease,{read:'all',...(projection.channel==='private'?{pending:false}:{}),scrollTop:0}))render();}));
  }
  function patchRows(){
    const projection=view(),lease=store.lease(),top=detailHost.isOpen?local.state.mail.scrollTop[projection.channel]:list.scrollTop,visible=new Set(projection.messages.map(entry=>entry.id));
    if(projection.selectedId!==local.state.mail.selectedIds[projection.channel])store.mailView(lease,{selectedId:projection.selectedId});
    const rows=new Map();
    for(const child of [...list.children]){if(child.matches('.hud-message-row')&&visible.has(child.dataset.messageRow))rows.set(child.dataset.messageRow,child);else child.remove();}
    projection.messages.forEach((entry,index)=>{const row=rows.get(entry.id)||createRow(entry,projection.channel,lease);updateRow(row,entry,projection.selectedId);if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);});
    if(!projection.messages.length)emptyList(projection,lease);
    listLease=projection.ready?lease:null;list.scrollTop=top;
  }
  function detailContent(){
    const content=el('section','hud-mail-reader'),entry=message(),lease=store.lease(),generation=detailGeneration;
    content.append(demoLabel('示例通知 · 非真实消息'));
    if(source.phase==='loading'){content.append(el('p','hud-feedback','正在读取内容…'));return content;}
    if(source.phase!=='ready'||!entry||entry.available===true&&typeof entry.body!=='string'){
      content.append(el('p','hud-feedback','暂时打不开这条内容'),button('重试',async()=>{if(!store.isCurrent(lease)||generation!==detailGeneration)return;rememberScroll();readOnSuccess=true;await provider.load({reload:true});if(store.isCurrent(lease)&&generation===detailGeneration)renderDetail();}));return content;
    }
    if(!entry.available){content.append(el('h3','','此示例内容不可查看'),el('p','hud-muted','正文、图像及来源动作当前不可用。'));}
    else{
      if(readOnSuccess){readOnSuccess=false;store.markRead(lease,detailChannel,entry.id,true);}
      const item=source.data.items.find(value=>value.id===entry.sourceItemId);
      if(sourcePreview&&item){content.append(button('返回通知',()=>{if(!store.isCurrent(lease))return;sourcePreview=false;renderDetail(false);focusNode(detailHost.body.querySelector('button'));},'hud-back'),el('h3','',item.name),illustration(item.art),el('p','',item.description),el('p','hud-muted','这是该通知引用的演示作品。'));return content;}
      sourcePreview=false;content.append(el('h3','',entry.title),el('p','hud-muted',`来源：${entry.source} · ${entry.time}`),el('p','hud-muted',detailChannel==='private'?'你正在阅读示例 Agent 的演示通知。':'你正在阅读公开公告的示例列表。'),el('p','hud-message-body',entry.body));
      if(item)content.append(button('查看内容',()=>{if(!store.isCurrent(lease))return;rememberBody();sourcePreview=true;renderDetail(false);detailHost.body.scrollTop=0;focusNode(detailHost.body.querySelector('.hud-back'));}));
      if(entry.status)content.append(el('p','hud-muted',entry.status));
    }
    const current=message(),actions=el('div','button-row'),read=button(current?.humanRead?'标为未读':'标为已读',()=>mark(current,detailChannel,lease));read.dataset.detailRead='';actions.append(read,button('删除',()=>remove(current,detailChannel,lease)));
    content.append(actions,el('p','hud-muted','删除仅从你的列表移除，不改变来源内容或事项；网页阅读不推进 Agent 的进度。'));return content;
  }
  function renderDetail(remember=true){if(!detailHost.isOpen||!detailId)return;if(remember)rememberBody();detailHost.update(sourcePreview?'相关内容':'通知详情',detailContent());if(!sourcePreview)detailHost.body.scrollTop=local.state.mail.bodyScrollTop[detailChannel][detailId]||0;}
  function openMessage(entry,index,lease){
    if(!store.isCurrent(lease))return;rememberScroll();detailId=entry.id;detailChannel=local.state.mail.channel;detailIndex=index;sourcePreview=false;readOnSuccess=true;detailGeneration++;
    store.mailView(lease,{selectedId:entry.id});detailLease=lease;
    detailHost.open('通知详情',detailContent(),restore=>{rememberBody();detailGeneration++;sourcePreview=false;readOnSuccess=false;patchRows();restoreScroll();if(restore&&store.isCurrent(lease))restoreFocus();detailId='';detailChannel='';detailLease=null;});
    detailHost.body.scrollTop=local.state.mail.bodyScrollTop[detailChannel][detailId]||0;patchRows();
  }
  function rowAction(label,name,handler){const control=button('',event=>{event.stopPropagation();handler();},'hud-mail-row-action');control.setAttribute('aria-label',label);control.append(icon(name),el('span','hud-row-action-label',label));return control;}
  function render(){
    if(disposed)return;node.replaceChildren();listLease=null;
    try{
    if(!demo){const lease=store.lease(),enter=button('查看演示信箱',()=>{if(!store.isCurrent(lease))return;demo=true;render();updateFeedback();onEnterDemo();provider.load();});enter.disabled=!local.scope;node.append(el('p','','此内容尚未接入。'),el('p','hud-muted','尚未接入真实通知。示例信箱不代表你或当前 Agent 的真实收件。'),enter);if(!local.scope){const status=context.snapshot();node.append(el('p','hud-feedback',status.phase==='error'?'演示内容暂不可用。':status.phase==='pending'?'请先确认当前账号状态，再查看演示。':'正在准备演示内容…'));if(status.phase==='error')node.append(button('重试演示内容',()=>context.load()));}return;}
    node.append(demoLabel('示例信箱 · 阅读标记保存在此浏览器'));
    if(!local.scope){const status=context.snapshot();node.append(el('p','hud-feedback',status.phase==='error'?'演示内容暂不可用。':status.phase==='pending'?'请先确认当前账号状态，再查看演示。':'正在准备演示内容…'));if(status.phase==='error')node.append(button('重试演示内容',()=>context.load()));return;}
    if(local.persistence==='memory')node.append(el('p','hud-muted','此浏览器暂时无法保存演示记录，本次更改只保留在当前页面。'));
    if(source.phase!=='ready'){node.append(feedback(source,provider,onEnterDemo));return;}
    const projection=view(),lease=store.lease(),toolbar=el('div','hud-filters');
    for(const [channel,label]of [['private','私人通知'],['world','世界动态']]){const control=button(label,()=>{if(!store.isCurrent(lease))return;rememberScroll();store.mailView(lease,{channel});render();focusNode(node.querySelector(`[data-tab="${channel}"]`));});control.dataset.tab=channel;control.setAttribute('aria-pressed',String(projection.channel===channel));toolbar.append(control);}
    const filters=el('div','hud-mail-filters');for(const [read,label]of [['all','全部'],['unread','未读'],['read','已读']]){const control=button(label,()=>{if(store.mailView(lease,{read,scrollTop:0})){render();focusNode(node.querySelector(`[data-read-filter="${read}"]`));}});control.dataset.readFilter=read;control.setAttribute('aria-pressed',String(local.state.mail.filters[projection.channel].read===read));filters.append(control);}
    if(projection.channel==='private'){const control=button('待处理',()=>{if(store.mailView(lease,{pending:!local.state.mail.filters.private.pending,scrollTop:0})){render();focusNode(node.querySelector('[data-pending-filter]'));}});control.dataset.pendingFilter='';control.setAttribute('aria-pressed',String(local.state.mail.filters.private.pending));filters.append(control);}
    const heading=el('h3','hud-list-heading',projection.channel==='private'?'示例私人通知':'示例世界动态');heading.id='hud-mail-list-title';heading.tabIndex=-1;list.replaceChildren();list.setAttribute('aria-labelledby',heading.id);
    if(projection.selectedId!==local.state.mail.selectedIds[projection.channel])store.mailView(lease,{selectedId:projection.selectedId});
    patchRows();
    node.append(toolbar,filters,heading,list,feedbackSlot);listLease=lease;restoreScroll();
    }finally{node.append(feedbackSlot);}
  }
  const stops=[store.subscribe(value=>{
    if(disposed)return;
    const changed=value.revision!==revision;local=value;
    if(changed){revision=value.revision;clearTimeout(scrollTimer);clearTimeout(bodyTimer);pendingScroll=null;pendingBody=null;listLease=null;closeDetail(false);detailHost.clear();demo=false;detailId='';detailChannel='';sourcePreview=false;readOnSuccess=false;render();}
    updateFeedback();
  }),context.subscribe(()=>{if(!local.scope)render();}),provider.subscribe(value=>{source=value;render();renderDetail();})];
  return{
    node,feedbackNode,feedbackSlot,flush,
    activate(){active=true;restoreScroll();},deactivate(){rememberScroll();active=false;closeDetail(false);},setCompact(){},setContext(){},
    back(){if(!detailHost.isOpen)return false;if(sourcePreview){sourcePreview=false;renderDetail(false);return true;}closeDetail();return true;},
    dispose(){flush();closeDetail(false);disposed=true;clearTimeout(scrollTimer);clearTimeout(bodyTimer);clearTimeout(undoTimer);for(const stop of stops)stop?.();},
  };
}
