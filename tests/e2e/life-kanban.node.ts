// Source/static only: no production build, database, identity or business API.
import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import Fastify from 'fastify';
import {chromium,expect} from '@playwright/test';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
// @ts-expect-error Player-facing browser data module.
import {BOARD_COLUMNS,MAP_CARDS,LIFE_CARDS} from '../../apps/web/public/kanban-data.js';

test('life roadmap preserves map cards and separates local completion from future experiences',async t=>{
 const cards=[...MAP_CARDS,...LIFE_CARDS],ids=cards.map(card=>card.id);
 assert.equal(new Set(ids).size,19);assert.equal(cards.length,19);
 assert.deepEqual(BOARD_COLUMNS.map((column:any)=>column.title),['投票','未来','进行中','已完成']);
 assert.deepEqual(MAP_CARDS.map((card:any)=>[card.id,card.column]),[['map-atlas','completed'],['map-sunset-bay','planned'],['map-plain-outpost','planned'],['map-dawn-lake','planned'],['map-mist-valley','planned']]);
 assert.deepEqual(LIFE_CARDS.filter((card:any)=>card.column==='completed').map((card:any)=>card.title),['上班赚取星币','在长椅休息恢复体力','一次安排工作与休息','首批镇民主动生活','购买鱼具与生活用品','去海边钓鱼','出售鱼获换取星币']);
 assert.deepEqual(LIFE_CARDS.filter((card:any)=>card.column==='in-progress'),[]);
 assert.deepEqual(LIFE_CARDS.filter((card:any)=>card.column==='planned').map((card:any)=>card.title),['在酒馆吃饭与加工鱼餐','花星币在旅舍休息','去书屋阅读','到访小镇风景','给好友送一份礼物','结识更多会生活的镇民','把新的生活写进日记']);
 for(const card of LIFE_CARDS){assert(BOARD_COLUMNS.some((column:any)=>column.id===card.column));assert(card.summary);if(card.column==='completed'){assert.equal(card.completedVersion,['life-shop-goods','life-sea-fishing','life-sell-fish'].includes(card.id)?'0.5.0':'0.3.0');assert.match(card.scope,/本地/);}else assert.match(card.scope,/尚未开放/);}

 const app=Fastify({logger:false}),requests:{method:string;url:string}[]=[],errors:string[]=[];
 app.addHook('onRequest',async request=>{requests.push({method:request.method,url:request.url});});
 registerSiteRoutes(app,{assetMode:'source',repoRoot:resolve('.')});
 const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>errors.push(error.message));
 const response=await page.goto(origin+'/kanban');assert.equal(response?.status(),200);
 await expect(page.getByRole('heading',{name:'建设看板',exact:true})).toBeVisible();
 await expect(page.locator('.product-lead')).toHaveText('看看小镇正在增加哪些生活体验，哪些新地方还在规划中。');
 await expect(page.locator('#map-board')).toHaveAttribute('aria-label','小镇功能与场景建设事项');
 await expect(page.locator('.board-card')).toHaveCount(19);
 assert.deepEqual(await page.locator('.board-heading h2').allTextContents(),['投票','未来','进行中','已完成']);
 for(const [column,count] of [['voting',0],['planned',11],['in-progress',0],['completed',8]] as const){await expect(page.locator(`[data-column="${column}"] .board-card`)).toHaveCount(count);}
 for(const card of cards){const item=page.locator(`[data-card="${card.id}"]`);await expect(item.getByRole('heading',{name:card.title,exact:true})).toBeVisible();await expect(item.locator('p')).toHaveText(card.summary);}
 for(const card of LIFE_CARDS.filter((card:any)=>card.column==='completed'))await expect(page.locator(`[data-card="${card.id}"] .board-card-scope`)).toHaveText(`生活体验 · 本地已完成 · v${card.completedVersion}`);
 const voting=page.locator('[data-column="voting"]');await expect(voting).toContainText('暂未开放投票。未来会在这里征询生活与地图提案。');await expect(voting.locator('.board-count,button,input,a')).toHaveCount(0);
 await expect(page.locator('[data-column="planned"] a')).toHaveCount(0);
 await expect(page.getByRole('link',{name:'打开新城地图册',exact:true})).toHaveAttribute('href','/?atlas=1');
 assert(requests.every(request=>request.method==='GET'&&!request.url.startsWith('/v1/')));assert.deepEqual(errors,[]);
});
