import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';

// Actual controls and mixer, with synthetic asset responses and an inert audio
// context. No listener, identity, world request or audible playback is created.
test('locale changes preserve audio controls and the last confirmed paused scene and clock sample',async t=>{
 const root=resolve('apps/web/public'),origin='http://127.0.0.1:18970',resources={},manifest={version:1,format:'icu-message-v1',namespaces:{shell:{}}},requests=[],errors=[];
 for(const locale of ['zh-CN','en']){
  const body=await readFile(resolve(root,'locales/shell/'+locale+'.json')),url=`/assets/locales/shell/${locale}.json`;
  resources[url]=body;manifest.namespaces.shell[locale]={url,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};
 }
 const keys=['ui-confirm','panel-open','panel-close','result-success','result-notice','result-error','world-focus','world-step-a','world-step-b','dialogue-tick-a','dialogue-tick-b','dialogue-tick-c'];
 const track=(key,version=1)=>({duration:80,sources:[{url:`/assets/audio/town-v${version}/${key}.wav`,type:'audio/wav'}]});
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({locale:'zh-CN',timezoneId:'Asia/Shanghai'});t.after(()=>context.close());
 await context.addInitScript(()=>{
  const metrics=window.audioMetrics={starts:0,stops:0,resumes:0,suspends:0};
  const gain=()=>({value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;},linearRampToValueAtTime(value){this.value=value;}});
  window.AudioContext=class{
   state='suspended';currentTime=0;destination={};
   createGain(){return{gain:gain(),connect(){},disconnect(){}};}
   createBufferSource(){return{connect(){},disconnect(){},start(){metrics.starts++;},stop(){metrics.stops++;}};}
   async decodeAudioData(){return{duration:80,numberOfChannels:1,getChannelData:()=>new Float32Array([.1])};}
   async resume(){metrics.resumes++;this.state='running';}
   async suspend(){metrics.suspends++;this.state='suspended';}
   async close(){this.state='closed';}
  };
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());requests.push(url.pathname);
  if(url.pathname==='/assets/i18n/manifest.json')return route.fulfill({json:manifest});
  if(resources[url.pathname])return route.fulfill({contentType:'application/json',body:resources[url.pathname]});
  if(url.pathname==='/assets/audio/town-v1/manifest.json')return route.fulfill({json:{id:'town-v1',version:1,sfx:Object.fromEntries(keys.map(key=>[key,track(key)]))}});
  if(url.pathname==='/assets/audio/town-v2/manifest.json')return route.fulfill({json:{id:'town-v2',version:2,bgm:{...track('bgm',2),loop:{start:0,end:80}}}});
  if(url.pathname.startsWith('/assets/audio/'))return route.fulfill({contentType:'audio/wav',body:Buffer.from([0])});
  if(url.pathname.startsWith('/assets/')){try{return route.fulfill({contentType:extname(url.pathname)==='.js'?'text/javascript':'application/json',body:await readFile(resolve(root,url.pathname.slice(8)))});}catch{return route.fulfill({status:404,body:''});}}
  if(url.pathname==='/zh-CN/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><header><nav></nav></header></body></html>'});
  return route.fulfill({status:404,body:''});
 });
 await page.goto(origin+'/zh-CN/');
 await page.evaluate(async()=>{
  const core=await import('/assets/i18n/core.js');await core.ensureNamespaces(['shell']);
  const {mountWorldAudio}=await import('/assets/world-audio-ui.js'),{createWorldStatusHud}=await import('/assets/hud/world-status.js');
  const audio=mountWorldAudio(),container=document.createElement('div');container.className='paper-hud';container.innerHTML='<span id="world-current-place"></span><span id="world-scene-count"></span><time id="world-current-time"></time><span id="world-read-status"></span>';document.body.append(container);
  let epoch=Date.UTC(2026,9,28,8,12),samples=0,calibrations=0,times=0,timers=0,clears=0;
  const clock={source:'serverTime',now(){samples++;return epoch;},calibrate(){calibrations++;return true;}},hud=createWorldStatusHud(container,{clock,onTime(){times++;},setTimer(){return++timers;},clearTimer(){clears++;}});
  const scene={phase:'ready',complete:true,avatars:[{agentId:'a',placeId:'commons',name:'原文姓名'},{agentId:'b',placeId:'commons',name:'Another original name'}],lastSuccessAt:epoch,serverTime:epoch,instanceId:'synthetic',timeSource:'serverTime',rules:{places:[{id:'commons',access:'members'}]}};
  const original=JSON.stringify(scene);hud.update(scene);hud.select('a');hud.update({phase:'paused',complete:false,avatars:[]});hud.setVisible(false);epoch+=86400000;
  const read=()=>({location:container.querySelector('#world-current-place').textContent,locationTitle:container.querySelector('#world-current-place').title,count:container.querySelector('#world-scene-count').textContent,status:container.querySelector('#world-read-status').textContent,time:container.querySelector('time').textContent,dateTime:container.querySelector('time').dateTime,timeSource:container.querySelector('time').dataset.timeSource,timeTitle:container.querySelector('time').title,timeAria:container.querySelector('time').getAttribute('aria-label'),light:container.querySelector('.paper-light-mode').getAttribute('aria-label'),period:container.querySelector('.paper-light-mode').dataset.period,samples,calibrations,times,timers,clears,sceneUnchanged:JSON.stringify(scene)===original});
  window.audioStatusFixture={core,audio,hud,read};
 });
 await page.locator('.world-audio-button').click();await page.locator('.world-audio-toggle').click();await page.waitForFunction(()=>window.audioStatusFixture.audio.snapshot().phase==='playing');
 const ranges=page.locator('.world-audio-panel input[type=range]');for(const [index,value]of [[0,'70'],[1,'80']])await ranges.nth(index).evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));},value);await ranges.nth(0).focus();
 const before=await page.evaluate(()=>{
  const f=window.audioStatusFixture;f.bgm=document.querySelectorAll('.world-audio-panel input')[0];f.sfx=document.querySelectorAll('.world-audio-panel input')[1];f.toggle=document.querySelector('.world-audio-toggle');
  return{audio:f.audio.snapshot(),stored:localStorage.getItem('connet.audio.v1'),metrics:{...window.audioMetrics},hud:f.read(),button:document.querySelector('.world-audio-button').textContent,toggle:f.toggle.textContent};
 });
 assert.equal(before.audio.enabled,true);assert.equal(before.audio.phase,'playing');assert.equal(before.audio.bgm,.7);assert.equal(before.audio.sfx,.8);assert.equal(before.hud.count,'上次画面（已过期）：2');assert.equal(before.hud.location,'公共庭');assert.match(before.hud.status,/场景读取已暂停/);assert.equal(before.hud.period,'day');
 assert.equal(await page.evaluate(()=>window.audioStatusFixture.core.setLocale('en')),true);
 const after=await page.evaluate(()=>{
  const f=window.audioStatusFixture;return{audio:f.audio.snapshot(),stored:localStorage.getItem('connet.audio.v1'),metrics:{...window.audioMetrics},hud:f.read(),button:document.querySelector('.world-audio-button').textContent,toggle:f.toggle.textContent,pressed:f.toggle.getAttribute('aria-pressed'),bgmLabel:f.bgm.getAttribute('aria-label'),bgm:f.bgm.value,sfx:f.sfx.value,sameBgm:f.bgm===document.querySelectorAll('.world-audio-panel input')[0],sameSfx:f.sfx===document.querySelectorAll('.world-audio-panel input')[1],sameToggle:f.toggle===document.querySelector('.world-audio-toggle'),focus:document.activeElement===f.bgm,missing:document.body.textContent.includes('[missing ')};
 });
 assert.deepEqual(after.audio,before.audio);assert.equal(after.stored,before.stored);assert.deepEqual(after.metrics,before.metrics);assert.equal(after.pressed,'true');assert.equal(after.bgm,'70');assert.equal(after.sfx,'80');assert.equal(after.sameBgm,true);assert.equal(after.sameSfx,true);assert.equal(after.sameToggle,true);assert.equal(after.focus,true);assert.notEqual(after.button,before.button);assert.notEqual(after.toggle,before.toggle);assert.notEqual(after.bgmLabel,'背景乐音量');assert.equal(after.missing,false);
 for(const field of ['dateTime','timeSource','period','samples','calibrations','times','timers','clears','sceneUnchanged'])assert.equal(after.hud[field],before.hud[field],field);
 assert.equal(after.hud.sceneUnchanged,true);assert.equal(after.hud.count,'Last view (expired): 2');assert.match(after.hud.status,/Scene updates are paused/);assert.match(after.hud.status,/16:12:00/);assert.equal(after.hud.location,'Commons');assert.equal(after.hud.time,'10/28 16:12');assert.match(after.hud.timeTitle,/Asia\/Shanghai/);assert.equal(after.hud.timeAria,'Current date and time in Shanghai');assert.notEqual(after.hud.light,before.hud.light);assert.equal(requests.some(path=>path.startsWith('/v1/')),false);assert.deepEqual(errors,[]);
 await page.evaluate(()=>window.audioStatusFixture.hud.dispose());
});

