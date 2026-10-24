import type {FastifyInstance} from 'fastify';
import {APP_VERSION} from '../../version.ts';

export function registerHealthRoute(app:FastifyInstance,readiness:()=>Promise<{instanceId:string;worldCore?:'ready'}>){
 app.get('/health',async(_request,reply)=>{
  try{return {...await readiness(),status:'ok',phase:'M1',apiVersion:'1',appVersion:APP_VERSION};}
  catch{return reply.code(503).send({status:'unavailable',appVersion:APP_VERSION,error:{code:'storage_unavailable'}});}
 });
}
