// Explicit production/static timing fixture, never a claim about UAT latency.
// Run build:web after source changes, then node --test tests/e2e/world-startup.node.ts.
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

test('first verified public scene and usable map overlap loading without anonymous Owner reads',async t=>{
 const baseline=process.env.WEB_STARTUP_BASELINE==='1',fixture=await lifeUiFixture(),app=Fastify({logger:false}),requests:{method:string;url:string}[]=[],results:any[]=[];
 app.addHook('onRequest',async request=>{requests.push({method:request.method,url:request.url});if(['/v1/capabilities','/v1/world/rules','/v1/world/scene','/world-map-life-v1.json'].includes(request.url.split('?')[0]!))await new Promise(done=>setTimeout(done,200));});
 registerHealthRoute(app,async()=>({instanceId:'startup-public-fixture'}));
 const envelope=(data:unknown)=>({protocolVersion:1,instanceId:'startup-public-fixture',serverTime:Date.now(),data});
 app.get('/v1/capabilities',()=>({apiVersion:'v1',instanceId:'startup-public-fixture',perception:false,gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}}));
 app.get('/v1/world/rules',()=>envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:3},rules:fixture.rules,asOf:Date.now()}));
 app.get('/v1/world/scene',()=>envelope({worldId:'default',scope:'world',worldRevision:7,asOf:Date.now(),avatars:[{...avatar('startup-resident',{x:0,y:0}),rulesetVersion:3,profile:{agentId:'startup-resident',publicId:'A901',publishedVersion:1,displayName:'首场景验证居民',appearance:{lookId:'sunnyside-human-longhair',catalogVersion:'2026-10-21.appearance-v1.1'}}}],npcs:[],complete:true,nextCursor:null}));
 registerSiteRoutes(app,{assetMode:'production',repoRoot:resolve('.')});const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>context.close());
 const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 for(const cache of ['cold','warm']){
  const start=requests.length;if(cache==='cold')await page.goto(origin);else await page.reload();
  await expect(page.locator('#world-canvas')).toHaveAttribute('data-world-source','server');
  await expect(page.locator('.world-owned-hit[data-agent-id="startup-resident"]')).toBeVisible();
  await expect(page.locator('#world-zoom-in')).toBeEnabled();const sceneAndCanvasReadyMs=await page.evaluate(()=>performance.now()),before=await page.locator('#world-zoom').innerText();await page.locator('#world-zoom-in').click();await expect(page.locator('#world-zoom')).not.toHaveText(before);
  const timing=await page.evaluate(()=>({usableMs:performance.now(),readyMarks:performance.getEntriesByName('trisavia:first-scene-ready').map(entry=>({at:entry.startTime,detail:(entry as PerformanceMark).detail})),resources:performance.getEntriesByType('resource').map(entry=>{const r=entry as PerformanceResourceTiming;return{path:new URL(r.name).pathname,start:r.startTime,end:r.responseEnd,transferBytes:r.transferSize};}).filter(r=>r.path==='/v1/capabilities'||r.path==='/v1/world/rules'||r.path==='/v1/world/scene'||r.path==='/world-map-life-v1.json'||r.path.startsWith('/assets/world-pixel/')&&r.path.endsWith('.png'))})),round=requests.slice(start),caps=timing.resources.filter(r=>r.path==='/v1/capabilities'),rules=timing.resources.find(r=>r.path==='/v1/world/rules')!,scene=timing.resources.find(r=>r.path==='/v1/world/scene')!;
  assert(scene.end>0&&rules.end>0);assert(round.every(r=>r.method==='GET'&&!r.url.startsWith('/v1/owner/')));assert.ok(sceneAndCanvasReadyMs>=scene.end,'Ready includes receipt and validation of the actual scene, not only a canvas element');
  if(!baseline){assert.equal(caps.length,1);assert.ok(scene.start<rules.end,'First scene must overlap rules, then be validated against them');const layout=timing.resources.find(r=>r.path==='/world-map-life-v1.json')!;assert.ok(caps[0]!.start<layout.end,'Public reads must not wait for all map assets');assert.ok(timing.resources.some(r=>r.path.endsWith('.png')&&r.start<layout.end),'Digest-checked art starts while layout is in flight');assert.equal(timing.readyMarks.length,1);assert.ok(timing.readyMarks[0]!.at>=Math.max(scene.end,rules.end,layout.end));assert.deepEqual(timing.readyMarks[0]!.detail,{instanceId:'startup-public-fixture',worldRevision:7,rulesVersion:3});}
  results.push({cache,sceneAndCanvasReadyMs,...timing,capabilityRequests:caps.length,requests:round.length,ownerReads:round.filter(r=>r.url.startsWith('/v1/owner/')).length});
 }
 assert.deepEqual(errors,[]);const out=resolve('outputs/world-startup-v047');await mkdir(out,{recursive:true});await writeFile(resolve(out,baseline?'before.json':'after.json'),JSON.stringify({scope:'Local production browser with synthetic public reads and 200ms endpoint/layout delay; no UAT conclusion',results},null,2)+'\n');for(const result of results)t.diagnostic(JSON.stringify({cache:result.cache,sceneAndCanvasReadyMs:result.sceneAndCanvasReadyMs,usableMs:result.usableMs,capabilityRequests:result.capabilityRequests,ownerReads:result.ownerReads,requests:result.requests}));
});
