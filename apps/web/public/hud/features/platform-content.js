import {icon} from '../icons.js';
import {readPhase} from '../world-read-provider.js';
import {el,button,focusNode,selectedAgent} from './shared.js';

const keyOf=record=>JSON.stringify([record?.ref?.moduleId,record?.ref?.type,record?.ref?.id]);
const same=(a,b)=>keyOf(a)===keyOf(b)&&a?.version===b?.version;
const titleOf=record=>record?.summary?.title||'内容详情';
const dataLabel=(record,holding=false)=>record?.summary?.dataMode==='demo'||record?.content?.dataMode==='demo'?holding?'演示持有记录':'演示内容':record?.summary?.source?.kind==='administrative_publication'||record?.content?.source?.kind==='administrative_publication'?'平台发布':'平台内容';
const time=value=>typeof value==='number'&&Number.isFinite(value)?new Date(value).toLocaleString('zh-CN',{hour12:false}):'';
function sourceText(value){
  const source=value?.summary?.source||value?.content?.source;
  if(source?.kind==='demo_seed')return '来源：平台演示内容';
  if(source?.kind==='demo_holding')return '来源：平台演示持有记录';
  if(source?.kind==='administrative_publication')return `来源：平台内容发布${typeof source.administrator==='string'?' · '+source.administrator:''}`;
  return '来源说明暂不可用';
}
function badge(record,holding=false){return el('span','hud-data-badge',dataLabel(record,holding));}
function eventLabel(record){const kind=record?.summary?.eventKind;if(kind==='plan')return record.summary.dataMode==='demo'?'演示计划':'计划';if(kind==='occurrence')return record.summary.dataMode==='demo'?'演示发生记录':'发生记录';return '事件 · 类型暂未确认';}
function eventTime(record,detail){
  if(record?.summary?.eventKind==='plan')return '计划时间未提供';
  if(record?.summary?.eventKind==='occurrence'){
    const occurred=time(detail?.content?.publication?.occurredAt??(record.summary.source?.kind==='administrative_publication'?record.summary.source.publishedAt:undefined));
    return occurred?`内容发布于 ${occurred}`:'发生时间未确认';
  }
  return '';
}
function statusText(record){return({demo_planned:'演示计划，尚无发生结果',demo_occurred:'演示发生记录',committed:'内容已发布'})[record?.summary?.status]||'';}
function tabs(options,current,select){const bar=el('div','hud-filters');for(const [key,label]of options){const control=button(label,()=>select(key));control.dataset.platformTab=key;control.setAttribute('aria-pressed',String(key===current));bar.append(control);}return bar;}
const emptyText={holdings:'当前没有可查看的持有记录。',items:'当前没有可查看的物品。',notifications:'当前没有可查看的通知。',announcements:'当前没有可查看的公告。',events:'当前没有可查看的事件。'};
function feedback(state,key,retry,chooseAgent){
  const box=el('div','hud-feedback');box.setAttribute('role','status');
  let message=state.phase==='loading'?'正在载入内容……':state.phase==='no_agent'?'请选择要查看的 Agent。':state.phase==='session'?'登录状态已失效或尚未登录，请登录后查看。':state.phase==='denied'?'当前账号无权查看这类内容。':state.phase==='resync'?'内容已变化，请重新载入当前列表。':state.phase==='not_enabled'?key==='holdings'?'主人查看背包的入口尚未开放。':key==='notifications'?'主人查看这类通知的入口尚未开放。':key==='events'?'事件读取暂未开放。':'这类内容的读取暂未开放。':state.phase==='unavailable'?'内容来源暂不可用，请稍后重试。':state.phase==='partial'?'后续内容暂时无法载入。已显示部分内容，尚未全部载入。':state.phase==='ready'&&state.complete?emptyText[key]:'暂时无法载入，请稍后重试。';
  box.append(el('p','',message));
  if(state.phase==='no_agent'||state.phase==='session')box.append(button(state.phase==='no_agent'?'选择 Agent':'登录账号',chooseAgent));
  else if(['error','unavailable','partial','resync'].includes(state.phase))box.append(button(state.phase==='resync'?'重新载入':'重试',retry));
  return box;
}
function pageFoot(state,key,provider){const node=el('div','hud-page-state');node.setAttribute('role','status');if(state.phase==='loading')node.append(el('p','hud-muted','正在继续载入……'));else if(state.phase==='partial')node.append(feedback(state,key,()=>provider.load(key,{more:Boolean(state.nextPageToken)}),()=>{}));else if(state.phase==='ready'){node.append(el('p','hud-muted',state.complete?`当前可查看范围已完整载入 · ${state.records.length} 条`:`已载入 ${state.records.length} 条，尚未全部载入。`));if(!state.complete)node.append(button('继续载入',()=>provider.load(key,{more:true})));}return node;}
function contentBody(record,detail){
  const body=el('section','hud-platform-body');body.append(badge(detail,record?.ref?.type==='inventory.holding@1'),el('p','hud-muted',sourceText(detail)));
  const published=time(detail?.content?.source?.publishedAt);if(published)body.append(el('p','hud-muted',`发布时间：${published}`));
  if(record?.summary?.eventKind){body.append(el('p','hud-muted',eventLabel(record)),el('p','hud-muted',eventTime(record,detail)));const status=statusText(record);if(status)body.append(el('p','hud-muted',status));}
  body.append(el('p','hud-message-body',detail.content.text));
  if(Array.isArray(detail.attachments)&&detail.attachments.length){const note=el('section');note.append(el('h3','','附件说明'));for(const attachment of detail.attachments){if(typeof attachment?.name==='string'||typeof attachment?.description==='string')note.append(el('p','',`${attachment.name||'附件'}${attachment.description?' · '+attachment.description:''}`));}body.append(note);}
  return body;
}
function detailFeedback(error,retry){const box=el('section');const phase=readPhase(error);box.append(el('p','hud-feedback',phase==='session'?'登录状态已失效，请重新登录。':['denied','not_enabled'].includes(phase)?'这条内容目前不可查看。':'暂时无法载入完整内容。'));if(!['session','denied','not_enabled'].includes(phase))box.append(button('重试',retry));return box;}

