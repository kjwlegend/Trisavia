import assert from 'node:assert/strict';
import test,{after,beforeEach} from 'node:test';
import { Pool } from 'pg';
import type { JsonObject, QuotaCountQuery } from '../../apps/platform/contracts/store.ts';
import { createPostgresSession } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { quotaSelection } from '../../apps/platform/infrastructure/postgresql/quota.ts';
import { admin,applicationOptions,row,errorCode,resetFixture,testStore } from './storage-fixture.ts';

beforeEach(resetFixture);after(()=>admin.end());
const now=1_900_000_000_000,since=now-3_600_000;
test('bounded domain quota counts match strict windows, source keys, same-email joins and invite authority',async()=>{
  const store=await testStore(),attempts:JsonObject[]=[],jobs:JsonObject[]=[],recoveries:JsonObject[]=[],invites:JsonObject[]=[];
  try{
    await store.transaction(async tx=>{
      await tx.insert('agents',row('a'));for(const id of ['o','o2'])await tx.insert('owners',row(id,{status:'active'}));
      async function attempt(id:string,createdAt:number,sourceKey:string,emailKey:string,ownerId='o'){
        await tx.insert('credentials',row(id+'-browser',{fingerprint:id,kind:'email_registration',verifier:'fixture-only',epoch:'epoch-test',active:true}));
        const data={browserCredentialId:id+'-browser',purpose:'registration',createdAt,sourceKey,emailKey,ownerId};attempts.push({id,...data});await tx.insert('email_attempts',row(id,data));
      }
      await attempt('same-email',now,'s1','same@example.invalid');await attempt('cross-owner',now,'s2','same@example.invalid','o2');await attempt('different-email',now,'s1','different@example.invalid');await attempt('boundary',since,'s1','same@example.invalid');
      async function job(id:string,data:JsonObject){const full={purpose:'code',ownerKey:'other',createdAt:now,encryptedPayload:'ciphertext-fixture-only',...data};jobs.push({id,...full});await tx.insert('mail_jobs',row(id,full));}
      await job('direct-owner',{ownerKey:'o',sourceKey:'s1'});await job('same-email',{attemptId:'same-email',sourceKey:'s1'});await job('cross-owner',{attemptId:'cross-owner',sourceKey:'s2'});await job('different',{attemptId:'different-email',sourceKey:'s1'});await job('missing-attempt',{attemptId:'not-found',sourceKey:'s1'});await job('boundary',{ownerKey:'o',createdAt:since,sourceKey:'s1'});await job('notification',{purpose:'notification',ownerKey:'o',sourceKey:'s1'});
      for(let index=0;index<200;index++){await attempt(`old-${index}`,since-1,'s1','same@example.invalid');await job(`old-${index}`,{createdAt:since-1,ownerKey:'o',sourceKey:'s1',encryptedPayload:'not-selected-'.repeat(2000)});}
      for(const[id,createdAt,ownerId,sourceKey]of [['r1',now,'o','s1'],['r2',now,'o2','s1'],['r3',now,'o','s2'],['r-boundary',since,'o','s1']] as const){await tx.insert('credentials',row(id,{fingerprint:id,kind:'recovery_assistance',verifier:'fixture-only',epoch:'epoch-test',active:true,agentId:'a',ownerId}));const data={agentId:'a',ownerId,contextCredentialId:id,status:'pending',createdAt,sourceKey};recoveries.push(data);await tx.insert('recovery_requests',row(id,data));}
      for(const[id,ownerId,active,expiresAt]of [['invite-valid','o',true,now+1],['invite-boundary','o',true,now],['invite-inactive','o',false,now+1],['invite-other','o2',true,now+1]] as const){const data={fingerprint:id,kind:'invite',verifier:'fixture-only',epoch:'epoch-test',active,ownerId,expiresAt};invites.push(data);await tx.insert('credentials',row(id,data));}
    });
    const cases:QuotaCountQuery[]=[{kind:'email_attempts_recent',since,limit:1000},{kind:'email_attempts_recent',since,sourceKeys:['s1','s2'],limit:2},{kind:'email_attempts_recent',since,sourceKeys:[],limit:1000},{kind:'code_mail_recent',since,limit:1000},{kind:'code_mail_recent',since,related:{ownerKey:'o',emailKey:'same@example.invalid'},limit:1000},{kind:'code_mail_recent',since,related:{ownerKey:'o',emailKey:'same@example.invalid'},sourceKeys:['s1'],limit:1000},{kind:'code_mail_recent',since,sourceKeys:['s1','s2'],limit:2},{kind:'code_mail_recent',since,sourceKeys:[],limit:1000},{kind:'recovery_requests_recent',since,limit:1000},{kind:'recovery_requests_recent',since,ownerId:'o',limit:1000},{kind:'recovery_requests_recent',since,sourceKey:'s1',limit:1000},{kind:'recovery_requests_recent',since,ownerId:'o',sourceKey:'s1',limit:1},{kind:'active_invites',ownerId:'o',after:now,limit:100}];
    for(const query of cases){
      const expected=query.kind==='email_attempts_recent'?attempts.filter(item=>Number(item.createdAt)>query.since&&(!query.sourceKeys||query.sourceKeys.includes(item.sourceKey as string))).length:
        query.kind==='code_mail_recent'?jobs.filter(item=>item.purpose==='code'&&Number(item.createdAt)>query.since&&(!query.sourceKeys||query.sourceKeys.includes(item.sourceKey as string))&&(!query.related||item.ownerKey===query.related.ownerKey||attempts.some(attempt=>attempt.id===item.attemptId&&attempt.emailKey===query.related!.emailKey))).length:
        query.kind==='recovery_requests_recent'?recoveries.filter(item=>Number(item.createdAt)>query.since&&(query.ownerId===undefined||item.ownerId===query.ownerId)&&(query.sourceKey===undefined||item.sourceKey===query.sourceKey)).length:
        query.kind==='active_invites'?invites.filter(item=>item.kind==='invite'&&item.active===true&&item.ownerId===query.ownerId&&Number(item.expiresAt)>query.after).length:0;
      assert.equal(await store.read(tx=>tx.quotaCount(query)),Math.min(expected,query.limit),JSON.stringify(query));
    }
    assert.equal(await store.transaction(tx=>tx.quotaCount({kind:'active_invites',ownerId:'o',after:now,limit:1})),1);
  }finally{await store.close();}
});

