import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
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

test('actual fixed WS07 public dictionaries parse with FormatJS and have identical named parameters in both languages',async t=>{
 const root=await mkdtemp(join(tmpdir(),'trisavia-ws07-dictionaries-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(resolve(root,'locales'));
 for(const namespace of ['common','shell','public','releases','kanban','help'])await cp(resolve(checkout,'apps/web/public/locales',namespace),resolve(root,'locales',namespace),{recursive:true});
 let count=0;const resources=await buildLocaleResources({publicRoot:root,source:path=>readFile(path),emit:async(name,ext,bytes)=>{count++;return {url:'/assets/build/'+name+'.'+ext,sha256:sha(bytes),bytes:bytes.length};}});
 assert.equal(Object.keys(resources.manifest.namespaces).length,6);assert.equal(count,12);assert.equal(resources.keys.size,612);
});
