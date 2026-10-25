import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifeCActivityOutcome,lifeCActivityTerms,lifeCGiftOutcome,lifeCGiftTerms,lifeCPurchaseTerms,validateLifeCAssetCatalog} from '../../apps/platform/domains/life-assets/c-rules.ts';
import type {LifeCActivitySource,LifeCAssetCatalog,LifeCGiftSource,LifeCItemInstance} from '../../apps/platform/domains/life-assets/c-types.ts';
import type {LifeTradeSource} from '../../apps/platform/domains/life-assets/types.ts';
const design=JSON.parse(readFileSync(new URL('../../docs/workstreams/ws03-interaction/life-actions-v1/catalog.json',import.meta.url),'utf8'));
const catalog:LifeCAssetCatalog={...design,revision:3,ruleVersion:1,services:{mealPreparation:design.services.mealPreparation,innRest:{...design.services.innRest,placeId:'stone_inn'},reading:design.services.reading}};
const start=Date.UTC(2026,9,25),actorRef={kind:'agent' as const,id:'synthetic-c-agent'};
const item=(itemId:LifeCItemInstance['itemId']):LifeCItemInstance=>({id:'synthetic-'+itemId,version:1,actorRef,itemId,state:'available',reservationId:null,sourceId:'synthetic-fixture',issuedAt:start-1,updatedAt:start-1,fish:['sardine','mackerel','sea_bass'].includes(itemId)?{weightGrams:100,spotId:'shore_spot',castId:'synthetic-cast',caughtAt:start-1}:null});
const activity=(actionId:LifeCActivitySource['actionId'],value:LifeCItemInstance|null):LifeCActivitySource=>({id:'synthetic-'+actionId,actorKind:'agent',actorId:actorRef.id,actionId,state:'active',catalogRevision:3,ruleVersion:1,placeId:actionId==='rest.inn'?'stone_inn':'harbor_tavern',itemInstanceId:value?.id??null,maxSpend:12,startedAt:start,scheduledEndAt:start+(actionId==='rest.inn'?180000:value?.itemId==='herbal_tea'?30000:60000),endedAt:null,resultId:null,sourceEventId:null});

test('C purchase rules use the frozen three offers, correct shops, bounded quantity and accepted quote',()=>{
 validateLifeCAssetCatalog(catalog);
 for(const [id,unitPrice]of [['bread_meal',6],['herbal_tea',3],['harbor_handbook',10]] as const){
  const s:LifeTradeSource={id:'synthetic-buy-'+id,actorKind:'agent',actorId:actorRef.id,actionId:'shop.buy',state:'completed',placeId:id==='harbor_handbook'?'blue_library':'harbor_tavern',catalogRevision:3,ruleVersion:1,startedAt:start,endedAt:start,resultId:'synthetic-buy-'+id,sourceEventId:'synthetic-event-'+id,quote:{catalogRevision:3,ruleVersion:1,createdAt:start-1,expiresAt:start+1000,items:[{itemId:id,unitPrice}]},purchase:{itemId:id,quantity:2,maxSpend:unitPrice*2},moneyAmount:unitPrice*2};
  assert.deepEqual(lifeCPurchaseTerms(s,catalog),{itemId:id,quantity:2,cost:unitPrice*2});
  for(const bad of [{...s,purchase:{...s.purchase!,quantity:21}},{...s,moneyAmount:unitPrice},{...s,placeId:'fisher_shop'},{...s,quote:{...s.quote,expiresAt:start-1}},{...s,catalogRevision:2}])assert.throws(()=>lifeCPurchaseTerms(bad,catalog));
 }
 assert.throws(()=>validateLifeCAssetCatalog({...catalog,revision:2}));
});