test('pending recovery is one current-authority existence query with the exact existing status predicates',async()=>{
  const store=await testStore(),pool=new Pool({connectionString:applicationOptions.connectionString,max:1});
  const query:QuotaCountQuery={kind:'pending_recovery',agentId:'a',epoch:'epoch-test',after:now,limit:1};
  try{
    await store.transaction(async tx=>{
      await tx.insert('agents',row('a',{runtimeActive:true,runtimeVersion:1}));await tx.insert('agents',row('other',{runtimeActive:true,runtimeVersion:1}));
      await tx.insert('owners',row('o',{status:'active',epoch:'epoch-test',authVersion:1}));await tx.insert('bindings',row('binding',{agentId:'a',ownerId:'o',active:true}));
      await tx.insert('credentials',row('runtime',{fingerprint:'runtime',kind:'runtime',verifier:'fixture-only',epoch:'epoch-test',active:true,runtimeVersion:1,agentId:'a'}));
      for(let index=0;index<201;index++){
        const id=`request-${index}`;await tx.insert('credentials',row(id,{fingerprint:id,kind:'recovery_assistance',verifier:'fixture-only',epoch:'epoch-test',active:true}));
        await tx.insert('recovery_requests',row(id,{agentId:'a',ownerId:'o',contextCredentialId:id,bindingId:'binding',bindingVersion:1,creatorRuntimeCredentialId:'runtime',creatorRuntimeVersion:1,ownerAuthVersion:1,epoch:'epoch-test',status:'pending',expiresAt:index===200?now+1:now}));
      }
    });
    assert.equal(await store.read(tx=>tx.quotaCount(query)),1);
    const mismatches=[['iam.recovery_requests',"status='completed'","status='pending'","id='request-200'"],['iam.recovery_requests',"epoch='other'","epoch='epoch-test'","id='request-200'"],['iam.recovery_requests',`expires_at=to_timestamp(${now}/1000.0)`,`expires_at=to_timestamp(${now+1}/1000.0)`,"id='request-200'"],['iam.human_accounts',"status='pending_setup'","status='active'","id='o'"],['iam.human_accounts',"epoch='other'","epoch='epoch-test'","id='o'"],['iam.human_accounts','auth_version=2','auth_version=1',"id='o'"],['iam.management_bindings','version=2','version=1',"id='binding'"],['iam.management_bindings','active=false','active=true',"id='binding'"],['iam.credentials','active=false','active=true',"id='runtime'"],['iam.credentials',"kind='bootstrap'","kind='runtime'","id='runtime'"],['iam.credentials',"epoch='other'","epoch='epoch-test'","id='runtime'"],['iam.credentials','runtime_version=2','runtime_version=1',"id='runtime'"],['iam.agents','runtime_active=false','runtime_active=true',"id='a'"],['iam.agents','runtime_version=2','runtime_version=1',"id='a'"]] as const;
    for(const[table,change,restore,where]of mismatches){await pool.query(`UPDATE ${table} SET ${change} WHERE ${where}`);assert.equal(await store.read(tx=>tx.quotaCount(query)),0,`${table} ${change}`);await pool.query(`UPDATE ${table} SET ${restore} WHERE ${where}`);assert.equal(await store.read(tx=>tx.quotaCount(query)),1);}
    await pool.query("UPDATE iam.management_bindings SET agent_id='other' WHERE id='binding'; UPDATE iam.credentials SET agent_id='other' WHERE id='runtime'");
    assert.equal(await store.read(tx=>tx.quotaCount(query)),1,'The port does not invent extra conditions absent from the existing recovery status predicate');
  }finally{await pool.end();await store.close();}
});

