import {RuntimeError} from '../../contracts/runtime-store.ts';
import type {LifeTradeSource} from './types.ts';
import type {LifeCActivitySource,LifeCAssetCatalog,LifeCGiftSource,LifeCItemInstance,LifeCReservationTerms} from './c-types.ts';
function invalid(message:string):never{throw new RuntimeError('invalid_usage',message);}
export function boundedCInteger(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)invalid('Invalid bounded C asset integer');return v as number;}
export function validateLifeCAssetCatalog(c:LifeCAssetCatalog){
 if(c.revision!==3||c.ruleVersion!==1||c.currency!=='star_coin'||c.currencyScale!==0)invalid('The approved inactive C catalog3 is required');
 const ids=['basic_rod','bait','sardine','mackerel','sea_bass','bread_meal','herbal_tea','grilled_fish','harbor_handbook'];
 if(c.items.length!==9||new Set(c.items.map(x=>x.id)).size!==9||ids.some(id=>!c.items.some(x=>x.id===id)))invalid('The exact nine life items are required');
 for(const [id,price]of [['bread_meal',6],['herbal_tea',3],['harbor_handbook',10]] as const){const rows=c.items.filter(x=>x.id===id);if(rows.length!==1||rows[0]!.buyPrice!==price||rows[0]!.sellPrice!==null)invalid('C purchase rules differ from the approved catalog');}
 if(c.items.find(x=>x.id==='bread_meal')?.durationSeconds!==60||c.items.find(x=>x.id==='herbal_tea')?.durationSeconds!==30||c.items.find(x=>x.id==='grilled_fish')?.durationSeconds!==60)invalid('C food durations differ from the approved catalog');
 const p=c.services.mealPreparation,r=c.services.innRest;
 if(p.placeId!=='harbor_tavern'||p.fishUnits!==1||p.fee!==3||p.durationSeconds!==60||p.outputItemId!=='grilled_fish'||r.placeId!=='stone_inn'||r.price!==12||r.durationSeconds!==180)invalid('C preparation and lodging rules differ from the approved catalog');
}
function versioned(v:{catalogRevision:number;ruleVersion:number}) {if(v.catalogRevision!==3||v.ruleVersion!==1)invalid('A frozen C3 source is required');}
export function lifeCPurchaseTerms(s:LifeTradeSource,c:LifeCAssetCatalog){
 validateLifeCAssetCatalog(c);versioned(s);versioned(s.quote);
 if(s.actionId!=='shop.buy'||s.state!=='completed'||s.resultId!==s.id||!s.sourceEventId||!s.purchase||s.sale)invalid('Only a completed C purchase source is allowed');
 const p=s.purchase,item=c.items.find(x=>x.id===p.itemId),place=p.itemId==='harbor_handbook'?'blue_library':'harbor_tavern';
 if(!['bread_meal','herbal_tea','harbor_handbook'].includes(p.itemId)||s.placeId!==place||!item||item.buyPrice===null||s.quote.items.filter(x=>x.itemId===p.itemId&&x.unitPrice===item.buyPrice).length!==1)invalid('The exact C shop and quote must match');
 boundedCInteger(p.quantity,1,20);boundedCInteger(p.maxSpend);boundedCInteger(s.startedAt);boundedCInteger(s.endedAt,s.startedAt);boundedCInteger(s.quote.createdAt);boundedCInteger(s.quote.expiresAt,s.quote.createdAt+1,s.quote.createdAt+7200000);
 const cost=boundedCInteger(item.buyPrice*p.quantity,1);if(cost!==s.moneyAmount||cost>p.maxSpend||s.startedAt<s.quote.createdAt||s.startedAt>s.quote.expiresAt)invalid('The accepted C purchase total or quote expiry differs');return{itemId:p.itemId as 'bread_meal'|'herbal_tea'|'harbor_handbook',quantity:p.quantity,cost};
}
export function lifeCActivityTerms(s:LifeCActivitySource,item:LifeCItemInstance|undefined,c:LifeCAssetCatalog):LifeCReservationTerms{
 validateLifeCAssetCatalog(c);versioned(s);boundedCInteger(s.maxSpend);boundedCInteger(s.startedAt);boundedCInteger(s.scheduledEndAt,s.startedAt+1);
 if(s.itemInstanceId!==null&&(!item||item.id!==s.itemInstanceId||item.actorRef.kind!==s.actorKind||item.actorRef.id!==s.actorId))invalid('The specified C item must belong to the source actor');
 let money=0,durationMs=0,outputItemId:'grilled_fish'|null=null;
 if(s.actionId==='meal.prepare'){if(s.placeId!==c.services.mealPreparation.placeId||!item||!['sardine','mackerel','sea_bass'].includes(item.itemId))invalid('Preparation requires one explicitly selected owned fish');money=c.services.mealPreparation.fee;durationMs=c.services.mealPreparation.durationSeconds*1000;outputItemId='grilled_fish';}
 else if(s.actionId==='meal.eat'){if(!['harbor_tavern','garden_bench'].includes(s.placeId)||!item||!['bread_meal','herbal_tea','grilled_fish'].includes(item.itemId))invalid('Eating requires one explicitly selected owned food at a dining place');durationMs=c.items.find(x=>x.id===item.itemId)!.durationSeconds!*1000;}
 else if(s.actionId==='rest.inn'){if(s.placeId!==c.services.innRest.placeId||s.itemInstanceId!==null)invalid('Paid lodging uses coins rather than a legacy voucher');money=c.services.innRest.price;durationMs=c.services.innRest.durationSeconds*1000;}
 else invalid('Unsupported C activity');
 if(s.scheduledEndAt-s.startedAt!==durationMs||money>s.maxSpend)invalid('The frozen duration or spend ceiling differs');return{money,itemInstanceId:s.itemInstanceId,durationMs,outputItemId};
}
export function lifeCActivityOutcome(s:LifeCActivitySource){versioned(s);if(!['completed','cancelled','interrupted'].includes(s.state)||s.resultId!==s.id||!s.sourceEventId)invalid('C settlement requires its actual terminal result and event');boundedCInteger(s.endedAt,s.state==='completed'?s.scheduledEndAt:s.startedAt);return s.state==='completed'?'consume':'release';}
export function lifeCGiftTerms(s:LifeCGiftSource){
 versioned(s);if(!s.id||!s.fromAgentId||!s.toAgentId||s.fromAgentId===s.toAgentId||s.itemInstanceIds.length<1||s.itemInstanceIds.length>5||new Set(s.itemInstanceIds).size!==s.itemInstanceIds.length||s.itemInstanceIds.some(x=>typeof x!=='string'||!x.length||x.length>256))invalid('Use two distinct real Agents and 1 to 5 specific life item instances');
 boundedCInteger(s.createdAt);boundedCInteger(s.deadlineAt,s.createdAt+1,s.createdAt+86400000);if(s.deadlineAt-s.createdAt!==86400000)invalid('The gift retains its exact 24-hour expiry');
 return{from:s.fromAgentId,to:s.toAgentId,itemIds:[...s.itemInstanceIds]};
}
export function lifeCGiftOutcome(s:LifeCGiftSource){
 lifeCGiftTerms(s);if(s.state==='pending'||!s.sourceEventId)invalid('A pending gift has no accepted delivery');boundedCInteger(s.resolvedAt,s.createdAt);
 if(s.state==='accepted'){if(s.acceptedByAgentId!==s.toAgentId||s.resolvedAt!>=s.deadlineAt)invalid('Only the actual recipient accepted before the deadline may receive the gift');return 'transfer';}
 if(!['declined','withdrawn','expired','unavailable'].includes(s.state)||s.acceptedByAgentId!==null)invalid('The released gift terminal source differs');if(s.state==='expired'&&s.resolvedAt!<s.deadlineAt)invalid('The gift has not actually expired');return 'release';
}
