// Synthetic rendering engineering checks. Every request is intercepted: no
// listener, real candidate, account, credentials or database is used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
const origin='https://pixel-world.invalid',root=resolve('apps/web/public'),out=resolve(process.env.WORLD_PIXEL_ARTIFACTS||'outputs/world-core-web/pixel-activation/synthetic-browser');
const envelope=(data:unknown)=>({protocolVersion:1,requestId:'synthetic',instanceId:'synthetic-pixel-instance',serverTime:Date.now(),data});
const avatar=(id:string,x=0,y=0)=>({id:`avatar-${id}`,worldId:'default',agentId:id,version:1,status:'idle',position:{x,y},placeId:'commons',rulesetVersion:1,createdAt:1,updatedAt:1,profile:{agentId:id,publishedVersion:1,displayName:`工程角色 ${id}`,appearance:{template:'basic',color:'blue'}}});
async function fixture(context:BrowserContext,{failImage=false,paging=false}={}){
 let rows=paging?Array.from({length:11},(_,i)=>avatar(`page-${i}`,i,0)):[avatar('A'),avatar('B'),avatar('C',15,15)],sceneStatus=200,revision=1,sceneCode='world_not_accessible',retryAfter:string|null=null;
 const paths:string[]=[],outside:string[]=[],auth:string[]=[],images=new Set<string>();
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());paths.push(url.pathname);if(request.headers().authorization)auth.push(url.pathname);
  if(url.origin!==origin){outside.push(url.origin);await route.abort();return;}
  if(url.pathname==='/v1/capabilities'){await route.fulfill({json:{apiVersion:'v1',instanceId:'synthetic-pixel-instance',perception:false,gateway:{protocolVersion:1,modules:['world'],worldSimulation:{enabled:true}}}});return;}
  if(url.pathname==='/v1/world/rules'){await route.fulfill({json:envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:1},rules:{worldId:'default',version:1,topologyVersion:1,width:16,height:16},asOf:Date.now()})});return;}
  if(url.pathname==='/v1/world/scene'){const offset=paging?Number((url.searchParams.get('cursor')||'opaque-0').split('-')[1]):0,complete=!paging||offset===rows.length-1;await route.fulfill(sceneStatus===200?{json:envelope({worldId:'default',worldRevision:revision,asOf:Date.now(),scope:'world',avatars:paging?rows.slice(offset,offset+1):rows,complete,nextCursor:complete?null:`opaque-${offset+1}`})}:{status:sceneStatus,headers:retryAfter?{'Retry-After':retryAfter}:{},json:{error:{code:sceneCode}}});return;}
  if(url.pathname==='/'||url.pathname==='/owner'){await route.fulfill({contentType:'text/html',body:await readFile(resolve(root,'index.html'))});return;}
  if(url.pathname.startsWith('/assets/')){
   const path=resolve(root,decodeURIComponent(url.pathname.slice(8)));if(!path.startsWith(root+'/')){await route.abort();return;}
   if(url.pathname.endsWith('.png')){images.add(url.pathname);if(failImage&&url.pathname.endsWith('/human-base-idle.png')){await route.fulfill({status:404,body:''});return;}}
   try{await route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'} as Record<string,string>)[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:''});}return;
  }
  await route.fulfill({status:404,json:{error:{code:'not_found'}}});
 });
 return{paths,outside,auth,images,setRows(value:typeof rows){rows=value;revision++;},deny(){sceneStatus=404;sceneCode='world_not_accessible';},fail(status:number,code:string,after:string|null=null){sceneStatus=status;sceneCode=code;retryAfter=after;},recover(){sceneStatus=200;retryAfter=null;}};
}
const state=(page:Page)=>page.evaluate(async()=>{const app=await import(String('/assets/home.js'));return app.getWorldState();});
async function tool(page:Page,name:string){await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();}
async function closeRole(page:Page){const before=await page.evaluate(()=>scrollY);await expect(page.locator('#world-detail')).toHaveAttribute('data-panel-state','open');const control=page.getByRole('button',{name:'关闭角色详情',exact:true});await expect(control).toBeVisible();const box=await control.boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await expect(page.locator('#world-detail')).toBeHidden();assert.equal(await page.evaluate(()=>scrollY),before,'A native user close preserves page scroll');}
const launch=()=>chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});

