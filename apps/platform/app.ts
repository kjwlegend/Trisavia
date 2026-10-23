import type { EmailConfig } from './infrastructure/email/resend.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import { createM1Service } from './application/m1-service.ts';
import { verifyApplicationReadiness } from './application/bootstrap.ts';
import { openPostgresStore,readLegacyAvatarIdentity, type OpenPostgresStoreOptions } from './infrastructure/postgresql/postgres-store.ts';
import { registerM1Routes } from './transport/http/m1-routes.ts';
import { registerSiteRoutes } from './transport/http/site-routes.ts';
import { registerPerceptionRoutes } from './transport/http/perception-routes.ts';
import type { PerceptionOptions } from './application/perception-service.ts';
import { openPostgresRuntimeStore } from './infrastructure/postgresql/runtime-store.ts';
import type { RuntimeStore } from './contracts/runtime-store.ts';
import type { JsonObject } from './contracts/store.ts';
import { createRuntimeIdentity,createRuntimeObservation } from './application/runtime-identity.ts';
import { behaviorSourcesEnabled,createBehaviorLogService } from './application/behavior-log-service.ts';
import { behaviorGatewayOperations,behaviorPublicReads,behaviorGatewayGuide } from './application/agent-gateway-behavior.ts';
import { registerBehaviorLogRoutes } from './transport/http/behavior-log-routes.ts';
import { createWorldService, verifyWorldReadiness } from './application/world-service.ts';
import { createRelationshipsService } from './application/relationships-service.ts';
import { relationshipsGatewayOperations, relationshipsGatewayGuide } from './application/agent-gateway-relationships.ts';
import { createAgentGateway } from './application/agent-gateway.ts';
import { worldGatewayGuide, worldGatewayOperations, worldPublicReads } from './application/agent-gateway-world.ts';
import { registerAgentGatewayRoutes } from './transport/http/agent-gateway-routes.ts';
import { registerWorldObservationRoutes } from './transport/http/agent-gateway-world-routes.ts';
import { createDeterministicScheduler, type DeterministicTaskHandler } from './infrastructure/scheduling/deterministic-scheduler.ts';
import { createWorldRuleDriver } from './application/world-rule-driver.ts';
import { createInteractionService, verifyInteractionReadiness } from './application/interaction-service.ts';
import { createDecisionService } from './application/decision-service.ts';
import { interactionGatewayGuide, interactionGatewayOperations } from './application/agent-gateway-interaction.ts';
import { decisionGatewayGuide, decisionGatewayOperations } from './application/agent-gateway-decision.ts';
import { fail, object } from './domains/common/errors.ts';
import { IDLE_LIFE_POLICY_V1 } from './domains/world/idle-life.ts';
import {createTownService} from './application/town-services.ts';
import {TOWN_REPOSITORY} from './domains/town-services/repository.ts';
import {townGatewayGuide,townGatewayOperations,townPublicReads} from './application/agent-gateway-town.ts';
import {registerTownObservationRoutes} from './transport/http/town-services-routes.ts';
import {catalogRepository} from './domains/perception/repository.ts';
import {NPC_SERVICE_ITEMS_SOURCE,plain} from './domains/perception/protocol.ts';

