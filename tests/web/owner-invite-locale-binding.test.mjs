import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';

// Actual source component, synthetic responses only; no listener or database.
test('an invitation list releases loading/error bindings and keeps live controls across a locale switch',async t=>{
 const origin='http://127.0.0.1:18969',root=resolve('apps/web/public'),resources={},manifest={version:1,format:'icu-message-v1',namespaces:{account:{},common:{}}},posts=[],errors=[];
 for(const namespace of ['account','common'])for(const locale of ['zh-CN','en']){
  const body=namespace==='account'?await readFile(resolve(root,'locales/account/'+locale+'.json')):Buffer.from(JSON.stringify({'action.cancel':'Cancel','action.confirm':'Confirm','state.expired':'Expired'})),url=`/assets/locales/${namespace}/${locale}.json`;
  resources[url]=body;manifest.namespaces[namespace][locale]={url,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};
 }
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({locale:'zh-CN'});t.after(()=>context.close());const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 let reads=0,state='active';const ownerId='synthetic-owner',inviteId='synthetic-invite',expiresAt=Date.now()+3600000,row=()=>({inviteId,version:state==='active'?1:2,state,active:state==='active',consumed:false,expiresAt,asOf:Date.now(),limit:1});
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/assets/i18n/manifest.json')return route.fulfill({json:manifest});
  if(resources[url.pathname])return route.fulfill({contentType:'application/json',body:resources[url.pathname]});
  if(url.pathname==='/v1/owner/agent-invites'){if(++reads===1)return route.fulfill({status:503,json:{error:{code:'retry_same_operation'}}});return route.fulfill({json:{ownerId,invites:[row()],asOf:Date.now()}});}
  if(url.pathname===`/v1/owner/agent-invites/${inviteId}/revoke`){const body=route.request().postDataJSON();posts.push(body);state='revoked';return route.fulfill({json:{ownerId,operationId:body.operationId,...row()}});}
  if(url.pathname.startsWith('/assets/')){try{return route.fulfill({contentType:url.pathname.endsWith('.js')?'text/javascript':'application/json',body:await readFile(resolve(root,url.pathname.slice(8)))});}catch{return route.fulfill({status:404,body:''});}}
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
 });
 await page.goto(origin+'/zh-CN/owner');
 const result=await page.evaluate(async({ownerId})=>{
  const {createOwnerAgentInvite}=await import('/assets/owner-agent-invite.js'),{activateAccountI18n}=await import('/assets/owner-i18n.js'),core=await import('/assets/i18n/core.js');
  const root=document.createElement('section');root.innerHTML='<button id="prepare-invite" type="button"></button><div id="invite-current"><p id="invite-current-state"></p><textarea id="agent-guide"></textarea><button id="copy-agent-guide" type="button"></button><button id="regenerate-agent-guide" type="button"></button></div><p id="invite-feedback"></p><div id="invite-list"></div>';document.body.append(root);await activateAccountI18n(root);let manager;const failures=[];manager=createOwnerAgentInvite(root,{context:()=>({authenticated:true,ownerId,sessionToken:'synthetic-session'}),setBusy(value){manager.controls(value);return 1;},fail:error=>failures.push(error.code)});
  await manager.refresh();const failedText=root.querySelector('#invite-list').textContent;await manager.refresh();const row=root.querySelector('.invite-row'),button=row.querySelector('button'),before=row.textContent;button.focus();await core.setLocale('en');window.inviteBindingFixture={root,manager,failures};
  return{failedText,sameRow:row===root.querySelector('.invite-row'),sameButton:button===root.querySelector('.invite-row button'),focused:document.activeElement===button,enabled:!button.disabled,before,after:row.textContent};
 },{ownerId});
 assert.ok(result.failedText);assert.equal(result.sameRow,true);assert.equal(result.sameButton,true);assert.equal(result.focused,true);assert.equal(result.enabled,true);assert.notEqual(result.before,result.after);
 await page.locator('.invite-row button').click();await page.waitForFunction(()=>window.inviteBindingFixture.root.querySelectorAll('.invite-row').length===1&&!window.inviteBindingFixture.root.querySelector('.invite-row button'));
 assert.equal(posts.length,1);assert.equal(posts[0].expectedVersion,1);assert.equal(typeof posts[0].operationId,'string');assert.deepEqual(await page.evaluate(()=>window.inviteBindingFixture.failures),[]);assert.deepEqual(errors,[]);
});
