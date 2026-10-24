// Town relationship spacing in the existing friends window, synthetic reads only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {paperWorldFixture} from '../fixtures/paper-world-ui.ts';
import {appearance,epoch} from '../fixtures/world-town-v2.ts';
const output=resolve('outputs/compact-hud-20261024');
test('town relationships retain inner gutters, row spacing and their own scrolling bounds',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());await mkdir(output,{recursive:true});const context=await browser.newContext({viewport:{width:811,height:854},reducedMotion:'reduce'});context.setDefaultTimeout(5000);const {page,writes,errors}=await paperWorldFixture(context);let reads=0;
 await context.route('**/v1/gateway/query',route=>{const body=route.request().postDataJSON();if(body.operation!=='town_services.relationships')return route.fallback();reads++;assert.equal(body.input.agentId,'agent-a');assert.equal(body.purpose,'human-inspect');return route.fulfill({json:{protocolVersion:1,instanceId:'paper-fixture',data:{agentId:'agent-a',relationships:[['npc-mayor','镇长'],['npc-tavern','港湾酒馆·酒保'],['npc-innkeeper','石岸旅舍·老板']].map(([npcId,name])=>({npcId,version:1,familiarity:12,createdAt:epoch,updatedAt:epoch,npc:{npcId,name,appearance}})),complete:true,nextAfterNpcId:null,asOf:epoch}}});});
 await page.getByRole('button',{name:'好友列表',exact:true}).click();const panel=page.locator('#hud-window'),before=(await panel.boundingBox())!;await page.locator('[data-friendship-tab=town]').click();const town=page.locator('.town-relationships');await expect(town.locator('.town-relationship')).toHaveCount(3);assert.equal((await panel.boundingBox())!.height,before.height);
 for(const size of [{width:811,height:854},{width:1440,height:900}]){
  await page.setViewportSize(size);const box=(await town.boundingBox())!,title=(await town.getByRole('heading',{name:'镇民关系 · 熟悉度',exact:true}).boundingBox())!,row=(await town.locator('.town-relationship').first().boundingBox())!;
  const gutter=size.width<=960?20:24;assert.equal(Math.round(title.x-box.x),gutter);assert.equal(Math.round(title.y-box.y),16);assert.equal(Math.round(row.x-box.x),gutter);assert.ok(title.y+title.height+12<=row.y);assert.equal(await town.evaluate(node=>getComputedStyle(node).overflowY),'auto');assert.equal(await town.evaluate(node=>node.scrollWidth<=node.clientWidth),true);assert.equal(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth),true);
  await expect(town.getByRole('button',{name:'刷新镇民关系',exact:true})).toBeInViewport();for(const control of await town.locator('button').all()){const rect=(await control.boundingBox())!;assert.ok(rect.height>=36&&rect.x>=box.x+gutter&&rect.x+rect.width<=box.x+box.width-gutter);}
  const close=(await page.locator('#hud-close').boundingBox())!;assert.ok(close.y>=0&&close.y+close.height<=size.height);await page.screenshot({path:resolve(output,`town-relations-${size.width}x${size.height}.png`)});
 }
 const count=reads;await town.getByRole('button',{name:'刷新镇民关系',exact:true}).click();await expect.poll(()=>reads).toBe(count+1);await expect(town.locator('.town-relationship')).toHaveCount(3);await page.locator('#hud-close').click();await expect(panel).toBeHidden();assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