// Example features retain their original isolated local storage and interactions.
export function createContentSwitcher(example,platform,{session,onEnterDemo=()=>{},id}={}){
  const node=el('section','hud-feature hud-data-feature'),switcher=el('div','hud-content-switch'),label=el('p','hud-demo-label','界面示例 · 非本次平台读取'),feedbackNode=el('div');node.id=id;example.node.removeAttribute('id');if(example.feedbackNode)feedbackNode.append(example.feedbackNode);
  let demo=false,active=false,identity=session.snapshot().observationRevision;
  const control=button('查看界面示例',()=>{if(active)(demo?example:platform).deactivate?.();demo=!demo;if(demo){example.enterDemo();onEnterDemo();}render();if(active)(demo?example:platform).activate?.();});
  switcher.append(control);
  function render(){control.textContent=demo?'返回平台内容':'查看界面示例';label.hidden=!demo;feedbackNode.hidden=!demo;example.node.hidden=!demo;platform.node.hidden=demo;node.replaceChildren(label,demo?example.node:platform.node,switcher);}
  render();
  return{node,feedbackNode,feedbackSlot:example.feedbackSlot,flush:()=>example.flush?.(),activate(){active=true;(demo?example:platform).activate?.();},deactivate(){(demo?example:platform).deactivate?.();active=false;},setCompact(value){example.setCompact?.(value);platform.setCompact?.(value);},setContext(state){if(identity!==state.observationRevision){identity=state.observationRevision;if(demo)example.deactivate?.();demo=false;render();}example.setContext?.(state);platform.setContext?.(state);},back:()=>demo?example.back():platform.back(),showWorld(category){if(demo)example.deactivate?.();demo=false;render();platform.showWorld?.(category);},dispose(){example.dispose();platform.dispose();}};
}

