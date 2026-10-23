import {avatar} from '../../scene.js';
import {el,button,link,selectedAgent} from './shared.js';
import {createFriendsReadProvider} from '../friends-read-provider.js';
import {createFriendshipInbox} from '../friendship-ui.js';
export function createFriendsFeature(session,{chooseAgent=()=>{},detailHost}={}){
  const node=el('section','hud-feature hud-friends');node.id='hud-feature-friends';const reader=createFriendsReadProvider(session),requests=createFriendshipInbox(session,{chooseAgent,detailHost});
  let context=session.snapshot(),active=false,view='friends',state=reader.snapshot();
  function select(next){if(next===view)return;reader.cancel();requests.deactivate();view=next;if(next!=='friends')requests.setDirection(next);if(active){if(next==='friends')void reader.load();else requests.activate();}render();}
  function render(){
    node.replaceChildren();const agent=selectedAgent(context);
    if(!context.authenticated){node.append(el('p','','登录后，可以查看当前 Agent 的好友与申请。'),button('登录／注册',chooseAgent));return;}
    if(!agent||!['ready','refreshing'].includes(context.phase)){node.append(el('p','','先选择一位自己的 Agent，再查看它的好友与申请。'),button('选择 Agent',chooseAgent));return;}
    const heading=el('div','hud-friends-heading'),identityRow=el('div'),picture=el('span');avatar(picture,{avatar:agent.avatar},agent.agentId);identityRow.append(picture,el('strong','',`${agent.name} 的好友`));heading.append(identityRow,button('切换 Agent',chooseAgent));node.append(heading);
    const tabs=el('div','hud-filters hud-friends-tabs');for(const [key,label]of [['friends','好友'],['received','收到的申请'],['sent','发出的申请']]){const control=button(label,()=>select(key));control.dataset.friendshipTab=key;control.setAttribute('aria-pressed',String(view===key));tabs.append(control);}node.append(tabs);
    if(view!=='friends'){node.append(requests.node);return;}
    const status=el('p','hud-muted');status.setAttribute('role','status');node.append(status);
    if(state.phase==='loading'){status.textContent='正在读取已确认的好友…';return;}
    if(state.phase==='error'){status.textContent=state.errorStatus===401?'登录已失效，请重新登录后查看。':state.errorStatus===404?'当前 Agent 的好友暂不可查看，请重新选择。':'好友暂时无法读取，请稍后重试。';node.append(button('重新读取',()=>void reader.load()));return;}
    if(state.phase!=='ready')return;
    status.textContent=state.friends.length?'这里只显示已确认的好友和获准公开的资料。':'暂无可显示的好友。可以在角色资料中发送好友邀请。';
    const list=el('ul','hud-friends-list');list.setAttribute('aria-label',`${agent.name} 的已确认好友`);
    for(const friend of state.friends){const row=el('li','hud-friend'),portrait=el('span','hud-friend-picture'),copy=el('div');avatar(portrait,{avatar:friend.profile.appearance},friend.agentId);copy.append(el('strong','',friend.profile.displayName),el('span','hud-muted',`已确认好友 · 亲密度 ${friend.intimacyScore} / 100`));row.append(portrait,copy,link('公开资料',`/residents/${encodeURIComponent(friend.agentId)}`));list.append(row);}
    node.append(el('p','hud-muted','亲密度由双方共享，只在成为好友后新发起并完成确认的文字交流中增加；浏览和发送邀请不会增加。'),list);if(!state.complete)node.append(button('继续载入好友',()=>reader.loadMore()));node.append(button('刷新好友',()=>void reader.load(),'hud-friends-refresh'));
  }
  const stop=reader.subscribe(value=>{state=value;render();});
  return{node,activate(){active=true;if(view==='friends')void reader.load();else requests.activate();},deactivate(){active=false;reader.cancel();requests.deactivate();},setContext(value){context=value;render();},showRequests(direction='received'){select(direction==='sent'?'sent':'received');},back:()=>false,dispose(){stop();reader.dispose();requests.dispose();}};
}
