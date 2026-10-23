import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import Fastify from 'fastify';
import {worldFixture} from './postgresql-fixture.ts';
import {operationSchema,typeSchema,errorSchema,HTTP_GUIDE} from '../../apps/platform/domains/perception/schemas.ts';
import {OPERATIONS,TYPE_DEFINITIONS,key} from '../../apps/platform/domains/perception/protocol.ts';
import {CURRENT_HOURLY_HUMAN_GUIDE,CURRENT_HOURLY_AUTONOMY_GUIDE,HOURLY_HOST_GUIDE} from '../../apps/platform/application/agent-hourly-participation-guide.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {verifyApplicationReadiness} from '../../apps/platform/application/bootstrap.ts';
import {upgradeWorldCore} from '../../scripts/world-core-upgrade.ts';
import {runPaperHudCatalog} from '../../scripts/paper-hud-catalog.ts';
import {readRuntime} from '../../scripts/postgresql/runtime.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {registerPerceptionRoutes} from '../../apps/platform/transport/http/perception-routes.ts';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerWorldObservationRoutes} from '../../apps/platform/transport/http/agent-gateway-world-routes.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {worldGatewayOperations,worldPublicReads,worldGatewayGuide} from '../../apps/platform/application/agent-gateway-world.ts';
import type {JsonObject,JsonValue} from '../../apps/platform/contracts/store.ts';

const modules=['perception','world','profiles','items','inventory','mailbox','wallet'];
// Synthetic retained schema5 shapes, not copies of private data or a production database.
function legacyShape(value:JsonValue):JsonValue{if(Array.isArray(value))return value.map(legacyShape);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([name])=>!['hairColorId','clothingColorId'].includes(name)).map(([name,item])=>[name,legacyShape(item)]));return value;}

