// Isolated component browser: real NPC module/styles, synthetic read ports, no database or Agent writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {layoutSha,geometryDigest,appearance} from '../fixtures/world-town-v2.ts';

const origin='https://paper-npc.invalid',root=resolve('apps/web/public'),output=resolve('outputs/paper-npc-v3');
const definition=(npcId:string,name:string,role:string,buildingId:string,hair:string,x:number,y:number,serviceId:string,action:string)=>({npcId,name,role,buildingId,appearance:{...appearance,lookId:'sunnyside-human-'+hair},definitionVersion:1,serverManaged:true,countsAsAgent:false,readOnly:false,status:'available',position:{x:x+1,y},approachCells:[{x,y}],serviceIds:[serviceId],actions:['town_services.npc.greet',action,...(serviceId==='inn.rest'?['town_services.inn.rest.cancel']:[])]});
const npcs=[definition('npc-mayor','镇长','小镇管理者','p-hall','shorthair',2,-16,'welcome.claim','town_services.welcome.claim'),definition('npc-tavern','港湾酒馆·酒保','酒保','h-tavern','curlyhair',52,12,'tavern.host','town_services.tavern.redeem'),definition('npc-innkeeper','石岸旅舍·老板','旅社老板','e-inn','longhair',27,8,'inn.rest','town_services.inn.rest.start')];
const services=[{serviceId:'welcome.claim',npcId:'npc-mayor',name:'新人礼包',description:'本活动每位 Agent 可领取一次礼包，含招待券和休息券各一张。',action:'town_services.welcome.claim',durationMs:0,itemCost:null,topics:[]},{serviceId:'tavern.host',npcId:'npc-tavern',name:'酒馆迎新招待',description:'使用一张招待券，选个话题，喝杯迎新茶。',action:'town_services.tavern.redeem',durationMs:0,itemCost:'tavern_voucher',topics:[{id:'welcome',label:'欢迎新邻居',response:'PUBLIC_REPLY_IS_NOT_A_COMPLETED_RESULT'},{id:'town',label:'小镇去处',response:'PUBLIC_OTHER_REPLY'}]},{serviceId:'inn.rest',npcId:'npc-innkeeper',name:'旅社休息',description:'预留一张休息券，在门前休息60秒。完成才消耗；取消或中断释放原券。',action:'town_services.inn.rest.start',durationMs:60000,itemCost:'inn_voucher',topics:[]}];
const map={mapId:'pixel-town-v2',layoutSha256:layoutSha,geometryDigest,rulesetVersion:2,topologyVersion:2};
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${['site.css','world.css','hud/hud.css','world-pixel/world.css','world-pixel/panels.css','hud/town-services.css','paper-hud.css'].map(path=>`<link rel="stylesheet" href="/assets/${path}">`).join('')}</head><body class="world-home paper-hud"><header><div class="nav-wrap"><span class="brand">Trisavia</span></div></header><main><div id="world-layout" class="world-layout"><aside class="world-detail is-town-service" id="world-detail" aria-labelledby="world-detail-title"><div class="world-detail-top"><div><span id="world-detail-area">镇民服务</span><h2 id="world-detail-title">镇民</h2></div><button id="world-detail-close" aria-label="关闭场所说明">×</button></div><div class="world-detail-body"></div></aside></div></main><script type="module" src="/fixture.js"></script></body></html>`;
const fixtureJs=`import {createTownServiceCard,createTownRelationships} from '/assets/hud/town-services.js';
import {icon} from '/assets/hud/icons.js';document.querySelector('#world-detail-close').replaceChildren(icon('close'));
const npcs=${JSON.stringify(npcs)},services=${JSON.stringify(services)},appearance=${JSON.stringify(appearance)};
const now=Date.now(),op=(npcId,serviceId,state='completed',id='op-'+serviceId)=>({operationId:id,version:1,npcId,serviceId,catalogVersion:1,state,startedAt:now-60000,endedAt:state==='active'?null:now,itemInstanceId:null,topic:null,response:serviceId==='tavern.host'?'欢迎来到小镇，愿你今天有新的发现。':null,cancelCode:null});
const context={authenticated:true,phase:'ready',selectedAgentId:'agent-a',observationRevision:1,agents:[{agentId:'agent-a',name:'合成角色甲',avatar:appearance},{agentId:'agent-b',name:'合成角色乙',avatar:{...appearance,lookId:'sunnyside-human-bowlhair'}}]};
const state={claimed:false,rest:true,completed:true,error:0,hold:false,reads:[],released:null,chooseCount:0,contexts:[]};let listener=()=>{};
const envelope=data=>({protocolVersion:1,data});
const session={snapshot:()=>({...context}),subscribe:fn=>(listener=fn,()=>{}),async readTownService(operation,input={},options={}){
 const agentId=context.selectedAgentId;state.reads.push({operation,agentId,input});
 if(state.hold&&operation==='relationships')await new Promise(resolve=>state.released=resolve);
 if(state.error)throw Object.assign(new Error('synthetic read error'),{status:state.error});
 const own=agentId==='agent-a',base={agentId,asOf:now};
 if(operation==='relationships')return envelope({...base,relationships:own?[{npcId:window.currentNpc.npcId,familiarity:12,version:1,npc:window.currentNpc,createdAt:now,updatedAt:now}]:[],complete:true,nextAfterNpcId:null});
 if(operation==='inventory')return envelope({...base,items:own?['tavern_voucher','inn_voucher'].map(itemKind=>({itemInstanceId:itemKind,version:1,itemKind,state:itemKind==='inn_voucher'&&state.rest?'reserved':'available',quantity:1,availableQuantity:itemKind==='inn_voucher'&&state.rest?0:1,transferable:false})):[],complete:true,nextAfterId:null});
 if(operation==='progress')return envelope({...base,catalogVersion:1,claim:own&&state.claimed?op('npc-mayor','welcome.claim'):null,activeRest:own&&state.rest?op('npc-innkeeper','inn.rest','active','current-rest'):null,completedServices:own&&state.completed?[{npcId:'npc-tavern',serviceId:'tavern.host',operationId:'done-tea',completedAt:now},{npcId:'npc-innkeeper',serviceId:'inn.rest',operationId:'old-rest',completedAt:now-60000}]:[]});
 if(operation==='operation')return envelope({...base,operation:input.operationId==='done-tea'?op('npc-tavern','tavern.host'):op('npc-innkeeper','inn.rest')});
 throw new Error('Unexpected read');
}};
const world={worldScene:{complete:true,phase:'ready',lastSuccessAt:now,avatars:[{fact:{agentId:'agent-a',position:{x:27,y:8}}}]},rules:{mapManifest:{buildings:[{id:'p-hall',name:'市政厅'},{id:'h-tavern',name:'港湾酒馆'},{id:'e-inn',name:'石岸旅舍'}]}}};
const card=createTownServiceCard(session,{chooseAgent:()=>state.chooseCount++,getWorldState:()=>world,onContextChange:value=>{state.contexts.push(value);document.querySelector('#world-detail-title').textContent=value.kind==='notice'?value.notice.name:value.npc.name;}});document.querySelector('.world-detail-body').append(card.node);document.querySelector('#world-detail-close').onclick=()=>{card.close();document.querySelector('#world-detail').hidden=true;};
const relations=createTownRelationships(session);window.harness={state,context,world,card,open(index){window.currentNpc=npcs[index];if(!card.node.isConnected)document.querySelector('.world-detail-body').replaceChildren(card.node);world.worldScene.lastSuccessAt=Date.now();document.querySelector('#world-detail-title').textContent='镇民 · '+npcs[index].role;document.querySelector('#world-detail').hidden=false;card.open({npc:npcs[index],catalogVersion:1});},notice(){document.querySelector('#world-detail-title').textContent='小镇公告';card.open({notice:true,catalogVersion:1});},switchAgent(id){context.selectedAgentId=id;context.observationRevision++;listener({...context});},anonymous(){context.authenticated=false;context.observationRevision++;listener({...context});},relations(){card.close();document.querySelector('.world-detail-body').replaceChildren(relations.node);relations.setContext({...context});relations.activate();}};window.harness.open(0);`;
async function browserFixture(t:any){
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1600,height:1000},permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});context.setDefaultTimeout(5000);
 const errors:string[]=[],writes:string[]=[];await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(request.method()!=='GET'){writes.push(request.method()+' '+url.pathname);return route.abort();}
  if(url.pathname==='/')return route.fulfill({body:html,contentType:'text/html'});if(url.pathname==='/fixture.js')return route.fulfill({body:fixtureJs,contentType:'text/javascript'});
  if(url.pathname==='/v1/town/service'){const service=services.find(row=>row.serviceId===url.searchParams.get('serviceId'))!;return route.fulfill({json:{protocolVersion:1,data:{catalogVersion:1,map,npc:npcs.find(row=>row.npcId===service.npcId),service,asOf:Date.now()}}});}
  if(url.pathname==='/v1/town/notice')return route.fulfill({json:{protocolVersion:1,data:{catalogVersion:1,map,notice:{objectId:'notice',version:1,name:'小镇公告牌',title:'小镇迎新服务',text:'到市政厅找镇长领取迎新礼包。招待券与休息券各一张，每位 Agent 限领一次。',position:{x:-3,y:-3},approachCells:[{x:-4,y:-3}],serviceIds:['welcome.claim','tavern.host','inn.rest']},asOf:Date.now()}}});
  if(url.pathname.startsWith('/assets/')){const file=resolve(root,url.pathname.slice(8));if(file.startsWith(root+'/'))try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'} as Record<string,string>)[extname(file)]||'application/octet-stream'});}catch{}}
  return route.fulfill({status:404,body:'not found'});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);return {page,errors,writes};
}

test('three NPCs share the paper template at all three sizes; real states and copied instructions remain read-only',async t=>{
 const {page,errors,writes}=await browserFixture(t);
 for(const size of [{width:1600,height:1000},{width:1440,height:900},{width:1280,height:800}]){
  await page.setViewportSize(size);
  for(let index=0;index<3;index++){
   await page.evaluate(index=>(window as any).harness.open(index),index);await expect(page.locator('.town-service-card')).toContainText('熟悉度 12 / 100');await expect(page.locator('.town-npc-picture')).toHaveAttribute('data-appearance-state','ready');
   assert.deepEqual(await page.locator('.town-section-title').allTextContents(),['1NPC 介绍','2与合成角色甲的关系','3行动指引']);
   const frame=await page.locator('#world-detail').boundingBox();assert(frame);assert.equal(frame.width,500);assert.equal(frame.x,size.width-524);assert.equal(frame.y,136);assert.equal(frame.height,Math.min(810,size.height-160));
   assert.equal(await page.locator('.world-detail-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);assert.equal(Math.round((await page.locator('.town-card-footer').boundingBox())!.width),await page.locator('.town-service-card').evaluate(node=>node.clientWidth));const footerIcon=(await page.locator('.town-card-footer>.town-icon').boundingBox())!,footerText=(await page.locator('.town-card-message').boundingBox())!;assert.equal(Math.round(footerText.x-footerIcon.x-footerIcon.width),8);assert.equal(await page.locator('.town-npc-description').evaluate(node=>getComputedStyle(node).fontSize),'14px');await expect(page.locator('#world-detail-close')).toBeInViewport();
   if(index===0){await expect(page.getByRole('button',{name:'复制领取新邻居礼包指令',exact:true})).toBeEnabled();await expect(page.locator('.town-service-status')).toContainText('尚未领取');}
   if(index===1){await expect(page.locator('.town-response')).toHaveText('欢迎来到小镇，愿你今天有新的发现。');await expect(page.locator('.town-service-card')).not.toContainText('PUBLIC_REPLY_IS_NOT_A_COMPLETED_RESULT');await expect(page.getByRole('button',{name:'复制「欢迎新邻居」指令',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'复制「小镇去处」指令',exact:true})).toBeEnabled();}
   if(index===2){await expect(page.getByRole('button',{name:'复制开始休息指令',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'复制取消休息指令',exact:true})).toBeEnabled();await expect(page.locator('.town-service-status')).toContainText('正在休息，券已保留');assert.equal(await page.locator('progress:not(.town-familiarity progress)').count(),0);}
   await page.screenshot({path:resolve(output,`${['mayor','tavern','inn'][index]}-${size.width}x${size.height}.png`)});
  }
 }
 await page.setViewportSize({width:1600,height:1000});await page.evaluate(()=>(window as any).harness.open(1));await expect(page.locator('.town-response')).toBeVisible();await page.getByRole('button',{name:'复制「欢迎新邻居」指令',exact:true}).click();await expect(page.locator('.town-card-message')).toContainText('已复制');const first=await page.evaluate(()=>navigator.clipboard.readText());assert.match(first,/合成角色甲.*欢迎新邻居/);
 await page.getByRole('button',{name:'复制「小镇去处」指令',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/小镇去处/);assert.notEqual(await page.evaluate(()=>navigator.clipboard.readText()),first);
 await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('synthetic clipboard denied');};});await page.getByRole('button',{name:'复制问候指令',exact:true}).click();await expect(page.locator('.town-card-message')).toContainText('暂时无法复制');
 await page.evaluate(()=>(window as any).harness.notice());await expect(page.locator('.town-notice')).toBeVisible();assert.equal(await page.locator('.town-personal-state').count(),0);const noticeBox=await page.locator('#world-detail').boundingBox();assert(noticeBox&&noticeBox.height<620);await page.screenshot({path:resolve(output,'notice-1600x1000.png')});await page.getByRole('button',{name:'酒馆招待',exact:true}).click();await expect(page.locator('.town-service-card')).toContainText('酒馆迎新招待');
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});

test('private failures, current rest and changed Agent never display stale progress or public dialogue as a reply',async t=>{
 const {page,errors,writes}=await browserFixture(t);await expect(page.locator('.town-service-card')).toContainText('熟悉度 12 / 100');
 await page.evaluate(()=>{const h=(window as any).harness;h.state.claimed=true;h.open(0);});await expect(page.locator('.town-service-status')).toContainText('新邻居礼包已领取');await expect(page.getByRole('button',{name:'复制领取新邻居礼包指令',exact:true})).toBeDisabled();
 await page.evaluate(()=>{const h=(window as any).harness;h.state.error=503;h.open(1);});await expect(page.locator('.town-service-status')).toContainText('当前情况暂时无法读取');await expect(page.locator('.town-response')).toHaveCount(0);await expect(page.locator('.town-service-card')).not.toContainText('0 张可用');await expect(page.locator('.town-service-card')).not.toContainText('尚未结识');
 await page.evaluate(()=>(window as any).harness.state.error=0);await page.getByRole('button',{name:'重新读取',exact:true}).click();await expect(page.locator('.town-response')).toBeVisible();
 await page.evaluate(()=>{const h=(window as any).harness;h.state.hold=true;h.open(1);});await expect.poll(()=>page.evaluate(()=>Boolean((window as any).harness.state.released))).toBe(true);await page.evaluate(()=>{const h=(window as any).harness;h.state.hold=false;h.switchAgent('agent-b');h.state.released();});await expect(page.locator('.town-section-title').nth(1)).toHaveText('2与合成角色乙的关系');await expect(page.locator('.town-service-card')).toContainText('尚未结识');await expect(page.locator('.town-service-card')).not.toContainText('熟悉度 12');await expect(page.locator('.town-response')).toHaveCount(0);
 await page.evaluate(()=>{const h=(window as any).harness;h.switchAgent('agent-a');h.open(2);});await expect(page.getByRole('button',{name:'复制开始休息指令',exact:true})).toBeDisabled();await expect(page.locator('.town-service-status')).toContainText('正在休息');assert.equal(await page.evaluate(()=>(window as any).harness.state.reads.filter((row:any)=>row.operation==='operation'&&row.input.operationId==='old-rest').length),0);
 await page.evaluate(()=>{const h=(window as any).harness;h.state.rest=false;h.open(2);});await expect(page.getByRole('button',{name:'复制开始休息指令',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'复制取消休息指令',exact:true})).toBeDisabled();await expect(page.locator('.town-service-status')).toContainText('本次休息已完成');
 await page.evaluate(()=>{const h=(window as any).harness;h.state.hold=true;h.open(2);});await expect.poll(()=>page.evaluate(()=>Boolean((window as any).harness.state.released))).toBe(true);await expect(page.getByRole('button',{name:'复制开始休息指令',exact:true})).toBeDisabled();await page.evaluate(()=>{const h=(window as any).harness;h.state.hold=false;h.state.released();});await expect(page.getByRole('button',{name:'复制开始休息指令',exact:true})).toBeEnabled();
 await page.evaluate(()=>(window as any).harness.relations());await expect(page.locator('.town-relationship')).toHaveCount(1);await expect(page.locator('.town-relationships')).toContainText('石岸旅舍');await page.screenshot({path:resolve(output,'relationships-1600x1000.png')});
 const before=await page.evaluate(()=>(window as any).harness.state.reads.length);await page.evaluate(()=>{const h=(window as any).harness;h.anonymous();h.open(0);});await expect(page.locator('.town-personal-state')).toContainText('登录后');assert.equal(await page.evaluate(()=>(window as any).harness.state.reads.length),before);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});


test('notice service links emit verified NPC context for the host title and accessible name',async t=>{
 const {page,errors,writes}=await browserFixture(t);await expect(page.locator('.town-personal-state')).toContainText('已结识');
 for(const [label,npcId,name,serviceId] of [['新邻居礼包','npc-mayor','镇长','welcome.claim'],['酒馆招待','npc-tavern','港湾酒馆·酒保','tavern.host'],['旅社休息','npc-innkeeper','石岸旅舍·老板','inn.rest']] as const){
  await page.evaluate(()=>(window as any).harness.notice());await expect(page.getByRole('complementary',{name:'小镇公告牌',exact:true})).toBeVisible();await expect(page.locator('.town-notice')).toBeVisible();
  await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('complementary',{name,exact:true})).toBeVisible();await expect(page.locator('.town-npc-name')).toHaveText(name);
  const context=await page.evaluate(()=>(window as any).harness.state.contexts.at(-1));assert.equal(context.kind,'npc');assert.equal(context.catalogVersion,1);assert.equal(context.npc.npcId,npcId);assert.equal(context.serviceId,serviceId);assert.deepEqual(Object.keys(context).sort(),['catalogVersion','kind','npc','serviceId']);
 }
 await page.evaluate(()=>(window as any).harness.notice());await expect(page.locator('.town-notice')).toBeVisible();
 const count=await page.evaluate(()=>(window as any).harness.state.contexts.length);
 await page.route('**/v1/town/service?serviceId=welcome.claim',route=>route.fulfill({status:503,json:{error:{code:'synthetic_source_unavailable'}}}));
 await page.getByRole('button',{name:'新邻居礼包',exact:true}).click();await expect(page.locator('.town-service-card')).toContainText('小镇服务暂时无法读取');assert.equal(await page.evaluate(()=>(window as any).harness.state.contexts.length),count);await expect(page.getByRole('complementary',{name:'小镇公告牌',exact:true})).toBeVisible();
 await page.unroute('**/v1/town/service?serviceId=welcome.claim');
 for(const mutate of [(npc:any)=>{delete npc.actions;},(npc:any)=>{npc.name=null;},(npc:any)=>{npc.appearance=null;},(npc:any)=>{npc.position={x:null,y:0};},(npc:any)=>{npc.approachCells=[null];},(npc:any)=>{delete npc.serviceIds;},(npc:any)=>{npc.role=42;},(npc:any)=>{npc.buildingId=null;}]){
  await page.evaluate(()=>(window as any).harness.notice());await expect(page.locator('.town-notice')).toBeVisible();const before=await page.evaluate(()=>(window as any).harness.state.contexts.length);
  const broken=structuredClone(npcs[0]) as any;mutate(broken);await page.route('**/v1/town/service?serviceId=welcome.claim',route=>route.fulfill({json:{protocolVersion:1,data:{catalogVersion:1,map,npc:broken,service:services[0],asOf:Date.now()}}}));
  await page.getByRole('button',{name:'新邻居礼包',exact:true}).click();await expect(page.locator('.town-service-card')).toContainText('小镇服务暂时无法读取');assert.equal(await page.evaluate(()=>(window as any).harness.state.contexts.length),before);await expect(page.getByRole('complementary',{name:'小镇公告牌',exact:true})).toBeVisible();await page.unroute('**/v1/town/service?serviceId=welcome.claim');
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
