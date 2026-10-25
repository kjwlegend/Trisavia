import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {worldFixture} from '../runtime/postgresql-fixture.ts';
import {LIFE_COMMERCE_MIGRATION,LIFE_COMMERCE_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/life-commerce-migration.ts';
import {LIFE_COMMERCE_READ_MIGRATION} from '../../apps/platform/infrastructure/postgresql/life-commerce-read-migration.ts';
import {LIFE_C_COMMERCE_MIGRATION,LIFE_C_COMMERCE_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/life-c-commerce-migration.ts';
import {LIFE_C_GIFT_SOURCE_MIGRATION} from '../../apps/platform/infrastructure/postgresql/life-c-gift-source-migration.ts';
import {createLifeCommerceRepository,prepareLifeItemDefinitions} from '../../apps/platform/infrastructure/postgresql/life-commerce-repository.ts';
import {createLifeCCommerceRepository} from '../../apps/platform/infrastructure/postgresql/life-c-commerce-repository.ts';
import {openPostgresTransactionHost} from '../../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {runtimeSql} from '../../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import {walletRepository} from '../../apps/platform/domains/wallet/repository.ts';
import type {LifeTradeSource} from '../../apps/platform/domains/life-assets/types.ts';
const design=JSON.parse(readFileSync(new URL('../../docs/workstreams/ws03-interaction/life-actions-v1/catalog.json',import.meta.url),'utf8'));
const catalog={...design,revision:2,ruleVersion:1};

test('C append installs without activating C; existing B purchases honor actual reserved money and retain the original balance reader',async()=>{
 // Before C composition, explicitly consume A's real source modules. No fake consent table or accepted-source callback.
 const sourceRoot=process.env.WALLET_TEST_LIFE_C_SOURCE_ROOT,sourceFile=(name:string)=>sourceRoot?pathToFileURL(sourceRoot+'/apps/platform/infrastructure/postgresql/'+name).href:new URL('../../apps/platform/infrastructure/postgresql/'+name,import.meta.url).href;
 const lifeC=await import(sourceFile('life-c-migration.ts')),gifts=await import(sourceFile('relationships-gifts-migration.ts')),giftSource=await import(sourceFile('relationships-gifts-repository.ts'));
 const f=await worldFixture({bootstrap:false});let host:Awaited<ReturnType<typeof openPostgresTransactionHost>>|undefined;
 try{
  if(!(await f.query("SELECT to_regclass('life.fishing_sessions') AS name"))[0]!.name){const file=process.env.WALLET_TEST_LIFE_B_MIGRATION;if(!file)throw new Error('Explicit production Life B migration required before composition');const m=await import(pathToFileURL(file).href);await f.query(m.LIFE_B_MIGRATION.sql);await f.query(m.LIFE_B_PERMISSIONS_SQL);}
  if(!(await f.query("SELECT to_regclass('life_assets.effects') AS name"))[0]!.name)await f.query(LIFE_COMMERCE_MIGRATION.sql);
  if(!(await f.query("SELECT to_regclass('life_assets.life_asset_available_order') AS name"))[0]!.name)await f.query(LIFE_COMMERCE_READ_MIGRATION.sql);
  if(!(await f.query("SELECT to_regclass('life.reading_records') AS name"))[0]!.name)await f.query(lifeC.LIFE_C_MIGRATION.sql);
  if(!(await f.query("SELECT to_regclass('relationships.gifts') AS name"))[0]!.name)await f.query(gifts.RELATIONSHIP_GIFT_MIGRATION.sql);
  await f.query(LIFE_C_COMMERCE_MIGRATION.sql);await f.query(LIFE_C_GIFT_SOURCE_MIGRATION.sql);await f.query(LIFE_COMMERCE_PERMISSIONS_SQL);await f.query(LIFE_C_COMMERCE_PERMISSIONS_SQL);await f.query(gifts.RELATIONSHIP_GIFT_PERMISSIONS_SQL);
  const a=await f.register(),ref={kind:'agent' as const,id:a.agentId};
  // Storage contract fixture only: real C source tables exist, but no activity/consent fact is invented or activated.
  await f.query('UPDATE wallet.accounts SET balance=20,reserved_balance=12,version=version+1 WHERE agent_id=$1',[a.agentId]);
  await f.query('INSERT INTO life.catalogs(revision,activated_at,definition) VALUES(2,$1,$2)',[f.now(),catalog]);
  await f.legacy.transaction(tx=>prepareLifeItemDefinitions(tx,catalog));host=await openPostgresTransactionHost(f.options);const h=host;
  const bind=(scope:Parameters<Parameters<typeof h.transaction>[0]>[0])=>{const sql=runtimeSql(scope,f.now);return createLifeCommerceRepository(sql,{catalog,readTradeSource:async id=>(await sql.query('SELECT data FROM life.activities WHERE id=$1',[id]))[0]?.data as LifeTradeSource|undefined,readFishingSessionSource:async()=>undefined,readFishingCastSource:async()=>undefined}).writer;};
  const read=()=>h.read(scope=>bind(scope).resources(ref));
  assert.deepEqual((await read()).wallet,{balance:20,reserved:12,available:8,version:2});
  const cCatalog={...design,revision:3,ruleVersion:1,services:{mealPreparation:design.services.mealPreparation,innRest:{...design.services.innRest,placeId:'stone_inn'},reading:design.services.reading}};
  for(const action of ['buyFromActivity','reserveActivity','settleActivity'] as const)await assert.rejects(h.transaction(async scope=>createLifeCCommerceRepository(runtimeSql(scope,f.now),{catalog:cCatalog,readTradeSource:async()=>undefined,readCActivitySource:async()=>undefined,readGiftSource:async()=>undefined}).writer[action]({actorRef:ref,activityId:'no-real-c-source'})),(e:any)=>e.code==='invalid_usage');
  await assert.rejects(h.transaction(async scope=>{const sql=runtimeSql(scope,f.now);return createLifeCCommerceRepository(sql,{catalog:cCatalog,readTradeSource:async()=>undefined,readCActivitySource:async()=>undefined,readGiftSource:id=>giftSource.readRelationshipGiftSource(sql,id)}).writer.reserveGift({giftId:'no-real-consent-source'});}),(e:any)=>e.code==='invalid_usage');
  assert.equal((await f.query("SELECT count(*)::int AS n FROM life_assets.effects WHERE kind LIKE 'c.%'"))[0]!.n,0);
  const constraints=await f.query("SELECT conname,condeferrable,condeferred,confrelid::regclass::text AS source FROM pg_constraint WHERE conname IN ('c_gift_reservations_gift_source_fk','effects_c_gift_source_fk') ORDER BY conname");assert.equal(constraints.length,2);assert(constraints.every(r=>r.condeferrable&&r.condeferred&&r.source==='relationships.gifts'));
  const recipient=await f.register();
  for(const kind of ['reservation','c.gift.reserve','c.gift.settle']){
   let insertedBeforeCommit=false;
   await assert.rejects(h.transaction(async scope=>{const sql=runtimeSql(scope,f.now);await sql.mutate('UPDATE wallet.accounts SET balance=balance+1,version=version+1 WHERE agent_id=$1',[a.agentId]);
    if(kind==='reservation')await sql.mutate("INSERT INTO life_assets.c_gift_reservations(gift_id,from_agent_id,to_agent_id,state,created_at) VALUES($1,$2,$3,'reserved',$4)",['missing-gift:'+kind,a.agentId,recipient.agentId,f.now()]);
    else await sql.mutate('INSERT INTO life_assets.effects(id,kind,source_id,actor_kind,actor_id,source_event_id,occurred_at,recorded_at,payload_hash,result) VALUES($1,$2,$3,\'agent\',$4,NULL,$5,$5,$6,$7)',['missing-effect:'+kind,kind,'missing-gift:'+kind,a.agentId,f.now(),'0'.repeat(64),{}]);
    insertedBeforeCommit=true;
   }),(error:any)=>error.code==='constraint'&&error.cause?.code==='23503'&&error.cause.constraint===(kind==='reservation'?'c_gift_reservations_gift_source_fk':'effects_c_gift_source_fk'));
   assert(insertedBeforeCommit,'The real-source FK is deferred until the caller transaction commits');
   assert.deepEqual((await read()).wallet,{balance:20,reserved:12,available:8,version:2},'Missing consent source rolls back the same transaction wallet write');
   assert.equal((await f.query('SELECT count(*)::int AS n FROM life_assets.c_gift_reservations'))[0]!.n,0);assert.equal((await f.query("SELECT count(*)::int AS n FROM life_assets.effects WHERE kind LIKE 'c.gift.%'"))[0]!.n,0);
  }
  const make=(id:string,quantity:number):LifeTradeSource=>({id,actorKind:'agent',actorId:a.agentId,actionId:'shop.buy',state:'completed',placeId:'fisher_shop',ruleVersion:1,catalogRevision:2,startedAt:f.now(),endedAt:f.now(),resultId:id,sourceEventId:'event:'+id,quote:{catalogRevision:2,ruleVersion:1,createdAt:f.now()-1,expiresAt:f.now()+1000,items:[{itemId:'bait',unitPrice:2}]},purchase:{itemId:'bait',quantity,maxSpend:quantity*2},moneyAmount:quantity*2});
  await f.query('INSERT INTO life.actors(actor_kind,actor_id,version,energy,reserved_energy,data) VALUES(\'agent\',$1,1,100,0,$2)',[a.agentId,{}]);
  async function save(s:LifeTradeSource){await f.query("INSERT INTO runtime.events(event_id,position,domain,kind,schema_version,subject_type,subject_id,subject_version,actor_kind,actor_id,source,occurred_at,committed_at,causation_id,correlation_id,audience_kind,audience_agents,payload) VALUES($1,(SELECT position+1 FROM runtime.event_clock WHERE singleton=1),'life','activity.completed',1,'activity',$2,1,'system','synthetic-b-fixture','rules',$3,$3,$2,$2,'agents',$4,'{}')",[s.sourceEventId,s.id,f.now(),[a.agentId]]);await f.query('UPDATE runtime.event_clock SET position=position+1 WHERE singleton=1');await f.query("INSERT INTO life.activities(id,version,actor_kind,actor_id,action_id,job_id,rule_version,catalog_revision,state,place_id,station_id,seat,started_at,scheduled_end_at,ended_at,result_id,source_event_id,reward_amount,data) VALUES($1,1,'agent',$2,'shop.buy',NULL,1,2,'completed','fisher_shop',$1,0,$3,$3,$3,$1,$4,0,$5)",[s.id,a.agentId,f.now(),s.sourceEventId,s]);}
  const tooMuch=make('reserved-money-protected',5);await save(tooMuch);await assert.rejects(h.transaction(scope=>bind(scope).buyFromActivity({actorRef:ref,activityId:tooMuch.id})),(e:any)=>e.code==='insufficient_funds');
  assert.equal((await read()).wallet.balance,20);assert.equal((await read()).items.length,0);
  const allowed=make('unreserved-money-only',4);await save(allowed);await h.transaction(scope=>bind(scope).buyFromActivity({actorRef:ref,activityId:allowed.id}));assert.deepEqual((await read()).wallet,{balance:12,reserved:12,available:0,version:3});assert.equal((await read()).items.length,4);
  // Keep the reader inside its transaction scope; neither C read nor pagination can manufacture a C source.
  const cResources=(options:{limit?:number;afterId?:string}={})=>h.read(async scope=>createLifeCCommerceRepository(runtimeSql(scope,f.now),{catalog:cCatalog,readTradeSource:async()=>undefined,readCActivitySource:async()=>undefined,readGiftSource:async()=>undefined}).reader.resources(ref,options));
  const cFull=await cResources();assert.equal(cFull.totals.length,9);assert.deepEqual(cFull.wallet,(await read()).wallet);assert.equal(cFull.items.length,4);assert.equal(cFull.totals.find(r=>r.itemId==='bait')!.available,4);assert.equal(cFull.totals.find(r=>r.itemId==='bread_meal')!.available,0);
  const first=await cResources({limit:2});assert.equal(first.complete,false);assert.equal(first.items.length,2);const second=await cResources({limit:2,afterId:first.nextCursor!});assert.equal(second.complete,true);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,4);assert.deepEqual(first.totals,cFull.totals);
  const legacy=await f.legacy.read(tx=>walletRepository(tx).get(a.agentId));assert.equal(legacy!.data.balance,12);assert.equal(legacy!.version,3);
  await assert.rejects(f.appQuery('UPDATE wallet.accounts SET reserved_balance=13,version=version+1 WHERE agent_id=$1',[a.agentId]),/check constraint/);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM life_assets.c_activity_reservations'))[0]!.n,0);assert.equal((await f.query('SELECT count(*)::int AS n FROM life_assets.c_gift_reservations'))[0]!.n,0);
 }finally{await host?.close();await f.dispose();}
});
