import type {JsonObject} from '../contracts/store.ts';
import type {Principal} from '../domains/access/public.ts';
import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {array,boolean,nullable,nonnegative,objectSchema as obj,positive,string,timestamp} from './agent-gateway-schema.ts';

/** The real service owns authorization, activation and every state transition. This adapter only describes transport. */
export interface NpcLifeAccess {
 query(ctx:RuntimeReadContext,principal:Principal|null,operation:string,input:JsonObject):Promise<JsonObject>;
}
const hash:JsonObject={type:'string',pattern:'^[a-f0-9]{64}$'},point=obj({x:{type:'integer'},y:{type:'integer'}}),careKind:JsonObject={enum:['water','clear']};
const guideRef=obj({id:string,version:positive,digest:hash});
const motion=nullable(obj({segmentId:string,movementId:nullable(string),source:{enum:['explicit','idle']},from:point,to:point,startedAt:timestamp,arriveAt:timestamp,rulesetVersion:positive,topologyVersion:positive,status:{const:'committed'}}));
const sprite=obj({kind:{const:'npc_sprite'},version:{const:1},assetId:string,manifestUrl:{type:'string',pattern:'^/assets/',maxLength:500},digest:hash});
const npc=obj({npcId:{const:'npc-gardener'},version:positive,name:string,role:string,position:point,motion,appearance:sprite,present:boolean,busy:boolean});
const carePoint=obj({pointId:string,version:positive,careKind,name:string,placeId:string,cell:point,approachCells:array(point,16),available:boolean,reason:nullable(string),nextEligibleAt:nullable(timestamp),lastCareAt:nullable(timestamp),actorId:nullable(string),lastActivityId:nullable(string),guideRef},['pointId','version','careKind','name','placeId','cell','approachCells','available','reason','nextEligibleAt','lastCareAt','lastActivityId','guideRef']);
const introduction=obj({introductionId:string,version:positive,npcId:{const:'npc-gardener'},agentId:string,planId:string,careKind,pointId:string,pointVersion:positive,guideRef,createdAt:timestamp,expiresAt:timestamp,consumedByActivityId:nullable(string)});
const rules=obj({version:{const:1},durationMs:{const:120000},energyCost:{const:6},pointCooldownMs:{const:3600000},actorPointCooldownMs:{const:86400000},maxIntroductionLifetimeMs:{const:1800000}});
const directory=obj({worldId:{const:'default'},definitionVersion:{const:1},ruleVersion:{const:1},map:obj({mapId:{const:'pixel-town-v2'},rulesetVersion:{const:6},topologyVersion:{const:6},geometryDigest:hash}),spatialRef:obj({url:{type:'string',pattern:'^/assets/',maxLength:500},revision:positive,sha256:hash}),npcs:array(npc,1),carePoints:array(carePoint,2),guides:array(obj({...guideRef.properties as JsonObject,title:string,body:{type:'string',minLength:1,maxLength:8000}}),2),rules,asOf:timestamp});
const options=obj({agentId:string,definitionVersion:{const:1},energy:obj({available:nonnegative,required:{const:6}}),points:array(obj({pointId:string,version:positive,available:boolean,reason:nullable(string),nextEligibleAt:nullable(timestamp),introduction:nullable(introduction)}),2),asOf:timestamp});
const inputs:Record<string,JsonObject>={
 'npc_life.directory':obj({}),
 'npc_life.care.options':obj({agentId:string},[]),
};
export const npcLifeSchemas={inputs,directory,options,introduction,carePoint,npc};
export function npcLifeGatewayOperations(service:NpcLifeAccess):GatewayOperation[]{return[
 {id:'npc_life.directory',moduleId:'npc_life',schemaVersion:1,kind:'query',actors:['agent','owner'],description:'Read only the activated NPC-life definition and current permitted public care facts; never advances or reserves.',input:inputs['npc_life.directory']!,output:directory,query:(ctx,p,input)=>service.query(ctx,p,'npc_life.directory',input)},
 {id:'npc_life.care.options',moduleId:'npc_life',schemaVersion:1,kind:'query',actors:['agent','owner'],description:'Preview only the acting Agent or selected currently bound Owner care eligibility and resources; no action is performed.',input:inputs['npc_life.care.options']!,output:options,query:(ctx,p,input)=>service.query(ctx,p,'npc_life.care.options',input)},
 ];}
export function npcLifePublicReads(service:NpcLifeAccess):GatewayPublicRead[]{return[{id:'npc_life.public_directory',moduleId:'npc_life',schemaVersion:1,path:'/v1/world/npc-life/directory',description:'Activated public NPC and care-point facts only, without private actor resources or introductions.',input:obj({}),output:directory,read:ctx=>service.query(ctx,null,'npc_life.directory',{})}];}
