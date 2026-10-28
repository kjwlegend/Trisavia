import type {JsonObject} from '../contracts/store.ts';
import type {BehaviorDetails,BehaviorRecord} from '../domains/behavior/types.ts';
import {validateBehaviorTemplateLeaf} from '../../web/public/hud/behavior-human-contract.js';
export type HumanBehaviorMode='world'|'recent'|'owner';
export type HumanPresentationCollector=Map<string,JsonObject>;
const fields=['title','result','summary'] as const;
const original=(reason:'insufficient-source'|'unsupported-template'='insufficient-source'):JsonObject=>({kind:'original',sourceLocale:'zh-CN',reason});
function template(base:string,field:string,params:JsonObject={}):JsonObject{
 const leaf:JsonObject={kind:'template',templateId:('behavior.'+base+'.'+field).replaceAll('_','-'),templateVersion:1,paramsSnapshot:params};
 try{const result=validateBehaviorTemplateLeaf(leaf);return result.known&&result.definition.field===field?leaf:original('unsupported-template');}catch{return original();}
}
const integer=(value:unknown):value is number=>Number.isSafeInteger(value);
const positive=(value:unknown):value is number=>integer(value)&&value>0;
const plain=(value:unknown,max=120):value is string=>typeof value==='string'&&value.length>0&&[...value].length<=max&&!/[\u0000-\u001f\u007f<>]/u.test(value);
const object=(value:unknown):JsonObject|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:null;
/** Only already selected fields and the same authorized source description enter this function. */
export function humanBehaviorPresentation(item:JsonObject,row:BehaviorRecord,described:BehaviorDetails|null,mode:HumanBehaviorMode,journalEnabled:boolean):JsonObject{
 const leaves:JsonObject={title:original(),action:template('action.'+row.node,'action'),result:original(),summary:item.details===null?null:original()};
 const apply=(base:string,params:JsonObject={})=>{for(const field of fields)if(field!=='summary'||item.details!==null)leaves[field]=template(base,field,params);};
 const finish=():JsonObject=>{
  const value:JsonObject={recordId:row.id,basis:'authorized-read-projection',sourceRefs:[{recordId:row.id}],fields:leaves};
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>8192)for(const field of ['title','action','result','summary'])if(leaves[field]!==null)leaves[field]=original();
  return value;
 };
 if(row.node==='life.journal.authored'){
  const authored=object(item.authored);leaves.title=authored?.title===null?template('authored.framework','title'):{kind:'verbatim'};leaves.action=template('authored.framework','action');leaves.result=template('authored.framework','result');return finish();
 }
 const detail=object(item.details),location=object(detail?.location),to=object(location?.to),place=plain(to?.name)?to.name:null;
 // This final world-only replacement must win over every private source branch.
 if(mode==='world'&&row.sourceDomain==='town_services'&&row.node==='town_services.service.completed'){apply('public.town-service.completed.'+(place?'place':'unlocated'),place?{place}:{});return finish();}
 if(!described||described.version!==1)return finish();
 const node=row.node,life=described.life,j=described.journal;
 if(mode!=='owner'&&journalEnabled&&node.startsWith('life.')){
  if(node==='life.care.completed'&&place)apply('public.life.care.completed',{place});
  else if(['life.work.completed','life.fishing.finished','life.meal.completed','life.rest.completed','life.reading.completed','life.visit.completed'].includes(node)){
   const actor=object(item.agent)?.displayName;if(place&&plain(actor,60))apply('public.'+node,{actorName:actor,place});
  }
  return finish();
 }
 if(node.startsWith('relationships.invitation.')||node.startsWith('interaction.')){
  for(const field of fields)if(field!=='summary'||item.details!==null)leaves[field]=template('static.'+node,field);return finish();
 }
 if(mode==='owner'&&described.gift&&j){
  const gift=described.gift,items=j.items.filter(i=>i.role===(gift.direction==='sent'?'sent':'received'));
  if(node==='relationships.gift.accepted'&&['sent','received'].includes(gift.direction)&&items.length){
   const participants=Array.isArray(detail?.participants)?detail.participants:[],other=participants.map(object).find(p=>p&&p.agentId!==row.agentId),name=plain(other?.displayName,60)?other.displayName:null;
   apply('owner.gift.accepted.'+gift.direction+(name?'.named':'.neutral'),{items:items.map(i=>({name:i.name,quantity:i.quantity,role:i.role})),...(name?{name}:{})});
  }else if(['relationships.gift.declined','relationships.gift.withdrawn','relationships.gift.expired','relationships.gift.unavailable'].includes(node)){
   const released=j.items.filter(i=>i.role==='released');apply('owner.gift.'+node.split('.').at(-1)+(released.length?'.released':'.no-release'),released.length?{items:released.map(i=>({name:i.name,quantity:i.quantity,role:i.role}))}:{});
  }
  return finish();
 }
 if(mode==='owner'&&life&&j&&place){
  const list=(role:string)=>j.items.filter(i=>i.role===role).map(i=>({name:i.name,quantity:i.quantity,role:i.role}));
  if((node==='life.purchase.completed'&&life.actionId==='shop.buy'||node==='life.sale.completed'&&life.actionId==='shop.sell')){
   const buy=node==='life.purchase.completed',items=list(buy?'bought':'sold'),amount=j.moneyDelta;
   if(amount===null||integer(amount)&&(buy?amount<0:amount>0))apply('owner.life.'+(buy?'purchase':'sale')+'.completed.'+(items.length?'named':'unnamed')+(amount===null?'.no-amount':'.amount'),{place,...(items.length?{items}:{}),...(amount===null?{}:{amount:buy?-amount:amount})});
  }else if(node==='life.work.completed'&&life.actionId==='work.shift'){
   const reward=life.coinReward,energy=j.energySpent;if((reward===null||integer(reward)&&reward>=0)&&(energy===null||integer(energy)&&energy>=0))apply('owner.life.work.completed.'+(positive(reward)?'reward':'no-reward')+(positive(energy)?'.energy':'.no-energy'),{place,...(positive(reward)?{amount:reward}:{}),...(positive(energy)?{energy}:{})});
  }else if(node==='life.rest.completed'&&['rest.bench','rest.inn','rest.voucher'].includes(life.actionId)){
   const amount=j.moneyDelta,energy=j.energyRestored;if((amount===null||integer(amount)&&amount<=0)&&(energy===null||integer(energy)&&energy>=0))apply('owner.life.rest.completed.'+(amount&&amount<0?'paid':'no-payment')+(positive(energy)?'.energy':'.no-energy'),{place,...(amount&&amount<0?{amount:-amount}:{}),...(positive(energy)?{energy}:{})});
  }else if(node==='life.care.introduced'&&life.actionId==='care.introduce')apply('owner.life.care.introduced',{place});
  else if(node==='life.care.completed'&&life.actionId==='care.perform'&&life.care?.completed===true){const energy=j.energySpent;if(energy===null||integer(energy)&&energy>=0)apply('owner.life.care.completed.'+(positive(energy)?'energy':'no-energy'),{place,...(positive(energy)?{energy}:{})});}
  else if(node==='life.meal.prepared'&&life.actionId==='meal.prepare'){
   const consumed=list('consumed'),created=list('created'),amount=j.moneyDelta;if(consumed.length&&created.length&&(amount===null||integer(amount)&&amount<=0))apply('owner.life.meal.prepared.'+(amount&&amount<0?'paid':'no-payment'),{place,consumed,created,...(amount&&amount<0?{amount:-amount}:{})});
  }else if(node==='life.meal.completed'&&life.actionId==='meal.eat'){
   const items=list('consumed'),energy=j.energyRestored;if(energy===null||integer(energy)&&energy>=0)apply('owner.life.meal.completed.'+(items.length?'named':'unnamed')+(positive(energy)?'.energy':'.no-energy'),{place,...(items.length?{items}:{}),...(positive(energy)?{energy}:{})});
  }else if(node==='life.reading.completed'&&life.actionId==='book.read'){
   const book=life.c?.book;if(book&&book.version>=1&&/^[a-f0-9]{64}$/.test(book.digest)&&plain(book.title,120))apply('owner.life.reading.completed.book',{place,bookTitle:book.title});else if(!book)apply('owner.life.reading.completed.generic',{place});
  }else if(node==='life.visit.completed'&&life.actionId==='visit.place'&&life.c?.visit?.recorded===true)apply('owner.life.visit.completed',{place});
  else if(node==='life.fishing.finished'&&life.actionId==='fish.session'){
   const f=life.fishing,items=list('caught');if(f&&integer(f.requestedCasts)&&f.requestedCasts>=1&&integer(f.completedCasts)&&f.completedCasts>=0&&f.completedCasts<=f.requestedCasts&&integer(f.noCatchCount)&&f.noCatchCount>=0&&f.noCatchCount<=f.completedCasts&&f.catches.length+f.noCatchCount===f.completedCasts&&((items.length&&items.reduce((sum,i)=>sum+i.quantity,0)===f.catches.length)||!items.length&&!f.catches.length))apply('owner.life.fishing.finished.'+(f.completedCasts<f.requestedCasts?'stopped':'completed')+(items.length?'.caught':'.empty'),{place,completed:f.completedCasts,requested:f.requestedCasts,noCatch:f.noCatchCount,...(items.length?{items}:{})});
  }else if(node==='life.activity.interrupted'){
   const caught=list('caught'),released=list('released'),energy=j.energySpent;if(energy===null||integer(energy)&&energy>=0)apply('owner.life.activity.interrupted.'+(caught.length?'caught':'no-catch')+(released.length?'.released':'.no-release')+(positive(energy)?'.energy':'.no-energy'),{place,...(caught.length?{caught}:{}),...(released.length?{released}:{}),...(positive(energy)?{energy}:{})});
  }
  return finish();
 }
 const service=object(detail?.service);
 if(service&&row.sourceRef.type!=='resident_gift'){
  if(node==='town_services.greeted'&&plain(service.npcName))apply('town.greeted',{npcName:service.npcName});
  else if(node==='town_services.service.started'&&service.serviceId==='inn.rest')apply('town.service.started.inn');
  else if(node==='town_services.service.cancelled'&&plain(service.serviceName))apply('town.service.cancelled',{serviceName:service.serviceName});
  else if(node==='town_services.service.completed'){
   if(service.serviceId==='welcome.claim'){if(described.resultCode==='facility_service_completed')apply('town.service.completed.welcome.facility');else if(described.resultCode==='service_completed')apply('town.service.completed.welcome.mayor');}
   else if(service.serviceId==='tavern.host')apply('town.service.completed.tavern');else if(service.serviceId==='inn.rest')apply('town.service.completed.inn');else if(plain(service.serviceName))apply('town.service.completed.generic',{serviceName:service.serviceName});
  }
 }
 return finish();
}
export function collectHumanBehaviorItem(collector:HumanPresentationCollector|undefined,item:JsonObject,row:BehaviorRecord,described:BehaviorDetails|null,mode:HumanBehaviorMode,journalEnabled:boolean):JsonObject{if(collector)collector.set(row.id,humanBehaviorPresentation(item,row,described,mode,journalEnabled));return item;}
export function humanBehaviorResult(data:JsonObject,collector:HumanPresentationCollector):JsonObject{
 const items=data.items as JsonObject[],presentations=items.map(item=>collector.get(String(item.id))??{recordId:item.id!,basis:'authorized-read-projection',sourceRefs:[{recordId:item.id!}],fields:{title:original(),action:original(),result:original(),summary:item.details===null?null:original()}});
 // Original pages already have a 60 KiB budget. Degrade only this new display
 // metadata if it approaches the independent 512 KiB human representation cap.
 if(Buffer.byteLength(JSON.stringify({originalData:data,presentations}),'utf8')>512*1024-2048)for(const value of presentations){const leaves=value.fields as JsonObject;for(const field of ['title','action','result','summary'])if(leaves[field]!==null&&object(leaves[field])?.kind!=='verbatim')leaves[field]=original();}
 return {originalData:data,presentations};
}
