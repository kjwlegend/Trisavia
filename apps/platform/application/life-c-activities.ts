import type {RuntimeReadContext,RuntimeTransaction} from '../contracts/runtime-store.ts';
import {fail,object,version} from '../domains/common/errors.ts';
import {identifier} from '../domains/interaction/rules.ts';
import {LIFE_C_COMMERCE_REPOSITORY} from '../domains/life-assets/c-repository.ts';
import {LIFE_C_OBSERVATION_REPOSITORY} from '../domains/life/c-repository.ts';
import {LIFE_C_RULES as C} from '../domains/life/c-catalog.ts';
import {lifeBook} from '../domains/life/c-books.ts';
import {cInteger,resolveLifeCQuote} from '../domains/life/c-rules.ts';
import type {LifeCActivitySnapshot,LifeCResult,LifeCTradeTerms,LifeConsumableId} from '../domains/life/c-types.ts';
import type {LifeActorRef,LifeActivity} from '../domains/life/types.ts';

export interface LifeCActivityTerms {source:LifeCActivitySnapshot;durationSeconds:number;energyGain:number;coinCost:number;consume:Partial<Record<LifeConsumableId,number>>}
/** Instance metadata and book content are source-owned reads on the current transaction. */
export async function lifeCActivityTerms(ctx:RuntimeReadContext,ref:LifeActorRef,action:string,placeId:string,raw:unknown):Promise<LifeCActivityTerms> {
 const p=object(raw??{},action==='book.read'?['bookId','bookVersion','itemInstanceId']:action==='rest.inn'?['maxSpend']:action==='visit.place'?[]:['itemInstanceId','maxSpend']);
 let itemInstanceId:string|null=null,itemId:string|null=null,book:LifeCActivitySnapshot['book']=null,durationSeconds=0,energyGain=0,coinCost=0;
 const maxSpend=p.maxSpend===undefined?0:cInteger(p.maxSpend),consume:LifeCActivityTerms['consume']={};
 if(action==='meal.prepare'||action==='meal.eat'||action==='book.read'&&p.itemInstanceId!==undefined){
  itemInstanceId=identifier(p.itemInstanceId,'itemInstanceId');const item=await ctx.repository(LIFE_C_COMMERCE_REPOSITORY).getItem(ref,itemInstanceId);
  if(!item||item.state!=='available')fail('life_item_unavailable',409,'Choose one of your currently available items');itemId=item.itemId;
 }
 if(action==='meal.prepare'){
  if(placeId!==C.services.mealPreparation.placeId||!['sardine','mackerel','sea_bass'].includes(itemId!))fail('life_action_not_supported',400,'Choose a specific owned fish at the tavern kitchen');
  durationSeconds=C.services.mealPreparation.durationSeconds;coinCost=C.services.mealPreparation.fee;consume[itemId as LifeConsumableId]=1;
 }else if(action==='meal.eat'){
  if(!['harbor_tavern','garden_bench'].includes(placeId)||!['bread_meal','herbal_tea','grilled_fish'].includes(itemId!))fail('life_action_not_supported',400,'Choose a specific food at a published dining place');
  const item=C.items.find(i=>i.id===itemId)!;durationSeconds='durationSeconds'in item?item.durationSeconds:0;energyGain='energyGain'in item?item.energyGain:0;consume[itemId as LifeConsumableId]=1;
 }else if(action==='rest.inn'){
  if(placeId!==C.services.innRest.placeId)fail('life_action_not_supported',400,'Use the real inn rest place');durationSeconds=C.services.innRest.durationSeconds;energyGain=C.services.innRest.energyGain;coinCost=C.services.innRest.price;
 }else if(action==='book.read'){
  if(placeId!==C.services.reading.placeId)fail('life_action_not_supported',400,'Reading takes place at the library');const content=lifeBook(identifier(p.bookId,'bookId'));
  if(!content||version(p.bookVersion)!==content.version||content.bookId==='harbor_handbook'&&itemId!=='harbor_handbook'||content.bookId==='qingzhou_life_guide'&&itemInstanceId!==null)fail('life_book_unavailable',404,'Choose the current collection book or your owned handbook version');
  book={bookId:content.bookId,version:content.version,title:content.title,authorDisplay:content.authorDisplay,digest:content.digest,itemInstanceId};durationSeconds=C.services.reading.durationSeconds;
 }else if(action==='visit.place'){
  if(!['garden_bench','harbor_shore','harbor_pier','lookout'].includes(placeId))fail('life_action_not_supported',400,'Choose an enabled outdoor visit place');durationSeconds=C.services.visit.staySeconds;
 }else fail('life_action_not_supported',400,'Choose an enabled C activity');
 if(coinCost>maxSpend)fail('life_spend_limit',409,'The fixed service cost exceeds your explicit maximum');return {source:{itemInstanceId,itemId,maxSpend,book},durationSeconds,energyGain,coinCost,consume};
}
export function lifeCTradeTerms(action:string,placeId:string,raw:unknown,now:number):LifeCTradeTerms {
 const p=object(raw,['itemId','quantity','quoteRef','maxTotalPrice']);if(action!=='shop.buy')fail('life_offer_not_supported',400,'These facilities sell only the published food or book');
 const quote=resolveLifeCQuote(p.quoteRef,p.itemId,now);if(quote.placeId!==placeId)fail('life_action_not_supported',400,'Use the actual quoted shop place');const quantity=cInteger(p.quantity,1,20),maxTotalPrice=cInteger(p.maxTotalPrice),totalPrice=cInteger(quantity*quote.unitPrice,1);if(totalPrice>maxTotalPrice)fail('life_price_limit',409,'The actual purchase exceeds your explicit maximum');return {side:'buy',quote,itemId:quote.itemId,quantity,maxTotalPrice,totalPrice};
}
export async function lifeCResult(ctx:RuntimeReadContext,v:LifeActivity):Promise<LifeCResult> {
 let visit:LifeCResult['visit']=null;if(v.actionId==='visit.place'&&v.state==='completed'){const old=await ctx.repository(LIFE_C_OBSERVATION_REPOSITORY).getVisit({kind:v.actorKind,id:v.actorId},v.placeId);visit={first:!old,recorded:!old||v.endedAt!>=old.lastRecordedAt+C.services.visit.revisitRecordCooldownSeconds*1000};}
 return {effectId:null,moneyDelta:0,consumedItemIds:[],createdItemIds:[],releasedItemIds:[],book:v.cSource?.book??null,visit};
}
export async function settleLifeCActivity(ctx:RuntimeTransaction,v:LifeActivity) {
 if(!v.cSource)return;if(v.actionId!=='visit.place')await ctx.repository(LIFE_C_COMMERCE_REPOSITORY).settleActivity({actorRef:{kind:v.actorKind,id:v.actorId},activityId:v.id});
 if(v.state==='completed'&&v.actionId==='book.read')await ctx.repository(LIFE_C_OBSERVATION_REPOSITORY).recordReading(v.id);
 if(v.state==='completed'&&v.actionId==='visit.place')await ctx.repository(LIFE_C_OBSERVATION_REPOSITORY).recordVisit(v.id);
}
/** Terminal rows remain immutable. The view joins the unique atomic effect rather than rewriting a stored result. */
export async function lifeCResultView(ctx:RuntimeReadContext,v:LifeActivity):Promise<LifeCResult|null> {
 if(!v.cSource&&!v.cTrade||!v.result)return null;const base=v.result.c??await lifeCResult(ctx,v);
 if(v.actionId==='visit.place')return base;
 const effect=await ctx.repository(LIFE_C_COMMERCE_REPOSITORY).getEffect(v.cTrade?'c.buy':'c.activity.settle',v.id);if(!effect)fail('life_c_source_unavailable',503,'The original atomic C result is unavailable');
 return {...base,effectId:effect.id,moneyDelta:effect.moneyDelta,consumedItemIds:effect.consumedItemIds,createdItemIds:effect.createdItemIds,releasedItemIds:effect.releasedItemIds};
}
