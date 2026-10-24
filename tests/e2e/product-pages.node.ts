// Explicit production-browser check; run npm run build:web first.
// Then: node --test tests/e2e/product-pages.node.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import Fastify from 'fastify';
import {chromium} from '@playwright/test';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {loadProductionWebAssets} from '../../apps/platform/transport/http/web-assets.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const screenshots=resolve(root,'outputs/release-board-20261025');

test('public player pages use the verified build, honest completed releases, map-only columns and a working return link',async()=>{
 const assets=loadProductionWebAssets(root,resolve(root,'dist/web'));
 const app=Fastify({logger:false});registerSiteRoutes(app,{assetMode:'production',repoRoot:root});
 const origin=await app.listen({host:'127.0.0.1',port:0});
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  await mkdir(screenshots,{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const path of ['/releases','/kanban']){
   const response=await app.inject(path);assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');
   const html=await readFile(resolve(root,'dist/web',assets.pages[path.slice(1) as 'releases'|'kanban'].file),'utf8');
   const urls=[...html.matchAll(/(?:src|href)="(\/assets\/build\/[^"?#]+)"/g)].map(match=>match[1]!);
   assert(urls.some(url=>url.endsWith('.js')));assert(urls.some(url=>url.endsWith('.css')));
   for(const url of urls){const resource=await app.inject(url);assert.equal(resource.statusCode,200);assert.equal(resource.headers['cache-control'],'public, max-age=31536000, immutable');}
  }
  await page.goto(origin+'/releases');await page.getByRole('heading',{name:'更新日志',exact:true}).waitFor();
  assert.equal(await page.locator('.release-card').count(),2);
  const copy=await page.locator('main').innerText();
  assert.match(copy,/v0\.1\.0/);assert.match(copy,/v0\.1\.1/);assert.doesNotMatch(copy,/v0\.1\.2|当前运行|UAT已发布|\bJS\b|\bCSS\b|module|数据库/);
  assert.equal(await page.locator('nav a[aria-current=page]').getAttribute('href'),'/releases');
  await page.screenshot({path:resolve(screenshots,'releases-1440.png'),fullPage:true});
  await page.getByRole('navigation').getByRole('link',{name:'建设看板'}).click();
  await page.locator('.board-card').first().waitFor();
  assert.deepEqual(await page.locator('.board-heading h2').allTextContents(),['进行中','已完成','未来计划','投票中']);
  assert.deepEqual(await page.locator('.board-card').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.card)),['map-atlas','map-sunset-bay','map-plain-outpost','map-dawn-lake','map-mist-valley']);
  assert.equal(await page.locator('[data-column=completed] .board-card').count(),0);
  assert.equal(await page.locator('[data-column=voting] .board-card').count(),0);
  assert.equal(await page.locator('[data-column=voting] :is(button,input,a)').count(),0);
  assert.match(await page.locator('[data-column=voting]').innerText(),/暂未开放投票/);
  assert.match(await page.locator('#world-introduction').innerText(),/从清昼小镇出发，一起把想生活的世界建出来/);
  assert.match(await page.locator('#world-introduction').innerText(),/初晓洲河岸边的一座小镇/);
  assert.match(await page.locator('.board-scope').innerText(),/自由建造与跨城旅行尚未开放/);
  for(const [width,columns] of [[1440,4],[1000,2],[390,1]]){
   await page.setViewportSize({width:width!,height:900});
   const geometry=await page.locator('.map-board').evaluate(node=>({columns:getComputedStyle(node).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>innerWidth,header:document.querySelector('header')!.getBoundingClientRect().height,font:getComputedStyle(node.querySelector('.board-card p')!).fontSize}));
   assert.equal(geometry.columns,columns);assert.equal(geometry.overflow,false);assert.equal(geometry.header,44);assert.equal(geometry.font,'14px');
   await page.screenshot({path:resolve(screenshots,`kanban-${width}.png`),fullPage:true});
  }
  await page.getByRole('link',{name:'返回清昼小镇',exact:true}).click();await page.waitForURL(origin+'/');
  await page.goto(origin+'/releases');await page.locator('.release-card').first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:resolve(screenshots,'releases-390.png'),fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await app.close();}
});
