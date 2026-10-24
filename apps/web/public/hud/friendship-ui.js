import {publicIdLabel} from '../public-id.js';
import {el} from '../common.js';
import {button,selectedAgent} from './features/shared.js';
import {avatar} from '../scene.js';
import {createFriendshipSource,friendshipOperations,friendshipState,friendshipError} from './friendship-source.js';
const inbox=direction=>document.dispatchEvent(new CustomEvent('hud:friendship-inbox',{detail:{direction}}));
const time=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
function commandFeedback(node,value,source){
 if(value.writing){node.append(el('p','hud-muted','正在提交，请稍候…'));return;}
 if(value.uncertain){node.append(el('p','hud-muted','暂时无法确认结果。继续核对会查询原操作，不会另发一份邀请。'),button('继续核对这次操作',()=>source.retryCommand()));return;}
 if(value.commandError)node.append(el('p','hud-muted',friendshipError(value.commandError)));
}
export function createCharacterFriendship(session){
 const node=el('section','character-card-friendship'),source=createFriendshipSource(session,{view:'pair'}),form=el('form'),label=el('label','','附言（可选）'),message=el('textarea'),count=el('small','','0 / 120'),send=button('',()=>{}),status=el('div'),controls=el('div');let context=session.snapshot(),value=source.snapshot(),target='',available=false,editing=false,key='';
 message.rows=2;message.setAttribute('aria-label','好友邀请附言');message.id='friendship-message';label.htmlFor=message.id;send.type='submit';form.append(label,message,count,send);node.append(status,form,controls);
 const editable=()=>!value.writing&&!value.uncertain&&Array.from(message.value).length<=120;
 message.addEventListener('input',()=>{count.textContent=`${Array.from(message.value).length} / 120`;send.disabled=!editable();});
 form.addEventListener('submit',event=>{event.preventDefault();if(!editable()||!value.data?.allowedActions.includes(friendshipOperations.send))return;void source.command('send',{toAgentId:target,message:message.value});});
 function sync(){const agent=selectedAgent(context),next=JSON.stringify([context.observationRevision,target,available]);if(next!==key){key=next;editing=false;message.value='';count.textContent='0 / 120';source.setActive(false);source.configure({otherAgentId:target});if(available&&agent&&context.authenticated&&agent.agentId!==target)source.setActive(true);}render();}
 function render(){
  status.replaceChildren();controls.replaceChildren();form.hidden=true;const agent=selectedAgent(context);node.hidden=!available;if(!available)return;
  if(!context.authenticated||!agent){status.append(el('p','hud-muted',!context.authenticated?'登录并选择自己的 Agent 后，可以发送好友邀请。':'先选择自己的 Agent，再发送好友邀请。'));controls.append(button(context.authenticated?'选择 Agent':'登录账号',()=>document.dispatchEvent(new Event('hud:choose-agent'))));return;}
  if(agent.agentId===target){status.append(el('p','hud-muted','这是当前选中的 Agent。'));return;}
  if(value.phase==='loading'){status.append(el('p','hud-muted','正在读取好友状态…'));return;}
  if(value.phase==='error'){status.append(el('p','hud-muted',friendshipError(value.error)));controls.append(button('重新读取好友状态',()=>source.load()));return;}
  if(value.phase!=='ready')return;
  const relation=value.data;if(relation.relationship)status.append(el('p','hud-muted','已是好友'));
  else if(relation.request){status.append(el('p','hud-muted',friendshipState(relation.request)));if(relation.request.state==='pending')controls.append(button(relation.request.direction==='received'?'去好友列表回应':'查看发出的申请',()=>inbox(relation.request.direction)));}
  if(relation.allowedActions.includes(friendshipOperations.send)&&!value.uncertain){if(!editing)controls.append(button('添加好友',()=>{editing=true;render();message.focus();}));else{form.hidden=false;send.textContent=`以${agent.name}的身份发送邀请`;send.disabled=!editable();message.disabled=value.writing;label.textContent=`以${agent.name}的身份添加好友 · 附言（可选）`;}}
  commandFeedback(controls,value,source);
 }
 const stopSource=source.subscribe(next=>{value=next;render();}),stopSession=session.subscribe(next=>{context=next;sync();});
 return{node,update({agentId,visible}){if(target===agentId&&available===visible)return;target=agentId||'';available=Boolean(visible);sync();},dispose(){stopSource();stopSession();source.dispose();}};
}
export function createFriendshipInbox(session,{detailHost,chooseAgent=()=>{}}={}){
 const node=el('section','hud-friendship-inbox'),toolbar=el('div','paper-list-toolbar'),search=el('input'),filter=el('select'),refresh=button('刷新',()=>source.load()),status=el('p','paper-list-status'),scroller=el('div','paper-list-scroll'),list=el('div','hud-friendship-invitation-list'),tail=el('div','paper-list-tail'),commandStatus=el('div','paper-command-status'),identityNote=el('p','paper-list-identity');
 search.type='search';search.placeholder='搜索申请人';search.setAttribute('aria-label','搜索申请人');filter.setAttribute('aria-label','申请状态');for(const [key,label]of [['all','全部状态'],['pending','待回应'],['accepted','已接受'],['declined','已拒绝'],['cancelled','已取消'],['expired','已到期']]){const option=el('option','',label);option.value=key;filter.append(option);}toolbar.append(search,filter,refresh);scroller.tabIndex=0;scroller.setAttribute('aria-label','好友申请列表');scroller.append(list,tail);node.append(toolbar,status,scroller,commandStatus,identityNote);
 const source=createFriendshipSource(session,{view:'inbox',input:{direction:'received',limit:20,order:'newest',state:'all'},shouldFill:()=>active&&scroller.scrollHeight<=scroller.clientHeight+1}),detail=createFriendshipSource(session,{view:'invitation'});let value=source.snapshot(),detailValue=detail.snapshot(),direction='received',opened=null,active=false,context=session.snapshot(),timer=null;
 function close(){if(!opened)return;opened=null;detail.setActive(false);detailHost.close(false);detailHost.clear();}
 function open(request){opened=request.requestId;detail.setActive(false);detail.configure({requestId:opened});detailHost.open('好友申请',el('p','hud-muted','正在读取邀请…'),restore=>{const id=opened;opened=null;detail.setActive(false);detailHost.clear();if(restore)list.querySelector(`[data-friendship-request="${CSS.escape(id)}"]`)?.focus({preventScroll:true});});detailHost.setBack('返回好友列表',null);detail.setActive(true);}
 function renderDetail(){
  if(!opened||!detailHost.isOpen)return;const body=el('section','hud-mail-reader hud-friendship-reader'),actions=el('div','button-row');
  if(detailValue.phase==='error')body.append(el('p','hud-feedback',friendshipError(detailValue.error)),button('重新读取邀请',()=>detail.load()));
  else if(detailValue.phase!=='ready')body.append(el('p','hud-muted','正在读取邀请…'));
  else{const request=detailValue.data.request,agent=selectedAgent(context),person=el('div','hud-friendship-person'),picture=el('span');avatar(picture,{avatar:request.counterpart.appearance},request.counterpart.agentId);person.append(picture,el('strong','',request.counterpart.displayName));body.append(person,el('p','hud-muted',request.direction==='received'?`发给：${agent?.name||'当前 Agent'}`:`由${agent?.name||'当前 Agent'}发出`),el('p','hud-muted',`发送于 ${time(request.createdAt)} · 到期 ${time(request.deadline)}`),el('p','',friendshipState(request)),el('h3','','附言'),el('p','hud-message-body',request.message||'未附留言。'));
   for(const [action,label]of [['accept','接受'],['decline','拒绝'],['cancel','取消申请']])if(request.allowedActions.includes(friendshipOperations[action])){const control=button(label,()=>detail.command(action,{requestId:request.requestId,expectedVersion:request.version}));control.setAttribute('aria-label',`以${agent?.name||'当前 Agent'}的身份${label}`);control.disabled=detailValue.writing||detailValue.uncertain;control.dataset.friendshipAction=action;actions.append(control);}commandFeedback(actions,detailValue,detail);
  }detailHost.update('好友申请',body);detailHost.setActions?.(actions);
 }
 function configure(){source.configure({direction,search:Array.from(search.value.trim()).slice(0,100).join(''),state:filter.value,order:'newest',limit:20});}
 search.addEventListener('input',()=>{clearTimeout(timer);source.setActive(false);timer=setTimeout(()=>{configure();scroller.scrollTop=0;if(active)source.setActive(true);},250);});filter.addEventListener('change',()=>{clearTimeout(timer);configure();scroller.scrollTop=0;if(active)source.setActive(true);});
 scroller.addEventListener('scroll',()=>{if(scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-160&&!value.loadingMore&&!value.pageError&&value.data?.complete===false)void source.loadMore();},{passive:true});
 function render(){
  const scroll=scroller.scrollTop,focused=document.activeElement?.closest('[data-friendship-request]')?.dataset.friendshipRequest;list.replaceChildren();tail.replaceChildren();commandStatus.replaceChildren();commandFeedback(commandStatus,value,source);status.textContent='';identityNote.textContent=`以${selectedAgent(context)?.name||'当前 Agent'}的身份${direction==='received'?'回应':'查看发出的申请'}`;
  if(['session','no_agent'].includes(value.phase)){status.textContent=value.phase==='session'?'登录后查看好友申请。':'选择一位 Agent 后查看好友申请。';tail.append(button(value.phase==='session'?'登录账号':'选择 Agent',chooseAgent));return;}
  if(value.phase==='error'){status.textContent=friendshipError(value.error);tail.append(button('重新读取',()=>source.load()));return;}
  if(!value.data){status.textContent=value.phase==='loading'?'正在读取好友申请…':'';return;}
  status.textContent=value.data.total===null?'申请总数暂未提供':`${value.data.total} 条申请`;const agent=selectedAgent(context);
  for(const request of value.data.items){
   const row=el('article','hud-friendship-request-card'),picture=el('span','paper-request-picture'),person=el('div','paper-request-person'),name=button(request.counterpart.displayName,()=>open(request),'hud-friendship-request'),copy=el('div','paper-request-copy'),controls=el('div','paper-request-actions');name.dataset.friendshipRequest=request.requestId;name.disabled=value.writing||value.uncertain;avatar(picture,{avatar:request.counterpart.appearance},request.counterpart.agentId);person.append(name,el('span','paper-stable-id',publicIdLabel(request.counterpart.publicId)));const message=el('p','paper-request-message',request.message||'未附留言。');message.title=request.message;copy.append(message,el('time','hud-muted',time(request.createdAt)));row.append(picture,person,copy,el('span','paper-request-state',friendshipState(request)));
   for(const [action,label]of [['accept','接受'],['decline','拒绝'],['cancel','取消申请']])if(request.allowedActions.includes(friendshipOperations[action])){const control=button(label,()=>source.command(action,{requestId:request.requestId,expectedVersion:request.version}));control.setAttribute('aria-label',`以${agent?.name||'当前 Agent'}的身份${label}`);control.disabled=value.writing||value.uncertain;control.dataset.friendshipAction=action;control.dataset.friendshipRequestId=request.requestId;controls.append(control);}row.append(controls);list.append(row);
  }
  if(!value.data.items.length&&value.data.complete)tail.append(el('p','hud-muted','暂无可查看的好友申请。'));if(value.loadingMore)tail.append(el('p','hud-muted','正在读取更多申请…'));if(value.pageError)tail.append(el('p','hud-muted','后续申请暂时无法读取，已显示的申请仍保留。'),button('重试读取后续申请',()=>source.loadMore()));scroller.scrollTop=scroll;if(focused)list.querySelector(`[data-friendship-request="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
 }
 const stop=source.subscribe(next=>{value=next;if(!['ready','loading'].includes(value.phase))close();render();}),stopDetail=detail.subscribe(next=>{detailValue=next;renderDetail();}),stopSession=session.subscribe(next=>{const changed=context.observationRevision!==next.observationRevision;context=next;if(changed){close();clearTimeout(timer);search.value='';filter.value='all';configure();scroller.scrollTop=0;}});
 return{node,setDirection(next){if(next===direction)return;close();direction=next;search.value='';filter.value='all';configure();scroller.scrollTop=0;},activate(){active=true;source.setActive(true);},deactivate(){active=false;clearTimeout(timer);close();source.setActive(false);},dispose(){active=false;clearTimeout(timer);close();stop();stopDetail();stopSession();source.dispose();detail.dispose();}};
}
export function mountFriendshipOverview(node,session){
 if(!node)return{dispose(){}};const source=createFriendshipSource(session,{view:'overview'}),status=el('p','hud-muted'),open=button('查看好友申请',()=>inbox('received'));status.setAttribute('role','status');node.append(el('h3','','好友申请'),status,open,button('刷新好友请求',()=>source.load()));
 const stop=source.subscribe(value=>{status.textContent=value.phase==='ready'&&value.data.status==='available'?`待处理好友请求：${value.data.pendingCount}`:['session','no_agent'].includes(value.phase)?'选择当前 Agent 后查看待处理好友请求。':value.phase==='loading'?'正在读取待处理好友请求…':'待处理好友请求：暂时未知';});
 const sync=()=>source.setActive(!document.hidden&&!node.closest('[hidden],[data-panel-state="closing"],[data-panel-state="closed"]')&&node.getClientRects().length>0),observer=new MutationObserver(sync);observer.observe(document.querySelector('#hud-root')||node.parentNode,{subtree:true,attributes:true,attributeFilter:['hidden','class','style','data-panel-state']});document.addEventListener('visibilitychange',sync);sync();return{dispose(){observer.disconnect();document.removeEventListener('visibilitychange',sync);stop();source.dispose();}};
}
