import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import {object} from '../../domains/common/errors.ts';
export function registerPublicIdentifierRoutes(gateway:AgentGateway,http:GatewayHttpTransport){http.route('GET','/v1/public-identifiers/resolve',request=>gateway.publicRead('public_identifiers.public_resolve',object(request.query,['publicId']),http.validate(request)));}
