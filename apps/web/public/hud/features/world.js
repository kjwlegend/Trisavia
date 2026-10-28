import {el,button} from './shared.js';
import {icon} from '../icons.js';
import {expressionPolicy} from '../world-expression-reader.js';
import {msg,t,bindText,bindAttribute,onLocaleChange,localePath} from '../../i18n/core.js';

// Reuse the renderer's controls and listeners; World itself opens no panel.
export function createWorldControls(root){
  const controls=document.querySelector('.world-controls'),zoom=document.querySelector('.world-zoom-controls'),fit=document.querySelector('#world-fit'),list=document.querySelector('#world-open-list');
  const menu=el('div','hud-map-menu'),more=button(msg('shell:map.more'),()=>toggle());menu.id='hud-map-menu';menu.hidden=true;menu.setAttribute('role','group');bindAttribute(menu,'aria-label','shell:map.moreLabel');
  more.id='hud-map-more';more.setAttribute('aria-controls',menu.id);more.setAttribute('aria-expanded','false');list.textContent='场所';
  const logs=button('',()=>document.dispatchEvent(new Event('hud:world-logs')));logs.id='hud-open-world-logs';bindAttribute(logs,'aria-label','shell:dock.logs');bindAttribute(logs,'title','shell:dock.logs');logs.append(icon('document'),el('span','',msg('shell:dock.logs')));
  fit.replaceChildren(icon('world'),el('span','',msg('public:home.fitMap')));list.replaceChildren(icon('place'),el('span','',msg('public:home.places')));more.replaceChildren(icon('more'),el('span','',msg('shell:map.more')));
  menu.append(document.querySelector('#world-explore'),document.querySelector('#world-reset'),document.querySelector('#world-pause'),document.querySelector('#world-learn'));
  const expressionSettings=el('div','world-expression-settings');for(const[id,label,options]of [['world-expression-density','地图气泡',[['standard','标准 · 最多2个'],['quiet','安静 · 最多1个'],['off','关闭']]],['world-expression-style','表情样式',expressionPolicy.sets.map(set=>[set.id,set.name])]]){const field=el('label'),select=el('select');select.id=id;select.setAttribute('aria-label',label);for(const[value,text]of options){const option=el('option','',text);option.value=value;select.append(option);}field.append(el('span','',label),select);expressionSettings.append(field);}menu.append(expressionSettings);
  for(const [href,key,symbol]of [['/releases','public:nav.releases','document'],['/kanban','public:nav.kanban','record']]){const link=el('a');link.href=localePath(href);link.dataset.localeLink=href;link.append(icon(symbol),el('span','',msg(key)));menu.append(link);}
  const actions=el('div','hud-map-actions');actions.append(fit,list,logs,more);controls.classList.add('hud-map-tools');controls.replaceChildren(zoom,actions,menu);root.append(controls);
  function close(restore=false){if(menu.hidden)return;menu.hidden=true;more.setAttribute('aria-expanded','false');if(restore)more.focus({preventScroll:true});}
  function toggle(){menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden));}
  menu.addEventListener('click',event=>{if(event.target.closest('button,a'))close(true);});
  const outside=event=>{if(!controls.contains(event.target))close();};document.addEventListener('pointerdown',outside);
  function labels(){const pause=document.querySelector('#world-pause'),text=t(pause.getAttribute('aria-pressed')==='true'?'public:home.resumeMotion':'public:home.pauseMotion');if(pause.textContent!==text)pause.textContent=text;}
  const observer=new MutationObserver(labels);observer.observe(document.querySelector('#world-pause'),{childList:true,attributes:true,attributeFilter:['aria-pressed']});observer.observe(document.querySelector('#world-motion-status'),{childList:true});labels();
  const stopLocale=onLocaleChange(labels);return{node:controls,get menuOpen(){return !menu.hidden;},closeMenu:close,setVisible(value){controls.hidden=!value;if(!value)close();},destroy(){stopLocale();observer.disconnect();document.removeEventListener('pointerdown',outside);}};
}
