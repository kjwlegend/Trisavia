import {ApiError} from '../common.js';
const bad=()=>{throw new ApiError('invalid_request',422);},id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,240}$/.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0;
const itemIds=['basic_rod','bait','sardine','mackerel','sea_bass','bread_meal','herbal_tea','grilled_fish','harbor_handbook'];
const bookIds=['qingzhou_life_guide','harbor_handbook'];
function keys(v,names){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!names.includes(k)))bad();}
function book(v){if(!bookIds.includes(v.bookId)||v.bookVersion!==1||v.itemInstanceId!==undefined&&!id(v.itemInstanceId))bad();}
export function lifeReadInput(operation,input,target){
 if(!['state','options','items','books.get'].includes(operation))throw new ApiError('insufficient_scope',403);keys(input,operation==='options'?['actionId','placeId','jobId','params']:operation==='items'?['afterId','limit','itemIds']:operation==='books.get'?['bookId','bookVersion','itemInstanceId']:[]);const fields={agentId:target};
 if(operation==='books.get'){book(input);Object.assign(fields,input);}
 if(operation==='items'){if(input.afterId!==undefined&&!id(input.afterId)||input.limit!==undefined&&(!integer(input.limit)||input.limit<1||input.limit>100)||input.itemIds!==undefined&&(!Array.isArray(input.itemIds)||!input.itemIds.length||input.itemIds.length>9||new Set(input.itemIds).size!==input.itemIds.length||input.itemIds.some(v=>!itemIds.includes(v))))bad();Object.assign(fields,input);}
 if(operation==='options'){
  if(!['work.shift','rest.bench','fish.session','shop.buy','shop.sell','meal.prepare','meal.eat','rest.inn','book.read','visit.place'].includes(input.actionId))bad();fields.actionId=input.actionId;for(const k of ['placeId','jobId'])if(input[k]!==undefined){if(!id(input[k]))bad();fields[k]=input[k];}
  if(input.params!==undefined){const p=input.params,names={'fish.session':['spotId','castCount','rodInstanceId'],'shop.buy':['itemId','quantity','quoteRef','maxTotalPrice'],'shop.sell':['itemInstanceIds','minTotalProceeds','quoteRef'],'meal.prepare':['itemInstanceId','maxSpend'],'meal.eat':['itemInstanceId','maxSpend'],'rest.inn':['maxSpend'],'book.read':['bookId','bookVersion','itemInstanceId'],'visit.place':[]}[input.actionId];if(!names)bad();keys(p,names);
   if(input.actionId==='fish.session'&&(!['shore_spot','pier_spot'].includes(p.spotId)||!integer(p.castCount)||p.castCount<1||p.castCount>5||!id(p.rodInstanceId))||input.actionId==='shop.buy'&&(!['basic_rod','bait','bread_meal','herbal_tea','harbor_handbook'].includes(p.itemId)||!integer(p.quantity)||p.quantity<1||p.quantity>20||!id(p.quoteRef)||!integer(p.maxTotalPrice))||input.actionId==='shop.sell'&&(!Array.isArray(p.itemInstanceIds)||!p.itemInstanceIds.length||p.itemInstanceIds.length>20||new Set(p.itemInstanceIds).size!==p.itemInstanceIds.length||p.itemInstanceIds.some(v=>!id(v))||!integer(p.minTotalProceeds)||p.quoteRef!==undefined&&!id(p.quoteRef))||['meal.prepare','meal.eat'].includes(input.actionId)&&!id(p.itemInstanceId)||p.maxSpend!==undefined&&!integer(p.maxSpend))bad();if(input.actionId==='book.read')book(p);fields.params=structuredClone(p);
  }
 }
 return fields;
}
export function giftReadInput(operation,input,target){if(!['get','inbox'].includes(operation))throw new ApiError('insufficient_scope',403);keys(input,operation==='get'?['giftId']:['direction','cursor','limit']);if(operation==='get'?!id(input.giftId):!['sent','received'].includes(input.direction)||input.limit!==undefined&&(!integer(input.limit)||input.limit<1||input.limit>100)||input.cursor!==undefined&&(typeof input.cursor!=='string'||!input.cursor||input.cursor.length>2048))bad();return{agentId:target,...input};}
