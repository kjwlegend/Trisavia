import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import Fastify from 'fastify';
import {buildWeb} from '../../scripts/web-build/build.mjs';
import {buildLocaleResources} from '../../scripts/web-build/i18n-resources.mjs';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {loadProductionWebAssets} from '../../apps/platform/transport/http/web-assets.ts';
import {createI18n} from '../../apps/web/public/i18n/core.js';
import {INTRO_PACKAGE_ROOT,INTRO_PUBLISH_FILES,INTRO_ROUTES,introContentType} from '../../scripts/web-build/intro.mjs';
import {parse as parseHtml,serialize as serializeHtml} from 'parse5';
import {publicHtmlScope,publicHtmlInputs,localizedPublicHtml} from '../../scripts/web-build/public-html.mjs';

const checkout=resolve(fileURLToPath(new URL('../../',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'trisavia-i18n-build-')),pub=resolve(root,'apps/web/public');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(resolve(root,'scripts'),{recursive:true});await mkdir(pub,{recursive:true});
 for(const file of ['package.json','package-lock.json','scripts/build-web.mjs'])await cp(resolve(checkout,file),resolve(root,file));
 await cp(resolve(checkout,'scripts/web-build'),resolve(root,'scripts/web-build'),{recursive:true});
 for(const dir of ['brand','i18n'])await cp(resolve(checkout,'apps/web/public',dir),resolve(pub,dir),{recursive:true});
 for(const file of ['world-map-life-v1.json','world-life/world-map-life-b-v1.json','world-life/world-map-life-c-v1.json','world-life/world-map-expansion-v1.json','world-life/spatial-manifest-expansion-v1.json','world-life/spatial-manifest-c-v1.json','npc-life-v1/manifest.json','npc-life-v1/spatial-addon-v1.json']){await mkdir(resolve(pub,file,'..'),{recursive:true});await writeFile(resolve(pub,file),'{}');}
 const html='<html><link rel="stylesheet" href="/assets/style.css"><body><h1 data-i18n="common:ready">Readable original</h1><script type="module" src="/assets/entry.js"></script></body></html>';
 for(const page of ['index','resident','releases','kanban'])await writeFile(resolve(pub,page+'.html'),html);
 await writeFile(resolve(pub,'style.css'),'body {color:black}');await writeFile(resolve(pub,'entry.js'),'import {t} from "./i18n/core.js";globalThis.fixtureTitle=t("common:ready");');
 await mkdir(resolve(pub,'locales/common'),{recursive:true});
 for(const [locale,message]of [['en','English-only sentinel {name}'],['zh-CN','中文独立词条 {name}']])await writeFile(resolve(pub,'locales/common',locale+'.json'),JSON.stringify({ready:message}));
 return {root,pub};
}

