import type { EmailConfig } from './infrastructure/email/resend.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import { createM1Service } from './application/m1-service.ts';
import { verifyApplicationReadiness } from './application/bootstrap.ts';
import { openPostgresStore, type OpenPostgresStoreOptions } from './infrastructure/postgresql/postgres-store.ts';
import { registerM1Routes } from './transport/http/m1-routes.ts';
import { registerSiteRoutes } from './transport/http/site-routes.ts';
import { registerPerceptionRoutes } from './transport/http/perception-routes.ts';
import type { PerceptionOptions } from './application/perception-service.ts';

export interface BuildAppOptions extends OpenPostgresStoreOptions {
 perception?:PerceptionOptions;email?:EmailConfig;clock?:()=>number;trustProxyLoopback?:boolean;
}
/** PostgreSQL runtime only. Opening validates existing schema, identity and exact application documents. */
export async function buildApp(options:BuildAppOptions):Promise<FastifyInstance> {
 const store=await openPostgresStore(options);
 try{
  await verifyApplicationReadiness(store);
  const app=Fastify({logger:false,bodyLimit:16*1024,trustProxy:options.trustProxyLoopback===true?(address,hop)=>hop===0&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address):false});
  app.addHook('onClose',async()=>{await store.close();});
  app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:{code:'not_found',message:'Route not found'}}));
  app.get('/health',async(_request,reply)=>{try{return await store.read(async()=>({status:'ok',phase:'M1',apiVersion:'1',instanceId:store.instanceId}));}catch{return reply.code(503).send({status:'unavailable',error:{code:'storage_unavailable'}});}});
  const service=createM1Service(store,{...(options.clock?{now:options.clock}:{}),...(options.email?{email:options.email}:{}),...(options.perception?{perception:options.perception}:{})});
  registerM1Routes(app,service);registerPerceptionRoutes(app,service);registerSiteRoutes(app);return app;
 }catch(error){await store.close();throw error;}
}
