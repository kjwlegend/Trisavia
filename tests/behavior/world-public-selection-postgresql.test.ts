import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {expressionPgFixture} from '../world/expressions-pg-fixture.ts';
import {readRuntime} from '../../scripts/postgresql/runtime.ts';
import {BEHAVIOR_REPOSITORY} from '../../apps/platform/domains/behavior/repository.ts';

/** Synthetic committed behavior projections test the real selection SQL, not Life completion or user credentials. */
test('one creator-a PG fixture: old qualified rows survive 620 newer NPC results before LIMIT/keyset; reads do not write sources',{
 skip:!process.env.WORLD_CORE_TEST_RUNTIME,
},async()=>{
 const runtime=await readRuntime(process.env.WORLD_CORE_TEST_RUNTIME!);
 if(runtime.project!=='agents-era-pg'||runtime.port!==15432)throw new Error('Use the existing designated loopback test runtime only');
 const database=process.env.WORLD_LOG_TEST_DATABASE;
 if(!database||!/^world_core_a_log_072_[a-z0-9_]+$/.test(database))throw new Error('Explicit unique creator-a log database required');
 console.info(JSON.stringify({database,creator:'a',creating:true}));
 const f=await expressionPgFixture({database}),created=JSON.parse(await readFile(resolve(f.privateConnections,'created-database.json'),'utf8'));
 console.info(JSON.stringify({database,creator:'a',oid:created.oid,...f.identity,mode:'repository reads; no listener or real user'}));
 let pool:Pool|undefined;
 try{
  pool=new Pool({connectionString:(await readFile(resolve(f.privateConnections,'migration-database-url'),'utf8')).trim(),max:1});
  await pool.query("INSERT INTO town_services.npcs(npc_id,created_at) VALUES('npc-world-log-fixture',$1)",[f.now()]);
  await pool.query("INSERT INTO behavior.coverage(scope,from_at,policy_version,partial) VALUES('life',0,1,false)");
  const agent=await f.register();
  await f.runtime.transaction(async ctx=>{
   for(let i=0;i<623;i++){
    const npc=i>=3,id='synthetic-world-log-'+i,at=f.now()-(npc?i:20000),subjectId='synthetic-life-source-'+i;
    const event=await ctx.events.append({eventId:id,domain:'life',kind:'life.work.completed',schemaVersion:1,subject:{type:'life.activity',id:subjectId,version:2},actor:{kind:'system',id:'life-rules'},source:'rules',occurredAt:at,causationId:id,correlationId:id,audience:{kind:npc?'private':'agents',agentIds:npc?[]:[agent.agentId]},payload:{syntheticSelectionFixture:true}});
    await ctx.repository(BEHAVIOR_REPOSITORY).append({scope:'life',sourceDomain:'life',sourceEventId:event.eventId,sourceRef:{type:'life_activity',id:subjectId,version:2},node:'life.work.completed',agentId:npc?null:agent.agentId,...(npc?{npcId:'npc-world-log-fixture'}:{}),occurredAt:at,recordedAt:f.now(),causationId:id,correlationId:id,initiator:{kind:npc?'npc':'agent',id:npc?'npc-world-log-fixture':agent.agentId},executor:event.actor,origin:'rules',ownerAudience:null,publicProjection:{policyVersion:1,worldId:'default',sharingGeneration:1,placeId:'harbor_work',placeName:'盐风仓棚'}});
   }
  });
  const hash=async()=>(await pool!.query("SELECT (SELECT count(*) FROM behavior.records)::integer AS records,(SELECT md5(string_agg(row_to_json(r)::text,E'\\n' ORDER BY id)) FROM behavior.records r) AS record_hash,(SELECT md5(string_agg(row_to_json(e)::text,E'\\n' ORDER BY event_id)) FROM runtime.events e) AS event_hash,(SELECT write_generation FROM platform.instance_state WHERE singleton=1) AS generation")).rows;
  const before=await hash();
  await f.runtime.read(async ctx=>{
   const repo=ctx.repository(BEHAVIOR_REPOSITORY),cut=await repo.cut(),old=await repo.list({maxSequence:cut.maxSequence,publicOnly:true,userLogOnly:true,limit:50});
   assert.equal(old.length,50);assert(old.every(row=>row.npcId==='npc-world-log-fixture'));
   const first=await repo.list({maxSequence:cut.maxSequence,publicOnly:true,userLogOnly:true,worldPublicOnly:true,limit:2});
   assert.equal(first.length,2);assert(first.every(row=>row.agentId===agent.agentId));
   const last=first.at(-1)!,second=await repo.list({maxSequence:cut.maxSequence,publicOnly:true,userLogOnly:true,worldPublicOnly:true,after:{occurredAt:last.occurredAt,id:last.id},limit:2});
   assert.equal(second.length,1);assert(second.every(row=>row.agentId===agent.agentId));assert.equal(new Set([...first,...second].map(row=>row.id)).size,3);
   const selected=await repo.list({maxSequence:cut.maxSequence,agentId:agent.agentId,publicOnly:true,userLogOnly:true,limit:10});assert.equal(selected.length,3);
  });
  assert.deepEqual(await hash(),before,'World selection changes no original record/event/counter');
  console.info(JSON.stringify({database,oid:created.oid,qualifiedHistoricalRows:3,newerNpcRows:620,keysetPages:[2,1],sourceHashesPreserved:true}));
 }finally{await pool?.end();await f.dispose();console.info(JSON.stringify({database,creator:'a',oid:created.oid,finallyExactDrop:true}));}
});
