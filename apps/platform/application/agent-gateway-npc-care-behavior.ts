import type {JsonObject} from '../contracts/store.ts';
import type {GatewayGuide,GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {nullable,objectSchema as obj,positive,string,timestamp} from './agent-gateway-schema.ts';
import {journalGatewayGuide} from './agent-gateway-journal.ts';

const changed=new Set(['behavior.owner_history','behavior.public_world','behavior.public_recent']);
const care=nullable(obj({pointId:string,careKind:{enum:['water','clear']},completed:{type:'boolean'},pointVersion:nullable(positive),lastCareAt:nullable(timestamp),nextEligibleAt:nullable(timestamp)}));
export function npcCareBehaviorSchema(source:JsonObject):JsonObject{
 const walk=(value:any):any=>{if(Array.isArray(value))return value.map(walk);if(!value||typeof value!=='object')return value;const next=Object.fromEntries(Object.entries(value).map(([key,v])=>[key,walk(v)])),p=next.properties;if(p?.phase?.enum?.includes('life_work'))p.phase.enum=[...p.phase.enum,'life_care'];if(p?.coinReward&&p?.activityId)p.care=care;return next;};return walk(source);
}
export function withNpcCareBehaviorOperations(ops:GatewayOperation[]):GatewayOperation[]{return ops.map(o=>changed.has(o.id)?{...o,schemaVersion:o.schemaVersion+1,output:npcCareBehaviorSchema(o.output)}:o);}
export function withNpcCareBehaviorReads(reads:GatewayPublicRead[]):GatewayPublicRead[]{return reads.map(r=>changed.has(r.id)?{...r,schemaVersion:r.schemaVersion+1,output:npcCareBehaviorSchema(r.output)}:r);}
export const npcCareBehaviorGuide:GatewayGuide={...journalGatewayGuide,version:9,document:{...journalGatewayGuide.document,version:9,npcLife:'The actual same-plan care introduction has the private life.care.introduced node, visible only to its Agent and the permitted occurrence-time/current Owner intersection. Only real completed care can contribute a source-permitted life.care.completed public summary. details.phase=life_care and optional life.care preserve the committed point result; no private introduction, wallet, energy or topic is made public. Cancellation is not completed care. Independent NPC daily selections remain excluded from the public world journal.'}};
