import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {worldFixture} from '../runtime/postgresql-fixture.ts';
import {LIFE_COMMERCE_MIGRATION,LIFE_COMMERCE_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/life-commerce-migration.ts';
import {LIFE_COMMERCE_READ_MIGRATION} from '../../apps/platform/infrastructure/postgresql/life-commerce-read-migration.ts';
import {LIFE_C_COMMERCE_MIGRATION,LIFE_C_COMMERCE_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/life-c-commerce-migration.ts';
import {createLifeCommerceRepository,prepareLifeItemDefinitions} from '../../apps/platform/infrastructure/postgresql/life-commerce-repository.ts';
import {createLifeCCommerceRepository} from '../../apps/platform/infrastructure/postgresql/life-c-commerce-repository.ts';
import {openPostgresTransactionHost} from '../../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {runtimeSql} from '../../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import {walletRepository} from '../../apps/platform/domains/wallet/repository.ts';
import type {LifeTradeSource} from '../../apps/platform/domains/life-assets/types.ts';
const design=JSON.parse(readFileSync(new URL('../../docs/workstreams/ws03-interaction/life-actions-v1/catalog.json',import.meta.url),'utf8'));
const catalog={...design,revision:2,ruleVersion:1};

test('C append installs without activating C; existing B purchases honor actual reserved money and retain the original balance reader',async()=>{
 const f=await worldFixture({bootstrap:false});let host:Awaited<ReturnType<typeof openPostgresTransactionHost>>|undefined;
 try{
  if(!(await f.query("SELECT to_regclass('life.fishing_sessions') AS name"))[0]!.name){const file=process.env.WALLET_TEST_LIFE_B_MIGRATION;if(!file)throw new Error('Explicit production Life B migration required before composition');const m=await import(pathToFileURL(file).href);await f.query(m.LIFE_B_MIGRATION.sql);await f.query(m.LIFE_B_PERMISSIONS_SQL);}
  if(!(await f.query("SELECT to_regclass('life_assets.effects') AS name"))[0]!.name)await f.query(LIFE_COMMERCE_MIGRATION.sql);
  if(!(await f.query("SELECT to_regclass('life_assets.life_asset_available_order') AS name"))[0]!.name)await f.query(LIFE_COMMERCE_READ_MIGRATION.sql);
  await f.query(LIFE_C_COMMERCE_MIGRATION.sql);await f.query(LIFE_COMMERCE_PERMISSIONS_SQL);await f.query(LIFE_C_COMMERCE_PERMISSIONS_SQL);
  const a=await f.register(),ref={kind:'agent' as const,id:a.agentId};
  // Storage contract fixture only: no C Life/consent source exists yet and none is invented or activated by this test.
  await f.query('UPDATE wallet.accounts SET balance=20,reserved_balance=12,version=version+1 WHERE agent_id=$1',[a.agentId]);
  await f.query('INSERT INTO life.catalogs(revision,activated_at,definition) VALUES(2,$1,$2)',[f.now(),catalog]);
  await f.legacy.transaction(tx=>prepareLifeItemDefinitions(tx,catalog));host=await openPostgresTransactionHost(f.options);const h=host;
  const bind=(scope:Parameters<Parameters<typeof h.transaction>[0]>[0])=>{const sql=runtimeSql(scope,f.now);return createLifeCommerceRepository(sql,{catalog,readTradeSource:async id=>(await sql.query('SELECT data FROM life.activities WHERE id=$1',[id]))[0]?.data as LifeTradeSource|undefined,readFishingSessionSource:async()=>undefined,readFishingCastSource:async()=>undefined}).writer;};
  const read=()=>h.read(scope=>bind(scope).resources(ref));
  assert.deepEqual((await read()).wallet,{balance:20,reserved:12,available:8,version:2});
  const cCatalog={...design,revision:3,ruleVersion:1,services:{mealPreparation:design.services.mealPreparation,innRest:{...design.services.innRest,placeId:'stone_inn'}}};
  for(const action of ['buyFromActivity','reserveActivity','settleActivity'] as const)await assert.rejects(h.transaction(async scope=>createLifeCCommerceRepository(runtimeSql(scope,f.now),{catalog:cCatalog,readTradeSource:async()=>undefined,readCActivitySource:async()=>undefined,readGiftSource:async()=>undefined}).writer[action]({actorRef:ref,activityId:'no-real-c-source'})),(e:any)=>e.code==='invalid_usage');
  await assert.rejects(h.transaction(async scope=>createLifeCCommerceRepository(runtimeSql(scope,f.now),{catalog:cCatalog,readTradeSource:async()=>undefined,readCActivitySource:async()=>undefined,readGiftSource:async()=>undefined}).writer.reserveGift({giftId:'no-real-consent-source'})),(e:any)=>e.code==='invalid_usage');
  assert.equal((await f.query("SELECT count(*)::int AS n FROM life_assets.effects WHERE kind LIKE 'c.%'"))[0]!.n,0);
  const make=(id:string,quantity:number):LifeTradeSource=>({id,actorKind:'agent',actorId:a.agentId,actionId:'shop.buy',state:'completed',placeId:'fisher_shop',ruleVersion:1,catalogRevision:2,startedAt:f.now(),endedAt:f.now(),resultId:id,sourceEventId:'event:'+id,quote:{catalogRevision:2,ruleVersion:1,createdAt:f.now()-1,expiresAt:f.now()+1000,items:[{itemId:'bait',unitPrice:2}]},purchase:{itemId:'bait',quantity,maxSpend:quantity*2},moneyAmount:quantity*2});
  await f.query('INSERT INTO life.actors(actor_kind,actor_id,version,energy,reserved_energy,data) VALUES(\'agent\',$1,1,100,0,$2)',[a.agentId,{}]);
  async function save(s:LifeTradeSource){await f.query("INSERT INTO runtime.events(event_id,position,domain,kind,schema_version,subject_type,subject_id,subject_version,actor_kind,actor_id,source,occurred_at,committed_at,causation_id,correlation_id,audience_kind,audience_agents,payload) VALUES($1,(SELECT position+1 FROM runtime.event_clock WHERE singleton=1),'life','activity.completed',1,'activity',$2,1,'system','synthetic-b-fixture','rules',$3,$3,$2,$2,'agents',$4,'{}')",[s.sourceEventId,s.id,f.now(),[a.agentId]]);await f.query('UPDATE runtime.event_clock SET position=position+1 WHERE singleton=1');await f.query("INSERT INTO life.activities(id,version,actor_kind,actor_id,action_id,job_id,rule_version,catalog_revision,state,place_id,station_id,seat,started_at,scheduled_end_at,ended_at,result_id,source_event_id,reward_amount,data) VALUES($1,1,'agent',$2,'shop.buy',NULL,1,2,'completed','fisher_shop',$1,0,$3,$3,$3,$1,$4,0,$5)",[s.id,a.agentId,f.now(),s.sourceEventId,s]);}
  const tooMuch=make('reserved-money-protected',5);await save(tooMuch);await assert.rejects(h.transaction(scope=>bind(scope).buyFromActivity({actorRef:ref,activityId:tooMuch.id})),(e:any)=>e.code==='insufficient_funds');
  assert.equal((await read()).wallet.balance,20);assert.equal((await read()).items.length,0);
  const allowed=make('unreserved-money-only',4);await save(allowed);await h.transaction(scope=>bind(scope).buyFromActivity({actorRef:ref,activityId:allowed.id}));assert.deepEqual((await read()).wallet,{balance:12,reserved:12,available:0,version:3});assert.equal((await read()).items.length,4);
  const legacy=await f.legacy.read(tx=>walletRepository(tx).get(a.agentId));assert.equal(legacy!.data.balance,12);assert.equal(legacy!.version,3);
  await assert.rejects(f.appQuery('UPDATE wallet.accounts SET reserved_balance=13,version=version+1 WHERE agent_id=$1',[a.agentId]),/check constraint/);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM life_assets.c_activity_reservations'))[0]!.n,0);assert.equal((await f.query('SELECT count(*)::int AS n FROM life_assets.c_gift_reservations'))[0]!.n,0);
 }finally{await host?.close();await f.dispose();}
});
