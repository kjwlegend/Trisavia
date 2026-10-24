// Real Owner controller over intercepted synthetic HTTP; no server or account is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';

const root=resolve('apps/web/public'),origin='https://owner-selection.invalid';
const agent=(agentId:string,ownerId:string)=>({agentId,ownerId,runtimeActive:false,
 profile:{version:1,policyVersion:1,published:{displayName:agentId,bio:'',interests:[]},draft:null,mode:'agent_autonomous',lockedFields:[],confirmationSource:'owner',proposalPending:false},
 membership:{agentId,worldId:'default',state:'joined',version:1,ownerPaused:false,platformRestricted:false},
 worldAccess:{agentId,version:1,intervalSeconds:null,adoption:{status:'unknown',source:'agent_report'}},management:{},asOf:1});

test('login selects the first managed Agent, retains manual selection on refresh, and scopes later logins to their owner',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors:string[]=[],unexpectedWrites:string[]=[];let ownerId='owner-a';
 page.on('pageerror',error=>errors.push(error.message));
 const lists:Record<string,string[]>={'owner-a':['agent-z-first','agent-b-second'],'owner-b':['agent-c-first','agent-b-second'],'owner-empty':[]};
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main id="main"></main><script type="module">import {mountOwnerPanel,createOwnerPresentation} from "/assets/owner-panel.js";import {createOwnerController} from "/assets/owner.js";const root=mountOwnerPanel();document.querySelector("main").append(root);let controller;const presentation=createOwnerPresentation(root,{onChange:()=>controller?.notifyPresentation()});controller=createOwnerController(root);controller.attachPresentation(presentation);window.ownerController=controller;await controller.start();window.fixtureReady=true;</script></body></html>'});
  if(request.method()==='POST'&&url.pathname==='/v1/owner/sessions'){
   const body=request.postDataJSON();ownerId=body.identifier.replaceAll('_','-');
   return route.fulfill({json:{ownerId,operationId:body.operationId,sessionId:body.sessionToken.split('.')[0]}});
  }
  if(request.method()!=='GET'){unexpectedWrites.push(url.pathname);return route.abort();}
  if(url.pathname==='/v1/owner/agents'){const owned=lists[ownerId];assert.ok(owned,'The synthetic Owner must have a declared Agent list');return route.fulfill({json:{ownerId,agents:owned.map(id=>agent(id,ownerId))}});}
  if(url.pathname==='/v1/owner/account')return route.fulfill({json:{ownerId,username:ownerId,emailVerified:true}});
  if(url.pathname==='/v1/owner/agent-invites')return route.fulfill({json:{invites:[]}});
  if(url.pathname==='/v1/capabilities')return route.fulfill({json:{emailMode:'experience',gateway:{protocolVersion:1,modules:[]}}});
  if(url.pathname.endsWith('/world-action-policy'))return route.fulfill({json:{source:'current',agentId:url.pathname.split('/')[3],version:1,mode:'autonomous',updatedAt:null,asOf:1}});
  if(url.pathname.startsWith('/assets/')){const file=resolve(root,url.pathname.slice(8));if(file.startsWith(root+'/'))try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png'} as Record<string,string>)[extname(file)]||'application/octet-stream'});}catch{}}
  return route.fulfill({status:404,json:{error:{code:'fixture_not_provided'}}});
 });
 const selected=()=>page.evaluate(()=>(window as any).ownerController.snapshot().selectedAgentId);
 const login=async(identifier:string)=>{
  await page.locator('#login-identifier').fill(identifier);await page.locator('#login-password').fill('Synthetic-password-only');await page.locator('#login-submit').click();
  await page.waitForFunction(()=>(window as any).ownerController.snapshot().authenticated&&!((window as any).ownerController.snapshot().interactionLocked));
 };
 await page.goto(origin+'/fixture');await page.waitForFunction(()=>(window as any).fixtureReady);
 await page.evaluate(()=>sessionStorage.setItem('connet.owner.agent-selection.v1',JSON.stringify({origin:location.origin,ownerId:'owner-a',agentId:'agent-b-second'})));
 await login('owner_a');assert.equal(await selected(),'agent-z-first');
 assert.deepEqual(await page.evaluate(()=>(window as any).ownerController.snapshot().agents[0].avatar),{});
 await page.locator('#agent-list button[data-agent-id="agent-b-second"]').click();assert.equal(await selected(),'agent-b-second');
 await page.evaluate(()=>(window as any).ownerController.refresh());assert.equal(await selected(),'agent-b-second');
 await page.reload();await page.waitForFunction(()=>(window as any).fixtureReady);assert.equal(await selected(),'agent-b-second');
  await page.evaluate(()=>(window as any).ownerController.open('login'));await login('owner_a');assert.equal(await selected(),'agent-z-first');
  await page.locator('#agent-list button[data-agent-id="agent-b-second"]').click();assert.equal(await selected(),'agent-b-second');
 // A subsequent successful login must not reuse the previous account's selection,
 // even if the new authorized list happens to contain the same Agent id.
 await page.evaluate(()=>(window as any).ownerController.open('login'));await login('owner_b');assert.equal(await selected(),'agent-c-first');
 await page.evaluate(()=>(window as any).ownerController.requestLogout());await login('owner_empty');assert.equal(await selected(),'');
 await expect(page.locator('#empty-agents')).toBeVisible();assert.deepEqual(await page.evaluate(()=>(window as any).ownerController.snapshot().agents),[]);
 assert.deepEqual(unexpectedWrites,[]);assert.deepEqual(errors,[]);
});
