// Header-only production browser fixture: no database, credentials or business writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import Fastify from 'fastify';
import {chromium,expect,type Page} from '@playwright/test';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {registerHealthRoute} from '../../apps/platform/transport/http/health-routes.ts';
import {APP_VERSION} from '../../apps/platform/version.ts';
import {lifeUiFixture} from '../fixtures/life-ui.ts';
// @ts-expect-error Production builder is JavaScript.
import {buildWeb} from '../../scripts/web-build/build.mjs';
const root=resolve('.'),output=resolve('outputs/header-navigation-v032');
test('production header reads the one application version, orders navigation 1/2 and preserves signed-in names',async t=>{
 const build=await buildWeb();assert.equal(build.appVersion,APP_VERSION);const fixture=await lifeUiFixture(),app=Fastify({logger:false}),writes:string[]=[],healthReads:string[]=[],errors:string[]=[];let failHealth=false;
 app.addHook('onRequest',async request=>{if(request.method!=='GET')writes.push(request.url);if(request.url==='/health')healthReads.push(request.url);});
 registerHealthRoute(app,async()=>{if(failHealth)throw Error('isolated unreadable health fixture');return{instanceId:'header-ui-fixture'};});
 const envelope=(data:unknown)=>({protocolVersion:1,instanceId:'header-ui-fixture',serverTime:Date.now(),data});
 app.get('/v1/capabilities',()=>({apiVersion:'v1',instanceId:'header-ui-fixture',perception:false,gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}}));
 app.get('/v1/world/rules',()=>envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:3},rules:fixture.rules,asOf:Date.now()}));
 app.get('/v1/world/scene',()=>envelope({worldId:'default',scope:'world',worldRevision:1,asOf:Date.now(),avatars:[],npcs:[],complete:true,nextCursor:null}));
 app.get('/v1/owner/account',()=>({ownerId:'header-owner-fixture',publicId:'H901',username:'页头登录样本',emailVerified:true}));
 app.get('/v1/owner/agents',()=>({ownerId:'header-owner-fixture',agents:[]}));
 registerSiteRoutes(app,{assetMode:'production',repoRoot:root});const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());await mkdir(output,{recursive:true});let documents=0;
 async function geometry(page:Page,width:number,signed:boolean){
  await expect(page.locator('#hud-app-version')).toHaveText(`v${APP_VERSION}`);assert.deepEqual(await page.locator('header nav>.hud-entry,header nav>.hud-account').evaluateAll(nodes=>nodes.map(n=>n.id)),['hud-agent-entry','hud-account']);
  assert.deepEqual(await page.locator('header nav .hud-nav-number').allTextContents(),['1','2']);assert.equal(await page.locator('#hud-account').locator('span').last().textContent(),signed?'页头登录样本':'登录 / 注册');
  const boxes=await page.getByRole('banner').evaluate(header=>{const rect=(n:Element)=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};};const controls=[...header.querySelectorAll('.brand,.hud-app-version,.hud-entry,.hud-account,.world-audio-button')];return{height:header.getBoundingClientRect().height,versionFont:getComputedStyle(header.querySelector('.hud-app-version')!).fontSize,versionTab:header.querySelector('.hud-app-version')!.getAttribute('tabindex'),entryWeight:Number(getComputedStyle(header.querySelector('.hud-entry')!).fontWeight),accountWeight:Number(getComputedStyle(header.querySelector('.hud-account')!).fontWeight),controls:controls.map(n=>({...rect(n),tag:n.tagName,hit:n.tagName!=='BUTTON'||document.elementFromPoint(n.getBoundingClientRect().x+n.getBoundingClientRect().width/2,n.getBoundingClientRect().y+n.getBoundingClientRect().height/2)?.closest('button')===n}))};});
  assert.equal(boxes.height,44);assert.equal(boxes.versionFont,'11px');assert.equal(boxes.versionTab,null);assert.ok(boxes.entryWeight>boxes.accountWeight);for(const [i,b]of boxes.controls.entries()){assert.ok(b.x>=0&&b.x+b.width<=width&&b.y>=0&&b.y+b.height<=44&&b.hit,JSON.stringify(b));if(i)assert.ok(boxes.controls[i-1]!.x+boxes.controls[i-1]!.width<=b.x+.5,JSON.stringify(boxes));}
  assert.equal(await page.locator('#hud-dock>button').count(),6);await expect(page.getByRole('button',{name:'全景',exact:true})).toBeVisible();await expect(page.locator('.world-audio-button')).toBeVisible();return boxes;
 }
 for(const signed of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>context.close());if(signed)await context.addInitScript(()=>sessionStorage.setItem('connet.owner.v2',JSON.stringify({format:'connet-owner-v2',origin:location.origin,ownerId:'header-owner-fixture',stage:'managed',sessionToken:'owner_session_fixture.'+'a'.repeat(43)})));const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));const loaded=++documents;await page.goto(origin);await expect.poll(()=>healthReads.length).toBe(loaded);
  for(const width of [1440,811]){
   await page.setViewportSize({width,height:width===811?854:900});await geometry(page,width,signed);const entry=page.locator('#hud-agent-entry'),account=page.locator('#hud-account'),panel=page.locator('#hud-window');await entry.click();await expect(panel).toBeVisible();await expect(panel.getByRole('heading',{name:'让自己的 Agent 加入',exact:true})).toBeVisible();await expect(page.locator('#hud-title')).toBeFocused();await page.keyboard.press('Escape');await expect(panel).not.toBeVisible();await expect(entry).toBeFocused();await page.keyboard.press('Tab');await expect(account).toBeFocused();await account.click();await expect(panel).toBeVisible();if(!signed)await expect(panel.getByLabel('用户名或邮箱')).toBeVisible();else await expect(account).toContainText('页头登录样本');await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await expect(account).toBeFocused();await geometry(page,width,signed);await page.screenshot({path:resolve(output,`${signed?'signed':'anonymous'}-${width}.png`)});
  }
  assert.equal(healthReads.length,loaded,'Version is read once per document, without interaction polling');await context.close();
 }
 failHealth=true;const failed=await browser.newPage({viewport:{width:811,height:854},reducedMotion:'reduce'});t.after(()=>failed.close());failed.on('pageerror',error=>errors.push(error.message));const response=failed.waitForResponse(r=>r.url()===origin+'/health');await failed.goto(origin);assert.equal((await response).status(),503);await expect(failed.locator('#hud-app-version')).toBeHidden();await expect(failed.locator('#hud-app-version')).toHaveText('');await failed.locator('#hud-agent-entry').click();await expect(failed.locator('#hud-window')).toBeVisible();await failed.keyboard.press('Escape');assert.equal(healthReads.length,++documents);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);const packageVersion=JSON.parse(await readFile('package.json','utf8')).version;assert.equal(packageVersion,APP_VERSION);
});
