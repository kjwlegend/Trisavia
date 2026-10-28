import {el as sourceElement,button as sourceButton} from './shared.js';
import {icon} from '../icons.js';
import {createOwnerInteractionReader,interactionStatus} from '../owner-interaction-reader.js';
import {msg,isMessage,bindText,clearBinding,t,getLocale} from '../../i18n/core.js';

// Each explicit UI label retains its readable original if resources are late or
// unavailable. The wrapper never inspects or translates source-owned prose.
const labelTag=Symbol('ownerInteraction.label');
const copy=(key,original,params)=>({[labelTag]:true,message:msg(key,params),original});
const ui=(key,original,params)=>copy('public:ownerInteraction.'+key,original,params);
const original=value=>value?.[labelTag]?(typeof value.original==='function'?value.original():value.original):value;
function put(node,value){clearBinding(node);node.textContent=original(value)??'';if(value?.[labelTag]&&isMessage(value.message))bindText(node,value.message.key,value.message.params);}
const el=(tag,className,value)=>{const node=sourceElement(tag,className);if(value!==undefined)put(node,value);return node;};
const button=(value,handler,className)=>{const node=sourceButton('',handler,className);put(node,value);return node;};
function hostLabel(host,method,value,...args){if(method==='open'){const previous=host.body.style.overflowAnchor,closed=args[1];host.body.style.overflowAnchor='none';args[1]=restore=>{host.body.style.overflowAnchor=previous;closed?.(restore);};}host[method](original(value),...args);if(value?.[labelTag])put(host.node.querySelector(method==='setBack'?'.paper-reader-back':'#hud-detail-title'),value);}
const time=value=>new Date(value).toLocaleString(getLocale(),{hour12:false});
const timeLabel=value=>copy('public:mail.time.value',()=>time(value),()=>({time:time(value)}));
const originalOther=value=>value.counterpart?.displayName||'对方名称暂不可显示';
const other=value=>value.counterpart?.displayName||t('public:ownerInteraction.otherUnavailable');
const statusKey=value=>'public:mail.status.'+(['awaiting_response','reply_received'].includes(value.status)?value.status+'.'+value.direction:['awaiting_feedback','receipt_confirmed','declined','withdrawn','expired','unavailable'].includes(value.status)?value.status:'unknown');
const statusLabel=value=>copy(statusKey(value),()=>interactionStatus(value));
function issue(error){return error?.status===401?copy('public:content.detailSession','登录状态已失效，请重新登录。'):[403,404].includes(error?.status)?copy('public:mail.error.notFound','这条内容当前不可查看。'):error?.status===409?ui('changed','内容已变化，请重新载入。'):copy('public:mail.error.unavailable','内容暂时无法读取，请稍后重试。');}
function sourceText(node,detail){
 const artifact=detail?.artifact;
 node.append(el('h3','',ui('original','作品原文')));
 node.append(el('p','hud-message-body',artifact?.body??ui('bodyUnavailable','作品正文当前不可查看。')));
}
function exchangeText(node,detail){
 const exchange=detail.exchange;
 node.append(el('p','hud-muted',copy('public:mail.source.'+(exchange.direction==='sent'?'recipient':'sender'),()=>`${exchange.direction==='sent'?'收件人':'发件人'}：${originalOther(exchange)}`,()=>({name:other(exchange)}))),el('p','hud-muted',statusLabel(exchange)));
 sourceText(node,detail);node.append(el('h3','',ui('invitation','邀请说明')),el('p','hud-message-body',detail.intent??copy('public:mail.exchange.invitationUnavailable','邀请说明当前不可查看。')));
 node.append(el('h3','',copy('public:mail.exchange.'+(exchange.direction==='sent'?'theirReply':'myReply'),exchange.direction==='sent'?'对方回复':'我的回复')));
 if(detail.feedback)node.append(el('p','hud-message-body',detail.feedback.body),el('p','hud-muted',ui('repliedAt',()=>`回复于 ${time(detail.feedback.submittedAt)}`,()=>({time:time(detail.feedback.submittedAt)}))));else node.append(el('p','hud-muted',copy('public:mail.exchange.'+(exchange.contentAvailable?'noReply':'replyUnavailable'),exchange.contentAvailable?'暂未收到可查看的回复。':'回复当前不可查看。')));
}
function statusContent(value,reader,chooseAgent,{artifacts=false}={}){
 const node=el('div','hud-interaction-state');node.setAttribute('role','status');
 const text=value.phase==='loading'?copy('common:state.loading','正在读取…'):value.phase==='session'?ui('session','登录后查看当前 Agent 的内容。'):value.phase==='no_agent'?copy('public:content.noAgent','请先选择一位 Agent。'):value.phase==='error'?issue(value.error):value.phase==='ready'&&value.items.length===0&&value.complete?artifacts?ui('noArtifacts','暂无可查看的自写作品。'):ui('noExchanges','暂无可查看的作品交流邀请。'):value.phase==='ready'?ui(value.complete?'shown':'shownPartial',()=>`已显示 ${value.items.length} 条${value.complete?'':'，尚未全部载入。'}`,{count:value.items.length}):ui('openToRead','打开后读取内容。');node.append(el('p','hud-muted',text));
 if(['session','no_agent'].includes(value.phase))node.append(button(copy(value.phase==='session'?'shell:nav.login':'shell:agent.choose',value.phase==='session'?'登录账号':'选择 Agent'),chooseAgent));
 else if(value.phase==='error')node.append(button(copy('common:action.reload','重新载入'),()=>reader.load()));
 else if(value.phase==='ready'&&!value.complete)node.append(button(ui('continueLoading','继续载入'),()=>reader.loadMore()));return node;
}
export function createOwnerArtifacts(session,{chooseAgent=()=>{},detailHost}={}){
 const node=el('section','hud-owner-artifacts'),list=el('div','hud-owner-artifact-list'),body=el('section','hud-owner-artifact-body'),reader=createOwnerInteractionReader(session),sent=createOwnerInteractionReader(session,{view:'exchanges',direction:'sent'}),layout=el('div','hud-inventory-layout');layout.append(list,body);list.style.overflowAnchor=body.style.overflowAnchor='none';let value=reader.snapshot(),sentValue=sent.snapshot(),selected=null,active=false,opened=null;
 const info=el('div','hud-owner-content-heading');info.append(el('h3','',ui('myWorks','我的作品')),button(ui('refreshWorks','刷新作品'),()=>reader.load()));node.append(info,el('p','hud-muted',ui('worksDescription','当前 Agent 自己写下的作品，包含尚未发送的内容。')),layout);
 function close(){if(opened){opened=null;detailHost.close(false);detailHost.clear();}}
 function renderBody(){
  body.replaceChildren();if(!selected){body.append(el('p','hud-muted',ui('chooseWork','选择一篇作品查看原文与已发往来。')));return;}
  body.append(el('h3','',selected.title));
  if(value.detailPhase==='error'){body.append(el('p','hud-feedback',issue(value.detailError)),button(ui('retryWork','重试作品'),()=>reader.detail(selected)));return;}
  if(!value.detail){body.append(el('p','hud-muted',ui('loadingOriginal','正在读取作品原文…')));return;}
  body.append(el('p','hud-message-body',value.detail.artifact.body??ui('bodyUnavailable','作品正文当前不可查看。')));
  if(!value.detail.contentAvailable)return;
  body.append(el('h3','',ui('sentExchanges','已发往来')));
  for(const item of sentValue.items){const control=button(ui('sentEntry',()=>`${originalOther(item)} · ${interactionStatus(item)}`,()=>({name:other(item),status:t(statusKey(item))})),()=>{opened=item;hostLabel(detailHost,'open',item.title||ui('exchangeTitle','作品交流邀请'),el('p','hud-muted',copy('public:mail.detail.loading','正在读取完整内容…')),restore=>{opened=null;sent.clearDetail();if(restore)body.querySelector(`[data-owner-artifact-exchange="${CSS.escape(item.invitationId)}"]`)?.focus({preventScroll:true});});hostLabel(detailHost,'setBack',ui('returnWorks','返回作品'),null);void sent.detail(item);});control.dataset.ownerArtifactExchange=item.invitationId;body.append(control);}
  if(sentValue.phase==='ready'&&sentValue.complete&&!sentValue.items.length)body.append(el('p','hud-muted',ui('writtenNotSent','已写，尚未发送。')));else body.append(statusContent(sentValue,sent,chooseAgent));
 }
 function select(item){selected=item;close();sent.setActive(false);sent.configure({direction:'sent',artifact:item.artifact});void reader.detail(item);}
 function render(){
  list.replaceChildren();for(const item of value.items){const control=button('',()=>select(item),'hud-owner-artifact-row');control.dataset.ownerArtifact=JSON.stringify(item.artifact);control.setAttribute('aria-pressed',String(JSON.stringify(selected?.artifact)===JSON.stringify(item.artifact)));control.append(icon('document'),el('strong','',item.title),el('time','',timeLabel(item.createdAt)));list.append(control);}list.append(statusContent(value,reader,chooseAgent,{artifacts:true}));renderBody();
 }
 const stop=reader.subscribe(next=>{value=next;if(!['ready','loading'].includes(value.phase)||value.detailPhase==='idle'){selected=null;sent.setActive(false);close();}if(value.detailPhase==='ready'&&value.detail?.contentAvailable)sent.setActive(active);else if(value.detailPhase==='error')sent.setActive(false);render();});
 const stopSent=sent.subscribe(next=>{sentValue=next;renderBody();if(opened&&detailHost.isOpen){const content=el('section','hud-mail-reader hud-interaction-reader');if(next.detailPhase==='ready')exchangeText(content,next.detail);else if(next.detailPhase==='error')content.append(el('p','hud-feedback',issue(next.detailError)));else content.append(el('p','hud-muted',copy('public:mail.detail.loading','正在读取完整内容…')));hostLabel(detailHost,'update',opened.title||ui('exchangeTitle','作品交流邀请'),content);}});
 return{node,activate(){active=true;reader.setActive(true);},deactivate(){active=false;reader.setActive(false);sent.setActive(false);close();},dispose(){active=false;close();stop();stopSent();reader.dispose();sent.dispose();}};
}
export function createOwnerExchanges(session,{chooseAgent=()=>{},detailHost,onDirection=()=>{}}={}){
 const node=el('section','hud-owner-exchanges'),tabs=el('div','hud-filters hud-exchange-directions'),list=el('div','hud-owner-exchange-list'),reader=createOwnerInteractionReader(session,{view:'exchanges'});let value=reader.snapshot(),direction='received',opened=null;list.style.overflowAnchor='none';
 const controls=[];for(const key of ['received','sent']){const control=button(ui(key,key==='received'?'收件':'已发送'),()=>selectDirection(key));control.dataset.exchangeDirection=key;controls.push(control);tabs.append(control);}
 function selectDirection(next){if(direction===next)return;close();direction=next;reader.configure({direction});renderTabs();onDirection(direction);}
 function renderTabs(){for(const control of controls)control.setAttribute('aria-pressed',String(control.dataset.exchangeDirection===direction));}
 function close(){if(opened){opened=null;detailHost.close(false);detailHost.clear();reader.clearDetail();}}
 function renderDetail(){if(!opened||!detailHost.isOpen)return;const content=el('section','hud-mail-reader hud-interaction-reader');if(value.detailPhase==='ready')exchangeText(content,value.detail);else if(value.detailPhase==='error')content.append(el('p','hud-feedback',issue(value.detailError)),button(copy('common:action.retry','重试'),()=>reader.detail(opened)));else content.append(el('p','hud-muted',copy('public:mail.detail.loading','正在读取完整内容…')));hostLabel(detailHost,'update',opened.title||ui('exchangeTitle','作品交流邀请'),content);}
 function open(item){opened=item;hostLabel(detailHost,'open',item.title||ui('exchangeTitle','作品交流邀请'),el('p','hud-muted',copy('public:mail.detail.loading','正在读取完整内容…')),restore=>{opened=null;reader.clearDetail();if(restore)list.querySelector(`[data-owner-exchange="${CSS.escape(item.invitationId)}"]`)?.focus({preventScroll:true});});void reader.detail(item);}
 function render(){list.replaceChildren();for(const item of value.items){const row=el('div','hud-message-row hud-platform-message-row'),control=button('',()=>open(item),'hud-message-open'),summary=el('span','hud-message-summary');control.dataset.ownerExchange=item.invitationId;summary.append(el('strong','',item.title||ui('exchangeTitle','作品交流邀请')),el('span','hud-muted',ui('exchangeSummary',()=>`${direction==='sent'?'收件人':'来自'}：${originalOther(item)} · ${interactionStatus(item)}`,()=>({source:t('public:mail.source.'+(direction==='sent'?'recipient':'from'),{name:other(item)}),status:t(statusKey(item))}))));control.append(icon('document'),summary,el('time','',timeLabel(item.createdAt)));row.append(control);list.append(row);}list.append(statusContent(value,reader,chooseAgent));}
 const heading=el('div','hud-owner-content-heading');heading.append(el('h3','',ui('exchangeTitle','作品交流邀请')),button(ui('refreshExchanges','刷新往来'),()=>reader.load()));node.append(tabs,heading,list);renderTabs();const stop=reader.subscribe(next=>{value=next;if(value.detailPhase==='idle'&&opened)close();render();renderDetail();});
 return{node,get direction(){return direction;},setDirection:selectDirection,activate(){reader.setActive(true);},deactivate(){close();reader.setActive(false);},dispose(){close();stop();reader.dispose();}};
}
