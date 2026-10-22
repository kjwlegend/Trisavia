import {icon} from '../icons.js';
import {avatar} from '../../scene.js';
import {readPhase} from '../world-read-provider.js';
import {el,button,focusNode,selectedAgent} from './shared.js';

const keyOf=record=>JSON.stringify([record?.ref?.moduleId,record?.ref?.type,record?.ref?.id]);
const same=(a,b)=>keyOf(a)===keyOf(b)&&a?.version===b?.version;
const titleOf=record=>record?.summary?.title||'内容详情';
const contentTitle=detail=>typeof detail?.content?.title==='string'&&detail.content.title.trim()?detail.content.title:'';
export function projectSavedInventorySelection(view,source,records){
  const chosen=records.find(record=>keyOf(record)===view.selected)||null;
  if(chosen)return{chosen,pending:false};
  if(view.selected&&!source.complete&&!source.records.some(record=>keyOf(record)===view.selected))return{chosen:null,pending:true};
  const fallback=records[0]||null;if(view.selected){view.top=0;view.detailTop=0;}view.selected=fallback?keyOf(fallback):'';return{chosen:fallback,pending:false};
}
export function inventoryNavigationFields(view={}){return{category:['all','work','prop'].includes(view.category)?view.category:'all',selected:typeof view.selected==='string'&&view.selected.length<=600?view.selected:'',top:Number.isFinite(view.top)&&view.top>=0?view.top:0,detailTop:Number.isFinite(view.detailTop)&&view.detailTop>=0?view.detailTop:0};}
export function readSavedInventoryNavigation(raw){try{return inventoryNavigationFields(JSON.parse(raw||'null')||{});}catch{return inventoryNavigationFields();}}
export function readSavedMailNavigation(raw){
  const categories=['messages','notifications','announcements','events'];
  if(categories.includes(raw))return{category:raw,views:{}};
  try{const value=JSON.parse(raw||'null');return{category:categories.includes(value?.category)?value.category:'messages',views:value?.views&&typeof value.views==='object'&&!Array.isArray(value.views)?value.views:{}};}catch{return{category:'messages',views:{}};}
}
const relatedKind=ref=>ref?.type==='items.item@1'?'物品':ref?.type==='world.announcement@1'?'公告':'事件';
function senderText(value,detail=false){const sender=value?.summary?.sender||value?.content?.sender;if(typeof sender?.displayName!=='string'||!sender.displayName.trim())return '发件人不可显示';const kind=sender.kind==='agent'?'Agent':sender.kind==='human'?'人类':'';return detail?`发件人：${sender.displayName}${kind?'（'+kind+'）':''}`:`来自：${sender.displayName}${kind?' · '+kind:''}`;}
function messageTime(value){const content=value?.summary||value?.content||{};const sent=time(content.sentAt),received=time(content.receivedAt);return sent?`发送于 ${sent}`:received?`接收于 ${received}`:'消息时间未提供';}
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
function agentBar(state,chooseAgent){const bar=el('div','pixel-agent-bar'),agent=selectedAgent(state),picture=el('div','pixel-agent-picture');if(agent)avatar(picture,{avatar:agent.avatar},agent.agentId);else picture.append(icon('profile'));bar.append(picture,el('strong','',agent?.name||'尚未选择 Agent'),button(state.authenticated?'切换 Agent':'登录账号',chooseAgent));return bar;}
function tabs(options,current,select){const bar=el('div','hud-filters');for(const [key,label]of options){const control=button(label,()=>select(key));control.dataset.platformTab=key;control.setAttribute('aria-pressed',String(key===current));bar.append(control);}return bar;}
const emptyText={holdings:'这个 Agent 暂无持有物品。',items:'当前没有可查看的物品。',messages:'这个 Agent 暂无消息。',notifications:'这个 Agent 暂无通知。',announcements:'当前没有可查看的公告。',events:'当前没有可查看的事件。'};
function feedback(state,key,retry,chooseAgent){
  const box=el('div','hud-feedback');box.setAttribute('role','status');
  let message=['idle','pending'].includes(state.phase)?'正在确认可查看的内容……':state.phase==='loading'?'正在载入内容……':state.phase==='no_agent'?'请选择要查看的 Agent。':state.phase==='session'?'登录状态已失效或尚未登录，请登录后查看。':state.phase==='denied'?'当前账号无权查看这类内容。':state.phase==='resync'?'内容已变化，请重新载入当前列表。':state.phase==='not_enabled'?key==='holdings'?'主人查看背包的入口尚未开放。':key==='messages'?'消息读取暂未开放。':key==='notifications'?'主人查看这类通知的入口尚未开放。':key==='events'?'事件读取暂未开放。':'这类内容的读取暂未开放。':state.phase==='unavailable'?'内容来源暂不可用，请稍后重试。':state.phase==='partial'?'后续内容暂时无法载入。已显示部分内容，尚未全部载入。':state.phase==='ready'&&state.complete?emptyText[key]:'暂时无法载入，请稍后重试。';
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

export function createPlatformInventory(provider,{session,context,walletProvider,chooseAgent=()=>{}}={}){
  const node=el('section','hud-inventory hud-platform-content'),results=el('div','hud-inventory-grid-scroll'),details=el('section','hud-item-detail');results.id='hud-platform-item-results';details.id='hud-platform-item-detail';
  const key='holdings';let state=session.snapshot(),active=false,disposed=false,selected=null,detail=null,detailError=null,detailRequest=null,detailRevision=0,preview=false,pendingRestore=false;
  const views={holdings:{selected:'',top:0,detailTop:0,query:'',category:'all'}};
  let inventoryScope='';
  function inventoryStorageKey(){const scope=context?.snapshot().scope,identity=session.hudContext?.();return scope?.kind==='owner'&&identity?.kind==='owner'&&scope.ownerId===identity.ownerId&&scope.agentId===identity.agentId?`connet.hud.platform.inventory-view.v1:${JSON.stringify([scope.origin,scope.instanceId,scope.ownerId,scope.agentId])}`:'';}
  function saveInventory(){const scope=inventoryStorageKey();if(!scope)return;inventoryScope=scope;try{sessionStorage.setItem(scope,JSON.stringify(inventoryNavigationFields(views.holdings)));}catch{/* Navigation can stay in memory without storing source content. */}}
  function restoreInventory(force=false){const scope=inventoryStorageKey();if(!scope){inventoryScope='';return;}if(!force&&scope===inventoryScope)return;inventoryScope=scope;const view=views.holdings;Object.assign(view,{query:'',...inventoryNavigationFields()});try{Object.assign(view,readSavedInventoryNavigation(sessionStorage.getItem(scope)));}catch{/* Search text is never restored from navigation. */}}
  results.addEventListener('scroll',()=>{if(!pendingRestore&&node.getClientRects().length){views[key].top=results.scrollTop;saveInventory();}},{passive:true});
  details.addEventListener('scroll',()=>{if(detail&&node.getClientRects().length){views[key].detailTop=details.scrollTop;saveInventory();}},{passive:true});
  function remember(){if(!pendingRestore){views[key].top=results.scrollTop;views[key].detailTop=details.scrollTop;}saveInventory();}
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
    const top=details.scrollTop;details.replaceChildren();details.append(el('h3','','物品详情'));if(!selected){details.append(el('p','hud-muted','这里会显示所选物品的详情。'));return;}
    details.append(icon(selected.summary.itemKind==='work'?'document':'inventory'),el('h3','',titleOf(selected)),el('p','hud-muted',selected.summary.itemKind==='work'?'作品':selected.summary.itemKind==='prop'?'虚拟道具':'物品类型暂不可用'));
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
    else if(detail.item)details.append(button('查看内容',()=>{views[key].detailTop=details.scrollTop;preview=true;renderDetail();details.scrollTop=0;}));
    details.scrollTop=top||views[key].detailTop;
  }
  function renderResults(){
    const source=provider.snapshot(key),view=views[key];results.replaceChildren();if(!state.authenticated||!selectedAgent(state)){clear();results.append(feedback({...source,phase:state.authenticated?'no_agent':'session'},key,()=>provider.load(key),chooseAgent));return;}
    const records=source.records.filter(record=>titleOf(record).includes(view.query)&&(view.category==='all'||record.summary.itemKind===view.category));
    const previousSelection=view.selected,{chosen,pending}=projectSavedInventorySelection(view,source,records);pendingRestore=pending;if(previousSelection!==view.selected)saveInventory();
    if(!source.records.length){clear();renderDetail();results.append(feedback(source,key,()=>provider.load(key),chooseAgent));return;}
    if(!records.length){clear();renderDetail();results.append(el('p','hud-feedback',source.complete?'没有符合条件的内容。':'当前已载入内容中没有符合条件的物品。'),button('清除筛选',()=>{view.query='';view.category='all';view.selected='';saveInventory();render();}),pageFoot(source,key,provider));return;}
    const grid=el('div','hud-items');grid.setAttribute('aria-label','获准持有记录');
    for(const record of records){const control=button('',()=>{remember();pendingRestore=false;view.top=results.scrollTop;view.selected=keyOf(record);view.detailTop=0;saveInventory();renderResults();focusNode([...results.querySelectorAll('button')].find(value=>value.dataset.platformItem===record.ref.id));});control.dataset.platformItem=record.ref.id;control.setAttribute('aria-label',titleOf(record));control.setAttribute('aria-pressed',String(same(record,chosen)));const slot=el('span','hud-item-slot');slot.append(icon(record.summary.itemKind==='work'?'document':'inventory'));control.append(slot,el('span','hud-item-name',titleOf(record)),badge(record,key==='holdings'),el('span','hud-item-full-name',titleOf(record)));grid.append(control);}
    results.append(grid,pageFoot(source,key,provider));results.scrollTop=view.top;
    if(pending){clear();details.append(el('p','hud-muted','先前选择的物品尚未载入。可继续载入以恢复。'));return;}
    if(!same(selected,chosen)){if(active&&chosen)void read(chosen);else details.replaceChildren();}else renderDetail();
  }
  function render(){
    if(disposed)return;node.replaceChildren();const view=views[key],agent=selectedAgent(state);
    const info=agentBar(state,chooseAgent);info.classList.add('hud-inventory-context');info.append(walletStatus());node.append(info);
    const columns=el('div','hud-inventory-layout'),browser=el('div','hud-inventory-browser'),filters=tabs([['all','全部'],['work','作品'],['prop','虚拟道具']],view.category,next=>{remember();view.category=next;view.top=0;view.selected='';view.detailTop=0;saveInventory();render();}),label=el('label','hud-search','搜索当前已载入物品'),search=el('input');search.type='search';search.value=view.query;search.maxLength=100;search.id='hud-platform-item-search';search.addEventListener('input',()=>{remember();view.query=search.value;view.top=0;view.selected='';view.detailTop=0;saveInventory();renderResults();});label.append(search);browser.append(filters,label,results);columns.append(browser,details);node.append(columns);renderResults();const source=provider.snapshot(key),merged=!state.authenticated||!agent||['session','no_agent'].includes(source.phase);columns.classList.toggle('is-single-state',merged);filters.hidden=label.hidden=details.hidden=merged;if(['pending','loading','idle'].includes(source.phase)&&!source.records.length&&!merged){details.replaceChildren(el('h3','','物品详情'),el('p','hud-muted','正在读取物品信息…'));}
  }
  function walletStatus(){
    const value=walletProvider.snapshot(),status=el('div','hud-wallet-status');status.id='hud-wallet-status';status.dataset.phase=value.phase;status.setAttribute('role','status');
    const label=value.phase==='ready'?`${value.data.currency.displayName} ${value.data.balance}`:value.phase==='loading'?'星币 · 正在读取…':value.phase==='denied'?'当前账号无权查看余额。':value.phase==='not_enabled'?'余额查看暂未开放。':value.phase==='no_agent'?'星币 · 请选择 Agent':value.phase==='session'?'星币 · 请登录后查看':value.phase==='not_initialized'||value.phase==='idle'?'星币 · 暂未取得余额':'星币 · 暂时无法读取';status.append(el('span','',label));
    if(['error','unavailable','not_initialized','idle','resync'].includes(value.phase))status.append(button('重试',()=>walletProvider.load(),'hud-wallet-retry'));return status;
  }
  const stop=provider.subscribe(changed=>{const source=provider.snapshot(changed);if(views[changed]&&['denied','session','resync'].includes(source.phase)){Object.assign(views[changed],{selected:'',top:0,detailTop:0,query:'',category:'all'});saveInventory();}if(changed!==key)return;if(!source.records.length)clear();render();});
  const stopWallet=walletProvider.subscribe(()=>render()),stopNavigation=context?.subscribe(()=>{restoreInventory();render();});restoreInventory();render();
  return{node,activate(){active=true;restoreInventory();void provider.load(key);void walletProvider.load();},deactivate(){remember();active=false;provider.cancel(key);walletProvider.cancel();cancel();if(!detail)selected=null;},setContext(next){if(state.observationRevision!==next.observationRevision){clear();for(const view of Object.values(views))Object.assign(view,{selected:'',top:0,detailTop:0,query:'',category:'all'});restoreInventory(true);}state=next;render();},back(){if(!preview)return false;preview=false;renderDetail();return true;},dispose(){disposed=true;cancel();stop();stopWallet();stopNavigation?.();}};
}

