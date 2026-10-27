// Isolated source UI. DTOs are synthetic reads, never real Agent commands.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';import {lifeCUiFixture} from '../fixtures/life-c-ui.ts';

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
