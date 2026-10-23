import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import {object} from '../../domains/common/errors.ts';
export function registerBehaviorLogRoutes(gateway:AgentGateway,http:GatewayHttpTransport){
 for(const [id,path,keys] of [['behavior.public_world','/v1/world/logs',['worldId','timeZone']],['behavior.public_recent','/v1/world/agent-logs',['agentId','timeZone']]] as const)http.route('GET',path,request=>gateway.publicRead(id,{...object(request.query,keys)},http.validate(request)));
}