test('production emits independently hashed ICU AST resources, keeps all dictionaries out of JS, and verifies exact source changes',async t=>{
 const f=await fixture(t),manifest=await buildWeb({root:f.root}),web=loadProductionWebAssets(f.root,resolve(f.root,'dist/web'));
 assert(web.localeManifest);const mapping=JSON.parse(await readFile(resolve(f.root,'dist/web',web.localeManifest.file),'utf8'));assert.equal(mapping.format,'icu-ast-v1');assert.deepEqual(Object.keys(mapping.namespaces),['common']);
 for(const locale of ['en','zh-CN']){const entry=mapping.namespaces.common[locale],asset=manifest.assets.find(a=>a.url===entry.url),bytes=await readFile(resolve(f.root,'dist/web',asset.file)),body=JSON.parse(bytes);assert.equal(sha(bytes),entry.sha256);assert.equal(bytes.length,entry.bytes);assert(Array.isArray(body.messages.ready));assert.equal(body.locale,locale);assert.notEqual(mapping.namespaces.common.en.url,mapping.namespaces.common['zh-CN'].url);}
 for(const asset of manifest.assets.filter(a=>a.file.endsWith('.js'))){const text=await readFile(resolve(f.root,'dist/web',asset.file),'utf8');assert(!text.includes('English-only sentinel'));assert(!text.includes('中文独立词条'));}
 for(const required of ['apps/web/public/i18n/vendor/formatjs.js','apps/web/public/i18n/vendor/provenance.json','apps/web/public/i18n/vendor/LICENSES.txt','scripts/web-build/i18n-vendor.mjs','scripts/web-build/i18n-resources.mjs','apps/web/public/locales/common/en.json'])assert(manifest.sources.some(s=>s.file===required),required);
 const manifestPath=resolve(f.root,'dist/web/manifest.json');
 for(const missing of ['apps/web/public/i18n/vendor/formatjs.js','scripts/web-build/i18n-vendor.mjs','apps/web/public/locales/common/en.json']){await writeFile(manifestPath,JSON.stringify({...manifest,sources:manifest.sources.filter(s=>s.file!==missing)}));assert.throws(()=>loadProductionWebAssets(f.root,resolve(f.root,'dist/web')),/Production web assets/);}
 const withoutMapping=structuredClone(manifest);delete withoutMapping.i18n;await writeFile(manifestPath,JSON.stringify(withoutMapping));assert.throws(()=>loadProductionWebAssets(f.root,resolve(f.root,'dist/web')),/Production web assets/);await writeFile(manifestPath,JSON.stringify(manifest));
 await writeFile(resolve(f.pub,'locales/common/en.json'),JSON.stringify({ready:'Changed {name}'}));assert.throws(()=>loadProductionWebAssets(f.root,resolve(f.root,'dist/web')),/Production web assets/);
 const next=await buildWeb({root:f.root});assert.notEqual(next.i18n.manifestUrl,manifest.i18n.manifestUrl);assert.deepEqual(next.assets.filter(a=>a.file.endsWith('.js')),manifest.assets.filter(a=>a.file.endsWith('.js')),'translation edits must not grow or invalidate the JS language-independent bundle');
});

test('source and production aliases preserve old routes; only hashed public dictionaries are immutable and machine/private paths do not acquire aliases',async t=>{
 const f=await fixture(t);await buildWeb({root:f.root});
 for(const mode of ['source','production']){
  const app=Fastify({logger:false});t.after(()=>app.close());registerSiteRoutes(app,{repoRoot:f.root,webRoot:f.pub,assetMode:mode});
  for(const path of ['/','/owner','/en','/en/','/en/owner','/zh-CN/residents/A001','/en/releases','/zh-CN/kanban']){const r=await app.inject(path);assert.equal(r.statusCode,200,path);assert.equal(r.headers['cache-control'],'no-store');assert.match(r.headers['content-security-policy'],/script-src 'self'/);}
  for(const path of ['/en/agent/runtime.md','/en/v1/capabilities','/fr/owner'])assert.equal((await app.inject(path)).statusCode,404,path);
  const resources=await app.inject('/assets/i18n/manifest.json');assert.equal(resources.statusCode,200);assert.equal(resources.headers['cache-control'],'no-store');const mapping=resources.json();assert.equal(mapping.format,mode==='production'?'icu-ast-v1':'icu-message-v1');
  const requests=[],runtime=createI18n({navigator:{languages:['en']},fetch:async(url,options)=>{requests.push({url,options});const r=await app.inject(url);return new Response(r.rawPayload,{status:r.statusCode,headers:r.headers});}});
  await runtime.initI18n();assert.equal(runtime.t('common:ready',{name:'Ada'}),'English-only sentinel Ada');assert.equal(await runtime.setLocale('zh-CN'),true);assert.equal(runtime.t('common:ready',{name:'Ada'}),'中文独立词条 Ada');assert.equal(requests.filter(r=>r.url.includes('zh-CN')).length,1);
  const url=mapping.namespaces.common.en.url,response=await app.inject({url,headers:{cookie:'synthetic-header-only=1',authorization:'Bearer synthetic-header-only'}});assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],mode==='production'?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
  if(mode==='production'){assert.equal((await app.inject('/assets/locales/common/en.json')).statusCode,404);const asset=JSON.parse(await readFile(resolve(f.root,'dist/web/manifest.json'),'utf8')).assets.find(a=>a.url===url);await writeFile(resolve(f.root,'dist/web',asset.file),'{}');const broken=await app.inject(url);assert.equal(broken.statusCode,503);assert.equal(broken.headers['cache-control'],'no-store');}
 }
});