export function createPlatformInventory(provider,{session,chooseAgent=()=>{}}={}){
  const node=el('section','hud-inventory hud-platform-content'),results=el('div','hud-inventory-grid-scroll'),details=el('section','hud-item-detail');results.id='hud-platform-item-results';details.id='hud-platform-item-detail';
  let key='holdings',state=session.snapshot(),active=false,disposed=false,selected=null,detail=null,detailError=null,detailRequest=null,detailRevision=0,preview=false;
  const views={holdings:{selected:'',top:0,detailTop:0,query:''},items:{selected:'',top:0,detailTop:0,query:''}};
  results.addEventListener('scroll',()=>{if(node.getClientRects().length)views[key].top=results.scrollTop;},{passive:true});
  details.addEventListener('scroll',()=>{if(detail&&node.getClientRects().length)views[key].detailTop=details.scrollTop;},{passive:true});
  function remember(){views[key].top=results.scrollTop;views[key].detailTop=details.scrollTop;}
  function cancel(){detailRevision++;detailRequest?.abort();detailRequest=null;}
  function clear(){cancel();selected=null;detail=null;detailError=null;preview=false;details.replaceChildren();}
  async function read(record){
    clear();selected=record;const generation=detailRevision,request=new AbortController();detailRequest=request;renderDetail();
    try{const own=record.detailAvailable===false?null:await provider.detail(key,record,{signal:request.signal});if(generation!==detailRevision||disposed)return;
      if(!own){detail={summaryOnly:true};renderDetail();return;}
      detail={own};
      if(key==='holdings'&&own.content.itemRef){
        try{detail.item=await provider.detail('items',{ref:own.content.itemRef},{signal:request.signal});}catch(error){if(error.name==='AbortError')throw error;detail.itemError=error;}
      }
      if(generation===detailRevision&&!disposed)renderDetail();
    }catch(error){if(generation!==detailRevision||disposed||error.name==='AbortError')return;detailError=error;detail=null;renderDetail();}
  }
  function renderDetail(){
    const top=details.scrollTop;details.replaceChildren();if(!selected)return;
    details.append(el('h3','',titleOf(selected)));
    if(detailError){details.append(detailFeedback(detailError,()=>read(selected)));return;}
    if(!detail){details.append(el('p','hud-feedback','正在读取完整内容……'));return;}
    if(detail.summaryOnly){details.append(el('p','hud-muted','当前仅可查看摘要。'));return;}
    if(key==='holdings'){
      if(detail.item)details.append(contentBody({summary:{title:titleOf(selected)}},detail.item));else details.append(el('p','hud-muted',detail.itemError?'引用物品目前不可查看。':'物品正文未向当前账号开放。'));
      details.append(el('h3','','持有说明'),badge(selected,true));
      const quantity=detail.own.content.quantity??selected.summary.quantity;if(Number.isSafeInteger(quantity))details.append(el('p','',`记录数量：${quantity}`));
      if(selected.summary.status==='active')details.append(el('p','hud-muted','持有状态：有效'));
      details.append(contentBody(selected,detail.own));
    }else details.append(contentBody(selected,detail.own));
    if(preview){details.prepend(button('返回物品详情',()=>{preview=false;renderDetail();},'hud-back'));}
    else if(selected.summary.itemKind==='work'||detail.item&&selected.ref.type==='inventory.holding@1')details.append(button('查看作品内容',()=>{views[key].detailTop=details.scrollTop;preview=true;renderDetail();details.scrollTop=0;}));
    details.scrollTop=top||views[key].detailTop;
  }
  function renderResults(){
    const source=provider.snapshot(key),view=views[key],top=view.top;results.replaceChildren();
    const records=source.records.filter(record=>titleOf(record).includes(view.query));
    if(!source.records.length){clear();results.append(feedback(source,key,()=>provider.load(key),chooseAgent));return;}
    if(!records.length){clear();results.append(el('p','hud-feedback','没有符合条件的内容。'),button('清除筛选',()=>{view.query='';render();}));return;}
    const grid=el('div','hud-items');grid.setAttribute('aria-label',key==='holdings'?'获准持有记录':'公开物品目录');
    const chosen=records.find(record=>keyOf(record)===view.selected)||records[0];view.selected=keyOf(chosen);
    for(const record of records){const control=button('',()=>{remember();view.selected=keyOf(record);view.detailTop=0;renderResults();focusNode([...grid.querySelectorAll('button')].find(value=>value.dataset.platformItem===record.ref.id));});control.dataset.platformItem=record.ref.id;control.setAttribute('aria-label',titleOf(record));control.setAttribute('aria-pressed',String(same(record,chosen)));const slot=el('span','hud-item-slot');slot.append(icon(record.summary.itemKind==='work'?'document':'inventory'));control.append(slot,el('span','hud-item-name',titleOf(record)),badge(record,key==='holdings'),el('span','hud-item-full-name',titleOf(record)));grid.append(control);}
    results.append(grid,pageFoot(source,key,provider));results.scrollTop=top;
    if(!same(selected,chosen)){if(active)void read(chosen);else details.replaceChildren();}else renderDetail();
  }
  function render(){
    if(disposed)return;node.replaceChildren();const view=views[key],agent=selectedAgent(state);
    node.append(tabs([['holdings','背包'],['items','物品目录']],key,next=>{remember();key=next;clear();render();if(active)void provider.load(key);}));
    node.append(el('p','hud-muted',key==='holdings'?`正在查看：${agent?.name?agent.name+'的背包':'请选择 Agent'} · 平台内容`:'公开物品 · 不表示你或当前 Agent 持有'));
    if(key==='holdings'&&!state.selectedAgentId)node.append(button('查看物品目录',()=>{key='items';clear();render();if(active)void provider.load(key);}));
    const columns=el('div','hud-inventory-layout'),browser=el('div','hud-inventory-browser'),label=el('label','hud-search','搜索当前已载入物品'),search=el('input');search.type='search';search.value=view.query;search.maxLength=100;search.id='hud-platform-item-search';search.addEventListener('input',()=>{remember();view.query=search.value;view.top=0;renderResults();});label.append(search);browser.append(label,results);columns.append(browser,details);node.append(columns);renderResults();
  }
  const stop=provider.subscribe(changed=>{const source=provider.snapshot(changed);if(views[changed]&&['denied','session','resync'].includes(source.phase))Object.assign(views[changed],{selected:'',top:0,detailTop:0,query:''});if(changed!==key)return;if(!source.records.length)clear();render();});
  render();
  return{node,activate(){active=true;void provider.load(key);},deactivate(){remember();active=false;provider.cancel(key);cancel();if(!detail)selected=null;},setContext(next){if(state.observationRevision!==next.observationRevision){clear();for(const view of Object.values(views))Object.assign(view,{selected:'',top:0,detailTop:0});}state=next;render();},back(){if(!preview)return false;preview=false;renderDetail();return true;},dispose(){disposed=true;cancel();stop();}};
}

