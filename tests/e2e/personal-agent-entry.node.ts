// Personal navigation and copy only: production assets, synthetic HTTP and no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import Fastify from 'fastify';
import {chromium,expect,type Page} from '@playwright/test';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {APP_VERSION} from '../../apps/platform/version.ts';
import {lifeUiFixture} from '../fixtures/life-ui.ts';
import {appearance,avatar} from '../fixtures/world-town-v2.ts';
// @ts-expect-error Production builder.
import {buildWeb} from '../../scripts/web-build/build.mjs';

test('personal opens the full manager for current, default and newly signed-in residents; custom instructions copy no secrets',async t=>{
 await buildWeb();const fixture=await lifeUiFixture(),app=Fastify({logger:false}),root=resolve('.'),out=resolve('outputs/personal-agent-entry-v041'),errors:string[]=[],writes:string[]=[];await mkdir(out,{recursive:true});
 const ownerId='personal-entry-owner',sessionToken='owner_fixture.'+'a'.repeat(43),runtimeMarker='runtime-fixture-never-appears',agents=['personal-first','personal-second'].map((agentId,index)=>({agentId,publicId:'A90'+(index+1),runtimeActive:true,profile:{version:1,policyVersion:1,mode:'agent_autonomous',lockedFields:[],proposalPending:false,published:{displayName:index?'当前居民二':'首位居民一',bio:'合成读取样本',interests:[],avatar:appearance},publishedAppearance:appearance,draft:null},membership:{agentId,state:'joined',worldId:'default',version:1,ownerPaused:false,platformRestricted:false},worldAccess:{agentId,version:1,intervalSeconds:null},asOf:Date.now()}));
 const envelope=(data:unknown)=>({protocolVersion:1,instanceId:'personal-entry-fixture',serverTime:Date.now(),data});
 app.addHook('onRequest',async request=>{if(request.method!=='GET')writes.push(request.url);});
 app.get('/health',()=>({status:'ok',appVersion:APP_VERSION}));app.get('/v1/capabilities',()=>({apiVersion:'v1',instanceId:'personal-entry-fixture',perception:false,gateway:{protocolVersion:1,modules:['world','avatar_assets'],worldSimulation:{enabled:true}}}));
 app.get('/v1/world/rules',()=>envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:3},rules:fixture.rules,asOf:Date.now()}));app.get('/v1/world/scene',()=>envelope({worldId:'default',scope:'world',worldRevision:1,asOf:Date.now(),avatars:agents.map((a,index)=>({...avatar(a.agentId,{x:44+index,y:2}),rulesetVersion:3,profile:{agentId:a.agentId,publicId:a.publicId,publishedVersion:1,displayName:a.profile.published.displayName,appearance}})),npcs:[],complete:true,nextCursor:null}));
 app.get('/v1/owner/account',()=>({ownerId,publicId:'H901',username:'合成管理主人',emailVerified:true}));app.get('/v1/owner/agents',()=>({ownerId,agents}));app.get('/v1/owner/agent-invites',()=>({ownerId,invites:[],asOf:Date.now()}));app.get('/v1/owner/agents/:id/world-action-policy',request=>({agentId:(request.params as any).id,version:1,mode:'autonomous',asOf:Date.now()}));app.get('/v1/agents/:id/avatar-assets/tasks',request=>envelope({agentId:(request.params as any).id,tasks:[],complete:true,nextCursor:null,asOf:Date.now()}));
 app.post('/v1/owner/sessions',request=>{const body=request.body as any;assert.equal(body.identifier,'synthetic_owner');assert.equal(body.password,'synthetic-password');return{ownerId,operationId:body.operationId,sessionId:body.sessionToken.split('.')[0]};});
 registerSiteRoutes(app,{assetMode:'production',repoRoot:root});const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
 async function manager(page:Page,expected:string){
  await expect(page.locator('#hud-window')).toHaveAttribute('data-feature','account');await expect(page.locator('.owner-manager')).toHaveAttribute('data-manager-page','overview');await expect(page.locator('#manager-agent-id')).toHaveText(expected);for(const key of ['agents','overview','profile','appearance'])await expect(page.locator(`button[data-manager-page="${key}"]`)).toBeVisible();await expect(page.locator('#hud-feature-profile')).toBeHidden();
 }
 for(const scenario of ['current','default','login']){
  const context=await browser.newContext({viewport:{width:scenario==='current'?1440:811,height:scenario==='current'?900:854}});t.after(()=>context.close());await context.addInitScript(({scenario,ownerId,sessionToken,runtimeMarker})=>{
   if(scenario!=='login')sessionStorage.setItem('connet.owner.v2',JSON.stringify({format:'connet-owner-v2',origin:location.origin,ownerId,stage:'managed',sessionToken}));if(scenario==='current')sessionStorage.setItem('connet.owner.agent-selection.v1',JSON.stringify({origin:location.origin,ownerId,agentId:'personal-second'}));
   (window as any).__runtimeMarker=runtimeMarker;(window as any).__copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copied.push(text);}}});
  },{scenario,ownerId,sessionToken,runtimeMarker});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(6000);await page.goto(origin);await expect(page.locator('#hud-app-version')).toHaveText('v'+APP_VERSION);if(scenario!=='login')await expect(page.locator('#hud-account')).toContainText('合成管理主人');
  await page.getByRole('button',{name:'个人',exact:true}).click();if(scenario==='login'){await expect(page.getByLabel('用户名或邮箱')).toBeVisible();await page.getByLabel('用户名或邮箱').fill('synthetic_owner');await page.locator('#login-password').fill('synthetic-password');await page.locator('#login-submit').click();}
  const expected=scenario==='current'?'A902':'A901';await manager(page,expected);await page.locator('button[data-manager-page="appearance"]').click();await page.getByRole('tab',{name:'自定义形象',exact:true}).click();const custom=page.locator('.avatar-studio-custom-entry');await expect(custom.getByRole('heading',{name:'使用自定义形象',exact:true})).toBeVisible();const copy=custom.getByRole('button',{name:'复制给我的 Agent',exact:true});await copy.click();await expect(page.locator('.avatar-studio-status')).toHaveText('提示词已复制');
  const text=await page.evaluate(()=>(window as any).__copied.at(-1)) as string;assert.ok(text.length<700,'The human prompt stays short and links the latest rules');for(const fragment of [origin,expected,'/v1/capabilities','/agent/avatar.md','/assets/avatar-authoring/v1/prompt.json','沿用你本地已有的 Trisavia 身份','先核对本人居民与此目标一致','不重新注册','待机和走路动画','上传并检查校验','本人现有权限允许时应用','不改主人权限','简短告诉我真实结果'])assert.ok(text.includes(fragment),fragment);for(const privateText of [sessionToken,runtimeMarker,ownerId,'synthetic-password','96×64','9帧','8帧'])assert.ok(!text.includes(privateText),privateText);const activeSession=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('connet.owner.v2')!).sessionToken);assert.ok(!text.includes(activeSession),'The current Owner session never enters the copied prompt');assert.ok(!text.includes('形象已更新'));assert.ok(!text.includes('形象素材准备：'));
  await page.screenshot({path:resolve(out,`${scenario}-${scenario==='current'?1440:811}.png`)});await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await expect(page.locator('#hud-window')).toBeHidden();await page.getByRole('button',{name:'个人',exact:true}).click();await manager(page,expected);await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,['/v1/owner/sessions'],'Only the synthetic normal login writes; copying creates no task or avatar operation');
});
