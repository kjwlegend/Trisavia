import type {JsonObject} from '../contracts/store.ts';
import type {GatewayGuide,GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {WORLD_PARTICIPATION_CONTRACT} from '../domains/access/world-action-policy.ts';
import {fail} from '../domains/common/errors.ts';
import {PARTICIPATION_MODE_GUIDE,FROZEN_PARTICIPATION_HOST_GUIDE_V0130 as CURRENT_PARTICIPATION_HOST_GUIDE,FROZEN_PARTICIPATION_JOB_BOOTSTRAP_V0130 as CURRENT_PARTICIPATION_JOB_BOOTSTRAP,CURRENT_PARTICIPATION_MIGRATION_GUIDE,PARTICIPATION_LIFE_AUTHORIZATION,PARTICIPATION_LIFE_INTENT_OPENING} from './agent-participation-guide.ts';

const modules=new Set(['world','life','interaction','decision','relationships']);
/** Clone only final served documents. Every predecessor remains an exact retained object. */
export function manualParticipationGuide(previous:GatewayGuide):GatewayGuide {
 if(!modules.has(previous.moduleId))return previous;
 const document=structuredClone(previous.document),version=previous.version+1;
 document.version=version;document.participationPolicy=structuredClone(WORLD_PARTICIPATION_CONTRACT);
 if(document.autonomousParticipation&&typeof document.autonomousParticipation==='object'&&!Array.isArray(document.autonomousParticipation))document.autonomousParticipation={...document.autonomousParticipation,instruction:PARTICIPATION_MODE_GUIDE,modes:[...WORLD_PARTICIPATION_CONTRACT.modes],contractVersion:2};
 else document.autonomousParticipation=PARTICIPATION_MODE_GUIDE;
 if(previous.moduleId==='world'){
  document.hostParticipation=CURRENT_PARTICIPATION_HOST_GUIDE;
  document.runtimeRules=CURRENT_PARTICIPATION_MIGRATION_GUIDE;
  const life=document.life as JsonObject|undefined;
  if(life&&typeof life.autonomousParticipation==='string')life.autonomousParticipation=life.autonomousParticipation.replace('主人已把世界内日常生活交给Agent处理。',PARTICIPATION_LIFE_INTENT_OPENING);
 }
 if(previous.moduleId==='life'){
  document.authorization=PARTICIPATION_LIFE_AUTHORIZATION;
  if(typeof document.intent==='string')document.intent=document.intent.replace('主人已把世界内日常生活交给Agent处理。',PARTICIPATION_LIFE_INTENT_OPENING);
  document.recurringBootstrap=CURRENT_PARTICIPATION_JOB_BOOTSTRAP;
 }
 return {moduleId:previous.moduleId,version,document};
}

function lifeSchema(source:JsonObject,previous:number,next:number):JsonObject {
 const walk=(value:any):any=>{if(Array.isArray(value))return value.map(walk);if(!value||typeof value!=='object')return value;const result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,walk(item)])) as any;
  if(result.properties?.moduleId?.const==='life'&&result.properties?.version?.const===previous)result.properties.version={const:next};return result;};
 return walk(source);
}
function lifeActions(source:JsonObject,previous:number,next:number):JsonObject {
 if(!Array.isArray(source.actions))fail('source_unavailable',503,'The current Life action directory is unavailable');
 return {...source,actions:source.actions.map(value=>{const row=value as JsonObject,ref=row.guideRef as JsonObject;
  if(ref?.moduleId!=='life')return row;
  if(ref.version!==previous)fail('source_unavailable',503,'The current Life action guide version changed');
  return {...row,guideRef:{...ref,version:next}};
 })};
}
export function manualParticipationLifeOperations(operations:GatewayOperation[],previous:number):GatewayOperation[]{return operations.map(operation=>operation.id!=='life.actions'?operation:{...operation,schemaVersion:operation.schemaVersion+1,output:lifeSchema(operation.output,previous,previous+1),query:async(ctx,p,input)=>lifeActions(await operation.query!(ctx,p,input),previous,previous+1)});}
export function manualParticipationLifeReads(reads:GatewayPublicRead[],previous:number):GatewayPublicRead[]{return reads.map(read=>read.id!=='life.public_actions'?read:{...read,schemaVersion:read.schemaVersion+1,output:lifeSchema(read.output,previous,previous+1),read:async(ctx,input)=>lifeActions(await read.read(ctx,input),previous,previous+1)});}
