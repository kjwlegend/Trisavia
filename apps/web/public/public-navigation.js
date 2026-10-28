import {initI18n,getLocale,t,bindText,bindAttribute,applyI18n,onLocaleChange,setLocale,localePath,stripLocalePath} from './i18n/core.js';

/** Display-only language controls. Public links are explicitly opted in; private and machine URLs are untouched. */
export function mountPublicNavigation({namespaces=[]}={}){
 const host=document.querySelector('header nav')||document.querySelector('header .nav-wrap'),field=document.createElement('label'),label=document.createElement('span'),select=document.createElement('select'),status=document.createElement('span');
 field.className='site-language-switch';label.className='site-language-label';status.className='site-language-status';status.setAttribute('role','status');select.id='site-language';select.name='site-language';
 for(const [value,name]of [['zh-CN','简体中文'],['en','English']]){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);}field.append(label,select);host?.append(field,status);
 let changing=false,stopStatus=()=>{};
 function updateLinks(){for(const link of document.querySelectorAll('a[data-locale-link]')){const original=link.dataset.localeLink||link.getAttribute('href');if(!original)continue;const url=new URL(original,location.origin);if(url.origin!==location.origin)continue;link.dataset.localeLink=original;link.setAttribute('href',localePath(stripLocalePath(url.pathname))+url.search+url.hash);}}
 function sync(){select.value=getLocale();bindText(label,'common:language.label');bindAttribute(select,'aria-label','common:language.label');applyI18n(document);updateLinks();}
 const stop=onLocaleChange(sync);
 select.addEventListener('change',async()=>{if(changing)return;const hadFocus=document.activeElement===select;changing=true;select.disabled=true;stopStatus();status.textContent='';try{const changed=await setLocale(select.value,{source:'explicit',persist:true});if(!changed)stopStatus=bindText(status,'common:language.switchFailed');}catch{stopStatus=bindText(status,'common:language.switchFailed');}finally{changing=false;select.disabled=false;select.value=getLocale();if(hadFocus&&document.activeElement===document.body)select.focus({preventScroll:true});}});
 const ready=initI18n({namespaces:['common','public',...namespaces]}).then(()=>{sync();return true;}).catch(()=>{status.textContent=t('common:language.switchFailed');return false;});
 const dispose=()=>{stop();stopStatus();};window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
 return{ready,dispose,updateLinks};
}
