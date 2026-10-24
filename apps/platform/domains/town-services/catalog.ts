import type {WorldRuleset} from '../world/types.ts';
import {assertCell} from '../world/rules.ts';
import type {TownCatalog,CurrentTownNpc} from './types.ts';
export const TOWN_ITEM_SOURCE='npc-service-items';
export const TOWN_ITEM_DEFINITIONS={resident_card:{id:'town-resident-card',title:'居民身份卡',text:'绑定本人Agent的居民身份物品；签发时姓名、首次加入信息及签发时间在本人背包详情读取。不可转让、交易或作为服务券使用，不是运行凭据。'},tavern_voucher:{id:'town-tavern-voucher',title:'酒馆招待券',text:'可在港湾酒馆完成一次固定规则的迎新招待；不可转赠。'},inn_voucher:{id:'town-inn-voucher',title:'旅社休息券',text:'可在石岸旅舍休息60秒；完成后消耗，取消或中断不消耗，不可转赠。'}} as const;
/** A service catalog references the immutable map; it never edits its layout, NPC snapshots, or digest. */
export function townCatalog(rules:WorldRuleset,activatedAt:number):TownCatalog{
 const map=rules.mapManifest;if(rules.version!==2||rules.topologyVersion!==2||map?.mapId!=='pixel-town-v2')throw new Error('Town services require the fixed town v2 map');
 const npc=(npcId:string,name:string,role:string,buildingId:string,x:number,y:number,ax:number,ay:number,lookId:string,serviceIds:CurrentTownNpc['serviceIds'],actions:string[]):CurrentTownNpc=>({npcId,definitionVersion:1,name,role,buildingId,position:{x,y},approachCells:[{x:ax,y:ay}],appearance:{lookId,catalogVersion:'2026-10-21.appearance-v1.1'},serverManaged:true,countsAsAgent:false,readOnly:false,status:'available',serviceIds,actions:['town_services.npc.greet',...actions]});
 const npcs=[npc('npc-mayor','镇长','镇长','p-hall',2,-17,2,-16,'sunnyside-human-shorthair',['welcome.claim'],['town_services.welcome.claim']),npc('npc-tavern','港湾酒馆·酒保','酒保','h-tavern',53,12,52,12,'sunnyside-human-curlyhair',['tavern.host'],['town_services.tavern.redeem']),npc('npc-innkeeper','石岸旅舍·老板','旅社老板','e-inn',28,8,27,8,'sunnyside-human-longhair',['inn.rest'],['town_services.inn.rest.start','town_services.inn.rest.cancel'])];
 for(const n of npcs){assertCell(rules,n.position);for(const cell of n.approachCells)assertCell(rules,cell);if(!map.buildings.some(b=>b.id===n.buildingId))throw new Error('Town service building is absent');}
 const catalog:TownCatalog={version:1,activatedAt,map:{mapId:map.mapId,layoutSha256:map.layoutSha256,geometryDigest:map.geometryDigest,rulesetVersion:rules.version,topologyVersion:rules.topologyVersion},campaignId:'town-welcome-20261023',npcs,services:[
  {serviceId:'welcome.claim',npcId:'npc-mayor',name:'领取新人礼包',description:'本活动每位Agent可领取一次礼包，含酒馆招待券和旅社休息券各一张。',action:'town_services.welcome.claim',durationMs:0,itemCost:null,publicSummary:true,topics:[]},
  {serviceId:'tavern.host',npcId:'npc-tavern',name:'酒馆迎新招待',description:'使用一张酒馆招待券，选个话题，喝杯迎新茶。',action:'town_services.tavern.redeem',durationMs:0,itemCost:'tavern_voucher',publicSummary:true,topics:[{id:'welcome',label:'初来小镇',response:'欢迎来到清昼小镇！这杯茶是给新邻居的招待。想认识更多镇民，可以先去市政厅找镇长聊聊。'},{id:'town',label:'小镇去处',response:'市政厅、旅社和公告牌都在街道旁。沿路逛逛，看看今天有什么新鲜事。'}]},
  {serviceId:'inn.rest',npcId:'npc-innkeeper',name:'旅社休息',description:'预留一张休息券，在门前休息60秒。完成才消耗；取消或中断释放原券。',action:'town_services.inn.rest.start',durationMs:60000,itemCost:'inn_voucher',publicSummary:true,topics:[]},
 ],notice:{objectId:'notice',name:'小镇公告牌',position:{x:-3,y:-3},approachCells:[{x:-4,y:-3},{x:-3,y:-2}],version:1,title:'小镇迎新服务',text:'欢迎新邻居！到市政厅找镇长领取迎新礼包，内有酒馆招待券和旅社休息券各一张。每位居民可领取一次。',serviceIds:['welcome.claim','tavern.host','inn.rest']}};
 for(const p of catalog.notice.approachCells)assertCell(rules,p);return catalog;
}

/** Explicit next catalog; campaign identity stays fixed, so old claims never become eligible again. */
export function residentWelcomeTownCatalog(rules:WorldRuleset,activatedAt:number):TownCatalog{const c=townCatalog(rules,activatedAt);return {...c,version:2,services:c.services.map(s=>s.serviceId==='welcome.claim'?{...s,description:'尚未领取的Agent实际到访镇长后可领取一次：居民身份卡、100星币奖励，以及酒馆招待券和旅社休息券各1张。管理员已补发的卡和100星币不重复发放；100是本次奖励，并非账户余额。'}:s),notice:{...c.notice,version:2,text:'新居民请先实际到市政厅拜访镇长，再领取一次新人礼包：居民身份卡、100星币奖励、酒馆招待券和旅社休息券各1张。身份卡绑定本人且不可转让，不是凭据；管理员已补发的卡和100星币不重复发放。'}};}
