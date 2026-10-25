import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import type {AgentGateway} from '../../application/agent-gateway.ts';
import {M1Error} from '../../domains/common/errors.ts';
import {RuntimeError} from '../../contracts/runtime-store.ts';
import {StorageError} from '../../contracts/store.ts';
import type {JsonObject} from '../../contracts/store.ts';
import {object} from '../../domains/common/errors.ts';
import {createGatewayQuotaObservation,isWorldReadObservationRoute,worldReadObservationHints,type GatewayQuotaDiagnosticSink,type GatewayQuotaRoute} from './gateway-request-observation.ts';
class GatewayRateLimitError extends M1Error {
 readonly retryAfterSeconds:number;
 constructor(message:string,retryAfterSeconds:number){super('rate_limited',429,message);this.retryAfterSeconds=retryAfterSeconds;}
}
export function registerAgentGatewayRoutes(app:FastifyInstance,gateway:AgentGateway,identity:{instanceId:string;now:()=>number},diagnostics:{write?:GatewayQuotaDiagnosticSink}={}){
 const windows=new Map<string,{at:number;count:number}>();let cleanupAt=Date.now();
 const observation=createGatewayQuotaObservation(diagnostics.write);
 const publicDurations=new WeakMap<FastifyRequest,number>();
 const validators=new WeakMap<JsonObject,(input:unknown)=>boolean>();
 const validate=(request:FastifyRequest)=>(schema:JsonObject,input:unknown)=>{let check=validators.get(schema);if(!check){check=request.compileValidationSchema(schema,'body');validators.set(schema,check);}return check(input);};
 function quota(request:FastifyRequest,route:GatewayQuotaRoute){
  const hints=isWorldReadObservationRoute(route)?worldReadObservationHints(request.headers['x-world-read-build'],request.headers['x-world-read-reason']):undefined;
  const at=Date.now();if(at-cleanupAt>=60000){for(const [id,window]of windows)if(at-window.at>=60000)windows.delete(id);cleanupAt=at;}
  let window=windows.get(request.ip);
  if(!window){if(windows.size>=10000){observation.capacityRejected(route,at,windows.size,hints);throw new GatewayRateLimitError('Request capacity is exhausted',60);}windows.set(request.ip,window={at,count:0});}
  if(at-window.at>=60000){window.at=at;window.count=0;}
  const allowed=++window.count<=240;observation.attempt(window,route,allowed,hints);
  if(!allowed){const retryAfter=Math.min(60,Math.max(1,Math.ceil((window.at+60000-at)/1000)));observation.rejected(window,route,at,retryAfter);throw new GatewayRateLimitError('Request rate limit reached',retryAfter);}
 }
 const bearer=(request:FastifyRequest)=>{const header=request.headers.authorization;if(typeof header!=='string'||!header.startsWith('Bearer '))throw new M1Error('authentication_failed',401,'Bearer authentication is required');return header.slice(7);};
 function error(error:unknown,request:FastifyRequest,reply:FastifyReply){
  let status=503,code='unavailable',message='Service is unavailable';
  if(error instanceof M1Error){status=error.statusCode;code=error.code;message=error.message;}
  else if(error instanceof RuntimeError){status=error.code==='command_conflict'||error.code==='version_conflict'||error.code==='lease_lost'?409:503;code=error.code;message='The operation could not be completed';}
  else if(error instanceof StorageError){status=error.code==='constraint'||error.code==='conflict'?409:503;code=error.code==='unknown_commit'?'unknown_commit':error.code==='busy'?'busy':error.code==='constraint'||error.code==='conflict'?'conflict':'unavailable';message=error.code==='unknown_commit'?'Commit result is unknown; query the original command receipt':'The operation could not be completed';}
  else if(error&&typeof error==='object'&&'statusCode'in error&&typeof error.statusCode==='number'&&error.statusCode<500){status=error.statusCode===413?413:400;code='invalid_request';message='Request is invalid';}
  if(error instanceof GatewayRateLimitError)reply.header('Retry-After',String(error.retryAfterSeconds)).header('Cache-Control','no-store');
  return reply.code(status).send({protocolVersion:1,requestId:String(request.id),error:{code,message}});
 }
 function route(method:'GET'|'POST',url:string,handler:(request:FastifyRequest)=>unknown|Promise<unknown>){
  const observedRoute:GatewayQuotaRoute={method,route:url,requestClass:method==='GET'?'public_read':'gateway_operation'};
  app.route({method,url,bodyLimit:32768,errorHandler:error,handler:async(request,reply)=>{
   const started=performance.now();reply.header('Cache-Control','no-store').header('X-Request-Id',String(request.id));
   try{quota(request,observedRoute);return {protocolVersion:1,requestId:String(request.id||randomUUID()),instanceId:identity.instanceId,serverTime:identity.now(),data:await handler(request)};}
   finally{const publicMs=publicDurations.get(request);reply.header('Server-Timing',`app;dur=${(performance.now()-started).toFixed(2)};desc="Gateway handler"`+(publicMs===undefined?'':`, public_read;dur=${publicMs.toFixed(2)};desc="Public read including store"`));}
  }});
 }
 async function measurePublicRead<T>(request:FastifyRequest,read:()=>Promise<T>):Promise<T>{const started=performance.now();try{return await read();}finally{publicDurations.set(request,(publicDurations.get(request)??0)+performance.now()-started);}}
 route('GET','/v1/gateway/discovery',request=>{object(request.query,[]);return gateway.discovery();});
 route('GET','/v1/gateway/schemas/:schemaId',request=>gateway.schema((request.params as {schemaId:string}).schemaId,object(request.query,['version']).version));
 route('GET','/v1/gateway/guides/:moduleId',request=>gateway.guide((request.params as {moduleId:string}).moduleId,object(request.query,['version']).version));
 route('POST','/v1/gateway/query',request=>gateway.query(request.body,bearer(request),validate(request)));
 route('POST','/v1/gateway/commands',request=>gateway.command(request.body,bearer(request),validate(request)));
 route('POST','/v1/gateway/receipts/query',request=>gateway.receipt(request.body,bearer(request)));
 return {route,validate,measurePublicRead,instanceId:identity.instanceId};
}
export type GatewayHttpTransport=ReturnType<typeof registerAgentGatewayRoutes>;