test('synthetic pixel town uses all native assets and real-shaped public facts with fit, integer views, same-cell choices and existing HUD',async t=>{
 await mkdir(out,{recursive:true});const browser=await launch();t.after(()=>browser.close());
 for(const viewport of [{width:1440,height:900},{width:1361,height:765}]){
  const context=await browser.newContext({viewport}),data=await fixture(context);t.after(()=>context.close());const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));

  try{
   await page.goto(origin);await expect(page.locator('#world-canvas[data-rendering="pixel-town"]')).toBeVisible();await expect.poll(async()=>(await state(page))?.worldScene.avatars.length).toBe(3);
   let value=await state(page);assert.equal(value.rendering.imageCount,19);assert.equal([...data.images].filter(path=>path.startsWith('/assets/world-pixel/assets/')).length,19,'The original world image set remains complete beside the new native panel frames');assert.equal(value.camera.sourceWidth,768);assert.equal(value.camera.sourceHeight,512);assert.equal(value.worldScene.projectionVersion,'pixel-town-commons@1');assert.deepEqual(value.worldScene.avatars.map((row:any)=>[row.x,row.y]),[[264,136],[264,136],[504,376]]);assert.equal(value.actorCount,0);
   await expect(page.getByRole('navigation',{name:'世界功能'})).toBeVisible();for(const name of ['世界','个人','背包','信箱'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
   await page.screenshot({path:resolve(out,`synthetic-${viewport.width}-fit-day.png`)});
   await page.getByRole('button',{name:'放大地图',exact:true}).click();assert.equal((await state(page)).camera.scale,2);await page.getByRole('button',{name:'放大地图',exact:true}).click();value=await state(page);assert.equal(value.camera.scale,3);
   // Bring the spawn footpoint below the unchanged fixed header before hitting it.
   await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.down();await page.mouse.move(viewport.width/2+80,viewport.height/2+120,{steps:5});await page.mouse.up();value=await state(page);
   const canvas=await page.locator('#world-canvas').boundingBox();assert.ok(canvas);const x=canvas.x+(264-value.camera.x)*3+value.camera.width/2,y=canvas.y+(136-9.5-value.camera.y)*3+value.camera.height/2;
   await page.mouse.click(x,y);await expect(page.locator('#world-detail-title')).toHaveText('工程角色 A');await closeRole(page);
   await page.mouse.click(x,y);await expect(page.locator('#world-detail-title')).toHaveText('工程角色 B');await closeRole(page);
   const a=page.getByRole('button',{name:/工程角色 A，服务器角色/});await a.focus();const hit=await a.boundingBox();assert.ok(hit&&hit.width>=62&&hit.height>=67);await page.keyboard.press('Enter');await expect(page.locator('#world-detail-title')).toHaveText('工程角色 A');await expect(page.locator('#world-detail-description')).not.toContainText('逻辑坐标');await closeRole(page);
   const camera=(await state(page)).camera;assert.deepEqual(camera,value.camera,'All detail round trips preserve camera');
   await tool(page,'黄昏');assert.equal((await state(page)).theme,'dusk');await page.screenshot({path:resolve(out,`synthetic-${viewport.width}-3x-dusk.png`)});
   await tool(page,'减少动态');await expect.poll(async()=>(await state(page)).reducedMotion).toBe(true);const still=await state(page);await tool(page,'刷新世界');await expect.poll(async()=>(await state(page)).worldScene.avatars.length).toBe(3);assert.deepEqual((await state(page)).worldScene.avatars,still.worldScene.avatars);
   const box=await page.locator('#world-canvas').boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+50,{steps:5});await page.mouse.up();assert.notDeepEqual((await state(page)).camera,camera,'Drag changes camera only');assert.deepEqual((await state(page)).worldScene.avatars,still.worldScene.avatars);
   await page.getByRole('button',{name:'全景',exact:true}).click();value=await state(page);assert.equal(value.mode,'overview');
   data.setRows([]);await tool(page,'刷新世界');await expect.poll(async()=>(await state(page)).worldScene.avatars.length).toBe(0);await expect(page.locator('.world-demo')).toContainText('当前公开世界没有可显示的角色');
   data.deny();await tool(page,'刷新世界');await expect.poll(async()=>(await state(page)).worldScene.phase).toBe('unavailable');assert.equal((await state(page)).worldScene.avatars.length,0);await expect(page.getByRole('button',{name:/工程角色 A，服务器角色/})).toHaveCount(0);
   assert.deepEqual(data.outside,[]);assert.deepEqual(data.auth,[]);assert.deepEqual(errors,[]);
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));await expect(page.locator('#world-canvas')).toHaveCount(0);await expect(page.locator('.world-owned-labels')).toHaveCount(0);
  }catch(error){await page.screenshot({path:resolve(out,`synthetic-${viewport.width}-failure.png`)});throw error;}finally{await page.close();await context.close();}
 }
});