test('ICU parsing, same-key/parameter contracts and declared missing keys fail the build instead of publishing partial translations',async t=>{
 const f=await fixture(t);
 await writeFile(resolve(f.pub,'locales/common/en.json'),JSON.stringify({ready:'{count, plural, one {one} other {many}}'}));await assert.rejects(()=>buildWeb({root:f.root}),/named parameters differ/);
 await writeFile(resolve(f.pub,'locales/common/en.json'),JSON.stringify({ready:'{name'}));await assert.rejects(()=>buildWeb({root:f.root}));
 await writeFile(resolve(f.pub,'locales/common/en.json'),JSON.stringify({ready:'Hello {name}'}));await writeFile(resolve(f.pub,'entry.js'),'import {t} from "./i18n/core.js";globalThis.fixtureTitle=t("common:absent");');await assert.rejects(()=>buildWeb({root:f.root}),/Declared i18n message.*common:absent/);
});

test('actual common errorKey and explicit dynamic prefixes do not become fake complete dictionary keys',async t=>{
 const f=await fixture(t);await cp(resolve(checkout,'apps/web/public/common.js'),resolve(f.pub,'common.js'));
 for(const locale of ['en','zh-CN'])await cp(resolve(checkout,'apps/web/public/locales/common',locale+'.json'),resolve(f.pub,'locales/common',locale+'.json'));
 for(const page of ['index','resident','releases','kanban']){const path=resolve(f.pub,page+'.html');await writeFile(path,(await readFile(path,'utf8')).replace('common:ready','common:action.retry'));}
 const entry='import {errorText} from "./common.js";import {t} from "./i18n/core.js";const code="field_locked";globalThis.fixtureTitle=errorText({code,status:403})+t("common:error."+code)+t(`common:${code}`);';
 await writeFile(resolve(f.pub,'entry.js'),entry);await buildWeb({root:f.root});
 await writeFile(resolve(f.pub,'entry.js'),entry+'globalThis.invalid=t("common:missingComplete");');await assert.rejects(()=>buildWeb({root:f.root}),/Declared i18n message.*common:missingComplete/);
});

test('official content indices are required only for their namespace and changing an index invalidates the production source',async t=>{
 const f=await fixture(t),index='i18n/content-sources/world-content.json',root=resolve(f.root,'dist/web');
 const before=await buildWeb({root:f.root});assert(!before.sources.some(source=>source.file.includes('/content-sources/')));
 await cp(resolve(checkout,'apps/web/public/locales/world-content'),resolve(f.pub,'locales/world-content'),{recursive:true});
 const original=await readFile(resolve(f.pub,index)),first=await buildWeb({root:f.root});assert(first.sources.some(source=>source.file==='apps/web/public/'+index));assert(!first.sources.some(source=>source.file.endsWith('/content-sources/life-content.json')));assert.doesNotThrow(()=>loadProductionWebAssets(f.root,root));
 const changed=JSON.parse(original);changed.files[0].meaning+=' Updated audit note.';await writeFile(resolve(f.pub,index),JSON.stringify(changed));assert.throws(()=>loadProductionWebAssets(f.root,root),/Production web assets/);
 const next=await buildWeb({root:f.root});assert.notDeepEqual(next.sources,first.sources);assert.deepEqual(next.assets,first.assets,'the source index is not copied into a JS or all-language payload');
 await rm(resolve(f.pub,index));await assert.rejects(()=>buildWeb({root:f.root}));await writeFile(resolve(f.pub,index),original);
 const malformed=JSON.parse(original);malformed.namespace='life-content';await writeFile(resolve(f.pub,index),JSON.stringify(malformed));await assert.rejects(()=>buildWeb({root:f.root}),/Invalid official content source index/);
});

