import type {JsonObject} from '../contracts/store.ts';
import type {GatewayOperation,GatewayPublicRead,GatewaySchemaDocument} from './agent-gateway.ts';
import {gatewayOperationSchemas,gatewayPublicReadSchemas} from './agent-gateway.ts';
import {fail} from '../domains/common/errors.ts';
import {lifeCSchemas} from './agent-gateway-life-c.ts';
import {TOWN_EXPANSION_SPATIAL_REF} from '../domains/world/town-expansion-v1.ts';

const oldSpatialSchema=(lifeCSchemas.actions.properties as JsonObject).spatialManifestRef as JsonObject,oldSpatialProperties=oldSpatialSchema.properties as JsonObject;
const oldSpatial:JsonObject={url:(oldSpatialProperties.url as JsonObject).const!,revision:(oldSpatialProperties.revision as JsonObject).const!,sha256:(oldSpatialProperties.sha256 as JsonObject).const!};
const spatialSchema=(ref:JsonObject):JsonObject=>({type:'object',additionalProperties:false,required:['url','revision','sha256'],properties:Object.fromEntries(Object.entries(ref).map(([key,value])=>[key,{const:value}]))});
const branch=(version:number,ref:JsonObject):JsonObject=>({properties:{map:{properties:{mapId:{const:'pixel-town-v2'},rulesetVersion:{const:version},topologyVersion:{const:version}},required:['mapId','rulesetVersion','topologyVersion']},spatialManifestRef:spatialSchema(ref)},required:['map','spatialManifestRef']});

/** A new read contract changes only current guidance refs; source models and business commands stay at schema3. */
function currentActionSchema(source:JsonObject):JsonObject{
 const output=structuredClone(source),actions=(output.properties as JsonObject)?.actions as JsonObject,action=actions?.items as JsonObject,ref=(action?.properties as JsonObject)?.guideRef as JsonObject,version=(ref?.properties as JsonObject)?.version as JsonObject;
 if(version?.const!==3)throw new Error('Exact Life3 actions schema required');version.const=4;
 (output.properties as JsonObject).spatialManifestRef={anyOf:[structuredClone(oldSpatialSchema),spatialSchema({...TOWN_EXPANSION_SPATIAL_REF})]};
 output.allOf=[{anyOf:[branch(5,oldSpatial),branch(6,{...TOWN_EXPANSION_SPATIAL_REF})]}];return output;
}
function currentActionProjection(source:JsonObject):JsonObject{
 if(!Array.isArray(source.actions)||source.actions.length>32)fail('source_unavailable',503,'Current Life actions are unavailable');
 const map=source.map as JsonObject,spatial=source.spatialManifestRef as JsonObject,ref=map?.rulesetVersion===5?oldSpatial:map?.rulesetVersion===6?TOWN_EXPANSION_SPATIAL_REF:null;
 if(source.catalogRevision!==3||source.ruleVersion!==1||map?.mapId!=='pixel-town-v2'||!ref||map.topologyVersion!==map.rulesetVersion||!spatial||Object.keys(spatial).length!==3||Object.entries(ref).some(([key,value])=>spatial[key]!==value))fail('source_unavailable',503,'The exact Life spatial reference is required');
 return{...source,actions:source.actions.map(value=>{const action=value as JsonObject,ref=action?.guideRef as JsonObject;if(ref?.moduleId!=='life'||ref.version!==3)fail('source_unavailable',503,'Exact Life3 action guidance required');return{...action,guideRef:{...ref,version:4}};})};
}
export function withAutonomousLifeOperations(operations:GatewayOperation[]):GatewayOperation[]{return operations.map(operation=>operation.id!=='life.actions'?operation:{...operation,schemaVersion:4,output:currentActionSchema(operation.output),query:async(ctx,p,input)=>currentActionProjection(await operation.query!(ctx,p,input))});}
export function withAutonomousLifeReads(reads:GatewayPublicRead[]):GatewayPublicRead[]{return reads.map(read=>read.id!=='life.public_actions'?read:{...read,schemaVersion:4,output:currentActionSchema(read.output),read:async(ctx,input)=>currentActionProjection(await read.read(ctx,input))});}
export function retainedLifeActionSchemas(operations:GatewayOperation[],reads:GatewayPublicRead[]):GatewaySchemaDocument[]{return[...operations.filter(operation=>operation.id==='life.actions').flatMap(gatewayOperationSchemas),...reads.filter(read=>read.id==='life.public_actions').flatMap(gatewayPublicReadSchemas)];}
