import type {FastifyInstance} from 'fastify';
import type {createWorldAnnouncements} from '../../application/world-announcements.ts';
import {M1Error,fail,object} from '../../domains/common/errors.ts';
export function registerWorldAnnouncementRoutes(app:FastifyInstance,service:ReturnType<typeof createWorldAnnouncements>){
 const windows=new Map<string,{at:number;count:number}>();
 for(const detail of [false,true])app.get('/v1/world/announcements'+(detail?'/:id':''),async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  try{
   const stamp=Date.now();if(windows.size>1000)for(const [ip,value]of windows)if(stamp-value.at>=60000)windows.delete(ip);
   const previous=windows.get(request.ip);if(previous&&stamp-previous.at<60000){if(previous.count>=240)fail('rate_limited',429,'Request limit reached');previous.count++;}else{if(windows.size>=10000)fail('rate_limited',429,'Request capacity reached');windows.set(request.ip,{at:stamp,count:1});}
   if(request.headers['transfer-encoding']!==undefined||request.headers['content-length']!==undefined&&request.headers['content-length']!=='0')fail('invalid_request',400,'GET bodies are not supported');
   const query=object(request.query,detail?['worldId']:['worldId','afterId']);
   const data=detail?await service.detail({...query,...request.params as {id:string}}):await service.list(query);
   return {protocolVersion:1,data};
  }catch(error){const status=error instanceof M1Error?error.statusCode:503;if(status===429)reply.header('Retry-After','60');return reply.code(status).send({error:{code:error instanceof M1Error?error.code:'source_unavailable'}});}
 });
}