test('fixed official announcement projections compile with strict source metadata and reject unknown or malformed declarations',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'trisavia-official-projection-')));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const namespace of ['world-content','life-content']){await cp(resolve(checkout,'apps/web/public/locales',namespace),resolve(root,'locales',namespace),{recursive:true});await mkdir(resolve(root,'i18n/content-sources'),{recursive:true});await cp(resolve(checkout,'apps/web/public/i18n/content-sources',namespace+'.json'),resolve(root,'i18n/content-sources',namespace+'.json'));}
 const file=resolve(root,'i18n/content-sources/world-content.json'),bytes=await readFile(file),actual=JSON.parse(bytes),simple=actual.groups.find(g=>g.currentSource?.targetId),get=actual.groups.find(g=>g.currentSource?.method==='GET'),post=actual.groups.find(g=>g.currentSource?.method==='POST');assert(simple&&get&&post);assert.equal(post.selector.projection,'perception.detail');
 const build=()=>buildLocaleResources({publicRoot:root,source:path=>readFile(path),emit:async(name,_extension,body)=>({url:'/assets/build/'+name+'.json',sha256:sha(body),bytes:body.length})});
 const built=await build();assert.deepEqual(Object.keys(built.manifest.namespaces).sort(),['life-content','world-content']);assert(built.keys.has('world-content:'+post.fields.body));
 const mutations=[g=>{g.extra='unknown';},g=>{g.sourceEdition=1;},g=>{delete g.sourceEditionMeaning;},g=>{g.currentSource.extra=true;},g=>{g.currentSource.path='/v1/private/secret';},g=>{g.currentSource.method='DELETE';},g=>{g.currentSource.fieldMap.body='content.secret';},g=>{g.currentSource.stateFields.contentComplete='unknown.path';},g=>{g.currentSource.requireCompleteRecord=false;},g=>{g.currentSource.completion={};},g=>{g.currentSource.digestFields=['body'];},g=>{g.stateGuards.contentComplete=false;},g=>{g.selector.projection='other';}];
 for(const mutate of mutations){const changed=structuredClone(actual);mutate(changed.groups.find(g=>g.currentSource?.method==='POST'));await writeFile(file,JSON.stringify(changed));await assert.rejects(build,/Invalid official content source index/);}
 const changedGet=structuredClone(actual);changedGet.groups.find(g=>g.currentSource?.method==='GET').currentSource.idField='ownerId';await writeFile(file,JSON.stringify(changedGet));await assert.rejects(build,/Invalid official content source index/);
 const changedSimple=structuredClone(actual);changedSimple.groups.find(g=>g.currentSource?.targetId).currentSource.extra=true;await writeFile(file,JSON.stringify(changedSimple));await assert.rejects(build,/Invalid official content source index/);await writeFile(file,bytes);
 const lifeFile=resolve(root,'i18n/content-sources/life-content.json'),lifeBytes=await readFile(lifeFile),life=JSON.parse(lifeBytes);for(const badParent of [{path:'../outside',selector:'value'},{path:'apps/source.ts',selector:1},{path:'apps/source.ts',selector:'value',extra:true}]){const changed=structuredClone(life),group=changed.groups.find(g=>Object.values(g.locations).some(location=>location.parent));Object.values(group.locations).find(location=>location.parent).parent=badParent;await writeFile(lifeFile,JSON.stringify(changed));await assert.rejects(build,/Invalid official content source index/);}await writeFile(lifeFile,lifeBytes);
});

