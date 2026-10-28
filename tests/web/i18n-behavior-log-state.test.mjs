import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {ownerLogText,ownerLogTitle,logOutcomes} from '../../apps/web/public/hud/behavior-log-presentation.js';

// Only the actual source presentation is mounted. Reader snapshots are synthetic;
// a locale change must not call their page/filter/request/command methods.
test('log labels switch language without rebuilding pages, details, expanded groups or filter drafts',async t=>{
 const original={source:{node:'interaction.feedback.submitted'},details:{life:{actionId:'work.shift',coinReward:36,energySpent:24,energyRestored:0}}};assert.equal(ownerLogTitle(original),'回复记录');assert.equal(ownerLogText(original),'留下一条回复记录。');assert.deepEqual(logOutcomes(original,{mode:'owner'}),['工资 36 星币','消耗体力 24']);assert.deepEqual(logOutcomes(original,{mode:'world'}),[]);
 const root=resolve('apps/web/public'),origin='http://127.0.0.1:18971',resources={},manifest={version:1,format:'icu-message-v1',namespaces:{shell:{}}},outside=[],errors=[];
 for(const locale of ['zh-CN','en']){const body=await readFile(resolve(root,'locales/shell/'+locale+'.json')),url=`/assets/locales/shell/${locale}.json`;resources[url]=body;manifest.namespaces.shell[locale]={url,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};}
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const context=await browser.newContext({locale:'zh-CN'});t.after(()=>context.close());const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin||route.request().method()!=='GET'){outside.push(route.request().method()+' '+url.pathname);return route.abort();}
  if(url.pathname==='/assets/i18n/manifest.json')return route.fulfill({json:manifest});
  if(resources[url.pathname])return route.fulfill({contentType:'application/json',body:resources[url.pathname]});
  if(url.pathname.startsWith('/assets/')){try{return route.fulfill({contentType:extname(url.pathname)==='.js'?'text/javascript':'application/json',body:await readFile(resolve(root,url.pathname.slice(8)))});}catch{return route.fulfill({status:404,body:''});}}
  if(url.pathname==='/zh-CN/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><style>.behavior-logs{display:inline-block;vertical-align:top;width:350px}.behavior-log-list{height:180px;overflow:auto}.behavior-log-row{display:block;min-height:80px}.behavior-owner-text{white-space:pre-wrap}</style></head><body></body></html>'});
  outside.push(url.pathname);return route.fulfill({status:404,body:''});
 });
 await page.goto(origin+'/zh-CN/');
 await page.evaluate(async()=>{
  const core=await import('/assets/i18n/core.js');await core.ensureNamespaces(['shell']);const {createBehaviorLogView}=await import('/assets/hud/behavior-log-view.js');
  const epoch=Date.UTC(2026,9,28,12),calls=[],sourceCalls=[],prose='我今天沿河散步。\n\n这是 Agent 自己保留的原文。<img src=x onerror=alert(1)>\n'.repeat(10);
  const item=(id,npc=false)=>({id,agent:npc?{agentId:null,npcId:'npc-harbor-hand',actorKind:'npc',displayName:'陈大川'}:{agentId:'a',displayName:'原文居民姓名'},title:'来源的原始标题',action:'来源动作',result:'来源结果原文',date:'2026-10-28',time:'20:00',occurredAt:epoch,source:{domain:'life',node:'life.work.completed',label:'来源署名原文',detail:{operation:'life.activities.get',input:{activityId:id}}},authored:null,details:{version:1,completeness:'recorded',phase:'life_work',phaseLabel:'来源阶段原文',summary:'来源摘要原文',timeRange:{startedAt:epoch-120000,endedAt:epoch,durationMs:120000},location:{mapId:'pixel-town-v2',rulesetVersion:6,topologyVersion:6,from:{kind:'place',name:'原文场所'},to:{kind:'place',name:'原文场所'},via:[]},journey:null,participants:[],initiator:{label:'来源发起者'},executor:{label:'来源执行者'},gaps:[],life:{actionId:'work.shift',jobId:'harbor_shift',coinReward:36,energySpent:24,energyRestored:0,scheduledEndAt:epoch,trade:null,fishing:null,c:null}}});
  const statement={...item('statement'),source:{domain:'life',node:'life.journal.authored',label:'Agent来源',detail:null},authored:{kind:'agent_life_statement',version:1,clientEntryId:'synthetic-entry',title:'我的原文标题',text:prose,sourceRefs:[],submittedAt:epoch},details:null};
  const journal=item('journal');journal.details.journal={items:[{itemId:'bait',name:'来源物品名称',quantity:2,role:'bought'}],moneyDelta:-4,energySpent:0,energyRestored:0,quotaRefunded:true,stopCode:null};
  const views={},states={};function mount(key,mode,items,phase='ready'){
   const state={phase,page:2,agentName:'原文居民姓名',filters:{timeZone:'Asia/Shanghai',fromDate:'2026-10-01',toDate:'2026-10-28'},canPrevious:true,canNext:true,data:{timeZone:'Asia/Shanghai',items,partial:false,historyCoverage:{from:epoch-86400000,complete:false,gaps:['来源覆盖说明原文']}}};states[key]=state;
   const reader={snapshot:()=>state,subscribe(fn){fn(state);return()=>{};},...Object.fromEntries(['refresh','previous','next','retry','configure'].map(name=>[name,(...args)=>calls.push({key,name,args})]))};
   const view=createBehaviorLogView(reader,{mode,openSource:ref=>sourceCalls.push(ref)});view.node.dataset.fixture=key;document.body.append(view.node);views[key]=view;
  }
  mount('world','world',[item('n1',true),item('n2',true),item('n3',true)]);mount('owner','owner',[statement,item('old')]);mount('facts','owner',[journal]);mount('recent','recent',[item('recent')],'error');
  const world=views.world.node,owner=views.owner.node,facts=views.facts.node,recent=views.recent.node;
  world.querySelector('details.behavior-log-group').open=true;world.querySelector('.behavior-log-list').scrollTop=65;
  owner.querySelector('[data-log-id="statement"]').click();facts.querySelector('[data-log-id="journal"]').click();recent.querySelector('[data-log-id="recent"]').click();
  owner.querySelector('.behavior-owner-filters').open=true;facts.querySelector('.behavior-owner-facts').open=true;
  const draft=owner.querySelector('input[type=date]');draft.value='2026-09-18';draft.focus();owner.querySelector('.behavior-log-list').scrollTop=71;
  const refs={group:world.querySelector('.behavior-log-group'),worldList:world.querySelector('.behavior-log-list'),ownerList:owner.querySelector('.behavior-log-list'),article:owner.querySelector('article'),body:owner.querySelector('.behavior-owner-text'),filters:owner.querySelector('.behavior-owner-filters'),draft,facts:facts.querySelector('.behavior-owner-facts'),recentArticle:recent.querySelector('article')};
  window.logI18nFixture={core,views,states,calls,sourceCalls,prose,refs,originalStates:JSON.stringify(states),before:{worldScroll:refs.worldList.scrollTop,ownerScroll:refs.ownerList.scrollTop,heading:world.querySelector('h3').textContent,origin:owner.querySelector('.behavior-owner-origin').textContent,status:recent.querySelector('.behavior-log-status').textContent,role:facts.querySelector('dt').textContent,time:recent.querySelector('dd').textContent},back:owner.querySelector('.behavior-log-detail-back')};
 });
 const result=await page.evaluate(async()=>{
  const f=window.logI18nFixture,refs=f.refs;const switched=await f.core.setLocale('en');return{switched,sameGroup:refs.group===f.views.world.node.querySelector('.behavior-log-group'),sameArticle:refs.article===f.views.owner.node.querySelector('article'),sameRecent:refs.recentArticle===f.views.recent.node.querySelector('article'),sameDraft:refs.draft===f.views.owner.node.querySelector('input[type=date]'),sameBack:f.back===f.views.owner.node.querySelector('.behavior-log-detail-back'),groupOpen:refs.group.open,factsOpen:refs.facts.open,filtersOpen:refs.filters.open,focused:document.activeElement===refs.draft,draft:refs.draft.value,worldScroll:refs.worldList.scrollTop,ownerScroll:refs.ownerList.scrollTop,before:f.before,heading:f.views.world.node.querySelector('h3').textContent,origin:f.views.owner.node.querySelector('.behavior-owner-origin').textContent,status:f.views.recent.node.querySelector('.behavior-log-status').textContent,role:f.views.facts.node.querySelector('dt').textContent,body:refs.body.textContent,title:f.views.owner.node.querySelector('article h3').textContent,bodyHtml:refs.body.querySelector('img')!==null,source:f.views.recent.node.querySelector('.behavior-log-result').textContent,time:f.views.recent.node.querySelector('dd').textContent,statesUnchanged:JSON.stringify(f.states)===f.originalStates,calls:f.calls,missing:document.body.textContent.includes('[missing ')};
 });
 assert.equal(result.switched,true);for(const key of ['sameGroup','sameArticle','sameRecent','sameDraft','sameBack','groupOpen','factsOpen','filtersOpen','focused','statesUnchanged'])assert.equal(result[key],true,key);
 assert.equal(result.draft,'2026-09-18');assert.equal(result.worldScroll,result.before.worldScroll);assert.equal(result.ownerScroll,result.before.ownerScroll);assert.ok(result.worldScroll>0);assert.ok(result.ownerScroll>0);for(const key of ['heading','origin','status','role'])assert.notEqual(result[key],result.before[key],key);
 assert.equal(result.body,await page.evaluate(()=>window.logI18nFixture.prose));assert.equal(result.title,'我的原文标题');assert.equal(result.bodyHtml,false);assert.equal(result.source,'来源摘要原文');assert.equal(result.time,result.before.time);assert.deepEqual(result.calls,[]);assert.equal(result.missing,false);
 await page.evaluate(()=>window.logI18nFixture.back.click());assert.equal(await page.locator('[data-fixture=owner] [data-log-id=statement]').evaluate(node=>document.activeElement===node),true);assert.equal(await page.locator('[data-fixture=owner] .behavior-log-list').evaluate(node=>node.scrollTop),0);
 assert.deepEqual(await page.evaluate(()=>window.logI18nFixture.calls),[]);assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);await page.evaluate(()=>Object.values(window.logI18nFixture.views).forEach(view=>view.dispose()));
});
