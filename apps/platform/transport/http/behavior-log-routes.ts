import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import type {JsonObject} from '../../contracts/store.ts';
import {M1Error,object} from '../../domains/common/errors.ts';
export function registerBehaviorLogRoutes(gateway:AgentGateway,http:GatewayHttpTransport){
 for(const [id,path,keys] of [['behavior.public_world','/v1/world/logs',['worldId','timeZone']],['behavior.public_recent','/v1/world/agent-logs',['agentId','timeZone']]] as const)http.route('GET',path,request=>gateway.publicRead(id,{...object(request.query,keys)},http.validate(request)));
 const human=(envelope:JsonObject):JsonObject=>{const data=envelope.data as JsonObject;const result:JsonObject={schema:'behavior-human-read',version:1,original:{...envelope,data:data.originalData!},presentations:data.presentations!};if(Buffer.byteLength(JSON.stringify(result),'utf8')>512*1024)throw new M1Error('behavior_unavailable',503,'The human behavior representation exceeds its bounded response');return result;};
 for(const [mode,path,keys]of [['world','/v1/human/behavior/world',['worldId','timeZone']],['recent','/v1/human/behavior/recent',['agentId','timeZone']]] as const)http.route('GET',path,request=>gateway.humanBehaviorRead(mode,object(request.query,keys),http.validate(request)),human);
 http.route('POST','/v1/human/behavior/owner-history',request=>{const header=request.headers.authorization;if(typeof header!=='string'||!header.startsWith('Bearer '))throw new M1Error('authentication_failed',401,'Bearer authentication is required');return gateway.humanBehaviorRead('owner',request.body,http.validate(request),header.slice(7));},human);
}
