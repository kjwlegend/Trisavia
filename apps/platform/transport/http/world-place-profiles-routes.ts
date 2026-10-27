import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import {object} from '../../domains/common/errors.ts';

/** World transports its own two named, public, side-effect-free profile reads. */
export function registerPlaceProfileRoutes(gateway: AgentGateway, http: GatewayHttpTransport): void {
  for (const read of [
    {id:'world.public_place_profiles',path:'/v1/world/place-profiles',fields:['worldId']},
    {id:'world.public_place_profile',path:'/v1/world/place-profile',fields:['worldId','placeId']},
  ]) http.route('GET',read.path,request => {
    const input = {...object(request.query,read.fields)};
    return http.measurePublicRead(request,() => gateway.publicRead(read.id,input,http.validate(request),http.signal(request)));
  });
}
