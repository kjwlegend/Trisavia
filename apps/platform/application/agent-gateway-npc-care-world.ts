import type {JsonObject} from '../contracts/store.ts';
import type {GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {npcLifeSchemas} from './agent-gateway-npc-life.ts';

const changed=new Set(['world.scene','world.npcs','world.public_scene','world.public_npcs']);
/** Separate current documents; never change the frozen World21 scene/NPC schemas. */
export function npcCareWorldSchema(source:JsonObject):JsonObject{
 const walk=(value:any):any=>{
  if(Array.isArray(value))return value.map(walk);if(!value||typeof value!=='object')return value;
  const next=Object.fromEntries(Object.entries(value).map(([key,v])=>[key,walk(v)])),p=next.properties;
  if(p?.actionId?.enum&&p?.startedAt&&p?.scheduledEndAt)p.actionId={enum:[...p.actionId.enum,'care.perform']};
  if(p?.npcId&&p?.appearance){
   const old=structuredClone(next),current=structuredClone(next);old.properties.npcId={...old.properties.npcId,not:{const:'npc-gardener'}};
   current.properties.npcId={const:'npc-gardener'};current.properties.appearance=structuredClone((npcLifeSchemas.npc.properties as JsonObject).appearance);current.properties.actorKind={const:'npc'};current.properties.actions={type:'array',minItems:1,maxItems:1,items:{const:'life.plans.submit'}};current.properties.serviceIds={type:'array',maxItems:0,items:{}};
   if(!current.required.includes('actorKind'))current.required.push('actorKind');
   return{anyOf:[old,current]};
  }
  return next;
 };return walk(source);
}
export function withNpcCareWorldOperations(ops:GatewayOperation[]):GatewayOperation[]{return ops.map(o=>changed.has(o.id)?{...o,schemaVersion:o.schemaVersion+1,output:npcCareWorldSchema(o.output)}:o);}
export function withNpcCareWorldReads(reads:GatewayPublicRead[]):GatewayPublicRead[]{return reads.map(r=>changed.has(r.id)?{...r,schemaVersion:r.schemaVersion+1,output:npcCareWorldSchema(r.output)}:r);}