export function createPlatformMail(provider,{session,detailHost,chooseAgent=()=>{}}={}){
  const node=el('section','hud-mail hud-platform-content'),list=el('div','hud-mail-list');list.id='hud-platform-mail-results';
  let key='notifications',worldKey='announcements',state=session.snapshot(),active=false,disposed=false,opened=null,detail=null,detailError=null,request=null,generation=0,related=null,relatedDetail=null,relatedError=null,relatedTop=0,readerTop=0;
  const views=Object.fromEntries(['notifications','announcements','events'].map(key=>[key,{top:0,selected:'',bodyTop:{}}]));
  list.addEventListener('scroll',()=>{if(!detailHost.isOpen&&node.getClientRects().length)views[key].top=list.scrollTop;},{passive:true});
  function remember(){if(node.getClientRects().length)views[key].top=list.scrollTop;}
  function cancel(){generation++;request?.abort();request=null;}
  function close(restore=true){detailHost.close(restore);}
  function focusRow(){if(active)focusNode([...list.querySelectorAll('[data-platform-message]')].find(control=>control.dataset.platformMessage===opened?.ref.id)||node.querySelector('h3'));}
  function associations(){return detail?.content?.publication?.publishedRefs||[];}
  async function readRelated(ref){
    const parent=opened,g=++generation;request?.abort();request=new AbortController();if(!related)relatedTop=detailHost.body.scrollTop;related=ref;relatedDetail=null;relatedError=null;renderDetail();detailHost.body.scrollTop=0;
    const relatedKey=ref.type==='items.item@1'?'items':ref.type==='world.announcement@1'?'announcements':['world.plan@1','world.occurrence@1'].includes(ref.type)?'events':null;
    if(!relatedKey){relatedError={code:'target_not_accessible'};renderDetail();return;}
    try{const result=await provider.detail(relatedKey,{ref},{signal:request.signal});if(g!==generation||opened!==parent)return;relatedDetail=result;renderDetail();}catch(error){if(g!==generation||error.name==='AbortError')return;relatedError=error;renderDetail();}
  }
  function reader(){
    const body=el('section','hud-mail-reader');
    if(related){body.append(button('返回原内容',()=>{cancel();related=null;relatedDetail=null;relatedError=null;renderDetail();detailHost.body.scrollTop=relatedTop;},'hud-back'),el('h3','','关联内容'));if(relatedDetail)body.append(contentBody(null,relatedDetail));else if(relatedError)body.append(detailFeedback(relatedError,()=>readRelated(related)));else body.append(el('p','hud-feedback','正在读取关联内容……'));return body;}
    body.append(el('h3','',titleOf(opened)),badge(opened));
    if(opened?.detailAvailable===false){body.append(el('p','hud-muted','当前仅可查看摘要。'));return body;}
    if(detailError){body.append(detailFeedback(detailError,()=>read(opened)));return body;}
    if(!detail){body.append(el('p','hud-feedback','正在读取完整内容……'));return body;}
    body.append(contentBody(opened,detail));
    const refs=associations().filter(ref=>['items.item@1','world.announcement@1','world.plan@1','world.occurrence@1'].includes(ref.type));
    if(refs.length){const links=el('section','hud-related-content');links.append(el('h3','','关联内容'));refs.forEach((ref,index)=>links.append(button(`查看关联${ref.type==='items.item@1'?'物品':ref.type==='world.announcement@1'?'公告':'事件'} ${index+1}`,()=>readRelated(ref))));body.append(links);}
    return body;
  }
  function renderDetail(){if(!opened||!detailHost.isOpen)return;const top=detailHost.body.scrollTop;detailHost.update(related?'关联内容':key==='events'?'事件详情':key==='announcements'?'公告详情':'通知详情',reader());detailHost.body.scrollTop=!related&&detail&&readerTop?readerTop:top;if(!related&&detail)readerTop=0;}
  async function read(record){
    cancel();const g=generation;detail=null;detailError=null;related=null;request=new AbortController();renderDetail();
    if(record.detailAvailable===false)return;
    try{const result=await provider.detail(key,record,{signal:request.signal});if(g!==generation||disposed||opened!==record)return;detail=result;renderDetail();}
    catch(error){if(g!==generation||disposed||error.name==='AbortError')return;detailError=error;renderDetail();}
  }
  function open(record){remember();opened=record;views[key].selected=keyOf(record);readerTop=views[key].bodyTop[keyOf(record)]||0;detail=null;detailError=null;related=null;detailHost.open(key==='events'?'事件详情':key==='announcements'?'公告详情':'通知详情',reader(),restore=>{if(detail)views[key].bodyTop[keyOf(record)]=related?relatedTop:detailHost.body.scrollTop;cancel();if(restore)focusRow();opened=null;detail=null;related=null;list.scrollTop=views[key].top;});void read(record);}
  function select(next){remember();close(false);key=next;if(next!=='notifications')worldKey=next;render();if(active)void provider.load(key);}
  function render(){
    if(disposed)return;node.replaceChildren();const agent=selectedAgent(state),source=provider.snapshot(key);
    node.append(tabs([['notifications','通知'],['world','世界动态']],key==='notifications'?'notifications':'world',next=>select(next==='world'?worldKey:'notifications')));
    if(key!=='notifications')node.append(tabs([['announcements','公告'],['events','事件']],key,select));
    node.append(el('p','hud-muted',key==='notifications'?`阅读者：你（当前登录账号） · 收件对象：${agent?.name||'请选择 Agent'}`:'公开内容 · 不代表私人来信'),el('p','hud-muted','当前可查看内容，阅读标记暂未开放。'));
    const heading=el('h3','hud-list-heading',key==='notifications'?'获准通知':key==='events'?'事件计划与发生记录':'公开公告');heading.tabIndex=-1;node.append(heading);list.replaceChildren();
    for(const record of source.records){const row=el('div','hud-message-row hud-platform-message-row'),control=button('',()=>open(record),'hud-message-open');control.dataset.platformMessage=record.ref.id;control.setAttribute('aria-pressed',String(keyOf(record)===views[key].selected));const text=el('span','hud-message-summary');text.append(el('strong','',`${key==='events'?eventLabel(record)+' · ':''}${titleOf(record)}`),el('span','hud-muted',sourceText(record)));control.append(icon(key==='events'?'clock':'notice'),text);row.append(control,badge(record));const published=time(record.summary.source?.publishedAt);row.append(el('time','',key==='events'?eventTime(record):published?`发布于 ${published}`:'发布时间未提供'));list.append(row);}
    if(!source.records.length)list.append(feedback(source,key,()=>provider.load(key),chooseAgent));else list.append(pageFoot(source,key,provider));node.append(list);list.scrollTop=views[key].top;
  }
  const stop=provider.subscribe(changed=>{const source=provider.snapshot(changed);if(views[changed]&&['denied','session','resync'].includes(source.phase))Object.assign(views[changed],{top:0,selected:'',bodyTop:{}});if(changed!==key)return;if(!source.records.length){close(false);cancel();opened=null;detail=null;detailHost.clear();}render();});render();
  return{node,activate(){active=true;void provider.load(key);},deactivate(){remember();active=false;close(false);provider.cancel(key);cancel();},setContext(next){if(state.observationRevision!==next.observationRevision){close(false);cancel();opened=null;detail=null;detailHost.clear();for(const view of Object.values(views))Object.assign(view,{top:0,selected:'',bodyTop:{}});}state=next;render();},showWorld(category){select(category==='events'?'events':'announcements');},back(){if(!detailHost.isOpen)return false;if(related){cancel();related=null;renderDetail();detailHost.body.scrollTop=relatedTop;return true;}close();return true;},dispose(){disposed=true;close(false);cancel();stop();}};
}
