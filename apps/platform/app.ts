import type { EmailConfig } from './infrastructure/email/resend.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import { createM1Service } from './application/m1-service.ts';
import { verifyApplicationReadiness } from './application/bootstrap.ts';
import { openPostgresStore, type OpenPostgresStoreOptions } from './infrastructure/postgresql/postgres-store.ts';
import { registerM1Routes } from './transport/http/m1-routes.ts';
import { registerSiteRoutes } from './transport/http/site-routes.ts';
import { registerPerceptionRoutes } from './transport/http/perception-routes.ts';
import type { PerceptionOptions } from './application/perception-service.ts';
import { openPostgresRuntimeStore } from './infrastructure/postgresql/runtime-store.ts';
import type { RuntimeStore } from './contracts/runtime-store.ts';
import type { JsonObject } from './contracts/store.ts';
import { createRuntimeIdentity } from './application/runtime-identity.ts';
import { createWorldService, verifyWorldReadiness } from './application/world-service.ts';
import { createAgentGateway } from './application/agent-gateway.ts';
import { worldGatewayGuide, worldGatewayOperations, worldPublicReads } from './application/agent-gateway-world.ts';
import { registerAgentGatewayRoutes } from './transport/http/agent-gateway-routes.ts';
import { registerWorldObservationRoutes } from './transport/http/agent-gateway-world-routes.ts';
import { createDeterministicScheduler } from './infrastructure/scheduling/deterministic-scheduler.ts';
import { createWorldRuleDriver } from './application/world-rule-driver.ts';

export interface BuildAppOptions extends OpenPostgresStoreOptions {
 perception?:PerceptionOptions;email?:EmailConfig;clock?:()=>number;trustProxyLoopback?:boolean;worldCoreEnabled?:boolean;
}
/** PostgreSQL runtime only. Opening validates existing schema, identity and exact application documents. */
export async function buildApp(options:BuildAppOptions):Promise<FastifyInstance> {
 const store=await openPostgresStore(options);
 let runtime:RuntimeStore|undefined;
 let ruleDriver:ReturnType<typeof createWorldRuleDriver>|undefined;
 try{
  await verifyApplicationReadiness(store);
  const app=Fastify({logger:false,bodyLimit:16*1024,ajv:{customOptions:{coerceTypes:false,removeAdditional:false,useDefaults:false}},trustProxy:options.trustProxyLoopback===true?(address,hop)=>hop===0&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address):false});
  app.addHook('preClose',async()=>{await ruleDriver?.close();});
  app.addHook('onClose',async()=>{try{await runtime?.close();}finally{await store.close();}});
  app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:{code:'not_found',message:'Route not found'}}));
  let gatewayCapabilities:(()=>JsonObject)|undefined;
  if(options.worldCoreEnabled===true){
   runtime=await openPostgresRuntimeStore({...options,...(options.clock?{now:options.clock}:{})});
   await runtime.read(ctx=>verifyWorldReadiness(ctx));
   const identity=createRuntimeIdentity(options.recoveryEpoch,options.clock??Date.now);
   const world=createWorldService(identity);
   const gateway=createAgentGateway({store:runtime,identity,operations:worldGatewayOperations(world),publicReads:worldPublicReads(world),guides:[worldGatewayGuide]});
   gatewayCapabilities=()=>({...gateway.capabilities(),worldSimulation:{enabled:true,actionAdvancement:'deterministic-rule-tasks',movementPolicyVersion:1,stepIntervalMs:1000,pollIntervalMs:1000,externalAgentExecution:false}});
   registerWorldObservationRoutes(gateway,registerAgentGatewayRoutes(app,gateway,{instanceId:store.instanceId,now:options.clock??Date.now}));
   const scheduler=createDeterministicScheduler({store:runtime,workerId:`world-rules-${process.pid}`,handlers:[{kind:'world.movement.step',version:1,run:world.handleTask}],batchLimit:10,leaseMs:30000});
   ruleDriver=createWorldRuleDriver(scheduler);app.addHook('onReady',async()=>{ruleDriver!.start();});
  }
  app.get('/health',async(_request,reply)=>{try{if(runtime)await runtime.read(ctx=>verifyWorldReadiness(ctx));return await store.read(async()=>({status:'ok',phase:'M1',apiVersion:'1',instanceId:store.instanceId,...(runtime?{worldCore:'ready'}:{})}));}catch{return reply.code(503).send({status:'unavailable',error:{code:'storage_unavailable'}});}});
  const service=createM1Service(store,{...(options.clock?{now:options.clock}:{}),...(options.email?{email:options.email}:{}),...(options.perception?{perception:options.perception}:{}),...(gatewayCapabilities?{gateway:gatewayCapabilities}:{})});
  registerM1Routes(app,service);registerPerceptionRoutes(app,service);registerSiteRoutes(app);return app;
 }catch(error){try{await ruleDriver?.close();await runtime?.close();}finally{await store.close();}throw error;}
}
