import {approvedWorldGuide,approvedLifeGuide,APPROVED_LIFE_ACTION_IDS,withApprovedLifeOperations,withApprovedLifeReads} from './application/agent-approved-current-guides.ts';
import {createNpcLifeService,npcLifeEnabled} from './application/npc-life-service.ts';
import {npcLifeGatewayOperations,npcLifePublicReads} from './application/agent-gateway-npc-life.ts';
import {npcLifeGatewayGuide} from './application/npc-life-guide.ts';
import {withNpcCareLifeOperations,withNpcCareLifeReads,npcCareLifeGuide,npcCareWorldGuide,NPC_CARE_CHANGED_LIFE_IDS,NPC_CARE_CHANGED_WORLD_IDS} from './application/agent-gateway-npc-care-life.ts';
import {withNpcCareWorldOperations,withNpcCareWorldReads} from './application/agent-gateway-npc-care-world.ts';
import {withNpcCareBehaviorOperations,withNpcCareBehaviorReads,npcCareBehaviorGuide} from './application/agent-gateway-npc-care-behavior.ts';
import {residentJournalGatewayOperations,residentJournalGatewayGuide,withResidentJournalHistory} from './application/agent-gateway-resident-journal.ts';
import {NPC_IDENTITY_CHANGED_IDS,withNpcIdentityOperations,withNpcIdentityReads,residentWorldGuide,residentTownGuide,residentNpcLifeGuide} from './application/agent-gateway-npc-identities.ts';
import {effectiveLifeCatalogForWorld} from './domains/life/current-spatial.ts';
import {withTownExpansionOperations,withTownExpansionPublicReads} from './application/agent-gateway-world-expansion.ts';
import {autonomousWorldGuide,autonomousLifeGuide} from './application/agent-autonomous-life-guide.ts';
import {withAutonomousLifeOperations,withAutonomousLifeReads,retainedLifeActionSchemas} from './application/agent-gateway-autonomous-life.ts';
import {CURRENT_MOVEMENT_POLICY,CURRENT_WORLD_RULE_INTERVAL_MS} from './domains/world/movement-policy.ts';
import {quoteWorldGuide} from './application/agent-quote-communication-guide.ts';
import {readAgentRuntimeGuide,type AgentRuntimeGuideProvider} from './application/agent-runtime-guide.ts';
import {runtimeWorldGuide} from './application/agent-runtime-publication.ts';
import {registerAgentRuntimeRoute} from './transport/http/agent-runtime-routes.ts';
import {withJournalOperations,withJournalReads,journalGatewayGuide} from './application/agent-gateway-journal.ts';
import {createWorldExpressions} from './application/world-expressions.ts';
import {expressionGatewayOperations,withExpressionOperations,withExpressionReads,worldExpressionGuide} from './application/agent-gateway-world-expressions.ts';
import {lifeCGatewayOperations,lifeCPublicReads,lifeCGatewayGuide} from './application/agent-gateway-life-c.ts';
import {worldCLifeOperations,worldCLifeReads,worldCLifeGuide,townCLifeOperations,townCLifeReads,townCLifeGuide,behaviorCLifeOperations,behaviorCLifeReads,behaviorCLifeGuide} from './application/agent-gateway-life-c-projections.ts';
import {createRelationshipGiftsService} from './application/relationships-gifts.ts';
import {giftGatewayOperations,giftGatewayGuide} from './application/agent-gateway-gifts.ts';
import {lifeBGatewayOperations,lifeBPublicReads,lifeBGatewayGuide} from './application/agent-gateway-life-b.ts';
import {worldBLifeOperations,worldBLifeReads,worldBLifeGuide,townBLifeOperations,townBLifeReads,townBLifeGuide,behaviorBLifeOperations,behaviorBLifeReads,behaviorBLifeGuide} from './application/agent-gateway-life-b-projections.ts';
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
import type { JsonObject,M1Store } from './contracts/store.ts';
import { createRuntimeIdentity,createRuntimeObservation } from './application/runtime-identity.ts';
import { behaviorSourcesEnabled,createBehaviorLogService } from './application/behavior-log-service.ts';
import { behaviorGatewayOperations,behaviorPublicReads,behaviorGatewayGuide } from './application/agent-gateway-behavior.ts';
import { registerBehaviorLogRoutes } from './transport/http/behavior-log-routes.ts';
import { createWorldService, verifyWorldReadiness } from './application/world-service.ts';
import { createRelationshipsService } from './application/relationships-service.ts';
import { relationshipsGatewayOperations, relationshipsGatewayGuide } from './application/agent-gateway-relationships.ts';
import { createAgentGateway,gatewayOperationSchemas,gatewayPublicReadSchemas } from './application/agent-gateway.ts';
import { worldGatewayGuide, worldGatewayOperations, worldGatewayLegacyOperations, worldPublicReads } from './application/agent-gateway-world.ts';
import { registerAgentGatewayRoutes } from './transport/http/agent-gateway-routes.ts';
import { registerWorldObservationRoutes } from './transport/http/agent-gateway-world-routes.ts';
import { createDeterministicScheduler, type DeterministicTaskHandler } from './infrastructure/scheduling/deterministic-scheduler.ts';
import { createWorldRuleDriver } from './application/world-rule-driver.ts';
import { createInteractionService, verifyInteractionReadiness } from './application/interaction-service.ts';
import { createDecisionService } from './application/decision-service.ts';
import { interactionGatewayGuide, interactionGatewayOperations } from './application/agent-gateway-interaction.ts';
import { decisionGatewayGuide, decisionGatewayOperations } from './application/agent-gateway-decision.ts';
import { fail, M1Error, object } from './domains/common/errors.ts';
import { CURRENT_IDLE_LIFE_POLICY } from './domains/world/idle-life.ts';
import {createTownService} from './application/town-services.ts';
import {TOWN_REPOSITORY} from './domains/town-services/repository.ts';
import {townGatewayGuide,townGatewayOperations,townPublicReads} from './application/agent-gateway-town.ts';
import {registerTownObservationRoutes} from './transport/http/town-services-routes.ts';
import {catalogRepository} from './domains/perception/repository.ts';
import {NPC_SERVICE_ITEMS_SOURCE,plain} from './domains/perception/protocol.ts';

