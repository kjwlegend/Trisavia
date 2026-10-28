import {msg,t,bindAttribute,getLocale} from '../../i18n/core.js';
import {bindOfficialFields} from '../official-content.js';
import {icon} from '../icons.js';
import {avatar} from '../../scene.js';
import {createOwnerExchanges} from './owner-interactions.js';
import {readPhase} from '../world-read-provider.js';
import {el,button,focusNode,selectedAgent} from './shared.js';
import {lifeItemFromRef,lifeItemImage} from '../life-item-art.js';
import {readLifeItems} from '../life-items-reader.js';

const keyOf=record=>JSON.stringify([record?.ref?.moduleId,record?.ref?.type,record?.ref?.id]);
const same=(a,b)=>keyOf(a)===keyOf(b)&&a?.version===b?.version;
const titleOf=record=>record?.summary?.title||t('public:content.details');
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
const dataLabel=(record,holding=false)=>msg(['town_service_definition','npc_service_item'].includes(record?.summary?.source?.kind||record?.content?.source?.kind)?holding?'public:content.badge.held':'public:content.badge.voucher':record?.summary?.dataMode==='demo'||record?.content?.dataMode==='demo'?holding?'public:content.badge.demoHeld':'public:content.badge.demo':record?.summary?.source?.kind==='administrative_publication'||record?.content?.source?.kind==='administrative_publication'?'public:content.badge.published':'public:content.badge.platform');
const time=value=>typeof value==='number'&&Number.isFinite(value)?new Date(value).toLocaleString(getLocale(),{hour12:false}):'';
function sourceText(value,{prefix=true}={}){
 const source=value?.summary?.source||value?.content?.source,key=['life_item_definition','life_item_balance'].includes(source?.kind)?'public:content.source.life':['town_service_definition','npc_service_item'].includes(source?.kind)?'public:content.source.town':source?.kind==='demo_seed'?'public:content.source.demo':source?.kind==='demo_holding'?'public:content.source.demoHolding':source?.kind==='administrative_publication'?'public:content.source.publication':'public:content.source.unknown',params={administrator:typeof source?.administrator==='string'?' · '+source.administrator:''};
 return prefix?msg('public:content.sourceLabel',()=>({source:t(key,params)})):msg(key,params);
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
function agentBar(state,chooseAgent){const bar=el('div','hud-platform-agent'),agent=selectedAgent(state),picture=el('div','hud-platform-agent-picture');if(agent)avatar(picture,{avatar:agent.avatar},agent.agentId);else picture.append(icon('profile'));bar.append(picture,el('strong','',agent?.name||msg('public:content.agent.none')),button(msg(state.authenticated?'public:content.agent.change':'shell:nav.login'),chooseAgent));return bar;}
function tabs(options,current,select){const bar=el('div','hud-filters');for(const [key,label]of options){const control=button(label,()=>select(key));control.dataset.platformTab=key;control.setAttribute('aria-pressed',String(key===current));bar.append(control);}return bar;}
const emptyText={holdings:'背包里还没有物品。',items:'当前没有可查看的物品。',messages:'还没有收到消息。',notifications:'暂无通知。',announcements:'暂无公告。',events:'暂无事件记录。'};
function accessState(state,kind,chooseAgent){
 if(state.authenticated&&selectedAgent(state))return null;
 const box=el('section','hud-access-state'),expired=state.phase==='expired',kindKey=kind==='背包'?'shell:hud.inventory':'shell:hud.mail';box.append(icon(kind==='背包'?'inventory':'mail'),el('h3','',msg(state.authenticated?'public:content.chooseAgent':expired?'public:content.loginExpiredTitle':'public:content.loginTitle')),el('p','hud-muted',state.authenticated?msg('public:content.chooseToRead',()=>({kind:t(kindKey)})):expired?msg('public:content.loginExpired'):msg('public:content.loginToRead',()=>({kind:t(kindKey)}))),button(msg(state.authenticated?'shell:agent.choose':expired?'shell:nav.login':'shell:nav.account'),chooseAgent));return box;
}
function feedback(state,key,retry,chooseAgent){
 const box=el('div','hud-feedback');box.setAttribute('role','status');
 const message=['idle','pending'].includes(state.phase)?'public:content.confirming':state.phase==='loading'?'public:content.loading':state.phase==='no_agent'?'public:content.noAgent':state.phase==='session'?'public:content.session':state.phase==='denied'?'public:content.denied':state.phase==='resync'?'public:content.resync':state.phase==='not_enabled'?['holdings','messages','notifications','events'].includes(key)?'public:content.notEnabled.'+key:'public:content.notEnabled':state.phase==='unavailable'?'public:content.readUnavailable':state.phase==='partial'?'public:content.partial':state.phase==='ready'&&state.complete?'public:content.empty.'+key:'common:error.readUnavailable';
 box.append(el('p','',msg(message)));
 if(state.phase==='no_agent'||state.phase==='session')box.append(button(msg(state.phase==='no_agent'?'shell:agent.choose':'shell:nav.login'),chooseAgent));
 else if(['error','unavailable','partial','resync'].includes(state.phase))box.append(button(msg(state.phase==='resync'?'common:action.reload':'common:action.retry'),retry));return box;
}
function pageFoot(state,key,provider){const node=el('div','hud-page-state');node.setAttribute('role','status');if(state.phase==='loading')node.append(el('p','hud-muted',msg('public:content.continueLoading')));else if(state.phase==='partial')node.append(feedback(state,key,()=>provider.load(key,{more:Boolean(state.nextPageToken)}),()=>{}));else if(state.phase==='ready'){node.append(el('p','hud-muted',msg(state.complete?'public:content.loadedComplete':'public:content.loadedPartial',{count:state.records.length})));if(!state.complete)node.append(button(msg('common:action.showMore'),()=>provider.load(key,{more:true})));}return node;}
function bindDefinition(detail,nodes,note){
 const content=detail?.content,ref=detail?.ref;if(detail?.contentComplete!==true||ref?.moduleId!=='items'||ref.type!=='items.item@1')return()=>{};
 if(content.source?.kind==='life_item_definition'&&ref.id.startsWith('life.'))return bindOfficialFields(nodes,'life-content',{id:ref.id,ref:ref.id,version:detail.version,selector:{projection:'detail'},values:{title:content.title,body:content.text}},{note});
 if(content.source?.kind==='town_service_definition'&&['town-inn-voucher','town-tavern-voucher','town-resident-card'].includes(ref.id)){const fields={...nodes};if(fields.body){fields.text=fields.body;delete fields.body;}return bindOfficialFields(fields,'life-content',{id:ref.id,ref:ref.id,version:detail.version,values:{title:content.title,text:content.text}},{note});}
 return()=>{};
}
export function contentBody(record,detail,{badges=true,onOfficialBinding=null,titleNode=null}={}){
  const body=el('section','hud-platform-body');if(badges)body.append(badge(detail,record?.ref?.type==='inventory.holding@1'));body.append(el('p','hud-muted',sourceText(detail)));
  const published=time(detail?.content?.source?.publishedAt);if(published)body.append(el('p','hud-muted',msg('public:content.publishedAt',()=>({time:time(detail?.content?.source?.publishedAt)}))));
  if(record?.summary?.eventKind){body.append(el('p','hud-muted',eventLabel(record)),el('p','hud-muted',eventTime(record,detail)));const status=statusText(record);if(status)body.append(el('p','hud-muted',status));}
  const paragraph=el('p','hud-message-body',detail.content.text);body.append(paragraph);if(onOfficialBinding){const note=el('p','hud-muted');note.hidden=true;body.append(note);onOfficialBinding(bindDefinition(detail,{body:paragraph,...(titleNode?{title:titleNode}:{})},note));}
  if(Array.isArray(detail.attachments)&&detail.attachments.length){const note=el('section');note.append(el('h3','',msg('public:content.attachments')));for(const attachment of detail.attachments){if(typeof attachment?.name==='string'||typeof attachment?.description==='string')note.append(el('p','',`${attachment.name||'附件'}${attachment.description?' · '+attachment.description:''}`));}body.append(note);}
  return body;
}
export function detailFeedback(error,retry){const box=el('section');const phase=readPhase(error);box.append(el('p','hud-feedback',msg(phase==='session'?'public:content.detailSession':['denied','not_enabled'].includes(phase)?'public:content.detailDenied':'public:content.detailUnavailable')));if(!['session','denied','not_enabled'].includes(phase))box.append(button(msg('common:action.retry'),retry));return box;}

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

function inventoryIcon(record){
  const lifeItem=lifeItemFromRef(record?.summary?.itemRef);if(lifeItem)return lifeItemImage(lifeItem);
  const id=record?.summary?.itemRef?.id;
  if(!['town-tavern-voucher','town-inn-voucher'].includes(id))return icon(record?.summary?.itemKind==='work'?'document':'inventory');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 40 40');svg.setAttribute('aria-hidden','true');svg.classList.add('paper-voucher-icon');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M5 11h30v6a3 3 0 0 0 0 6v6H5v-6a3 3 0 0 0 0-6z');path.setAttribute('fill',id==='town-tavern-voucher'?'#f2c69c':'#c2d9e8');path.setAttribute('stroke','#536451');path.setAttribute('stroke-width','1.5');
  const marks=document.createElementNS(svg.namespaceURI,'path');marks.setAttribute('d','M12 12v3m0 3v4m0 3v3m9-12h7v8h-7z');marks.setAttribute('fill','none');marks.setAttribute('stroke','#536451');marks.setAttribute('stroke-width','1.5');svg.append(path,marks);return svg;
}
export function createPlatformInventory(provider,{session,context,walletProvider,detailHost,chooseAgent=()=>{}}={}){
  const node=el('section','hud-inventory hud-platform-content'),results=el('div','hud-inventory-grid-scroll'),details=el('section','hud-item-detail');results.id='hud-platform-item-results';details.id='hud-platform-item-detail';bindAttribute(details,'aria-label','public:inventory.details');
  const key='holdings';let state=session.snapshot(),active=false,disposed=false,selected=null,detail=null,detailError=null,detailRequest=null,detailRevision=0,preview=false,refreshInventory=false,pendingRestore=false,fillFrame=0,stopItemContent=()=>{},stopPreviewContent=()=>{};
  const views={holdings:{selected:'',top:0,detailTop:0,query:'',category:'all'}};let inventoryScope='';
  function inventoryStorageKey(){const scope=context?.snapshot().scope,identity=session.hudContext?.();return scope?.kind==='owner'&&identity?.kind==='owner'&&scope.ownerId===identity.ownerId&&scope.agentId===identity.agentId?`connet.hud.platform.inventory-view.v1:${JSON.stringify([scope.origin,scope.instanceId,scope.ownerId,scope.agentId])}`:'';}
  function saveInventory(){const scope=inventoryStorageKey();if(!scope)return;inventoryScope=scope;try{sessionStorage.setItem(scope,JSON.stringify(inventoryNavigationFields(views.holdings)));}catch{/* Navigation can remain in memory; never persist source content. */}}
  function restoreInventory(force=false){const scope=inventoryStorageKey();if(!scope){inventoryScope='';return;}if(!force&&scope===inventoryScope)return;inventoryScope=scope;Object.assign(views.holdings,{query:'',...inventoryNavigationFields()});try{Object.assign(views.holdings,readSavedInventoryNavigation(sessionStorage.getItem(scope)),{category:'all'});}catch{/* Search text is not restored from navigation. */}}
  function remember(){if(!pendingRestore){views.holdings.top=results.scrollTop;views.holdings.detailTop=details.scrollTop;}saveInventory();}
  results.addEventListener('scroll',()=>{if(!pendingRestore&&node.getClientRects().length){views.holdings.top=results.scrollTop;saveInventory();}fillViewport();},{passive:true});
  details.addEventListener('scroll',()=>{if(detail&&node.getClientRects().length){views.holdings.detailTop=details.scrollTop;saveInventory();}},{passive:true});
  function cancel(){detailRevision++;detailRequest?.abort();detailRequest=null;}
  function closePreview(){stopPreviewContent();stopPreviewContent=()=>{};if(preview){preview=false;detailHost?.close(false);if(detailHost?.node)delete detailHost.node.dataset.inventoryContent;}}
  function clear(){stopItemContent();cancel();closePreview();refreshInventory=false;selected=null;detail=null;detailError=null;details.replaceChildren();}
  async function read(record){
    clear();selected=record;const generation=detailRevision,request=new AbortController();detailRequest=request;renderDetail();
    try{
      const own=record.detailAvailable===false?null:await provider.detail(key,record,{signal:request.signal});if(generation!==detailRevision||disposed)return;
      if(!own){detail={summaryOnly:true};renderDetail();return;}
      const loaded={own};detail=loaded;
      if(own.content.itemRef){try{const item=await provider.detail('items',{ref:own.content.itemRef},{signal:request.signal});if(generation!==detailRevision||disposed)return;loaded.item=item;}catch(error){if(generation!==detailRevision||disposed||error.name==='AbortError')return;loaded.itemError=error;}}
      const lifeItem=lifeItemFromRef(own.content.itemRef);if(lifeItem){try{const target=selectedAgent(state)?.agentId,raw=await session.readLife('items',{itemIds:[lifeItem],limit:100},{signal:request.signal});if(generation!==detailRevision||disposed||request.signal.aborted)return;loaded.life=readLifeItems(raw,target,[lifeItem]).data;}catch(error){if(generation!==detailRevision||disposed||error.name==='AbortError')return;loaded.lifeError=error;}}
      if(generation===detailRevision&&!disposed)renderDetail();
    }catch(error){if(generation!==detailRevision||disposed||error.name==='AbortError')return;detailError=error;detail=null;renderDetail();}
  }
  async function openContent(){
    if(!selected||!detail?.own||!detailHost)return;
    stopPreviewContent();stopPreviewContent=()=>{};const record=selected,generation=detailRevision,itemRef=detail.item?(detail.item.ref||detail.own.content.itemRef):null,readKey=itemRef?'items':key,target=itemRef?{ref:itemRef}:record;
    preview=true;detailHost.node.dataset.inventoryContent='';detailHost.open(titleOf(record),el('p','hud-feedback',msg('public:inventory.loadingContent')),restore=>{stopPreviewContent();stopPreviewContent=()=>{};preview=false;delete detailHost.node.dataset.inventoryContent;if(refreshInventory){refreshInventory=false;if(restore&&active&&generation===detailRevision)void provider.load(key);}else if(restore&&active)focusNode(details.querySelector('.paper-item-content'));});detailHost.setBack?.(msg('public:inventory.returnDetails'));
    try{const value=await provider.detail(readKey,target,{signal:detailRequest?.signal});if(generation!==detailRevision||disposed||!preview||selected!==record)return;detailHost.update(contentTitle(value)||titleOf(record),contentBody(record,value,{badges:false,onOfficialBinding:off=>{stopPreviewContent=off;},titleNode:detailHost.node.querySelector('#hud-detail-title')}));}
    // Item revocation also invalidates the cached holding projection; re-read the collection on return.
    catch(error){if(generation!==detailRevision||disposed||!preview||error.name==='AbortError')return;if(error.status===404||readPhase(error)==='denied'){refreshInventory=true;detail=null;detailError={code:'target_not_accessible'};renderResults();}detailHost.update(refreshInventory?msg('public:content.notViewable'):titleOf(record),detailFeedback(detailError||error,()=>void openContent()));}
  }
  function renderDetail(){
    const top=details.scrollTop;stopItemContent();details.replaceChildren();if(!selected){details.append(el('h3','',msg('public:inventory.details')),el('p','hud-muted',msg('public:inventory.selectItem')));return;}
    const heading=el('div','paper-item-heading'),picture=el('span','paper-item-picture');picture.append(refreshInventory?icon('inventory'):inventoryIcon(selected));const itemTitle=el('h3','',refreshInventory?msg('public:inventory.holdingRecord'):titleOf(selected));heading.append(picture,itemTitle);details.append(heading);
    if(detailError){details.append(detailFeedback(detailError,()=>void read(selected)));return;}
    if(!detail){details.append(el('p','hud-feedback',msg('public:inventory.loadingContent')));return;}
    if(detail.summaryOnly){details.append(el('p','hud-muted',msg('public:inventory.summaryOnly')));return;}
    const content=detail.item?.content||detail.own.content,body=typeof content.text==='string'?content.text:'';
    if(body){const snippet=Array.from(body),description=el('p','paper-item-description',snippet.length>220?snippet.slice(0,220).join('')+'…':body),note=el('p','hud-muted');note.hidden=true;details.append(description,note);stopItemContent=bindDefinition(detail.item||detail.own,{title:itemTitle,body:description},note);}
    if(detail.itemError)details.append(el('p','hud-muted',msg('public:inventory.referenceUnavailable')));
    const quantity=detail.own.content.quantity??selected.summary.quantity,status=detail.own.content.status??selected.summary.status;
    const labels={available:'public:inventory.state.available',reserved:'public:inventory.state.reserved',consumed:'public:inventory.state.consumed',active:'public:inventory.state.active'};
    const facts=el('dl','paper-item-facts');for(const [label,value,className]of [['public:inventory.quantity',Number.isSafeInteger(quantity)&&quantity>=0?String(quantity):msg('public:inventory.notProvided'),''],['public:inventory.status',msg(labels[status]||'public:inventory.notProvided'),'paper-item-status'],['public:inventory.source',sourceText(detail.item||detail.own,{prefix:false}),'']])facts.append(el('dt','',msg(label)),el('dd',className,value));details.append(facts);
    if(detail.life){const source=detail.life,total=source.totals[0],live=el('section','life-item-instances');live.append(el('h4','',msg('public:inventory.actualAvailability')),el('p','',msg('public:inventory.counts',{available:total.available,reserved:total.reserved})),el('p','hud-muted',msg('public:inventory.instancesAsOf',()=>({time:time(source.asOf)}))));if(!source.complete)live.append(el('p','hud-muted',msg('public:inventory.instancesIncomplete')));for(const item of source.items){const row=el('details');row.append(el('summary','',msg(item.state==='available'?'public:inventory.instance.available':'public:inventory.instance.reserved',()=>({weight:item.fish?t('public:inventory.fishWeight',{grams:item.fish.weightGrams}):''}))),el('p','hud-muted',msg('public:inventory.obtainedAt',()=>({time:time(item.issuedAt)}))));if(item.fish)row.append(el('p','',msg('public:inventory.caughtAt',()=>({place:t(item.fish.spotId==='shore_spot'?'public:inventory.shore':'public:inventory.pier'),time:time(item.fish.caughtAt)}))));const audit=el('details');audit.append(el('summary','',msg('public:inventory.sourceRecord')),el('p','mono',item.sourceId),el('p','mono',item.id));row.append(audit);live.append(row);}details.append(live);}
    else if(detail.lifeError)details.append(el('p','hud-muted',msg('public:inventory.instancesUnavailable')),button(msg('public:inventory.retryInstances'),()=>void read(selected)));
    if(typeof detail.own.content.text==='string'&&detail.own.content.text&&detail.item)details.append(el('p','paper-item-holding-note',detail.own.content.text));
    if(detailHost){const link=button(msg(detail.item?'common:action.viewContent':'public:inventory.viewHolding'),()=>void openContent(),'paper-item-content');link.prepend(icon('document'));details.append(link);}
    details.scrollTop=top||views.holdings.detailTop;
  }
  function fillViewport(){
    if(fillFrame)return;fillFrame=requestAnimationFrame(()=>{fillFrame=0;if(!active||disposed||!node.getClientRects().length||views.holdings.query)return;const value=provider.snapshot(key);if(value.phase==='ready'&&!value.complete&&value.nextPageToken&&results.scrollTop+results.clientHeight>=results.scrollHeight-120)void provider.load(key,{more:true});});
  }
  function renderResults(){
    const source=provider.snapshot(key),view=views.holdings;results.replaceChildren();
    if(!state.authenticated||!selectedAgent(state)){clear();results.append(feedback({...source,phase:state.authenticated?'no_agent':'session'},key,()=>provider.load(key),chooseAgent));return;}
    if(refreshInventory){results.append(el('p','hud-feedback',msg('public:inventory.changed')));renderDetail();return;}
    const records=source.records.filter(record=>titleOf(record).toLocaleLowerCase().includes(view.query.trim().toLocaleLowerCase()));
    const previous=view.selected,{chosen,pending}=projectSavedInventorySelection(view,source,records);pendingRestore=pending;if(previous!==view.selected)saveInventory();
    if(!source.records.length){clear();renderDetail();results.append(feedback(source,key,()=>provider.load(key),chooseAgent));return;}
    if(!records.length){clear();renderDetail();results.append(el('p','hud-feedback',msg(source.complete?'public:inventory.noMatching':'public:inventory.noMatchingPartial')),button(msg('public:inventory.clearSearch'),()=>{view.query='';view.selected='';saveInventory();render();}));}
    else{
      const grid=el('div','hud-items');bindAttribute(grid,'aria-label','public:inventory.items');
      for(const record of records){const control=button('',()=>{remember();pendingRestore=false;view.top=results.scrollTop;view.selected=keyOf(record);view.detailTop=0;saveInventory();renderResults();focusNode([...results.querySelectorAll('button')].find(value=>value.dataset.platformItem===record.ref.id));});control.dataset.platformItem=record.ref.id;control.title=titleOf(record);control.setAttribute('aria-label',titleOf(record));control.setAttribute('aria-pressed',String(same(record,chosen)));const slot=el('span','hud-item-slot');slot.append(inventoryIcon(record));control.append(slot,el('span','hud-item-name',titleOf(record)));if(Number.isSafeInteger(record.summary.quantity)&&record.summary.quantity>=0)control.append(el('span','paper-item-quantity',String(record.summary.quantity)));grid.append(control);}results.append(grid);results.scrollTop=view.top;
      if(pending){clear();details.append(el('p','hud-muted',msg('public:inventory.selectionPending')));}else if(!same(selected,chosen)){if(active&&chosen)void read(chosen);else details.replaceChildren();}else renderDetail();
    }
    if(source.phase==='partial')results.append(feedback(source,key,()=>provider.load(key,{more:Boolean(source.nextPageToken)}),chooseAgent));
    else if(view.query&&!source.complete)results.append(button(msg('public:inventory.continueSearch'),()=>provider.load(key,{more:true}),'paper-inventory-more'));
    fillViewport();
  }
  function walletStatus(){
    const value=walletProvider.snapshot(),status=el('div','hud-wallet-status');status.id='hud-wallet-status';status.dataset.phase=value.phase;status.setAttribute('role','status');
    const label=value.phase==='ready'?msg('public:inventory.balance',()=>({currency:value.data.currency.code==='star_coin'?t('public:inventory.starCoins'):value.data.currency.displayName,balance:value.data.balance})):msg(value.phase==='loading'?'public:inventory.wallet.loading':value.phase==='denied'?'public:inventory.wallet.denied':value.phase==='not_enabled'?'public:inventory.wallet.notEnabled':value.phase==='no_agent'?'public:inventory.wallet.noAgent':value.phase==='session'?'public:inventory.wallet.session':value.phase==='not_initialized'||value.phase==='idle'?'public:inventory.wallet.notInitialized':'public:inventory.wallet.unavailable');status.append(el('span','',label));
    if(['error','unavailable','not_initialized','idle','resync'].includes(value.phase))status.append(button(msg('common:action.retry'),()=>walletProvider.load(),'hud-wallet-retry'));return status;
  }
  function render(){
    if(disposed)return;node.replaceChildren();const access=accessState(state,'背包',chooseAgent);if(access){clear();node.append(access);return;}
    const info=agentBar(state,chooseAgent);info.classList.add('hud-inventory-context');info.append(walletStatus());node.append(info);
    const columns=el('div','hud-inventory-layout'),browser=el('div','hud-inventory-browser'),label=el('label','hud-search'),search=el('input');search.type='search';search.value=views.holdings.query;search.maxLength=100;search.id='hud-platform-item-search';bindAttribute(search,'placeholder','public:inventory.search');bindAttribute(search,'aria-label','public:inventory.searchLoaded');search.addEventListener('input',()=>{remember();Object.assign(views.holdings,{query:search.value,top:0,selected:'',detailTop:0});saveInventory();renderResults();});label.append(search);browser.append(label,results);columns.append(browser,details);node.append(columns);renderResults();
  }
  const stop=provider.subscribe(changed=>{if(changed!==key)return;const source=provider.snapshot(key);if(['denied','session','resync'].includes(source.phase)){Object.assign(views.holdings,{selected:'',top:0,detailTop:0,query:'',category:'all'});saveInventory();}if(!source.records.length)clear();render();});
  const stopWallet=walletProvider.subscribe(()=>render()),stopNavigation=context?.subscribe(()=>{restoreInventory();render();});restoreInventory();render();
  return{node,activate(){active=true;restoreInventory();void provider.load(key);void walletProvider.load();fillViewport();},deactivate(){remember();active=false;provider.cancel(key);walletProvider.cancel();cancel();closePreview();cancelAnimationFrame(fillFrame);fillFrame=0;if(!detail)selected=null;},setContext(next){if(state.observationRevision!==next.observationRevision){clear();Object.assign(views.holdings,{selected:'',top:0,detailTop:0,query:'',category:'all'});state=next;restoreInventory(true);}else state=next;render();},back(){if(!preview)return false;closePreview();return true;},dispose(){disposed=true;stopItemContent();closePreview();cancel();cancelAnimationFrame(fillFrame);stop();stopWallet();stopNavigation?.();}};
}

