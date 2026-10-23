import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {worldFixture} from './postgresql-fixture.ts';
import {defaultPublicProfile} from '../../apps/platform/domains/profile/profile-rules.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

test('IAM first world join uses the committed membership event, survives rejoin and leaves legacy unknown history unknown',async()=>{
 const f=await worldFixture();try{
  const current=await f.register(),joinedAt=f.now();
  const self=(token:string)=>f.service.invoke('self',{},token),member=(id:string)=>f.legacy.read(tx=>tx.get('memberships',id));
  assert.equal(((await self(current.runtimeToken)).identity as JsonObject).firstWorldJoinedAt,joinedAt);
  f.tick(86400000);
  await f.service.invoke('leave',{agentId:current.agentId,operationId:randomUUID(),expectedVersion:1},current.runtimeToken);
  await f.service.invoke('join',{agentId:current.agentId,operationId:randomUUID(),expectedVersion:2,expectedProfileVersion:1},current.runtimeToken);
  assert.equal((await member(current.agentId))!.data.firstJoinedAt,joinedAt);
  assert.equal(((await self(current.runtimeToken)).identity as JsonObject).ageDays,1);
  await assert.rejects(f.legacy.transaction(async tx=>{const row=(await tx.get('memberships',current.agentId))!;await tx.update('memberships',{...row,version:row.version+1,data:{...row.data,firstJoinedAt:f.now()}},row.version);}),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='constraint');
  for(const previous of ['not_joined','left'] as const){
   const id=randomUUID(),token=randomUUID()+'.'+randomBytes(32).toString('base64url'),parsed=parseToken(token,true),fields=defaultPublicProfile(id);
   await f.legacy.transaction(async tx=>{
    await tx.insert('agents',{id,version:1,data:{runtimeActive:true,runtimeVersion:1,createdAt:joinedAt-86400000}});
    await tx.insert('profiles',{id,version:1,data:{agentId:id,policyVersion:1,mode:'agent_autonomous',lockedFields:[],published:fields,draft:fields,publishedVersion:1}});
    await tx.insert('memberships',{id,version:1,data:{agentId:id,worldId:'default',state:previous,ownerPaused:false,platformRestricted:false,ownerPauseVersion:1,platformVersion:1,sharingGeneration:1}});
    await tx.insert('registrations',{id:randomUUID(),version:1,data:{agentId:id,ownerId:current.ownerId,managementStatus:'pending_setup'}});
    await tx.insert('credentials',{id:parsed.id,version:1,data:{kind:'runtime',fingerprint:parsed.fingerprint,verifier:verifier('runtime',parsed),active:true,epoch:f.identity.recoveryEpoch,expiresAt:null,agentId:id,ownerId:null,runtimeVersion:1}});
   });
   const operationId=randomUUID(),input={agentId:id,operationId,expectedVersion:1,expectedProfileVersion:1};
   await f.service.invoke('join',input,token);assert.deepEqual(await f.service.invoke('join',input,token),await f.service.invoke('receipt',{operationId,scope:'agent:'+id,action:'join'},token));
   assert.equal((await member(id))!.data.firstJoinedAt??null,previous==='not_joined'?f.now():null,'A rejoin cannot stand in for an unknown original join');
   assert.equal(((await self(token)).identity as JsonObject).firstWorldJoinedAt,previous==='not_joined'?f.now():null);
  }
  console.info(JSON.stringify({database:f.database,iam:7,firstJoinAtomic:true,rejoinPreserved:true,legacyUnknownPreserved:true,noBackfill:true}));
 }finally{await f.dispose();}
});
