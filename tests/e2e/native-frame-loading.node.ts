// Source-only engineering fixture: no live service, account or business API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';

test('hidden paper frames request no decoration; displaying a native frame loads the same nine pieces',async t=>{
 const origin='https://secondary-startup.invalid',root=resolve('apps/web/public'),images:string[]=[],outside:string[]=[],errors:string[]=[];
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:900}});t.after(()=>context.close());
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin){outside.push(url.href);await route.abort();return;}
  if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/world-pixel/panels.css"><link rel="stylesheet" href="/assets/paper-hud.css"><style>#native-example{position:relative;width:180px;height:90px}#hud-root{position:static}</style></head><body class="paper-hud"><button id="show">显示原生边框</button><div id="hud-root" class="hud-root"><section class="hud-window"><div class="account-root"></div></section></div><aside class="world-detail"></aside><section id="native-example" hidden></section><script type="module">
import {nativeFrame} from '/assets/world-pixel/native-ui.js';import {createLookStage} from '/assets/world-pixel/look-stage.js';
const stage=createLookStage();document.querySelector('.account-root').append(stage.node);document.querySelector('.world-detail').append(nativeFrame('lightWood'));const example=document.querySelector('#native-example');example.append(nativeFrame('lightWood'));document.querySelector('#show').addEventListener('click',()=>{example.hidden=false;});window.fixtureReady=true;window.addEventListener('pagehide',()=>stage.dispose());
</script></body></html>`});return;}
  if(!url.pathname.startsWith('/assets/')){outside.push(url.pathname);await route.abort();return;}
  const path=resolve(root,decodeURIComponent(url.pathname.slice(8)));if(!path.startsWith(root+'/')){outside.push(url.pathname);await route.abort();return;}
  if(url.pathname.endsWith('.png'))images.push(url.pathname);
  try{await route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'} as Record<string,string>)[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.waitForFunction(()=>Boolean((window as any).fixtureReady));await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 assert.deepEqual(images,[],'hidden decorations must not compete with startup reads');
 for(const selector of ['.character-stage>.native-frame','.world-detail>.native-frame']){assert.equal(await page.locator(selector).evaluate(node=>getComputedStyle(node).display),'none');await expect(page.locator(selector)).toHaveAttribute('aria-hidden','true');await expect(page.locator(selector+' img')).toHaveCount(9);}
 await expect(page.locator('#show')).toHaveText('显示原生边框');await expect(page.locator('#show')).toBeVisible();await page.getByRole('button',{name:'显示原生边框',exact:true}).click();
 await expect.poll(()=>page.locator('#native-example img').evaluateAll(nodes=>nodes.every(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth===3&&(node as HTMLImageElement).naturalHeight===3))).toBe(true);
 const expected=['tl','tc','tr','lc','c','rc','bl','bc','br'].map(piece=>'/assets/world-pixel/panel-assets/lt_box_9slice_'+piece+'.png');assert.deepEqual([...images].sort(),[...expected].sort());
 assert.deepEqual(await page.locator('#native-example img').evaluateAll(nodes=>nodes.map(node=>({path:new URL((node as HTMLImageElement).src).pathname,alt:(node as HTMLImageElement).alt}))),expected.map(path=>({path,alt:''})));
 const size=await page.locator('#native-example>.native-frame').boundingBox();assert.ok(size);assert.deepEqual({width:size.width,height:size.height},{width:180,height:90});await expect(page.locator('#native-example>.native-frame')).toHaveAttribute('aria-hidden','true');assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);await page.close();
});

test('anonymous source shell still opens account and place details with paper decorations deferred',async t=>{
 const origin='https://paper-startup.invalid',root=resolve('apps/web/public'),frames:string[]=[],apiRequests:string[]=[],outside:string[]=[],errors:string[]=[];
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>context.close());
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin||request.method()!=='GET'){outside.push(request.method()+' '+url.href);await route.abort();return;}
  if(url.pathname.startsWith('/v1/')){apiRequests.push(url.pathname);await route.fulfill(url.pathname==='/v1/capabilities'?{json:{apiVersion:'v1',instanceId:'paper-startup-fixture',perception:false,gateway:{protocolVersion:1,modules:[],worldSimulation:{enabled:false}}}}:{status:404,json:{error:{code:'not_found'}}});return;}
  if(url.pathname==='/health'){await route.fulfill({json:{status:'ok',appVersion:JSON.parse(await readFile(resolve('package.json'),'utf8')).version}});return;}
  if(url.pathname==='/agent/prompt.md'){await route.fulfill({contentType:'text/markdown; charset=utf-8',body:'Synthetic local entry instructions.'});return;}
  if(url.pathname.includes('/panel-assets/lt_box_9slice_'))frames.push(url.pathname);
  const path=url.pathname==='/'?resolve(root,'index.html'):url.pathname.startsWith('/assets/')?resolve(root,decodeURIComponent(url.pathname.slice(8))):'';
  if(!path.startsWith(root+'/')){outside.push(url.pathname);await route.abort();return;}
  try{await route.fulfill({contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'} as Record<string,string>)[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.locator('#hud-account').click();await expect(page.locator('#hud-window')).toBeVisible();await expect(page.getByLabel('用户名或邮箱')).toBeVisible();await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await expect(page.locator('#hud-window')).toBeHidden();
 await page.locator('#world-open-list').click();await page.locator('#world-place-commons').click();await expect(page.locator('#world-detail')).toBeVisible();await expect(page.locator('#world-detail-title')).toHaveText('公共庭');await page.locator('#world-detail-close').click();await expect(page.locator('#world-detail')).toBeHidden();
 assert.deepEqual(frames,[]);assert.ok(apiRequests.every(path=>!path.startsWith('/v1/owner/')));assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);await page.close();
});
