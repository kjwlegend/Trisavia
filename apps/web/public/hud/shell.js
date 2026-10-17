import {$,el} from '../common.js';
import {avatar} from '../scene.js';
import {icon} from './icons.js';
import {createSessionApi} from './session-api.js';
import {createDemoProvider} from './demo-provider.js';
import {createProfileFeature} from './features/profile.js';
import {createInventoryFeature} from './features/inventory.js';
import {createMailFeature} from './features/mail.js';
import {createWorldFeature} from './features/world.js';
export function createHud(){
  const root=$('#hud-root'),dock=el('nav','hud-dock');dock.id='hud-dock';dock.setAttribute('aria-label','世界功能');
  const windowNode=el('section','hud-window');windowNode.id='hud-window';windowNode.hidden=true;windowNode.setAttribute('role','dialog');windowNode.setAttribute('aria-modal','false');windowNode.setAttribute('aria-labelledby','hud-title');
  const header=el('div','hud-window-header'),title=el('h2');title.id='hud-title';title.tabIndex=-1;const titleIcon=el('span'),close=el('button');close.id='hud-close';close.type='button';close.setAttribute('aria-label','关闭窗口');close.append(icon('close'));header.append(titleIcon,title,close);
  const body=el('div','hud-window-body');windowNode.append(header,body);
  const tooltip=el('div','hud-tooltip');tooltip.id='hud-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;
  const provider=createDemoProvider(),session=createSessionApi(),features={profile:createProfileFeature(provider),inventory:createInventoryFeature(provider),mail:createMailFeature(provider),world:createWorldFeature()};
  const names={profile:'个人',inventory:'背包',mail:'信箱',world:'世界'},buttons={};let current='',trigger=null,hoverTimer=0;
  function hideTip(){clearTimeout(hoverTimer);tooltip.hidden=true;for(const button of Object.values(buttons))button.removeAttribute('aria-describedby');}
  function showTip(key){hideTip();tooltip.textContent=names[key];tooltip.hidden=false;tooltip.classList.toggle('is-below',root.getBoundingClientRect().height<420);buttons[key].setAttribute('aria-describedby','hud-tooltip');}
  function size(){const compact=root.clientWidth<((current==='inventory'||current==='mail'?520:320)+124);root.classList.toggle('is-compact',compact);for(const feature of Object.values(features))feature.setCompact?.(compact);}
  function shut(restore=true){if(!current)return;hideTip();current='';windowNode.hidden=true;root.classList.remove('is-open');for(const button of Object.values(buttons)){button.setAttribute('aria-pressed','false');button.setAttribute('aria-expanded','false');}if(restore)trigger?.focus({preventScroll:true});}
  function open(key){if(current===key){shut();return;}document.dispatchEvent(new CustomEvent('hud:open'));menuClose();hideTip();current=key;trigger=buttons[key];title.textContent=names[key];titleIcon.replaceChildren(icon(key));windowNode.dataset.feature=key;windowNode.classList.toggle('is-wide',key==='inventory'||key==='mail');for(const [name,feature]of Object.entries(features)){feature.node.hidden=name!==key;buttons[name].setAttribute('aria-pressed',String(name===key));buttons[name].setAttribute('aria-expanded',String(name===key));}size();windowNode.hidden=false;root.classList.add('is-open');features[key].activate();body.scrollTop=0;title.focus({preventScroll:true});}
  for(const [key,label]of Object.entries(names)){const button=el('button','hud-dock-button');button.id=`hud-open-${key}`;button.type='button';button.setAttribute('aria-label',label);button.setAttribute('aria-controls','hud-window');button.setAttribute('aria-expanded','false');button.setAttribute('aria-pressed','false');const plate=el('span','hud-dock-plate');plate.append(icon(key));button.append(plate);buttons[key]=button;button.addEventListener('click',()=>open(key));button.addEventListener('mouseenter',()=>{hoverTimer=setTimeout(()=>showTip(key),250);});button.addEventListener('mouseleave',hideTip);button.addEventListener('focus',()=>showTip(key));button.addEventListener('blur',hideTip);dock.append(button);body.append(features[key].node);features[key].node.hidden=true;}
  close.addEventListener('click',()=>shut());document.addEventListener('world:place-open',()=>shut(false));
  const selector=el('div','hud-agent'),picture=el('div','hud-agent-picture'),identity=el('label','hud-agent-identity'),select=el('select');selector.id='hud-agent';select.id='hud-agent-select';select.setAttribute('aria-label','当前 Agent');identity.append(el('span','hud-muted','当前 Agent'),select);selector.append(picture,identity);select.addEventListener('change',()=>session.select(select.value));
  const exploreExit=el('button','hud-explore-exit','退出探索');exploreExit.id='hud-exit-explore';exploreExit.type='button';exploreExit.hidden=true;exploreExit.addEventListener('click',()=>$('#world-explore').click());document.addEventListener('world:state',event=>{exploreExit.hidden=!event.detail.exploring;if(event.detail.exploring&&current==='world'){shut(false);$('#world-canvas')?.focus({preventScroll:true});}});
  root.append(dock,windowNode,tooltip,selector,exploreExit);
  const nav=$('header nav'),accountButton=el('button','hud-account'),entry=el('a','hud-entry','Agent 接入'),menu=el('div','hud-account-menu');accountButton.id='hud-account';accountButton.type='button';accountButton.setAttribute('aria-controls','hud-account-menu');accountButton.setAttribute('aria-expanded','false');entry.href='#world-entry';entry.id='hud-agent-entry';menu.id='hud-account-menu';menu.hidden=true;nav.replaceChildren(accountButton,entry,menu);
  function menuClose(focus=false){menu.hidden=true;accountButton.setAttribute('aria-expanded','false');if(focus)accountButton.focus({preventScroll:true});}
  accountButton.addEventListener('click',()=>{shut(false);menu.hidden=!menu.hidden;accountButton.setAttribute('aria-expanded',String(!menu.hidden));});
  const refresh=el('button','','刷新账户状态');refresh.id='hud-refresh';refresh.type='button';refresh.addEventListener('click',()=>session.refresh());
  session.subscribe(state=>{const ready=['ready','refreshing'].includes(state.phase),agent=state.agents.find(item=>item.agentId===state.selectedAgentId);for(const feature of Object.values(features))feature.setContext(state);select.replaceChildren();select.disabled=!ready||!state.agents.length;
    for(const item of state.agents){const option=el('option','',item.name);option.value=item.agentId;option.selected=item.agentId===state.selectedAgentId;select.append(option);}if(!state.agents.length)select.append(el('option','',ready?'尚无关联 Agent':'尚未选择 Agent'));picture.replaceChildren();if(agent)avatar(picture,{avatar:agent.avatar},agent.agentId);else picture.append(icon('profile'));
    accountButton.replaceChildren(icon('profile'),el('span','',ready?state.username:state.phase==='loading'?'读取账户…':'注册／登录'),icon('chevron'));accountButton.title=ready?`账户：${state.username}`:'主人账户';
    menu.replaceChildren();const target=el('a','hud-link',ready?'我的 Agent':'注册／登录');target.href='/owner';menu.append(target);if(state.phase==='pending')menu.append(el('p','hud-muted','有上次未完成的进度，请在主人管理中继续。'));if(state.phase==='expired')menu.append(el('p','hud-muted','授权已失效，请重新登录。'));if(state.phase==='error')menu.append(el('p','hud-muted','账户暂时无法读取，登录材料仍保留。'));
    const recovery=el('a','hud-link','账号与找回登录');recovery.href='/owner';menu.append(recovery,refresh);if(ready){const logout=el('button','','退出登录');logout.id='hud-logout';logout.type='button';logout.addEventListener('click',()=>{session.logout();menuClose();shut(false);});menu.append(logout);}selector.dataset.phase=state.phase;
  });
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!menu.hidden){event.preventDefault();event.stopImmediatePropagation();menuClose(true);return;}if(current){event.preventDefault();event.stopImmediatePropagation();if(!features[current].back())shut();}});
  document.addEventListener('pointerdown',event=>{if(!nav.contains(event.target))menuClose();});
  new ResizeObserver(size).observe(root);window.addEventListener('pageshow',()=>session.refresh());window.addEventListener('focus',()=>session.refresh());session.refresh();return{close:shut};
}
