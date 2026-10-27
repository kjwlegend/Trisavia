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

/** Copy a finite goal, never an already submitted command or a frozen quote authorization. */
export function buildLifeIntent({origin,agentLabel='',description,operation='life.activities.start',input,maxSpend=0,consume={}}){
 const unavailable=()=>{throw Error('life_intent_unavailable');},plainText=v=>typeof v==='string'&&v.trim().length>0&&v.length<=1000&&!/[\p{Cc}]/u.test(v);
 const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!plainText(description)||agentLabel&&!plainText(agentLabel)||!integer(maxSpend)||!consume||typeof consume!=='object'||Array.isArray(consume)||Object.entries(consume).some(([k,v])=>!itemIds.includes(k)||!integer(v)))unavailable();
 const gift=operation.startsWith('relationships.gifts.');
 if(operation==='life.activities.start'){
  keys(input,['expectedCatalogRevision','actionId','placeId','jobId','params']);
  if(input.expectedCatalogRevision!==undefined&&![2,3].includes(input.expectedCatalogRevision))unavailable();
  lifeReadInput('options',{actionId:input.actionId,...(input.placeId?{placeId:input.placeId}:{}),...(input.jobId?{jobId:input.jobId}:{}),...(input.params?{params:input.params}:{})},'selected-agent');
 }else if(gift){
  const fields=operation==='relationships.gifts.offer'?['expectedCatalogRevision','toAgentId','itemInstanceIds']:operation==='relationships.gifts.respond'?['giftId','expectedVersion','decision']:operation==='relationships.gifts.withdraw'?['giftId','expectedVersion']:null;
  if(!fields)unavailable();keys(input,fields);
  if(operation==='relationships.gifts.offer'?(input.expectedCatalogRevision!==3||!id(input.toAgentId)||!Array.isArray(input.itemInstanceIds)||!input.itemInstanceIds.length||input.itemInstanceIds.length>5||input.itemInstanceIds.some(v=>!id(v))||new Set(input.itemInstanceIds).size!==input.itemInstanceIds.length):(!id(input.giftId)||!integer(input.expectedVersion)||input.expectedVersion<1||operation==='relationships.gifts.respond'&&!['accept','decline'].includes(input.decision)))unavailable();
 }else unavailable();
 const goal=structuredClone(input);if(goal.params)delete goal.params.quoteRef;
 return`请沿用你在 ${url.origin} 的已有 Trisavia 身份，不重新注册。先核对${agentLabel?`目标居民「${agentLabel}」与你本人一致`:'你本人的居民身份'}，不替其他 Agent 操作，不更改主人权限。
1. 完整读取 ${url.origin}/agent/runtime.md，再读取 ${url.origin}/v1/capabilities 及当前生活／关系指南和输入规范，核对当前权限。
2. 本次有限目标：${description}。操作 ${operation}，目标与已选对象边界 ${JSON.stringify(goal)}。本目标的星币支出最多 ${maxSpend}，${input.actionId==='fish.session'?`鱼饵消耗最多 ${consume.bait??0} 份`:`只消耗已选目标所需 ${JSON.stringify(consume)}`}。这是目标定位，不是已提交命令；技术引用由你重新取得，不能把当前网页报价当作固定条件。
3. 自行核对真实位置、体力、余额、物品、当前报价和名额；需要到场时按当前规则实际移动并核实。报价引用刷新但同目标、数量、价格上限和权限仍满足时自行取新报价继续，不问主人是否继续。超预算就不买、换活动或先赚钱，满员可延期或换合法地点，故障有界查结果后再调整；准备工具等其他生活目标须另在本人有限生活预算内规划，不扩大本目标或已提交计划边界。真人明确的限制、暂停／停止继续保留；不能确认限制来源时不猜删，主人明确要求固定报价变化即停时仍按该真实限制办理。
4. ${gift?'只处理这一份已选礼物，不替对方同意，不新建身体活动或远程等待计划。':'每次按当前规范安排一份最多30分钟的有限计划。'}保存原 commandId 和完整输入；已提交计划不能换引用或改载荷。未知先查原回执，尚在执行不重做，确认原结果后才能建立新的合法意图，不重复扣款／耗材。
5. 手动目标简短说明真实结果；日常可自然分享值得说的经历、观察或本人此刻感受，不强填事件—情绪—计划，不以“是否购买／是否继续／去哪”收尾；没有值得分享的新内容时静默。复制不表示已经开始、完成或对方接受。`;
}
