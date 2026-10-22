// Public-only synthetic fixtures; no live users, content, credentials or writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
const origin='https://public-character.invalid',root=resolve('apps/web/public'),out=resolve('outputs/public-character-card');
const look={lookId:'sunnyside-human-longhair',catalogVersion:'2026-10-21.appearance-v1.1'};
test('public character card stays mounted across movement, isolates late selections and removes unavailable public content',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>context.close());
 let reads=0,version=7,step=0,deferA=false,unavailableB=false,removeB=false,releaseA:()=>void=()=>{};const profileReads:string[]=[],errors:string[]=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin){await route.abort();return;}
  if(url.pathname.startsWith('/v1/')){
   assert.equal(req.method(),'GET');assert.equal(req.headers().authorization,undefined);
   const json=(data:unknown)=>route.fulfill({json:data}),path=url.pathname;
   if(path==='/v1/capabilities')return json({apiVersion:'v1',instanceId:'synthetic',gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}});
   if(path==='/v1/world/rules')return json({protocolVersion:1,instanceId:'synthetic',serverTime:Date.now(),data:{world:{worldId:'default',active:true,revision:1,rulesetVersion:1},rules:{worldId:'default',version:1,topologyVersion:1,width:16,height:16,places:[{id:'commons',access:'members'}]},asOf:Date.now()}});
   if(path==='/v1/world/scene'){reads++;return json({protocolVersion:1,instanceId:'synthetic',serverTime:Date.now(),data:{worldId:'default',worldRevision:reads,asOf:Date.now(),scope:'world',complete:true,nextCursor:null,avatars:['a',...removeB?[]:['b']].map((id,index)=>({id:'avatar-'+id,agentId:'public-'+id,worldId:'default',version:reads,status:'idle',position:index?{x:8,y:8}:{x:3+step,y:3},placeId:'commons',rulesetVersion:1,createdAt:1,updatedAt:1,profile:{agentId:'public-'+id,publishedVersion:version,displayName:id==='a'?'林间旅人':'山边访客',appearance:look}}))}});}
   if(path.startsWith('/v1/public/agents/')){const id=path.split('/').at(-1)!;profileReads.push(id);if(id==='public-a'&&deferA)await new Promise<void>(done=>{releaseA=done;});if(id==='public-b'&&unavailableB)return route.fulfill({status:404,json:{error:{code:'target_not_accessible'}}});return json({agentId:id,publishedVersion:version,membership:{state:'joined'},appearance:look,profile:{displayName:id==='public-a'?'林间旅人':'山边访客',...(id==='public-a'?{bio:'喜欢把沿途见闻写下来。',interests:['散步','阅读']}:{} )}});}
   return route.fulfill({status:404,json:{error:{code:'not_found'}}});
  }
  const file=resolve(root,url.pathname.startsWith('/assets/')?decodeURIComponent(url.pathname.slice(8)):'index.html');try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.html':'text/html'} as Record<string,string>)[extname(file)]||'text/plain'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
 const card=page.locator('#world-detail'),open=async(id:string)=>{await expect(page.locator('.world-owned-hit[data-agent-id="'+id+'"]')).toBeAttached();const point=await page.evaluate(async id=>{const state=(await import('/assets/hud/scene-renderer.js' as string)).getWorldState(),row=state.worldScene.avatars.find((row:any)=>row.fact.agentId===id),c=state.camera,box=document.querySelector('#world-canvas')!.getBoundingClientRect();return{x:box.left+c.width/2+(row.x-c.x)*c.scale,y:box.top+(state.mode==='overview'?(c.height+88-126)/2:c.height/2)+(row.y-c.y)*c.scale-12};},id);await page.mouse.click(point.x,point.y);await expect(card).toBeVisible();};
 await open('public-a');await expect(page.locator('.character-card-name')).toHaveText('林间旅人');await expect(page.locator('.character-card-bio')).toHaveText('喜欢把沿途见闻写下来。');await expect(page.locator('.character-card-tag')).toHaveText(['散步','阅读']);await expect(page.locator('.character-card-portrait canvas')).toHaveAttribute('data-appearance-state','ready');
 assert.doesNotMatch(await card.innerText(),/版本|public-a|avatar-|投影|聊天|保存/u);const box=await card.boundingBox(),hud=await page.locator('#world-status-hud').boundingBox();assert.ok(box&&box.width<=320&&box.height<=360);assert.ok(hud&&!(box.x<hud.x+hud.width&&box.x+box.width>hud.x&&box.y<hud.y+hud.height&&box.y+box.height>hud.y));
 await page.evaluate(()=>{(window as any).__cardNodes=[document.querySelector('.public-character-card'),document.querySelector('.character-card-name'),document.querySelector('.character-card-portrait canvas')];});const before=reads;step=1;await expect.poll(()=>reads).toBeGreaterThanOrEqual(before+3);
 assert.equal(await page.evaluate(()=>{const rows=(window as any).__cardNodes;return rows[0]===document.querySelector('.public-character-card')&&rows[1]===document.querySelector('.character-card-name')&&rows[2]===document.querySelector('.character-card-portrait canvas');}),true);assert.deepEqual(profileReads,['public-a']);
 await mkdir(out,{recursive:true});await page.screenshot({path:resolve(out,'public-filled-1440.png')});
 await page.keyboard.press('Escape');await expect(card).toBeHidden();deferA=true;await open('public-a');await expect(page.locator('.character-card-status')).toContainText('正在读取');await page.keyboard.press('Escape');await open('public-b');await expect(page.locator('.character-card-bio')).toHaveText('尚未填写简介。');await expect(page.locator('.character-card-empty')).toHaveText('尚未填写兴趣。');releaseA();await expect(page.locator('.character-card-name')).toHaveText('山边访客');
 unavailableB=true;version++;await expect(page.locator('.character-card-status')).toContainText('公开资料暂不可查看');await expect(page.locator('.character-card-hero')).toBeHidden();await expect(page.locator('.character-card-bio')).toBeHidden();assert.equal(await page.locator('.character-card-portrait canvas').count(),0);removeB=true;await expect(card).toBeHidden();assert.deepEqual(errors,[]);
});
