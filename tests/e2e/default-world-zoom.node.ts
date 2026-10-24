// Anonymous page, synthetic public HTTP only; no service or identity writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {townFixture,avatar,epoch} from '../fixtures/world-town-v2.ts';
const origin='https://default-zoom.invalid',root=resolve('apps/web/public');
test('ordinary entry and refresh start at 100 percent while manual zoom and explicit fit still work',async t=>{
 const town=await townFixture(),browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(5000);const writes:string[]=[],errors:string[]=[];let scenes=0;
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;if(url.origin!==origin)return route.abort();if(req.method()!=='GET'){writes.push(path);return route.fulfill({status:403,json:{error:{code:'fixture_read_only'}}});}assert.equal(req.headers().authorization,undefined);const envelope=(data:unknown)=>({protocolVersion:1,instanceId:'zoom-fixture',serverTime:epoch,data});
  if(path==='/v1/capabilities')return route.fulfill({json:{apiVersion:'v1',instanceId:'zoom-fixture',perception:false,gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}}});
  if(path==='/v1/world/rules')return route.fulfill({json:envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:2},rules:town.rules,asOf:epoch})});
  if(path==='/v1/world/scene'){scenes++;return route.fulfill({json:envelope({worldId:'default',scope:'world',worldRevision:1,asOf:epoch,avatars:[avatar('synthetic-resident')],npcs:town.npcs,npcCatalogVersion:null,complete:true,nextCursor:null})});}
  if(path==='/world-map-v2.json')return route.fulfill({body:town.bytes,contentType:'application/json'});
  if(path==='/'||path.startsWith('/assets/')){const file=resolve(root,path==='/'?'index.html':path.slice(8));if(file.startsWith(root+'/'))try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.html':'text/html'} as Record<string,string>)[extname(file)]||'application/octet-stream'});}catch{}}
  return route.fulfill({status:404,json:{error:{code:'fixture_not_found'}}});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));const state=()=>page.evaluate(async()=>{const app=await import(String('/assets/home.js'));return app.getWorldState();});const settled=async(value:number)=>{await expect.poll(async()=>Math.abs((await state()).camera.scale-value)).toBeLessThan(1e-7);await expect(page.locator('#world-zoom')).toHaveText(Math.round(value*100)+'%');};
 await page.goto(origin);await expect.poll(async()=>(await state())?.worldScene.complete).toBe(true);await settled(1);assert.equal((await state()).mode,'initial');
 await page.setViewportSize({width:1280,height:800});await settled(1);await page.getByRole('button',{name:'放大地图',exact:true}).click();await settled(1.1);await page.getByRole('button',{name:'缩小地图',exact:true}).click();await settled(1);
 await page.mouse.move(500,450);await page.keyboard.down('Control');await page.mouse.wheel(0,-40);await page.keyboard.up('Control');await expect.poll(async()=>(await state()).camera.scale).toBeGreaterThan(1);
 await page.getByRole('button',{name:'全景',exact:true}).click();const fitted=await state();assert.equal(fitted.mode,'overview');assert.ok(fitted.camera.scale<1);await settled(fitted.minZoom);const before=scenes;await expect.poll(()=>scenes).toBeGreaterThan(before);await settled(fitted.minZoom);
 await page.reload();await expect.poll(async()=>(await state())?.worldScene.complete).toBe(true);await settled(1);assert.equal((await state()).mode,'initial');assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