test('paper appearance actual codec/HTTP and exact catalog5→6 publication preserve old documents, settings and source states',async()=>{
 const f=await worldFixture({bootstrap:false}),app=Fastify();try{
  await f.runtime.transaction(ctx=>bootstrapWorld(ctx));
  await f.legacy.transaction(async tx=>{
   const sourceStates={'direct-messages':'enabled','wallet-accounts':'enabled','world-meta':'enabled','profiles-public':'enabled','demo-items':'not_enabled','holdings':'enabled','direct-mail':'enabled','demo-announcements':'enabled','demo-events':'enabled','platform-publications':'enabled','demo-places':'not_enabled','npc-service-items':'enabled'};
   await tx.insert('perception_catalog',{id:'current',version:1,data:{catalogRevision:'catalog-city-name-1',skillCatalogRevision:'skills-catalog-city-name-1',guideVersion:11,schemaVersion:5,sourceStates,seedObjectIds:[]}});
   for(const moduleId of modules){const document={moduleId,version:11,text:[CURRENT_HOURLY_HUMAN_GUIDE,CURRENT_HOURLY_AUTONOMY_GUIDE,HOURLY_HOST_GUIDE].join('\n'),http:{...HTTP_GUIDE,errors:{schemaRef:{id:'perception.error-result',version:5}}},retainedModuleMarker:moduleId};await tx.insert('perception_catalog',{id:`guide:${moduleId}:11`,version:1,data:{document,digest:key(document)}});}
   const docs:Record<string,JsonObject>={'perception.error-result':errorSchema()};for(const op of OPERATIONS)for(const suffix of ['query','result'] as const)docs[`perception.${op.id}-${suffix}`]=operationSchema(op.id,suffix);for(const type of TYPE_DEFINITIONS)for(const part of ['summary','detail'] as const)docs[`${type.prefix}-${part}`]=typeSchema(type.type,part);
   for(const [id,value] of Object.entries(docs)){const document=legacyShape(value) as JsonObject;await tx.insert('perception_catalog',{id:`schema:${id}:5`,version:1,data:{document,digest:key(document)}});}
  });
  const selected=await f.register(),other=await f.register();await f.service.invoke('saveWorldAccess',{agentId:selected.agentId,operationId:randomUUID(),expectedVersion:1,intervalSeconds:300},selected.runtimeToken);
  const legacy=await f.query('SELECT id,version,document_text,digest FROM perception.documents ORDER BY id'),settings=await f.query('SELECT id,world_access__version,world_access__interval_seconds FROM iam.agents ORDER BY id'),states=await f.query('SELECT * FROM perception.source_states ORDER BY parent_id,ordinal');
  await assert.rejects(verifyApplicationReadiness(f.legacy));
  const config=await readRuntime(process.env.WORLD_CORE_TEST_RUNTIME!),pending=await upgradeWorldCore(config,f.privateConnections,{catalogPublicationPending:true});assert.equal(pending.ready,false);assert.equal(pending.writeGate,false);assert.equal(pending.physicalReady,true);
  const operationId=randomUUID(),args=['--connection',join(f.privateConnections,'application-database-url'),'--identity',join(f.privateConnections,'identity.json'),'--operator','isolated-paper-release','--manifest',join(f.privateConnections,'paper-release.json'),'--expected-instance',f.identity.instanceId,'--expected-epoch',f.identity.recoveryEpoch,'--expected-catalog-revision','catalog-city-name-1','--revision','catalog-paper-hud-1','--expected-guide-version','11','--guide-version','12','--operation-id',operationId];
  await assert.rejects(runPaperHudCatalog(args));
  await f.gate(true);let publication;try{publication=await runPaperHudCatalog(args);const retry=[...args];retry[retry.indexOf('--manifest')+1]=join(f.privateConnections,'paper-retry.json');assert.deepEqual((await runPaperHudCatalog(retry)).receipt,publication.receipt);}finally{await f.gate(false);}
  assert.equal(publication.receipt.schemaVersion,6);assert.equal(publication.receipt.guideVersion,12);await verifyApplicationReadiness(f.legacy);
  assert.deepEqual(await f.query('SELECT id,version,document_text,digest FROM perception.documents WHERE id=ANY($1::text[]) ORDER BY id',[legacy.map(row=>row.id)]),legacy);
  assert.deepEqual(await f.query('SELECT id,world_access__version,world_access__interval_seconds FROM iam.agents ORDER BY id'),settings);assert.deepEqual(await f.query('SELECT * FROM perception.source_states ORDER BY parent_id,ordinal'),states);
  const ownerToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),parsed=parseToken(ownerToken,true);await f.gate(true);
  await f.legacy.transaction(async tx=>{const owner=(await tx.get('owners',selected.ownerId))!;await tx.update('owners',{...owner,version:owner.version+1,data:{...owner.data,status:'active'}},owner.version);await tx.insert('bindings',{id:'paper-owner-binding',version:1,data:{agentId:selected.agentId,ownerId:selected.ownerId,active:true}});await tx.insert('credentials',{id:parsed.id,version:1,data:{kind:'owner_session',fingerprint:parsed.fingerprint,verifier:verifier('owner_session',parsed),epoch:f.identity.recoveryEpoch,active:true,ownerId:selected.ownerId,ownerAuthVersion:1,agentId:null,expiresAt:null}});});
  const world=createWorldService(f.access),gateway=createAgentGateway({store:f.runtime,identity:f.access,operations:worldGatewayOperations(world),publicReads:worldPublicReads(world),guides:[worldGatewayGuide]});registerM1Routes(app,f.service);registerPerceptionRoutes(app,f.service);registerSiteRoutes(app);const transport=registerAgentGatewayRoutes(app,gateway,{instanceId:f.identity.instanceId,now:f.now});registerWorldObservationRoutes(gateway,transport);
  const headers={authorization:'Bearer '+ownerToken},catalog=(await app.inject('/v1/avatar-catalog')).json(),colors=await app.inject('/assets/world-pixel/appearance-colors-v1.json');assert.equal(catalog.version,3);assert.equal(createHash('sha256').update(colors.rawPayload).digest('hex'),catalog.colorCustomization.digest);assert.deepEqual(catalog.colorCustomization.hairColors,colors.json().hairColors);
  const appearance={lookId:'sunnyside-human-longhair',catalogVersion:catalog.catalogVersion,hairColorId:'ash',clothingColorId:'clay'},payload={operationId:randomUUID(),expectedVersion:1,expectedPolicyVersion:1,fields:{avatar:appearance}};
  const saved=await app.inject({method:'PUT',url:`/v1/agents/${selected.agentId}/profile`,headers,payload});assert.equal(saved.statusCode,200);assert.deepEqual(saved.json().published.avatar,appearance);assert.deepEqual((await app.inject(`/v1/public/agents/${selected.agentId}`)).json().appearance,appearance);assert.equal((await app.inject({method:'PUT',url:`/v1/agents/${other.agentId}/profile`,headers,payload})).statusCode,404);
  const invalid=await app.inject({method:'PUT',url:`/v1/agents/${selected.agentId}/profile`,headers,payload:{...payload,operationId:randomUUID(),expectedVersion:2,fields:{avatar:{...appearance,hairColorId:'arbitrary-hue'}}}});assert.equal(invalid.statusCode,422);
  const mirror=await f.query("SELECT content_schema_version,avatar_hair_color_id,avatar_clothing_color_id FROM profiles.profile_contents WHERE parent_id=$1 AND stage='published'",[selected.agentId]);assert.deepEqual(mirror,[{content_schema_version:3,avatar_hair_color_id:'ash',avatar_clothing_color_id:'clay'}]);
  await f.runtime.transaction(async ctx=>{const p=await f.access.authenticate(ctx,selected.runtimeToken,['runtime']);await world.execute(ctx,p,{domain:'world',action:'world.avatar.create',commandId:randomUUID(),principal:{kind:'agent',id:selected.agentId},recoveryEpoch:ctx.recoveryEpoch},{worldId:'default',expectedRulesetVersion:1});});
  const scene=await app.inject('/v1/world/scene?worldId=default');assert.equal(scene.statusCode,200);assert.deepEqual(scene.json().data.avatars.find((row:any)=>row.agentId===selected.agentId).profile.appearance,appearance);
  const guide=await app.inject({url:'/v1/perception/guides/profiles?version=12',headers:{authorization:'Bearer '+selected.runtimeToken}});assert.equal(guide.statusCode,200);const data=guide.json().data;assert.equal(createHash('sha256').update(data.canonicalDocument).digest('hex'),data.digest);assert.equal(data.document.retainedModuleMarker,'profiles');assert.match(data.document.text,/hairColorId/);assert.match(data.document.text,/每小时3600秒/);
  assert.equal((await f.legacy.read(tx=>tx.get('agents',selected.agentId)))!.data.worldAccess&&(await f.service.invoke('readWorldAccess',{agentId:selected.agentId},selected.runtimeToken)).intervalSeconds,300);
  console.info(JSON.stringify({database:f.database,catalogRevision:'catalog-paper-hud-1',schema:6,guide:12,profile:3,oldExactPreserved:legacy.length,sourceStatesPreserved:states.length,applicationRolePublication:true,closedGateStopsPublication:true,guideDigests:publication.receipt.guideDigests}));
 }finally{await app.close();await f.dispose();}
});
