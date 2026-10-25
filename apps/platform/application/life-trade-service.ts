import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {LifeActorRef} from '../domains/life/types.ts';
import type {LifeTradeTerms,LifeFishId} from '../domains/life/b-types.ts';
import {LIFE_COMMERCE_REPOSITORY} from '../domains/life-assets/repository.ts';
import {LIFE_B_RULES as B} from '../domains/life/b-catalog.ts';
import {resolveLifeQuote} from '../domains/life/b-rules.ts';
import {fail,object} from '../domains/common/errors.ts';
import {identifier} from '../domains/interaction/rules.ts';
const amount=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)fail('invalid_request',400,'Choose a bounded integer quantity or coin limit');return v;};
/** Resolves only actual owned instances, never client-supplied fish metadata or prices. */
export async function lifeTradeTerms(ctx:RuntimeReadContext,ref:LifeActorRef,action:string,raw:unknown):Promise<LifeTradeTerms>{
 if(action==='shop.buy'){
  const p=object(raw,['itemId','quantity','quoteRef','maxTotalPrice']);if(!['basic_rod','bait'].includes(String(p.itemId)))fail('life_offer_not_supported',400,'The shop sells only rods and bait');
  const itemId=p.itemId as 'basic_rod'|'bait',quantity=amount(p.quantity,1,B.shopQuantityMax),maxTotalPrice=amount(p.maxTotalPrice),quote=resolveLifeQuote(String(p.quoteRef),'buy',itemId,ctx.now()),totalPrice=quote.unitPrice*quantity;
  if(totalPrice>maxTotalPrice)fail('life_price_limit',409,'The selected quantity exceeds the explicit maximum price');return {side:'buy',itemId,quantity,maxTotalPrice,totalPrice,quote};
 }
 const p=object(raw,['itemInstanceIds','minTotalProceeds','quoteRef']);if(!Array.isArray(p.itemInstanceIds)||p.itemInstanceIds.length<1||p.itemInstanceIds.length>B.shopQuantityMax||new Set(p.itemInstanceIds).size!==p.itemInstanceIds.length)fail('invalid_request',400,'Select one to twenty distinct owned fish');
 const lines:Extract<LifeTradeTerms,{side:'sell'}>['lines']=[];for(const value of p.itemInstanceIds){const id=identifier(value,'itemInstanceId'),i=await ctx.repository(LIFE_COMMERCE_REPOSITORY).getItem(ref,id),definition=i&&B.shop.items.find(d=>d.id===i.itemId);if(!i||i.state!=='available'||!i.fish||definition?.sellPrice===null||definition?.sellPrice===undefined)fail('life_item_unavailable',409,'An owned available fish is required');lines.push({itemInstanceId:id,itemId:i.itemId as LifeFishId,unitPrice:definition.sellPrice});}
 const totalProceeds=lines.reduce((n,i)=>n+i.unitPrice,0),minTotalProceeds=amount(p.minTotalProceeds);if(totalProceeds<minTotalProceeds)fail('life_price_limit',409,'The actual proceeds are below the explicit minimum');
 const quote=p.quoteRef===undefined?null:resolveLifeQuote(String(p.quoteRef),'sell',lines[0]!.itemId,ctx.now());if(quote&&lines.some(l=>l.itemId!==quote.itemId))fail('life_quote_changed',409,'A single-item quote cannot authorize another fish kind');
 return {side:'sell',itemInstanceIds:lines.map(i=>i.itemInstanceId),lines,minTotalProceeds,totalProceeds,quote};
}
