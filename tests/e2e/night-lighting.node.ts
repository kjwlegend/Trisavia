// Source/static browser fixture: decorative lighting only, no real identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import Fastify from 'fastify';
import {chromium,expect} from '@playwright/test';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {registerHealthRoute} from '../../apps/platform/transport/http/health-routes.ts';
import {lifeUiFixture} from '../fixtures/life-ui.ts';
import {avatar} from '../fixtures/world-town-v2.ts';

test('night uses the approved cached lamps while day, dusk, geometry and reduced motion keep their meaning',async t=>{
 const fixture=await lifeUiFixture(),app=Fastify({logger:false}),writes:string[]=[],errors:string[]=[],out=resolve('outputs/night-lighting-v048');let epoch=Date.parse('2026-10-25T12:00:00+08:00');
 app.addHook('onRequest',async request=>{if(request.method!=='GET')writes.push(request.url);});registerHealthRoute(app,async()=>({instanceId:'night-ui-fixture'}));const envelope=(data:unknown)=>({protocolVersion:1,instanceId:'night-ui-fixture',serverTime:epoch,data});
 app.get('/v1/capabilities',()=>({apiVersion:'v1',instanceId:'night-ui-fixture',perception:false,gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}}));
 app.get('/v1/world/rules',()=>envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:3},rules:fixture.rules,asOf:epoch}));
 app.get('/v1/world/scene',()=>envelope({worldId:'default',scope:'world',worldRevision:1,asOf:epoch,avatars:[{...avatar('night-visible-resident'),rulesetVersion:3}],npcs:[],complete:true,nextCursor:null}));registerSiteRoutes(app,{assetMode:'source',repoRoot:resolve('.')});const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>errors.push(error.message));await mkdir(out,{recursive:true});
 await page.addInitScript(()=>{const s=(window as any).__night={gradients:0,readbacks:0,draws:0},p=CanvasRenderingContext2D.prototype,g=p.createRadialGradient,r=p.getImageData,d=p.drawImage;p.createRadialGradient=function(...args){if(this.canvas.width===768&&this.canvas.height===576)s.gradients++;return g.apply(this,args);};p.getImageData=function(...args:any[]){if(this.canvas.width===768&&this.canvas.height===576)s.readbacks++;return r.apply(this,args as any);};p.drawImage=function(...args:any[]){const image=args[0];if(this.canvas.id==='world-canvas'&&image instanceof HTMLCanvasElement&&image.width===768&&image.height===576)s.draws++;return d.apply(this,args as any);};});
 const state=()=>page.evaluate(async()=>{const module=await import('/assets/hud/scene-renderer.js' as string);return module.getWorldState();});
 for(const [period,hour,opacity]of [['day',12,0],['dusk',18,.12],['night',23,.70]] as const){epoch=Date.parse(`2026-10-25T${hour}:00:00+08:00`);await page.goto(origin);await expect.poll(async()=>(await state())?.worldScene.phase).toBe('ready');await expect.poll(async()=>(await state())?.lighting.period).toBe(period);assert.equal((await state()).lighting.opacity,opacity);await page.locator('#world-fit').click();await page.screenshot({path:resolve(out,period+'-1440.png')});}
 await expect.poll(async()=>(await state()).meanDrawMs).toBeGreaterThan(0);const before=await page.evaluate(()=>(window as any).__night);assert.equal(before.gradients,52);assert.equal(before.readbacks,1);assert.ok(before.draws>=4);const nightState=await state();assert.deepEqual(nightState.lighting.color,[12,20,38]);assert.equal(nightState.lighting.people,1.12);assert.equal(nightState.worldScene.avatars[0].fact.position.x,0);
 await page.setViewportSize({width:811,height:854});await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>(await state()).reducedMotion).toBe(true);await page.locator('#world-fit').click();await page.screenshot({path:resolve(out,'night-811-reduced.png')});await page.locator('#world-zoom-in').click();const after=await page.evaluate(()=>(window as any).__night);assert.equal(after.gradients,before.gradients);assert.equal(after.readbacks,before.readbacks);assert.equal((await state()).lighting.opacity,.70);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'cache-sample.json'),JSON.stringify({scope:'Source/static fixture, no UAT performance claim',before,after,nightFrameSample:{fps:nightState.fps,meanDrawMs:nightState.meanDrawMs},nightPalette:nightState.lighting},null,2)+'\n');
});
