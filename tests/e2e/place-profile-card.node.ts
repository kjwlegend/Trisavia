// Isolated source-card engineering check. No real user, Agent identity, database or production entry is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import Fastify from 'fastify';
import {chromium,expect} from '@playwright/test';
import source from '../../docs/workstreams/ws02-perception/product/place-profiles-20261027/profiles.v1.json' with {type:'json'};
import {createPublishedWorldPlaceProfilesService} from '../../apps/platform/application/world-place-profiles-source.ts';
import {townExpansionRules,TOWN_EXPANSION_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-expansion-v1.ts';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';

const web=resolve('apps/web/public'),out=resolve('outputs/place-profiles-v0101/source-card');
test('48 authored places render lazily in the shared source card, including desktop and narrow layouts',async t=>{
  const read=async(name:string)=>JSON.parse(await readFile(resolve(web,'world-life',name),'utf8'));
  const rules=townExpansionRules(await read('world-map-expansion-v1.json'),TOWN_EXPANSION_LAYOUT_SHA256,await read('spatial-manifest-expansion-v1.json'));
  const service=createPublishedWorldPlaceProfilesService({async readPublicRules(){return{rules,asOf:1234};}}),requests:string[]=[],errors:string[]=[],measurements:any[]=[];
  const styles=(await readFile(resolve(web,'index.html'),'utf8')).match(/<link\b[^>]*rel="stylesheet"[^>]*>/g)!.join('');
  const app=Fastify({logger:false});t.after(()=>app.close());
  app.addHook('onRequest',async req=>{assert.equal(req.method,'GET');requests.push(req.url);});
  app.get('/place-profile-source',(_req,reply)=>reply.type('text/html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/assets/hud/place-profile-card.css"></head><body class="world-home paper-hud"><aside class="world-detail is-place-profile" id="world-detail" aria-label="场所源页面检查" hidden><div class="world-detail-top"><h2>场所</h2><button type="button" aria-label="关闭">×</button></div><div class="world-detail-body"><p id="world-detail-description"></p><p id="world-detail-note"></p><button type="button" id="world-back">返回地图</button></div></aside><script type="module" src="/place-profile-source.js"></script></body></html>`));
  app.get('/place-profile-source.js',(_req,reply)=>reply.type('text/javascript').send(`import {createPlaceProfileCard} from '/assets/hud/place-profile-card.js';
const shell=document.querySelector('#world-detail'),card=createPlaceProfileCard({onChange:value=>document.body.dataset.phase=value.phase});shell.querySelector('.world-detail-body').prepend(card.node);
window.sourceOpen=async id=>{shell.hidden=false;shell.classList.toggle('is-life-place',id.startsWith('life-place:')||id==='h-tavern');return card.open({kind:'world-place',id});};
const close=()=>{card.close();shell.hidden=true;};document.querySelector('#world-back').onclick=close;shell.querySelector('[aria-label="关闭"]').onclick=close;window.sourceReady=true;`));
  app.get('/v1/world/place-profile',async req=>({protocolVersion:1,instanceId:'own-place-profile-source',data:await service.query({} as RuntimeReadContext,null,'world.place_profile',req.query as any)}));
  registerSiteRoutes(app,{assetMode:'source',repoRoot:resolve('.'),webRoot:web});await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1083,height:1084}});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await mkdir(out,{recursive:true});await page.goto(origin+'/place-profile-source');
  try{await page.waitForFunction(()=>Boolean((window as any).sourceReady));}catch(error){await page.screenshot({path:resolve(out,'startup-failure.png')});await writeFile(resolve(out,'startup-failure.json'),JSON.stringify({requests,errors,html:await page.content()},null,2)+'\n');throw error;}
  assert.equal(requests.filter(p=>p.includes('place-profiles-map-v1.png')||p.includes('care-watering.png')).length,0,'Importing the card must not preload any place image');
  async function open(targetId:string){await page.evaluate(id=>(window as any).sourceOpen(id),targetId);await expect(page.locator('.place-profile-image')).toHaveAttribute('data-image-phase','ready');await page.evaluate(()=>Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))));}
  async function inspect(targetId:string,width:number,height:number,screenshot?:string){
    await page.setViewportSize({width,height});await open(targetId);
    const stats=await page.evaluate(()=>{const box=(selector:string)=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},style=getComputedStyle(document.querySelector('.place-profile-description')!);return{viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,image:box('.place-profile-image'),text:box('.place-profile-copy'),panel:box('#world-detail'),back:box('#world-back'),opacity:getComputedStyle(document.querySelector('#world-detail')!).opacity,color:style.color,fontSize:style.fontSize,lineHeight:style.lineHeight,ownerRows:document.querySelectorAll('.place-profile-owner').length,innerScroll:[...document.querySelectorAll('.place-profile-card,.place-profile-copy')].filter(n=>n.scrollHeight>n.clientHeight+1).length};});
    measurements.push({targetId,...stats});await writeFile(resolve(out,'layout-progress.json'),JSON.stringify(measurements,null,2)+'\n');if(screenshot)await page.screenshot({path:resolve(out,screenshot)});
    assert.equal(stats.overflow,false);assert.equal(stats.image.width,width<600?112:192);assert.ok(stats.image.right<=stats.text.x);assert.equal(stats.color,'rgb(38, 63, 54)');assert.equal(stats.fontSize,'14px');assert.equal(stats.lineHeight,'24px');assert.equal(stats.ownerRows,0);assert.equal(stats.innerScroll,0);assert.ok(stats.panel.x>=0&&stats.panel.right<=width);assert.ok(stats.panel.height<760);assert.ok(stats.panel.bottom-stats.back.bottom<=40,'No fixed panel height may leave a large empty footer');assert.equal(stats.opacity,'1');
  }
  await inspect('s-green',1083,1084,'garden-desktop.png');await inspect('s-green',390,844,'garden-narrow.png');await inspect('life-place:harbor_tavern',390,844,'tavern-narrow.png');await inspect('commons',1083,1084,'commons-desktop.png');await inspect('region:pine-walk',390,844,'walking-region-narrow.png');
  for(const authored of source.profiles){await open(authored.target.id);await expect(page.locator('.place-profile-name')).toHaveText(authored.name);await expect(page.locator('.place-profile-description')).toHaveText(authored.description);assert.equal(await page.locator('.place-profile-image svg').getAttribute('viewBox'),authored.image.sourceRect.join(' '));}
  await page.getByRole('button',{name:'返回地图',exact:true}).click();await expect(page.locator('#world-detail')).not.toBeVisible();assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'results.json'),JSON.stringify({scope:'Isolated source card with real authored catalog and exact static assets; not production shared-entry or real service acceptance.',initialImageRequests:0,profilesChecked:source.profiles.length,measurements,requests,errors},null,2)+'\n');
});