export function createPlatformMail(provider,{session,context,detailHost,chooseAgent=()=>{}}={}){
  const node=el('section','hud-mail hud-platform-content'),list=el('div','hud-mail-list');list.id='hud-platform-mail-results';
  let key='messages',state=session.snapshot(),active=false,disposed=false,opened=null,detail=null,detailError=null,request=null,generation=0,related=null,relatedDetail=null,relatedError=null,relatedTop=0,readerTop=0;
  const views=Object.fromEntries(['messages','notifications','announcements','events'].map(key=>[key,{top:0,selected:'',bodyTop:{}}]));
  const exchanges=createOwnerExchanges(session,{chooseAgent,detailHost,onDirection:()=>{provider.cancel('messages');render();if(active&&exchanges.direction==='received')void provider.load('messages');}});
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
    if(opened?.detailAvailable===false){body.append(el('p','hud-muted',msg('public:inventory.summaryOnly')));return body;}
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
  function select(next){remember();close(false);exchanges.deactivate();provider.cancel(key);key=next;saveCategory();render();if(active){if(key==='messages'){exchanges.activate();}if(key!=='messages'||exchanges.direction==='received')void provider.load(key);}}
  function render(){
    if(disposed)return;node.replaceChildren();const agent=selectedAgent(state),source=currentSource();
    node.append(tabs([['messages','消息'],['notifications','通知'],['announcements','公告'],['events','事件']],key,select));
    const access=['messages','notifications'].includes(key)?accessState(state,'信箱',chooseAgent):null;if(access){node.append(access);return;}if(state.authenticated&&agent)node.prepend(agentBar(state,chooseAgent));
    if(key==='messages'){node.append(exchanges.node);if(exchanges.direction==='sent')return;}
    node.append(el('p','hud-muted',['messages','notifications'].includes(key)?state.authenticated?`所属角色：${agent?.name||'请选择 Agent'}`:'请登录后查看 Agent 的消息':'公开内容 · 不代表私人来信'),el('p','hud-muted','当前可查看内容'));
    const heading=el('h3','hud-list-heading',key==='messages'?'消息':key==='notifications'?'通知':key==='events'?'事件计划与发生记录':'公开公告');heading.tabIndex=-1;node.append(heading);list.replaceChildren();
    for(const record of source.records){const row=el('div','hud-message-row hud-platform-message-row'),control=button('',()=>open(record),'hud-message-open');control.dataset.platformMessage=record.ref.id;control.setAttribute('aria-pressed',String(keyOf(record)===views[key].selected));const text=el('span','hud-message-summary'),byline=el('span','hud-muted',key==='messages'?senderText(record):sourceText(record));if(key==='messages'){byline.dataset.senderName='';byline.title=byline.textContent;}text.append(el('strong','',`${key==='events'?eventLabel(record)+' · ':''}${titleOf(record)}`),byline);control.append(icon(key==='events'?'clock':key==='messages'?'mail':'notice'),text);const meta=el('span','hud-message-byline');byline.replaceWith(meta);meta.append(byline,badge(record));row.append(control);const published=time(record.summary.source?.publishedAt);control.append(el('time','',key==='messages'?messageTime(record):key==='events'?eventTime(record):published?`发布于 ${published}`:'发布时间未提供'));list.append(row);}
    if(!source.records.length)list.append(feedback(source,key,()=>provider.load(key),chooseAgent));else list.append(pageFoot(source,key,provider));node.append(list);list.scrollTop=views[key].top;
  }
  const stop=provider.subscribe(changed=>{const source=provider.snapshot(changed);if(views[changed]&&['denied','session','resync'].includes(source.phase)){Object.assign(views[changed],{top:0,selected:'',bodyTop:{}});saveCategory();}if(changed!==key)return;if(!source.records.length&&opened){close(false);cancel();opened=null;detail=null;detailHost.clear();}render();}),stopCategory=context?.subscribe(()=>{restoreCategory();render();});restoreCategory();render();
  return{node,activate(){active=true;restoreCategory();if(key==='messages'){exchanges.activate();}if(key!=='messages'||exchanges.direction==='received')void provider.load(key);},deactivate(){remember();active=false;exchanges.deactivate();close(false);provider.cancel(key);cancel();},setContext(next){if(state.observationRevision!==next.observationRevision){close(false);cancel();opened=null;detail=null;detailHost.clear();for(const view of Object.values(views))Object.assign(view,{top:0,selected:'',bodyTop:{}});restoreCategory(true);}state=next;render();},showWorld(category){select(category==='events'?'events':'announcements');},back(){if(!detailHost.isOpen)return false;if(related){cancel();related=null;renderDetail();detailHost.body.scrollTop=relatedTop;return true;}close();return true;},dispose(){disposed=true;exchanges.dispose();close(false);cancel();stop();stopCategory?.();}};
}
