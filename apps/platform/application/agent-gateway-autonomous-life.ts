import type {JsonObject} from '../contracts/store.ts';
import type {GatewayOperation,GatewayPublicRead,GatewaySchemaDocument} from './agent-gateway.ts';
import {gatewayOperationSchemas,gatewayPublicReadSchemas} from './agent-gateway.ts';
import {fail} from '../domains/common/errors.ts';

/** A new read contract changes only current guidance refs; source models and business commands stay at schema3. */
function currentActionSchema(source:JsonObject):JsonObject{
 const output=structuredClone(source),actions=(output.properties as JsonObject)?.actions as JsonObject,action=actions?.items as JsonObject,ref=(action?.properties as JsonObject)?.guideRef as JsonObject,version=(ref?.properties as JsonObject)?.version as JsonObject;
 if(version?.const!==3)throw new Error('Exact Life3 actions schema required');version.const=4;return output;
}
function currentActionProjection(source:JsonObject):JsonObject{
 if(!Array.isArray(source.actions)||source.actions.length>32)fail('source_unavailable',503,'Current Life actions are unavailable');
 return{...source,actions:source.actions.map(value=>{const action=value as JsonObject,ref=action?.guideRef as JsonObject;if(ref?.moduleId!=='life'||ref.version!==3)fail('source_unavailable',503,'Exact Life3 action guidance required');return{...action,guideRef:{...ref,version:4}};})};
}
export function withAutonomousLifeOperations(operations:GatewayOperation[]):GatewayOperation[]{return operations.map(operation=>operation.id!=='life.actions'?operation:{...operation,schemaVersion:4,output:currentActionSchema(operation.output),query:async(ctx,p,input)=>currentActionProjection(await operation.query!(ctx,p,input))});}
export function withAutonomousLifeReads(reads:GatewayPublicRead[]):GatewayPublicRead[]{return reads.map(read=>read.id!=='life.public_actions'?read:{...read,schemaVersion:4,output:currentActionSchema(read.output),read:async(ctx,input)=>currentActionProjection(await read.read(ctx,input))});}
export function retainedLifeActionSchemas(operations:GatewayOperation[],reads:GatewayPublicRead[]):GatewaySchemaDocument[]{return[...operations.filter(operation=>operation.id==='life.actions').flatMap(gatewayOperationSchemas),...reads.filter(read=>read.id==='life.public_actions').flatMap(gatewayPublicReadSchemas)];}
