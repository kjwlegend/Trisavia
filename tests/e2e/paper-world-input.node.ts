// Real world shell and pointer events with isolated public/Owner HTTP fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {paperWorldFixture} from '../fixtures/paper-world-ui.ts';
import {appearance,avatar,epoch,layoutSha,geometryDigest} from '../fixtures/world-town-v2.ts';

const output=resolve('outputs/paper-hud-v3');
test('paper world targets accept ordinary mouse input without losing the panel or scrolling the document',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());await mkdir(output,{recursive:true});
 const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});context.setDefaultTimeout(5000);
 const {page,writes,errors}=await paperWorldFixture(context);
 const definition=(npcId:string,name:string,buildingId:string,x:number,y:number,serviceId:string,action:string)=>({npcId,name,role:'小镇邻居',buildingId,definitionVersion:1,position:{x,y},approachCells:[{x:x-1,y}],appearance,serverManaged:true,readOnly:false,status:'available',countsAsAgent:false,serviceIds:[serviceId],actions:['town_services.npc.greet',action]});
 const npcs=[definition('npc-mayor','镇长','p-hall',2,-17,'welcome.claim','town_services.welcome.claim'),definition('npc-tavern','港湾酒馆·酒保','h-tavern',53,12,'tavern.host','town_services.tavern.redeem'),definition('npc-innkeeper','石岸旅舍·老板','e-inn',28,8,'inn.rest','town_services.inn.rest.start')];
 const map={mapId:'pixel-town-v2',layoutSha256:layoutSha,geometryDigest,rulesetVersion:2,topologyVersion:2},envelope=(data:unknown)=>({protocolVersion:1,instanceId:'paper-fixture',serverTime:epoch,data});
 const services=[{serviceId:'welcome.claim',npcId:'npc-mayor',name:'新邻居礼包',description:'欢迎来到小镇。',action:'town_services.welcome.claim',durationMs:0,itemCost:null,topics:[]},{serviceId:'tavern.host',npcId:'npc-tavern',name:'酒馆招待',description:'聊聊小镇里的新发现。',action:'town_services.tavern.redeem',durationMs:0,itemCost:'tavern_voucher',topics:[{id:'welcome',label:'欢迎新邻居'}]},{serviceId:'inn.rest',npcId:'npc-innkeeper',name:'旅舍休息',description:'在旅舍附近休息一分钟。',action:'town_services.inn.rest.start',durationMs:60000,itemCost:'inn_voucher',topics:[]}];
 const reads:string[]=[];
 await context.route('**/v1/world/scene?*',route=>route.fulfill({json:envelope({worldId:'default',scope:'world',worldRevision:1,asOf:epoch,avatars:[avatar('agent-a'),avatar('agent-b',{x:1,y:0})],npcs,npcCatalogVersion:1,complete:true,nextCursor:null})}));
 await context.route('**/v1/town/notice',route=>route.fulfill({json:envelope({catalogVersion:1,map,notice:{objectId:'notice',version:1,name:'小镇公告牌',title:'欢迎新邻居',text:'在小镇走走，认识新的邻居。',position:{x:-3,y:-3},approachCells:[{x:-4,y:-3}],serviceIds:services.map(row=>row.serviceId)},asOf:epoch})}));
 await context.route('**/v1/town/service?*',route=>{const service=services.find(row=>row.serviceId===new URL(route.request().url()).searchParams.get('serviceId'))!;reads.push(service.serviceId);return route.fulfill({json:envelope({catalogVersion:1,map,npc:npcs.find(row=>row.npcId===service.npcId),service,asOf:epoch})});});
 await context.route('**/v1/gateway/query',route=>{const body=route.request().postDataJSON();if(!body.operation.startsWith('town_services.'))return route.fallback();const base={agentId:body.input.agentId,asOf:epoch};return route.fulfill({json:envelope(body.operation.endsWith('progress')?{...base,catalogVersion:1,claim:null,activeRest:null,completedServices:[]}:body.operation.endsWith('inventory')?{...base,items:[],complete:true,nextAfterId:null}:{...base,relationships:[],complete:true,nextAfterNpcId:null})});});
 await page.reload();await expect(page.locator('body')).toHaveClass(/paper-app-ready/);await expect(page.locator('[data-town-target="notice"]')).toBeVisible();
 for(const [width,height]of [[1600,1000],[1440,900],[1280,800]] as const){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 const inn=page.locator('[data-town-target="npc-innkeeper"]');await inn.click();await expect(page.getByRole('complementary',{name:'石岸旅舍·老板',exact:true})).toBeVisible();
 const nextScene=page.waitForResponse(response=>response.url().includes('/v1/world/scene?'));await page.getByRole('button',{name:'复制问候指令',exact:true}).click();await expect(page.locator('.town-card-message')).toContainText('已复制');await nextScene;await expect(page.locator('#world-detail')).toBeVisible();assert.equal(await page.evaluate(()=>scrollY),0);assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/拜访石岸旅舍·老板/);await page.screenshot({path:resolve(output,'world-input-r3-1280.png')});await page.locator('#world-detail-close').click();await expect(page.locator('#world-detail')).toBeHidden();
 // A pointer drag beginning on the visible NPC still belongs to the camera.
 const box=(await inn.boundingBox())!,before=await page.evaluate(async()=>{
  // @ts-expect-error Browser production module.
  const {getWorldState}=await import('/assets/home.js');return getWorldState().camera;
 });await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+20,{steps:5});await page.mouse.up();await expect(page.locator('#world-detail')).toBeHidden();const after=await page.evaluate(async()=>{
  // @ts-expect-error Browser production module.
  const {getWorldState}=await import('/assets/home.js');return getWorldState().camera;
 });assert.notEqual(after.x,before.x);await page.locator('#world-fit').click();
 await inn.hover();const zoom=Number((await page.locator('#world-zoom').textContent())!.replace('%',''));await page.keyboard.down('Control');await page.mouse.wheel(0,-40);await page.keyboard.up('Control');await expect.poll(async()=>Number((await page.locator('#world-zoom').textContent())!.replace('%',''))).toBeGreaterThan(zoom);await page.locator('#world-fit').click();
 for(const [label,npc]of [['新邻居礼包',npcs[0]!],['酒馆招待',npcs[1]!],['旅社休息',npcs[2]!]] as const){
  await page.locator('[data-town-target="notice"]').click();await expect(page.getByRole('complementary',{name:'小镇公告牌',exact:true})).toBeVisible();const count=reads.length;await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('complementary',{name:npc.name,exact:true})).toBeVisible();await expect(page.locator('.town-npc-name')).toHaveText(npc.name);assert.equal(reads.length,count+1);await page.getByRole('button',{name:'复制问候指令',exact:true}).click();await expect(page.locator('.town-card-message')).toContainText('已复制');await page.keyboard.press('Escape');await expect(page.locator('#world-detail')).toBeHidden();
 }
 await page.locator('#world-open-list').click();await expect(page.locator('#world-place-directory')).toBeInViewport();await page.locator('#world-place-commons').click();await expect(page.locator('#world-detail')).toBeVisible();await page.locator('#world-back').click();await expect(page.locator('#world-detail')).toBeHidden();await page.locator('#world-open-list').click();await page.keyboard.press('Escape');await expect(page.locator('#world-place-directory')).not.toHaveAttribute('open','');
 await page.locator('#hud-map-more').click();await page.locator('#world-learn').click();await expect(page.getByRole('dialog',{name:'接入 Agent',exact:true})).toBeVisible();await page.locator('#hud-close').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),true);assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overflow),'visible');
 await page.setViewportSize({width:1600,height:1000});await page.screenshot({path:resolve(output,'01-default-r3-1600.png')});assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