export interface BuildAppOptions extends OpenPostgresStoreOptions {
 perception?:PerceptionOptions;email?:EmailConfig;clock?:()=>number;trustProxyLoopback?:boolean;worldCoreEnabled?:boolean;worldCoreInteractionEnabled?:boolean;
}
/** PostgreSQL runtime only. Opening validates existing schema, identity and exact application documents. */
export async function buildApp(options:BuildAppOptions):Promise<FastifyInstance> {
 if(options.worldCoreInteractionEnabled===true&&options.worldCoreEnabled!==true)throw new Error('World core must be enabled before Interaction handlers');
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
  let friendshipOwnerRead:((raw:unknown,token:unknown)=>Promise<JsonObject>)|undefined;
  if(options.worldCoreEnabled===true){
   runtime=await openPostgresRuntimeStore({...options,...(options.clock?{now:options.clock}:{})});
   await runtime.read(ctx=>verifyWorldReadiness(ctx));
   const identity=createRuntimeIdentity(options.recoveryEpoch,options.clock??Date.now,readLegacyAvatarIdentity);
   const behaviorEnabled=options.worldCoreInteractionEnabled===true&&await runtime.read(behaviorSourcesEnabled),observation=behaviorEnabled?createRuntimeObservation(identity):undefined;
   const townEnabled=await runtime.read(async ctx=>!!await ctx.repository(TOWN_REPOSITORY).getCatalog());
   if(townEnabled&&(!behaviorEnabled||!await store.read(async tx=>plain((await catalogRepository(tx).get('current'))?.data.sourceStates)[NPC_SERVICE_ITEMS_SOURCE]==='enabled')))fail('town_services_unavailable',503,'Activate the source coverage and exact real item catalog before starting town services');
   const town=townEnabled?createTownService(identity,{...(observation?{observation}:{})}):undefined;
   const world=createWorldService(identity,{...(observation?{observation}:{}),...(town?{activities:town.worldActivity,currentNpcs:town.currentNpcs}:{})}),relationships=createRelationshipsService(identity,{...(observation?{observation}:{})}),operations=[...worldGatewayOperations(world),...relationshipsGatewayOperations(relationships)],guides=[worldGatewayGuide,relationshipsGatewayGuide],publicReads=worldPublicReads(world);
   if(town){operations.push(...townGatewayOperations(town));guides.push(townGatewayGuide);publicReads.push(...townPublicReads(town));}
   let behaviorLogs:ReturnType<typeof createBehaviorLogService>|undefined;
   friendshipOwnerRead=(raw,token)=>runtime!.read(async ctx=>{
    const input=object(raw,['agentId']),principal=await identity.authenticate(ctx,token,['owner_session']),friends:JsonObject[]=[];let cursor:string|undefined;
    for(let page=0;page<3;page++){
     const value=await relationships.friends(ctx,principal,{agentId:typeof input.agentId==='string'?input.agentId:'',limit:100,...(cursor?{cursor}:{})});friends.push(...value.friends);
     if(value.complete)return {agentId:value.agentId,friends,complete:true,asOf:value.asOf};
     cursor=value.nextCursor??undefined;
    }
    fail('source_unavailable',503,'Use the bounded friendship reader to read this collection');
   });
   const handlers:DeterministicTaskHandler[]=[{kind:'world.movement.step',version:1,run:world.handleTask},{kind:'world.idle.step',version:1,run:world.handleIdleTask}];
   if(town)handlers.push({kind:'town_services.inn.rest.complete',version:1,run:town.handleTask});
   if(options.worldCoreInteractionEnabled===true){
    await runtime.read(async ctx=>{await verifyInteractionReadiness(ctx);if(await ctx.tasks.currentGeneration('decision')<1)fail('decision_unavailable',503,'Decision lifecycle is not initialized');});
    let interaction:ReturnType<typeof createInteractionService>;
    const decision=createDecisionService({identity,target:{inspect:(...args)=>interaction.decisionTarget.inspect(...args),execute:(...args)=>interaction.decisionTarget.execute(...args)}});
    interaction=createInteractionService(identity,decision.sink,{...(observation?{observation}:{}),onCompletedFeedback:(ctx,fact)=>relationships.recordCompletedFeedback(ctx,fact)});
    operations.push(...interactionGatewayOperations(interaction,identity),...decisionGatewayOperations(decision));guides.push(interactionGatewayGuide,decisionGatewayGuide);
    if(behaviorEnabled){behaviorLogs=createBehaviorLogService(identity,{world,relationships,interaction,...(town?{town_services:town}:{})});operations.push(...behaviorGatewayOperations(behaviorLogs));guides.push(behaviorGatewayGuide);publicReads.push(...behaviorPublicReads(behaviorLogs));}
    handlers.push({kind:'interaction.invitation.expire',version:1,run:interaction.handleTask},{kind:'interaction.activity.expire',version:1,run:interaction.handleTask},{kind:'decision.expire',version:1,run:async(ctx,scheduled)=>{if(!scheduled.lease)fail('invalid_task',400,'Decision expiry requires a lease');const task=await ctx.tasks.assertLease(scheduled.lease,ctx.now());if(task.domain!=='decision'||task.kind!=='decision.expire'||task.handlerVersion!==1||task.payloadVersion!==1||task.target.type!=='decision.request'||task.payload.decisionId!==task.target.id)fail('invalid_task',400,'Unsupported Decision task');await decision.expire(ctx,task.target.id);}});
   }
   const gateway=createAgentGateway({store:runtime,identity,operations,publicReads,guides});
   gatewayCapabilities=()=>({...gateway.capabilities(),worldSimulation:{enabled:true,actionAdvancement:'deterministic-rule-tasks',movementPolicyVersion:1,stepIntervalMs:1000,pollIntervalMs:1000,idleLife:{enabled:true,policyVersion:IDLE_LIFE_POLICY_V1.version,stepIntervalMs:IDLE_LIFE_POLICY_V1.stepIntervalMs,maxPathLength:IDLE_LIFE_POLICY_V1.maxPathLength,minRestMs:IDLE_LIFE_POLICY_V1.minRestMs,restJitterMs:IDLE_LIFE_POLICY_V1.restJitterMs},externalAgentExecution:false}});
   const gatewayHttp=registerAgentGatewayRoutes(app,gateway,{instanceId:store.instanceId,now:options.clock??Date.now});registerWorldObservationRoutes(gateway,gatewayHttp);if(behaviorLogs)registerBehaviorLogRoutes(gateway,gatewayHttp);
   if(town)registerTownObservationRoutes(gateway,gatewayHttp);
   const scheduler=createDeterministicScheduler({store:runtime,workerId:`world-rules-${process.pid}`,handlers,batchLimit:10,leaseMs:30000});
   let nextIdleDiscovery=0,idleAfter:string|undefined;
   ruleDriver=createWorldRuleDriver({async runDue(){const now=(options.clock??Date.now)();if(now>=nextIdleDiscovery){idleAfter=await runtime!.transaction(ctx=>world.ensureIdleLife(ctx,'default',idleAfter));nextIdleDiscovery=now+IDLE_LIFE_POLICY_V1.scanIntervalMs;}return scheduler.runDue();},close:()=>scheduler.close()});app.addHook('onReady',async()=>{ruleDriver!.start();});
  }
  app.get('/health',async(_request,reply)=>{try{if(runtime)await runtime.read(ctx=>verifyWorldReadiness(ctx));return await store.read(async()=>({status:'ok',phase:'M1',apiVersion:'1',instanceId:store.instanceId,...(runtime?{worldCore:'ready'}:{})}));}catch{return reply.code(503).send({status:'unavailable',error:{code:'storage_unavailable'}});}});
  const service=createM1Service(store,{legacyAvatarIdentity:readLegacyAvatarIdentity,...(options.clock?{now:options.clock}:{}),...(options.email?{email:options.email}:{}),...(options.perception?{perception:options.perception}:{}),...(gatewayCapabilities?{gateway:gatewayCapabilities}:{}),...(friendshipOwnerRead?{friendshipOwnerRead}:{})});
  registerM1Routes(app,service);registerPerceptionRoutes(app,service);registerSiteRoutes(app);return app;
 }catch(error){try{await ruleDriver?.close();await runtime?.close();}finally{await store.close();}throw error;}
}
