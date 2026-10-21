import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import type { JsonObject, JsonValue, M1ReadSession, StoredRow } from '../../apps/platform/contracts/store.ts';
import { bootstrapWorld } from '../../apps/platform/application/world-service.ts';
import { WORLD_REPOSITORY } from '../../apps/platform/domains/world/repository.ts';
import { encode } from '../../apps/platform/infrastructure/postgresql/codec.ts';
import { resolveModel } from '../../apps/platform/infrastructure/postgresql/model.ts';
import { migratePostgres, POSTGRES_MIGRATIONS } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { openPostgresStore, readLegacyAvatarIdentity } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { runtimeIdentitySession } from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { createWorldDatabase, dropWorldTestDatabase } from '../../scripts/world-core-database.ts';
import { grantWorldCorePermissions } from '../../scripts/world-core-prepare.ts';
import { readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';
import { worldFixture } from './postgresql-fixture.ts';

const catalogVersion='2026-10-21.appearance-v1.1';
const looks=['shorthair','longhair','curlyhair','bowlhair','mophair','spikeyhair'].map(name=>'sunnyside-human-'+name);
const appearance=(lookId=looks[0]!)=>({lookId,catalogVersion});
const code=(value:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===value);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

test('real app-role PG preserves both profile branches and enforces appearance mirrors, exact union, CAS and rollback',async t=>{
  const f=await worldFixture();t.after(f.dispose);const agent=await f.register();
  assert.equal((await f.appQuery('SELECT current_user AS role'))[0]!.role,'connet_app');
  let row=(await f.legacy.read(tx=>tx.find('profiles',{agentId:agent.agentId})))[0]!;
  const legacy={template:'basic',color:'blue'},draft={displayName:'Independent legacy proposal',bio:null,avatar:legacy};
  for(const draft of [{displayName:'Absent avatar'},{displayName:'Null avatar',avatar:null},{displayName:'Empty legacy avatar',avatar:{}},{displayName:'Original legacy parameters',avatar:{template:'circle',color:'#123456'}}] as JsonObject[]){
    const next={...row,version:row.version+1,data:{...row.data,draft}};
    assert.equal(await f.legacy.transaction(tx=>tx.update('profiles',next,row.version)),true);row=next;
    assert.deepEqual(await f.legacy.read(tx=>tx.get('profiles',row.id)),row,'v1 optional shape stays exact');
  }
  for(const look of looks){
    const next={...row,version:row.version+1,data:{...row.data,draft,published:{displayName:'Selected human',interests:[],avatar:appearance(look)}}};
    assert.equal(await f.legacy.transaction(tx=>tx.update('profiles',next,row.version)),true);row=next;
    assert.deepEqual(await f.legacy.read(tx=>tx.get('profiles',row.id)),row);
    assert.deepEqual(await f.appQuery('SELECT stage,content_schema_version,avatar_template,avatar_color,avatar_look_id,avatar_catalog_version FROM profiles.profile_contents WHERE parent_id=$1 ORDER BY stage',[row.id]),[
      {stage:'draft',content_schema_version:1,avatar_template:'basic',avatar_color:'blue',avatar_look_id:null,avatar_catalog_version:null},
      {stage:'published',content_schema_version:2,avatar_template:null,avatar_color:null,avatar_look_id:look,avatar_catalog_version:catalogVersion},
    ]);
  }
  const invalidAvatars:JsonValue[]=[
    {lookId:looks[0]!}, {catalogVersion}, appearance('unknown'), {...appearance(),catalogVersion:'2026-10-21.r3'},
    {...appearance(),template:'basic'}, {...appearance(),color:'blue'}, {...appearance(),assetVersion:'2026-10-21.r3'},
    {lookId:null,catalogVersion}, [], 'sunnyside-human-shorthair',
  ];
  for(const avatar of invalidAvatars){
    await assert.rejects(f.legacy.transaction(tx=>tx.update('profiles',{...row,version:row.version+1,data:{...row.data,published:{avatar}}},row.version)),code('invalid_usage'));
    assert.deepEqual(await f.legacy.read(tx=>tx.get('profiles',row.id)),row,'failed child validation must roll back the parent and both stages');
  }
  assert.equal(await f.legacy.transaction(tx=>tx.update('profiles',row,row.version-1)),false);
  const raw=await f.appQuery('SELECT content_text FROM profiles.profile_contents WHERE parent_id=$1 AND stage=$2',[row.id,'published']);
  for(const [set,values] of [
    ['avatar_look_id=$3',[looks[0]]],
    ['avatar_catalog_version=$3',['2026-10-21.r3']],
    ['content_schema_version=1',[]],
    ['content_schema_version=1,avatar_look_id=NULL,avatar_catalog_version=NULL',[]],
    ['avatar_template=$3',['basic']],
    ['content_text=$3',[JSON.stringify({displayName:'Selected human',interests:[],avatar:{...appearance(looks.at(-1)!),extra:true}})]],
    ['content_text=$3',[JSON.stringify({displayName:'Selected human',interests:[],avatar:{lookId:looks.at(-1)}})]],
  ] as [string,unknown[]][]){
    await assert.rejects(f.appQuery('UPDATE profiles.profile_contents SET '+set+' WHERE parent_id=$1 AND stage=$2',[row.id,'published',...values]),code('23514'));
  }
  assert.deepEqual(await f.appQuery('SELECT content_text FROM profiles.profile_contents WHERE parent_id=$1 AND stage=$2',[row.id,'published']),raw);
  // Name-only storage updates retain the explicit selection and an independent legacy proposal.
  const published={...(row.data.published as JsonObject),displayName:'Only the name changed'};
  assert.equal(await f.legacy.transaction(tx=>tx.update('profiles',{...row,version:row.version+1,data:{...row.data,published}},row.version)),true);
  const saved=(await f.legacy.read(tx=>tx.get('profiles',row.id)))!;
  assert.deepEqual((saved.data.published as JsonObject).avatar,appearance(looks.at(-1)!));assert.deepEqual(saved.data.draft,draft);
});

test('real legacy name-only service save preserves the avatar and replays its unchanged original payload receipt',async t=>{
  const f=await worldFixture();t.after(f.dispose);const agent=await f.register();
  const profile=(await f.legacy.read(tx=>tx.find('profiles',{agentId:agent.agentId})))[0]!;
  const legacy={template:'basic',color:'blue'},content={displayName:'Legacy name',bio:'Legacy bio',interests:[],avatar:legacy};
  await f.legacy.transaction(tx=>tx.update('profiles',{...profile,version:profile.version+1,data:{...profile.data,draft:content,published:content}},profile.version));
  const input={operationId:randomUUID(),agentId:agent.agentId,expectedVersion:profile.version+1,expectedPolicyVersion:profile.data.policyVersion,fields:{displayName:'Original legacy payload',avatar:legacy}};
  const first=await f.service.invoke('saveProfile',input,agent.runtimeToken);
  assert.deepEqual((first.published as JsonObject).avatar,legacy);assert.deepEqual((first.draft as JsonObject).avatar,legacy);
  const receipt=(await f.legacy.read(tx=>tx.find('operations',{scope:'agent:'+agent.agentId,operationId:input.operationId})))[0]!;
  const original=JSON.stringify(receipt),originalHash=receipt.data.payloadHash;
  const renamed=await f.service.invoke('saveProfile',{operationId:randomUUID(),agentId:agent.agentId,expectedVersion:first.version,expectedPolicyVersion:profile.data.policyVersion,fields:{displayName:'New name only'}},agent.runtimeToken);
  assert.deepEqual((renamed.published as JsonObject).avatar,legacy);assert.deepEqual((renamed.draft as JsonObject).avatar,legacy);
  assert.deepEqual(await f.service.invoke('saveProfile',input,agent.runtimeToken),first);
  assert.equal(JSON.stringify((await f.legacy.read(tx=>tx.get('operations',receipt.id)))!),original);
  assert.equal(receipt.data.payloadHash,originalHash);
  assert.deepEqual((await f.legacy.read(tx=>tx.get('profiles',profile.id)))!.data.published,renamed.published,'receipt replay must not restore the old name or rewrite the avatar');
});

test('legacy Avatar identity uses every formal same-client facade, preserves left IDs, and fails closed instead of returning false absence',async t=>{
  const f=await worldFixture();t.after(f.dispose);const agent=await f.register(),absent=await f.register();
  const input={agentId:agent.agentId,worldId:'default' as const};let ended:M1ReadSession|undefined;
  await f.runtime.transaction(async context=>{
    await bootstrapWorld(context);
    await context.repository(WORLD_REPOSITORY).saveAvatar({id:'original-avatar-fact',worldId:'default',agentId:agent.agentId,version:1,status:'left',position:{x:0,y:0},placeId:null,rulesetVersion:1,createdAt:context.now(),updatedAt:context.now()},null);
    // The identity is still uncommitted: a separate connection would not see it.
    assert.deepEqual(await readLegacyAvatarIdentity(runtimeIdentitySession(context),input),{avatarId:'original-avatar-fact'});
  });
  const before=await f.query('SELECT to_jsonb(a) AS avatar FROM world.avatars a ORDER BY id');
  await f.legacy.transaction(async session=>{ended=session;assert.deepEqual(await readLegacyAvatarIdentity(session,input),{avatarId:'original-avatar-fact'});});
  await assert.rejects(readLegacyAvatarIdentity(ended!,input),code('closed'));
  await f.legacy.read(async session=>{
    assert.deepEqual(await readLegacyAvatarIdentity(session,input),{avatarId:'original-avatar-fact'});
    assert.equal(await readLegacyAvatarIdentity(session,{...input,agentId:absent.agentId}),null);
    assert.equal('insert'in session,false);ended=session;
    await assert.rejects(readLegacyAvatarIdentity({...session},input),code('invalid_usage'));
    await assert.rejects(readLegacyAvatarIdentity(session,{...input,worldId:'other' as 'default'}),code('invalid_usage'));
  });
  await assert.rejects(readLegacyAvatarIdentity(ended!,input),code('closed'));
  await f.runtime.read(async context=>{ended=runtimeIdentitySession(context);assert.deepEqual(await readLegacyAvatarIdentity(ended,input),{avatarId:'original-avatar-fact'});});
  await assert.rejects(readLegacyAvatarIdentity(ended!,input),code('closed'));
  assert.deepEqual(await f.query('SELECT to_jsonb(a) AS avatar FROM world.avatars a ORDER BY id'),before,'identity resolution must not persist or normalize Avatar facts');
  await f.query('REVOKE SELECT ON world.avatars FROM connet_app');
  try{await assert.rejects(f.legacy.read(session=>readLegacyAvatarIdentity(session,input)),code('42501'));}
  finally{await f.query('GRANT SELECT ON world.avatars TO connet_app');}
});

test('append-only profiles v2 upgrades the frozen old schema without changing content bytes, receipts, versions or prior checksums',async()=>{
  const file=process.env.WORLD_CORE_TEST_RUNTIME;if(!file)throw new Error('Set WORLD_CORE_TEST_RUNTIME to the explicit private local PG runtime');
  const config=await readRuntime(file),directory=await mkdtemp(join(tmpdir(),'world-core-b-look-upgrade-')),database='world_core_b_look_'+randomBytes(8).toString('hex');
  const identity={instanceId:'instance_'+randomUUID(),recoveryEpoch:'epoch_'+randomUUID()};let connections:string|undefined,pool:Pool|undefined;
  try{
    connections=(await createWorldDatabase(config,database,join(directory,'connections'))).privateConnections;
    console.info(JSON.stringify({resource:'world_core_test_database',database,creator:'b',...identity,created:true,fixture:'frozen-profile-upgrade'}));
    const options={connectionString:(await requirePrivateFile(join(connections,'migration-database-url'))).trim(),...identity};
    pool=new Pool({connectionString:options.connectionString,max:1});
    const old=POSTGRES_MIGRATIONS.filter(item=>!(item.moduleId==='profiles'&&item.version===2));
    assert.equal(hash(old.map(item=>`${item.moduleId}:${hash(item.sql)}`).join('\n')),'d130a37cf5a1a0de1951c585b09c5c860b545e9e171fa01dadc3e25903888d38','every previously applied migration byte must remain fixed');
    const client=await pool.connect();
    const contentText='{ "displayName": "Old raw name", "bio": null, "avatar": { "template": "basic", "color": "blue" } }';
    const originalContent=JSON.parse(contentText) as JsonObject;
    const rows:readonly [Parameters<typeof resolveModel>[0],StoredRow][]=[
      ['agents',{id:'legacy-agent',version:5,data:{runtimeActive:true,runtimeVersion:1}}],
      ['profiles',{id:'legacy-profile',version:7,data:{agentId:'legacy-agent',mode:'agent_autonomous',policyVersion:2,publishedVersion:4,lockedFields:[],draft:originalContent,published:originalContent}}],
      ['operations',{id:'legacy-receipt',version:1,data:{scope:'agent:legacy-agent',action:'saveProfile',operationId:'original-operation',epoch:identity.recoveryEpoch,payloadHash:hash('original unmodified request'),result:{published:originalContent,version:7,publishedVersion:4}}}],
    ];
    try{
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA platform; CREATE TABLE platform.module_migrations(module_id text NOT NULL,migration_version integer NOT NULL,name text NOT NULL,checksum text NOT NULL,dependencies text[] NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(module_id,migration_version))');
      for(const item of old){await client.query(item.sql);await client.query('INSERT INTO platform.module_migrations(module_id,migration_version,name,checksum,dependencies) VALUES($1,$2,$3,$4,$5)',[item.moduleId,item.version,item.name,hash(item.sql),item.dependencies]);}
      await client.query('INSERT INTO platform.instance_state(singleton,instance_id,recovery_epoch) VALUES(1,$1,$2)',[identity.instanceId,identity.recoveryEpoch]);
      for(const [table,row]of rows){const model=resolveModel(table,row),encoded=encode(model,row);await client.query(`INSERT INTO ${model.table}(${encoded.columns.join(',')}) VALUES(${encoded.values.map((_,index)=>'$'+(index+1)).join(',')})`,encoded.values);}
      for(const stage of ['draft','published'])await client.query('INSERT INTO profiles.profile_contents(parent_id,stage,content_schema_version,display_name,avatar_template,avatar_color,content_text) VALUES($1,$2,1,$3,$4,$5,$6)',['legacy-profile',stage,'Old raw name','basic','blue',contentText]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    const snapshot=async()=>({
      history:(await pool!.query('SELECT * FROM platform.module_migrations ORDER BY module_id,migration_version')).rows,
      profiles:(await pool!.query('SELECT * FROM profiles.agent_profiles ORDER BY id')).rows,
      contents:(await pool!.query('SELECT parent_id,stage,ordinal,display_name,bio,interests,avatar_template,avatar_color,content_schema_version,content_text FROM profiles.profile_contents ORDER BY parent_id,stage')).rows,
      receipts:(await pool!.query('SELECT * FROM platform.operation_receipts ORDER BY id')).rows,
      identity:(await pool!.query('SELECT * FROM platform.instance_state')).rows,
    });
    const before=await snapshot();await assert.rejects(openPostgresStore(options),code('conflict'));
    await migratePostgres(options);await migratePostgres(options);const after=await snapshot();
    assert.deepEqual({...after,history:after.history.filter(row=>!(row.module_id==='profiles'&&row.migration_version===2))},before);
    assert.equal(after.history.length,before.history.length+1);
    assert.equal(hash(after.contents[0]!.content_text),hash(contentText));
    await grantWorldCorePermissions(config,database);
    const app=await openPostgresStore({...options,connectionString:(await requirePrivateFile(join(connections,'application-database-url'))).trim()});
    try{await app.read(async session=>{for(const [table,row]of rows)assert.deepEqual(await session.get(table,row.id),row);});}finally{await app.close();}
  }finally{
    await pool?.end();
    if(connections){await dropWorldTestDatabase(config,connections);console.info(JSON.stringify({resource:'world_core_test_database',database,creator:'b',closed:true,dropped:true}));}
    await rm(directory,{recursive:true,force:true});
  }
});