test('synthetic asset failure gives retry without legacy demo characters, and Owner shell respects system reduced motion',async t=>{
 const browser=await launch();t.after(()=>browser.close());
 const failed=await browser.newContext();t.after(()=>failed.close());const failedData=await fixture(failed,{failImage:true}),page=await failed.newPage();await page.goto(origin);await expect(page.locator('#world-fallback')).toBeVisible();await expect(page.getByRole('button',{name:'重试地图',exact:true})).toBeVisible();await expect(page.locator('#world-canvas')).toHaveCount(0);assert.deepEqual(failedData.outside,[]);await failed.close();
 const context=await browser.newContext({viewport:{width:1361,height:765},reducedMotion:'reduce'});t.after(()=>context.close());const data=await fixture(context),owner=await context.newPage();await owner.goto(`${origin}/owner`);await expect.poll(async()=>(await state(owner))?.worldScene.avatars.length).toBe(3);assert.equal((await state(owner)).reducedMotion,true);assert.equal((await state(owner)).paused,true);await expect(owner.getByRole('button',{name:'登录／注册',exact:true})).toBeVisible();assert.deepEqual(data.auth,[]);assert.deepEqual(data.outside,[]);await owner.close();await context.close();
});

test('synthetic bounded pagination displays no partial person set and manual continuation publishes the complete scene',async t=>{
 const browser=await launch();t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1440,height:900}});t.after(()=>context.close());const data=await fixture(context,{paging:true}),page=await context.newPage();await page.goto(origin);
 await expect.poll(async()=>(await state(page))?.worldScene.phase).toBe('partial');assert.deepEqual((await state(page)).worldScene.avatars,[]);await expect(page.getByRole('button',{name:/服务器角色/})).toHaveCount(0);await expect(page.locator('.world-demo')).toContainText('完整后显示');
 await tool(page,'继续载入角色');await expect.poll(async()=>(await state(page)).worldScene.avatars.length).toBe(11);assert.equal((await state(page)).worldScene.complete,true);assert.deepEqual((await state(page)).worldScene.avatars.map((row:any)=>[row.x,row.y]),Array.from({length:11},(_,i)=>[264+16*i,136]));assert.deepEqual(data.auth,[]);assert.deepEqual(data.outside,[]);await page.close();await context.close();
});

