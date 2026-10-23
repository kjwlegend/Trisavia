import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {worldFixture} from './postgresql-fixture.ts';
import {bootstrapPlatformCatalog,verifyApplicationReadiness} from '../../apps/platform/application/bootstrap.ts';
import {publishFreshPaperHudCatalogInTransaction,publishPaperHudCatalogInTransaction} from '../../apps/platform/application/perception-catalog.ts';
import {publishNpcServiceReaders} from '../../apps/platform/application/perception-admin.ts';
import {PAPER_HUD_APPEARANCE_GUIDE,PAPER_HUD_OWNER_MAILBOX_GUIDE} from '../../apps/platform/application/agent-paper-hud-guide.ts';
import {bootstrapWorld} from '../../apps/platform/application/world-service.ts';
import {townV2Rules,TOWN_V2_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-v2.ts';
import {key} from '../../apps/platform/domains/perception/protocol.ts';
import {prepareTownServices} from '../../scripts/town-services-prepare.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {registerPerceptionRoutes} from '../../apps/platform/transport/http/perception-routes.ts';
import type {JsonObject,StoredRow} from '../../apps/platform/contracts/store.ts';

const modules=['perception','world','profiles','items','inventory','mailbox','wallet'];
const target='catalog-fresh-paper-hud-1';
async function checkHttp(f:Awaited<ReturnType<typeof worldFixture>>,version:number){
 const app=Fastify();try{
  registerM1Routes(app,f.service);registerPerceptionRoutes(app,f.service);
  const agent=await f.register(),headers={authorization:'Bearer '+agent.runtimeToken};
  const catalog=await app.inject('/v1/avatar-catalog');assert.equal(catalog.statusCode,200);assert.equal(catalog.json().version,3);
  const discovery=await app.inject({url:'/v1/perception/discovery',headers});assert.equal(discovery.statusCode,200);
  const data=discovery.json().data;assert.equal(data.catalogRevision,target);assert.equal(data.skillCatalogRevision,`skills-${target}`);
  assert(data.modules.every((module:any)=>module.usageGuide.version===version));assert(data.types.every((type:any)=>type.summarySchema.version===6&&type.detailSchema.version===6));
  for(const moduleId of modules){
   const response=await app.inject({url:`/v1/perception/guides/${moduleId}?version=${version}`,headers});assert.equal(response.statusCode,200);
   const guide=response.json().data;assert.equal(guide.version,version);assert.equal(guide.document.version,version);
   assert.equal(createHash('sha256').update(guide.canonicalDocument).digest('hex'),guide.digest);
   assert(guide.document.text.includes(PAPER_HUD_APPEARANCE_GUIDE));assert(guide.document.text.includes(PAPER_HUD_OWNER_MAILBOX_GUIDE));
   assert(!guide.document.text.includes('GET /v1/avatar-catalog，version2'));
   assert.equal(guide.document.http.errors.schemaRef.version,6);
  }
  await verifyApplicationReadiness(f.legacy);
 }finally{await app.close();}
}

test('fresh schema6 bootstrap publishes corrected guide3 and preserves its exact guide1/2',async()=>{
 const f=await worldFixture();try{
  const old=await f.query("SELECT id,version,document_text,digest FROM perception.documents WHERE id NOT LIKE 'guide:%:3' ORDER BY id");
  for(const version of [1,2])assert.match(((await f.legacy.read(tx=>tx.get('perception_catalog',`guide:world:${version}`)))!.data.document as JsonObject).text as string,/GET \/v1\/avatar-catalog，version2/);
  const current=(await f.legacy.read(tx=>tx.get('perception_catalog','current')))!,before=await f.query('SELECT * FROM perception.source_states ORDER BY parent_id,ordinal');
  await checkHttp(f,3);await bootstrapPlatformCatalog(f.legacy);
  const retry=await f.legacy.transaction(tx=>publishFreshPaperHudCatalogInTransaction(tx,{expectedCatalogRevision:'catalog-readers-1-schema-6',expectedGuideVersion:2}));assert.equal(retry.changed,false);assert.equal(retry.newGuideDocuments,0);
  assert.deepEqual(await f.legacy.read(tx=>tx.get('perception_catalog','current')),current);
  assert.deepEqual(await f.query('SELECT id,version,document_text,digest FROM perception.documents WHERE id=ANY($1::text[]) ORDER BY id',[old.map(row=>row.id)]),old);
  assert.deepEqual(await f.query('SELECT * FROM perception.source_states ORDER BY parent_id,ordinal'),before);
 }finally{await f.dispose();}
});

test('existing fresh NPC guide3 advances safely to guide4 without changing sources, old exacts or production release',async()=>{
 // Reconstruct only the real fresh1→readers2 public catalog, never production guide5→11 history.
 const source=await worldFixture();let retained:StoredRow[],current:StoredRow;
 try{
  const rows=await source.legacy.read(tx=>tx.find('perception_catalog'));
  current=rows.find(row=>row.id==='current')!;
  retained=rows.filter(row=>row.id!=='current'&&!/^guide:[^:]+:3$/.test(row.id)&&row.id!==`catalog-revision:${key(target)}`);
 }finally{await source.dispose();}
 const f=await worldFixture({bootstrap:false});try{
  await f.legacy.transaction(async tx=>{
   for(const row of retained)await tx.insert('perception_catalog',row);
   await tx.insert('perception_catalog',{...current,version:1,data:{...current.data,catalogRevision:'catalog-readers-1-schema-6',skillCatalogRevision:'skills-catalog-readers-1-schema-6',guideVersion:2}});
  });
  const rules=townV2Rules(JSON.parse(await readFile(new URL('../../apps/web/public/world-map-v2.json',import.meta.url),'utf8')),TOWN_V2_LAYOUT_SHA256);
  await f.runtime.transaction(ctx=>bootstrapWorld(ctx,rules));await f.gate(false);
  await prepareTownServices(join(f.privateConnections,'migration-database-url'),join(f.privateConnections,'identity.json'),f.database,{activate:true,now:f.now});
  await f.gate(true);
  await publishNpcServiceReaders(f.legacy,{actorId:'isolated-fresh-release',operationId:randomUUID(),expectedInstanceId:f.identity.instanceId,expectedRecoveryEpoch:f.identity.recoveryEpoch,expectedCatalogRevision:'catalog-readers-1-schema-6',revision:'catalog-npc-services-1',expectedGuideVersion:2,guideVersion:3});
  const old=await f.query('SELECT id,version,document_text,digest FROM perception.documents ORDER BY id'),states=await f.query('SELECT * FROM perception.source_states ORDER BY parent_id,ordinal'),items=await f.query('SELECT * FROM items.items ORDER BY id');
  assert.equal(states.find(row=>row.entry_key==='npc-service-items')?.source_state,'enabled');
  const options={expectedCatalogRevision:'catalog-npc-services-1',expectedGuideVersion:3};
  await f.gate(false);await assert.rejects(f.legacy.transaction(tx=>publishFreshPaperHudCatalogInTransaction(tx,options)));
  await f.gate(true);try{
   const published=await f.legacy.transaction(tx=>publishFreshPaperHudCatalogInTransaction(tx,options));assert.equal(published.guideVersion,4);assert.equal(published.newGuideDocuments,7);assert.equal(published.newSchemaDocuments,0);
   assert.equal((await f.legacy.transaction(tx=>publishFreshPaperHudCatalogInTransaction(tx,options))).changed,false);
   await assert.rejects(f.legacy.transaction(publishPaperHudCatalogInTransaction),{code:'version_conflict'});
  }finally{await f.gate(false);}
  assert.deepEqual(await f.query('SELECT id,version,document_text,digest FROM perception.documents WHERE id=ANY($1::text[]) ORDER BY id',[old.map(row=>row.id)]),old);
  assert.deepEqual(await f.query('SELECT * FROM perception.source_states ORDER BY parent_id,ordinal'),states);assert.deepEqual(await f.query('SELECT * FROM items.items ORDER BY id'),items);
  await f.gate(true);await checkHttp(f,4);
  console.info(JSON.stringify({database:f.database,catalogRevision:target,guideVersion:4,schemaVersion:6,oldExactPreserved:old.length,sourceStatesPreserved:states.length,applicationRolePublication:true}));
 }finally{await f.dispose();}
});