test('quota adapter issues one count-only SQL statement and rejects uncontrolled query shapes',async()=>{
  const pool=new Pool({connectionString:applicationOptions.connectionString,max:1}),client=await pool.connect();
  try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query('SELECT singleton FROM platform.instance_state WHERE singleton=1 FOR SHARE');
    const original=client.query.bind(client),statements:string[]=[];
    client.query=((...args:unknown[])=>{statements.push(String(args[0]));return Reflect.apply(original,client,args);}) as typeof client.query;
    const session=createPostgresSession(client,false,()=>true),query:QuotaCountQuery={kind:'code_mail_recent',since,related:{ownerKey:'o',emailKey:'same@example.invalid'},sourceKeys:['s1'],limit:3};
    assert.equal(await session.quotaCount(query),0);assert.equal(statements.length,1);assert.equal(statements[0],quotaSelection(query).sql);
    assert.match(statements[0]!,/SELECT count\(\*\).*SELECT 1 .*WHERE .*LIMIT/s);assert.doesNotMatch(statements[0]!,/encrypted_payload|to_jsonb|SELECT \*/i);
    for(const invalid of [{...query,limit:0},{...query,since:NaN},{...query,kind:'unknown'},{...query,extra:'not-allowed'},{...query,sourceKeys:[1]}] as unknown as QuotaCountQuery[])await assert.rejects(session.quotaCount(invalid),errorCode('invalid_usage'));
    assert.equal(statements.length,1);client.query=original;await client.query('ROLLBACK');
  }finally{client.release();await pool.end();}
});
