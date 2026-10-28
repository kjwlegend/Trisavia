// Browser modules and synthetic responses only; no service, PG or real identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';

const publicRoot=resolve('apps/web/public'),origin='http://127.0.0.1:18969';
const dictionaries={account:{'auth.title':'Account','auth.signIn':'Sign in','auth.signInTitle':'Sign in','auth.password':'Password','auth.welcome':'Welcome to {townName}.','form.username':'Username','form.email':'Email','progress.saved':'Saved','manager.profileEdit':'Edit profile','avatar.reference':'Reference','invite.currentStatus':'Invitation: {state} · {time}','test.message':'For {name}'},common:{'action.cancel':'Cancel','action.confirm':'Confirm','error.resultUnknown':'Result uncertain'}};
async function fixture(t,{actual=false}={}){
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({locale:'en-US'});t.after(()=>context.close());const page=await context.newPage(),requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const resources={},manifest={version:1,format:'icu-message-v1',namespaces:{}};
 for(const [namespace,values]of Object.entries(dictionaries)){manifest.namespaces[namespace]={};for(const locale of ['en','zh-CN']){const messages=actual&&namespace==='account'?JSON.parse(await readFile(resolve(publicRoot,'locales/account/'+locale+'.json'),'utf8')):Object.fromEntries(Object.entries(values).map(([k,v])=>[k,locale==='en'?v:'中文 '+v]));const body=Buffer.from(JSON.stringify(messages)),url=`/assets/locales/${namespace}/${locale}.json`;resources[url]=body;manifest.namespaces[namespace][locale]={url,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};}}
 await page.route(origin+'/**',async route=>{const url=new URL(route.request().url());requests.push(url.pathname);if(url.pathname==='/assets/i18n/manifest.json')return route.fulfill({json:manifest});if(resources[url.pathname])return route.fulfill({contentType:'application/json',body:resources[url.pathname]});if(url.pathname==='/agent/prompt.md')return route.fulfill({contentType:'text/markdown',body:'<!-- connet:copy-prompt:start -->\n机器原文 {{ORIGIN}}/agent/entry.md {{ORIGIN}}/agent/runtime.md\n<!-- connet:copy-prompt:end -->\n<!-- connet:runtime-update:start -->\n规则原文 {{ORIGIN}}/agent/runtime.md\n<!-- connet:runtime-update:end -->'});if(url.pathname.startsWith('/assets/')){try{return route.fulfill({contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.json')?'application/json':'application/octet-stream',body:await readFile(resolve(publicRoot,url.pathname.slice(8)))});}catch{return route.fulfill({status:404,body:''});}}return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="host" hidden></div></body></html>'});});
 await page.goto(origin+'/en/owner');return{page,requests,errors};
}

test('account bindings are lazy and language switches preserve live controls, draft and focus',async t=>{
 const {page,requests,errors}=await fixture(t);
 await page.evaluate(async()=>{
  const {mountOwnerPanel,createOwnerPresentation}=await import('/assets/owner-panel.js'),core=await import('/assets/i18n/core.js');const host=document.querySelector('#host'),root=mountOwnerPanel();host.append(root);window.testAccount={core,root,presentation:createOwnerPresentation(root)};core.applyI18n(document);
 });
 assert.equal(requests.filter(x=>x.includes('/locales/account/')).length,0,'hidden account construction does not load account namespace');
 await page.evaluate(async()=>{
  const {core,root,presentation}=window.testAccount,inputs=['login-identifier','login-password','setup-email','display-name','bio'];window.preserved={inputs:inputs.map(id=>root.querySelector('#'+id)),values:['a_user','private password 文字','person@example.test','原名 Name','用户简介 not translated'],calls:0};window.preserved.inputs.forEach((node,i)=>node.value=window.preserved.values[i]);root.querySelector('#setup-saved').checked=true;root.querySelector('#agent-select').append(new Option('原居民名','agent-own'));root.querySelector('#agent-select').value='agent-own';root.querySelector('#login-submit').addEventListener('click',()=>window.preserved.calls++);sessionStorage.setItem('test.private',JSON.stringify({selectedAgent:'agent-own',operationId:'original-op',proof:'synthetic-secret'}));document.querySelector('#host').hidden=false;presentation.sync();await core.ensureNamespaces(['account']);await new Promise(r=>setTimeout(r,0));window.preserved.inputs[0].focus();window.preserved.inputs[0].setSelectionRange(1,4);const {accountNotice}=await import('/assets/owner-i18n.js'),{errorMessage}=await import('/assets/common.js');accountNotice(root.querySelector('#global-notice'),errorMessage({code:'network_unknown'}),'pending');
 });
 assert.equal(requests.filter(x=>x==='/assets/locales/account/en.json').length,1);
 assert.deepEqual(await page.evaluate(()=>[...window.testAccount.root.querySelectorAll('[data-i18n]')].filter(node=>node.querySelector('input,textarea,select,button,a')).map(node=>node.outerHTML)),[],'no translated text container owns a form control/link');
 await page.evaluate(()=>window.testAccount.core.setLocale('zh-CN'));
 const result=await page.evaluate(()=>{const {root}=window.testAccount,p=window.preserved;root.querySelector('#login-submit').click();return{same:p.inputs.every(node=>node===document.querySelector('#'+node.id)),values:p.inputs.map(n=>n.value),saved:root.querySelector('#setup-saved').checked,selected:root.querySelector('#agent-select').value,focus:document.activeElement===p.inputs[0],selection:[p.inputs[0].selectionStart,p.inputs[0].selectionEnd],calls:p.calls,private:JSON.parse(sessionStorage.getItem('test.private')),label:root.querySelector('#login-submit').textContent,errorLabel:root.querySelector('#global-notice').textContent};});
 assert.equal(result.same,true);assert.deepEqual(result.values,['a_user','private password 文字','person@example.test','原名 Name','用户简介 not translated']);assert.equal(result.saved,true);assert.equal(result.selected,'agent-own');assert.equal(result.focus,true);assert.deepEqual(result.selection,[1,4]);assert.equal(result.calls,1);assert.equal(result.private.operationId,'original-op');assert.match(result.label,/中文/);assert.equal(result.errorLabel,'中文 Result uncertain');assert.deepEqual(errors,[]);
});

test('prefixed private entry capture retains original capability and Agent prompts remain original',async t=>{
 const {page,errors}=await fixture(t),proof='handoff_test.'+'s'.repeat(43);
 await page.goto(origin+'/zh-CN/owner?keep=1#handoff='+proof);
 const captured=await page.evaluate(async()=>{const {createOwnerEntryStore}=await import('/assets/owner-entry.js'),core=await import('/assets/i18n/core.js');const store=createOwnerEntryStore(),intent=store.capture();await core.ensureNamespaces(['account']);await core.setLocale('en');return{intent,proof:store.peek().proof,path:location.pathname,hash:location.hash,state:history.state};});
 assert.equal(captured.intent.mode,'account');assert.equal(captured.proof,proof);assert.equal(captured.path,'/en/');assert.equal(captured.hash,'#account');assert.ok(!JSON.stringify(captured.state).includes(proof));
 const prompts=await page.evaluate(async()=>{const core=await import('/assets/i18n/core.js'),{readOnboardingPrompt,extractRuntimeUpdatePrompt}=await import('/assets/onboarding-prompt.js'),{agentInviteGuide}=await import('/assets/owner-agent-invite.js');const before=await readOnboardingPrompt(),guide=agentInviteGuide(location.origin,'invite_test.'+'i'.repeat(43),before);await core.setLocale('zh-CN');const after=await readOnboardingPrompt();return{before,after,guide,runtime:extractRuntimeUpdatePrompt('<!-- connet:runtime-update:start -->\n规则原文 {{ORIGIN}}/agent/runtime.md\n<!-- connet:runtime-update:end -->',location.origin)};});
 assert.equal(prompts.before,prompts.after);assert.ok(prompts.before.startsWith('机器原文 '));assert.ok(prompts.guide.startsWith(prompts.before+'\n\n使用此私密一次性关联授权：'));assert.equal(prompts.runtime,'规则原文 '+origin+'/agent/runtime.md');assert.deepEqual(errors,[]);
});


test('actual account resources work with the account controller without changing private state',async t=>{
 const {page,requests,errors}=await fixture(t,{actual:true});
 const result=await page.evaluate(async()=>{
  const core=await import('/assets/i18n/core.js'),{mountOwnerPanel,createOwnerPresentation}=await import('/assets/owner-panel.js'),{createOwnerController}=await import('/assets/owner.js'),{createOwnerEntryStore}=await import('/assets/owner-entry.js');
  const pending={format:'connet-owner-v2',origin:location.origin,sessionToken:'owner_fixture.'+'s'.repeat(43),pendingOperation:{operationId:'original-login-op',scope:'owner-login:owner_fixture',action:'login',input:{identifier:'original_user'}}};sessionStorage.setItem('connet.owner.v2',JSON.stringify(pending));
  const root=mountOwnerPanel(),host=document.querySelector('#host');host.append(root);const presentation=createOwnerPresentation(root),controller=createOwnerController(root,{entryStore:createOwnerEntryStore(),onView:()=>presentation.sync()});controller.attachPresentation(presentation);host.hidden=false;presentation.sync();await core.ensureNamespaces(['account']);await new Promise(r=>setTimeout(r,0));const before=JSON.parse(sessionStorage.getItem('connet.owner.v2'));const name=root.querySelector('#display-name');name.value='原名 kept';
  const en=root.querySelector('#login-submit').textContent;await core.setLocale('zh-CN');const zh=root.querySelector('#login-submit').textContent;const snapshot=controller.snapshot();return{en,zh,before,after:JSON.parse(sessionStorage.getItem('connet.owner.v2')),name:name.value,snapshot,noMissing:!root.textContent.includes('[missing account:'),controls:root.querySelectorAll('input,textarea,select').length};
 });
 assert.equal(result.en,'Sign in');assert.equal(result.zh,'登录');assert.deepEqual(result.after,result.before);assert.equal(result.name,'原名 kept');assert.equal(result.snapshot.authenticated,false);assert.equal(result.noMissing,true);assert.ok(result.controls>35);assert.equal(requests.filter(x=>x.startsWith('/v1/')).length,0);assert.deepEqual(errors,[]);
});