test('synthetic actual scene loop reaches received positions by the monotonic deadline even at low FPS or after pause and hidden resume',async t=>{
 const browser=await launch();t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1440,height:900}});t.after(()=>context.close());const data=await fixture(context);
 await context.addInitScript(()=>{
  let now=1000,sequence=0,hidden=false;const frames=new Map<number,FrameRequestCallback>();
  Object.defineProperty(performance,'now',{value:()=>now});Object.defineProperty(document,'hidden',{get:()=>hidden});
  window.requestAnimationFrame=callback=>{frames.set(++sequence,callback);return sequence;};window.cancelAnimationFrame=id=>frames.delete(id);
  (window as any).__worldTestFrame=(time:number)=>{now=time;const batch=[...frames.values()];frames.clear();for(const callback of batch)callback(now);};
  (window as any).__worldTestHidden=(value:boolean)=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
 });
 const page=await context.newPage();await page.goto(origin);await expect.poll(async()=>(await state(page))?.worldScene.avatars.length).toBe(3);
 const frame=(time:number)=>page.evaluate(value=>(window as any).__worldTestFrame(value),time),read=async()=>{const value=await state(page);return value.worldScene.avatars.find((entry:any)=>entry.fact.agentId==='A');};
 const move=async(x:number,version:number)=>{data.setRows([{...avatar('A',x,0),version}]);await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#world-refresh')!.click());await expect.poll(async()=>(await read())?.fact.version).toBe(version);};
 try{
  await frame(1000);await move(1,2);assert.equal((await read()).x,264,'The newly received target starts at the last visible position');
  await frame(1250);const afterStall=await read();console.log('actual-scene-loop-low-fps',JSON.stringify({receivedX:afterStall.fact.position.x,renderedX:afterStall.x,frameGapMs:250}));assert.equal(afterStall.x,280,'A 250ms main-loop gap must not become only 50ms of position catch-up');
  await move(2,3);assert.equal((await read()).x,280);await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#world-pause')!.click());assert.equal((await read()).x,296,'Pausing an in-flight transition snaps to the received target');
  await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#world-pause')!.click());await move(3,4);await frame(2250);assert.equal((await read()).x,312,'The first frame after reconcile cannot restart the position deadline');
  await move(4,5);await page.evaluate(()=>(window as any).__worldTestHidden(true));assert.deepEqual((await state(page)).worldScene.avatars,[],'Hidden clears public facts immediately');
  await frame(10000);await page.evaluate(()=>(window as any).__worldTestHidden(false));await expect.poll(async()=>(await read())?.fact.version).toBe(5);assert.equal((await read()).x,328,'Resuming starts at the fresh received position, with no hidden-time route');
  assert.deepEqual(data.outside,[]);assert.deepEqual(data.auth,[]);
 }catch(error){await mkdir(out,{recursive:true});await page.screenshot({path:resolve(out,'synthetic-deadline-failure.png')});throw error;}finally{await page.close();await context.close();}
});

test('synthetic public connection recovery labels its last-success canvas, honors rate-limit waiting and replaces it with fresh empty or withdrawn facts',async t=>{
 const browser=await launch();t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1440,height:900}});t.after(()=>context.close());const data=await fixture(context),page=await context.newPage();await page.goto(origin);
 await expect.poll(async()=>(await state(page))?.worldScene.avatars.length).toBe(3);const original=(await state(page)).worldScene;
 data.fail(503,'busy');await expect.poll(async()=>(await state(page)).worldScene.phase).toBe('recovering');await expect(page.locator('.world-demo summary')).toContainText('连接中断');await expect(page.locator('.world-demo p')).toContainText('最后成功读取');
 const retained=(await state(page)).worldScene;assert.deepEqual(retained.avatars,original.avatars);assert.equal(retained.asOf,original.asOf);assert.equal(retained.errorStatus,503);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));assert.deepEqual((await state(page)).worldScene.avatars,retained.avatars,'Recovery never invents a new position');
 data.setRows([]);data.recover();await expect.poll(async()=>{const value=(await state(page)).worldScene;return value.complete&&value.avatars.length===0&&value.lastSuccessAt>retained.lastSuccessAt&&value.errorCode===null;}).toBe(true);assert.ok(['ready','refreshing'].includes((await state(page)).worldScene.phase));assert.deepEqual((await state(page)).worldScene.avatars,[]);await expect(page.locator('.world-demo')).toContainText('当前公开世界没有可显示的角色');
 data.setRows([avatar('A')]);await tool(page,'刷新世界');await expect.poll(async()=>(await state(page)).worldScene.avatars.length).toBe(1);
 data.fail(429,'rate_limited','3');await expect.poll(async()=>(await state(page)).worldScene.phase).toBe('recovering');await page.getByRole('button',{name:'更多',exact:true}).click();await expect(page.getByRole('button',{name:'刷新世界',exact:true})).toBeDisabled();await page.getByRole('button',{name:'更多',exact:true}).click();const beforeRecovery=(await state(page)).worldScene.lastSuccessAt;data.recover();await expect.poll(async()=>{const value=(await state(page)).worldScene;return value.lastSuccessAt>beforeRecovery&&value.errorCode===null;}).toBe(true);assert.ok(['ready','refreshing'].includes((await state(page)).worldScene.phase));
 data.deny();await expect.poll(async()=>(await state(page)).worldScene.phase).toBe('unavailable');assert.deepEqual((await state(page)).worldScene.avatars,[]);assert.deepEqual(data.auth,[]);assert.deepEqual(data.outside,[]);await page.close();await context.close();
});
