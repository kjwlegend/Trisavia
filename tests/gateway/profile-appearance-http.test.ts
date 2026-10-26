import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildApp} from '../../apps/platform/app.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import type {TrustedMailboxSource} from '../../apps/platform/application/mailbox-service.ts';
import {readLegacyAvatarIdentity} from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {APPEARANCE_CATALOG_VERSION} from '../../apps/platform/domains/profile/appearance-catalog.ts';
import {resolveAppearance} from '../../apps/platform/domains/profile/appearance.ts';
import {meteredRead} from '../../apps/platform/domains/perception/read-budget.ts';
import {ensurePublicId} from '../../apps/platform/domains/public-identifiers/repository.ts';
import type {M1Transaction} from '../../apps/platform/contracts/store.ts';
import {gatewayFixture} from './postgresql-fixture.ts';
import {ownerFixture,type Api} from '../../scripts/agent-manager-qa-fixture.ts';
const selected=(hair:string)=>({lookId:`sunnyside-human-${hair}`,catalogVersion:APPEARANCE_CATALOG_VERSION});
const gatewayBody=(operation:string,input:unknown)=>({protocolVersion:1,consumerId:'appearance-author-http',purpose:'agent-manual',operation,input,...(operation==='world.avatar.create'?{commandId:randomUUID()}:{})});

