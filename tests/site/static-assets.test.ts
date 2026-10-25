import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import Fastify from 'fastify';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {loadProductionWebAssets,WEB_MIME,webSha256} from '../../apps/platform/transport/http/web-assets.ts';

async function fixture(t:{after:(work:()=>Promise<void>)=>void}){
 const repoRoot=await mkdtemp(join(tmpdir(),'trisavia-static-'));t.after(()=>rm(repoRoot,{recursive:true,force:true}));
 const webRoot=join(repoRoot,'apps/web/public'),buildRoot=join(repoRoot,'dist/web');
 for(const path of [webRoot,join(buildRoot,'build'),join(repoRoot,'docs/access/v1'),join(repoRoot,'scripts')])await mkdir(path,{recursive:true});
 const write=async(path:string,body:string)=>{await writeFile(join(repoRoot,path),body);return {file:path,sha256:webSha256(Buffer.from(body))};};
 const sources=await Promise.all([
  write('package.json',JSON.stringify({name:'static-fixture',version:'0.1.1',type:'module'})),
  write('package-lock.json','{"lockfileVersion":3}'),
  write('scripts/build-web.mjs','// isolated build input'),
  write('apps/web/public/index.html','<html>source index</html>'),
  write('apps/web/public/resident.html','<html>source resident</html>'),
  write('apps/web/public/releases.html','<html>source releases</html>'),
  write('apps/web/public/kanban.html','<html>source kanban</html>'),
 ]);
 await write('docs/access/v1/entry.md','# Private protocol instructions');
 await write('scripts/m1-agent.ts','// optional reference client');
 await write('apps/web/public/plain.js','export const value=1;');
 await write('apps/web/public/world-map-v2.json',JSON.stringify({cells:'map'.repeat(1000)}));
 await write('apps/web/public/vector.svg','<svg xmlns="http://www.w3.org/2000/svg">'+('<rect width="1" height="1"/>'.repeat(200))+'</svg>');
 const asset=async(name:string,extension:string,body:string)=>{
  const sha256=webSha256(Buffer.from(body)),file='build/'+name+'-'+sha256.slice(0,16)+extension;
  await writeFile(join(buildRoot,file),body);
  return {url:'/assets/'+file,file,sha256,bytes:Buffer.byteLength(body),contentType:WEB_MIME[extension]!};
 };
 const assets=await Promise.all([asset('index','.js','export const text="'+('ready'.repeat(1000))+'";'),asset('index','.css','body {color: black;}')]);
 const html='<html><head><link rel="stylesheet" href="'+assets[1]!.url+'"></head><body>built<script type="module" src="'+assets[0]!.url+'"></script></body></html>';
 const page=async(file:string)=>{await writeFile(join(buildRoot,file),html);return {file,sha256:webSha256(Buffer.from(html)),bytes:Buffer.byteLength(html)};};
 const manifest={version:1,appVersion:'0.1.1',pages:{index:await page('index.html'),resident:await page('resident.html'),releases:await page('releases.html'),kanban:await page('kanban.html')},assets,sources};
 await writeFile(join(buildRoot,'manifest.json'),JSON.stringify(manifest));
 const app=Fastify({logger:false});t.after(()=>app.close());
 app.get('/v1/fixture',()=>({body:'public'.repeat(1000)}));
 registerSiteRoutes(app,{assetMode:'production',repoRoot,webRoot,buildRoot});
 return {repoRoot,webRoot,buildRoot,app,manifest,assets};
}
test('only validated hash assets are immutable; HTML, authenticated responses and APIs stay no-store',async t=>{
 const f=await fixture(t),url=f.assets[0]!.url;
 const asset=await f.app.inject(url);assert.equal(asset.statusCode,200);assert.equal(asset.headers['cache-control'],'public, max-age=31536000, immutable');assert.match(asset.headers.etag!,/^W\/"sha256-/);
 const again=await f.app.inject({url,headers:{'if-none-match':asset.headers.etag!}});assert.equal(again.statusCode,304);assert.equal(again.body,'');
 for(const path of ['/','/owner','/residents/A001','/releases','/kanban','/agent/entry.md','/v1/fixture']){
  const r=await f.app.inject({url:path,headers:{'if-none-match':'*'}});assert.equal(r.statusCode,200,path);assert.equal(r.headers['cache-control'],'no-store',path);assert.equal(r.headers.etag,undefined,path);
 }
 assert.match((await f.app.inject('/')).body,/built/);
 assert.match((await f.app.inject('/agent/entry.md')).headers['content-type']!,/^text\/markdown/);
 const auth=await f.app.inject({url,headers:{authorization:'Bearer isolated-synthetic','if-none-match':asset.headers.etag!}});assert.equal(auth.statusCode,200);assert.equal(auth.headers['cache-control'],'no-store');assert.equal(auth.headers.etag,undefined);
 assert.equal(asset.headers['x-content-type-options'],'nosniff');assert.equal(asset.headers['referrer-policy'],'no-referrer');assert.match(asset.headers['content-security-policy']!,/frame-ancestors 'none'/);
});
test('ordinary public files revalidate and changed content produces a new validator',async t=>{
 const f=await fixture(t);
 for(const url of ['/assets/plain.js','/world-map-v2.json']){
  const first=await f.app.inject(url);assert.equal(first.statusCode,200);assert.equal(first.headers['cache-control'],'public, max-age=0, must-revalidate');
  const cached=await f.app.inject({url,headers:{'if-none-match':'"other", '+first.headers.etag}});assert.equal(cached.statusCode,304);
 }
 const old=await f.app.inject('/assets/plain.js');await writeFile(join(f.webRoot,'plain.js'),'export const value=2;');
 const changed=await f.app.inject({url:'/assets/plain.js',headers:{'if-none-match':old.headers.etag!}});assert.equal(changed.statusCode,200);assert.notEqual(changed.headers.etag,old.headers.etag);
});
test('production rejects missing/stale manifests, invalid paths and changed files without source fallback',async t=>{
 const f=await fixture(t),manifestPath=join(f.buildRoot,'manifest.json');
 await rm(manifestPath);assert.throws(()=>loadProductionWebAssets(f.repoRoot,f.buildRoot),/Production web assets/);
 await writeFile(manifestPath,JSON.stringify(f.manifest));
 const oldPages=structuredClone(f.manifest) as {pages:Record<string,unknown>};delete oldPages.pages.releases;await writeFile(manifestPath,JSON.stringify(oldPages));assert.throws(()=>loadProductionWebAssets(f.repoRoot,f.buildRoot),/Production web assets/);
 const stale={...f.manifest,appVersion:'0.1.0'};await writeFile(manifestPath,JSON.stringify(stale));assert.throws(()=>loadProductionWebAssets(f.repoRoot,f.buildRoot),/Production web assets/);
 await writeFile(manifestPath,JSON.stringify(f.manifest));await writeFile(join(f.repoRoot,'scripts/build-web.mjs'),'// changed build input');assert.throws(()=>loadProductionWebAssets(f.repoRoot,f.buildRoot),/Production web assets/);
 await writeFile(join(f.repoRoot,'scripts/build-web.mjs'),'// isolated build input');
 const bad=structuredClone(f.manifest);bad.assets[0]!.file='../outside.js';await writeFile(manifestPath,JSON.stringify(bad));assert.throws(()=>loadProductionWebAssets(f.repoRoot,f.buildRoot),/Production web assets/);
 await writeFile(manifestPath,JSON.stringify(f.manifest));
 const first=await f.app.inject(f.assets[0]!.url);await writeFile(join(f.buildRoot,f.assets[0]!.file),'tampered');
 const tampered=await f.app.inject({url:f.assets[0]!.url,headers:{'if-none-match':first.headers.etag!}});assert.equal(tampered.statusCode,503);assert.equal(tampered.headers['cache-control'],'no-store');assert.equal(tampered.headers.etag,undefined);
 assert.throws(()=>loadProductionWebAssets(f.repoRoot,f.buildRoot),/Production web assets/);
 const absent=Fastify();t.after(()=>absent.close());assert.throws(()=>registerSiteRoutes(absent,{assetMode:'production',repoRoot:f.repoRoot,buildRoot:join(f.repoRoot,'missing')}),/Production web assets/);
});
test('public routes reject traversal, unlisted build paths, HTML assets and symlink escapes',async t=>{
 const f=await fixture(t);await writeFile(join(f.repoRoot,'outside.js'),'synthetic-private-fixture');await symlink(join(f.repoRoot,'outside.js'),join(f.webRoot,'escape.js'));
 await mkdir(join(f.webRoot,'build'));await writeFile(join(f.webRoot,'build/unlisted-deadbeefdeadbeef.js'),'source fallback is forbidden');
 for(const url of ['/assets/..%2F..%2Fpackage.json','/assets/index.html','/assets/escape.js','/assets/build/unlisted-deadbeefdeadbeef.js','/package.json']){
  const r=await f.app.inject(url);assert.equal(r.statusCode,404,url);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.body.includes('synthetic-private-fixture'),false);
 }
 const target=join(f.buildRoot,f.assets[1]!.file),original=await readFile(target);await writeFile(join(f.repoRoot,'outside.css'),original);await rm(target);await symlink(join(f.repoRoot,'outside.css'),target);
 assert.throws(()=>loadProductionWebAssets(f.repoRoot,f.buildRoot),/Production web assets/);
 assert.equal((await f.app.inject(f.assets[1]!.url)).statusCode,503);
});
test('public JSON/SVG negotiate gzip without changing canonical content or private cache policy',async t=>{
 const f=await fixture(t);
 for(const url of ['/assets/vector.svg','/world-map-v2.json','/v1/fixture']){
  const plain=await f.app.inject(url),compressed=await f.app.inject({url,headers:{'accept-encoding':'br, gzip;q=0.8'}});
  assert.equal(compressed.statusCode,200);assert.equal(compressed.headers['content-encoding'],'gzip');assert.match(compressed.headers.vary!,/Accept-Encoding/);assert.equal(gunzipSync(compressed.rawPayload).toString(),plain.body);
  assert.equal(compressed.headers['cache-control'],plain.headers['cache-control']);assert.equal(compressed.headers.etag,plain.headers.etag);
  const disabled=await f.app.inject({url,headers:{'accept-encoding':'gzip;q=0, *;q=1'}});assert.equal(disabled.headers['content-encoding'],undefined);
 }
 const auth=await f.app.inject({url:'/v1/fixture',headers:{authorization:'Bearer synthetic','accept-encoding':'gzip'}});assert.equal(auth.headers['content-encoding'],undefined);assert.equal(auth.headers['cache-control'],'no-store');
});

