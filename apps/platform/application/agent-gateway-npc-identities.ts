import type {JsonObject} from '../contracts/store.ts';
import type {GatewayGuide,GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {objectSchema as obj} from './agent-gateway-schema.ts';
import {npcCareWorldGuide} from './agent-gateway-npc-care-life.ts';
import {townCLifeGuide} from './agent-gateway-life-c-projections.ts';
import {npcLifeGatewayGuide} from './npc-life-guide.ts';
import {npcCareWorldSchema} from './agent-gateway-npc-care-world.ts';

export const NPC_IDENTITY_CHANGED_IDS=new Set(['world.scene','world.npcs','world.public_scene','world.public_npcs','town_services.npcs','town_services.service','town_services.public_npcs','town_services.public_service','npc_life.directory','npc_life.public_directory']);
export const npcIdentitySchema=obj({version:{const:1},ref:{type:'string',minLength:1,maxLength:160},name:{type:'string',minLength:1,maxLength:120},role:{type:'string',minLength:1,maxLength:120},story:{type:'string',minLength:1,maxLength:1200},digest:{type:'string',pattern:'^[a-f0-9]{64}$'}});
/** Only current public NPC objects gain the source-owned identity; frozen documents stay untouched. */
export function withNpcIdentitySchema(source:JsonObject):JsonObject{
 const walk=(value:any):any=>{
  if(Array.isArray(value))return value.map(walk);if(!value||typeof value!=='object')return value;
  const next=Object.fromEntries(Object.entries(value).map(([key,v])=>[key,walk(v)])) as any,p=next.properties;
  if(p?.npcId&&p?.name&&p?.role)p.identity=structuredClone(npcIdentitySchema);
  return next;
 };return walk(source);
}
function currentOutput(id:string,source:JsonObject):JsonObject{
 // The live Town callback includes the already enabled gardener. Its one
 // reviewed sprite/plan action is distinct from the seven legacy appearances.
 const output=withNpcIdentitySchema(id.startsWith('town_services.')?npcCareWorldSchema(source):source);
 if(id==='town_services.npcs'||id==='town_services.public_npcs')((output.properties as JsonObject).npcs as JsonObject).maxItems=8;
 return output;
}
export const withNpcIdentityOperations=(operations:GatewayOperation[])=>operations.map(operation=>NPC_IDENTITY_CHANGED_IDS.has(operation.id)?{...operation,schemaVersion:operation.schemaVersion+1,output:currentOutput(operation.id,operation.output)}:operation);
export const withNpcIdentityReads=(reads:GatewayPublicRead[])=>reads.map(read=>NPC_IDENTITY_CHANGED_IDS.has(read.id)?{...read,schemaVersion:read.schemaVersion+1,output:currentOutput(read.id,read.output)}:read);
const description='Enabled NPC identities use one source-owned identity{version:1,ref,name,role,story,digest}. digest is SHA256 over the exact UTF-8 story. The same source supplies current name/role and optional public story on World, Town and NPC-life views; public NPC logs use the same source name without adding a story body. No source means no identity field or invented story. NPCs are independent server-managed actors, not Agent accounts. This adds no new service, private topic, future gameplay, position or permission.';
export const residentWorldGuide:GatewayGuide={...npcCareWorldGuide,version:23,document:{...npcCareWorldGuide.document,version:23,npcIdentity:description}};
export const residentTownGuide:GatewayGuide={...townCLifeGuide,version:7,document:{...townCLifeGuide.document,version:7,npcIdentity:description}};
export const residentNpcLifeGuide:GatewayGuide={...npcLifeGatewayGuide,version:2,document:{...npcLifeGatewayGuide.document,version:2,npcIdentity:description}};
