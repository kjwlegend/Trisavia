// Real production bundle over read-only synthetic HTTP; release/board routes belong to the API author.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {townFixture} from '../fixtures/world-town-v2.ts';
// @ts-expect-error Production build module is JavaScript.
import {buildWeb} from '../../scripts/web-build/build.mjs';
const root=resolve('apps/web/public'),built=resolve('dist/web'),origin='https://project-links.invalid';
test('production world More menu discovers release history and development board and returns to the town',async t=>{
 const manifest=await buildWeb();assert.ok(manifest.sources.some((row:any)=>row.file==='apps/web/public/hud/features/world.js'));const html=await readFile(resolve(built,'index.html'),'utf8');assert.equal((html.match(/type="module"/g)||[]).length,1);assert.equal((html.match(/rel="stylesheet"/g)||[]).length,1);
 const town=await townFixture(),browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(5000);const page=await context.newPage(),errors:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;if(url.origin!==origin)return route.abort();if(request.method()!=='GET'){writes.push(path);return route.abort();}const envelope=(data:unknown)=>({protocolVersion:1,instanceId:'project-links-fixture',serverTime:Date.now(),data});
  if(path==='/v1/capabilities')return route.fulfill({json:{apiVersion:'v1',instanceId:'project-links-fixture',perception:false,gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}}});
  if(path==='/v1/world/rules')return route.fulfill({json:envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:2},rules:town.rules,asOf:Date.now()})});if(path==='/v1/world/scene')return route.fulfill({json:envelope({worldId:'default',scope:'world',worldRevision:1,asOf:Date.now(),avatars:[],npcs:town.npcs,complete:true,nextCursor:null})});
  // Only exercise this author's links; actual page content and routes are separately owned/reviewed.
  if(['/releases','/kanban'].includes(path))return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><h1>${path==='/releases'?'更新日志':'建设看板'}</h1><a href="/">返回清昼小镇</a></body></html>`});
  const file=path==='/'?resolve(built,'index.html'):path.startsWith('/assets/build/')?resolve(built,path.slice('/assets/'.length)):path.startsWith('/assets/')?resolve(root,path.slice('/assets/'.length)):path==='/world-map-v2.json'?resolve(root,'world-map-v2.json'):'';if(file&&(file.startsWith(root+'/')||file.startsWith(built+'/')))try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'} as Record<string,string>)[extname(file)]||'application/octet-stream'});}catch{}return route.fulfill({status:404,body:'missing fixture'});
 });
 for(const [path,label]of [['/releases','更新日志'],['/kanban','建设看板']]){await page.goto(origin);await page.getByRole('button',{name:'更多',exact:true}).click();const link=page.locator('#hud-map-menu').getByRole('link',{name:label!,exact:true});await expect(link).toHaveAttribute('href',path!);await link.click();await expect(page).toHaveURL(origin+path);await expect(page.getByRole('heading',{name:label!,exact:true})).toBeVisible();await page.getByRole('link',{name:'返回清昼小镇',exact:true}).click();await expect(page).toHaveURL(origin+'/');await expect(page.locator('#world-canvas')).toBeVisible();}
 await expect(page.getByRole('button',{name:'世界地图',exact:true})).toBeVisible();assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
});
