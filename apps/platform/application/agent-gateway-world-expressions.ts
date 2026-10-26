import type {JsonObject} from '../contracts/store.ts';
import type {GatewayOperation,GatewayPublicRead,GatewayGuide} from './agent-gateway.ts';
import type {createWorldExpressions} from './world-expressions.ts';
import {EXPRESSION_COMMANDS,EXPRESSION_POLICY} from '../domains/world/expressions.ts';
import {array,nullable,objectSchema as obj,string,timestamp,commandReceiptSchema} from './agent-gateway-schema.ts';
import {worldCLifeGuide} from './agent-gateway-life-c-projections.ts';
import {WORLD_EXPRESSION_GUIDE} from './world-expression-guide.ts';
export const expressionSchema=obj({expressionId:string,kind:{enum:['speech','emote','status','ambient']},origin:{enum:['agent_authored','authoritative_action','npc_scripted']},actor:obj({kind:{enum:['agent','npc']},id:string}),worldId:string,sceneId:string,createdAt:timestamp,expiresAt:timestamp,text:nullable({type:'string',minLength:1,maxLength:80}),emoteId:nullable({enum:EXPRESSION_POLICY.emotes.map(x=>x.id)}),sourceActivityId:nullable(string)});
export const expressionInputs={
 'world.expression.say':obj({worldId:{const:'default'},intentExpiresAt:timestamp,text:{type:'string',minLength:1,maxLength:80}}),
 'world.expression.emote':obj({worldId:{const:'default'},intentExpiresAt:timestamp,emoteId:{enum:EXPRESSION_POLICY.emotes.map(x=>x.id)}}),
};
const receipt=commandReceiptSchema('world',[...EXPRESSION_COMMANDS],{anyOf:[obj({expression:expressionSchema}),obj({code:string,retryAt:timestamp},['code'])]});
export function expressionGatewayOperations(service:ReturnType<typeof createWorldExpressions>):GatewayOperation[]{return EXPRESSION_COMMANDS.map(id=>({id,moduleId:'world',schemaVersion:11,kind:'command',actors:['agent'],description:'An explicit current public expression by this Agent; no conversation or life fact is inferred.',input:expressionInputs[id],output:receipt,command:service.execute,authorizeReceipt:(ctx,p,r)=>service.authorizeReceipt(ctx,p,r.key)}));}
function output(value:JsonObject):JsonObject {return {...value,properties:{...value.properties as JsonObject,expressions:array(expressionSchema,16)},required:[...value.required as string[],'expressions']};}
export function withExpressionOperations(ops:GatewayOperation[]):GatewayOperation[]{return ops.map(o=>o.id==='world.scene'?{...o,schemaVersion:11,output:output(o.output)}:o);}
export function withExpressionReads(reads:GatewayPublicRead[]):GatewayPublicRead[]{return reads.map(o=>o.id==='world.public_scene'?{...o,schemaVersion:11,output:output(o.output)}:o);}
export const worldExpressionGuide:GatewayGuide={...worldCLifeGuide,version:18,document:{...worldCLifeGuide.document,version:18,expressions:WORLD_EXPRESSION_GUIDE}};
