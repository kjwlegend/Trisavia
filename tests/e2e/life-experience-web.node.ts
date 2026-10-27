// Isolated source UI. DTOs are synthetic reads, never real Agent commands.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';import {lifeCUiFixture} from '../fixtures/life-c-ui.ts';
// @ts-expect-error Browser module.
import {createExpressionLifecycle} from '../../apps/web/public/hud/world-expression-lifecycle.js';
// @ts-expect-error Browser module.
import {readExpressions,expressionActors} from '../../apps/web/public/hud/world-expression-reader.js';
// @ts-expect-error Browser module.
import {readWorldMotion} from '../../apps/web/public/hud/world-scene-projection.js';

test('unshown current expressions wait within original deadlines; shown, closed and expired IDs never replay',()=>{
 let mono=0;const base=1800000000000,actor={agentId:'own-a',status:'idle',profile:{displayName:'样本'},activity:{activityId:'work-1',actionId:'work.shift',state:'active'}};
 const row=(id:string,kind='speech',ttl=12000)=>({expressionId:id,kind,origin:kind==='status'?'authoritative_action':'agent_authored',actor:{kind:'agent',id:actor.agentId},worldId:'default',sceneId:'default:pixel-town-v2',createdAt:base,expiresAt:base+ttl,text:kind==='status'?'正在帮工':'真实原句',emoteId:null,sourceActivityId:kind==='status'?'work-1':null});
 const state=(expressions:any[])=>({instanceId:'own',worldId:'default',rules:{mapManifest:{mapId:'pixel-town-v2'}},phase:'ready',stale:false,complete:true,serverTime:base+mono,avatars:[actor],npcs:[],expressions});
 const lifecycle=createExpressionLifecycle({now:()=>mono}),pending=row('pending');lifecycle.observe(state([pending]));lifecycle.admit([]);assert.equal(lifecycle.candidates().length,1);mono=4000;lifecycle.observe(state([pending]));assert.equal(lifecycle.remaining(lifecycle.candidates()[0]),2800);lifecycle.admit(['pending']);assert.equal(lifecycle.candidates()[0].entered,true);lifecycle.admit([]);assert.equal(lifecycle.candidates().length,0);mono=4100;lifecycle.observe(state([pending]));assert.equal(lifecycle.candidates().length,0,'a previously displayed ID cannot reenter after losing space');
 const actors=expressionActors([actor],[]);for(const ttl of [6000,12000]){const read=readExpressions([row('status-'+ttl,'status',ttl)],{actors});assert.equal(read.expressionError,null);const clock=createExpressionLifecycle({now:()=>mono});mono=0;clock.observe(state(read.expressions));clock.admit([]);mono=ttl-10;assert.equal(clock.remaining(clock.candidates()[0]),10);mono=ttl+1;assert.equal(clock.candidates().length,0);}
 assert.equal(readExpressions([row('bad-status','status',9000)],{actors}).expressionError,'world_expression_invalid');assert.equal(readExpressions([row('bad-speech','speech',6000)],{actors}).expressionError,'world_expression_invalid');
 mono=0;const off=createExpressionLifecycle({now:()=>mono});off.observe(state([row('off')]));off.admit([],{discardPending:true});assert.equal(off.candidates().length,0);off.observe(state([row('off')]));assert.equal(off.candidates().length,0);const stale=createExpressionLifecycle({now:()=>mono});stale.observe(state([row('stale')]));stale.observe({...state([row('stale')]),stale:true});stale.observe(state([row('stale')]));assert.equal(stale.candidates().length,0);
});

test('current and legacy motion durations retain absolute time and known topology validation',()=>{
 const rules={version:6,topologyVersion:6,bounds:{minX:-28,minY:-28,maxX:91,maxY:59}},avatar={id:'own-avatar',version:2,position:{x:5,y:6}},motion={segmentId:'own-avatar:2',movementId:'own-move',source:'explicit',from:{x:4,y:6},to:{x:5,y:6},startedAt:10000,arriveAt:10500,rulesetVersion:6,topologyVersion:6,status:'committed'};
 for(const source of ['explicit','idle'])for(const duration of source==='idle'?[1000,4000]:[500,1000])for(const version of [2,3,4,5,6])assert.deepEqual(readWorldMotion({...motion,source,arriveAt:motion.startedAt+duration,rulesetVersion:version,topologyVersion:version},avatar,rules),{...motion,source,arriveAt:motion.startedAt+duration,rulesetVersion:version,topologyVersion:version});
 for(const patch of [{arriveAt:10750},{source:'idle',arriveAt:10500},{from:{x:3,y:6}},{topologyVersion:5},{to:{x:92,y:6}}])assert.throws(()=>readWorldMotion({...motion,...patch},avatar,rules));
});