export function createPlatformMail(provider,{session,context,detailHost,chooseAgent=()=>{}}={}){
  const node=el('section','hud-mail hud-platform-content'),list=el('div','hud-mail-list');list.id='hud-platform-mail-results';
  let key='messages',state=session.snapshot(),active=false,disposed=false,opened=null,detail=null,detailError=null,request=null,generation=0,related=null,relatedDetail=null,relatedError=null,relatedTop=0,readerTop=0;
  const views=Object.fromEntries(['messages','notifications','announcements','events'].map(key=>[key,{top:0,selected:'',bodyTop:{}}]));
  const currentSource=()=>provider.snapshot(key)||{phase:'idle',records:[],complete:false,nextPageToken:null};
  const detailTitle=()=>key==='messages'?'消息详情':key==='events'?'事件详情':key==='announcements'?'公告详情':'通知详情';
  let categoryScope='';
  function categoryStorageKey(){const scope=context?.snapshot().scope,identity=session.hudContext?.();return scope?.kind==='owner'&&identity?.kind==='owner'&&scope.ownerId===identity.ownerId&&scope.agentId===identity.agentId?`connet.hud.platform.mail-category.v1:${JSON.stringify([scope.origin,scope.instanceId,scope.ownerId,scope.agentId])}`:'';}
  function restoreCategory(force=false){const scope=categoryStorageKey();if(!scope){categoryScope='';return;}if(!force&&scope===categoryScope)return;categoryScope=scope;key='messages';for(const view of Object.values(views))Object.assign(view,{top:0,selected:'',bodyTop:{}});try{const saved=readSavedMailNavigation(sessionStorage.getItem(scope));key=saved.category;for(const [name,view]of Object.entries(views)){const value=saved.views[name];if(!value)continue;if(Number.isFinite(value.top)&&value.top>=0)view.top=value.top;if(typeof value.selected==='string'&&value.selected.length<=600)view.selected=value.selected;if(value.bodyTop&&typeof value.bodyTop==='object'&&!Array.isArray(value.bodyTop))view.bodyTop=Object.fromEntries(Object.entries(value.bodyTop).slice(-100).filter(([ref,top])=>ref.length<=600&&Number.isFinite(top)&&top>=0));}}catch{/* A missing or unavailable preference starts at messages. */}}
  function saveCategory(){const scope=categoryStorageKey();if(!scope)return;categoryScope=scope;try{const positions=Object.fromEntries(Object.entries(views).map(([name,view])=>[name,{...view,bodyTop:Object.fromEntries(Object.entries(view.bodyTop).slice(-100))}]));sessionStorage.setItem(scope,JSON.stringify({category:key,views:positions}));}catch{/* No private source content is stored for navigation. */}}
  list.addEventListener('scroll',()=>{if(!detailHost.isOpen&&node.getClientRects().length){views[key].top=list.scrollTop;saveCategory();}},{passive:true});
  function remember(){if(node.getClientRects().length){views[key].top=list.scrollTop;saveCategory();}}
  function cancel(){generation++;request?.abort();request=null;}
  function close(restore=true){detailHost.close(restore);}
  function focusRow(){if(active)focusNode([...list.querySelectorAll('[data-platform-message]')].find(control=>control.dataset.platformMessage===opened?.ref.id)||node.querySelector('h3'));}
  function associations(){const publication=detail?.content?.publication;return Array.isArray(publication?.relatedItems)?publication.relatedItems:(publication?.publishedRefs||[]).map(ref=>({ref,title:''}));}
  async function readRelated(ref){
    const parent=opened,g=++generation;request?.abort();request=new AbortController();if(!related)relatedTop=detailHost.body.scrollTop;related=ref;relatedDetail=null;relatedError=null;renderDetail();detailHost.body.scrollTop=0;
    const relatedKey=ref.type==='items.item@1'?'items':ref.type==='world.announcement@1'?'announcements':['world.plan@1','world.occurrence@1'].includes(ref.type)?'events':null;
    if(!relatedKey){relatedError={code:'target_not_accessible'};renderDetail();return;}
    try{const result=await provider.detail(relatedKey,{ref},{signal:request.signal});if(g!==generation||opened!==parent)return;relatedDetail=result;renderDetail();}catch(error){if(g!==generation||error.name==='AbortError')return;relatedError=error;if(['denied','session'].includes(readPhase(error))&&detail?.content?.publication){const publication=detail.content.publication;for(const field of ['relatedItems','publishedRefs'])if(Array.isArray(publication[field]))publication[field]=publication[field].filter(value=>keyOf({ref:field==='relatedItems'?value.ref:value})!==keyOf({ref}));}renderDetail();}
  }
  function reader(){
    const body=el('section','hud-mail-reader');
    if(related){const kind=relatedKind(related);if(relatedDetail){body.append(el('p','hud-muted',kind),contentBody(null,relatedDetail));}else if(relatedError)body.append(detailFeedback(relatedError,()=>readRelated(related)));else body.append(el('p','hud-feedback',`正在载入关联${kind}…`));return body;}
    body.append(badge(opened));
    if(key==='messages'){const sender=el('p','hud-muted',senderText(detail||opened,true));sender.dataset.senderName='';body.append(sender,el('p','hud-muted',`收件对象：${selectedAgent(state)?.name||'当前 Agent'}`),el('p','hud-muted',messageTime(detail||opened)));}
    if(opened?.detailAvailable===false){body.append(el('p','hud-muted','当前仅可查看摘要。'));return body;}
    if(detailError){body.append(detailFeedback(detailError,()=>read(opened)));return body;}
    if(!detail){body.append(el('p','hud-feedback','正在读取完整内容……'));return body;}
    body.append(contentBody(opened,detail));
    const refs=associations().filter(entry=>['items.item@1','world.announcement@1','world.plan@1','world.occurrence@1'].includes(entry.ref?.type));
    if(refs.length){const links=el('section','hud-related-content');links.append(el('h3','','关联内容'));refs.forEach(entry=>{const kind=relatedKind(entry.ref),name=typeof entry.title==='string'&&entry.title.trim()?entry.title:'';links.append(button(name?`查看关联${kind}：${name}`:`关联${kind}（名称暂不可用）`,()=>readRelated(entry.ref)));});body.append(links);}
    return body;
  }
  function renderDetail(){if(!opened||!detailHost.isOpen)return;detailHost.setBack?.(related?'返回原内容':'返回信箱',related?()=>{cancel();related=null;relatedDetail=null;relatedError=null;renderDetail();detailHost.body.scrollTop=relatedTop;}:null);const top=detailHost.body.scrollTop;detailHost.update(related?contentTitle(relatedDetail)||'关联内容':titleOf(opened),reader());detailHost.body.scrollTop=!related&&detail&&readerTop?readerTop:top;if(!related&&detail)readerTop=0;}
  async function read(record){
    cancel();const g=generation;detail=null;detailError=null;related=null;request=new AbortController();renderDetail();
    if(record.detailAvailable===false)return;
    try{const result=await provider.detail(key,record,{signal:request.signal});if(g!==generation||disposed||opened!==record)return;detail=result;renderDetail();}
    catch(error){if(g!==generation||disposed||error.name==='AbortError')return;detailError=error;renderDetail();}
  }
  function open(record){remember();opened=record;views[key].selected=keyOf(record);readerTop=views[key].bodyTop[keyOf(record)]||0;saveCategory();detail=null;detailError=null;related=null;detailHost.open(titleOf(opened),reader(),restore=>{if(detail&&currentSource().records.some(value=>keyOf(value)===keyOf(record)))views[key].bodyTop[keyOf(record)]=related?relatedTop:detailHost.body.scrollTop;saveCategory();cancel();if(restore)focusRow();opened=null;detail=null;related=null;list.scrollTop=views[key].top;});void read(record);}
  function select(next){remember();close(false);provider.cancel(key);key=next;saveCategory();render();if(active)void provider.load(key);}
  function render(){
    if(disposed)return;node.replaceChildren();const agent=selectedAgent(state),source=currentSource();
    node.append(agentBar(state,chooseAgent));
    node.append(tabs([['messages','消息'],['notifications','通知'],['announcements','公告'],['events','事件']],key,select));
    node.append(el('p','hud-muted',['messages','notifications'].includes(key)?state.authenticated?`阅读者：你 · 收件对象：${agent?.name||'请选择 Agent'}`:'请登录后查看 Agent 的消息':'公开内容 · 不代表私人来信'),el('p','hud-muted','当前可查看内容'));
    const heading=el('h3','hud-list-heading',key==='messages'?'收到的消息':key==='notifications'?'获准通知':key==='events'?'事件计划与发生记录':'公开公告');heading.tabIndex=-1;node.append(heading);list.replaceChildren();
    for(const record of source.records){const row=el('div','hud-message-row hud-platform-message-row'),control=button('',()=>open(record),'hud-message-open');control.dataset.platformMessage=record.ref.id;control.setAttribute('aria-pressed',String(keyOf(record)===views[key].selected));const text=el('span','hud-message-summary'),byline=el('span','hud-muted',key==='messages'?senderText(record):sourceText(record));if(key==='messages'){byline.dataset.senderName='';byline.title=byline.textContent;}text.append(el('strong','',`${key==='events'?eventLabel(record)+' · ':''}${titleOf(record)}`),byline);control.append(icon(key==='events'?'clock':key==='messages'?'mail':'notice'),text);const meta=el('span','hud-message-byline');byline.replaceWith(meta);meta.append(byline,badge(record));row.append(control);const published=time(record.summary.source?.publishedAt);control.append(el('time','',key==='messages'?messageTime(record):key==='events'?eventTime(record):published?`发布于 ${published}`:'发布时间未提供'));list.append(row);}
    if(!source.records.length)list.append(feedback(source,key,()=>provider.load(key),chooseAgent));else list.append(pageFoot(source,key,provider));node.append(list);list.scrollTop=views[key].top;
  }
  const stop=provider.subscribe(changed=>{const source=provider.snapshot(changed);if(views[changed]&&['denied','session','resync'].includes(source.phase)){Object.assign(views[changed],{top:0,selected:'',bodyTop:{}});saveCategory();}if(changed!==key)return;if(!source.records.length){close(false);cancel();opened=null;detail=null;detailHost.clear();}render();}),stopCategory=context?.subscribe(()=>{restoreCategory();render();});restoreCategory();render();
  return{node,activate(){active=true;restoreCategory();void provider.load(key);},deactivate(){remember();active=false;close(false);provider.cancel(key);cancel();},setContext(next){if(state.observationRevision!==next.observationRevision){close(false);cancel();opened=null;detail=null;detailHost.clear();for(const view of Object.values(views))Object.assign(view,{top:0,selected:'',bodyTop:{}});restoreCategory(true);}state=next;render();},showWorld(category){select(category==='events'?'events':'announcements');},back(){if(!detailHost.isOpen)return false;if(related){cancel();related=null;renderDetail();detailHost.body.scrollTop=relatedTop;return true;}close();return true;},dispose(){disposed=true;close(false);cancel();stop();stopCategory?.();}};
}
