import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import {object} from '../../domains/common/errors.ts';
export function registerLifeObservationRoutes(gateway:AgentGateway,http:GatewayHttpTransport){http.route('GET','/v1/world/life/actions',request=>{object(request.query,[]);return gateway.publicRead('life.public_actions',{},http.validate(request));});}
