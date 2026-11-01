import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {worldFixture} from './postgresql-fixture.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import {defaultPublicProfile} from '../../apps/platform/domains/profile/profile-rules.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {bootstrapInteraction,createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {createDeterministicScheduler} from '../../apps/platform/infrastructure/scheduling/deterministic-scheduler.ts';
import {WORLD_REPOSITORY} from '../../apps/platform/domains/world/repository.ts';
import {POSTGRES_SCHEMA_SIGNATURE} from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import type {JsonObject,M1Transaction} from '../../apps/platform/contracts/store.ts';

test('isolated manual scheduling keeps frequency and old finite movement, permits normal runtime writes, and never lifts real restrictions',async t=>{
 const f=await worldFixture({bootstrap:false});t.after(f.dispose);
 const manifest=JSON.parse(await readFile(join(f.privateConnections,'created-database.json'),'utf8'));
 console.info(JSON.stringify({purpose:'manual-participation',database:f.database,oid:manifest.oid,role:'connet_app',schemaSignature:POSTGRES_SCHEMA_SIGNATURE}));
 const agentId='manual-fixture-agent',legacyId='observe-fixture-agent',ownerId='manual-fixture-owner',at=f.now()-1000;
 let runtime='',owner='',legacyRuntime='';
 async function credential(tx:M1Transaction,kind:'runtime'|'owner_session',subject:string){
  const raw=randomUUID()+'.'+randomBytes(32).toString('base64url'),p=parseToken(raw,true);
  await tx.insert('credentials',{id:p.id,version:1,data:{kind,fingerprint:p.fingerprint,verifier:verifier(kind,p),active:true,epoch:f.identity.recoveryEpoch,expiresAt:null,agentId:kind==='runtime'?subject:null,ownerId:kind==='owner_session'?subject:null,...(kind==='runtime'?{runtimeVersion:1}:{ownerAuthVersion:1})}});return raw;
 }
 await f.legacy.transaction(async tx=>{
  await tx.insert('owners',{id:ownerId,version:1,data:{status:'active',epoch:f.identity.recoveryEpoch,authVersion:1}});
  for(const id of [agentId,legacyId]){
   await tx.insert('agents',{id,version:1,data:{runtimeVersion:1,runtimeActive:true,worldActionPolicy:{version:3,mode:id===agentId?'autonomous':'observe',updatedAt:at},worldAccess:{version:2,intervalSeconds:3600,adoption:{appliedVersion:2,jobState:'scheduled',reportedAt:at}}}});
   await tx.insert('memberships',{id,version:1,data:{agentId:id,worldId:'default',state:'joined',ownerPaused:false,ownerPauseVersion:1,platformRestricted:false,platformVersion:1,sharingGeneration:1}});
   await tx.insert('profiles',{id,version:1,data:{agentId:id,policyVersion:1,mode:'agent_autonomous',lockedFields:[],draft:defaultPublicProfile(id),published:defaultPublicProfile(id),publishedVersion:1}});
  }
  await tx.insert('bindings',{id:'manual-fixture-binding',version:1,data:{agentId,ownerId,active:true}});
  runtime=await credential(tx,'runtime',agentId);legacyRuntime=await credential(tx,'runtime',legacyId);owner=await credential(tx,'owner_session',ownerId);
 });
 await f.runtime.transaction(async ctx=>{await bootstrapWorld(ctx);await bootstrapInteraction(ctx);});
 const world=createWorldService(f.access),interaction=createInteractionService(f.access,{async ensure(){return {decisionId:'unused',version:1};},async cancel(){}});
 const act=(action:string,input:JsonObject,token=runtime,id=agentId)=>f.runtime.transaction(async ctx=>world.execute(ctx,await f.access.authenticate(ctx,token,['runtime']),{domain:'world',action,commandId:randomUUID(),principal:{kind:'agent',id},recoveryEpoch:ctx.recoveryEpoch},input));
 const artifact=(token=runtime,id=agentId)=>f.runtime.transaction(async ctx=>interaction.execute(ctx,await f.access.authenticate(ctx,token,['runtime']),{domain:'interaction',action:'interaction.artifact.create',commandId:randomUUID(),principal:{kind:'agent',id},recoveryEpoch:ctx.recoveryEpoch},{body:'Isolated manual fixture.'}));
 const save=(expectedVersion:number,mode:string)=>f.service.invoke('saveWorldActionPolicy',{agentId,operationId:randomUUID(),expectedVersion,mode},owner);
 const access=()=>f.service.invoke('readWorldAccess',{agentId},runtime);
 const adoption=(expectedPolicyVersion:number,jobState:string)=>f.service.invoke('adoptWorldAccess',{agentId,operationId:randomUUID(),expectedVersion:2,expectedPolicyVersion,jobState},runtime);
 assert.equal((await act('world.avatar.create',{worldId:'default',expectedRulesetVersion:1})).outcome,'committed');
 const avatar=await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getAvatar('default',agentId));assert(avatar);
 const direction=avatar.position.x<14?1:-1;
 const moved=await act('world.avatar.move',{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:avatar.position.x+direction,y:avatar.position.y},{x:avatar.position.x+2*direction,y:avatar.position.y}]});assert.equal(moved.outcome,'committed');
 const manual=await save(3,'manual');assert.equal(manual.version,4);assert.equal(manual.actionVersion,3);assert.equal(manual.actionUpdatedAt,at);
 let view=await access();assert.equal(view.intervalSeconds,3600);assert.equal(view.version,2);assert.equal((view.scheduling as JsonObject).effectiveState,'off');assert.equal((view.adoption as JsonObject).status,'awaiting');assert.equal((view.adoption as JsonObject).jobState,'scheduled');
 assert.equal((await artifact()).outcome,'committed');
 await assert.rejects(adoption(3,'stopped'),{code:'version_conflict'});
 await assert.rejects(adoption(4,'scheduled'),{code:'invalid_request'});
 assert.equal(((await adoption(4,'stopped')).adoption as JsonObject).status,'current');
 const scheduler=createDeterministicScheduler({store:f.runtime,workerId:'manual-synthetic',batchLimit:10,handlers:[{kind:'world.movement.step',version:1,run:world.handleTask},{kind:'world.idle.step',version:1,run:world.handleIdleTask}]});
 f.tick(1001);await scheduler.runDue();
 assert.equal((await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getMovement(String(moved.result.movementId))))!.nextStep,1,'Old numeric qualification survives autonomous to manual');
 assert.equal((await save(4,'autonomous')).actionVersion,3);view=await access();assert.equal((view.scheduling as JsonObject).effectiveState,'on');assert.equal((view.adoption as JsonObject).status,'awaiting','Changing to autonomous never claims the host resumed');
 f.tick(1001);await scheduler.runDue();
 assert.equal((await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getMovement(String(moved.result.movementId))))!.state,'completed');
 await save(5,'manual');
 const beforeIdle=(await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getAvatar('default',agentId)))!;
 f.tick(40000);await scheduler.runDue();
 // The first idle visit observes the completed explicit action and preserves
 // its ordinary finite rest; only the following due tick starts wandering.
 f.tick(10001);await scheduler.runDue();
 assert.ok((await f.runtime.read(ctx=>ctx.repository(WORLD_REPOSITORY).getAvatar('default',agentId)))!.version>beforeIdle.version,'Manual never disables deterministic idle rules');
 await f.legacy.transaction(async tx=>{const row=(await tx.get('memberships',agentId))!;await tx.update('memberships',{...row,version:row.version+1,data:{...row.data,ownerPaused:true,ownerPauseVersion:2}},row.version);});
 assert.equal((await artifact()).result.code,'participation_paused');
 await f.legacy.transaction(async tx=>{const row=(await tx.get('memberships',agentId))!;await tx.update('memberships',{...row,version:row.version+1,data:{...row.data,ownerPaused:false,ownerPauseVersion:3,platformRestricted:true,platformVersion:2}},row.version);});
 assert.equal((await artifact()).result.code,'target_not_accessible');
 assert.equal((await artifact(legacyRuntime,legacyId)).result.code,'world_action_observe_only');
 const legacy=await f.service.invoke('readWorldActionPolicy',{agentId:legacyId},legacyRuntime);assert.equal(legacy.mode,'observe');assert.equal(legacy.version,3);assert.equal(legacy.actionVersion,undefined,'Legacy records are not upgraded implicitly');
 await f.legacy.transaction(async tx=>{const row=(await tx.get('memberships',agentId))!;await tx.update('memberships',{...row,version:row.version+1,data:{...row.data,platformRestricted:false,platformVersion:3}},row.version);});
 const observed=await save(6,'observe');assert.equal(observed.actionVersion,4);assert.equal((await artifact()).result.code,'world_action_observe_only');
 assert.equal((await save(7,'manual')).actionVersion,5);assert.equal((await artifact()).outcome,'committed');
 await f.legacy.transaction(async tx=>{const p=parseToken(runtime,true),row=(await tx.get('credentials',p.id))!;await tx.update('credentials',{...row,version:row.version+1,data:{...row.data,active:false}},row.version);});
 await assert.rejects(artifact(),{code:'authentication_failed'});
 console.info(JSON.stringify({purpose:'manual-participation',database:f.database,oid:manifest.oid,oldMovementContinues:true,idleContinues:true,intervalPreserved:true,adoptionModeVersionFenced:true,observePauseRestrictionRevocationRetained:true}));
});