export interface BuildAppOptions extends OpenPostgresStoreOptions {
 agentRuntimeGuide?:AgentRuntimeGuideProvider;avatarAssetRoot?:string;perception?:PerceptionOptions;email?:EmailConfig;clock?:()=>number;trustProxyLoopback?:boolean;worldCoreEnabled?:boolean;worldCoreInteractionEnabled?:boolean;
}
/** Composition-level guide gate; all physical Life/world/actor checks still run separately. */
export async function verifyLifeGuideCatalogForStartup(store:Pick<M1Store,'read'>,revision=1):Promise<void>{
 if(!await store.read(async tx=>(revision===3?['catalog-life-c-1','catalog-world-expressions-1','catalog-agent-runtime-1','catalog-approved-agent-templates-1']:revision===2?['catalog-life-b-1']:['catalog-life-a-1','catalog-avatar-assets-1','catalog-avatar-assets-fresh-1','catalog-recurring-bootstrap-1','catalog-profile-personalization-1']).includes(String((await catalogRepository(tx).get('current'))?.data.catalogRevision))))fail('life_not_enabled',503,'Publish the exact current life guide before startup');
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
  let gatewayCapabilities:(()=>JsonObject|Promise<JsonObject>)|undefined;
  let runtimeGuideProvider:AgentRuntimeGuideProvider|undefined;
  let ownerMailboxRead:((raw:unknown,token:unknown)=>Promise<JsonObject>)|undefined;
  let friendshipOwnerRead:((raw:unknown,token:unknown)=>Promise<JsonObject>)|undefined;
  if(options.worldCoreEnabled===true){
   runtime=await openPostgresRuntimeStore({...options,...(options.clock?{now:options.clock}:{})});
   await runtime.read(ctx=>verifyWorldReadiness(ctx));
   const identity=createRuntimeIdentity(options.recoveryEpoch,options.clock??Date.now,readLegacyAvatarIdentity);
   const behaviorEnabled=options.worldCoreInteractionEnabled===true&&await runtime.read(behaviorSourcesEnabled),observation=behaviorEnabled?createRuntimeObservation(identity):undefined;
   const townEnabled=await runtime.read(async ctx=>!!await ctx.repository(TOWN_REPOSITORY).getCatalog());
   if(townEnabled&&(!behaviorEnabled||!await store.read(async tx=>plain((await catalogRepository(tx).get('current'))?.data.sourceStates)[NPC_SERVICE_ITEMS_SOURCE]==='enabled')))fail('town_services_unavailable',503,'Activate the source coverage and exact real item catalog before starting town services');
   const lifeRevision=await runtime.read(async ctx=>(await ctx.repository(LIFE_REPOSITORY).getCatalog())?.revision??0),lifeCEnabled=lifeRevision===3,lifeBEnabled=lifeRevision===2,lifeEnabled=lifeRevision>0;let life:ReturnType<typeof createLifeService>|undefined,gifts:ReturnType<typeof createRelationshipGiftsService>|undefined;
   if(lifeEnabled&&(!townEnabled||!behaviorEnabled))fail('life_not_enabled',503,'Life requires the real town and result coverage');
   if(lifeEnabled){await runtime.read(async ctx=>{const c=(await ctx.repository(LIFE_REPOSITORY).getCatalog())!,w=await ctx.repository(WORLD_REPOSITORY).getWorld('default'),coverage=await ctx.repository(BEHAVIOR_REPOSITORY).getCoverage(),rules=w&&await ctx.repository(WORLD_REPOSITORY).getRuleset('default',w.rulesetVersion);if(!rules)fail('life_not_enabled',503,'The current World rules are required');const effective=effectiveLifeCatalogForWorld(c,rules);if(w?.rulesetVersion!==effective.map.rulesetVersion||!coverage.some(x=>x.scope==='life')||await ctx.tasks.currentGeneration('life')<1)fail('life_not_enabled',503,'Activate the matching life topology, coverage and task generation');if(c.revision===3&&await ctx.tasks.currentGeneration('relationships')<1)fail('gift_not_enabled',503,'Initialize the real gift source generation before startup');for(const n of c.npcProfiles)if(!await ctx.repository(LIFE_REPOSITORY).getNpc(n.id)||!await ctx.repository(LIFE_REPOSITORY).getActor({kind:'npc',id:n.id})||!await ctx.repository(LIFE_WALLET_REPOSITORY).getAccount({kind:'npc',id:n.id}))fail('life_not_enabled',503,'Initialize all four real NPC actors and accounts');});await verifyLifeGuideCatalogForStartup(store,lifeRevision);}
   const town=townEnabled?createTownService(identity,{...(observation?{observation}:{}),...(lifeEnabled?{currentNpcs:(ctx,worldId)=>life!.currentNpcs(ctx,worldId),life:{facility:(ctx,catalogVersion,serviceId)=>life!.legacyRest.facility(ctx,catalogVersion,serviceId),assertAvailable:(ctx,id)=>life!.legacyRest.assertAvailable(ctx,id),lockActor:(ctx,worldId,id)=>life!.legacyRest.lockActor(ctx,worldId,id),start:(ctx,p,op)=>life!.legacyRest.start(ctx,p,op),validate:(ctx,op)=>life!.legacyRest.validate(ctx,op),finish:(ctx,op,completed,code)=>life!.legacyRest.finish(ctx,op,completed,code),owns:(ctx,op)=>life!.legacyRest.owns(ctx,op)}}:{})}):undefined;
   const npcLifeActive=await runtime.read(npcLifeEnabled),npcLife=npcLifeActive?createNpcLifeService(identity,{life:()=>life!.npcLifeHost}):undefined;
   const activeCatalog=await store.read(async tx=>(await catalogRepository(tx).get('current'))?.data.catalogRevision),runtimeRulesEnabled=['catalog-agent-runtime-1','catalog-approved-agent-templates-1'].includes(String(activeCatalog)),expressionsEnabled=lifeCEnabled&&['catalog-world-expressions-1','catalog-agent-runtime-1','catalog-approved-agent-templates-1'].includes(String(activeCatalog)),expressions=expressionsEnabled?createWorldExpressions(identity,{publicNoticeAvailable:async ctx=>(plain((await catalogRepository(runtimeIdentitySession(ctx)).get('current'))?.data.sourceStates)['demo-announcements']==='enabled')}):undefined;
   if(npcLifeActive&&(!lifeCEnabled||!runtimeRulesEnabled))fail('npc_life_not_enabled',503,'The reviewed NPC-life extension requires the current C3 runtime guide base');
   if(lifeEnabled)life=createLifeService(identity,{rewardCompletedWork:(ctx,input)=>ctx.repository(LIFE_WALLET_REPOSITORY).rewardCompletedWork(input),initializeNpc:(ctx,input)=>ctx.repository(LIFE_WALLET_REPOSITORY).initializeNpc(input)},{...(npcLife?{npcLife:npcLife.lifeExtension}:{}),...(expressions?{onActivityStarted:expressions.onActivityStarted}:{}),interruptLegacy:(ctx,id,reason)=>town!.worldActivity.interrupt(ctx,'default',id,reason),...(lifeCEnabled?{giftState:(ctx,id,giftId)=>gifts!.waitState(ctx,id,giftId)}:{})});
   if(npcLife)await runtime.read(ctx=>npcLife.query(ctx,null,'npc_life.directory',{}));
   const world=createWorldService(identity,{...(expressions?{expressions:expressions.read,withdrawExpressions:expressions.withdraw}:{}),...(observation?{observation}:{}),...(town?{activities:life?{lockActor:(ctx,worldId,id)=>life!.worldActivity.lockActor(ctx,worldId,id),async isOccupied(ctx,worldId,id){return await town.worldActivity.isOccupied(ctx,worldId,id)||await life!.worldActivity.isOccupied(ctx,worldId,id);},async interrupt(ctx,worldId,id,reason){await town.worldActivity.interrupt(ctx,worldId,id,reason);await life!.worldActivity.interrupt(ctx,worldId,id,reason);}}:town.worldActivity,currentNpcs:town.currentNpcs}:{}),...(life?{publicActivity:(ctx,id)=>life!.publicActivity(ctx,{kind:'agent',id})}:{})}),relationships=createRelationshipsService(identity,{...(observation?{observation}:{})}),operations=[...(lifeCEnabled?worldCLifeOperations(world):lifeBEnabled?worldBLifeOperations(world):worldGatewayOperations(world)),...relationshipsGatewayOperations(relationships)],guides=[lifeCEnabled?worldCLifeGuide:lifeBEnabled?worldBLifeGuide:worldGatewayGuide,relationshipsGatewayGuide],publicReads=lifeCEnabled?worldCLifeReads(world):lifeBEnabled?worldBLifeReads(world):worldPublicReads(world);
   if(lifeCEnabled&&life){gifts=createRelationshipGiftsService(identity,life,relationships);operations.push(...giftGatewayOperations(gifts));guides[1]=giftGatewayGuide;}
   if(expressions){operations.splice(0,operations.length,...withExpressionOperations(operations),...expressionGatewayOperations(expressions));publicReads.splice(0,publicReads.length,...withExpressionReads(publicReads));guides[0]=worldExpressionGuide;}
   if(life){operations.push(...(lifeCEnabled?lifeCGatewayOperations(life):lifeBEnabled?lifeBGatewayOperations(life):lifeGatewayOperations(life)));guides.push(lifeCEnabled?lifeCGatewayGuide:lifeBEnabled?lifeBGatewayGuide:lifeGatewayGuide);publicReads.push(...(lifeCEnabled?lifeCPublicReads(life):lifeBEnabled?lifeBPublicReads(life):lifePublicReads(life)));}
   if(town){operations.push(...(lifeCEnabled?townCLifeOperations(town):lifeBEnabled?townBLifeOperations(town):life?townGatewayOperations(town):frozenTownOperations(town)));guides.push(lifeCEnabled?townCLifeGuide:lifeBEnabled?townBLifeGuide:life?townGatewayGuide:frozenTownGuide);publicReads.push(...(lifeCEnabled?townCLifeReads(town):lifeBEnabled?townBLifeReads(town):life?townPublicReads(town):frozenTownReads(town)));}
   const publicIdentifiers=createPublicIdentifierService(identity,town?(ctx)=>town.currentNpcs(ctx,'default'):undefined);operations.push(...publicIdentifierGatewayOperations(publicIdentifiers));guides.push(publicIdentifierGatewayGuide);publicReads.push(...publicIdentifierPublicReads(publicIdentifiers));
   let behaviorLogs:ReturnType<typeof createBehaviorLogService>|undefined;
   friendshipOwnerRead=(raw,token)=>runtime!.read(async ctx=>{
    const input=object(raw,['agentId','search','order','cursor','limit']),principal=await identity.authenticate(ctx,token,['owner_session']);
    return await relationships.friends(ctx,principal,input as JsonObject);
   });
   const handlers:DeterministicTaskHandler[]=[{kind:'world.movement.step',version:1,run:world.handleTask},{kind:'world.idle.step',version:1,run:world.handleIdleTask}];
   if(life)handlers.push({kind:'life.actor.tick',version:1,run:life.handleTask,retryDelaysMs:[1000,5000,15000]});
   if(gifts)handlers.push({kind:'relationships.gift.expire',version:1,run:gifts.handleTask,retryDelaysMs:[1000,5000,15000]},{kind:'life.remote.wake',version:1,run:life!.handleRemoteWake,retryDelaysMs:[1000,5000,15000]});
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
    if(behaviorEnabled){behaviorLogs=createBehaviorLogService(identity,{world,relationships:gifts?{...relationships,canObserveBehavior:(ctx,row,audience)=>row.sourceRef.type==='relationship_gift'?gifts!.canObserveBehavior(ctx,row,audience):relationships.canObserveBehavior(ctx,row,audience),describeBehavior:(ctx,row,audience)=>row.sourceRef.type==='relationship_gift'?gifts!.describeBehavior(ctx,row,audience):relationships.describeBehavior(ctx,row,audience)}:relationships,interaction,...(town?{town_services:town}:{}),...(life?{life}:{})},{journalEnabled:expressionsEnabled});operations.push(...(expressionsEnabled?withJournalOperations(behaviorCLifeOperations(behaviorLogs)):lifeCEnabled?behaviorCLifeOperations(behaviorLogs):lifeBEnabled?behaviorBLifeOperations(behaviorLogs):life?behaviorGatewayOperations(behaviorLogs):frozenBehaviorOperations(behaviorLogs)));guides.push(expressionsEnabled?journalGatewayGuide:lifeCEnabled?behaviorCLifeGuide:lifeBEnabled?behaviorBLifeGuide:life?behaviorGatewayGuide:frozenBehaviorGuide);publicReads.push(...(expressionsEnabled?withJournalReads(behaviorCLifeReads(behaviorLogs)):lifeCEnabled?behaviorCLifeReads(behaviorLogs):lifeBEnabled?behaviorBLifeReads(behaviorLogs):life?behaviorPublicReads(behaviorLogs):frozenBehaviorReads(behaviorLogs)));}
    handlers.push({kind:'interaction.invitation.expire',version:1,run:interaction.handleTask},{kind:'interaction.activity.expire',version:1,run:interaction.handleTask},{kind:'decision.expire',version:1,run:async(ctx,scheduled)=>{if(!scheduled.lease)fail('invalid_task',400,'Decision expiry requires a lease');const task=await ctx.tasks.assertLease(scheduled.lease,ctx.now());if(task.domain!=='decision'||task.kind!=='decision.expire'||task.handlerVersion!==1||task.payloadVersion!==1||task.target.type!=='decision.request'||task.payload.decisionId!==task.target.id)fail('invalid_task',400,'Unsupported Decision task');await decision.expire(ctx,task.target.id);}});
   }
   const avatarAssets=createAvatarAssetService(identity,localAvatarStore(options.avatarAssetRoot??avatarStorageRoot(options.instanceId)));
   registerAvatarAssetRoutes(app,runtime,identity,avatarAssets,options.clock??Date.now);operations.push(...avatarAssetGatewayOperations());guides.push(avatarAssetGatewayGuide);
   if(runtimeRulesEnabled){runtimeGuideProvider=options.agentRuntimeGuide??readAgentRuntimeGuide;guides[0]=autonomousWorldGuide;registerAgentRuntimeRoute(app,runtimeGuideProvider,store.instanceId);}
   const retainedSchemas=worldGatewayLegacyOperations(world).filter(o=>['world.movement','world.avatar.create','world.avatar.move','world.avatar.leave','world.movement.stop'].includes(o.id)).flatMap(gatewayOperationSchemas);
   retainedSchemas.push(...operations.filter(o=>['world.rules','world.map_manifest'].includes(o.id)).flatMap(gatewayOperationSchemas),...publicReads.filter(r=>['world.public_rules','world.public_map_manifest'].includes(r.id)).flatMap(gatewayPublicReadSchemas));operations.splice(0,operations.length,...withTownExpansionOperations(operations));publicReads.splice(0,publicReads.length,...withTownExpansionPublicReads(publicReads));
   if(runtimeGuideProvider&&lifeCEnabled){retainedSchemas.push(...retainedLifeActionSchemas(operations,publicReads));operations.splice(0,operations.length,...withAutonomousLifeOperations(operations));publicReads.splice(0,publicReads.length,...withAutonomousLifeReads(publicReads));guides[guides.findIndex(g=>g.moduleId==='life')]=autonomousLifeGuide;}
   const retainedGuides=runtimeGuideProvider?[worldExpressionGuide,runtimeWorldGuide,quoteWorldGuide,...(lifeCEnabled?[lifeCGatewayGuide,lifeBGatewayGuide]:[])]:[];
   if(npcLife&&life){
    const changed=new Set<string>([...NPC_CARE_CHANGED_LIFE_IDS,...NPC_CARE_CHANGED_WORLD_IDS,'behavior.owner_history','behavior.public_world','behavior.public_recent']);
    retainedSchemas.push(...operations.filter(o=>changed.has(o.id)).flatMap(gatewayOperationSchemas),...publicReads.filter(r=>changed.has(r.id)).flatMap(gatewayPublicReadSchemas));
    const lifeOps=new Map(withNpcCareLifeOperations(lifeCGatewayOperations(life)).map(o=>[o.id,o])),lifeReads=new Map(withNpcCareLifeReads(lifeCPublicReads(life)).map(r=>[r.id,r]));
    operations.splice(0,operations.length,...withNpcCareBehaviorOperations(withNpcCareWorldOperations(operations.map(o=>lifeOps.get(o.id)??o))));publicReads.splice(0,publicReads.length,...withNpcCareBehaviorReads(withNpcCareWorldReads(publicReads.map(r=>lifeReads.get(r.id)??r))));
    retainedGuides.push(autonomousWorldGuide,autonomousLifeGuide,journalGatewayGuide);guides.splice(guides.findIndex(g=>g.moduleId==='world'),1,npcCareWorldGuide);guides.splice(guides.findIndex(g=>g.moduleId==='life'),1,npcCareLifeGuide);guides.splice(guides.findIndex(g=>g.moduleId==='behavior'),1,npcCareBehaviorGuide);
    operations.push(...npcLifeGatewayOperations(npcLife));publicReads.push(...npcLifePublicReads(npcLife));guides.push(npcLifeGatewayGuide);
   }
   if(behaviorLogs){
    const previous=operations.find(operation=>operation.id==='behavior.owner_history')!;
    retainedSchemas.push(...gatewayOperationSchemas(previous));
    const [current]=withResidentJournalHistory([previous]);operations.splice(operations.indexOf(previous),1,current!);
    const guideIndex=guides.findIndex(guide=>guide.moduleId==='behavior');retainedGuides.push(guides[guideIndex]!);guides.splice(guideIndex,1,residentJournalGatewayGuide);
    operations.push(...residentJournalGatewayOperations(behaviorLogs,current!));
   }
   retainedSchemas.push(...operations.filter(operation=>NPC_IDENTITY_CHANGED_IDS.has(operation.id)).flatMap(gatewayOperationSchemas),...publicReads.filter(read=>NPC_IDENTITY_CHANGED_IDS.has(read.id)).flatMap(gatewayPublicReadSchemas));
   operations.splice(0,operations.length,...withNpcIdentityOperations(operations));publicReads.splice(0,publicReads.length,...withNpcIdentityReads(publicReads));
   for(const guide of [residentWorldGuide,residentTownGuide,residentNpcLifeGuide]){const index=guides.findIndex(previous=>previous.moduleId===guide.moduleId);if(index>=0){retainedGuides.push(guides[index]!);guides.splice(index,1,guide);}}
   if(runtimeGuideProvider){
    for(const guide of [approvedWorldGuide,...(npcLife?[approvedLifeGuide]:[])]){const index=guides.findIndex(previous=>previous.moduleId===guide.moduleId);if(index>=0){retainedGuides.push(guides[index]!);guides.splice(index,1,guide);}}
    if(npcLife){retainedSchemas.push(...operations.filter(o=>APPROVED_LIFE_ACTION_IDS.has(o.id)).flatMap(gatewayOperationSchemas),...publicReads.filter(r=>APPROVED_LIFE_ACTION_IDS.has(r.id)).flatMap(gatewayPublicReadSchemas));operations.splice(0,operations.length,...withApprovedLifeOperations(operations));publicReads.splice(0,publicReads.length,...withApprovedLifeReads(publicReads));}
   }
   const gateway=createAgentGateway({store:runtime,identity,operations,publicReads,guides,retainedSchemas,...(runtimeGuideProvider?{runtimeGuide:runtimeGuideProvider,retainedGuides}:{})});
   gatewayCapabilities=async()=>({...await gateway.currentCapabilities(),worldSimulation:{enabled:true,actionAdvancement:'deterministic-rule-tasks',movementPolicyVersion:CURRENT_MOVEMENT_POLICY.version,stepIntervalMs:CURRENT_MOVEMENT_POLICY.stepIntervalMs,pollIntervalMs:1000,idleLife:{enabled:true,policyVersion:CURRENT_IDLE_LIFE_POLICY.version,stepIntervalMs:CURRENT_IDLE_LIFE_POLICY.stepIntervalMs,maxPathLength:CURRENT_IDLE_LIFE_POLICY.maxPathLength,minRestMs:CURRENT_IDLE_LIFE_POLICY.minRestMs,restJitterMs:CURRENT_IDLE_LIFE_POLICY.restJitterMs},externalAgentExecution:false}});
   const gatewayHttp=registerAgentGatewayRoutes(app,gateway,{instanceId:store.instanceId,now:options.clock??Date.now});registerWorldObservationRoutes(gateway,gatewayHttp);if(behaviorLogs)registerBehaviorLogRoutes(gateway,gatewayHttp);
   if(npcLife)gatewayHttp.route('GET','/v1/world/npc-life/directory',request=>{object(request.query,[]);return gateway.publicRead('npc_life.public_directory',{},gatewayHttp.validate(request));});
   if(life)registerLifeObservationRoutes(gateway,gatewayHttp,lifeRevision);if(town)registerTownObservationRoutes(gateway,gatewayHttp);registerPublicIdentifierRoutes(gateway,gatewayHttp);
   const scheduler=createDeterministicScheduler({store:runtime,workerId:`world-rules-${process.pid}`,handlers,batchLimit:10,leaseMs:30000});
   let nextIdleDiscovery=0,idleAfter:string|undefined,lifeAfter:string|undefined,giftAfter:string|undefined;
   ruleDriver=createWorldRuleDriver({async runDue(){const now=(options.clock??Date.now)();if(now>=nextIdleDiscovery){idleAfter=await runtime!.transaction(ctx=>world.ensureIdleLife(ctx,'default',idleAfter));if(life)lifeAfter=await runtime!.transaction(ctx=>life!.reconcile(ctx,lifeAfter));if(gifts)giftAfter=await runtime!.transaction(ctx=>gifts!.reconcile(ctx,giftAfter));nextIdleDiscovery=now+CURRENT_IDLE_LIFE_POLICY.scanIntervalMs;}return scheduler.runDue();},close:()=>scheduler.close()},CURRENT_WORLD_RULE_INTERVAL_MS);app.addHook('onReady',async()=>{ruleDriver!.start();});
  }
  registerHealthRoute(app,async()=>{if(runtime)await runtime.read(ctx=>verifyWorldReadiness(ctx));return await store.read(async()=>({instanceId:store.instanceId,...(runtime?{worldCore:'ready' as const}:{})}));});
  const service=createM1Service(store,{legacyAvatarIdentity:readLegacyAvatarIdentity,...(options.clock?{now:options.clock}:{}),...(options.email?{email:options.email}:{}),...(options.perception?{perception:options.perception}:{}),...(gatewayCapabilities?{gateway:gatewayCapabilities,avatarAssetsApi:avatarAssetSpec}:{}),...(runtimeGuideProvider?{runtimeGuide:runtimeGuideProvider}:{}),...(friendshipOwnerRead?{friendshipOwnerRead}:{}),...(ownerMailboxRead?{ownerMailboxRead}:{})});
  registerM1Routes(app,service);registerPerceptionRoutes(app,service);registerWorldAnnouncementRoutes(app,createWorldAnnouncements(store,options.clock??Date.now));registerSiteRoutes(app);return app;
 }catch(error){try{await ruleDriver?.close();await runtime?.close();}finally{await store.close();}throw error;}
}
