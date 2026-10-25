import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import {M1Error,object} from '../../domains/common/errors.ts';
import {readWorldStartup,WORLD_STARTUP_VERSION} from '../../application/world-startup-read.ts';
/** World owns its public paths and URL parameter decoding. The generic Gateway knows only schemas and handlers. */
export function registerWorldObservationRoutes(gateway:AgentGateway,http:GatewayHttpTransport){
 for(const read of [{id:'world.public_scene',path:'/v1/world/scene'},{id:'world.public_rules',path:'/v1/world/rules'},{id:'world.public_map_manifest',path:'/v1/world/map-manifest'},{id:'world.public_npcs',path:'/v1/world/npcs'}])http.route('GET',read.path,request=>{
  const input={...object(request.query,read.id==='world.public_scene'?['worldId','cursor','limit']:['worldId'])};
  if(input.limit!==undefined){if(typeof input.limit!=='string'||!/^\d{1,3}$/.test(input.limit))throw new M1Error('invalid_request',400,'Invalid world page limit');input.limit=Number(input.limit);}
  return http.measurePublicRead(request,()=>gateway.publicRead(read.id,input,http.validate(request),http.signal(request)));
 });
 http.route('GET','/v1/world/startup',request=>{
  if(request.headers.authorization!==undefined||request.headers.cookie!==undefined)throw new M1Error('anonymous_startup_only',400,'Use the existing authenticated read chain for an identified client');
  const query=object(request.query,['version','worldId','limit']);
  if(query.version!==String(WORLD_STARTUP_VERSION))throw new M1Error('world_startup_version_required',400,'Request the exact supported startup version');
  if(typeof query.worldId!=='string'||!query.worldId.length||query.worldId.length>100||query.limit!==undefined&&(typeof query.limit!=='string'||!/^\d{1,3}$/.test(query.limit)||Number(query.limit)<1||Number(query.limit)>100))throw new M1Error('invalid_request',400,'Choose a world and bounded first scene page');
  return http.measurePublicRead(request,()=>readWorldStartup(gateway,{worldId:query.worldId as string,limit:query.limit===undefined?50:Number(query.limit)},http.validate(request),http.instanceId,http.signal(request)));
 });
}
