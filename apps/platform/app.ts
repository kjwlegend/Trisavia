import {avatarStorageRoot} from './configuration/avatar-storage.ts';
import {createAvatarAssetService} from './application/avatar-assets-service.ts';
import {localAvatarStore} from './infrastructure/assets/local-avatar-store.ts';
import {registerAvatarAssetRoutes} from './transport/http/avatar-assets-routes.ts';
import {avatarAssetGatewayOperations,avatarAssetGatewayGuide} from './application/agent-gateway-avatar-assets.ts';
import {avatarAssetSpec} from './application/avatar-assets-protocol.ts';
import {WORLD_REPOSITORY} from './domains/world/repository.ts';
import {BEHAVIOR_REPOSITORY} from './domains/behavior/repository.ts';
import {townGatewayGuide as frozenTownGuide,townGatewayOperations as frozenTownOperations,townPublicReads as frozenTownReads} from './application/agent-gateway-town-frozen-v3.ts';
import {behaviorGatewayGuide as frozenBehaviorGuide,behaviorGatewayOperations as frozenBehaviorOperations,behaviorPublicReads as frozenBehaviorReads} from './application/agent-gateway-behavior-frozen-v4.ts';
import {createLifeService} from './application/life-service.ts';
import {LIFE_REPOSITORY} from './domains/life/repository.ts';
import {LIFE_WALLET_REPOSITORY} from './domains/wallet/life-wallet.ts';
import {lifeGatewayGuide,lifeGatewayOperations,lifePublicReads} from './application/agent-gateway-life.ts';
import {registerLifeObservationRoutes} from './transport/http/life-routes.ts';
import {registerHealthRoute} from './transport/http/health-routes.ts';
import {createPublicIdentifierService} from './application/public-identifiers.ts';
import {publicIdentifierGatewayOperations,publicIdentifierPublicReads,publicIdentifierGatewayGuide} from './application/agent-gateway-public-identifiers.ts';
import {registerPublicIdentifierRoutes} from './transport/http/public-identifier-routes.ts';
import type { EmailConfig } from './infrastructure/email/resend.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import { createM1Service } from './application/m1-service.ts';
import { verifyApplicationReadiness } from './application/bootstrap.ts';
import { openPostgresStore,readLegacyAvatarIdentity, type OpenPostgresStoreOptions } from './infrastructure/postgresql/postgres-store.ts';
import { registerM1Routes } from './transport/http/m1-routes.ts';
import { registerSiteRoutes } from './transport/http/site-routes.ts';
import { registerPerceptionRoutes } from './transport/http/perception-routes.ts';
import {createWorldAnnouncements} from './application/world-announcements.ts';
import {registerWorldAnnouncementRoutes} from './transport/http/world-announcement-routes.ts';
import {createPerceptionService} from './application/perception-service.ts';
import {createOwnerMailboxService} from './application/owner-mailbox-service.ts';
import {authenticateCredential} from './domains/access/authentication.ts';
import {runtimeIdentitySession} from './infrastructure/postgresql/runtime-store.ts';
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
import { fail, M1Error, object } from './domains/common/errors.ts';
import { IDLE_LIFE_POLICY_V1 } from './domains/world/idle-life.ts';
import {createTownService} from './application/town-services.ts';
import {TOWN_REPOSITORY} from './domains/town-services/repository.ts';
import {townGatewayGuide,townGatewayOperations,townPublicReads} from './application/agent-gateway-town.ts';
import {registerTownObservationRoutes} from './transport/http/town-services-routes.ts';
import {catalogRepository} from './domains/perception/repository.ts';
import {NPC_SERVICE_ITEMS_SOURCE,plain} from './domains/perception/protocol.ts';

