import {el,button} from './shared.js';
import {icon} from '../icons.js';

// Reuse the renderer's controls and listeners; World itself opens no panel.
export function createWorldControls(root){
  const controls=document.querySelector('.world-controls'),zoom=document.querySelector('.world-zoom-controls'),fit=document.querySelector('#world-fit'),list=document.querySelector('#world-open-list');
  const menu=el('div','hud-map-menu'),more=button('更多',()=>toggle());menu.id='hud-map-menu';menu.hidden=true;menu.setAttribute('role','group');menu.setAttribute('aria-label','更多地图工具');
  more.id='hud-map-more';more.setAttribute('aria-controls',menu.id);more.setAttribute('aria-expanded','false');list.textContent='场所';
  const logs=button('',()=>document.dispatchEvent(new Event('hud:world-logs')));logs.id='hud-open-world-logs';logs.setAttribute('aria-label','世界日志');logs.title='世界日志';logs.append(icon('document'),el('span','','日志'));
  fit.replaceChildren(icon('world'),el('span','','全景'));list.replaceChildren(icon('place'),el('span','','场所'));more.replaceChildren(icon('more'),el('span','','更多'));
  menu.append(document.querySelector('#world-explore'),document.querySelector('#world-reset'),document.querySelector('#world-pause'),document.querySelector('#world-learn'));
  for(const [href,label,symbol]of [['/releases','版本记录','document'],['/kanban','开发看板','record']]){const link=el('a');link.href=href;link.append(icon(symbol),el('span','',label));menu.append(link);}
  const actions=el('div','hud-map-actions');actions.append(fit,list,logs,more);controls.classList.add('hud-map-tools');controls.replaceChildren(zoom,actions,menu);root.append(controls);
  function close(restore=false){if(menu.hidden)return;menu.hidden=true;more.setAttribute('aria-expanded','false');if(restore)more.focus({preventScroll:true});}
  function toggle(){menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden));}
  menu.addEventListener('click',event=>{if(event.target.closest('button,a'))close(true);});
  const outside=event=>{if(!controls.contains(event.target))close();};document.addEventListener('pointerdown',outside);
  function labels(){const pause=document.querySelector('#world-pause'),text=pause.getAttribute('aria-pressed')==='true'?'播放动画':'暂停动画';if(pause.textContent!==text)pause.textContent=text;const status=document.querySelector('#world-motion-status');if(status.textContent.startsWith('静止展示'))status.textContent=status.textContent.includes('减少动态')?'已按系统设置减少动画':'画布动画已暂停';}
  const observer=new MutationObserver(labels);observer.observe(document.querySelector('#world-pause'),{childList:true,attributes:true,attributeFilter:['aria-pressed']});observer.observe(document.querySelector('#world-motion-status'),{childList:true});labels();
  return{node:controls,get menuOpen(){return !menu.hidden;},closeMenu:close,setVisible(value){controls.hidden=!value;if(!value)close();},destroy(){observer.disconnect();document.removeEventListener('pointerdown',outside);}};
}
