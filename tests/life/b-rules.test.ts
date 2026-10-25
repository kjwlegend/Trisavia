import test from 'node:test';
import assert from 'node:assert/strict';
import {LIFE_B_RULES as B} from '../../apps/platform/domains/life/b-catalog.ts';
import {createLifeQuote,resolveLifeQuote,parseLifeBudget,assertLifeBudget,sampleLifeFish,fishingCastId,parseCaughtFishReference,resolveCaughtFishReference} from '../../apps/platform/domains/life/b-rules.ts';

test('B publishes only the approved fishing shop directions and five item kinds',()=>{
 assert.deepEqual(B.shop.items.filter(i=>i.buyPrice!==null).map(i=>[i.id,i.buyPrice]),[['basic_rod',30],['bait',2]]);
 assert.deepEqual(B.shop.items.filter(i=>i.sellPrice!==null).map(i=>[i.id,i.sellPrice]),[['sardine',4],['mackerel',8],['sea_bass',14]]);
 assert.throws(()=>createLifeQuote('buy','sardine',1000),{code:'life_offer_not_supported'});assert.throws(()=>createLifeQuote('sell','basic_rod',1000),{code:'life_offer_not_supported'});
});
test('quote snapshots survive restart reconstruction, expire exactly, and cannot switch item or price',()=>{
 const quote=createLifeQuote('buy','bait',1000);assert.deepEqual(resolveLifeQuote(quote.quoteId,'buy','bait',1001),quote);assert.equal(quote.expiresAt-quote.issuedAt,7200000);
 assert.throws(()=>resolveLifeQuote(quote.quoteId,'buy','basic_rod',1001),{code:'life_quote_changed'});assert.throws(()=>resolveLifeQuote(quote.quoteId,'buy','bait',quote.expiresAt),{code:'life_quote_changed'});assert.throws(()=>resolveLifeQuote(quote.quoteId,'buy','bait',999),{code:'life_quote_changed'});
});
test('coin and item budgets bound cumulative commitments plus only the active reservation',()=>{
 const b=parseLifeBudget({star_coin:10},{bait:5});assertLifeBudget(b,{committedSpend:8,reservedSpend:2,committedBait:3,reservedBait:2});
 assert.throws(()=>assertLifeBudget(b,{committedSpend:9,reservedSpend:2,committedBait:0,reservedBait:0}),{code:'life_spend_limit'});assert.throws(()=>assertLifeBudget(b,{committedSpend:0,reservedSpend:0,committedBait:5,reservedBait:1}),{code:'life_consume_limit'});
 assert.throws(()=>parseLifeBudget({star_coin:0},{bread_meal:1}));assert.throws(()=>parseLifeBudget({star_coin:-1},{}));assert.throws(()=>parseLifeBudget({star_coin:0},{bait:61}));
});
test('both spots have exact approved outcomes and inclusive integer fish weights (injected draws)',()=>{
 for(const spot of B.spots){assert.equal(spot.outcomes.reduce((n,x)=>n+x.tickets,0),10000);let boundary=0;for(const row of spot.outcomes){for(const ticket of [boundary,boundary+row.tickets-1]){const seen:number[]=[],r=sampleLifeFish(spot.id,max=>{seen.push(max);return seen.length===1?ticket:max-1;});assert.equal(r.itemId,row.itemId);if(row.itemId){const fish=B.shop.items.find(i=>i.id===row.itemId)!;assert.equal(r.weightGrams,'maxWeightGrams'in fish?fish.maxWeightGrams:null);assert.equal(seen.length,2);}else{assert.equal(r.weightGrams,null);assert.equal(seen.length,1);}}boundary+=row.tickets;}}
 assert.throws(()=>sampleLifeFish('shore_spot',()=>10000));assert.equal(fishingCastId('session-original-01',0),fishingCastId('session-original-01',0));assert.notEqual(fishingCastId('session-original-01',0),fishingCastId('session-original-01',1));
});
test('typed output selection is limited to this actor, plan, and completed preceding fishing step',()=>{
 const ref=parseCaughtFishReference({stepId:'fish',output:'caughtFish'},[{stepId:'fish',actionId:'fish.session'}]),target={planId:'plan-one',actor:{kind:'agent' as const,id:'agent-one'}},source={...target,stepId:'fish',state:'completed',caughtFish:['fish-one','fish-two']};
 assert.deepEqual(resolveCaughtFishReference(ref,target,source,undefined),['fish-one','fish-two']);for(const change of [{planId:'other-plan'},{actor:{kind:'agent' as const,id:'other-agent'}},{state:'active'},{caughtFish:['fish-one','fish-one']}])assert.throws(()=>resolveCaughtFishReference(ref,target,{...source,...change},undefined),{code:'life_output_reference_invalid'});
 assert.throws(()=>parseCaughtFishReference({stepId:'buy',output:'caughtFish'},[{stepId:'buy',actionId:'shop.buy'}]),{code:'life_output_reference_invalid'});assert.throws(()=>parseCaughtFishReference({stepId:'later',output:'caughtFish'},[]),{code:'life_output_reference_invalid'});
 assert.throws(()=>resolveCaughtFishReference(ref,target,{...source,caughtFish:[]},undefined),{code:'life_output_empty'});assert.deepEqual(resolveCaughtFishReference(ref,target,{...source,caughtFish:[]},'skip'),[]);
});