export interface BuildAppOptions extends OpenPostgresStoreOptions {
 avatarAssetRoot?:string;perception?:PerceptionOptions;email?:EmailConfig;clock?:()=>number;trustProxyLoopback?:boolean;worldCoreEnabled?:boolean;worldCoreInteractionEnabled?:boolean;
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
  let ownerMailboxRead:((raw:unknown,token:unknown)=>Promise<JsonObject>)|undefined;
  let friendshipOwnerRead:((raw:unknown,token:unknown)=>Promise<JsonObject>)|undefined;
  if(options.worldCoreEnabled===true){
   runtime=await openPostgresRuntimeStore({...options,...(options.clock?{now:options.clock}:{})});
   await runtime.read(ctx=>verifyWorldReadiness(ctx));
   const identity=createRuntimeIdentity(options.recoveryEpoch,options.clock??Date.now,readLegacyAvatarIdentity);
   const behaviorEnabled=options.worldCoreInteractionEnabled===true&&await runtime.read(behaviorSourcesEnabled),observation=behaviorEnabled?createRuntimeObservation(identity):undefined;
   const townEnabled=await runtime.read(async ctx=>!!await ctx.repository(TOWN_REPOSITORY).getCatalog());
   if(townEnabled&&(!behaviorEnabled||!await store.read(async tx=>plain((await catalogRepository(tx).get('current'))?.data.sourceStates)[NPC_SERVICE_ITEMS_SOURCE]==='enabled')))fail('town_services_unavailable',503,'Activate the source coverage and exact real item catalog before starting town services');
   const lifeEnabled=await runtime.read(async ctx=>!!await ctx.repository(LIFE_REPOSITORY).getCatalog());let life:ReturnType<typeof createLifeService>|undefined;
   if(lifeEnabled&&(!townEnabled||!behaviorEnabled))fail('life_not_enabled',503,'Life requires the real town and result coverage');
   if(lifeEnabled){await runtime.read(async ctx=>{const c=(await ctx.repository(LIFE_REPOSITORY).getCatalog())!,w=await ctx.repository(WORLD_REPOSITORY).getWorld('default'),coverage=await ctx.repository(BEHAVIOR_REPOSITORY).getCoverage();if(w?.rulesetVersion!==c.map.rulesetVersion||!coverage.some(x=>x.scope==='life')||await ctx.tasks.currentGeneration('life')<1)fail('life_not_enabled',503,'Activate the matching life topology, coverage and task generation');for(const n of c.npcProfiles)if(!await ctx.repository(LIFE_REPOSITORY).getNpc(n.id)||!await ctx.repository(LIFE_REPOSITORY).getActor({kind:'npc',id:n.id})||!await ctx.repository(LIFE_WALLET_REPOSITORY).getAccount({kind:'npc',id:n.id}))fail('life_not_enabled',503,'Initialize all four real NPC actors and accounts');});if(!await store.read(async tx=>['catalog-life-a-1','catalog-avatar-assets-1','catalog-avatar-assets-fresh-1'].includes(String((await catalogRepository(tx).get('current'))?.data.catalogRevision))))fail('life_not_enabled',503,'Publish the exact current life guide before startup');}
   const town=townEnabled?createTownService(identity,{...(observation?{observation}:{}),...(lifeEnabled?{currentNpcs:(ctx,worldId)=>life!.currentNpcs(ctx,worldId),life:{assertAvailable:(ctx,id)=>life!.legacyRest.assertAvailable(ctx,id),lockActor:(ctx,worldId,id)=>life!.legacyRest.lockActor(ctx,worldId,id),start:(ctx,p,op)=>life!.legacyRest.start(ctx,p,op),validate:(ctx,op)=>life!.legacyRest.validate(ctx,op),finish:(ctx,op,completed,code)=>life!.legacyRest.finish(ctx,op,completed,code),owns:(ctx,op)=>life!.legacyRest.owns(ctx,op)}}:{})}):undefined;
   if(lifeEnabled)life=createLifeService(identity,{rewardCompletedWork:(ctx,input)=>ctx.repository(LIFE_WALLET_REPOSITORY).rewardCompletedWork(input),initializeNpc:(ctx,input)=>ctx.repository(LIFE_WALLET_REPOSITORY).initializeNpc(input)},{interruptLegacy:(ctx,id,reason)=>town!.worldActivity.interrupt(ctx,'default',id,reason)});
   const world=createWorldService(identity,{...(observation?{observation}:{}),...(town?{activities:life?{lockActor:(ctx,worldId,id)=>life!.worldActivity.lockActor(ctx,worldId,id),async isOccupied(ctx,worldId,id){return await town.worldActivity.isOccupied(ctx,worldId,id)||await life!.worldActivity.isOccupied(ctx,worldId,id);},async interrupt(ctx,worldId,id,reason){await town.worldActivity.interrupt(ctx,worldId,id,reason);await life!.worldActivity.interrupt(ctx,worldId,id,reason);}}:town.worldActivity,currentNpcs:town.currentNpcs}:{}),...(life?{publicActivity:(ctx,id)=>life!.publicActivity(ctx,{kind:'agent',id})}:{})}),relationships=createRelationshipsService(identity,{...(observation?{observation}:{})}),operations=[...worldGatewayOperations(world),...relationshipsGatewayOperations(relationships)],guides=[worldGatewayGuide,relationshipsGatewayGuide],publicReads=worldPublicReads(world);
   if(life){operations.push(...lifeGatewayOperations(life));guides.push(lifeGatewayGuide);publicReads.push(...lifePublicReads(life));}
   if(town){operations.push(...(life?townGatewayOperations(town):frozenTownOperations(town)));guides.push(life?townGatewayGuide:frozenTownGuide);publicReads.push(...(life?townPublicReads(town):frozenTownReads(town)));}
   const publicIdentifiers=createPublicIdentifierService(identity,town?(ctx)=>town.currentNpcs(ctx,'default'):undefined);operations.push(...publicIdentifierGatewayOperations(publicIdentifiers));guides.push(publicIdentifierGatewayGuide);publicReads.push(...publicIdentifierPublicReads(publicIdentifiers));
   let behaviorLogs:ReturnType<typeof createBehaviorLogService>|undefined;
   friendshipOwnerRead=(raw,token)=>runtime!.read(async ctx=>{
    const input=object(raw,['agentId','search','order','cursor','limit']),principal=await identity.authenticate(ctx,token,['owner_session']);
    return await relationships.friends(ctx,principal,input as JsonObject);
   });
   const handlers:DeterministicTaskHandler[]=[{kind:'world.movement.step',version:1,run:world.handleTask},{kind:'world.idle.step',version:1,run:world.handleIdleTask}];
   if(life)handlers.push({kind:'life.actor.tick',version:1,run:life.handleTask,retryDelaysMs:[1000,5000,15000]});
   if(town)handlers.push({kind:'town_services.inn.rest.complete',version:1,run:town.handleTask});
   if(options.worldCoreInteractionEnabled===true){
    await runtime.read(async ctx=>{await verifyInteractionReadiness(ctx);if(await ctx.tasks.currentGeneration('decision')<1)fail('decision_unavailable',503,'Decision lifecycle is not initialized');});
    let interaction:ReturnType<typeof createInteractionService>;
    const decision=createDecisionService({identity,target:{inspect:(...args)=>interaction.decisionTarget.inspect(...args),execute:(...args)=>interaction.decisionTarget.execute(...args)}});
    interaction=createInteractionService(identity,decision.sink,{...(observation?{observation}:{}),onCompletedFeedback:(ctx,fact)=>relationships.recordCompletedFeedback(ctx,fact)});
    const mailboxPerception=createPerceptionService(store,{authenticate:(session,token,kinds)=>authenticateCredential(session,token,kinds,{recoveryEpoch:store.recoveryEpoch,now:options.clock??Date.now})},{...options.perception,...(options.clock?{now:options.clock}:{}),legacyAvatarIdentity:readLegacyAvatarIdentity});
    const mailbox=createOwnerMailboxService(identity,{perception:(ctx,token,agentId)=>mailboxPerception.ownerMailboxContext(runtimeIdentitySession(ctx),token,agentId),exchange:interaction.readOwnerExchange});
    ownerMailboxRead=async(raw,token)=>{try{return await runtime!.read(ctx=>mailbox.query(ctx,token,raw));}catch(error){if(error instanceof M1Error)throw error;fail("source_unavailable",503,"Mailbox collection source is unavailable");}};
    operations.push(...interactionGatewayOperations(interaction,identity),...decisionGatewayOperations(decision));guides.push(interactionGatewayGuide,decisionGatewayGuide);
    if(behaviorEnabled){behaviorLogs=createBehaviorLogService(identity,{world,relationships,interaction,...(town?{town_services:town}:{}),...(life?{life}:{})});operations.push(...(life?behaviorGatewayOperations(behaviorLogs):frozenBehaviorOperations(behaviorLogs)));guides.push(life?behaviorGatewayGuide:frozenBehaviorGuide);publicReads.push(...(life?behaviorPublicReads(behaviorLogs):frozenBehaviorReads(behaviorLogs)));}
    handlers.push({kind:'interaction.invitation.expire',version:1,run:interaction.handleTask},{kind:'interaction.activity.expire',version:1,run:interaction.handleTask},{kind:'decision.expire',version:1,run:async(ctx,scheduled)=>{if(!scheduled.lease)fail('invalid_task',400,'Decision expiry requires a lease');const task=await ctx.tasks.assertLease(scheduled.lease,ctx.now());if(task.domain!=='decision'||task.kind!=='decision.expire'||task.handlerVersion!==1||task.payloadVersion!==1||task.target.type!=='decision.request'||task.payload.decisionId!==task.target.id)fail('invalid_task',400,'Unsupported Decision task');await decision.expire(ctx,task.target.id);}});
   }
   const avatarAssets=createAvatarAssetService(identity,localAvatarStore(options.avatarAssetRoot??avatarStorageRoot(options.instanceId)));
   registerAvatarAssetRoutes(app,runtime,identity,avatarAssets,options.clock??Date.now);operations.push(...avatarAssetGatewayOperations());guides.push(avatarAssetGatewayGuide);
   const gateway=createAgentGateway({store:runtime,identity,operations,publicReads,guides});
   gatewayCapabilities=()=>({...gateway.capabilities(),worldSimulation:{enabled:true,actionAdvancement:'deterministic-rule-tasks',movementPolicyVersion:1,stepIntervalMs:1000,pollIntervalMs:1000,idleLife:{enabled:true,policyVersion:IDLE_LIFE_POLICY_V1.version,stepIntervalMs:IDLE_LIFE_POLICY_V1.stepIntervalMs,maxPathLength:IDLE_LIFE_POLICY_V1.maxPathLength,minRestMs:IDLE_LIFE_POLICY_V1.minRestMs,restJitterMs:IDLE_LIFE_POLICY_V1.restJitterMs},externalAgentExecution:false}});
   const gatewayHttp=registerAgentGatewayRoutes(app,gateway,{instanceId:store.instanceId,now:options.clock??Date.now});registerWorldObservationRoutes(gateway,gatewayHttp);if(behaviorLogs)registerBehaviorLogRoutes(gateway,gatewayHttp);
   if(life)registerLifeObservationRoutes(gateway,gatewayHttp);if(town)registerTownObservationRoutes(gateway,gatewayHttp);registerPublicIdentifierRoutes(gateway,gatewayHttp);
   const scheduler=createDeterministicScheduler({store:runtime,workerId:`world-rules-${process.pid}`,handlers,batchLimit:10,leaseMs:30000});
   let nextIdleDiscovery=0,idleAfter:string|undefined,lifeAfter:string|undefined;
   ruleDriver=createWorldRuleDriver({async runDue(){const now=(options.clock??Date.now)();if(now>=nextIdleDiscovery){idleAfter=await runtime!.transaction(ctx=>world.ensureIdleLife(ctx,'default',idleAfter));if(life)lifeAfter=await runtime!.transaction(ctx=>life!.reconcile(ctx,lifeAfter));nextIdleDiscovery=now+IDLE_LIFE_POLICY_V1.scanIntervalMs;}return scheduler.runDue();},close:()=>scheduler.close()});app.addHook('onReady',async()=>{ruleDriver!.start();});
  }
  registerHealthRoute(app,async()=>{if(runtime)await runtime.read(ctx=>verifyWorldReadiness(ctx));return await store.read(async()=>({instanceId:store.instanceId,...(runtime?{worldCore:'ready' as const}:{})}));});
  const service=createM1Service(store,{legacyAvatarIdentity:readLegacyAvatarIdentity,...(options.clock?{now:options.clock}:{}),...(options.email?{email:options.email}:{}),...(options.perception?{perception:options.perception}:{}),...(gatewayCapabilities?{gateway:gatewayCapabilities,avatarAssetsApi:avatarAssetSpec}:{}),...(friendshipOwnerRead?{friendshipOwnerRead}:{}),...(ownerMailboxRead?{ownerMailboxRead}:{})});
  registerM1Routes(app,service);registerPerceptionRoutes(app,service);registerWorldAnnouncementRoutes(app,createWorldAnnouncements(store,options.clock??Date.now));registerSiteRoutes(app);return app;
 }catch(error){try{await ruleDriver?.close();await runtime?.close();}finally{await store.close();}throw error;}
}
