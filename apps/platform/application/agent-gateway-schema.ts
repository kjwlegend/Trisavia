import type {JsonObject} from '../contracts/store.ts';
export const string:JsonObject={type:'string',minLength:1,maxLength:100},positive:JsonObject={type:'integer',minimum:1},nonnegative:JsonObject={type:'integer',minimum:0},timestamp:JsonObject={type:'integer'},boolean:JsonObject={type:'boolean'};
export const objectSchema=(properties:JsonObject,required=Object.keys(properties)):JsonObject=>({type:'object',additionalProperties:false,properties,required});
export const nullable=(schema:JsonObject):JsonObject=>({anyOf:[schema,{type:'null'}]});
export const array=(items:JsonObject,maxItems?:number):JsonObject=>({type:'array',items,...(maxItems===undefined?{}:{maxItems})});
export const cursor:JsonObject={type:'string',minLength:1,maxLength:2048};
export function commandReceiptSchema(domain:string,actions:string[],result:JsonObject,actors:('agent'|'owner')[]=['agent']):JsonObject{return objectSchema({key:objectSchema({domain:{const:domain},action:{enum:actions},commandId:{type:'string',minLength:8,maxLength:100},principal:objectSchema({kind:actors.length===1?{const:actors[0]!}:{enum:actors},id:string}),recoveryEpoch:string}),requestHash:{type:'string',pattern:'^[a-f0-9]{64}$'},outcome:{enum:['committed','rejected','conflict','expired']},result,eventIds:array(string),committedAt:timestamp});}
