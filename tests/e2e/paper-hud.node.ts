// Isolated HTTP and real production modules. No live identity or business writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {townFixture,avatar,appearance,epoch} from '../fixtures/world-town-v2.ts';

const origin='https://paper-hud.invalid',root=resolve('apps/web/public'),output=resolve('outputs/paper-hud-v3');
test('paper HUD uses real scene chrome and keeps all four navigation entries at desktop sizes',async t=>{
  const town=await townFixture(),browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());await mkdir(output,{recursive:true});
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});context.setDefaultTimeout(5000);
  const agent={agentId:'paper-agent',asOf:epoch,profile:{version:1,policyVersion:1,mode:'owner_specified',lockedFields:[],proposalPending:false,published:{displayName:'工程居民',avatar:appearance,bio:'隔离样本'},publishedAppearance:appearance,draft:null,draftAppearance:null},membership:{state:'joined',version:1,worldId:'default',ownerPaused:false,platformRestricted:false},worldAccess:{agentId:'paper-agent',version:1,intervalSeconds:null},runtimeActive:true};
  await context.addInitScript(()=>sessionStorage.setItem('connet.owner.v2',JSON.stringify({format:'connet-owner-v2',origin:location.origin,ownerId:'paper-owner',stage:'managed',sessionToken:'owner_session_fixture.'+'a'.repeat(43)})));
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;if(url.origin!==origin)return route.abort();const json=(value:unknown)=>route.fulfill({json:value}),envelope=(data:unknown)=>({protocolVersion:1,requestId:'paper-fixture',instanceId:'paper-fixture',serverTime:epoch,data});
    if(path==='/v1/capabilities')return json({apiVersion:'v1',instanceId:'paper-fixture',perception:true,perceptionApi:{protocolVersion:1,catalogRevision:1,skillCatalogRevision:1,ownerObservation:{agentRefRequired:true,inventory:true,inbox:'source-authorized',messages:'source-authorized'}},gateway:{protocolVersion:1,modules:['world','relationships','behavior','town_services'],worldSimulation:{enabled:true}}});
    if(path==='/v1/world/rules')return json(envelope({world:{worldId:'default',active:true,revision:1,rulesetVersion:2},rules:town.rules,asOf:epoch}));
    if(path==='/v1/world/scene')return json(envelope({worldId:'default',scope:'world',worldRevision:1,asOf:epoch,avatars:['paper-agent','other-a','other-b','other-c'].map((id,index)=>avatar(id,{x:index,y:0})),npcs:town.npcs,npcCatalogVersion:null,complete:true,nextCursor:null}));
    if(path==='/v1/owner/account')return json({ownerId:'paper-owner',username:'合成主人',emailVerified:true});
    if(path==='/v1/owner/agents')return json({ownerId:'paper-owner',agents:[agent]});
    if(path==='/v1/owner/agent-invites')return json({ownerId:'paper-owner',invites:[]});
    if(path==='/v1/agents/paper-agent/world-action-policy')return json({agentId:agent.agentId,version:0,mode:'autonomous',updatedAt:null,asOf:epoch,source:'current'});
    if(path==='/v1/gateway/query')return json(envelope({agentId:agent.agentId,status:'available',pendingCount:0,inbox:{operation:'relationships.inbox',input:{agentId:agent.agentId,direction:'received'}},asOf:epoch}));
    if(path==='/world-map-v2.json')return route.fulfill({body:town.bytes,contentType:'application/json'});
    if(request.method()==='GET'&&(path==='/'||path.startsWith('/assets/'))){const file=resolve(root,path==='/'?'index.html':path.slice(8));if(file.startsWith(root+'/'))try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.css':'text/css','.png':'image/png','.html':'text/html','.json':'application/json'} as Record<string,string>)[extname(file)]||'application/octet-stream'});}catch{}}
    return route.fulfill({status:404,json:{error:{code:'fixture_not_found'}}});
  });
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await expect(page.locator('#world-scene-count')).toContainText('4');await expect(page.locator('#hud-agent-select')).toHaveText('工程居民');
  for(const [width,height]of [[1600,1000],[1440,900],[1280,800]] as const){
    await page.setViewportSize({width,height});await expect(page.locator('#hud-open-world-logs')).toBeVisible();await expect(page.locator('#world-zoom-in')).toBeInViewport();await expect(page.locator('#world-zoom-out')).toBeInViewport();await expect(page.locator('#hud-dock button')).toHaveCount(4);await expect(page.locator('#hud-locate-agent')).toBeVisible();
    const boxes=await page.locator('#hud-dock,.hud-agent-card,.hud-map-tools,#world-status-hud').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};}));
    assert.ok(boxes.every(b=>b.x>=0&&b.y>=54&&b.x+b.width<=width&&b.y+b.height<=height));assert.equal(await page.locator("#hud-dock").evaluate(node=>node.getBoundingClientRect().height),76);assert.equal(await page.locator('header').evaluate(node=>node.getBoundingClientRect().height),54);
    await page.screenshot({path:resolve(output,`01-default-${width}.png`)});
  }
  await page.getByRole('button',{name:'世界日志',exact:true}).click();await expect(page.locator('#hud-window')).toBeVisible();await expect(page.locator('.hud-map-tools')).not.toBeVisible();await page.locator('#hud-close').click();await expect(page.locator('.hud-map-tools')).toBeVisible();assert.deepEqual(errors,[]);
});
