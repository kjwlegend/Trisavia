import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import {object} from '../../domains/common/errors.ts';
export function registerTownObservationRoutes(gateway:AgentGateway,http:GatewayHttpTransport){
 for(const [name,keys] of [['npcs',[]],['service',['serviceId']],['notice',[]]] as const)http.route('GET','/v1/town/'+name,request=>gateway.publicRead('town_services.public_'+name,{...object(request.query,keys)},http.validate(request)));
}