test('a currently valid unseen bubble can appear after an obstruction clears, without replaying a shown ID',async t=>{
 const origin='https://experience-bubble.invalid',root=resolve('apps/web/public'),out=resolve('outputs/life-experience-v080'),unexpected:string[]=[],errors:string[]=[],requests:string[]=[];
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:811,height:854}});t.after(()=>context.close());await mkdir(out,{recursive:true});
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());requests.push(u.pathname);if(u.origin!==origin||req.method()!=='GET'){unexpected.push(req.method()+' '+u.href);await route.abort();return;}
  if(u.pathname==='/'){await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/hud/world-expressions.css"><style>#stage{position:relative;width:760px;height:600px;background:#e5ead9}#world-detail{position:absolute;left:220px;top:120px;width:240px;height:300px;background:#f7f3e8;z-index:8}#actor{position:absolute;left:280px;top:250px;width:32px;height:50px}</style></head><body><button id="obstruction">显示/关闭遮挡</button><button id="advance">经过一秒</button><div id="stage"><button id="actor" aria-label="自有样本">人</button><div id="world-detail">已打开的面板</div></div><script type="module">
   import{createExpressionLifecycle}from'/assets/hud/world-expression-lifecycle.js';import{createExpressionLayer}from'/assets/hud/world-expression-layer.js';
   let mono=0;const base=1800000000000,actor={agentId:'own-bubble',status:'idle',profile:{displayName:'自有样本'},activity:null},row={expressionId:'same-original-id',kind:'speech',origin:'agent_authored',actor:{kind:'agent',id:actor.agentId},worldId:'default',sceneId:'default:pixel-town-v2',createdAt:base,expiresAt:base+12000,text:'真实原句',emoteId:null,sourceActivityId:null},lifecycle=createExpressionLifecycle({now:()=>mono});lifecycle.observe({instanceId:'own',worldId:'default',rules:{mapManifest:{mapId:'pixel-town-v2'}},phase:'ready',stale:false,complete:true,serverTime:base,avatars:[actor],npcs:[],expressions:[row]});
   const stage=document.getElementById('stage'),panel=document.getElementById('world-detail'),layer=createExpressionLayer(stage,lifecycle),actors=new Map([['agent:own-bubble',{name:'自有样本',activity:null,rect:{left:280,right:312,top:250,bottom:300}}]]),draw=()=>layer.tick({actors,scale:1,active:true,reducedMotion:true});window.actorClicks=0;document.getElementById('actor').onclick=()=>window.actorClicks++;document.getElementById('obstruction').onclick=()=>{panel.hidden=!panel.hidden;draw();};document.getElementById('advance').onclick=()=>{mono+=1000;draw();};window.remaining=()=>lifecycle.candidates().map(r=>lifecycle.remaining(r));draw();window.ready=true;window.addEventListener('pagehide',()=>layer.dispose());
  </script></body></html>`});return;}
  if(!u.pathname.startsWith('/assets/')){unexpected.push(u.pathname);await route.abort();return;}const path=resolve(root,decodeURIComponent(u.pathname.slice(8)));if(!path.startsWith(root+'/')){unexpected.push(u.pathname);await route.abort();return;}try{await route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json'} as Record<string,string>)[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await expect.poll(()=>page.evaluate(()=>(window as any).ready)).toBe(true);await expect(page.locator('.world-expression')).toHaveCount(0);assert.deepEqual(await page.evaluate(()=>(window as any).remaining()),[6800]);await page.getByRole('button',{name:'经过一秒'}).click();await page.getByRole('button',{name:'显示/关闭遮挡'}).click();
 const bubble=page.locator('.world-expression');await expect(bubble).toHaveCount(1);await expect(bubble).toHaveAttribute('data-expression-id','same-original-id');await expect(bubble).toHaveAttribute('aria-label','自有样本：真实原句');assert.deepEqual(await page.evaluate(()=>(window as any).remaining()),[5800]);assert.equal(await bubble.evaluate(n=>getComputedStyle(n).pointerEvents),'none');await page.getByRole('button',{name:'自有样本',exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).actorClicks),1);await page.screenshot({path:resolve(out,'pending-bubble-811.png')});
 await page.getByRole('button',{name:'显示/关闭遮挡'}).click();await expect(bubble).toHaveCount(0);await page.getByRole('button',{name:'显示/关闭遮挡'}).click();await expect(bubble).toHaveCount(0);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.ok(!requests.some(p=>p.startsWith('/v1/')),'No expression polling or actor HTTP');await writeFile(resolve(out,'pending-bubble-results.json'),JSON.stringify({scope:'Synthetic source layer only; no real expression publication',requests,unexpected,errors},null,2)+'\n');await page.close();
});

test('place cards omit arrival coaching while preserving authoritative blockers and bounded copy',async t=>{
 const f=await lifeCUiFixture(),origin='https://life-experience.invalid',root=resolve('apps/web/public'),out=resolve('outputs/life-experience-v080'),reads:any[]=[],outside:string[]=[],errors:string[]=[];let blocked=false;
 const styles=(await readFile(resolve(root,'index.html'),'utf8')).match(/<link rel="stylesheet"[^>]+>/g)!.join('');
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:811,height:854}});t.after(()=>context.close());await mkdir(out,{recursive:true});
 await context.addInitScript(()=>{(window as any).copies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>(window as any).copies.push(text)}});});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());if(u.origin!==origin){outside.push(req.method()+' '+u.href);await route.abort();return;}
  if(u.pathname==='/fixture/read'){
   const {operation,input,agentId}=req.postDataJSON();reads.push({operation,input});let data;
   if(operation==='items')data=f.items(agentId,input.itemIds);
   else if(operation==='options'){const offer=(f.catalog.data.actions as any[]).find(a=>a.actionId===input.actionId&&a.placeId===input.placeId);data=f.options(agentId,offer,input.params);if(blocked)data={...data,data:{...data.data,available:false,reasons:['not_at_place','body_occupied']}};}
   else{outside.push('unexpected operation '+operation);await route.abort();return;}
   await route.fulfill({json:data});return;
  }
  if(req.method()!=='GET'){outside.push(req.method()+' '+u.pathname);await route.abort();return;}
  if(u.pathname==='/v1/world/life/actions'){await route.fulfill({json:f.catalog});return;}
  if(u.pathname==='/v1/world/life/shop/quote'){await route.fulfill({json:f.quote(u.searchParams.get('side')!,u.searchParams.get('itemId')!)});return;}
  if(u.pathname==='/'){
   await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{overflow:auto;background:#f7f3e8;color:#263f36}.fixture{padding:24px;max-width:760px;margin:auto}.fixture nav{display:flex;gap:8px}.life-place-card{padding:0}</style></head><body class="world-home paper-hud"><main class="fixture"><nav><button id="shop">商店</button><button id="tavern">酒馆</button><button id="library">书屋</button><button id="inn">旅舍</button></nav><div id="host"></div></main><script type="module">
    import{api}from'/assets/common.js';import{createLifePlaceCard}from'/assets/hud/life-place-card.js';
    const agent={agentId:'own-experience-agent',publicId:'A901',name:'自有样本'},context={authenticated:true,phase:'ready',selectedAgentId:agent.agentId,observationRevision:1,agents:[agent]},session={snapshot:()=>context,subscribe(fn){fn(context);return()=>{};},readLife(operation,input,options){return api('/../fixture/read',{method:'POST',body:{operation,input,agentId:agent.agentId},signal:options.signal});}};
    const card=createLifePlaceCard(session,{getWorldState:()=>({rules:${JSON.stringify(f.rules)},worldScene:{stale:false}})});document.querySelector('#host').append(card.node);for(const[id,placeId]of[['shop','fisher_shop'],['tavern','harbor_tavern'],['library','blue_library'],['inn','stone_inn']])document.getElementById(id).onclick=()=>card.open({kind:'life-place',placeId});card.open({kind:'life-place',placeId:'fisher_shop'});
   </script></body></html>`});return;
  }
  if(!u.pathname.startsWith('/assets/')){outside.push(req.method()+' '+u.pathname);await route.abort();return;}
  const path=resolve(root,decodeURIComponent(u.pathname.slice(8)));if(!path.startsWith(root+'/')){outside.push(u.pathname);await route.abort();return;}
  try{await route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'} as Record<string,string>)[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);const card=page.locator('.life-place-card');
 await expect(card.getByRole('button',{name:'复制购买指引'}).first()).toBeEnabled();await expect(card).not.toContainText('尚未到场');await expect(card).not.toContainText('当前条件允许尝试');await card.getByRole('button',{name:'复制购买指引'}).first().click();
 const copied=await page.evaluate(()=>(window as any).copies[0]);assert.match(copied,/先前往 fisher_shop/);assert.match(copied,/读取/);assert.ok(reads.some(r=>r.operation==='options'));
 for(const name of ['酒馆','书屋','旅舍']){await page.getByRole('button',{name,exact:true}).click();await expect(card.locator('.life-c-place .life-facts').first()).toBeVisible();await expect(card).not.toContainText('尚未到场');await expect(card).not.toContainText('当前可尝试');}
 blocked=true;await card.getByRole('button',{name:'刷新活动与条件'}).click();await expect(card).toContainText('身体正被其他活动或计划占用');await expect(card.getByRole('button',{name:'复制给 Agent',exact:true})).toBeDisabled();await expect(card).not.toContainText('尚未到场');
 assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(out,'arrival-card-811.png')});await writeFile(resolve(out,'arrival-results.json'),JSON.stringify({scope:'Synthetic source-only read DTOs; no runtime or business mutation',reads,copied,outside,errors},null,2)+'\n');await page.close();
});
