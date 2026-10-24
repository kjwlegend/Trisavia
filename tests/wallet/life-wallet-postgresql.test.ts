import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {worldFixture} from '../runtime/postgresql-fixture.ts';
import {walletRepository} from '../../apps/platform/domains/wallet/repository.ts';
import type {LifeWalletCatalog,WalletActorRef,WorkRewardSource} from '../../apps/platform/domains/wallet/life-wallet.ts';
import {hashRuntimeRequest} from '../../apps/platform/domains/runtime/command.ts';
import {createLifeWalletRepository} from '../../apps/platform/infrastructure/postgresql/life-wallet-repository.ts';
import {LIFE_WALLET_MIGRATION,LIFE_WALLET_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/life-wallet-migration.ts';
import {openPostgresTransactionHost,type PostgresScope} from '../../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {runtimeSql} from '../../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import {createRuntimeRepositories} from '../../apps/platform/infrastructure/postgresql/runtime-repositories.ts';

const design=JSON.parse(readFileSync(new URL('../../docs/workstreams/ws03-interaction/life-actions-v1/catalog.json',import.meta.url),'utf8'));
const catalog:LifeWalletCatalog={...design,ruleVersion:design.revision};
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===expected;

test('life wallet participates in the caller transaction, credits actual work once and keeps NPC initialization separate',async t=>{
 const f=await worldFixture({bootstrap:false});let host:Awaited<ReturnType<typeof openPostgresTransactionHost>>|undefined;
 try{
  const a=await f.register(),b=await f.register(),agent:WalletActorRef={kind:'agent',id:a.agentId},other:WalletActorRef={kind:'agent',id:b.agentId};
  // Minimal lifecycle source fixture: this tests the wallet's same-client port, not the lifecycle scheduler or its elapsed-time acceptance.
  await f.query('CREATE SCHEMA life;CREATE TABLE life.activities(id text PRIMARY KEY,data jsonb NOT NULL);GRANT USAGE ON SCHEMA life TO connet_app;GRANT SELECT,INSERT,UPDATE ON life.activities TO connet_app');
  await f.query(LIFE_WALLET_MIGRATION.sql);await f.query(LIFE_WALLET_PERMISSIONS_SQL);
  for(const npc of catalog.npcProfiles.filter(p=>p.stage==='A'))await f.query('INSERT INTO town_services.npcs(npc_id,created_at) VALUES($1,$2)',[npc.id,f.now()]);
  await f.query('UPDATE wallet.accounts SET version=version+1,balance=CASE WHEN agent_id=$1 THEN 17 ELSE 91 END',[a.agentId]);
  host=await openPostgresTransactionHost(f.options);
  const h=host;
  const bind=(scope:PostgresScope)=>{
   const sql=runtimeSql(scope,f.now),wallet=createLifeWalletRepository(sql,{catalog,readCompletedWorkRewardSource:async id=>(await sql.query('SELECT data FROM life.activities WHERE id=$1',[id]))[0]?.data as WorkRewardSource|undefined}).writer;
   return {sql,wallet,...createRuntimeRepositories(sql,f.identity.recoveryEpoch)};
  };
  const account=(ref:WalletActorRef)=>h.read(async scope=>bind(scope).wallet.getAccount(ref));
  const source=(id:string,ref=agent,changes:Partial<WorkRewardSource>={}):WorkRewardSource=>{
   const job=catalog.jobs.find(j=>j.id===(changes.jobId??'harbor_shift'))!;
   return {id,actorKind:ref.kind,actorId:ref.id,actionId:'work.shift',jobId:job.id,ruleVersion:1,catalogRevision:1,state:'completed',startedAt:f.now()-job.durationSeconds*1000,scheduledEndAt:f.now(),endedAt:f.now(),resultId:id,sourceEventId:'event:'+id,rewardAmount:job.coinReward,...changes};
  };
  const save=async(ctx:ReturnType<typeof bind>,s:WorkRewardSource)=>{await ctx.sql.mutate('INSERT INTO life.activities(id,data) VALUES($1,$2)',[s.id,s]);};
  const fact=async(ctx:ReturnType<typeof bind>,s:WorkRewardSource)=>{
   await ctx.events.append({eventId:s.sourceEventId!,domain:'life',kind:'activity.completed',schemaVersion:1,subject:{type:'activity',id:s.id,version:2},actor:{kind:'system',id:'synthetic-lifecycle'},source:'rules',occurredAt:s.endedAt!,causationId:s.id,correlationId:s.id,audience:{kind:'agents',agentIds:s.actorKind==='agent'?[s.actorId]:[]},payload:{activityId:s.id,rewardAmount:s.rewardAmount}});
  };
  const receipt=async(ctx:ReturnType<typeof bind>,s:WorkRewardSource)=>{
   await ctx.commands.insert({key:{domain:'life',action:'complete',commandId:s.id,principal:{kind:'system',id:'synthetic-lifecycle'},recoveryEpoch:f.identity.recoveryEpoch},requestHash:hashRuntimeRequest({id:s.id}),outcome:'committed',result:{activityId:s.id},eventIds:[s.sourceEventId!],committedAt:f.now()});
   await ctx.outbox.enqueue({outboxId:'outbox:'+s.id,eventId:s.sourceEventId!,consumerId:'synthetic-life-result',dedupeKey:s.id,generation:1,dueAt:f.now(),maxAttempts:3});
  };
  await h.transaction(async scope=>{await bind(scope).tasks.advanceGeneration('life',0);});
  f.tick(600_000);
  await t.test('work, balance/version, result receipt, event and outbox commit or roll back together',async()=>{
   const s=source('atomic-work');
   await assert.rejects(h.transaction(async scope=>{const ctx=bind(scope);await save(ctx,s);await ctx.wallet.rewardCompletedWork({actorRef:agent,activityId:s.id});await fact(ctx,s);await receipt(ctx,s);throw new Error('Synthetic failure after all writes');}),/Synthetic failure/);
   assert.equal((await account(agent))!.balance,17);
   assert.deepEqual(await f.query("SELECT (SELECT count(*)::int FROM life.activities WHERE id='atomic-work') AS activities,(SELECT count(*)::int FROM wallet.life_credits) AS credits,(SELECT count(*)::int FROM runtime.events WHERE event_id='event:atomic-work') AS events,(SELECT count(*)::int FROM runtime.command_receipts WHERE command_id='atomic-work') AS receipts,(SELECT count(*)::int FROM runtime.outbox WHERE outbox_id='outbox:atomic-work') AS outbox"),[{activities:0,credits:0,events:0,receipts:0,outbox:0}]);
   const paid=await h.transaction(async scope=>{const ctx=bind(scope);await save(ctx,s);const paid=await ctx.wallet.rewardCompletedWork({actorRef:agent,activityId:s.id});await fact(ctx,s);await receipt(ctx,s);return paid;});
   assert.equal(paid.reason,'life.work.reward');assert.equal(paid.amount,36);assert.equal(paid.balanceBefore,17);assert.equal(paid.balanceAfter,53);assert.equal(paid.accountVersionAfter,paid.accountVersionBefore+1);
   assert.equal(paid.occurredAt,s.endedAt);f.tick(5000);
   assert.deepEqual(await h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:agent,activityId:s.id})),paid);
   const legacy=await f.legacy.read(tx=>walletRepository(tx).get(agent.id));assert.equal(legacy!.data.balance,53);assert.equal(legacy!.version,paid.accountVersionAfter);
   const missing=source('missing-event');
   await assert.rejects(h.transaction(async scope=>{const ctx=bind(scope);await save(ctx,missing);await ctx.wallet.rewardCompletedWork({actorRef:agent,activityId:missing.id});}),code('constraint'));
   assert.equal((await account(agent))!.balance,53);
  });
  await t.test('two first completion attempts and later retries yield one immutable wage; changed source conflicts',async()=>{
   const s=source('concurrent-work',agent,{jobId:'tavern_shift',rewardAmount:24});
   await h.transaction(async scope=>{const ctx=bind(scope);await save(ctx,s);await fact(ctx,s);});
   const paid=await Promise.all([h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:agent,activityId:s.id})),h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:agent,activityId:s.id}))]);
   assert.deepEqual(paid[0],paid[1]);assert.equal(paid[0]!.amount,24);assert.equal((await account(agent))!.balance,77);
   await f.query('UPDATE life.activities SET data=$2 WHERE id=$1',[s.id,{...s,endedAt:s.endedAt!+1}]);
   await assert.rejects(h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:agent,activityId:s.id})),code('command_conflict'));
   await f.query('UPDATE life.activities SET data=$2 WHERE id=$1',[s.id,s]);
   await assert.rejects(h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:other,activityId:s.id})),code('command_conflict'));
   await assert.rejects(f.appQuery('UPDATE wallet.life_credits SET amount=amount+1'),/permission denied/);
   assert.equal((await account(agent))!.balance,77);
  });
  await t.test('uncompleted, cancelled, invalid terms, nonexistent actors and safe integer overflow never credit',async()=>{
   for(const [id,changes]of [['active',{state:'active',endedAt:null}],['cancelled',{state:'cancelled'}],['interrupted',{state:'interrupted'}],['rest',{actionId:'rest.bench'}],['early',{endedAt:f.now()-1}],['wrong-amount',{rewardAmount:100}],['wrong-rule',{ruleVersion:2}]] as const){
    const s=source(id,agent,changes);await h.transaction(async scope=>save(bind(scope),s));
    await assert.rejects(h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:agent,activityId:s.id})),code('invalid_usage'));
   }
   const unknown:WalletActorRef={kind:'agent',id:'not-a-registered-agent'},s=source('unknown-agent',unknown);
   await h.transaction(async scope=>save(bind(scope),s));await assert.rejects(h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:unknown,activityId:s.id})),code('wallet_not_initialized'));
   await f.query('UPDATE wallet.accounts SET version=version+1,balance=$2 WHERE agent_id=$1',[b.agentId,Number.MAX_SAFE_INTEGER]);
   const full=source('full-wallet',other);await h.transaction(async scope=>save(bind(scope),full));
   await assert.rejects(h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:other,activityId:full.id})),code('wallet_capacity'));
   await f.query('UPDATE wallet.accounts SET version=version+1,balance=91 WHERE agent_id=$1',[b.agentId]);
   assert.equal((await account(agent))!.balance,77);assert.equal((await account(other))!.balance,91);
   assert.equal((await f.query('SELECT count(*)::int AS n FROM wallet.life_credits WHERE reason=$1',['life.work.reward']))[0]!.n,2);
   await assert.rejects(h.read(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:agent,activityId:'atomic-work'})),code('invalid_usage'));
  });
  await t.test('four actual NPCs get 80 once each, without Agent rows or welcome grants; depleted wallets never reinitialize',async()=>{
   const before=(await f.query('SELECT (SELECT count(*)::int FROM iam.agents) AS agents,(SELECT count(*)::int FROM wallet.welcome_credits) AS welcome,(SELECT count(*)::int FROM town_services.resident_gifts) AS gifts,(SELECT count(*)::int FROM town_services.item_instances) AS items'))[0];
   const refs=catalog.npcProfiles.filter(p=>p.stage==='A').map(p=>({kind:'npc' as const,id:p.id}));
   const uninitialized=source('npc-no-initialization',refs[0]!);await h.transaction(async scope=>save(bind(scope),uninitialized));
   await assert.rejects(h.transaction(async scope=>bind(scope).wallet.rewardCompletedWork({actorRef:refs[0]!,activityId:uninitialized.id})),code('invalid_usage'));
   for(const ref of refs){const grants=await Promise.all([h.transaction(async scope=>bind(scope).wallet.initializeNpc({actorRef:ref})),h.transaction(async scope=>bind(scope).wallet.initializeNpc({actorRef:ref}))]);assert.deepEqual(grants[0],grants[1]);assert.equal(grants[0]!.amount,80);assert.equal((await account(ref))!.balance,80);}
   assert.deepEqual(await f.query("SELECT count(*)::int AS n,sum(amount)::int AS total FROM wallet.life_credits WHERE reason='life.npc.initialization'"),[{n:4,total:320}]);
   const ref=refs[0]!;await f.query('UPDATE wallet.npc_accounts SET version=version+1,balance=0 WHERE npc_id=$1',[ref.id]);f.tick(1000);
   const original=await h.transaction(async scope=>bind(scope).wallet.initializeNpc({actorRef:ref}));assert.equal(original.balanceAfter,80);assert.equal((await account(ref))!.balance,0);
   const s=source('npc-work',ref);const paid=await h.transaction(async scope=>{const ctx=bind(scope);await save(ctx,s);const paid=await ctx.wallet.rewardCompletedWork({actorRef:ref,activityId:s.id});await fact(ctx,s);return paid;});assert.equal(paid.balanceAfter,36);assert.equal((await account(ref))!.balance,36);
   await assert.rejects(h.transaction(async scope=>bind(scope).wallet.initializeNpc({actorRef:agent})),code('invalid_usage'));
   await assert.rejects(h.transaction(async scope=>bind(scope).wallet.initializeNpc({actorRef:{kind:'npc',id:'npc-fishing-clerk'}})),code('invalid_usage'));
   assert.deepEqual((await f.query('SELECT (SELECT count(*)::int FROM iam.agents) AS agents,(SELECT count(*)::int FROM wallet.welcome_credits) AS welcome,(SELECT count(*)::int FROM town_services.resident_gifts) AS gifts,(SELECT count(*)::int FROM town_services.item_instances) AS items'))[0],before);
   assert.equal((await account(agent))!.balance,77);assert.equal((await account(other))!.balance,91);
  });
 }finally{await host?.close();await f.dispose();}
});
