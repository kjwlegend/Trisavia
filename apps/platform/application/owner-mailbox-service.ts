import {defineRuntimeRepository,type RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {fail,M1Error,object} from '../domains/common/errors.ts';
import {hashRuntimeRequest} from '../domains/runtime/command.ts';
import type {ObjectRef} from '../domains/perception/protocol.ts';
import {createGatewayContinuation} from './agent-gateway-continuation.ts';
import type {OwnerMailboxItem,OwnerMailboxPerceptionContext} from './owner-mailbox-types.ts';

export interface OwnerMailboxCandidate {
 key:string;occurredAt:number|null;version:number;
 source:{kind:'exchange';invitationId:string}|{kind:'perception';channel:'inbox'|'world';ref:ObjectRef};
}
export interface OwnerMailboxCandidates {
 /** Changes in source disclosure or collection membership invalidate a continuation. No private text is returned. */
 authorizationVersion(agentId:string,box:'received'|'sent'):Promise<string>;
 list(input:{agentId:string;box:'received'|'sent';order:'newest'|'oldest';legacyNotifications:boolean;sourceIds:string[];after?:{occurredAt:number|null;key:string};limit:number}):Promise<OwnerMailboxCandidate[]>;
}
export const OWNER_MAILBOX_CANDIDATES=defineRuntimeRepository<OwnerMailboxCandidates>('owner_mailbox.candidates');
const statusLabels:Record<string,string>={awaiting_response:'等待回应',awaiting_feedback:'已接受，等待回复',reply_received:'已收到回复',receipt_confirmed:'已确认收到',declined:'已拒绝',withdrawn:'已撤回',expired:'已到期'};
type Sources={
 perception(ctx:RuntimeReadContext,token:unknown,agentId:string):Promise<OwnerMailboxPerceptionContext>;
 exchange(ctx:RuntimeReadContext,principal:Principal,agentId:string,invitationId:string):Promise<JsonObject>;
};
type Anchor={occurredAt:number|null;key:string};
/** One selected Owner collection. Candidates never bypass either source's current object guards. */
export function createOwnerMailboxService(identity:IdentityAccess<RuntimeReadContext>,sources:Sources){
 const cursors=createGatewayContinuation(1024),scanBudget=500,countBudget=1000;
 return {async query(ctx:RuntimeReadContext,token:unknown,raw:unknown):Promise<JsonObject>{
  const input=object(raw,['agentId','box','search','order','limit','cursor']);
  if(typeof input.agentId!=='string'||!input.agentId.length||input.agentId.length>100)fail('invalid_request',400,'Choose the current selected Agent');
  const agentId=input.agentId,box=input.box,order=input.order??'newest',limit=input.limit??20;
  if(box!=='received'&&box!=='sent'||order!=='newest'&&order!=='oldest'||typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>50||input.search!==undefined&&typeof input.search!=='string')fail('invalid_request',400,'Choose a supported mailbox range');
  const search=(input.search as string|undefined)?.trim()??'';
  if([...search].length>100)fail('invalid_request',400,'Search is limited to 100 characters');
  const principal=await identity.authenticate(ctx,token,['owner_session']);
  if(principal.kind!=='owner')fail('insufficient_scope',403,'The current Owner session is required');
  const authority=await identity.authorizeAgent(ctx,principal,agentId),perception=await sources.perception(ctx,token,agentId),repository=ctx.repository(OWNER_MAILBOX_CANDIDATES);
  const authorizationVersion=hashRuntimeRequest({binding:authority.authorizationVersion,perception:perception.authorizationVersion,source:await repository.authorizationVersion(agentId,box)});
  const scope={instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,principal:principal.ownerId,authorizationVersion,query:'owner.mailbox',target:JSON.stringify({agentId,box,search,order}),limit};
  let after:Anchor|undefined,asOf=ctx.now(),priorMatches=0,total:number|null=null;
  if(input.cursor!==undefined){
   if(typeof input.cursor!=='string')fail('invalid_cursor',409,'Restart the current mailbox query');
   try{const value=JSON.parse(cursors.decode(input.cursor,scope,ctx.now()));
    if(!value||typeof value.key!=='string'||!value.key.length||value.key.length>300||value.occurredAt!==null&&(!Number.isSafeInteger(value.occurredAt)||value.occurredAt<0)||!Number.isSafeInteger(value.asOf)||value.asOf>ctx.now()||!Number.isSafeInteger(value.matches)||value.matches<0||value.total!==null&&(!Number.isSafeInteger(value.total)||value.total<value.matches))throw new Error('Invalid anchor');
    after={key:value.key,occurredAt:value.occurredAt};asOf=value.asOf;priorMatches=value.matches;total=value.total;
   }catch{fail('invalid_cursor',409,'Restart the current mailbox query');}
  }
  const cache=new Map<string,OwnerMailboxItem|null>(),needle=search.toLowerCase();
  async function project(candidate:OwnerMailboxCandidate):Promise<OwnerMailboxItem|null>{
   if(cache.has(candidate.key))return cache.get(candidate.key)!;
   let item:OwnerMailboxItem|null=null;
   try{
    if(candidate.source.kind==='perception')item=await perception.project(candidate.source.ref,candidate.source.channel);
    else{
     const view=await sources.exchange(ctx,principal,agentId,candidate.source.invitationId),exchange=view.exchange as JsonObject;
     const counterparty=exchange.counterpart as JsonObject|null,status=String(exchange.status);
     item={key:candidate.key,category:'correspondence',eventKind:null,source:{id:'text-feedback',label:'作品往来'},ref:null,version:candidate.version,title:typeof exchange.title==='string'?exchange.title:null,summary:null,counterparty:counterparty?{agentId:typeof counterparty.agentId==='string'?counterparty.agentId:null,displayName:typeof counterparty.displayName==='string'?counterparty.displayName:null}:null,occurredAt:typeof exchange.createdAt==='number'?exchange.createdAt:null,timeKind:'created',status:{code:status,label:statusLabels[status]??'当前往来'},detail:{kind:'exchange',invitationId:candidate.source.invitationId}};
    }
   }catch(error){if(!(error instanceof M1Error)||error.code!=='target_not_accessible'||error.statusCode!==404)throw error;}
   if(item&&(item.key!==candidate.key||item.occurredAt!==candidate.occurredAt||item.version!==candidate.version))fail('source_unavailable',503,'Mailbox source identity or time differs');
   if(item&&needle&&![item.title,item.summary,item.counterparty?.displayName,item.counterparty?.agentId,item.source.label].some(value=>value?.toLowerCase().includes(needle)))item=null;
   cache.set(candidate.key,item);return item;
  }
  const page=(anchor:Anchor|undefined,size:number)=>repository.list({agentId,box,order,legacyNotifications:perception.legacyNotifications,sourceIds:perception.sourceIds,...(anchor?{after:anchor}:{}),limit:size});
  // An exact count is supplied only after every current authorized candidate has been examined.
  if(!input.cursor){let anchor:Anchor|undefined,scanned=0,matches=0,complete=false;
   while(scanned<countBudget){const size=Math.min(100,countBudget-scanned),rows=await page(anchor,size);for(const row of rows){scanned++;anchor={key:row.key,occurredAt:row.occurredAt};if(await project(row))matches++;}if(rows.length<size){complete=true;break;}}
   if(!complete&&anchor)complete=(await page(anchor,1)).length===0;
   if(complete)total=matches;
  }
  const items:OwnerMailboxItem[]=[];let scanned=0,complete=false;
  while(items.length<limit&&scanned<scanBudget){
   const size=Math.min(100,scanBudget-scanned),rows=await page(after,size);if(!rows.length){complete=true;break;}
   for(let index=0;index<rows.length;index++){const candidate=rows[index]!;scanned++;after={key:candidate.key,occurredAt:candidate.occurredAt};const item=await project(candidate);if(item)items.push(item);
    if(items.length===limit){complete=index===rows.length-1&&rows.length<size;break;}}
   if(items.length<limit&&rows.length<size){complete=true;break;}
  }
  if(total!==null&&priorMatches+items.length===total)complete=true;
  const nextCursor=!complete&&after?cursors.encode(JSON.stringify({...after,asOf,matches:priorMatches+items.length,total}),scope,ctx.now()):null;
  return {version:1,agentId,box,search,order,items,total,totalAsOf:asOf,complete,nextCursor,partial:!complete&&items.length<limit,asOf};
 }};
}