test('C activity terms reserve a specific fish/food and fee, and terminal rules never partly consume on cancellation',()=>{
 const fish=item('sea_bass'),prepare=activity('meal.prepare',fish);assert.deepEqual(lifeCActivityTerms(prepare,fish,catalog),{money:3,itemInstanceId:fish.id,durationMs:60000,outputItemId:'grilled_fish',consumeItem:true});
 for(const id of ['bread_meal','herbal_tea','grilled_fish'] as const){const food=item(id),eat=activity('meal.eat',food);assert.equal(lifeCActivityTerms(eat,food,catalog).money,0);assert.equal(lifeCActivityTerms(eat,food,catalog).outputItemId,null);assert.equal(lifeCActivityOutcome({...eat,state:'completed',endedAt:eat.scheduledEndAt,resultId:eat.id,sourceEventId:'synthetic-event'}),'consume');}
 const inn=activity('rest.inn',null);assert.deepEqual(lifeCActivityTerms(inn,undefined,catalog),{money:12,itemInstanceId:null,durationMs:180000,outputItemId:null,consumeItem:false});
 for(const state of ['cancelled','interrupted'] as const)assert.equal(lifeCActivityOutcome({...prepare,state,endedAt:start+1000,resultId:prepare.id,sourceEventId:'synthetic-event'}),'release');
 assert.throws(()=>lifeCActivityOutcome({...prepare,state:'completed',endedAt:start+59999,resultId:prepare.id,sourceEventId:'synthetic-event'}));assert.throws(()=>lifeCActivityTerms({...prepare,maxSpend:2},fish,catalog));assert.throws(()=>lifeCActivityTerms(prepare,{...fish,actorRef:{kind:'agent',id:'other-agent'}},catalog));assert.throws(()=>lifeCActivityTerms({...inn,itemInstanceId:'legacy-inn-voucher'},undefined,catalog));
});

test('library reading reserves only an optional owned handbook, never consumes it or charges coins',()=>{
 const book=item('harbor_handbook'),reading:LifeCActivitySource={...activity('book.read',book),placeId:'blue_library',maxSpend:0,scheduledEndAt:start+180000};
 for(const value of [book,undefined]){const s={...reading,itemInstanceId:value?.id??null},terms=lifeCActivityTerms(s,value,catalog);assert.deepEqual(terms,{money:0,itemInstanceId:s.itemInstanceId,durationMs:180000,outputItemId:null,consumeItem:false});}
 for(const bad of [{...reading,placeId:'harbor_tavern'},{...reading,scheduledEndAt:start+179999}])assert.throws(()=>lifeCActivityTerms(bad,book,catalog));
 assert.throws(()=>lifeCActivityTerms({...reading,itemInstanceId:item('bait').id},item('bait'),catalog));assert.throws(()=>lifeCActivityTerms(reading,{...book,actorRef:{kind:'agent',id:'other'}},catalog));
 assert.throws(()=>validateLifeCAssetCatalog({...catalog,services:{...catalog.services,reading:{placeId:'blue_library',durationSeconds:60}}}));
});

test('C gift decisions require the actual recipient terminal acceptance and preserve the fixed expiry',()=>{
 const source:LifeCGiftSource={id:'synthetic-gift',fromAgentId:'synthetic-sender',toAgentId:'synthetic-recipient',itemInstanceIds:['synthetic-life-item'],state:'pending',catalogRevision:3,ruleVersion:1,createdAt:start,deadlineAt:start+86400000,resolvedAt:null,sourceEventId:null,acceptedByAgentId:null};
 assert.deepEqual(lifeCGiftTerms(source),{from:source.fromAgentId,to:source.toAgentId,itemIds:source.itemInstanceIds});assert.throws(()=>lifeCGiftOutcome(source));
 const accepted={...source,state:'accepted' as const,resolvedAt:start+1,sourceEventId:'synthetic-consent-event',acceptedByAgentId:source.toAgentId};assert.equal(lifeCGiftOutcome(accepted),'transfer');
 for(const s of [{...accepted,acceptedByAgentId:source.fromAgentId},{...accepted,resolvedAt:source.deadlineAt},{...accepted,itemInstanceIds:Array(6).fill('x')},{...accepted,toAgentId:source.fromAgentId},{...accepted,deadlineAt:start+3600000}])assert.throws(()=>lifeCGiftOutcome(s));
 for(const state of ['declined','withdrawn','unavailable','expired'] as const)assert.equal(lifeCGiftOutcome({...source,state,resolvedAt:state==='expired'?source.deadlineAt:start+1,sourceEventId:'synthetic-terminal-event'}),'release');
 assert.throws(()=>lifeCGiftOutcome({...source,state:'expired',resolvedAt:start+1,sourceEventId:'synthetic-terminal-event'}));
 // Legacy card/vouchers are not represented by LifeCItemId or this store; the PG participant only resolves life_assets.instances.
});
