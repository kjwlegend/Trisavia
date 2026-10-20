import type { JsonObject, JsonValue } from '../../contracts/store.ts';
import { fail, object, text } from '../common/errors.ts';
import { payloadHash } from '../access/credentials.ts';
export const CATEGORIES = [
  { categoryId:'notifications',channel:'inbox',sourceIds:['direct-mail'],scopeKinds:['world'],metrics:[{metricId:'unconfirmed',unit:'unconfirmed_current_messages',description:'本人当前正文可读且尚未明确确认取得的消息版本；不可读元数据不计入',sourceIds:['direct-mail']}] },
  { categoryId:'people',channel:'world',sourceIds:['profiles-public'],scopeKinds:['world'],metrics:[{metricId:'humans',unit:'public_humans',description:'公开人类；未启用，私有主人不是公开人类',sourceIds:[]},{metricId:'agents',unit:'public_agents',description:'公开Agent，不代表在线',sourceIds:['profiles-public']}] },
  { categoryId:'items',channel:'world',sourceIds:['demo-items'],scopeKinds:['world'],metrics:[{metricId:'all',unit:'items',description:'明确标识的作品和道具内容记录，不代表经济资产',sourceIds:['demo-items']}] },
  { categoryId:'holdings',channel:'inventory',sourceIds:['holdings'],scopeKinds:['world'],metrics:[{metricId:'held',unit:'holding_records',description:'本人获准的示例持有记录，不授交易权',sourceIds:['holdings']}] },
  { categoryId:'announcements',channel:'world',sourceIds:['demo-announcements'],scopeKinds:['world'],metrics:[{metricId:'all',unit:'announcements',description:'明确标识的演示公告',sourceIds:['demo-announcements']}] },
  { categoryId:'events',channel:'world',sourceIds:['demo-events','platform-publications'],scopeKinds:['world'],metrics:[{metricId:'plans',unit:'planned_events',description:'计划记录，不代表已经发生',sourceIds:['demo-events']},{metricId:'occurrences',unit:'occurred_events',description:'发生记录：演示剧情与真实管理员内容发布逐项区分；均不代表Agent行为',sourceIds:['demo-events','platform-publications']}] },
  { categoryId:'places',channel:'world',sourceIds:['demo-places'],scopeKinds:['world'],metrics:[{metricId:'all',unit:'places',description:'示例场所说明，不是实时位置或产权',sourceIds:['demo-places']}] },
  { categoryId:'messages',channel:'inbox',sourceIds:['direct-messages'],scopeKinds:['world'],metrics:[{metricId:'all',unit:'received_messages',description:'本人当前有效收件关系；与旧平台通知及其未确认数分开',sourceIds:['direct-messages']}] },
  { categoryId:'rules',channel:'world',sourceIds:['world-meta'],scopeKinds:['world'],metrics:[{metricId:'all',unit:'rules',description:'当前世界说明规则',sourceIds:['world-meta']}] },
] as const;
export const TYPE_DEFINITIONS = [
  {moduleId:'world',type:'world.rules@1',prefix:'world.rules'}, {moduleId:'profiles',type:'profiles.agent@1',prefix:'profiles.agent'},
  {moduleId:'items',type:'items.item@1',prefix:'items.item'}, {moduleId:'inventory',type:'inventory.holding@1',prefix:'inventory.holding'},
  {moduleId:'mailbox',type:'mailbox.direct-message@1',prefix:'mailbox.direct-message'},
  {moduleId:'mailbox',type:'mailbox.message@1',prefix:'mailbox.message'}, {moduleId:'world',type:'world.announcement@1',prefix:'world.announcement'},
  {moduleId:'world',type:'world.place@1',prefix:'world.place'}, {moduleId:'world',type:'world.plan@1',prefix:'world.plan'}, {moduleId:'world',type:'world.occurrence@1',prefix:'world.occurrence'},
];
export const OPERATIONS = [
  {id:'discovery',action:'perceptionDiscovery',method:'GET',path:'/v1/perception/discovery'},
  {id:'schema',action:'perceptionSchema',method:'GET',path:'/v1/perception/schemas/:schemaId'},
  {id:'guide',action:'perceptionGuide',method:'GET',path:'/v1/perception/guides/:moduleId'},
  {id:'wallet-query',action:'walletQuery',method:'POST',path:'/v1/wallet/query'},
  {id:'overview',action:'perceptionOverview',method:'POST',path:'/v1/perception/overview'},
  {id:'list',action:'perceptionList',method:'POST',path:'/v1/perception/list'},
  {id:'detail',action:'perceptionDetail',method:'POST',path:'/v1/perception/detail'},
  {id:'agent-read-state-query',action:'queryAgentRead',method:'POST',path:'/v1/perception/agent-read-state/query'},
  {id:'agent-read-state-confirm',action:'confirmAgentRead',method:'PUT',path:'/v1/perception/agent-read-state'},
  {id:'activity-query',action:'perceptionActivity',method:'POST',path:'/v1/perception/activity/query'},
] as const;
export type PerceptionAction = typeof OPERATIONS[number]['action'];
export interface ObjectRef extends JsonObject { moduleId:string; type:string; id:string }
export function ref(value:unknown):ObjectRef { const r=object(value,['moduleId','type','id']); return {moduleId:text(r.moduleId,'moduleId',1,64),type:text(r.type,'type',1,100),id:text(r.id,'id',1,180)}; }
export function key(value:unknown):string { return payloadHash(value); }
export function refId(value:ObjectRef):string { return key(value); }
export function plain(value:JsonValue|undefined):JsonObject { return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; }
export function bounded(value:unknown,fallback:number,max:number,field='limit'):number { if(value===undefined)return fallback; if(!Number.isSafeInteger(value)||(value as number)<1||(value as number)>max)fail('invalid_request',422,'Invalid bounded number',{field}); return value as number; }
export const RULES_REF:ObjectRef={moduleId:'world',type:'world.rules@1',id:'world-rules'};

/** Exact legacy serialization bytes are exposed so HTTP hosts need no locale implementation. */
export function canonicalDocument(value:unknown):string {
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([name,item])=>[name,canonical(item)])):value;
 return JSON.stringify(canonical(value));
}
