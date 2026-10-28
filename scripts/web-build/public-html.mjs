import {parse,serialize} from 'parse5';
import {readFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {IntlMessageFormat} from '../../apps/web/public/i18n/vendor/formatjs.js';

export const PUBLIC_HTML_LOCALES=Object.freeze(['en','zh-CN']);
export const PUBLIC_HTML_PAGES=Object.freeze(['index','resident','releases','kanban','owner']);
const profile={index:['home.title','home.description','/'],owner:['home.title','home.description',null],resident:['resident.title','resident.description',null],releases:['releases.title','releases.lead','/releases'],kanban:['kanban.title','kanban.lead','/kanban']};
export function publicHtmlScope({publicOrigin=process.env.WEB_PUBLIC_ORIGIN,publishedLocales=process.env.WEB_PUBLISHED_LOCALES}={}){
 const languages=typeof publishedLocales==='string'?publishedLocales.split(',').map(value=>value.trim()).filter(Boolean):publishedLocales??[];
 if(!Array.isArray(languages)||languages.length>2||languages.some(value=>!PUBLIC_HTML_LOCALES.includes(value))||new Set(languages).size!==languages.length)throw new Error('Invalid explicitly published HTML languages');
 let origin=null;
 if(publicOrigin){const url=new URL(publicOrigin);if(!['http:','https:'].includes(url.protocol)||url.origin!==publicOrigin||url.username||url.password)throw new Error('Expected a trusted exact public HTML origin');origin=url.origin;}
 return {publicOrigin:origin,publishedLocales:origin?[...languages].sort():[]};
}
const attrs=node=>Object.fromEntries((node.attrs??[]).map(attribute=>[attribute.name,attribute.value]));
function attribute(node,name,value){node.attrs??=[];const old=node.attrs.find(attribute=>attribute.name===name);if(old)old.value=String(value);else node.attrs.push({name,value:String(value)});}
function text(value){return {nodeName:'#text',value:String(value)};}
function children(node,values){node.childNodes=values;for(const child of values)child.parentNode=node;return node;}
function element(tag,attributes={},values=[]){return children({nodeName:tag,tagName:tag,namespaceURI:'http://www.w3.org/1999/xhtml',attrs:Object.entries(attributes).map(([name,value])=>({name,value:String(value)}))},values);}
function content(node,value){children(node,[text(value)]);}
function visit(node,callback){if(callback(node)===false)return;for(const child of node.childNodes??[])visit(child,callback);}
function find(document,predicate){let found;visit(document,node=>{if(!found&&predicate(node))found=node;});return found;}
function metadata(document,{locale,title,description,indexable=false,canonical,alternates=[]}={}){
 const html=find(document,node=>node.tagName==='html'),head=find(document,node=>node.tagName==='head');if(locale)attribute(html,'lang',locale);
 if(title!==undefined){let node=head.childNodes.find(node=>node.tagName==='title');if(!node){node=element('title');head.childNodes.push(node);}content(node,title);}
 head.childNodes=head.childNodes.filter(node=>{const a=attrs(node);return !(node.tagName==='meta'&&(a.name==='robots'||description!==undefined&&a.name==='description')||node.tagName==='link'&&(a.rel==='canonical'||a.rel==='alternate'&&a.hreflang));});
 if(description!==undefined)head.childNodes.push(element('meta',{name:'description',content:description}));
 if(!indexable)head.childNodes.push(element('meta',{name:'robots',content:'noindex'}));
 if(canonical)head.childNodes.push(element('link',{rel:'canonical',href:canonical}));
 for(const {language,url}of alternates)head.childNodes.push(element('link',{rel:'alternate',hreflang:language,href:url}));
}
export function legacyPublicHtml(html){const document=parse(html);metadata(document);return serialize(document);}
function localizedPath(path,locale){
 if(!path.startsWith('/')||path.startsWith('//'))return path;
 const match=path.match(/^([^?#]*)([\s\S]*)$/),logical=match[1].replace(/^\/(?:en|zh-CN)(?=\/|$)/,'')||'/';
 return /^(?:\/|\/(?:owner|releases|kanban|intro)\/?|\/residents\/[^/]+\/?)$/.test(logical)?'/'+locale+(logical==='/'?'/':logical)+match[2]:path;
}
/** Fixed reviewed files only. Neither request input, templates nor user profile text selects a module. */
export async function publicHtmlInputs({publicRoot,source=path=>readFile(path)}){
 publicRoot=await realpath(publicRoot);
 try{await realpath(resolve(publicRoot,'locales/public/en.json'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const read=async name=>{const path=resolve(publicRoot,name);if(await realpath(path)!==path)throw new Error('Public HTML inputs must be regular contained files');return source(path);};
 const dictionaries={};for(const locale of PUBLIC_HTML_LOCALES){dictionaries[locale]={};for(const namespace of ['common','public','shell','kanban','releases'])dictionaries[locale][namespace]=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read('locales/'+namespace+'/'+locale+'.json')));}
 const data={};for(const name of ['releases-data.js','kanban-data.js']){const bytes=await read(name),digest=createHash('sha256').update(bytes).digest('hex');data[name]=await import(pathToFileURL(resolve(publicRoot,name)).href+'?public-content='+digest);}
 return {dictionaries,releases:data['releases-data.js'].RELEASES,columns:data['kanban-data.js'].BOARD_COLUMNS,cards:[...data['kanban-data.js'].MAP_CARDS,...data['kanban-data.js'].LIFE_CARDS]};
}
export function localizedPublicHtml(html,{page,locale,inputs,scope=publicHtmlScope()}={}){
 if(!PUBLIC_HTML_LOCALES.includes(locale)||!PUBLIC_HTML_PAGES.includes(page))throw new Error('Unsupported public HTML variant');
 const cache=new Map(),t=(key,parameters)=>{
  const colon=key.indexOf(':'),namespace=key.slice(0,colon),name=key.slice(colon+1),message=inputs.dictionaries[locale]?.[namespace]?.[name];
  if(typeof message!=='string')throw new Error('Missing public HTML message: '+key);
  if(!cache.has(key))cache.set(key,new IntlMessageFormat(message,locale,undefined,{ignoreTag:true}));const result=cache.get(key).format(parameters);if(typeof result!=='string')throw new Error('Expected plain public HTML text');return result;
 };
 const translated=(tag,key,className='')=>element(tag,{'data-i18n':key,...(className?{class:className}:{})},[text(t(key))]);
 const document=parse(html,{scriptingEnabled:false});
 visit(document,node=>{if(!node.tagName)return;const a=attrs(node);if(Object.hasOwn(a,'data-i18n-deferred'))return false;
  if(a['data-i18n'])content(node,t(a['data-i18n']));
  for(const name of ['placeholder','title','aria-label'])if(a['data-i18n-'+name])attribute(node,name,t(a['data-i18n-'+name]));
  if(a['data-locale-link'])attribute(node,'href',localizedPath(a['data-locale-link'],locale));
 });
 const host=id=>find(document,node=>attrs(node).id===id);
 if(page==='releases'){
  const list=host('release-list');if(!list)throw new Error('Missing reviewed release list host');children(list,inputs.releases.map(release=>{
   const title=element('h2',{},[text('v'+release.version+' · '),translated('span',`releases:releases.${release.version}.title`)]),date=element('time',{datetime:release.date},[text(release.date.replaceAll('-','.'))]);
   const status=release.status==='已完成'?t('public:releases.status.completed'):release.status;
   const card=element('article',{class:'paper-sheet release-card','data-release-version':release.version},[element('div',{class:'release-heading'},[title,element('div',{class:'release-meta'},[date,element('span',{class:'release-status'},[text(status)])])])]);
   for(const [category,key]of [['新增','added'],['优化','improved'],['修复','fixed']]){
    const changes=release.highlights.map((change,index)=>({change,index})).filter(({change})=>change.category===category);if(!changes.length)continue;
    card.childNodes.push(element('section',{class:'release-group'},[translated('h3','public:releases.category.'+key),element('ul',{class:'release-points'},changes.map(({index})=>element('li',{},[translated('strong',`releases:releases.${release.version}.summary.${index}.title`),translated('p',`releases:releases.${release.version}.summary.${index}.description`)])))]));
   }return card;
  }));
 }
 if(page==='kanban'){
  const introduction=host('world-introduction'),board=host('map-board');if(!introduction||!board)throw new Error('Missing reviewed development board hosts');
  children(introduction,[element('article',{class:'paper-sheet world-intro-card'},[translated('h2','kanban:world.directionTitle'),translated('p','kanban:world.goal','world-goal'),translated('p','kanban:world.vision')]),element('article',{class:'paper-sheet world-intro-card'},[translated('h2','kanban:world.townTitle'),translated('p','kanban:world.town')])]);
  children(board,inputs.columns.map(column=>{
   const cards=inputs.cards.filter(card=>card.column===column.id);if(column.id==='completed')cards.sort((a,b)=>b.completedVersion.localeCompare(a.completedVersion,undefined,{numeric:true}));
   const title=translated('h2',`kanban:columns.${column.id}.title`);attribute(title,'id','board-'+column.id);const heading=element('div',{class:'board-heading'},[title]);if(column.id!=='voting')heading.childNodes.push(element('span',{class:'board-count'},[text(t('kanban:count',{count:cards.length}))]));
   const section=element('section',{class:'board-column','data-column':column.id,'aria-labelledby':'board-'+column.id},[heading]);
   for(const card of cards){const scopeText=t(`kanban:cards.${card.id}.scope`),completed=column.id==='completed'&&/^\d+\.\d+\.\d+$/.test(card.completedVersion??'');const item=element('article',{class:'paper-sheet board-card','data-card':card.id},[translated('h3',`kanban:cards.${card.id}.title`),translated('p',`kanban:cards.${card.id}.description`),element('span',{class:'board-card-scope'},[text(completed?t('kanban:completedScope',{scope:scopeText,version:card.completedVersion}):scopeText)])]);
    if(completed&&card.id==='map-atlas'&&card.experienceHref==='/?atlas=1')item.childNodes.push(element('a',{href:localizedPath(card.experienceHref,locale),'data-locale-link':card.experienceHref},[text(t('public:kanban.openAtlas'))]));section.childNodes.push(item);
   }
   if(!cards.length)section.childNodes.push(translated('p',`kanban:columns.${column.id}.empty`,'board-empty'));return section;
  }));
 }
 if(page==='releases'||page==='kanban')visit(document,node=>{if(node.tagName==='noscript'){node.parentNode.childNodes=node.parentNode.childNodes.filter(child=>child!==node);return false;}});
 const [title,description,path]=profile[page],indexable=path!==null&&scope.publicOrigin!==null&&scope.publishedLocales.includes(locale),absolute=language=>scope.publicOrigin+'/'+language+(path==='/'?'/':path);
 metadata(document,{locale,title:t('public:'+title),description:t('public:'+description),indexable,canonical:indexable?absolute(locale):undefined,alternates:indexable?[...scope.publishedLocales.map(language=>({language,url:absolute(language)})),...(scope.publishedLocales.includes('en')?[{language:'x-default',url:absolute('en')}]:[])]:[]});
 return serialize(document,{scriptingEnabled:false});
}
