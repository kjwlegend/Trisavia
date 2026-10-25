import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {worldFixture} from '../runtime/postgresql-fixture.ts';
import {hashRuntimeRequest} from '../../apps/platform/domains/runtime/command.ts';
import type {WalletActorRef,WorkRewardSource} from '../../apps/platform/domains/wallet/life-wallet.ts';
import type {LifeAssetCatalog,LifeFishingCastSource,LifeFishingSessionSource,LifeTradeSource} from '../../apps/platform/domains/life-assets/types.ts';
import {createLifeCommerceRepository,prepareLifeItemDefinitions} from '../../apps/platform/infrastructure/postgresql/life-commerce-repository.ts';
import {LIFE_COMMERCE_MIGRATION,LIFE_COMMERCE_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/life-commerce-migration.ts';
import {createLifeWalletRepository} from '../../apps/platform/infrastructure/postgresql/life-wallet-repository.ts';
import {createRuntimeRepositories} from '../../apps/platform/infrastructure/postgresql/runtime-repositories.ts';
import {openPostgresTransactionHost,type PostgresScope} from '../../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {runtimeSql} from '../../apps/platform/infrastructure/postgresql/runtime-sql.ts';

const design=JSON.parse(readFileSync(new URL('../../docs/workstreams/ws03-interaction/life-actions-v1/catalog.json',import.meta.url),'utf8'));
const catalog:LifeAssetCatalog={...design,revision:2,ruleVersion:1};
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===expected;

test('source-bound commerce uses one real PG transaction, unique items and the original actor wallet',async t=>{
 const f=await worldFixture({bootstrap:false});let host:Awaited<ReturnType<typeof openPostgresTransactionHost>>|undefined;
 try{
  // During independent B development, execute the explicit production A migration, never a copied/approximated Life schema.
  // In the assembled candidate the shared migration runner has already installed this table and this branch does not run.
  if(!(await f.query("SELECT to_regclass('life.fishing_sessions') AS name"))[0]!.name){
   const file=process.env.WALLET_TEST_LIFE_B_MIGRATION;if(!file)throw new Error('Before Life B is composed, set WALLET_TEST_LIFE_B_MIGRATION to the source owner production migration');
   const m=await import(pathToFileURL(file).href);await f.query(m.LIFE_B_MIGRATION.sql);await f.query(m.LIFE_B_PERMISSIONS_SQL);
  }
  if(!(await f.query("SELECT to_regclass('life_assets.effects') AS name"))[0]!.name)await f.query(LIFE_COMMERCE_MIGRATION.sql);
  await f.query(LIFE_COMMERCE_PERMISSIONS_SQL);
  const registered=await f.register(),second=await f.register(),agent:WalletActorRef={kind:'agent',id:registered.agentId},other:WalletActorRef={kind:'agent',id:second.agentId};
  await f.query('UPDATE wallet.accounts SET version=version+1,balance=CASE WHEN agent_id=$1 THEN 36 ELSE 2 END',[agent.id]);
  await f.query('INSERT INTO life.catalogs(revision,activated_at,definition) VALUES(1,$1,$2),(2,$1,$3)',[f.now(),{...design,ruleVersion:1},catalog]);
  const before=await f.query('SELECT (SELECT count(*)::int FROM iam.agents) AS agents,(SELECT count(*)::int FROM wallet.welcome_credits) AS welcome,(SELECT count(*)::int FROM town_services.resident_gifts) AS gifts,(SELECT count(*)::int FROM town_services.item_instances) AS legacy_items');
  host=await openPostgresTransactionHost(f.options);const h=host;
  let badTrade:LifeTradeSource|undefined;
  const bind=(scope:PostgresScope)=>{
   const sql=runtimeSql(scope,f.now);
   const source=async<T>(table:string,id:string)=>((await sql.query('SELECT data FROM life.'+table+' WHERE id=$1',[id]))[0]?.data as T|undefined);
   const assets=createLifeCommerceRepository(sql,{catalog,readTradeSource:id=>badTrade?.id===id?Promise.resolve(badTrade):source('activities',id),readFishingSessionSource:id=>source('fishing_sessions',id),readFishingCastSource:id=>source('fishing_casts',id)}).writer;
   return {sql,assets,...createRuntimeRepositories(sql,f.identity.recoveryEpoch)};
  };
  await f.legacy.transaction(tx=>prepareLifeItemDefinitions(tx,catalog));
  await h.transaction(async scope=>{await bind(scope).tasks.advanceGeneration('life',0);});
  const read=(ref=agent)=>h.read(async scope=>bind(scope).assets.resources(ref));
  const run=<T>(fn:(c:ReturnType<typeof bind>)=>Promise<T>)=>h.transaction(scope=>fn(bind(scope)));
  async function actorRow(ctx:ReturnType<typeof bind>,a:WalletActorRef){await ctx.sql.mutate('INSERT INTO life.actors(actor_kind,actor_id,version,energy,reserved_energy,data) VALUES($1,$2,1,100,0,$3) ON CONFLICT DO NOTHING',[a.kind,a.id,{actorKind:a.kind,actorId:a.id,version:1,energy:100,reservedEnergy:0,quota:[],body:null,activePlanId:null,queuedPlanId:null,createdAt:f.now(),updatedAt:f.now()}]);}
  async function event(ctx:ReturnType<typeof bind>,s:{id:string;sourceEventId:string|null;actorKind:'agent'|'npc';actorId:string;endedAt:number|null}){
   await ctx.events.append({eventId:s.sourceEventId!,domain:'life',kind:'activity.completed',schemaVersion:1,subject:{type:'activity',id:s.id,version:2},actor:{kind:'system',id:'synthetic-life-source'},source:'rules',occurredAt:s.endedAt!,causationId:s.id,correlationId:s.id,audience:{kind:'agents',agentIds:s.actorKind==='agent'?[s.actorId]:[]},payload:{activityId:s.id}});
  }
  async function activity(ctx:ReturnType<typeof bind>,s:{id:string;actorKind:'agent'|'npc';actorId:string;actionId:string;catalogRevision:number;ruleVersion:number;state:string;startedAt:number;endedAt:number|null;resultId?:string|null;sourceEventId?:string|null},data:unknown=s){
   await actorRow(ctx,{kind:s.actorKind,id:s.actorId});const end=s.actionId.startsWith('shop.')?s.startedAt:s.startedAt+60000;
   await ctx.sql.mutate('INSERT INTO life.activities(id,version,actor_kind,actor_id,action_id,job_id,rule_version,catalog_revision,state,place_id,station_id,seat,started_at,scheduled_end_at,ended_at,result_id,source_event_id,reward_amount,data) VALUES($1,1,$2,$3,$4,NULL,$5,$6,$7,\'fisher_shop\',$1,0,$8,$9,$10,$11,$12,0,$13)',[s.id,s.actorKind,s.actorId,s.actionId,s.ruleVersion,s.catalogRevision,s.state,s.startedAt,end,s.endedAt,s.resultId??null,s.sourceEventId??null,data]);
  }
  function trade(id:string,itemId='bait',quantity=1,a=agent):LifeTradeSource{
   const price=catalog.items.find(x=>x.id===itemId)!.buyPrice!;return {id,actorKind:a.kind,actorId:a.id,actionId:'shop.buy',state:'completed',placeId:'fisher_shop',catalogRevision:2,ruleVersion:1,startedAt:f.now(),endedAt:f.now(),resultId:id,sourceEventId:'event:'+id,quote:{catalogRevision:2,ruleVersion:1,createdAt:f.now()-1000,expiresAt:f.now()+7200000,items:[{itemId,unitPrice:price}]},purchase:{itemId,quantity,maxSpend:price*quantity},moneyAmount:price*quantity};
  }
  async function saveTrade(s:LifeTradeSource,withEvent=true){await run(async ctx=>{await activity(ctx,s);if(withEvent)await event(ctx,s);});}
  const invoke=(s:LifeTradeSource)=>run(ctx=>s.actionId==='shop.buy'?ctx.assets.buyFromActivity({actorRef:{kind:s.actorKind,id:s.actorId},activityId:s.id}):ctx.assets.sellFromActivity({actorRef:{kind:s.actorKind,id:s.actorId},activityId:s.id}));
  const total=(r:Awaited<ReturnType<typeof read>>,id:string,state:'available'|'reserved'='available')=>r.totals.find(x=>x.itemId===id)![state];
  await t.test('purchase money/items/projection/source/event/receipt/outbox roll back together; concurrent original key buys once',async()=>{
   const rod=trade('buy-rod','basic_rod');
   await assert.rejects(run(async ctx=>{await activity(ctx,rod);await ctx.assets.buyFromActivity({actorRef:agent,activityId:rod.id});await event(ctx,rod);await ctx.commands.insert({key:{domain:'life',action:'trade',commandId:rod.id,principal:{kind:'agent',id:agent.id},recoveryEpoch:f.identity.recoveryEpoch},requestHash:hashRuntimeRequest({id:rod.id}),outcome:'committed',result:{activityId:rod.id},eventIds:[rod.sourceEventId!],committedAt:f.now()});await ctx.outbox.enqueue({outboxId:'outbox:'+rod.id,eventId:rod.sourceEventId!,consumerId:'test',dedupeKey:rod.id,generation:1,dueAt:f.now(),maxAttempts:3});throw new Error('after all writes');}),/after all writes/);
   assert.equal((await read()).wallet.balance,36);assert.equal((await read()).items.length,0);
   assert.deepEqual(await f.query("SELECT (SELECT count(*)::int FROM life.activities WHERE id='buy-rod') AS sources,(SELECT count(*)::int FROM wallet.life_postings) AS money,(SELECT count(*)::int FROM life_assets.effects) AS effects,(SELECT count(*)::int FROM inventory.holdings) AS holdings,(SELECT count(*)::int FROM runtime.events WHERE event_id='event:buy-rod') AS events,(SELECT count(*)::int FROM runtime.command_receipts WHERE command_id='buy-rod') AS receipts,(SELECT count(*)::int FROM runtime.outbox WHERE outbox_id='outbox:buy-rod') AS outbox"),[{sources:0,money:0,effects:0,holdings:0,events:0,receipts:0,outbox:0}]);
   await saveTrade(rod);const pair=await Promise.all([invoke(rod),invoke(rod)]);assert.deepEqual(pair[0],pair[1]);assert.equal(pair[0]!.moneyDelta,-30);assert.equal(pair[0]!.itemIds.length,1);
   const itemId=pair[0]!.itemIds[0]!;assert.equal((await h.read(scope=>bind(scope).assets.getItem(agent,itemId)))!.itemId,'basic_rod');assert.equal(await h.read(scope=>bind(scope).assets.getItem(other,itemId)),undefined);assert.equal(await h.read(scope=>bind(scope).assets.getItem(agent,'missing-instance')),undefined);
   const bait=trade('buy-three-bait','bait',3);await saveTrade(bait);await invoke(bait);assert.equal((await read()).wallet.balance,0);assert.equal(total(await read(),'bait'),3);assert.equal(total(await read(),'basic_rod'),1);
   assert.deepEqual(await f.query("SELECT quantity,status FROM inventory.holdings WHERE source__kind='life_item_balance' ORDER BY quantity"),[{quantity:'1',status:'available'},{quantity:'3',status:'available'}]);
   badTrade={...rod,endedAt:rod.endedAt!+1};await assert.rejects(invoke(rod),code('command_conflict'));badTrade=undefined;
   await assert.rejects(run(ctx=>ctx.assets.buyFromActivity({actorRef:other,activityId:rod.id})),code('command_conflict'));
  });
  async function newSession(id:string,requestedCasts:number,a=agent){const rod=(await read(a)).items.find(x=>x.itemId==='basic_rod'&&x.state==='available')!;const s:LifeFishingSessionSource={id,actorKind:a.kind,actorId:a.id,actionId:'fish.session',state:'active',ruleVersion:1,catalogRevision:2,rodInstanceId:rod.id,requestedCasts,startedAt:f.now(),endedAt:null};await run(async ctx=>{await activity(ctx,s);await ctx.sql.mutate('INSERT INTO life.fishing_sessions(id,version,actor_kind,actor_id,state,data) VALUES($1,1,$2,$3,\'active\',$4)',[id,a.kind,a.id,s]);});return s;}
  async function cast(s:LifeFishingSessionSource,index:number,itemId:LifeFishingCastSource['outcome']['itemId']){const id=s.id+':cast:'+index,v:LifeFishingCastSource={id,sessionId:s.id,actorKind:s.actorKind,actorId:s.actorId,state:'active',ruleVersion:1,catalogRevision:2,castIndex:index,spotId:'shore_spot',startedAt:f.now(),scheduledEndAt:f.now()+60000,endedAt:null,resultId:null,sourceEventId:null,outcome:{itemId,weightGrams:itemId?catalog.items.find(x=>x.id===itemId)!.weightGrams![0]!:null}};await run(async ctx=>{await ctx.sql.mutate('INSERT INTO life.fishing_casts(id,version,session_id,cast_index,state,started_at,scheduled_end_at,data) VALUES($1,1,$2,$3,\'active\',$4,$5,$6)',[id,s.id,index,v.startedAt,v.scheduledEndAt,v]);});return v;}
  async function settle(v:LifeFishingCastSource,state:'completed'|'cancelled'|'interrupted'='completed'){
   const s={...v,state,endedAt:f.now(),resultId:v.id,sourceEventId:'event:'+v.id};return run(async ctx=>{await ctx.sql.mutate('UPDATE life.fishing_casts SET version=version+1,state=$2,ended_at=$3,result_id=$1,source_event_id=$4,data=$5 WHERE id=$1',[v.id,state,s.endedAt,s.sourceEventId,s]);const effect=await ctx.assets.settleFishingCast({actorRef:{kind:v.actorKind,id:v.actorId},castId:v.id});await event(ctx,s);return effect;});
  }
  async function release(s:LifeFishingSessionSource,state='completed'){
   const terminal={...s,state,endedAt:f.now()};return run(async ctx=>{await ctx.sql.mutate('UPDATE life.fishing_sessions SET version=version+1,state=$2,data=$3 WHERE id=$1',[s.id,state,terminal]);const e=await ctx.assets.releaseFishing({actorRef:{kind:s.actorKind,id:s.actorId},sessionId:s.id});await ctx.sql.mutate('UPDATE life.activities SET version=version+1,state=$2,ended_at=$3,result_id=$1,data=$4 WHERE id=$1',[s.id,state,f.now(),terminal]);return e;});
  }
  await t.test('three frozen casts consume three reserved bait, create distinct sourced fish or successful empty results, then sell exactly once',async()=>{
   f.tick(1);const s=await newSession('three-casts',3);const reservations=await Promise.all([run(ctx=>ctx.assets.reserveFishing({actorRef:agent,sessionId:s.id})),run(ctx=>ctx.assets.reserveFishing({actorRef:agent,sessionId:s.id}))]);assert.deepEqual(reservations[0],reservations[1]);assert.equal(total(await read(),'bait','reserved'),3);assert.equal(total(await read(),'basic_rod','reserved'),1);
   const catches:string[]=[];
   for(const [index,id]of (['sardine','mackerel',null] as const).entries()){const v=await cast(s,index,id);const starts=await Promise.all([run(ctx=>ctx.assets.startFishingCast({actorRef:agent,castId:v.id})),run(ctx=>ctx.assets.startFishingCast({actorRef:agent,castId:v.id}))]);assert.deepEqual(starts[0],starts[1]);assert.equal(starts[0]!.baitConsumed,1);await assert.rejects(run(ctx=>ctx.assets.settleFishingCast({actorRef:agent,castId:v.id})),code('invalid_usage'));f.tick(60000);const e=await settle(v);assert.equal(e.itemIds.length,id?1:0);catches.push(...e.itemIds);assert.deepEqual(await run(ctx=>ctx.assets.settleFishingCast({actorRef:agent,castId:v.id})),e);}
   await release(s);assert.equal(total(await read(),'bait'),0);assert.equal(total(await read(),'basic_rod'),1);assert.equal(catches.length,2);
   const held=(await read()).items.filter(x=>x.fish);assert.equal(held[0]!.fish!.caughtAt>0,true);assert.equal(held.every(x=>x.fish!.castId.startsWith(s.id)),true);
   const sale:LifeTradeSource={id:'sell-two-fish',actorKind:'agent',actorId:agent.id,actionId:'shop.sell',state:'completed',placeId:'fisher_shop',catalogRevision:2,ruleVersion:1,startedAt:f.now(),endedAt:f.now(),resultId:'sell-two-fish',sourceEventId:'event:sell-two-fish',quote:{catalogRevision:2,ruleVersion:1,createdAt:f.now()-1,expiresAt:f.now()+1000,items:[{itemId:'sardine',unitPrice:4},{itemId:'mackerel',unitPrice:8}]},sale:{instanceIds:catches,minIncome:12},moneyAmount:12};
   await saveTrade(sale);const first=await invoke(sale);assert.equal(first.moneyDelta,12);assert.deepEqual(await invoke(sale),first);assert.equal((await read()).wallet.balance,12);assert.equal((await read()).items.filter(x=>x.fish).length,0);
   const again={...sale,id:'sell-again',resultId:'sell-again',sourceEventId:'event:sell-again'};await saveTrade(again);await assert.rejects(invoke(again),code('item_not_available'));assert.equal((await read()).wallet.balance,12);
  });
  await t.test('cancel keeps spent bait, releases unopened bait; system interruption returns one original bait once and never produces fish',async()=>{
   const purchase=trade('cancel-bait','bait',3);await saveTrade(purchase);await invoke(purchase);f.tick(1);const s=await newSession('cancel-session',3);await run(ctx=>ctx.assets.reserveFishing({actorRef:agent,sessionId:s.id}));const v=await cast(s,0,'sea_bass');await run(ctx=>ctx.assets.startFishingCast({actorRef:agent,castId:v.id}));f.tick(1000);const cancelled=await settle(v,'cancelled');assert.equal(cancelled.baitReturned,0);assert.equal(cancelled.itemIds.length,0);await release(s,'cancelled');assert.equal(total(await read(),'bait'),2);assert.equal(total(await read(),'basic_rod'),1);
   f.tick(1);const second=await newSession('interrupted-session',2);await run(ctx=>ctx.assets.reserveFishing({actorRef:agent,sessionId:second.id}));const interrupted=await cast(second,0,'sardine');await run(ctx=>ctx.assets.startFishingCast({actorRef:agent,castId:interrupted.id}));f.tick(1000);const e=await settle(interrupted,'interrupted');assert.equal(e.baitReturned,1);assert.deepEqual(await run(ctx=>ctx.assets.settleFishingCast({actorRef:agent,castId:interrupted.id})),e);const released=await release(second,'interrupted');assert.deepEqual(await run(ctx=>ctx.assets.releaseFishing({actorRef:agent,sessionId:second.id})),released);assert.equal(total(await read(),'bait'),2);assert.equal((await read()).items.filter(x=>x.fish).length,0);
   await assert.rejects(f.appQuery("UPDATE life.fishing_casts SET version=version+1,state='completed' WHERE id=$1",[interrupted.id]),/immutable|permission denied/);
   // The third fish species uses the same real instance/weight/sale path; no additional timing harness.
   f.tick(1);const bassSession=await newSession('bass-session',1);await run(ctx=>ctx.assets.reserveFishing({actorRef:agent,sessionId:bassSession.id}));const bass=await cast(bassSession,0,'sea_bass');await run(ctx=>ctx.assets.startFishingCast({actorRef:agent,castId:bass.id}));f.tick(60000);const caught=await settle(bass);await release(bassSession);assert.equal(total(await read(),'sea_bass'),1);assert.equal((await read()).items.find(x=>x.id===caught.itemIds[0])!.fish!.weightGrams,800);
   const sale:LifeTradeSource={id:'sell-bass',actorKind:'agent',actorId:agent.id,actionId:'shop.sell',state:'completed',placeId:'fisher_shop',catalogRevision:2,ruleVersion:1,startedAt:f.now(),endedAt:f.now(),resultId:'sell-bass',sourceEventId:'event:sell-bass',quote:{catalogRevision:2,ruleVersion:1,createdAt:f.now()-1,expiresAt:f.now()+1000,items:[{itemId:'sea_bass',unitPrice:14}]},sale:{instanceIds:caught.itemIds,minIncome:14},moneyAmount:14};await saveTrade(sale);await invoke(sale);assert.equal((await read()).wallet.balance,20);
  });
  await t.test('different purchases cannot overspend; invalid terms and missing deferred event cannot create assets',async()=>{
   const x=trade('other-buy-1','bait',1,other),y=trade('other-buy-2','bait',1,other);await saveTrade(x);await saveTrade(y);const r=await Promise.allSettled([invoke(x),invoke(y)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await read(other)).wallet.balance,0);assert.equal(total(await read(other),'bait'),1);
   const wrong=trade('wrong-price');wrong.moneyAmount=1;await saveTrade(wrong);await assert.rejects(invoke(wrong),code('invalid_usage'));
   const before=await read(),missing=trade('missing-event');await assert.rejects(run(async ctx=>{await activity(ctx,missing);await ctx.assets.buyFromActivity({actorRef:agent,activityId:missing.id});}),code('constraint'));assert.deepEqual(await read(),before);
   await assert.rejects(f.appQuery('UPDATE wallet.life_postings SET delta=1'),/permission denied/);await assert.rejects(f.appQuery("DELETE FROM life_assets.effects"),/permission denied/);
  });
  await t.test('A1 initialization survives B2 activation; fifth real NPC gets 80 once and its trade remains separate from Agent money',async()=>{
   const old={kind:'npc' as const,id:'npc-mayor'},clerk={kind:'npc' as const,id:'npc-fishing-clerk'};
   for(const a of [old,clerk])await f.query('INSERT INTO town_services.npcs(npc_id,created_at) VALUES($1,$2)',[a.id,f.now()]);
   const wallet=(scope:PostgresScope,revision:number)=>createLifeWalletRepository(runtimeSql(scope,f.now),{catalog:{...design,revision,ruleVersion:1},readCompletedWorkRewardSource:async id=>{const sql=runtimeSql(scope,f.now);return (await sql.query('SELECT data FROM life.activities WHERE id=$1',[id]))[0]?.data as WorkRewardSource|undefined;}}).writer;
   const original=await h.transaction(scope=>wallet(scope,1).initializeNpc({actorRef:old}));await f.query('UPDATE wallet.npc_accounts SET version=version+1,balance=0 WHERE npc_id=$1',[old.id]);assert.deepEqual(await h.transaction(scope=>wallet(scope,2).initializeNpc({actorRef:old})),original);assert.equal((await read(old)).wallet.balance,0);
   const init=await Promise.all([h.transaction(scope=>wallet(scope,2).initializeNpc({actorRef:clerk})),h.transaction(scope=>wallet(scope,2).initializeNpc({actorRef:clerk}))]);assert.deepEqual(init[0],init[1]);assert.equal(init[0]!.amount,80);const p=trade('npc-buy','basic_rod',1,clerk);await saveTrade(p);await invoke(p);assert.equal((await read(clerk)).wallet.balance,50);assert.equal(total(await read(clerk),'basic_rod'),1);
   const wage:WorkRewardSource={id:'historical-a-work',actorKind:'npc',actorId:old.id,actionId:'work.shift',jobId:'harbor_shift',ruleVersion:1,catalogRevision:1,state:'completed',startedAt:f.now()-600000,scheduledEndAt:f.now(),endedAt:f.now(),resultId:'historical-a-work',sourceEventId:'event:historical-a-work',rewardAmount:36};
   await run(async ctx=>{await actorRow(ctx,old);await ctx.sql.mutate("INSERT INTO life.activities(id,version,actor_kind,actor_id,action_id,job_id,rule_version,catalog_revision,state,place_id,station_id,seat,started_at,scheduled_end_at,ended_at,result_id,source_event_id,reward_amount,data) VALUES($1,1,'npc',$2,'work.shift','harbor_shift',1,1,'completed','harbor_work',$1,0,$3,$4,$4,$1,$5,36,$6)",[wage.id,old.id,wage.startedAt,wage.endedAt,wage.sourceEventId,wage]);await event(ctx,wage);});
   const paid=await h.transaction(scope=>wallet(scope,2).rewardCompletedWork({actorRef:old,activityId:wage.id}));assert.equal(paid.catalogRevision,1);assert.equal(paid.amount,36);assert.equal((await read(old)).wallet.balance,36);assert.equal((await read()).wallet.balance,20);
   assert.deepEqual(await f.query('SELECT (SELECT count(*)::int FROM iam.agents) AS agents,(SELECT count(*)::int FROM wallet.welcome_credits) AS welcome,(SELECT count(*)::int FROM town_services.resident_gifts) AS gifts,(SELECT count(*)::int FROM town_services.item_instances) AS legacy_items'),before);
  });
 }finally{await host?.close();await f.dispose();}
});
