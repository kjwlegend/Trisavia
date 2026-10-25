import {fail,object} from '../common/errors.ts';
import {hashRuntimeRequest} from '../runtime/command.ts';
import {LIFE_C_RULES as C} from './c-values.ts';
import type {LifeBudget} from './b-types.ts';
import type {LifeCQuote,LifeConsumableId} from './c-types.ts';

export const C_CONSUMABLES:readonly LifeConsumableId[]=['bait','sardine','mackerel','sea_bass','bread_meal','herbal_tea','grilled_fish'];
export const C_ACTIONS=['meal.prepare','meal.eat','rest.inn','book.read','visit.place'] as const;
export function cInteger(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail('invalid_request',400,'Choose a bounded non-negative integer');return value;
}
/** Public frozen terms, not a bearer or an authority to spend. */
export function createLifeCQuote(itemId:unknown,now:number):LifeCQuote {
 if(!['bread_meal','herbal_tea','harbor_handbook'].includes(String(itemId)))fail('life_offer_not_supported',400,'Choose a currently offered food or handbook');
 cInteger(now);const item=C.items.find(i=>i.id===itemId)!,value={catalogRevision:3 as const,ruleVersion:1 as const,placeId:itemId==='harbor_handbook'?'blue_library' as const:'harbor_tavern' as const,side:'buy' as const,itemId:itemId as LifeCQuote['itemId'],unitPrice:item.buyPrice!,issuedAt:now,expiresAt:cInteger(now+7200000)};
 return {...value,quoteId:'life-c-quote:'+now.toString(36)+':'+hashRuntimeRequest(value)};
}
export function resolveLifeCQuote(ref:unknown,itemId:unknown,now:number):LifeCQuote {
 if(typeof ref!=='string'||!/^life-c-quote:[0-9a-z]{1,11}:[a-f0-9]{64}$/.test(ref))fail('life_quote_changed',409,'Read and choose a current food or handbook quote');
 const quote=createLifeCQuote(itemId,parseInt(ref.split(':')[1]!,36));cInteger(now);
 if(quote.quoteId!==ref||now<quote.issuedAt||now>=quote.expiresAt)fail('life_quote_changed',409,'The chosen quote expired or changed; choose again');return quote;
}
export function parseLifeCBudget(spend:unknown,consume:unknown):LifeBudget {
 const money=object(spend,['star_coin']),items=object(consume,[...C_CONSUMABLES]);return {maxSpendByCurrency:{star_coin:cInteger(money.star_coin)},maxConsumeByItem:Object.fromEntries(Object.entries(items).map(([id,n])=>[id,cInteger(n,0,id==='bait'?60:20)]))};
}
/** The ceiling is the original intention. Releasing a reservation never increases it. */
export function assertLifeCConsumption(budget:LifeBudget,committed:Partial<Record<LifeConsumableId,number>>,next:Partial<Record<LifeConsumableId,number>>) {
 for(const id of C_CONSUMABLES){const count=cInteger(committed[id]??0)+cInteger(next[id]??0);if(!Number.isSafeInteger(count)||count>(budget.maxConsumeByItem[id]??0))fail('life_consume_limit',409,'This step exceeds the original item consumption budget');}
}
