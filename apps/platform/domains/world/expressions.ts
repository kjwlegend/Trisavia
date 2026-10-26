import policy from '../../../../docs/workstreams/ws03-interaction/life-journal-v1/event-expression-map.json' with {type:'json'};
import {createHash} from 'node:crypto';
import type {ExecutionAuthority} from '../access/public.ts';
import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import {fail} from '../common/errors.ts';
export const EXPRESSION_POLICY=policy;
export const EXPRESSION_COMMANDS=['world.expression.say','world.expression.emote'] as const;
export type ExpressionKind='speech'|'emote'|'status'|'ambient';
export type ExpressionActor={kind:'agent'|'npc';id:string};
export interface WorldExpression {expressionId:string;kind:ExpressionKind;origin:'agent_authored'|'authoritative_action'|'npc_scripted';actor:ExpressionActor;worldId:string;sceneId:string;createdAt:number;expiresAt:number;text:string|null;emoteId:string|null;sourceActivityId:string|null}
export interface ExpressionSource {value:WorldExpression;authority:ExecutionAuthority|null;sharingGeneration:number|null;policyVersion:number|null;moduleGeneration:number;lineId:string|null;participationStamp:string|null;withdrawn?:boolean}
export interface ExpressionLimits {agent:{at:number;fingerprint:string}[];statusAt:number|null;statusKey:string|null;npcAt:number|null;lines:Record<string,number>}
export const emptyExpressionLimits=():ExpressionLimits=>({agent:[],statusAt:null,statusKey:null,npcAt:null,lines:{}});
export interface ExpressionRepository {
 getLimits(worldId:string,actor:ExpressionActor):Promise<ExpressionLimits>;
 saveLimits(worldId:string,actor:ExpressionActor,value:ExpressionLimits):Promise<void>;
 put(source:ExpressionSource):Promise<void>;
 withdraw(worldId:string,actor:ExpressionActor):Promise<void>;
 current(worldId:string,actors:ExpressionActor[],at:number):Promise<ExpressionSource[]>;
}
export const WORLD_EXPRESSIONS=defineRuntimeRepository<Pick<ExpressionRepository,'current'>,ExpressionRepository>('world.expressions');
export function expressionPriority(kind:ExpressionKind){return policy.expressionKinds[kind].priority;}
export function expressionText(input:unknown):string {
 if(typeof input!=='string'||![...input].length||[...input].length>policy.expressionKinds.speech.maxCodePoints||!input.trim()||/[\p{Cc}\p{Cs}<>]/u.test(input)||[...input].some(c=>/\p{Cf}/u.test(c)&&c!=='\u200d')||/(?:[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}|bearer\s+|(?:connet|trisavia)[._-](?:runtime|owner|session|token|recovery)|(?:sk|sess|rt|owner|bootstrap|continuation|invite)_[A-Za-z0-9_-]{12,}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[A-Za-z0-9_-]{20,})/iu.test(input))fail('expression_text_invalid',422,'Use 1–80 plain Unicode characters without markup, controls or credentials');
 return input;
}
export function expressionFingerprint(kind:'speech'|'emote',value:string){return createHash('sha256').update(kind+':'+value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('en-US')).digest('hex');}
export function agentExpressionLimit(l:ExpressionLimits,at:number,fingerprint:string){const active=l.agent.filter(x=>x.at>at-policy.limits.agentSharedWindowSeconds*1000),last=active.at(-1);let retryAt=0;
 if(last)retryAt=Math.max(retryAt,last.at+policy.limits.agentSharedMinIntervalSeconds*1000);if(active.length>=policy.limits.agentSharedWindowMax)retryAt=Math.max(retryAt,active[0]!.at+policy.limits.agentSharedWindowSeconds*1000);for(const x of active)if(x.fingerprint===fingerprint)retryAt=Math.max(retryAt,x.at+policy.limits.agentSameNormalizedExpressionSeconds*1000);
 if(retryAt>at)fail('expression_rate_limited',429,'Wait before another public expression',{retryAt});return {...l,agent:[...active,{at,fingerprint}]};
}
export function npcExpressionDraw(key:string){return createHash('sha256').update('life-journal-v1:'+key).digest().readUInt32BE(0)/0x1_0000_0000<policy.limits.npcEligibilityProbability;}
export function selectExpressionBatch(values:WorldExpression[]){const result:WorldExpression[]=[];for(const v of values.sort((a,b)=>expressionPriority(b.kind)-expressionPriority(a.kind)||b.createdAt-a.createdAt||a.expressionId.localeCompare(b.expressionId))){if(result.length>=policy.limits.expressionsPerReadMax)break;if(Buffer.byteLength(JSON.stringify([...result,v]))<=policy.limits.expressionBatchBytesMax)result.push(v);}return result;}
