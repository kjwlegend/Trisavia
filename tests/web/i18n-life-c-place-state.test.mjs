import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {lifeCUiFixture,lifeEnvelope,lifeAsOf} from '../fixtures/life-c-ui.ts';
import {lifeBook} from '../../apps/platform/domains/life/c-books.ts';

// Production component/readers with synthetic DTOs, clipboard and public GETs.
// There is no listener, user credential, business command, database or build.
test('C place translations keep selected instances, open original book, copied intent and focus through cold loads',async t=>{
 const fixture=await lifeCUiFixture(),root=resolve('apps/web/public'),origin='http://127.0.0.1:18973',resources={},manifest={version:1,format:'icu-message-v1',namespaces:{}};
 for(const namespace of ['shell','public','life-content']){manifest.namespaces[namespace]={};for(const locale of ['zh-CN','en']){const body=await readFile(resolve(root,`locales/${namespace}/${locale}.json`)),url=`/assets/locales/${namespace}/${locale}.json`;resources[url]=body;manifest.namespaces[namespace][locale]={url,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};}}
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
 for(const failed of [false,true]){
  const context=await browser.newContext({locale:failed?'en':'zh-CN',timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[],reads=[],business=[],locale=failed?'en':'zh-CN';let release;const gate=new Promise(resolve=>{release=resolve;});page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.exposeFunction('readSyntheticLife',(operation,input)=>{
    reads.push({operation,input});const target='own-life-agent-a';
    if(operation==='items'){const value=fixture.items(target,input.itemIds),book=value.data.items.find(row=>row.itemId==='harbor_handbook');value.data.items.push({...book,id:book.id+'-second'});value.data.totals.find(row=>row.itemId==='harbor_handbook').available++;return value;}
    if(operation==='options')return fixture.options(target,fixture.catalog.data.actions.find(row=>row.actionId===input.actionId&&row.placeId===input.placeId),input.params);
    if(operation==='books.get')return lifeEnvelope({book:lifeBook(input.bookId),asOf:lifeAsOf});throw Error('No other reader or command is permitted');
   });
   await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin||request.method()!=='GET')throw Error('No external or business writes');
    if(url.pathname==='/assets/i18n/manifest.json')return route.fulfill({json:manifest});if(resources[url.pathname]){if(url.pathname===`/assets/locales/shell/${locale}.json`){await gate;if(failed)return route.fulfill({status:503,body:''});}return route.fulfill({contentType:'application/json',body:resources[url.pathname]});}
    if(url.pathname==='/v1/world/life/shop/quote'){business.push(url.pathname+url.search);return route.fulfill({json:fixture.quote(url.searchParams.get('side'),url.searchParams.get('itemId'))});}
    if(url.pathname==='/v1/world/life/books'){business.push(url.pathname+url.search);return route.fulfill({json:lifeEnvelope({book:lifeBook(url.searchParams.get('bookId')),asOf:lifeAsOf})});}
    if(url.pathname.startsWith('/assets/')){try{return route.fulfill({contentType:({'.js':'text/javascript','.json':'application/json','.png':'image/png'})[extname(url.pathname)]||'application/octet-stream',body:await readFile(resolve(root,url.pathname.slice(8)))});}catch{return route.fulfill({status:404,body:''});}}
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><style>.host{display:inline-block;vertical-align:top;width:400px;height:300px;overflow:auto}.life-card{margin:15px 0}.life-facts{display:grid;grid-template-columns:1fr 1fr}</style></head><body></body></html>'});
   });
   await page.goto(origin+'/'+locale+'/');
   await page.evaluate(async catalog=>{
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedIntent=value;}}});const {createLifeCPlace}=await import('/assets/hud/life-c-place.js'),core=await import('/assets/i18n/core.js');
    const context={authenticated:true,phase:'ready',observationRevision:1,selectedAgentId:'own-life-agent-a',agents:[{agentId:'own-life-agent-a',name:'原文名字',publicId:'A901'}]},session={snapshot:()=>structuredClone(context),subscribe(fn){fn(structuredClone(context));return()=>{};},readLife:(op,input)=>window.readSyntheticLife(op,input)},views={},hosts={},missing=[];
    for(const [id,placeId]of [['library','blue_library'],['tavern','harbor_tavern'],['inn','stone_inn'],['visit','lookout']]){const host=document.createElement('section');host.className='host';host.dataset.case=id;document.body.append(host);const view=createLifeCPlace(session,{getScrollHost:()=>host});host.append(view.node);view.update({catalog,place:catalog.places.find(row=>row.placeId===placeId),worldStale:false});views[id]=view;hosts[id]=host;}
    const observe=()=>{if([...document.querySelectorAll('.life-c-place')].some(node=>node.textContent.includes('[missing ')||[...node.querySelectorAll('[aria-label]')].some(child=>child.getAttribute('aria-label').includes('[missing '))))missing.push(document.body.textContent);};const observer=new MutationObserver(observe);observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});window.lifeCI18n={core,views,hosts,missing,observer,context};observe();
   },fixture.catalog.data);
   await page.waitForFunction(()=>[...document.querySelectorAll('.life-c-place .life-card button')].every(button=>!button.disabled));
   const library=page.locator('[data-case=library]'),tavern=page.locator('[data-case=tavern]');await library.locator('[data-life-c-field=book]').selectOption('harbor_handbook');await page.waitForFunction(()=>!document.querySelector('[data-case=library] [data-life-c-field=book-item]')?.disabled);await library.locator('[data-life-c-field=book-item]').selectOption({index:1});await library.getByRole('button',{name:'查看真实正文',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.life-book-body h5'));
   await tavern.locator('.life-card').filter({has:page.locator('[data-life-c-field="meal.eat"]')}).getByRole('button',{name:'复制给 Agent',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.life-copy-guide pre'));
   const before=await page.evaluate(()=>{
    const f=window.lifeCI18n,library=f.hosts.library,tavern=f.hosts.tavern,select=library.querySelector('[data-life-c-field=book-item]'),guide=tavern.querySelector('.life-copy-guide');guide.open=false;f.hosts.library.scrollTop=250;f.hosts.tavern.scrollTop=180;select.focus({preventScroll:true});
    f.refs={select,book:library.querySelector('.life-book-body'),guide,button:library.querySelector('.life-book-body').nextElementSibling};return{selected:select.value,paragraphs:[...f.refs.book.querySelectorAll('p:not(.hud-muted)')].map(node=>node.textContent),intent:guide.querySelector('pre').textContent,clipboard:window.copiedIntent,libraryScroll:library.scrollTop,tavernScroll:tavern.scrollTop,heading:library.querySelector('h4').textContent,missing:f.missing.length};
   });assert.equal(before.missing,0);assert.ok(before.selected.endsWith('-second'));assert.match(before.intent,/book|meal\.eat/);assert.equal(before.intent,before.clipboard);assert.ok(before.libraryScroll>0);const readsBefore=JSON.stringify(reads),businessBefore=JSON.stringify(business);
   release();const loaded=await page.evaluate(()=>window.lifeCI18n.core.ensureNamespaces(['shell']).then(()=>true,()=>false));assert.equal(loaded,!failed);if(!failed)assert.equal(await page.evaluate(()=>window.lifeCI18n.core.setLocale('en')),true);
   const after=await page.evaluate(()=>{const f=window.lifeCI18n,library=f.hosts.library,tavern=f.hosts.tavern;return{selected:f.refs.select.value,sameSelect:f.refs.select===library.querySelector('[data-life-c-field=book-item]'),sameBook:f.refs.book===library.querySelector('.life-book-body'),sameGuide:f.refs.guide===tavern.querySelector('.life-copy-guide'),focused:document.activeElement===f.refs.select,guideOpen:f.refs.guide.open,paragraphs:[...f.refs.book.querySelectorAll('p:not(.hud-muted)')].map(node=>node.textContent),intent:f.refs.guide.querySelector('pre').textContent,libraryScroll:library.scrollTop,tavernScroll:tavern.scrollTop,heading:library.querySelector('h4').textContent,missing:f.missing.length};});
   for(const key of ['sameSelect','sameBook','sameGuide','focused'])assert.equal(after[key],true,key);assert.equal(after.guideOpen,false);for(const key of ['selected','intent','libraryScroll','tavernScroll'])assert.equal(after[key],before[key],key);assert.deepEqual(after.paragraphs,before.paragraphs);assert.equal(after.missing,0);if(failed)assert.equal(after.heading,before.heading);else assert.notEqual(after.heading,before.heading);assert.equal(JSON.stringify(reads),readsBefore);assert.equal(JSON.stringify(business),businessBefore);assert.deepEqual(errors,[]);
   await page.evaluate(()=>{window.lifeCI18n.observer.disconnect();Object.values(window.lifeCI18n.views).forEach(view=>view.dispose());});
  }finally{release();await context.close();}
 }
});
