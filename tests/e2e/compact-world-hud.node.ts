// Four compact HUD regions only, using isolated synthetic Owner/public reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {paperWorldFixture} from '../fixtures/paper-world-ui.ts';
const output=resolve('outputs/compact-hud-20261024');
test('compact paper HUD stays readable and separates the Agent card from all four navigation targets',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());await mkdir(output,{recursive:true});
 const context=await browser.newContext({viewport:{width:811,height:854},reducedMotion:'reduce'});context.setDefaultTimeout(5000);const {page,writes,errors}=await paperWorldFixture(context);
 for(const size of [{width:811,height:854},{width:1440,height:900}]){
  await page.setViewportSize(size);await expect(page.locator('#world-zoom')).toHaveText('100%');
  const boxes=await page.locator('.hud-agent-card,#hud-dock,header .nav-wrap,#world-status-hud').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{id:node.id||node.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
  const agent=boxes.find(box=>box.id==='hud-agent-card'),dock=boxes.find(box=>box.id==='hud-dock'),header=boxes.find(box=>box.id==='nav-wrap'),hud=boxes.find(box=>box.id==='world-status-hud');assert(agent&&dock&&header&&hud);
  assert.ok(agent.right+12<=dock.x||agent.bottom+12<=dock.y||dock.bottom+12<=agent.y,'Agent card and dock keep a visible gap');assert.ok(boxes.every(box=>box.x>=0&&box.y>=0&&box.right<=size.width&&box.bottom<=size.height));assert.deepEqual({header:header.height,agent:[agent.width,agent.height],dock:[dock.width,dock.height],hud:[hud.width,hud.height]},{header:44,agent:[216,52],dock:[344,60],hud:[184,64]});
  for(const control of await page.locator('#hud-dock button,#hud-agent,#hud-locate-agent,header nav>button,.world-audio-button').all()){await expect(control).toBeInViewport();const box=(await control.boundingBox())!;const minimum=await control.evaluate(node=>node.closest('#hud-dock')?44:36);assert.ok(box.width>=minimum&&box.height>=minimum);}
  await expect(page.locator('#hud-dock button')).toHaveCount(4);assert.equal(await page.locator('#world-status-hud').evaluate(node=>node.scrollWidth<=node.clientWidth&&node.scrollHeight<=node.clientHeight),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1),true);
  await page.screenshot({path:resolve(output,`hud-${size.width}x${size.height}.png`)});
 }
 await page.getByRole('button',{name:'放大地图',exact:true}).click();await expect(page.locator('#world-zoom')).toHaveText('110%');await page.getByRole('button',{name:'缩小地图',exact:true}).click();await expect(page.locator('#world-zoom')).toHaveText('100%');await page.getByRole('button',{name:'全景',exact:true}).click();await expect.poll(async()=>Number((await page.locator('#world-zoom').textContent())!.replace('%',''))).toBeLessThan(100);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
