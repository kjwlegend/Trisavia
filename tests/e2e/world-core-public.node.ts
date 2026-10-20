// Opt-in read-only browser engineering check against the TD's fixed candidate.
// No listener, database, identity or account is created by this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin=process.env.WORLD_CORE_CANDIDATE_ORIGIN;
if(origin!=='http://127.0.0.1:18893')throw new Error('Set WORLD_CORE_CANDIDATE_ORIGIN to the explicitly handed-off TD loopback candidate');
type Fact={id:string;agentId:string;version:number;status:string;position:{x:number;y:number};profile:{displayName:string;publishedVersion:number}};
type Scene={phase:string;complete:boolean;worldRevision:number;avatars:Array<{fact:Fact;x:number;y:number}>};
const fingerprint=(row:Fact)=>JSON.stringify([row.id,row.agentId,row.version,row.status,row.position,row.profile.displayName,row.profile.publishedVersion]);

test('homepage and Owner shell display real public Avatars and matching server facts without demo residents or credentials',async t=>{
 const caps=await (await fetch(`${origin}/v1/capabilities`)).json() as {gateway?:{modules:string[];worldSimulation?:{enabled:boolean}}};
 assert.equal(caps.gateway?.worldSimulation?.enabled,true);assert.ok(caps.gateway?.modules.includes('world'));
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:900}});t.after(()=>context.close());
 for(const path of ['/','/owner']){
  const page=await context.newPage(),batches:Fact[][]=[],issues:string[]=[];let publicCredentials=0,worldResponses=0;
  page.on('pageerror',()=>issues.push('pageerror'));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/v1/world/')&&request.headers().authorization)publicCredentials++;});
  page.on('response',response=>{const url=new URL(response.url());if(url.pathname==='/v1/world/scene'&&response.ok())void response.json().then((value:{data:{avatars:Fact[]}})=>{batches.push(value.data.avatars);worldResponses++;}).catch(()=>{});});
  await page.goto(`${origin}${path}`);await expect(page.locator('#world-canvas')).toBeVisible();
  const state=()=>page.evaluate(async()=>{
    const home=await import(String('/assets/home.js'));return home.getWorldState() as {actorCount:number;actors:unknown[];worldScene:Scene};
  });
  await expect.poll(async()=>{const value=await state();return ['ready','refreshing'].includes(value?.worldScene.phase)&&value.worldScene.complete;}).toBe(true);
  let value=await state();assert.equal(value.actorCount,0);assert.deepEqual(value.actors,[]);
  assert.ok(value.worldScene.avatars.length>=2,'TD candidate must contain the two independently registered visible Agent Avatars');
  await expect.poll(()=>worldResponses).toBeGreaterThan(0);
  for(const {fact}of value.worldScene.avatars)assert.ok(batches.flat().some(row=>fingerprint(row)===fingerprint(fact)),'Rendered fact matches a real public scene response');
  await expect(page.getByRole('button',{name:/服务器角色/}).first()).toBeVisible();
  await page.getByRole('button',{name:/服务器角色/}).first().focus();await page.keyboard.press('Enter');
  await expect(page.locator('#world-detail-area')).toHaveText('服务器公开角色');
  await expect(page.locator('#world-detail-description')).toContainText('逻辑坐标');
  await page.getByRole('button',{name:'关闭场所说明',exact:true}).click();
  const beforeRefresh=worldResponses;await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:'刷新世界',exact:true}).click();
  await expect.poll(()=>worldResponses).toBeGreaterThan(beforeRefresh);
  value=await state();assert.equal(value.actorCount,0);assert.equal(publicCredentials,0);assert.deepEqual(issues,[]);
  await page.close();
 }
});
