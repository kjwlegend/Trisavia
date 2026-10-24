import type {JsonObject} from '../../contracts/store.ts';
import type {RuntimeEvent,RuntimeReadContext} from '../../contracts/runtime-store.ts';
import {RuntimeError} from '../../contracts/runtime-store.ts';
import type {BehaviorDetails,BehaviorLocation,BehaviorRecord} from './types.ts';
import {validateBehaviorEvent} from './records.ts';
import type {GridPoint,WorldRuleset} from '../world/types.ts';
import {containingPlace,assertCell} from '../world/rules.ts';

/** Never derive an old fact from the current Avatar, current map, or current source outcome. */
export async function behaviorSourceEvent(ctx:RuntimeReadContext,record:BehaviorRecord):Promise<RuntimeEvent>{
 const event=await ctx.events.get(record.sourceEventId);if(!event)throw new Error('Behavior source fact is unavailable');
 validateBehaviorEvent(record,{eventId:event.eventId,domain:event.domain,kind:event.kind,subject:event.subject,actor:event.actor,occurredAt:event.occurredAt,agentIds:event.audience.agentIds,...(typeof event.payload.nextStep==='number'?{nextStep:event.payload.nextStep}:{})});return event;
}
const nonnegative=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
export function validateBehaviorDetails(d:BehaviorDetails):void{
 const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/u.test(v);
 const location=(v:BehaviorLocation|null)=>v===null||!!v&&['place','entrance','bridge','stairs','map_region'].includes(v.kind)&&text(v.name,120);
 if(!d||d.version!==1||!['recorded','partial'].includes(d.completeness)||!['movement','wander','friendship_request','text_invitation','text_feedback','npc_service','life_work','life_rest'].includes(d.phase)||![d.startedAt,d.endedAt,d.durationMs].every(v=>v===null||nonnegative(v))||d.endedAt!==null&&d.startedAt!==null&&d.endedAt<d.startedAt||d.durationMs!==(d.startedAt!==null&&d.endedAt!==null?d.endedAt-d.startedAt:null)||!Array.isArray(d.participants)||d.participants.length>2||d.participants.some(p=>!text(p.agentId,256)||!['sender','recipient'].includes(p.role))||!text(d.resultCode,100)||!Array.isArray(d.gaps)||d.gaps.length>8||d.gaps.some(g=>!text(g,160)))throw new RuntimeError('invalid_usage','Invalid behavior detail facts');
 if(d.service&&(!text(d.service.npcId,100)||!text(d.service.npcName,120)||!text(d.service.serviceId,100)||!text(d.service.serviceName,120)||d.service.choice!==null&&!text(d.service.choice,120)||d.service.response!==null&&!text(d.service.response,1000)))throw new RuntimeError('invalid_usage','Invalid behavior service facts');
 if(d.life&&(!text(d.life.activityId,256)||!['work.shift','rest.bench'].includes(d.life.actionId)||d.life.jobId!==null&&!text(d.life.jobId,100)||!text(d.life.resultId,256)||!nonnegative(d.life.scheduledEndAt)||![d.life.energySpent,d.life.energyRestored,d.life.coinReward].every(v=>v===null||nonnegative(v))))throw new RuntimeError('invalid_usage','Invalid life result facts');
 if(d.location&&(!location(d.location.from)||!location(d.location.to)||!Array.isArray(d.location.via)||d.location.via.length>12||d.location.via.some(v=>!location(v))||d.location.mapId!==null&&!text(d.location.mapId,128)||![d.location.rulesetVersion,d.location.topologyVersion].every(v=>v===null||nonnegative(v)&&v>0)))throw new RuntimeError('invalid_usage','Invalid behavior location facts');
 if(d.journey&&![d.journey.completedSteps,d.journey.plannedSteps].every(v=>v===null||nonnegative(v)&&v<=64))throw new RuntimeError('invalid_usage','Invalid behavior journey facts');
 if(d.journey&&d.journey.completedSteps!==null&&d.journey.plannedSteps!==null&&d.journey.completedSteps>d.journey.plannedSteps)throw new RuntimeError('invalid_usage','Behavior journey exceeds its submitted route');
 if(Buffer.byteLength(JSON.stringify(d))>4096)throw new RuntimeError('invalid_usage','Behavior details exceed their bounded metadata');
}
export function detailPayload(details:BehaviorDetails):JsonObject{validateBehaviorDetails(details);return JSON.parse(JSON.stringify(details)) as JsonObject;}
export function storedBehaviorDetails(event:RuntimeEvent):BehaviorDetails|null{if(event.payload.behaviorDetails===undefined)return null;const value=event.payload.behaviorDetails as unknown as BehaviorDetails;validateBehaviorDetails(value);return structuredClone(value);}
/** Only a domain place name is a named location. Visual buildings never imply entry or a visit. */
export function behaviorLocation(rules:WorldRuleset,point:GridPoint):BehaviorLocation|null{
 try{assertCell(rules,point);}catch{return null;}
 const place=containingPlace(rules,point);if(place?.id==='commons')return {kind:'place',name:'公共庭'};
 return {kind:'map_region',name:'未命名开放区域'};
}
export function worldBehaviorDetails(input:{phase:'movement'|'wander';rules:WorldRuleset|undefined;origin:GridPoint|null;path:GridPoint[];startedAt:number|null;endedAt:number|null;plannedSteps:number|null;resultCode:string;partial?:boolean;gaps?:string[]}):BehaviorDetails{
 const {rules,path}=input,from=rules&&input.origin?behaviorLocation(rules,input.origin):null,to=rules&&(path.at(-1)??input.origin)?behaviorLocation(rules,(path.at(-1)??input.origin)!):null;
 const key=(p:BehaviorLocation|null)=>p?JSON.stringify(p):'',via:BehaviorLocation[]=[];let previous=key(from),truncated=false;
 if(rules)for(const cell of path.slice(0,-1)){const loc=behaviorLocation(rules,cell),current=key(loc);if(loc&&current!==previous&&current!==key(from)&&current!==key(to)){if(via.length<12)via.push(loc);else truncated=true;}previous=current;}
 const gaps=[...(input.gaps??[]),...(!rules?['当时地图细节未记录']:[]),...(truncated?['仅展示部分已走过的地点']:[])];
 const result:BehaviorDetails={version:1,completeness:input.partial||gaps.length?'partial':'recorded',phase:input.phase,startedAt:input.startedAt,endedAt:input.endedAt,durationMs:input.startedAt!==null&&input.endedAt!==null?input.endedAt-input.startedAt:null,location:{from,to,via,mapId:rules?.mapManifest?.mapId??null,rulesetVersion:rules?.version??null,topologyVersion:rules?.topologyVersion??null},journey:{completedSteps:path.length,plannedSteps:input.plannedSteps},participants:[],resultCode:input.resultCode,gaps};validateBehaviorDetails(result);return result;
}
export function socialBehaviorDetails(input:{phase:'friendship_request'|'text_invitation'|'text_feedback';startedAt:number;endedAt:number|null;fromAgentId:string;toAgentId:string;resultCode:string}):BehaviorDetails{
 const d:BehaviorDetails={version:1,completeness:'recorded',phase:input.phase,startedAt:input.startedAt,endedAt:input.endedAt,durationMs:input.endedAt===null?null:input.endedAt-input.startedAt,location:null,journey:null,participants:[{agentId:input.fromAgentId,role:'sender'},{agentId:input.toAgentId,role:'recipient'}],resultCode:input.resultCode,gaps:[]};validateBehaviorDetails(d);return d;
}
