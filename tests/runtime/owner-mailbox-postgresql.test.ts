import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {worldFixture} from './postgresql-fixture.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {createOwnerMailboxService} from '../../apps/platform/application/owner-mailbox-service.ts';
import {createPerceptionService} from '../../apps/platform/application/perception-service.ts';
import {createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {authenticateCredential} from '../../apps/platform/domains/access/authentication.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import {refId,type ObjectRef} from '../../apps/platform/domains/perception/protocol.ts';
import {runtimeIdentitySession} from '../../apps/platform/infrastructure/postgresql/runtime-store.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {mailboxMessageId,mailboxVersionId,mailboxReceiptId} from '../../apps/platform/domains/mailbox/repository.ts';
import {INTERACTION_REPOSITORY} from '../../apps/platform/domains/interaction/repository.ts';
import {WORLD_REPOSITORY} from '../../apps/platform/domains/world/repository.ts';
import {DEFAULT_WORLD_RULES} from '../../apps/platform/domains/world/rules.ts';
import {TEXT_FEEDBACK_V1} from '../../apps/platform/domains/interaction/types.ts';
import {makeInvitation} from '../../apps/platform/domains/interaction/transitions.ts';
import {OWNER_NOTIFICATION_COLLECTION_QUERY_ID} from '../../apps/platform/application/perception-collection-query.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

test('isolated PG Owner mailbox keeps authorized exchanges when notification collection is disabled and labels event publication fallback truthfully',async()=>{
 const f=await worldFixture(),app=Fastify();try{
  const selected=await f.register(),other=await f.register(),ownerToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),parsed=parseToken(ownerToken,true);
  await f.runtime.transaction(async ctx=>{await ctx.repository(WORLD_REPOSITORY).initialize({worldId:'default',active:true,rulesetVersion:1,revision:1},structuredClone(DEFAULT_WORLD_RULES));await ctx.repository(INTERACTION_REPOSITORY).initializeConfiguration(TEXT_FEEDBACK_V1);});
  await f.legacy.transaction(async tx=>{
   const owner=(await tx.get('owners',selected.ownerId))!;await tx.update('owners',{...owner,version:owner.version+1,data:{...owner.data,status:'active'}},owner.version);
   await tx.insert('bindings',{id:'mailbox-test-binding',version:1,data:{agentId:selected.agentId,ownerId:selected.ownerId,active:true}});
   await tx.insert('credentials',{id:parsed.id,version:1,data:{kind:'owner_session',fingerprint:parsed.fingerprint,verifier:verifier('owner_session',parsed),active:true,epoch:f.identity.recoveryEpoch,expiresAt:null,ownerId:selected.ownerId,agentId:null,ownerAuthVersion:1}});
   const current=(await tx.get('perception_catalog','current'))!;await tx.update('perception_catalog',{...current,version:current.version+1,data:{...current.data,sourceStates:{...(current.data.sourceStates as JsonObject),'demo-announcements':'enabled','demo-events':'enabled'}}},current.version);
   const collection=(await tx.get('perception_catalog',OWNER_NOTIFICATION_COLLECTION_QUERY_ID))!;await tx.update('perception_catalog',{...collection,version:collection.version+1,data:{...collection.data,active:false}},collection.version);
   for(let i=0;i<205;i++){
    const ref:ObjectRef={moduleId:'world',type:'world.announcement@1',id:'mailbox-synthetic-'+String(i).padStart(3,'0')};
    await tx.insert('perception_objects',{id:refId(ref),version:1,data:{ref,categoryId:'announcements',channel:'world',sourceId:'demo-announcements',title:i===204?'Oldest Needle_%':'合成公告 '+i,body:'not-a-searchable-private-body',public:true,active:true,available:true,dataMode:'demo',source:{kind:'demo',publishedAt:f.now()-i},attachments:[]}});
   }
   for(const [eventKind,type,at] of [['plan','world.plan@1',f.now()+1000],['occurrence','world.occurrence@1',f.now()-1000]] as const){const ref={moduleId:'world',type,id:'synthetic-'+eventKind};await tx.insert('perception_objects',{id:refId(ref),version:1,data:{ref,categoryId:'events',channel:'world',sourceId:'demo-events',title:'合成事件',body:'event-body-not-in-list',eventKind,occurredAt:at,public:true,active:true,available:true,dataMode:'demo',source:{kind:'demo'},attachments:[]}});}
   for(const [suffix,eventKind,type,publishedAt] of [['plan','plan','world.plan@1',f.now()-20],['occurrence','occurrence','world.occurrence@1',f.now()-30],['unknown','occurrence','world.occurrence@1',null]] as const){const ref={moduleId:'world',type,id:'publication-only-'+suffix};await tx.insert('perception_objects',{id:refId(ref),version:1,data:{ref,categoryId:'events',channel:'world',sourceId:'demo-events',title:'仅有发布时间 '+suffix,body:'event-body-not-in-list',eventKind,public:true,active:true,available:true,dataMode:'demo',source:{kind:'demo',...(publishedAt===null?{}:{publishedAt})},attachments:[]}});}
   for(const allowed of [true,false]){const messageId=mailboxMessageId('isolated-mail-source',String(allowed)),id=mailboxVersionId(messageId,1);await tx.insert('mailbox_messages',{id,version:1,data:{messageId,contentVersion:1,sourceId:'isolated-mail-source',sourceMessageKey:String(allowed),title:allowed?'获准标题':'Agent-only secret title',body:'mail-private-body-never-in-list',attachments:[],sender:{kind:'agent',ref:{moduleId:'profiles',type:'profiles.agent@1',id:other.agentId},displayName:'Historical name'},receivedAt:f.now()}});await tx.insert('mailbox_receipts',{id:mailboxReceiptId(messageId,selected.agentId),version:1,data:{messageId,messageVersionId:id,agentId:selected.agentId,active:true,receivedAt:f.now(),ownerObservation:{existence:allowed,summary:allowed,body:false,attachments:false},ownerObservationAudience:allowed?'current_bound_owner':null,stateVersion:0,confirmedAt:null,confirmedContentVersion:null}});}
  });
  await f.runtime.transaction(async ctx=>{const repo=ctx.repository(INTERACTION_REPOSITORY);await repo.lockPair(selected.agentId,other.agentId);for(const [index,from,to] of [[0,selected.agentId,other.agentId],[1,other.agentId,selected.agentId]] as const){const artifact={artifactId:'synthetic-fixed-work-'+index,revision:1,version:1,authorAgentId:from,title:'历史作品 '+index,body:'fixed-original-private-body',createdAt:f.now(),withdrawnAt:null};await repo.saveArtifact(artifact,null);await repo.saveInvitation(makeInvitation({id:'synthetic-exchange-'+index,worldId:'default',actorId:from,recipientId:to,artifact,intent:'private-fixed-intent',configuration:TEXT_FEEDBACK_V1,sharedGeneration:0,participantGenerations:{from:1,to:1},now:f.now()}),null);}});
  const perception=createPerceptionService(f.legacy,{authenticate:(tx,token,kinds)=>authenticateCredential(tx,token,kinds,{recoveryEpoch:f.identity.recoveryEpoch,now:f.now})},{now:f.now,mailboxSources:[{sourceId:'isolated-mail-source',async authenticate(){throw new Error('No delivery during read');},async authorizeRecipient(){return false;}}]});
  const interaction=createInteractionService(f.access,{async ensure(){throw new Error('No decision on read');},async cancel(){throw new Error('No decision on read');}}),mailbox=createOwnerMailboxService(f.access,{perception:(ctx,token,id)=>perception.ownerMailboxContext(runtimeIdentitySession(ctx),token,id),exchange:interaction.readOwnerExchange});
  const service=createM1Service(f.legacy,{now:f.now,ownerMailboxRead:(raw,token)=>f.runtime.read(ctx=>mailbox.query(ctx,token,raw))});registerM1Routes(app,service);
  const read=async(input:JsonObject={},token=ownerToken,id=selected.agentId)=>{const r=await app.inject({method:'POST',url:`/v1/owner/agents/${id}/mailbox/query`,headers:{authorization:'Bearer '+token},payload:{box:'received',...input}});return {status:r.statusCode,data:r.json()};};
  const before=await f.query('SELECT write_generation FROM platform.instance_state'),first=await read({limit:17});assert.equal(first.status,200);assert.equal(first.data.total,212);assert.equal(first.data.items.length,17);assert(first.data.nextCursor);assert(!JSON.stringify(first.data).includes('private-body'));assert(!JSON.stringify(first.data).includes('Agent-only secret'));
  const all:any[]=[...first.data.items];let cursor=first.data.nextCursor;while(cursor){const page=await read({limit:17,cursor});assert.equal(page.status,200);all.push(...page.data.items);cursor=page.data.nextCursor;}assert.equal(all.length,212);assert.equal(new Set(all.map(item=>item.key)).size,212);assert(all.some(item=>item.eventKind==='plan'&&item.timeKind==='scheduled'));assert(all.some(item=>item.eventKind==='occurrence'&&item.timeKind==='occurred'));assert.equal(all.find(item=>item.title==='获准标题').detail,null);
  assert(all.some(item=>item.detail?.invitationId==='synthetic-exchange-1'),'Disabling legacy notification collection does not hide permitted text correspondence');
  for(const [suffix,eventKind,publishedAt] of [['plan','plan',f.now()-20],['occurrence','occurrence',f.now()-30],['unknown','occurrence',null]] as const){const item=all.find(item=>item.ref?.id==='publication-only-'+suffix);assert.equal(item.eventKind,eventKind);assert.equal(item.occurredAt,publishedAt);assert.equal(item.timeKind,publishedAt===null?'unknown':'published');const source=await f.legacy.read(tx=>tx.get('perception_objects',refId(item.ref)));assert.equal(source!.data.occurredAt,undefined,'Reading never invents the missing business occurrence or schedule time');}
  const needle=await read({search:' needle_% '});assert.equal(needle.data.total,1);assert.equal(needle.data.items[0].title,'Oldest Needle_%');assert.equal((await read({search:'private-body'})).data.total,0);
  const sent=await read({box:'sent'});assert.equal(sent.data.total,1);assert.equal(sent.data.items[0].detail.invitationId,'synthetic-exchange-0');assert.equal(sent.data.items[0].version,1);
  assert.equal((await read({limit:17,cursor:first.data.nextCursor,search:'different'})).status,409);assert.equal((await read({},selected.runtimeToken)).status,403);assert.equal((await read({},ownerToken,other.agentId)).status,404);
  assert.deepEqual(await f.query('SELECT write_generation FROM platform.instance_state'),before,'All mailbox listing and counting is read-only');
  await f.legacy.transaction(async tx=>{const row=(await tx.get('perception_objects',refId({moduleId:'world',type:'world.announcement@1',id:'mailbox-synthetic-001'})))!;await tx.update('perception_objects',{...row,version:2,data:{...row.data,public:false}},1);});
  assert.equal((await read({limit:17,cursor:first.data.nextCursor})).status,409);assert.equal((await read({search:'合成公告 1'})).data.items.some((item:any)=>item.ref?.id==='mailbox-synthetic-001'),false);
  await f.legacy.transaction(async tx=>{const row=(await tx.get('perception_catalog','current'))!;await tx.update('perception_catalog',{...row,version:row.version+1,data:{...row.data,sourceStates:{...(row.data.sourceStates as JsonObject),'demo-announcements':'unavailable'}}},row.version);});assert.equal((await read()).status,503);
  console.info(JSON.stringify({database:f.database,authorizedReceived:212,actualSent:1,notificationCollectionDisabled:true,eventPublicationFallback:true,sourcePermissions:true,literalWholeCollectionSearch:true,opaqueScope:true,readOnly:true}));
 }finally{await app.close();await f.dispose();}
});