test('fixed life-content slash keys compile and load through source and production while missing complete slash keys still fail',async t=>{
 const f=await fixture(t),keys=['npcLifeMessage.npc-life/gardener/open.v1.text','npcLifeMessage.npc-life/system/gardener-away.v1.text'];await cp(resolve(checkout,'apps/web/public/locales/life-content'),resolve(f.pub,'locales/life-content'),{recursive:true});
 const entry='import {t} from "./i18n/core.js";globalThis.words=['+keys.map(key=>'t('+JSON.stringify('life-content:'+key)+')').join(',')+'];';await writeFile(resolve(f.pub,'entry.js'),entry);await buildWeb({root:f.root});
 const expected=JSON.parse(await readFile(resolve(f.pub,'locales/life-content/en.json'),'utf8'));
 for(const mode of ['source','production']){
  const app=Fastify({logger:false});t.after(()=>app.close());registerSiteRoutes(app,{repoRoot:f.root,webRoot:f.pub,assetMode:mode});const runtime=createI18n({navigator:{languages:['en']},fetch:async url=>{const r=await app.inject(url);return new Response(r.rawPayload,{status:r.statusCode,headers:r.headers});}});await runtime.initI18n({namespaces:['life-content']});for(const key of keys)assert.equal(runtime.t('life-content:'+key),expected[key]);
 }
 await writeFile(resolve(f.pub,'entry.js'),entry+'globalThis.invalid=t("life-content:npcLifeMessage.npc-life/missing.v1.text");');await assert.rejects(()=>buildWeb({root:f.root}),/Declared i18n message.*npc-life\/missing/);
});

test('authored intro publish files serve exact source/production locale routes with manifest and path protection',async t=>{
 const f=await fixture(t),packageRoot=resolve(f.root,INTRO_PACKAGE_ROOT),publish=resolve(packageRoot,'publish'),buildRoot=resolve(f.root,'dist/web');await mkdir(packageRoot,{recursive:true});await cp(resolve(checkout,INTRO_PACKAGE_ROOT,'publish'),publish,{recursive:true});await cp(resolve(checkout,INTRO_PACKAGE_ROOT,'ROUTES.md'),resolve(packageRoot,'ROUTES.md'));
 await writeFile(resolve(publish,'template.html'),'synthetic-private-not-published');const manifest=await buildWeb({root:f.root});assert.equal(manifest.intro.files.length,INTRO_PUBLISH_FILES.length);assert.equal(manifest.sources.filter(source=>source.file.startsWith(INTRO_PACKAGE_ROOT+'/')).length,INTRO_PUBLISH_FILES.length+1);assert(!manifest.sources.some(source=>source.file.endsWith('/publish/template.html')));await assert.rejects(()=>readFile(resolve(buildRoot,'intro/template.html')));assert.doesNotThrow(()=>loadProductionWebAssets(f.root,buildRoot));
 const apps={};
 for(const mode of ['source','production']){
  const app=apps[mode]=Fastify({logger:false});t.after(()=>app.close());registerSiteRoutes(app,{repoRoot:f.root,webRoot:f.pub,assetMode:mode});
  for(const {url,file}of INTRO_ROUTES){const response=await app.inject(url),expected=await readFile(resolve(publish,file));assert.equal(response.statusCode,200,url);assert.equal(sha(response.rawPayload),sha(expected),url);assert.equal(response.headers['content-type'],introContentType(file));assert.equal(response.headers['cache-control'],file.endsWith('.html')?'no-store':'public, max-age=0, must-revalidate');assert.match(response.headers['content-security-policy'],/script-src 'self'/);}
  for(const url of ['/intro/index.html','/intro/template.html','/intro/ROUTES.md','/intro/locales/en.json','/intro/build.py','/intro/tests/deck.test.cjs','/intro/assets/not-listed.png','/en/intro/style.css','/intro/..%2Fpackage.json']){const response=await app.inject(url);assert.equal(response.statusCode,404,url);assert(!response.body.includes('synthetic-private-not-published'));}
 }
 const deck=await readFile(resolve(publish,'deck.js'));await writeFile(resolve(publish,'deck.js'),Buffer.concat([deck,Buffer.from('\n// changed source')]));assert.throws(()=>loadProductionWebAssets(f.root,buildRoot),/Production web assets/);await writeFile(resolve(publish,'deck.js'),deck);
 await writeFile(resolve(buildRoot,'intro/deck.js'),'changed production bytes');const tampered=await apps.production.inject('/intro/deck.js');assert.equal(tampered.statusCode,503);assert.equal(tampered.headers['cache-control'],'no-store');assert.equal(tampered.headers.etag,undefined);
 await writeFile(resolve(f.root,'private.css'),'synthetic-private-not-published');await rm(resolve(publish,'style.css'));await symlink(resolve(f.root,'private.css'),resolve(publish,'style.css'));assert.equal((await apps.source.inject('/intro/style.css')).statusCode,404);
});

