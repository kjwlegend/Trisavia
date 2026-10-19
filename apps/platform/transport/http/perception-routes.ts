import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { M1Service } from '../../application/m1-service.ts';
import { fail } from '../../domains/common/errors.ts';
import { OPERATIONS } from '../../domains/perception/protocol.ts';
function token(request:FastifyRequest):string|undefined {const value=request.headers.authorization;if(value===undefined)return;if(!/^Bearer [^\s]+$/u.test(value))fail('authentication_failed',401,'Authentication failed');return value.slice(7);}
export function registerPerceptionRoutes(app:FastifyInstance,service:M1Service):void {
 const windows=new Map<string,{stamp:number;count:number}>();
 for(const operation of OPERATIONS)app.route({method:operation.method,url:operation.path,bodyLimit:16*1024,handler(request,reply){
  reply.header('Cache-Control','no-store');const now=Date.now();if(windows.size>1000)for(const [ip,w]of windows)if(now-w.stamp>=60_000)windows.delete(ip);
  const old=windows.get(request.ip);if(old&&now-old.stamp<60_000&&old.count>=240)fail('rate_limited',429,'Request limit reached');if(!old||now-old.stamp>=60_000){if(windows.size>=10_000)fail('rate_limited',429,'Request capacity reached');windows.set(request.ip,{stamp:now,count:1});}else old.count++;
  const query=request.query as Record<string,unknown>,params=request.params as Record<string,string>;
  if(operation.method==='GET'){
   if(request.headers['transfer-encoding']!==undefined||(request.headers['content-length']!==undefined&&request.headers['content-length']!=='0'))fail('invalid_request',400,'GET bodies are not supported');
   if(Object.keys(params).some(key=>key in query))fail('invalid_request',400,'Resource identifiers belong in the path');return service.invokeHttp(operation.action,{...query,...params},token(request));
  }
  if(Object.keys(query).length)fail('invalid_request',400,'Query arguments are not supported');return service.invokeHttp(operation.action,request.body,token(request));
 }});
}
