import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {LifeActivity} from '../domains/life/types.ts';
import type {BehaviorDetails} from '../domains/behavior/types.ts';
import {LIFE_COMMERCE_REPOSITORY} from '../domains/life-assets/repository.ts';
import {LIFE_C_COMMERCE_REPOSITORY} from '../domains/life-assets/c-repository.ts';
import {LIFE_ASSET_RULES} from '../domains/life/b-catalog.ts';
import {LIFE_C_RULES} from '../domains/life/c-catalog.ts';
export type Journal=NonNullable<BehaviorDetails['journal']>;
/** Names are read from the frozen source catalog, quantities/money from committed source/effects, never current holdings or balances. */
export async function lifeJournal(ctx:RuntimeReadContext,v:LifeActivity):Promise<Journal>{const r=v.result!,items:Journal['items']=[],catalog=v.catalogRevision===3?LIFE_C_RULES:LIFE_ASSET_RULES;
 const add=(itemId:string,quantity:number,role:Journal['items'][number]['role'])=>{const item=catalog.items.find(x=>x.id===itemId);if(item&&quantity>0)items.push({itemId,name:item.name,quantity,role});};let moneyDelta:number|null=null;
 if(v.trade){const effect=await ctx.repository(LIFE_COMMERCE_REPOSITORY).getEffect(v.trade.side==='buy'?'buy':'sell',v.id);if(effect){moneyDelta=effect.moneyDelta;if(v.trade.side==='buy')add(v.trade.itemId,effect.itemIds.length,'bought');else for(const line of v.trade.lines)add(line.itemId,1,'sold');}}
 if(v.cTrade){const e=await ctx.repository(LIFE_C_COMMERCE_REPOSITORY).getEffect('c.buy',v.id);if(e){moneyDelta=e.moneyDelta;add(v.cTrade.itemId,e.createdItemIds.length,'bought');}}
 if(v.cSource){const e=v.actionId==='visit.place'?undefined:await ctx.repository(LIFE_C_COMMERCE_REPOSITORY).getEffect('c.activity.settle',v.id);if(e){moneyDelta=e.moneyDelta;if(v.cSource.itemId){add(v.cSource.itemId,e.consumedItemIds.length,'consumed');add(v.cSource.itemId,e.releasedItemIds.length,'released');}if(v.actionId==='meal.prepare')add('grilled_fish',e.createdItemIds.length,'created');}}
 for(const caught of r.fishing?.catches??[])add(caught.itemId,1,'caught');
 const grouped=items.reduce<Journal['items']>((all,item)=>{const old=all.find(x=>x.itemId===item.itemId&&x.role===item.role);if(old)old.quantity+=item.quantity;else all.push({...item});return all;},[]);
 return {items:grouped,moneyDelta,energySpent:r.energySpent||null,energyRestored:r.energyRestored||null,quotaRefunded:r.quotaRefunded,stopCode:v.state==='completed'?null:r.code};
}
