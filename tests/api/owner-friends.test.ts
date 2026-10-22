import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {Pool} from 'pg';
import {createWorldDatabase,dropWorldTestDatabase} from '../../scripts/world-core-database.ts';
import {grantWorldCorePermissions} from '../../scripts/world-core-prepare.ts';
import {readRuntime,privateFile,requirePrivateFile} from '../../scripts/postgresql/runtime.ts';
import {prepareOwnerFriendsRead} from '../../scripts/owner-friends-prepare.ts';
import {openPostgresStore,createPostgresSession} from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {defaultPublicProfile} from '../../apps/platform/domains/profile/profile-rules.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import type {M1Store} from '../../apps/platform/contracts/store.ts';

test('confirmed friends are a pure Owner-authorized public-profile read; one isolated PG enforces canonical pairs and SELECT-only access',async()=>{
 const runtimeFile=process.env.WORLD_CORE_TEST_RUNTIME;if(!runtimeFile)throw new Error('An explicit isolated World PG test runtime is required');
 const config=await readRuntime(runtimeFile),directory=await mkdtemp(join(tmpdir(),'world-core-a-friends-')),database='world_core_a_friends_20261022_'+randomBytes(4).toString('hex'),identity={version:1,instanceId:'instance_'+randomUUID(),recoveryEpoch:'epoch_'+randomUUID()},stamp=Date.UTC(2026,9,22);
 let connections:string|undefined,ddl:Pool|undefined,application:Pool|undefined,store:M1Store|undefined;const app=Fastify();
 try{
  connections=(await createWorldDatabase(config,database,join(directory,'connections'),'a')).privateConnections;
  const connectionFile=join(connections,'migration-database-url'),identityFile=join(directory,'identity.json');await privateFile(identityFile,JSON.stringify(identity)+'\n');
  await prepareOwnerFriendsRead(connectionFile,identityFile,database);
  await grantWorldCorePermissions(config,database);
  // Run the final source-owned permission step AFTER generic grants, as deployment does.
  const prepared=await prepareOwnerFriendsRead(connectionFile,identityFile,database);assert.equal(prepared.write,false);
  const migrationConnectionString=(await requirePrivateFile(connectionFile)).trim(),connectionString=(await requirePrivateFile(join(connections,'application-database-url'))).trim();
  ddl=new Pool({connectionString:migrationConnectionString,max:1});application=new Pool({connectionString,max:1});
  const permissions=await application.query("SELECT has_table_privilege(current_user,'relationships.friendships','SELECT') AS read,has_table_privilege(current_user,'relationships.friendships','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,has_schema_privilege(current_user,'relationships','CREATE') AS create");assert.deepEqual(permissions.rows[0],{read:true,write:false,create:false});
  const ids=['agent-aaaa','agent-bbbb','agent-cccc','agent-dddd'],ownerA='owner-aaaa',ownerB='owner-bbbb',ownerC='owner-cccc',tokens=new Map<string,string>();
  const client=await ddl.connect();try{
   await client.query('BEGIN');const session=createPostgresSession(client,true,()=>true);
   for(const ownerId of [ownerA,ownerB,ownerC])await session.insert('owners',{id:ownerId,version:1,data:{status:'active',epoch:identity.recoveryEpoch,authVersion:1,username:'private-'+ownerId,email:'private-'+ownerId+'@example.test'}});
   for(const agentId of ids){const profile={...defaultPublicProfile(agentId),displayName:'Public '+agentId};await session.insert('agents',{id:agentId,version:1,data:{runtimeVersion:1,runtimeActive:true}});await session.insert('profiles',{id:agentId,version:1,data:{agentId,published:profile,draft:{...profile,bio:'private-draft'},publishedVersion:1}});await session.insert('memberships',{id:agentId,version:1,data:{agentId,worldId:'default',state:'joined',ownerPaused:false,platformRestricted:false}});}
   for(const [agentId,ownerId]of [[ids[0]!,ownerA],[ids[1]!,ownerB],[ids[2]!,ownerC],[ids[3]!,ownerA]] as const)await session.insert('bindings',{id:'binding-'+agentId,version:1,data:{agentId,ownerId,active:true}});
   for(const [subject,kind]of [[ownerA,'owner_session'],[ownerB,'owner_session'],[ownerC,'owner_session'],[ids[0]!,'runtime']] as const){const token=randomUUID()+'.'+randomBytes(32).toString('base64url'),parsed=parseToken(token);tokens.set(subject,token);await session.insert('credentials',{id:parsed.id,version:1,data:{kind,epoch:identity.recoveryEpoch,active:true,fingerprint:parsed.fingerprint,verifier:verifier(kind,parsed),expiresAt:stamp+60000,...(kind==='owner_session'?{ownerId:subject,ownerAuthVersion:1}:{agentId:subject,runtimeVersion:1})}});}
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  store=await openPostgresStore({connectionString,...identity});registerM1Routes(app,createM1Service(store,{now:()=>stamp}));
  const read=async(agentId:string,subject?:string)=>await app.inject({method:'GET',url:`/v1/owner/agents/${agentId}/friends`,...(subject?{headers:{authorization:'Bearer '+tokens.get(subject)}}:{})});
  const before=await ddl.query('SELECT write_generation,writes_enabled FROM platform.instance_state WHERE singleton=1');
  let response=await read(ids[0]!,ownerA);assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{agentId:ids[0],friends:[],complete:true,asOf:stamp});assert.equal(response.headers['cache-control'],'no-store');
  const confirmed=(id:string,firstAgentId:string,secondAgentId:string,status='confirmed')=>({id,version:1,data:{firstAgentId,secondAgentId,status,confirmedAt:stamp,firstConfirmationId:'confirmation-first-'+id,secondConfirmationId:'confirmation-second-'+id}});
  async function put(row:ReturnType<typeof confirmed>){const client=await ddl!.connect();try{await createPostgresSession(client,true,()=>true).insert('friendships',row);}finally{client.release();}}
  await put(confirmed('real-confirmed',ids[0]!,ids[1]!));await put(confirmed('revoked-relation',ids[0]!,ids[2]!,'revoked'));
  response=await read(ids[0]!,ownerA);assert.equal(response.statusCode,200);const data=response.json();assert.equal(data.friends.length,1);assert.equal(data.friends[0].agentId,ids[1]);assert.deepEqual(Object.keys(data.friends[0]).sort(),['agentId','confirmedAt','profile','relationshipId','status']);assert.deepEqual(Object.keys(data.friends[0].profile).sort(),['appearance','displayName','publishedVersion']);assert(!JSON.stringify(data).includes('private-'));assert(!JSON.stringify(data).includes('confirmation-first'));
  assert.equal((await read(ids[1]!,ownerB)).json().friends[0].agentId,ids[0],'The other endpoint sees its own side of the confirmed pair');
  assert.deepEqual((await read(ids[3]!,ownerA)).json().friends,[],'A sibling under the same Owner does not inherit friends');
  for(const [agentId,subject,expected]of [[ids[0]!,undefined,401],[ids[0]!,ids[0]!,403],[ids[0]!,ownerC,404],[ids[1]!,ownerA,404]]as const)assert.equal((await read(agentId,subject)).statusCode,expected);
  for(const failure of [confirmed('duplicate',ids[0]!,ids[1]!),confirmed('reversed',ids[1]!,ids[0]!),confirmed('self',ids[0]!,ids[0]!),confirmed('unconfirmed',ids[0]!,ids[3]!,'pending')])await assert.rejects(put(failure),error=>['23505','23514'].includes(String((error as {cause?:{code:string}}).cause?.code)));
  for(const statement of ['INSERT INTO relationships.friendships DEFAULT VALUES','UPDATE relationships.friendships SET status=\'revoked\'','DELETE FROM relationships.friendships','TRUNCATE relationships.friendships','CREATE TABLE relationships.not_allowed(id text)'])await assert.rejects(application.query(statement),error=>(error as {code:string}).code==='42501');
  // Reuse the exact public-profile authority: withdrawal, leaving and restrictions hide the peer.
  for(const patch of [{profile:{published:null}},{membership:{state:'left'}},{membership:{platformRestricted:true}}]){
   const client=await ddl.connect();try{const tx=createPostgresSession(client,true,()=>true),table=patch.profile?'profiles':'memberships',row=(await tx.get(table,ids[1]!))!;await tx.update(table,{...row,version:row.version+1,data:{...row.data,...patch.profile,...patch.membership}},row.version);}finally{client.release();}
   assert.deepEqual((await read(ids[0]!,ownerA)).json().friends,[]);
   const client2=await ddl.connect();try{const tx=createPostgresSession(client2,true,()=>true),profile=(await tx.get('profiles',ids[1]!))!,member=(await tx.get('memberships',ids[1]!))!;await tx.update('profiles',{...profile,version:profile.version+1,data:{...profile.data,published:{...defaultPublicProfile(ids[1]!),displayName:'Public '+ids[1]}}},profile.version);await tx.update('memberships',{...member,version:member.version+1,data:{...member.data,state:'joined',platformRestricted:false,ownerPaused:true}},member.version);}finally{client2.release();}
  }
  assert.equal((await read(ids[0]!,ownerA)).json().friends.length,1,'Owner pause retains existing public-profile semantics and supplies no online inference');
  await ddl.query("UPDATE iam.management_bindings SET active=false WHERE agent_id=$1",[ids[0]]);assert.equal((await read(ids[0]!,ownerA)).statusCode,404);
  assert.deepEqual((await ddl.query('SELECT write_generation,writes_enabled FROM platform.instance_state WHERE singleton=1')).rows,before.rows,'All HTTP reads leave the application write gate and generation untouched');
  assert.equal((await ddl.query('SELECT count(*)::integer AS count FROM relationships.friendships')).rows[0].count,2,'Reads never create or infer relationships');
  console.info(JSON.stringify({friends:{empty:true,confirmedOnly:true,ownerIsolation:true,bidirectional:true,publicVisibility:true,readOnly:true,canonicalPairConstraints:true,applicationWrites:false}}));
 }finally{await app.close();await store?.close();await application?.end();await ddl?.end();if(connections)await dropWorldTestDatabase(config,connections,'a');await rm(directory,{recursive:true,force:true});}
});