test('raw public HTML is localized from current public sources, binds canonical scope, and retains private/legacy noindex paths',async t=>{
 const f=await fixture(t),walk=node=>[node,...(node.childNodes??[]).flatMap(walk)],attributes=node=>Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value])),value=node=>node.nodeName==='#text'?node.value:(node.childNodes??[]).map(value).join('');
 for(const namespace of ['common','public','shell','kanban','releases'])await cp(resolve(checkout,'apps/web/public/locales',namespace),resolve(f.pub,'locales',namespace),{recursive:true});
 for(const locale of ['en','zh-CN']){const path=resolve(f.pub,'locales/common',locale+'.json'),messages=JSON.parse(await readFile(path,'utf8'));messages.ready=locale==='en'?'Ready {name}':'已准备 {name}';await writeFile(path,JSON.stringify(messages));}
 for(const name of ['releases-data.js','kanban-data.js'])await cp(resolve(checkout,'apps/web/public',name),resolve(f.pub,name));
 for(const page of ['index','resident','releases','kanban']){
  const document=parseHtml(await readFile(resolve(checkout,'apps/web/public',page+'.html'),'utf8')),all=walk(document),styles=all.filter(node=>node.tagName==='link'&&attributes(node).rel==='stylesheet');
  styles.forEach((node,index)=>{if(index===0)node.attrs.find(a=>a.name==='href').value='/assets/style.css';else node.parentNode.childNodes=node.parentNode.childNodes.filter(child=>child!==node);});
  const script=all.find(node=>node.tagName==='script'&&attributes(node).type==='module');script.attrs.find(a=>a.name==='src').value='/assets/entry.js';all.find(node=>node.tagName==='title').attrs.push({name:'data-probe',value:'A > B'});await writeFile(resolve(f.pub,page+'.html'),serializeHtml(document));
 }
 const options={publicOrigin:'https://published.example.test',publishedLocales:['en','zh-CN']},scope=publicHtmlScope(options),inputs=await publicHtmlInputs({publicRoot:f.pub}),manifest=await buildWeb({root:f.root,...options}),buildRoot=resolve(f.root,'dist/web');
 assert.deepEqual(manifest.localized.scope,scope);assert.throws(()=>loadProductionWebAssets(f.root,buildRoot,publicHtmlScope({publicOrigin:'https://not-published.example.test',publishedLocales:['en','zh-CN']})),/Production web assets/);
 for(const mode of ['source','production']){
  const app=Fastify({logger:false});t.after(()=>app.close());registerSiteRoutes(app,{repoRoot:f.root,webRoot:f.pub,assetMode:mode,...options});
  for(const locale of ['en','zh-CN'])for(const [url,page,titleKey,descriptionKey]of [['/','index','home.title','home.description'],['/releases','releases','releases.title','releases.lead'],['/kanban','kanban','kanban.title','kanban.lead'],['/residents/A001','resident','resident.title','resident.description']]){
   const response=await app.inject('/'+locale+(url==='/'?'/':url)),nodes=walk(parseHtml(response.body)),html=nodes.find(node=>node.tagName==='html'),title=nodes.find(node=>node.tagName==='title'),dictionary=inputs.dictionaries[locale].public;
   assert.equal(response.statusCode,200);assert.equal(attributes(html).lang,locale);assert.equal(value(title),dictionary[titleKey]);assert.equal(attributes(title)['data-probe'],'A > B');assert.equal(attributes(nodes.find(node=>node.tagName==='meta'&&attributes(node).name==='description')).content,dictionary[descriptionKey]);
   const links=nodes.filter(node=>node.tagName==='link'),canonical=links.find(node=>attributes(node).rel==='canonical'),alternates=links.filter(node=>attributes(node).rel==='alternate');
   if(page==='resident'){assert.equal(canonical,undefined);assert.equal(alternates.length,0);assert.equal(response.headers['x-robots-tag'],'noindex');assert.equal(value(nodes.find(node=>attributes(node).id==='resident-name')),'');}
   else{assert.equal(attributes(canonical).href,options.publicOrigin+'/'+locale+(url==='/'?'/':url));assert.deepEqual(alternates.map(node=>attributes(node).hreflang).sort(),['en','x-default','zh-CN']);assert.equal(response.headers['x-robots-tag'],undefined);}
   if(page==='releases'){const cards=nodes.filter(node=>attributes(node)['data-release-version']);assert.deepEqual(cards.map(node=>attributes(node)['data-release-version']),inputs.releases.map(release=>release.version));assert(value(cards[0]).includes(inputs.dictionaries[locale].releases[`releases.${inputs.releases[0].version}.title`]));}
   if(page==='kanban'){const cards=nodes.filter(node=>attributes(node)['data-card']);assert.deepEqual(cards.map(node=>attributes(node)['data-card']).sort(),inputs.cards.map(card=>card.id).sort());for(const card of cards)assert(value(card).includes(inputs.dictionaries[locale].kanban[`cards.${attributes(card)['data-card']}.title`]));}
   if(page==='kanban'||page==='releases')assert(!nodes.some(node=>node.tagName==='noscript'),'pre-rendered content no longer requires JavaScript to be read');
  }
  for(const path of ['/','/owner','/releases','/kanban','/residents/A001','/en/owner','/zh-CN/owner']){const r=await app.inject(path);assert.equal(r.statusCode,200);assert.equal(r.headers['x-robots-tag'],'noindex');assert.equal(r.headers.location,undefined);assert(!walk(parseHtml(r.body)).some(node=>node.tagName==='link'&&attributes(node).rel==='canonical'));}
 }
 const unpublished=localizedPublicHtml(await readFile(resolve(f.pub,'kanban.html'),'utf8'),{page:'kanban',locale:'en',inputs,scope:publicHtmlScope({publicOrigin:null,publishedLocales:[]})}),nodes=walk(parseHtml(unpublished));assert(!nodes.some(node=>node.tagName==='link'&&['canonical','alternate'].includes(attributes(node).rel)));assert.equal(attributes(nodes.find(node=>node.tagName==='meta'&&attributes(node).name==='robots')).content,'noindex');
 const file=manifest.localized.pages.en.kanban.file;await writeFile(resolve(buildRoot,file),'tampered localized HTML');assert.throws(()=>loadProductionWebAssets(f.root,buildRoot,scope),/Production web assets/);
});

