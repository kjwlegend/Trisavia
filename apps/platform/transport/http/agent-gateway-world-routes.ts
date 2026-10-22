import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import {M1Error,object} from '../../domains/common/errors.ts';
/** World owns its public paths and URL parameter decoding. The generic Gateway knows only schemas and handlers. */
export function registerWorldObservationRoutes(gateway:AgentGateway,http:GatewayHttpTransport){
 for(const read of [{id:'world.public_scene',path:'/v1/world/scene'},{id:'world.public_rules',path:'/v1/world/rules'},{id:'world.public_map_manifest',path:'/v1/world/map-manifest'},{id:'world.public_npcs',path:'/v1/world/npcs'}])http.route('GET',read.path,request=>{
  const input={...object(request.query,read.id==='world.public_scene'?['worldId','cursor','limit']:['worldId'])};
  if(input.limit!==undefined){if(typeof input.limit!=='string'||!/^\d{1,3}$/.test(input.limit))throw new M1Error('invalid_request',400,'Invalid world page limit');input.limit=Number(input.limit);}
  return gateway.publicRead(read.id,input,http.validate(request));
 });
}