test('refined atlas JPEG and its fixed overlays use the production public asset route',async t=>{
 const f=await fixture(t),directory=resolve('apps/web/public/world-atlas');
 await mkdir(join(f.webRoot,'world-atlas'));
 const expected=[['trisavia-atlas-base.jpg','image/jpeg','0be151633fa3ed096755ffcd9a097f4a886ab1604eec529a3337ee5a94127f41'],['atlas-overlays.json','application/json','ffdd48cbe13000fd0d5b01b3cd218e47cfbc5ffda374e1ed18555779478a8e48']] as const;
 for(const [name,type,digest]of expected){
  const bytes=await readFile(join(directory,name));assert.equal(webSha256(bytes),digest);await writeFile(join(f.webRoot,'world-atlas',name),bytes);
  const response=await f.app.inject('/assets/world-atlas/'+name);assert.equal(response.statusCode,200);assert.match(response.headers['content-type']!,new RegExp('^'+type));assert.equal(webSha256(response.rawPayload),digest);assert.equal(response.headers['cache-control'],'public, max-age=0, must-revalidate');
 }
 const overlay=JSON.parse(await readFile(join(directory,'atlas-overlays.json'),'utf8')),catalog=JSON.parse(await readFile(join(directory,'map-data.json'),'utf8'));
 assert.deepEqual(overlay.image,{width:1536,height:1024,aspectRatio:1.5});assert.deepEqual(Object.keys(overlay.regions),catalog.regions.map((item:{id:string})=>item.id));
 const destinations=catalog.regions.flatMap((region:{destinations:Array<{id:string;state:string;worldId?:string}>})=>region.destinations);
 assert.deepEqual(Object.keys(overlay.destinations),destinations.map((item:{id:string})=>item.id));assert.equal(destinations.length,11);assert.deepEqual(destinations.filter((item:{state:string})=>item.state==='open').map((item:{id:string;worldId?:string})=>({id:item.id,worldId:item.worldId})),[{id:'qingzhou-town',worldId:'default'}]);
});
