import type {JsonObject} from '../contracts/store.ts';
import type {GatewayGuide,GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {array,nullable,nonnegative,objectSchema as obj,positive,string,timestamp} from './agent-gateway-schema.ts';
import {withAutonomousLifeOperations,withAutonomousLifeReads,currentActionProjection} from './agent-gateway-autonomous-life.ts';
import {autonomousLifeGuide,autonomousWorldGuide} from './agent-autonomous-life-guide.ts';
import {npcLifeSchemas} from './agent-gateway-npc-life.ts';
import {fail} from '../domains/common/errors.ts';

const properties=(s:JsonObject)=>s.properties as JsonObject,hash:JsonObject={type:'string',pattern:'^[a-f0-9]{64}$'},kind:JsonObject={enum:['water','clear']},guideRef=obj({id:string,version:positive,digest:hash});
const careSnapshot=obj({definitionVersion:{const:1},pointId:string,pointVersion:positive,careKind:kind,introductionId:string,guideRef});
const careResult=obj({pointId:string,careKind:kind,completed:{type:'boolean'},pointVersion:nullable(positive),lastCareAt:nullable(timestamp),nextEligibleAt:nullable(timestamp),message:obj({...npcLifeSchemas.message.properties as JsonObject,ref:{enum:['npc-life/system/water-done@1','npc-life/system/care-stopped@1']},speaker:{const:'system'},audience:{const:'participant'}})});
const introduceParams=obj({pointId:string,expectedPointVersion:positive,expectedNpcVersion:positive,expectedDefinitionVersion:{const:1}});
const performParams=obj({pointId:string,expectedPointVersion:positive,introductionFrom:obj({stepId:string,output:{const:'careIntroduction'}})});
const step=(actionId:string,params:JsonObject)=>obj({stepId:string,type:{const:'act'},actionId:{const:actionId},placeId:string,params});
export const NPC_CARE_CHANGED_LIFE_IDS=['life.actions','life.public_actions','life.state','life.activities.get','life.activities.cancel','life.plans.submit'] as const;
export const NPC_CARE_CHANGED_WORLD_IDS=['world.scene','world.npcs','world.public_scene','world.public_npcs'] as const;

function privateCareSchema(source:JsonObject):JsonObject{
 const walk=(value:any):any=>{if(Array.isArray(value))return value.map(walk);if(!value||typeof value!=='object')return value;const next=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v)])),p=next.properties;
  if(p?.actionId&&p?.scheduledEndAt&&p?.result){p.actionId={enum:[...p.actionId.enum,'care.introduce','care.perform']};p.care=careSnapshot;}
  if(p?.resultId&&p?.completedAt&&p?.energyBefore){p.care=careResult;p.careIntroduction=npcLifeSchemas.introduction;}
  return next;};return walk(source);
}
function actionsSchema(source:JsonObject):JsonObject{
 const next=structuredClone(source),p=properties(next),base=properties((p.actions as JsonObject).items as JsonObject);(base.guideRef as JsonObject).properties={moduleId:{const:'life'},version:{const:5}};base.resultSchemaRef=obj({operation:{const:'life.activities.get'},version:{const:4}});
 const action=(id:string,seconds:number,energy:number)=>obj({...base,actionId:{const:id},jobId:{type:'null'},durationSeconds:{const:seconds},costs:obj({star_coin:{const:0},energy:{const:energy}}),reward:obj({star_coin:{const:0},energy:{const:0}},[]),supportedActorKinds:{type:'array',minItems:1,maxItems:1,items:{const:'agent'}},inputSchemaRef:obj({operation:{const:'life.plans.submit'},version:{const:4}}),guideRef:obj({moduleId:{const:'npc_life'},version:{const:1}}),requiredItems:{type:'array',maxItems:0,items:{}},duration:obj({seconds:{const:seconds}})},((p.actions as JsonObject).items as JsonObject).required as string[]);
 (p.actions as JsonObject).items={anyOf:[(p.actions as JsonObject).items!,action('care.introduce',0,0),action('care.perform',120,6)]};
 p.npcLife=obj({definitionVersion:{const:1}});(next.required as string[]).push('npcLife');(p.places as JsonObject).maxItems=20;
 const stations=properties((p.places as JsonObject).items as JsonObject).stations as JsonObject,stationProps=properties(stations.items as JsonObject);stationProps.actionIds=array({enum:[...((stationProps.actionIds as JsonObject).items as JsonObject).enum as string[],'care.perform']},10);
 return next;
}
function projectActions(source:JsonObject):JsonObject{
 const marker=source.npcLife as JsonObject;if(!marker||marker.definitionVersion!==1||Object.keys(marker).length!==1||!Array.isArray(source.actions))fail('source_unavailable',503,'The active NPC-life definition is required');
 const base=(source.actions as JsonObject[]).filter(a=>!['care.introduce','care.perform'].includes(String(a.actionId))),care=(source.actions as JsonObject[]).filter(a=>['care.introduce','care.perform'].includes(String(a.actionId)));
 if(base.length!==18||care.length<2||care.length>4||new Set(care.map(a=>a.actionId+':'+a.placeId)).size!==care.length)fail('source_unavailable',503,'Only explicit enabled care definitions are available');
 const current=currentActionProjection({...source,actions:base}),converted=(current.actions as JsonObject[]).map(a=>({...a,guideRef:{moduleId:'life',version:5},resultSchemaRef:{operation:'life.activities.get',version:4}}));
 for(const row of care){const ref=row.guideRef as JsonObject;if(ref?.moduleId!=='npc_life'||ref.version!==1)fail('source_unavailable',503,'Exact NPC-life guidance is required');}
 return{...current,actions:[...converted,...care]};
}
/** The base descriptors are the unchanged C3 factories, before current4 projection executes. */
export function withNpcCareLifeOperations(operations:GatewayOperation[]):GatewayOperation[]{
 const legacy=withAutonomousLifeOperations(operations);return operations.map((operation,index)=>{
  if(operation.id==='life.actions')return{...operation,schemaVersion:5,output:actionsSchema(legacy[index]!.output),query:async(ctx,p,input)=>projectActions(await operation.query!(ctx,p,input))};
  if(!['life.state','life.activities.get','life.activities.cancel','life.plans.submit'].includes(operation.id))return operation;
  const input=structuredClone(operation.input);if(operation.id==='life.plans.submit'){const items=(properties(input).steps as JsonObject).items as JsonObject;(items.anyOf as JsonObject[]).push(step('care.introduce',introduceParams),step('care.perform',performParams));}
  return{...operation,schemaVersion:4,input,output:privateCareSchema(operation.output)};
 });
}
export function withNpcCareLifeReads(reads:GatewayPublicRead[]):GatewayPublicRead[]{const legacy=withAutonomousLifeReads(reads);return reads.map((read,index)=>read.id!=='life.public_actions'?read:{...read,schemaVersion:5,output:actionsSchema(legacy[index]!.output),read:async(ctx,input)=>projectActions(await read.read(ctx,input))});}
export const npcCareLifeGuide:GatewayGuide={...autonomousLifeGuide,version:5,document:{...autonomousLifeGuide.document,version:5,npcLife:{moduleId:'npc_life',version:1,instruction:'Only an explicitly activated definition adds care.introduce and care.perform. Read its exact guide, public directory and personal care.options. Submit one at-most-30-minute plan: actual reception arrival, instant same-plan introduction, actual care-point arrival, then care with params.introductionFrom referencing that preceding introduction step. No standalone start or transferred reference. Original C3 economy, existing scopes, limits, plans, receipts and unknown-result recovery stay authoritative.'}}};
export const npcCareWorldGuide:GatewayGuide={...autonomousWorldGuide,version:22,document:{...autonomousWorldGuide.document,version:22,npcLife:{moduleId:'npc_life',version:1,instruction:'Only activated NPC-life definitions add the separately sourced npc_sprite appearance and public care.perform activity. NPCs remain independent server actors, never registered Agents. Public activity keeps its existing small fact fields; no introduction, eligibility, energy, wallet or private topic is added. Ordinary NPC life stays out of the public world journal.'}}};
