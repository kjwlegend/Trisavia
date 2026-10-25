import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildWeb} from '../../scripts/web-build/build.mjs';
import {loadProductionWebAssets} from '../../apps/platform/transport/http/web-assets.ts';
const checkout=resolve(fileURLToPath(new URL('../../',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(parent=tmpdir()){const root=await mkdtemp(join(parent,'trisavia-web-build-')),pub=resolve(root,'apps/web/public');await mkdir(resolve(pub,'nested'),{recursive:true});await mkdir(resolve(root,'scripts'),{recursive:true});for(const file of ['package.json','package-lock.json','scripts/build-web.mjs'])await cp(resolve(checkout,file),resolve(root,file));await cp(resolve(checkout,'scripts/web-build'),resolve(root,'scripts/web-build'),{recursive:true});await cp(resolve(checkout,'apps/web/public/brand'),resolve(pub,'brand'),{recursive:true});
 await mkdir(resolve(pub,'world-life'),{recursive:true});await writeFile(resolve(pub,'world-life/world-map-life-b-v1.json'),JSON.stringify({id:'synthetic-life-b-layout',version:1}));await writeFile(resolve(pub,'world-life/world-map-life-c-v1.json'),JSON.stringify({id:'synthetic-life-c-layout',version:1}));await writeFile(resolve(pub,'world-life/spatial-manifest-c-v1.json'),JSON.stringify({id:'synthetic-life-c-spatial',version:1}));
 await writeFile(resolve(pub,'world-map-life-v1.json'),JSON.stringify({id:'synthetic-life-layout',version:1}));
 const html='<link rel="icon" href="/assets/brand/trisavia-02/trisavia-small-mark-framed.performance.svg"><link rel="stylesheet" href="/assets/first.css"><link rel="stylesheet" href="/assets/nested/second.css"><script type="module" src="/assets/entry.js"></script><a href="/owner">Owner</a><a href="/residents/A001">Resident</a><img src="/assets/brand/trisavia-02/trisavia-nav-lockup.performance.svg">';for(const name of ['index','resident','releases','kanban'])await writeFile(resolve(pub,name+'.html'),html);await writeFile(resolve(pub,'first.css'),'.fixture {--first:1;color:red}');await writeFile(resolve(pub,'nested/second.css'),'.fixture {--second:2;color:blue;background:url("./sprite.png?variant=1#part")}');await writeFile(resolve(pub,'nested/sprite.png'),'fixture static asset');await writeFile(resolve(pub,'entry.js'),'import {value} from "./nested/dependency.js";globalThis.fixture=value;globalThis.loginMarkup=`<img src="/assets/brand/trisavia-02/trisavia-nav-lockup.svg">`;');await writeFile(resolve(pub,'nested/dependency.js'),'export const value=new URL("./sprite.png",import.meta.url).href+"first-input";');return {root,pub};}

test('build is reproducible, preserves source-relative URLs/CSS order and exact brand aliases, and hashes actual content',async()=>{const f=await fixture();try{const first=await buildWeb({root:f.root}),repeat=await buildWeb({root:f.root});assert.deepEqual(repeat,first);assert.equal(first.appVersion,JSON.parse(await readFile(resolve(f.root,'package.json'),'utf8')).version);assert.equal(first.assets.length,10);assert.deepEqual(Object.keys(first.pages),['index','resident','releases','kanban']);for(const name of ['releases','kanban']){assert.equal(first.pages[name].file,name+'.html');const page=await readFile(resolve(f.root,'dist/web',first.pages[name].file),'utf8');assert.equal((page.match(/rel="stylesheet"/g)||[]).length,1);assert.equal((page.match(/type="module"/g)||[]).length,1);}const html=await readFile(resolve(f.root,'dist/web/index.html'),'utf8');assert.equal((html.match(/rel="stylesheet"/g)||[]).length,1);assert.equal((html.match(/type="module"/g)||[]).length,1);assert(html.includes('/owner'));assert(html.includes('/residents/A001'));for(const asset of first.assets){const bytes=await readFile(resolve(f.root,'dist/web',asset.file));assert.equal(sha(bytes),asset.sha256);assert.equal(bytes.length,asset.bytes);assert(asset.url.includes(asset.sha256.slice(0,16)));}
 const js=await readFile(resolve(f.root,'dist/web',first.assets.find(a=>a.file.startsWith('build/index-')&&a.file.endsWith('.js')).file),'utf8'),css=await readFile(resolve(f.root,'dist/web',first.assets.find(a=>a.file.startsWith('build/index-')&&a.file.endsWith('.css')).file),'utf8');assert(js.includes('/assets/nested/dependency.js'));assert(!js.includes('/assets/brand/trisavia-02/trisavia-nav-lockup.svg'));assert(js.includes(first.assets.find(a=>a.file.includes('trisavia-nav-lockup')).url));assert(css.indexOf('--first')<css.indexOf('--second'));assert(css.includes('/assets/nested/sprite.png?variant=1#part'));assert(first.sources.some(s=>s.file==='apps/web/public/nested/dependency.js'));assert(first.sources.some(s=>s.file==='package-lock.json'));
 await writeFile(resolve(f.pub,'nested/dependency.js'),'export const value="new-input";');const changed=await buildWeb({root:f.root});assert.notEqual(changed.assets.find(a=>a.file.startsWith('build/index-')&&a.file.endsWith('.js')).url,first.assets.find(a=>a.file.startsWith('build/index-')&&a.file.endsWith('.js')).url);assert.deepEqual(changed.assets.filter(a=>a.file.endsWith('.svg')),first.assets.filter(a=>a.file.endsWith('.svg')));
 await rm(resolve(f.pub,'nested/dependency.js'));await assert.rejects(()=>buildWeb({root:f.root}));await assert.rejects(()=>readFile(resolve(f.root,'dist/web/manifest.json')));
 }finally{await rm(f.root,{recursive:true,force:true});}});

test('different checkout roots and absent or conflicting parent tsconfigs produce identical complete manifests',async()=>{
 const parents=await Promise.all(['checkout','archive'].map(name=>mkdtemp(join(tmpdir(),'trisavia-'+name+'-'))));
 try{
  await writeFile(resolve(parents[0],'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,alwaysStrict:true}}));
  await writeFile(resolve(parents[1],'tsconfig.json'),JSON.stringify({compilerOptions:{strict:false,alwaysStrict:false}}));
  const [checkoutFixture,archiveFixture]=await Promise.all(parents.map(parent=>fixture(parent)));
  for(const f of [checkoutFixture,archiveFixture]){
   await writeFile(resolve(f.pub,'entry.js'),'globalThis.loadFixture=()=>import("./nested/dynamic.js");');
   await writeFile(resolve(f.pub,'nested/dynamic.js'),'export const value=new URL("./sprite.png",import.meta.url).href;');
  }
  const expected=await buildWeb({root:checkoutFixture.root});
  assert.deepEqual(await buildWeb({root:archiveFixture.root}),expected,'conflicting parent tsconfig must not change any page, asset or source digest');
  await rm(resolve(parents[1],'tsconfig.json'));
  assert.deepEqual(await buildWeb({root:archiveFixture.root}),expected,'archive without tsconfig must equal checkout');
  await writeFile(resolve(archiveFixture.root,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:false,alwaysStrict:false}}));
  assert.deepEqual(await buildWeb({root:archiveFixture.root}),expected,'conflicting checkout tsconfig must be ignored');
 }finally{for(const parent of parents)await rm(parent,{recursive:true,force:true});}
});

test('imported JSON and explicit life geometry reject stale production bundles and rebuild with new source digests',async()=>{
 const f=await fixture();try{
  await mkdir(resolve(f.pub,'world-life'),{recursive:true});
  const imported=['world-life/asset-manifest.json','world-life/spatial-manifest.json','nested/imported.json'];
  for(const [i,file]of imported.entries())await writeFile(resolve(f.pub,file),JSON.stringify({value:'initial-'+i}));
  await writeFile(resolve(f.pub,'entry.js'),'import art from "./world-life/asset-manifest.json" with {type:"json"};import spatial from "./world-life/spatial-manifest.json" with {type:"json"};import extra from "./nested/imported.json" with {type:"json"};globalThis.fixture=art.value+spatial.value+extra.value;');
  const output=resolve(f.root,'dist/web'),first=await buildWeb({root:f.root}),source=(m,file)=>m.sources.find(s=>s.file==='apps/web/public/'+file);
  for(const file of [...imported,'world-map-life-v1.json'])assert.equal(source(first,file)?.sha256,sha(await readFile(resolve(f.pub,file))));
  assert.doesNotThrow(()=>loadProductionWebAssets(f.root,output));
  await writeFile(resolve(f.pub,imported[0]),JSON.stringify({value:'changed-art'}));
  assert.throws(()=>loadProductionWebAssets(f.root,output),/Production web assets are missing or invalid/);
  const changed=await buildWeb({root:f.root});assert.notEqual(source(changed,imported[0]).sha256,source(first,imported[0]).sha256);assert.notEqual(changed.assets.find(a=>a.file.startsWith('build/index-')&&a.file.endsWith('.js')).url,first.assets.find(a=>a.file.startsWith('build/index-')&&a.file.endsWith('.js')).url);assert.doesNotThrow(()=>loadProductionWebAssets(f.root,output));
  await writeFile(resolve(f.pub,'world-map-life-v1.json'),JSON.stringify({id:'synthetic-life-layout',version:2}));
  assert.throws(()=>loadProductionWebAssets(f.root,output),/Production web assets are missing or invalid/);
  const current=await buildWeb({root:f.root});assert.notEqual(source(current,'world-map-life-v1.json').sha256,source(changed,'world-map-life-v1.json').sha256);assert.deepEqual(current.assets,changed.assets,'runtime geometry changes the source manifest, not unrelated compiled assets');assert.doesNotThrow(()=>loadProductionWebAssets(f.root,output));
  const bFile='world-life/world-map-life-b-v1.json';assert.equal(source(current,bFile).sha256,sha(await readFile(resolve(f.pub,bFile))));await writeFile(resolve(f.pub,bFile),JSON.stringify({id:'synthetic-life-b-layout',version:2}));assert.throws(()=>loadProductionWebAssets(f.root,output),/Production web assets are missing or invalid/);const b=await buildWeb({root:f.root});assert.notEqual(source(b,bFile).sha256,source(current,bFile).sha256);assert.deepEqual(b.assets,current.assets);assert.doesNotThrow(()=>loadProductionWebAssets(f.root,output));
  for(const cFile of ['world-life/world-map-life-c-v1.json','world-life/spatial-manifest-c-v1.json']){const prior=await buildWeb({root:f.root});assert.equal(source(prior,cFile).sha256,sha(await readFile(resolve(f.pub,cFile))));await writeFile(resolve(f.pub,cFile),JSON.stringify({id:'changed-runtime-c-input',version:2}));assert.throws(()=>loadProductionWebAssets(f.root,output),/Production web assets are missing or invalid/);const after=await buildWeb({root:f.root});assert.notEqual(source(after,cFile).sha256,source(prior,cFile).sha256);assert.deepEqual(after.assets,prior.assets);assert.doesNotThrow(()=>loadProductionWebAssets(f.root,output));}
 }finally{await rm(f.root,{recursive:true,force:true});}
});
