import {randomInt} from 'node:crypto';
import {fail,object} from '../common/errors.ts';
import {hashRuntimeRequest} from '../runtime/command.ts';
import {LIFE_B_RULES as B} from './b-catalog.ts';
import type {LifeBItemId,LifeFishId,LifeSpotId,LifeQuote,LifeBudget,LifeBudgetProgress,LifeOutputReference} from './b-types.ts';
import type {LifeActorRef} from './types.ts';

const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)fail('invalid_request',400,'Use a bounded non-negative integer');return v;};
const item=(id:LifeBItemId)=>B.shop.items.find(i=>i.id===id)??fail('life_item_not_supported',400,'Choose an enabled fishing item');
/** Quotes are public immutable price snapshots, not authorization tokens. No read writes a quote row. */
export function createLifeQuote(side:'buy'|'sell',itemId:LifeBItemId,now:number):LifeQuote{
 integer(now);const definition=item(itemId),price=side==='buy'?definition.buyPrice:side==='sell'?definition.sellPrice:null;
 if(price===null)fail('life_offer_not_supported',400,'The fishing shop does not offer this item in that direction');
 const document={catalogRevision:2 as const,ruleVersion:1 as const,placeId:'fisher_shop' as const,side,itemId,unitPrice:price,issuedAt:now,expiresAt:integer(now+B.quoteTtlMs)};
 return {...document,quoteId:'life-quote:'+now.toString(36)+':'+hashRuntimeRequest(document)};
}
export function resolveLifeQuote(quoteRef:string,side:'buy'|'sell',itemId:LifeBItemId,now:number):LifeQuote{
 if(typeof quoteRef!=='string'||!/^life-quote:[0-9a-z]{1,11}:[a-f0-9]{64}$/.test(quoteRef))fail('life_quote_changed',409,'Read and choose a current shop quote');
 const issuedAt=parseInt(quoteRef.split(':')[1]!,36),quote=createLifeQuote(side,itemId,issuedAt);integer(now);
 if(quote.quoteId!==quoteRef||now<issuedAt||now>=quote.expiresAt)fail('life_quote_changed',409,'The chosen quote is expired or no longer matches; choose again');return quote;
}
export function parseLifeBudget(spend:unknown,consume:unknown):LifeBudget{
 const money=object(spend,['star_coin']),items=object(consume,['bait']);return {maxSpendByCurrency:{star_coin:integer(money.star_coin)},maxConsumeByItem:items.bait===undefined?{}:{bait:integer(items.bait,0,12*B.castsPerSession)}};
}
export function assertLifeBudget(budget:LifeBudget,progress:LifeBudgetProgress):void{
 for(const n of Object.values(progress))integer(n);const spend=progress.committedSpend+progress.reservedSpend,bait=progress.committedBait+progress.reservedBait;
 if(!Number.isSafeInteger(spend)||spend>budget.maxSpendByCurrency.star_coin)fail('life_spend_limit',409,'This step exceeds the original cumulative coin budget');
 if(!Number.isSafeInteger(bait)||bait>(budget.maxConsumeByItem.bait??0))fail('life_consume_limit',409,'This step exceeds the original bait consumption budget');
}
/** Call only when a real cast starts. Persist this outcome before any continuation can observe it. */
export function sampleLifeFish(spotId:LifeSpotId,draw:(exclusiveMax:number)=>number=randomInt):{itemId:LifeFishId|null;weightGrams:number|null}{
 const spot=B.spots.find(s=>s.id===spotId);if(!spot)fail('life_spot_not_supported',400,'Choose a published harbor fishing spot');
 let ticket=integer(draw(10000),0,9999);for(const row of spot.outcomes){if(ticket<row.tickets){if(row.itemId===null)return {itemId:null,weightGrams:null};const fish=item(row.itemId);if(!('minWeightGrams'in fish)||!('maxWeightGrams'in fish))throw new Error('Approved fish weight range missing');const width=fish.maxWeightGrams!-fish.minWeightGrams!+1;return {itemId:row.itemId,weightGrams:fish.minWeightGrams!+integer(draw(width),0,width-1)};}ticket-=row.tickets;}throw new Error('Approved fishing weights do not cover the draw');
}
export function fishingCastId(sessionId:string,index:number):string{if(typeof sessionId!=='string'||!/^[A-Za-z0-9_:-]{8,120}$/.test(sessionId))fail('invalid_request',400,'A stable fishing session is required');return sessionId+':cast:'+integer(index,0,B.castsPerSession-1);}
export function parseCaughtFishReference(raw:unknown,priorSteps:readonly {stepId:string;actionId?:string}[]):LifeOutputReference{
 const ref=object(raw,['stepId','output']);if(typeof ref.stepId!=='string'||ref.output!=='caughtFish'||!priorSteps.some(s=>s.stepId===ref.stepId&&s.actionId==='fish.session'))fail('life_output_reference_invalid',400,'Reference caughtFish from a preceding fishing step in this same plan');return {stepId:ref.stepId,output:'caughtFish'};
}
export function resolveCaughtFishReference(ref:LifeOutputReference,target:{planId:string;actor:LifeActorRef},source:{planId:string;stepId:string;actor:LifeActorRef;state:string;caughtFish:string[]},ifEmpty:'skip'|undefined):string[]{
 if(source.planId!==target.planId||source.stepId!==ref.stepId||source.actor.kind!==target.actor.kind||source.actor.id!==target.actor.id||source.state!=='completed'||source.caughtFish.length>B.castsPerSession||new Set(source.caughtFish).size!==source.caughtFish.length)fail('life_output_reference_invalid',409,'The completed fishing output is not owned by this plan and actor');
 if(!source.caughtFish.length&&ifEmpty!=='skip')fail('life_output_empty',409,'No caught fish were produced; a new decision or explicit ifEmpty skip is required');return [...source.caughtFish];
}
