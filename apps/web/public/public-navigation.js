import {initI18n,getLocale,t,bindText,bindAttribute,applyI18n,onLocaleChange,setLocale,localePath,stripLocalePath} from './i18n/core.js';

// Only the server/build's existing publication declarations can authorize an
// absolute public URL. A local origin or a language preference is not publication.
function publishedHead(){
 const path=stripLocalePath(location.pathname),keys={'/':'public:home.description','/kanban':'public:kanban.lead','/releases':'public:releases.lead'},head=document.head;
 if(!Object.hasOwn(keys,path)||!/^\/(?:en|zh-CN)(?:\/|$)/.test(location.pathname)||[...head.querySelectorAll('meta[name="robots"]')].some(node=>/\bnoindex\b/i.test(node.content)))return null;
 const canonicals=head.querySelectorAll('link[rel="canonical"]'),alternates=[...head.querySelectorAll('link[rel="alternate"][hreflang]')];if(canonicals.length!==1||!alternates.length||alternates.length>3)return null;
 try{
  const canonical=canonicals[0],url=new URL(canonical.getAttribute('href')),published=new Map();if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!==localePath(path))return null;
  for(const node of alternates){const language=node.hreflang,locale=language==='x-default'?'en':language,href=new URL(node.getAttribute('href'));if(!['en','zh-CN'].includes(locale)||published.has(language)||href.origin!==url.origin||href.username||href.password||href.search||href.hash||href.pathname!==localePath(path,locale))return null;published.set(language,href.href);}
  if(published.get(getLocale())!==url.href||published.has('x-default')&&published.get('x-default')!==published.get('en'))return null;
  return{path,canonical,alternates,published,description:keys[path],robots:null};
 }catch{return null;}
}

/** Display-only language controls. Public links are explicitly opted in; private and machine URLs are untouched. */
export function mountPublicNavigation({namespaces=[]}={}){
 const metadata=publishedHead();
 const host=document.querySelector('header nav')||document.querySelector('header .nav-wrap'),field=document.createElement('label'),label=document.createElement('span'),select=document.createElement('select'),status=document.createElement('span');
 field.className='site-language-switch';label.className='site-language-label';status.className='site-language-status';status.setAttribute('role','status');select.id='site-language';select.name='site-language';
 const globe=document.createElementNS('http://www.w3.org/2000/svg','svg');globe.classList.add('site-language-icon');globe.setAttribute('viewBox','0 0 24 24');globe.setAttribute('fill','none');globe.setAttribute('stroke','currentColor');globe.setAttribute('stroke-width','1.7');globe.setAttribute('aria-hidden','true');const path=document.createElementNS(globe.namespaceURI,'path');path.setAttribute('d','M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z');globe.append(path);
 for(const [value,name]of [['zh-CN','ZH'],['en','EN']]){const option=document.createElement('option');option.value=value;option.lang=value;option.textContent=name;select.append(option);}field.append(label,globe,select);host?.append(field,status);
 let changing=false,stopStatus=()=>{};
 function updateLinks(){for(const link of document.querySelectorAll('a[data-locale-link]')){const original=link.dataset.localeLink||link.getAttribute('href');if(!original)continue;const url=new URL(original,location.origin);if(url.origin!==location.origin)continue;link.dataset.localeLink=original;link.setAttribute('href',localePath(stripLocalePath(url.pathname))+url.search+url.hash);}}
 function sync(){select.value=getLocale();bindText(label,'common:language.label');bindAttribute(select,'aria-label','common:language.label');applyI18n(document);updateLinks();if(metadata&&stripLocalePath(location.pathname)===metadata.path){const target=metadata.published.get(getLocale());if(target){metadata.canonical.href=target;document.head.append(metadata.canonical,...metadata.alternates);metadata.robots?.remove();metadata.robots=null;}else{metadata.canonical.remove();for(const node of metadata.alternates)node.remove();if(!metadata.robots){metadata.robots=document.createElement('meta');metadata.robots.name='robots';metadata.robots.content='noindex';document.head.append(metadata.robots);}}const description=document.querySelector('meta[name="description"]');if(description)description.content=t(metadata.description);}}
 const stop=onLocaleChange(sync);
 select.addEventListener('change',async()=>{if(changing)return;const hadFocus=document.activeElement===select;changing=true;select.disabled=true;stopStatus();status.textContent='';try{const changed=await setLocale(select.value,{source:'explicit',persist:true});if(!changed)stopStatus=bindText(status,'common:language.switchFailed');}catch{stopStatus=bindText(status,'common:language.switchFailed');}finally{changing=false;select.disabled=false;select.value=getLocale();if(hadFocus&&document.activeElement===document.body)select.focus({preventScroll:true});}});
 const ready=initI18n({namespaces:['common','public',...namespaces]}).then(()=>{sync();return true;}).catch(()=>{status.textContent=t('common:language.switchFailed');return false;});
 const dispose=()=>{stop();stopStatus();};window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
 return{ready,dispose,updateLinks};
}
