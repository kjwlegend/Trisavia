import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createI18n,msg,isMessage,stripLocalePath} from '../../apps/web/public/i18n/core.js';
import {errorText,errorMessage,stamp} from '../../apps/web/public/common.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
class Node {
 constructor(){this.textContent='';this.attributes=new Map();this.children=[];this.value='private draft';this.focused=true;}
 setAttribute(key,value){this.attributes.set(key,value);}
 getAttribute(key){return this.attributes.get(key)??null;}
 matches(){return [...this.attributes.keys()].some(key=>key.startsWith('data-i18n'));}
 querySelectorAll(){return this.children.filter(node=>node.matches());}
}
function fixture({pathname='/',device=null,language='en',dictionary={},hold}={}){
 const document={documentElement:{lang:''},querySelectorAll:()=>[]},location={pathname,search:'?view=one',hash:'#handoff=synthetic-private-only'},updates=[],stored=new Map(device?[['trisavia.locale',device]]:[]),storage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
 const window={location,history:{state:{selection:'A001'},replaceState(state,_,url){updates.push({state,url});const u=new URL(url,'https://example.test');Object.assign(location,{pathname:u.pathname,search:u.search,hash:u.hash});}}};
 const bodies=new Map(),manifest={version:1,format:'icu-message-v1',namespaces:{}};
 for(const ns of new Set(['common','shell',...Object.keys(dictionary)])){manifest.namespaces[ns]={};for(const locale of ['zh-CN','en']){const url=`/assets/locales/${ns}/${locale}.json`,body=JSON.stringify(dictionary[ns]?.[locale]??(locale==='en'?{'label':'Hello {name}','count':'{count, plural, one {# resident} other {# residents}}'}:{'label':'你好，{name}','count':'{count, plural, other {#位居民}}'}));bodies.set(url,body);manifest.namespaces[ns][locale]={url,sha256:sha(body),bytes:Buffer.byteLength(body)};}}
 const requests=[],fetch=async(url,options)=>{requests.push({url,options});await hold?.(url);return url==='/assets/i18n/manifest.json'?Response.json(manifest):new Response(bodies.get(url),{status:bodies.has(url)?200:404});};
 const i18n=createI18n({window,document,navigator:{languages:[language]},storage,fetch});return {i18n,document,location,updates,requests,stored,bodies,manifest};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('locale precedence, explicit public paths and sensitive fragments remain separate from machine paths',async()=>{
 for(const [pathname,device,language,locale,source]of [['/en/owner','zh-CN','zh-CN','en','explicit'],['/owner','zh-CN','en','zh-CN','device'],['/',null,'zh-TW','zh-CN','browser'],['/',null,'fr','en','fallback']]){const f=fixture({pathname,device,language});assert.equal(f.i18n.getLocale(),locale);assert.equal(f.i18n.getLocaleSource(),source);}
 const f=fixture({pathname:'/owner'});await f.i18n.initI18n();assert.equal(await f.i18n.setLocale('zh-CN',{source:'account'}),true);assert.equal(f.i18n.getLocaleSource(),'account');assert.equal(f.updates.length,0);
 assert.equal(await f.i18n.setLocale('en',{source:'explicit'}),true);assert.equal(f.updates[0].url,'/en/owner?view=one#handoff=synthetic-private-only');assert.deepEqual(f.updates[0].state,{selection:'A001'});assert.equal(f.stored.get('trisavia.locale'),'en');assert.equal(await f.i18n.setLocale('zh-CN',{source:'account'}),false);
 for(const path of ['/v1/capabilities','/agent/runtime.md','/assets/file.js','//other.example/owner','https://other.example/owner'])assert.equal(f.i18n.localePath(path,'zh-CN'),path);
 assert.equal(stripLocalePath('/zh-CN/residents/A001'),'/residents/A001');assert.equal(f.i18n.localePath('/en/releases?q=one#section','zh-CN'),'/zh-CN/releases?q=one#section');
});

test('selected-language namespaces, ICU plural/named parameters and explicit live bindings preserve form and selection state',async()=>{
 const f=fixture();await f.i18n.initI18n({namespaces:['shell']});assert.equal(f.requests.filter(r=>r.url.includes('/zh-CN.json')).length,0);assert.equal(f.i18n.t('shell:count',{count:2}),'2 residents');assert.equal(f.i18n.t('shell:label',{name:'<private name>'}),'Hello <private name>');assert.equal(f.i18n.t('shell:absent'),'[missing shell:absent]');
 const label=new Node(),input=new Node(),other=new Node();other.textContent='Owner original';f.i18n.bindText(label,'shell:label',{name:'Ada'});f.i18n.bindAttribute(input,'placeholder','shell:label',{name:'Ada'});
 assert.equal(await f.i18n.setLocale('zh-CN'),true);assert.equal(label.textContent,'你好，Ada');assert.equal(input.getAttribute('placeholder'),'你好，Ada');assert.equal(input.value,'private draft');assert.equal(input.focused,true);assert.equal(other.textContent,'Owner original');assert.equal(f.document.documentElement.lang,'zh-CN');
 f.i18n.bindText(label,'shell:count',{count:3});await f.i18n.setLocale('en');assert.equal(label.textContent,'3 residents');
 const descriptor=msg('shell:label',{name:'Ada'});assert.equal(isMessage(descriptor),true);assert.equal(isMessage('not a descriptor'),false);
 assert(f.requests.every(r=>r.options.credentials==='omit'&&r.options.redirect==='error'&&r.options.referrerPolicy==='no-referrer'));
});

test('a failed dictionary retains the complete prior UI, and a late language response cannot win a newer switch',async()=>{
 const blocked=deferred(),f=fixture({hold:url=>url.endsWith('/zh-CN.json')?blocked.promise:undefined});await f.i18n.initI18n({namespaces:['shell']});const label=new Node();f.i18n.bindText(label,'shell:label',{name:'A'});
 const older=f.i18n.setLocale('zh-CN'),newer=f.i18n.setLocale('en');assert.equal(await newer,true);blocked.resolve();assert.equal(await older,false);assert.equal(label.textContent,'Hello A');assert.equal(f.i18n.getLocale(),'en');
 const broken=fixture();await broken.i18n.initI18n();const node=new Node();broken.i18n.bindText(node,'common:label',{name:'B'});broken.bodies.set('/assets/locales/common/zh-CN.json','{}');assert.equal(await broken.i18n.setLocale('zh-CN'),false);assert.equal(node.textContent,'Hello B');assert.equal(broken.i18n.getLocale(),'en');assert.equal(broken.updates.length,0);
});

test('applyI18n touches only declared text/attributes and clearing a binding prevents stale message resurrection',async()=>{
 const f=fixture();await f.i18n.initI18n();const root=new Node(),label=new Node(),input=new Node();label.setAttribute('data-i18n','common:count');input.setAttribute('data-i18n-placeholder','common:count');root.children=[label,input];f.i18n.applyI18n(root);assert.equal(label.textContent,'[missing common:count]');
 f.i18n.bindText(label,'common:label',{name:'C'});f.i18n.clearBinding(label);label.textContent='new raw result';await f.i18n.setLocale('zh-CN');assert.equal(label.textContent,'new raw result');assert.equal(input.value,'private draft');
});

test('pending bindings preserve original labels and a failed optional namespace does not poison later switches',async()=>{
 const block=deferred(),f=fixture({hold:url=>url.endsWith('shell/en.json')?block.promise:undefined});
 await f.i18n.initI18n();const label=new Node();label.textContent='Readable original';f.i18n.bindText(label,'shell:label',{name:'D'});assert.equal(label.textContent,'Readable original');block.resolve();await f.i18n.ensureNamespaces(['shell']);assert.equal(label.textContent,'Hello D');
 const missing=new Node();missing.textContent='Original label';f.i18n.bindText(missing,'shell:missing');assert.equal(missing.textContent,'Original label [missing shell:missing]');
 await assert.rejects(()=>f.i18n.ensureNamespaces(['not-published']));assert.equal(await f.i18n.setLocale('zh-CN'),true);assert.equal(label.textContent,'你好，D');
});

test('shared error descriptors retain existing classification and never expose unrecognized error fields',()=>{
 assert.equal(errorMessage({code:'field_locked',status:403,details:'synthetic-private-detail'}).key,'common:error.field_locked');
 assert.equal(errorMessage({code:'any',status:503}).key,'common:error.resultUnknown');
 assert.equal(errorMessage({code:'toString',status:400}).key,'common:error.operationFailed');
 assert(!errorText({code:'any-private-code',status:400,details:'synthetic-private-detail'}).includes('synthetic-private-detail'));
 const now=1793188800000;assert.equal(stamp(now),new Date(now).toLocaleString('en',{hour12:false}));
});

test('the two fixed WS02 NPC message keys preserve stable slashes through ICU and explicit bindings',async()=>{
 const keys=['npcLifeMessage.npc-life/gardener/open.v1.text','npcLifeMessage.npc-life/system/gardener-away.v1.text'],messages={};
 for(const locale of ['en','zh-CN']){const source=JSON.parse(await readFile(new URL('../../apps/web/public/locales/life-content/'+locale+'.json',import.meta.url),'utf8'));messages[locale]=Object.fromEntries(keys.map(key=>[key,source[key]]));}
 const f=fixture({dictionary:{'life-content':messages}});await f.i18n.initI18n({namespaces:['life-content']});const nodes=keys.map(()=>new Node());
 for(const [index,key]of keys.entries()){f.i18n.bindText(nodes[index],'life-content:'+key);assert.equal(nodes[index].textContent,messages.en[key]);}
 assert.equal(await f.i18n.setLocale('zh-CN'),true);for(const [index,key]of keys.entries())assert.equal(nodes[index].textContent,messages['zh-CN'][key]);
 assert.throws(()=>msg('life/content:'+keys[0]),/namespace/);assert.equal(f.i18n.localePath('/agent/runtime.md'),'/agent/runtime.md');
});


test('an explicitly deferred account subtree is not registered or fetched until its owner activates it',async()=>{
 const f=fixture({dictionary:{shell:{en:{label:'Account UI'},'zh-CN':{label:'账户'}}}});await f.i18n.initI18n();
 const root=new Node(),account=new Node();account.textContent='账户原文';account.setAttribute('data-i18n','shell:label');account.closest=()=>root;root.children=[account];
 f.i18n.applyI18n(root);assert.equal(account.textContent,'账户原文');assert.equal(f.requests.some(r=>r.url.includes('/shell/')),false);
 account.closest=()=>null;f.i18n.applyI18n(root);await f.i18n.ensureNamespaces(['shell']);assert.equal(account.textContent,'Account UI');assert.equal(f.requests.filter(r=>r.url.includes('/shell/en.json')).length,1);
});

test('an account locale load invalidated asynchronously cannot mutate UI and cannot cancel its successor',async()=>{
 const block=deferred(),f=fixture({pathname:'/owner',hold:url=>url.endsWith('/zh-CN.json')?block.promise:undefined});await f.i18n.initI18n();
 const label=new Node(),changes=[];f.i18n.bindText(label,'common:label',{name:'E'});f.i18n.onLocaleChange(locale=>changes.push(locale));let owner='A';
 const old=f.i18n.setLocale('zh-CN',{source:'account',persist:false,isCurrent:()=>owner==='A'});owner='B';block.resolve();
 assert.equal(await old,false);assert.equal(f.i18n.getLocale(),'en');assert.equal(f.i18n.getLocaleSource(),'browser');assert.equal(label.textContent,'Hello E');assert.equal(f.document.documentElement.lang,'en');assert.deepEqual(changes,[]);assert.deepEqual(f.updates,[]);assert.equal(f.stored.size,0);
 const successor=f.i18n.setLocale('zh-CN',{source:'account',persist:false,isCurrent:()=>owner==='B'}),requests=f.requests.length;
 assert.equal(await f.i18n.setLocale('en',{source:'explicit',persist:true,isCurrent:()=>false}),false);assert.equal(f.requests.length,requests);
 assert.equal(await successor,true);assert.equal(label.textContent,'你好，E');assert.equal(f.i18n.getLocaleSource(),'account');assert.deepEqual(changes,['zh-CN']);assert.deepEqual(f.updates,[]);assert.equal(f.stored.size,0);
});