test('actual fixed WS07 public dictionaries parse with FormatJS and have identical named parameters in both languages',async t=>{
 const root=await mkdtemp(join(tmpdir(),'trisavia-ws07-dictionaries-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(resolve(root,'locales'));
 const namespaces=['common','shell','public','releases','kanban','help'],expectedKeys=new Set(),expectedFiles=new Map(),compiledFiles=new Map();
 for(const namespace of namespaces){
  await cp(resolve(checkout,'apps/web/public/locales',namespace),resolve(root,'locales',namespace),{recursive:true});
  for(const locale of ['en','zh-CN']){
   const messages=JSON.parse(await readFile(resolve(root,'locales',namespace,locale+'.json'),'utf8')),keys=Object.keys(messages).sort();expectedFiles.set(namespace+'/'+locale,keys);
   for(const key of keys)expectedKeys.add(namespace+':'+key);
  }
  assert.deepEqual(expectedFiles.get(namespace+'/en'),expectedFiles.get(namespace+'/zh-CN'),namespace+' source keys must match');
 }
 const resources=await buildLocaleResources({publicRoot:root,source:path=>readFile(path),emit:async(name,ext,bytes)=>{
  const compiled=JSON.parse(bytes);compiledFiles.set(compiled.namespace+'/'+compiled.locale,Object.keys(compiled.messages).sort());return {url:'/assets/build/'+name+'.'+ext,sha256:sha(bytes),bytes:bytes.length};
 }});
 assert.deepEqual(Object.keys(resources.manifest.namespaces).sort(),[...namespaces].sort());assert.deepEqual(compiledFiles,expectedFiles);assert.deepEqual([...resources.keys].sort(),[...expectedKeys].sort());
});
