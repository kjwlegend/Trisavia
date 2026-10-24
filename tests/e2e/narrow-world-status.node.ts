// One existing narrow breakpoint; no phone feature or business regression suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {paperWorldFixture} from '../fixtures/paper-world-ui.ts';
test('the narrow world information card keeps its reserved space below map tools',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:811,height:854},reducedMotion:'reduce'});context.setDefaultTimeout(5000);const {page,writes,errors}=await paperWorldFixture(context);
 const hud=page.locator('#world-status-hud'),tools=page.locator('.hud-map-tools');for(const width of [759,390]){await page.setViewportSize({width,height:854});await expect(hud).toBeInViewport();await expect(tools).toBeInViewport();const card=(await hud.boundingBox())!,controls=(await tools.boundingBox())!;assert.equal(card.y,132);assert.ok(card.y>=controls.y+controls.height+12);assert.equal(await hud.evaluate(node=>node.scrollWidth<=node.clientWidth),true);}assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
