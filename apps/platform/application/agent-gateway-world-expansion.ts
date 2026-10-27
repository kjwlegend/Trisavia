import type {JsonObject} from '../contracts/store.ts';
import type {GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {TOWN_EXPANSION_LAYOUT_URL} from '../domains/world/town-expansion-v1.ts';
const changed=new Set(['world.rules','world.map_manifest','world.public_rules','world.public_map_manifest']);
const point={type:'object',additionalProperties:false,properties:{x:{type:'integer'},y:{type:'integer'}},required:['x','y']};
/** Append a separately versioned exact expansion branch; previous schema/canonical factories are unchanged. */
export function townExpansionSchema(value:JsonObject):JsonObject {
 const walk=(v:any):any=>{
  if(Array.isArray(v))return v.map(walk);if(!v||typeof v!=='object')return v;
  if(v.properties?.layoutSha256&&v.properties?.geometryDigest&&v.properties?.layoutUrl){
   const current=structuredClone(v),p=current.properties;
   p.version={const:6};p.mapId={const:'pixel-town-v2'};p.layoutUrl={const:TOWN_EXPANSION_LAYOUT_URL};p.layoutId={const:'town-expansion-layout-v1'};
   p.walkingRegions={type:'array',minItems:3,maxItems:3,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',minLength:1,maxLength:100},name:{type:'string',minLength:1,maxLength:100},description:{type:'string',minLength:1,maxLength:500},roamTargets:{type:'array',minItems:4,maxItems:4,items:point}},required:['id','name','description','roamTargets']}};
   current.required=[...current.required,'layoutId','walkingRegions'];return {anyOf:[structuredClone(v),current]};
  }
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)]));
 };return walk(value);
}
export function withTownExpansionOperations(ops:GatewayOperation[]):GatewayOperation[]{return ops.map(o=>changed.has(o.id)?{...o,schemaVersion:o.schemaVersion+1,output:townExpansionSchema(o.output)}:o);}
export function withTownExpansionPublicReads(reads:GatewayPublicRead[]):GatewayPublicRead[]{return reads.map(o=>changed.has(o.id)?{...o,schemaVersion:o.schemaVersion+1,output:townExpansionSchema(o.output)}:o);}
