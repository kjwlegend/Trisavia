import type {JsonObject} from '../contracts/store.ts';
import type {AgentGateway,GatewayValidator} from './agent-gateway.ts';
import {fail} from '../domains/common/errors.ts';

export const WORLD_STARTUP_VERSION=1;
export interface WorldStartupInput {worldId:string;limit:number}
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function positive(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;}
/** No snapshot cache, identity authentication, private reader or synthesized capabilities. Original public projections remain intact. */
export async function readWorldStartup(gateway:AgentGateway,input:WorldStartupInput,validate:GatewayValidator,expectedInstanceId:string):Promise<JsonObject>{
 const bundle=await gateway.publicReadBundle([{id:'world.public_rules',input:{worldId:input.worldId}},{id:'world.public_scene',input:{worldId:input.worldId,limit:input.limit}}],validate);
 const rules=bundle.results['world.public_rules']!,scene=bundle.results['world.public_scene']!,world=record(rules.world),definition=record(rules.rules);
 if(bundle.instanceId!==expectedInstanceId||world.worldId!==input.worldId||world.active!==true||definition.worldId!==input.worldId||scene.worldId!==input.worldId||scene.scope!=='world'||!positive(world.revision)||scene.worldRevision!==world.revision||!positive(definition.version)||world.rulesetVersion!==definition.version||!positive(definition.topologyVersion)||!Array.isArray(scene.avatars)||scene.avatars.some(value=>{const avatar=record(value);return avatar.worldId!==input.worldId||!positive(avatar.rulesetVersion)||avatar.rulesetVersion>Number(definition.version);}))fail('world_startup_inconsistent',503,'The current public world metadata and scene do not match');
 return{startupVersion:WORLD_STARTUP_VERSION,publicOnly:true,instanceId:bundle.instanceId,worldId:input.worldId,gatewayCatalogRevision:gateway.catalogRevision,rulesetVersion:definition.version,topologyVersion:definition.topologyVersion,worldRevision:world.revision,asOf:bundle.asOf,rules,scene};
}
