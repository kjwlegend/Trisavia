import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {postgresFixture} from './postgresql-fixture.ts';
import {PUBLIC_IDENTIFIERS_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/public-identifiers-migration.ts';

const token=()=>randomUUID()+'.'+randomBytes(32).toString('base64url'),op=()=>randomUUID();
await test('Owner invitations bind only one self-authenticated Agent and GET never consumes',async t=>{
 const pg=await postgresFixture();t.after(()=>pg.dispose());
 await pg.sql(PUBLIC_IDENTIFIERS_PERMISSIONS_SQL);
 let now=1000000;
 const service=createM1Service(pg.store,{now:()=>now,email:{mode:'experience'},inviteTtlMs:1000});
 const app=Fastify({logger:false});registerM1Routes(app,service);t.after(()=>app.close());
 const request=async(method:'GET'|'POST',url:string,payload?:Record<string,unknown>,bearer?:string)=>{
  const response=await app.inject({method,url,...(payload?{payload}:{}),...(bearer?{headers:{authorization:'Bearer '+bearer}}:{})});
  return {status:response.statusCode,body:response.json(),text:response.body};
 };
 const owner=async()=>{
  const attemptId=op(),browserToken=token(),sessionToken=token();
  await service.invoke('startRegistration',{operationId:op(),attemptId,browserToken,username:'User_'+op().slice(0,8),email:op()+'@example.test'});
  const sendOperationId=op();
  await service.invoke('sendRegistrationCode',{operationId:sendOperationId,attemptId},browserToken);
  await service.invoke('verifyRegistrationEmail',{operationId:op(),attemptId,sendOperationId,code:'1234'},browserToken);
  const result=await service.invoke('registerOwner',{operationId:op(),attemptId,password:'synthetic long test password',sessionToken},browserToken);
  return {sessionToken,ownerId:result.ownerId,ownerPublicId:result.ownerPublicId};
 };
 const register=async(inviteToken?:string)=>{
  const input={operationId:op(),attemptId:op(),runtimeToken:token(),continuationToken:token(),...(inviteToken?{inviteToken}:{})};
  const result=await request('POST','/v1/registrations',input);assert.equal(result.status,200);
  return {input,...result.body};
 };
 const issue=async(sessionToken:string)=>{
  const inviteToken=token(),input={operationId:op(),inviteToken};
  const response=await request('POST','/v1/owner/agent-invites',input,sessionToken);assert.equal(response.status,200);
  assert.equal(response.body.state,'active');assert.equal(response.body.limit,1);assert.equal(response.text.includes(inviteToken),false);
  assert.deepEqual(await request('POST','/v1/owner/agent-invites',input,sessionToken),response);
  return {inviteToken,...response.body};
 };
 const first=await owner(),second=await owner();
 await t.test('new registration is one atomic binding; preview reveals no Owner and performs no write',async()=>{
  const grant=await issue(first.sessionToken);
  const before=(await pg.sql('SELECT write_generation FROM platform.instance_state WHERE singleton=1'))[0].write_generation;
  const preview=await request('GET','/v1/agent-invites/preview',undefined,grant.inviteToken);
  assert.equal(preview.status,200);assert.equal(preview.body.state,'active');
  for(const field of ['ownerId','ownerPublicId','username','email','agentId'])assert.equal(field in preview.body,false);
  assert.deepEqual(await request('GET','/v1/agent-invites/preview',undefined,grant.inviteToken),preview);
  assert.equal((await pg.sql('SELECT write_generation FROM platform.instance_state WHERE singleton=1'))[0].write_generation,before);
  const registered=await register(grant.inviteToken);
  assert.equal(registered.ownerId,first.ownerId);assert.equal(registered.managementStatus,'managed');
  assert.deepEqual((await request('POST','/v1/registrations',registered.input)).body,Object.fromEntries(Object.entries(registered).filter(([k])=>k!=='input')));
  const other=await request('POST','/v1/registrations',{operationId:op(),attemptId:op(),runtimeToken:token(),continuationToken:token(),inviteToken:grant.inviteToken});
  assert.equal(other.status,409);assert.equal(other.body.error.code,'invite_consumed');
  const after=await request('GET','/v1/agent-invites/preview',undefined,grant.inviteToken);assert.equal(after.body.state,'consumed');
  const revoked=await request('POST','/v1/owner/agent-invites/'+grant.inviteId+'/revoke',{operationId:op(),expectedVersion:after.body.version},first.sessionToken);
  assert.equal(revoked.status,200);assert.equal(revoked.body.state,'consumed');
  assert.equal((await service.invoke('managedAgent',{agentId:registered.agentId},first.sessionToken)).agentId,registered.agentId);
 });
 await t.test('existing identity keeps settings and receipts; late initial proofs cannot bind elsewhere',async()=>{
  const a=await register(),grant=await issue(first.sessionToken),handoffToken=token(),setupToken=token();
  const handoff=await service.invoke('issueHandoff',{operationId:op(),expectedGeneration:0,handoffToken},a.input.continuationToken);
  await service.invoke('exchangeSetup',{operationId:op(),setupToken},handoffToken);
  await service.invoke('saveWorldAccess',{agentId:a.agentId,operationId:op(),expectedVersion:1,intervalSeconds:900},a.input.runtimeToken);
  const input={operationId:op(),inviteToken:grant.inviteToken};
  const linked=await request('POST','/v1/agent/invitations/consume',input,a.input.runtimeToken);
  assert.equal(linked.status,200);assert.equal(linked.body.agentId,a.agentId);assert.equal(linked.body.ownerId,first.ownerId);assert.equal(linked.body.changed,true);
  assert.deepEqual(await request('POST','/v1/agent/invitations/consume',input,a.input.runtimeToken),linked);
  const receipt=await request('GET','/v1/operations/'+input.operationId+'?scope='+encodeURIComponent('agent:'+a.agentId)+'&action=consumeInvite',undefined,a.input.runtimeToken);
  assert.deepEqual(receipt.body,linked.body);
  const self=await service.invoke('self',{},a.input.runtimeToken);assert.equal((self.worldAccess as any).intervalSeconds,900);assert.equal((self.management as any).managementStatus,'managed');
  const ownerView=await service.invoke('managedAgent',{agentId:a.agentId},first.sessionToken);assert.deepEqual(ownerView.management,{managementStatus:'managed'});
  const late=await request('POST','/v1/owner/agent-claims',{operationId:op(),agentId:a.agentId,expectedGeneration:handoff.generation,setupToken},second.sessionToken);assert.equal(late.status,401);
  const more=await issue(first.sessionToken),same=await request('POST','/v1/agent/invitations/consume',{operationId:op(),inviteToken:more.inviteToken},a.input.runtimeToken);
  assert.equal(same.status,200);assert.equal(same.body.changed,false);
  assert.equal((await pg.sql('SELECT count(*)::int AS n FROM iam.management_bindings WHERE agent_id=$1 AND active',[a.agentId]))[0].n,1);
 });
 await t.test('expired/revoked grants and foreign ownership reject without consumption or secret disclosure',async()=>{
  const a=await register(),grant=await issue(second.sessionToken);
  const rejected=await request('POST','/v1/agent/invitations/consume',{operationId:op(),inviteToken:grant.inviteToken},first.sessionToken);
  assert.equal(rejected.status,403);assert.equal(rejected.text.includes(grant.inviteToken),false);
  const linked=await request('POST','/v1/agent/invitations/consume',{operationId:op(),inviteToken:grant.inviteToken},a.input.runtimeToken);assert.equal(linked.status,200);
  const foreign=await issue(first.sessionToken),input={operationId:op(),inviteToken:foreign.inviteToken};
  const denied=await request('POST','/v1/agent/invitations/consume',input,a.input.runtimeToken);assert.equal(denied.status,409);assert.equal(denied.body.error.code,'agent_already_managed');assert.equal(denied.text.includes(String(second.ownerId)),false);
  assert.equal((await request('GET','/v1/agent-invites/preview',undefined,foreign.inviteToken)).body.state,'active');
  const revoked=await request('POST','/v1/owner/agent-invites/'+foreign.inviteId+'/revoke',{operationId:op(),expectedVersion:foreign.version},first.sessionToken);assert.equal(revoked.status,200);assert.equal(revoked.body.state,'revoked');
  assert.equal((await request('GET','/v1/agent-invites/preview',undefined,foreign.inviteToken)).body.state,'revoked');
  assert.equal((await request('POST','/v1/agent/invitations/consume',{operationId:op(),inviteToken:foreign.inviteToken},a.input.runtimeToken)).body.error.code,'invite_revoked');
  const expires=await issue(first.sessionToken);now+=1001;
  assert.equal((await request('GET','/v1/agent-invites/preview',undefined,expires.inviteToken)).body.state,'expired');
  assert.equal((await request('POST','/v1/registrations',{operationId:op(),attemptId:op(),runtimeToken:token(),continuationToken:token(),inviteToken:expires.inviteToken})).body.error.code,'invite_expired');
 });
 await t.test('two existing Agents race for one link and only one can associate',async()=>{
  const [a,b]=await Promise.all([register(),register()]),grant=await issue(first.sessionToken);
  const results=await Promise.all([a,b].map(x=>request('POST','/v1/agent/invitations/consume',{operationId:op(),inviteToken:grant.inviteToken},x.input.runtimeToken)));
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  assert.equal(results.find(x=>x.status===409)!.body.error.code,'invite_consumed');
  const rows=await pg.sql('SELECT count(*)::int AS n FROM iam.management_bindings WHERE active AND agent_id=ANY($1::text[])',[[a.agentId,b.agentId]]);assert.equal(rows[0].n,1);
 });
 await t.test('short display identifiers are stable and preserve current public/Owner visibility',async()=>{
  const a=await register();assert.match(a.publicId,/^A[0-9]{3,}$/);assert.equal(a.ownerPublicId,null);assert.equal(a.profileUrl,'/residents/'+a.publicId);
  assert.match(String(first.ownerPublicId),/^H[0-9]{3,}$/);
  const account=await service.invoke('readAccount',{},first.sessionToken);assert.equal(account.publicId,first.ownerPublicId);
  const before=await pg.sql('SELECT last_value FROM public_identifiers.agent_number UNION ALL SELECT last_value FROM public_identifiers.owner_number');
  const self=await service.invoke('self',{},a.input.runtimeToken);assert.equal(self.publicId,a.publicId);assert.equal(self.ownerPublicId,null);
  const publicRead=await request('GET','/v1/public/agents/'+a.publicId);assert.equal(publicRead.status,200);assert.equal(publicRead.body.agentId,a.agentId);assert.equal(publicRead.body.publicId,a.publicId);assert.equal('ownerPublicId' in publicRead.body,false);
  assert.deepEqual((await request('GET','/v1/public/agents/'+a.agentId)).body,publicRead.body);
  assert.deepEqual(await pg.sql('SELECT last_value FROM public_identifiers.agent_number UNION ALL SELECT last_value FROM public_identifiers.owner_number'),before,'reads cannot allocate new display identifiers');
  assert.equal((await request('GET','/v1/agent/self',undefined,String(first.ownerPublicId))).status,401,'H display ID is not a credential');
  const grant=await issue(first.sessionToken),linked=await request('POST','/v1/agent/invitations/consume',{operationId:op(),inviteToken:grant.inviteToken},a.input.runtimeToken);
  assert.equal(linked.body.publicId,a.publicId);assert.equal(linked.body.ownerPublicId,first.ownerPublicId);
  const own=await service.invoke('managedAgent',{agentId:a.agentId},first.sessionToken);assert.equal(own.publicId,a.publicId);assert.equal(own.ownerPublicId,first.ownerPublicId);
  const profile=await service.invoke('readProfile',{agentId:a.agentId},a.input.runtimeToken);
  await service.invoke('unpublishProfile',{operationId:op(),agentId:a.agentId,expectedVersion:profile.version,expectedPolicyVersion:profile.policyVersion},a.input.runtimeToken);
  const hidden=await request('GET','/v1/public/agents/'+a.publicId),absent=await request('GET','/v1/public/agents/A9999999');assert.equal(hidden.status,404);assert.deepEqual(hidden.body,absent.body);
  assert.equal((await service.invoke('self',{},a.input.runtimeToken)).publicId,a.publicId);
 });
});
