import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {lifeBUiFixture,lifeBItems,lifeBQuote,lifeBFishing,lifeBTrade,lifeState} from '../fixtures/life-b-ui.ts';
import {avatar} from '../fixtures/world-town-v2.ts';
// @ts-expect-error Browser public world projection.
import {readWorldPage,projectWorldAvatars} from '../../apps/web/public/hud/world-scene-projection.js';
// @ts-expect-error Browser strict canonical map projection.
import {pixelPoint} from '../../apps/web/public/world-pixel/map.js';
// @ts-expect-error Browser JavaScript DTO adapters.
import {readLifeActions,readLifeOptions,readLifeState} from '../../apps/web/public/hud/life-readers.js';
// @ts-expect-error Browser JavaScript DTO adapters.
import {readLifeItems,readLifeQuote} from '../../apps/web/public/hud/life-items-reader.js';
// @ts-expect-error Browser public projection.
import {readPublicLifeActivity} from '../../apps/web/public/hud/life-public-state.js';
// @ts-expect-error Browser animation helper.
import {fishingPose} from '../../apps/web/public/world-pixel/fishing-art.js';
// @ts-expect-error Browser intent copy only.
import {buildLifeBIntent} from '../../apps/web/public/hud/life-b-intent.js';
test('B exact catalog/map/art and options accept source fields and reject mismatched topology or publication',async()=>{
 const f=await lifeBUiFixture(),catalog=readLifeActions(f.catalog,f.rules).data;assert.equal(catalog.actions.length,7);assert.equal(catalog.places.find((p:any)=>p.placeId==='harbor_shore').stations.length,4);assert.equal(catalog.shop.items.length,5);
 assert.throws(()=>readLifeActions(f.catalog,{...f.rules,version:3}));const bad=structuredClone(f.catalog);bad.data.shop.items[1].assetRef.sha256='0'.repeat(64);assert.throws(()=>readLifeActions(bad,f.rules));
 const buy=catalog.actions.find((a:any)=>a.actionId==='shop.buy'),params={itemId:'bait',quantity:2};assert.equal(readLifeOptions(f.options('own-life-agent-a',buy,params),'own-life-agent-a',buy).data.costs.star_coin,4);assert.equal(readLifeOptions(f.options('own-life-agent-a',buy,params),'own-life-agent-a',buy).data.capacity,null);
});
test('private resources preserve available/reserved instances; wrong subject and malformed balances fail closed',()=>{
 const raw=lifeBItems(),value=readLifeItems(raw,'own-life-agent-a').data;assert.deepEqual(value.wallet,{balance:46,reserved:6,available:40,version:2});assert.equal(value.totals.find((i:any)=>i.itemId==='sardine').reserved,1);assert.equal(value.items.filter((i:any)=>i.fish).length,2);assert.throws(()=>readLifeItems(raw,'own-life-agent-b'));assert.throws(()=>readLifeItems({...raw,data:{...raw.data,wallet:{...raw.data.wallet,available:46}}},'own-life-agent-a'));assert.equal(readLifeQuote(lifeBQuote(),'buy','bait').data.quote.unitPrice,2);assert.throws(()=>readLifeQuote(lifeBQuote(),'sell','bait'));
});
test('fish partial/empty/trade results stay private; public waiting cannot disclose draws or become locally completed',()=>{
 const partial=lifeBFishing('own-partial','interrupted'),data=readLifeState(lifeState('own-life-agent-a',{recentResults:[partial,lifeBTrade()]}),'own-life-agent-a').data;assert.equal(data.recentResults[0].result.fishing.noCatchCount,1);assert.equal(data.recentResults[0].result.fishing.refundedCosts.energy,2);assert.equal(data.recentResults[1].result.trade.moneyDelta,4);
 const pub={activityId:'own-active',actionId:'fish.session',state:'active',placeId:'harbor_shore',placeName:'港区近岸',startedAt:0,scheduledEndAt:180000,fishing:{phase:'waiting',castStartedAt:0,castDueAt:60000}};assert.equal(readPublicLifeActivity(pub).fishing.castDueAt,60000);assert.throws(()=>readPublicLifeActivity({...pub,fishing:{...pub.fishing,catches:[]}}));assert.throws(()=>readPublicLifeActivity({...pub,actionId:'shop.sell'}));
 assert.deepEqual(fishingPose(pub,{serverTime:0}),{action:'casting',index:0});assert.equal(fishingPose(pub,{serverTime:61000}).action,'waiting');assert.deepEqual(fishingPose(pub,{serverTime:61000,stale:true}),{action:'waiting',index:0});assert.deepEqual(fishingPose(pub,{serverTime:61000,reducedMotion:true}),{action:'waiting',index:0});assert.equal(pub.state,'active');
 const text=buildLifeBIntent({origin:'http://127.0.0.1:1',agentLabel:'样本 · A901',description:'钓三竿',placeId:'harbor_shore',actionId:'fish.session',params:{spotId:'shore_spot',castCount:3,rodInstanceId:'own-rod'},maxSpend:0,maxBait:3});assert.match(text,/capabilities/);assert.match(text,/星币支出最多 0/);assert.match(text,/鱼饵消耗最多 3/);assert.match(text,/原/);assert.doesNotMatch(text,/Bearer|sessionToken|runtimeToken/);
});
test('all production B PNG exports retain exact frozen hashes and dimensions; no masters enter the client',async()=>{
 const base=new URL('../../apps/web/public/world-life/b/',import.meta.url),m=JSON.parse(await readFile(new URL('assets-manifest.json',base),'utf8')),refs=[...m.items.map((i:any)=>i.sprite),m.atlas,...m.nativeSources];assert.equal(refs.length,42);let bytes=0;for(const ref of refs){const b=await readFile(new URL(ref.path,base));assert.equal(createHash('sha256').update(b).digest('hex'),ref.sha256,ref.path);if(ref.bytes!==undefined)assert.equal(b.length,ref.bytes,ref.path);assert.equal(b.readUInt32BE(16),ref.size?.[0]??ref.frames*ref.frameSize[0],ref.path);assert.equal(b.readUInt32BE(20),ref.size?.[1]??ref.frameSize[1],ref.path);bytes+=b.length;}assert.equal(bytes,65511);assert.equal(m.version,'1.0.1');
});
test('rules3 residents and committed edges survive the additive rules4 map; unknown versions and invalid edges still fail',async()=>{
 const f=await lifeBUiFixture(),row={...avatar('own-old-rules',{x:1,y:0}),rulesetVersion:3},page=(value:any)=>({worldId:'default',scope:'world',worldRevision:1,asOf:1000,avatars:[value],npcs:[],complete:true,nextCursor:null});
 const still=readWorldPage(page(row),f.rules).avatars;assert.equal(projectWorldAvatars(still,f.rules,{projectPoint:pixelPoint})[0].x,536);assert.deepEqual(still[0].position,{x:1,y:0});
 const edge={segmentId:row.id+':1',movementId:'own-original-move',source:'explicit',status:'committed',from:{x:0,y:0},to:{x:1,y:0},startedAt:0,arriveAt:1000,rulesetVersion:3,topologyVersion:3};assert.equal(readWorldPage(page({...row,motion:edge}),f.rules).avatars[0].motion.rulesetVersion,3);
 assert.throws(()=>readWorldPage(page({...row,motion:{...edge,rulesetVersion:5,topologyVersion:5}}),f.rules));assert.throws(()=>readWorldPage(page({...row,motion:{...edge,from:{x:0,y:1}}}),f.rules));
});