test('real HTTP saves a selected person without a World Avatar and updates public appearance without moving the existing Avatar',async()=>{
 const recipients=new Set<string>(),source:TrustedMailboxSource={sourceId:'isolated-look-authenticated-upstream',async authenticate(tx,context,authenticate){const actor=await authenticate(tx,(context as {token:string}).token,['runtime']);return {kind:'agent',ref:{moduleId:'profiles',type:'profiles.agent@1',id:String(actor.data.agentId)}};},async authorizeRecipient(_tx,_actor,id){return recipients.has(id);}};
 const f=await gatewayFixture({interaction:false}),app=await buildApp({...f.options,worldCoreEnabled:true,email:{mode:'experience'},perception:{mailboxSources:[source]}});
 const call=async(method:'GET'|'PUT'|'POST',url:string,payload?:unknown,token?:string)=>{const result=await app.inject({method,url,headers:{...(payload===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},...(payload===undefined?{}:{payload:JSON.stringify(payload)})});return {status:result.statusCode,body:result.json()};};
 try{
  const runtimeToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),continuationToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),registered=await call('POST','/v1/registrations',{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken});assert.equal(registered.status,200);
  const actor={agentId:registered.body.agentId,runtimeToken,continuationToken},other=await f.register(),profile=await call('GET',`/v1/agents/${actor.agentId}/profile`,undefined,actor.runtimeToken);
  assert.deepEqual(profile.body.published.avatar,selected('shorthair'));assert.deepEqual(profile.body.publishedAppearance,selected('shorthair'));
  recipients.add(other.agentId);await createM1Service(f.legacy,{perception:{mailboxSources:[source]}}).receiveTrustedMessage(source.sourceId,{sourceMessageKey:'new-default-appearance-sender',recipientAgentId:other.agentId,title:'Trusted synthetic source',body:'Only a verified upstream can receive this synthetic message.'},{token:actor.runtimeToken});
  const sender=async()=>{const page=await call('POST','/v1/perception/list',{protocolVersion:1,consumerId:'appearance-mailbox-sender',purpose:'agent-inspect',channel:'inbox',categoryId:'messages'},other.runtimeToken);assert.equal(page.status,200);return page.body.data.records[0].summary.sender;};
  assert.equal((await sender()).displayName,profile.body.published.displayName,'A newly registered default pair is a valid current published sender');
  const input={operationId:randomUUID(),expectedVersion:profile.body.version,expectedPolicyVersion:profile.body.policyVersion,fields:{avatar:selected('longhair')}};
  const saved=await call('PUT',`/v1/agents/${actor.agentId}/profile`,input,actor.runtimeToken);assert.equal(saved.status,200);assert.deepEqual(saved.body.published.avatar,selected('longhair'));assert.equal(saved.body.publishedVersion,2);assert(!Object.hasOwn(saved.body,'publishedAppearance'),'Read-only fields do not alter write receipts');
  assert.deepEqual((await call('PUT',`/v1/agents/${actor.agentId}/profile`,input,actor.runtimeToken)).body,saved.body);
  assert.equal((await call('PUT',`/v1/agents/${actor.agentId}/profile`,{...input,fields:{avatar:selected('mophair')}},actor.runtimeToken)).status,409);
  assert.equal((await call('GET',`/v1/agents/${actor.agentId}/profile`,undefined,other.runtimeToken)).status,404);
  assert.equal((await call('GET','/v1/world/scene?worldId=default')).body.data.avatars.length,0,'Saving a look never creates a World Avatar');
  const rules=await call('POST','/v1/gateway/query',gatewayBody('world.rules',{worldId:'default'}),actor.runtimeToken);
  const created=await call('POST','/v1/gateway/commands',gatewayBody('world.avatar.create',{worldId:'default',expectedRulesetVersion:rules.body.data.rules.version}),actor.runtimeToken);assert.equal(created.status,200);
  const before=(await call('GET','/v1/world/scene?worldId=default')).body.data;
  const current=(await call('GET',`/v1/agents/${actor.agentId}/profile`,undefined,actor.runtimeToken)).body;
  const update=await call('PUT',`/v1/agents/${actor.agentId}/profile`,{operationId:randomUUID(),expectedVersion:current.version,expectedPolicyVersion:current.policyVersion,fields:{avatar:selected('spikeyhair')}},actor.runtimeToken);assert.equal(update.status,200);
  const after=(await call('GET','/v1/world/scene?worldId=default')).body.data;assert.equal(after.worldRevision,before.worldRevision);assert.equal(after.avatars[0].id,before.avatars[0].id);assert.equal(after.avatars[0].version,before.avatars[0].version);assert.deepEqual(after.avatars[0].position,before.avatars[0].position);assert.deepEqual(after.avatars[0].profile.appearance,selected('spikeyhair'));assert.equal(after.avatars[0].profile.publishedVersion,current.publishedVersion+1);
  const publicProfile=(await call('GET',`/v1/public/agents/${actor.agentId}`)).body;assert.deepEqual(publicProfile.profile.avatar,selected('spikeyhair'));assert.deepEqual(publicProfile.appearance,selected('spikeyhair'));assert.equal(publicProfile.publishedVersion,current.publishedVersion+1);assert(!JSON.stringify(publicProfile).includes('draft'));
  assert.equal((await sender()).displayName,publicProfile.profile.displayName,'Saving a selected look retains current trusted sender disclosure');
  const catalog=(await call('GET','/v1/avatar-catalog')).body;assert.equal(catalog.version,2);assert.equal(catalog.looks.length,6);for(const path of catalog.looks[0].preview.layers)assert.equal((await app.inject({method:'GET',url:path})).statusCode,200);
  const discovery=(await call('GET','/v1/gateway/discovery')).body.data;for(const id of ['world.scene','world.public_scene'])assert.equal(discovery.operations.find((operation:{id:string})=>operation.id===id).outputSchema.version,2);
  assert.equal((await call('GET','/v1/gateway/guides/world?version=2')).status,200);assert.equal((await call('GET','/v1/gateway/guides/world?version=1')).status,404);
  const api:Api=(method,path,body,bearer)=>call(method,'/v1'+path,body,bearer);let stage=0;const owner=await ownerFixture(api,'Look',async value=>{await f.savePrivate(`look-owner-${++stage}.json`,value);});
  const handoffToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),handoff=await call('POST','/v1/agent/self/handoffs',{operationId:randomUUID(),expectedGeneration:0,handoffToken},actor.continuationToken);assert.equal(handoff.status,200);
  assert.equal((await call('POST','/v1/owner/agent-claims',{operationId:randomUUID(),agentId:actor.agentId,expectedGeneration:handoff.body.generation,handoffToken},owner.sessionToken)).status,200);
  const active=(await call('GET',`/v1/agents/${actor.agentId}/profile`,undefined,owner.sessionToken)).body;
  const proposed=await call('PUT',`/v1/agents/${actor.agentId}/profile/draft`,{operationId:randomUUID(),expectedVersion:active.version,expectedPolicyVersion:active.policyVersion,fields:{avatar:selected('curlyhair'),bio:'Independent Agent proposal, not Owner-approved'}},actor.runtimeToken);assert.equal(proposed.status,200);
  const withdrawn=await call('POST',`/v1/agents/${actor.agentId}/profile/unpublish`,{operationId:randomUUID(),expectedVersion:proposed.body.version,expectedPolicyVersion:proposed.body.policyVersion},owner.sessionToken);assert.equal(withdrawn.status,200);assert.equal(withdrawn.body.published,null);
  assert.deepEqual(await sender(),{kind:'agent',ref:null,displayName:null},'A valid new pair never bypasses current publication withdrawal');
  const unchanged=await f.legacy.read(async tx=>({profile:await tx.get('profiles',actor.agentId),operations:await tx.count('operations',{},10000),facts:await tx.count('facts',{},10000)}));
  const nameOnly=await call('PUT',`/v1/agents/${actor.agentId}/profile`,{operationId:randomUUID(),expectedVersion:withdrawn.body.version,expectedPolicyVersion:withdrawn.body.policyVersion,fields:{displayName:'Owner explicit name'}},owner.sessionToken);assert.equal(nameOnly.status,422);assert.equal(nameOnly.body.error.code,'profile_validation_failed');assert.equal(nameOnly.body.error.details.field,'avatar');
  assert.deepEqual(await f.legacy.read(async tx=>({profile:await tx.get('profiles',actor.agentId),operations:await tx.count('operations',{},10000),facts:await tx.count('facts',{},10000)})),unchanged,'Unpublished name-only rejection is atomic and never adopts the proposal or a default');
  const restored=await call('PUT',`/v1/agents/${actor.agentId}/profile`,{operationId:randomUUID(),expectedVersion:withdrawn.body.version,expectedPolicyVersion:withdrawn.body.policyVersion,fields:{displayName:'Owner explicit name',avatar:selected('bowlhair')}},owner.sessionToken);assert.equal(restored.status,200);assert.equal(restored.body.saveEffect,'public');assert.deepEqual(restored.body.published.avatar,selected('bowlhair'));assert.equal(restored.body.published.bio,undefined);assert.equal(restored.body.draft.bio,'Independent Agent proposal, not Owner-approved');
  assert.equal((await sender()).displayName,'Owner explicit name');
  await f.legacy.transaction(async tx=>{const member=(await tx.get('memberships',actor.agentId))!;await tx.update('memberships',{...member,version:member.version+1,data:{...member.data,platformRestricted:true}},member.version);});
  assert.deepEqual(await sender(),{kind:'agent',ref:null,displayName:null},'The new saved pair does not bypass current platform restrictions');
 }finally{await app.close();await f.dispose();}
});