// Cold home markup deliberately mounts the actual controllers before shell is
// available. The unrelated world bootstrap is omitted so no reader is started.
test('cold home keeps readable confirmed facts while shell is delayed or fails',async t=>{
 const root=resolve('apps/web/public'),origin='http://127.0.0.1:18972',body=await readFile(resolve(root,'locales/shell/en.json')),url='/assets/locales/shell/en.json',zh=await readFile(resolve(root,'locales/shell/zh-CN.json'));
 const entry=(body,url)=>({url,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')}),manifest={version:1,format:'icu-message-v1',namespaces:{shell:{en:entry(body,url),'zh-CN':entry(zh,'/assets/locales/shell/zh-CN.json')}}};
 const html=(await readFile(resolve(root,'index.html'),'utf8')).replace('<script type="module" src="/assets/world-bootstrap.js"></script>','');
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
 for(const failed of [false,true]){
  const context=await browser.newContext({locale:'en',timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[],worldRequests=[];let release;const gate=new Promise(resolve=>{release=resolve;});page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.route(origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/assets/i18n/manifest.json')return route.fulfill({json:manifest});if(path===url){await gate;return failed?route.fulfill({status:503,body:''}):route.fulfill({contentType:'application/json',body});}if(path.startsWith('/v1/')){worldRequests.push(path);return route.fulfill({status:503,body:''});}if(path==='/en/')return route.fulfill({contentType:'text/html',body:html});if(path.startsWith('/assets/')){try{return route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[extname(path)]||'application/octet-stream',body:await readFile(resolve(root,path.slice(8)))});}catch{return route.fulfill({status:404,body:''});}}return route.fulfill({status:404,body:''});});
   await page.goto(origin+'/en/');const requested=page.waitForRequest(request=>new URL(request.url()).pathname===url);
   await page.evaluate(async()=>{
    const {mountWorldAudio}=await import('/assets/world-audio-ui.js'),{createWorldStatusHud}=await import('/assets/hud/world-status.js'),core=await import('/assets/i18n/core.js');const root=document.querySelector('#world-status-hud');
    const exposedMissing=[],observe=()=>{for(const node of [document.querySelector('.world-audio'),root])if(node&&(node.textContent.includes('[missing shell:')||[...node.querySelectorAll('*')].some(child=>['aria-label','title'].some(attr=>child.getAttribute(attr)?.includes('[missing shell:')))))exposedMissing.push(node.textContent);};const observer=new MutationObserver(observe);observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
    const audio=mountWorldAudio();let samples=0,calibrations=0,times=0;const epoch=Date.UTC(2026,9,28,8,12),clock={source:'serverTime',now(){samples++;return epoch;},calibrate(){calibrations++;return true;}},hud=createWorldStatusHud(root,{clock,onTime(){times++;},setTimer(){return 1;},clearTimer(){}});hud.update({phase:'ready',complete:true,avatars:[{agentId:'a',placeId:'commons'},{agentId:'b',placeId:'commons'}],lastSuccessAt:epoch,serverTime:epoch,instanceId:'synthetic',timeSource:'serverTime',rules:{places:[{id:'commons',access:'members'}]}});hud.select('a');hud.update({phase:'paused',complete:false,avatars:[]});hud.setVisible(false);
    const read=()=>({button:document.querySelector('.world-audio-button').textContent,place:root.querySelector('#world-current-place').textContent,count:root.querySelector('#world-scene-count').textContent,status:root.querySelector('#world-read-status').textContent,time:root.querySelector('time').textContent,dateTime:root.querySelector('time').dateTime,timeSource:root.querySelector('time').dataset.timeSource,samples,calibrations,times,audio:audio.snapshot(),missing:exposedMissing.length});
    window.coldAudioFixture={hud,audio,observer,read,loaded:core.ensureNamespaces(['shell']).then(()=>true,()=>false)};observe();
   });
   await requested;const before=await page.evaluate(()=>window.coldAudioFixture.read());assert.equal(before.missing,0);assert.equal(before.button,'声音：关');assert.equal(before.count,'上次画面（已过期）：2');assert.equal(before.place,'公共庭');assert.match(before.status,/最后成功读取：16:12:00/);assert.equal(before.dateTime,'2026-10-28T08:12:00.000Z');
   release();assert.equal(await page.evaluate(()=>window.coldAudioFixture.loaded),!failed);const after=await page.evaluate(()=>window.coldAudioFixture.read());assert.equal(after.missing,0);for(const key of ['dateTime','timeSource','samples','calibrations','times'])assert.equal(after[key],before[key],key);assert.deepEqual(after.audio,before.audio);
   if(failed){for(const key of ['button','place','count','status','time'])assert.equal(after[key],before[key],key);}else{assert.equal(after.button,'Sound: off');assert.equal(after.count,'Last view (expired): 2');assert.equal(after.place,'Commons');assert.match(after.status,/Last successful refresh: 16:12:00/);}
   assert.deepEqual(worldRequests,[]);assert.deepEqual(errors,[]);await page.evaluate(()=>{window.coldAudioFixture.observer.disconnect();window.coldAudioFixture.hud.dispose();});
  }finally{release();await context.close();}
 }
});