test('legacy actual Avatar identity resolves consistently through real public/profile/Perception readers without rewriting its old input or receipt',async()=>{
 const baseline=process.env.PROFILE_APPEARANCE_BASELINE_SOURCE;if(!baseline)throw new Error('An explicit frozen ad5 application source is required');
 const {createM1Service:oldService}=await import(pathToFileURL(join(baseline,'apps/platform/application/m1-service.ts')).href);
 const f=await gatewayFixture({interaction:false}),app=await buildApp({...f.options,worldCoreEnabled:true});
 const resource=JSON.parse(await readFile(join(f.privateConnections,'created-database.json'),'utf8'));console.info(JSON.stringify({resource:'legacy_appearance_metering',database:f.database,oid:resource.oid,creator:resource.creator,created:true}));
 const invoke=async(method:'GET'|'PUT'|'POST',url:string,payload?:unknown,token?:string)=>{const response=await app.inject({method,url,headers:{...(payload===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},...(payload===undefined?{}:{payload:JSON.stringify(payload)})});return {status:response.statusCode,body:response.json()};};
 try{
  const runtimeToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),continuationToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),legacyService=oldService(f.legacy,{now:f.now});
  const registration=await legacyService.invoke('register',{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken}),agentId=registration.agentId;
  // This historical registration predates public IDs; prepare only its new isolated subject, without rewriting its old profile/receipt.
  await f.legacy.transaction(async tx=>{const id=await ensurePublicId(tx,'agent',String(agentId));assert.equal(await ensurePublicId(tx,'agent',String(agentId)),id);});
  const raw={template:'basic',color:'olive'},initial=(await invoke('GET',`/v1/agents/${agentId}/profile`,undefined,runtimeToken)).body;assert.deepEqual(initial.published.avatar,raw);assert.deepEqual(initial.publishedAppearance,raw,'No actual Avatar fact means explicitly unresolved');
  const oldInput={operationId:randomUUID(),agentId,expectedVersion:initial.version,expectedPolicyVersion:initial.policyVersion,fields:{avatar:{template:'basic',color:'cream'}}};const receipt=await legacyService.invoke('saveProfile',oldInput,runtimeToken);
  const newService=createM1Service(f.legacy,{now:f.now,legacyAvatarIdentity:readLegacyAvatarIdentity});assert.deepEqual(await newService.invoke('saveProfile',oldInput,runtimeToken),receipt);
  const renamed=await invoke('PUT',`/v1/agents/${agentId}/profile`,{operationId:randomUUID(),expectedVersion:receipt.version,expectedPolicyVersion:receipt.policyVersion,fields:{displayName:'Explicit name with retained legacy selection'}},runtimeToken);assert.equal(renamed.status,200);assert.deepEqual(renamed.body.published.avatar,{template:'basic',color:'cream'});assert.deepEqual(await newService.invoke('saveProfile',oldInput,runtimeToken),receipt,'A later name-only save cannot rewrite the original operation result');
  const rules=(await invoke('POST','/v1/gateway/query',gatewayBody('world.rules',{worldId:'default'}),runtimeToken)).body.data.rules;
  const created=await invoke('POST','/v1/gateway/commands',gatewayBody('world.avatar.create',{worldId:'default',expectedRulesetVersion:rules.version}),runtimeToken);const actualId=created.body.data.result.avatarId;
  const expected=resolveAppearance({template:'basic',color:'cream'},{avatarId:actualId}),profile=(await invoke('GET',`/v1/agents/${agentId}/profile`,undefined,runtimeToken)).body;
  assert.deepEqual(profile.published.avatar,{template:'basic',color:'cream'});assert.deepEqual(profile.publishedAppearance,expected);assert.deepEqual((await invoke('GET',`/v1/public/agents/${agentId}`)).body.appearance,expected);assert.deepEqual((await invoke('GET','/v1/world/scene?worldId=default')).body.data.avatars[0].profile.appearance,expected);
  const list=await invoke('POST','/v1/perception/list',{protocolVersion:1,consumerId:'appearance-legacy-source',purpose:'agent-inspect',channel:'world',categoryId:'people',metricId:'agents'},runtimeToken);assert.equal(list.status,200);assert.deepEqual(list.body.data.records[0].summary.fields.appearance,expected);assert.deepEqual(list.body.data.records[0].summary.fields.avatar,{template:'basic',color:'cream'});
  const ref={moduleId:'profiles',type:'profiles.agent@1',id:agentId},before=await f.legacy.read(async tx=>({sessions:await tx.count('perception_sessions',{},10000),facts:await tx.count('perception_access',{},10000)}));
  const denied=await invoke('POST','/v1/perception/detail',{protocolVersion:1,consumerId:'appearance-budget',purpose:'agent-inspect',channel:'world',ref,budget:{maxScannedRows:2}},runtimeToken);assert.equal(denied.status,422);assert.equal(denied.body.error.code,'budget_too_small');assert.deepEqual(await f.legacy.read(async tx=>({sessions:await tx.count('perception_sessions',{},10000),facts:await tx.count('perception_access',{},10000)})),before);
  const detail=await invoke('POST','/v1/perception/detail',{protocolVersion:1,consumerId:'appearance-budget',purpose:'agent-inspect',channel:'world',ref,budget:{maxScannedRows:3}},runtimeToken);assert.equal(detail.status,200);assert.deepEqual(detail.body.data.content.fields.appearance,expected);
  let endedSession:M1Transaction|undefined;await f.legacy.transaction(async tx=>{endedSession=tx;});const endedMeter=meteredRead(endedSession!,{maxScannedRows:2,deadlineMs:250});await assert.rejects(endedMeter.readAuxiliary('ended-legacy-source',()=>readLegacyAvatarIdentity(endedSession!,{agentId,worldId:'default'})),error=>(error as {code:string}).code==='closed');
 }finally{await app.close();await f.dispose();console.info(JSON.stringify({resource:'legacy_appearance_metering',database:f.database,oid:resource.oid,creator:resource.creator,dropped:true}));}
});
