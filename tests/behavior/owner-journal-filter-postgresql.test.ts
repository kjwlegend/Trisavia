import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {worldFixture} from '../runtime/postgresql-fixture.ts';
import {createBehaviorLogService} from '../../apps/platform/application/behavior-log-service.ts';
import {BEHAVIOR_REPOSITORY} from '../../apps/platform/domains/behavior/repository.ts';
import {BEHAVIOR_SCOPES,type BehaviorDetails,type BehaviorNode,type BehaviorRecord} from '../../apps/platform/domains/behavior/types.ts';
import type {IdentityAccess,OwnerObservationDomain,Principal} from '../../apps/platform/domains/access/public.ts';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

// Synthetic source/identity rows only: no registration, HTTP, real credentials,
// activity completion or changes to an existing business database.
test('default Owner journal filters system expiry before bounded paging, preserves authored refs and isolates full-history cursors',async t=>{
 const f=await worldFixture({bootstrap:false});t.after(f.dispose);
 const created=JSON.parse(await readFile(join(f.privateConnections,'created-database.json'),'utf8'));
 console.info(JSON.stringify({purpose:'owner-journal-filter',database:f.database,oid:created.oid,creator:'b',role:'connet_app'}));
 const agentId='synthetic-journal-filter-agent',ownerId='synthetic-journal-filter-owner',denied=new Set<string>();let bindingVersion=1;
 const proof=(sourceDomain:OwnerObservationDomain)=>({ownerId,bindingId:'synthetic-filter-binding',bindingVersion,authorizationVersion:'synthetic-filter-authority',sharingGeneration:1,sourceDomain});
 const identity:IdentityAccess<RuntimeReadContext>={
  async authenticate(){throw Error('No real credential authentication in this read-model test');},
  async authorizeAgent(_ctx,p,id){assert.equal(p.kind,'owner');assert.equal(id,agentId);return {agentId,authorizationVersion:'synthetic-filter-authority',binding:{id:'synthetic-filter-binding',version:bindingVersion}};},
  async captureOwnerObservation(_ctx,_id,domain){return proof(domain);},
  async readPublicAgent(){return {agentId,displayName:'合成日志角色',publishedVersion:1,appearance:{template:'basic',color:'#abcdef'}};},
  async readParticipation(){return {agentId,runtimeActive:true,runtimeVersion:1,actionPolicy:{mode:'autonomous',version:0,updatedAt:null},membership:{worldId:'default',version:1,state:'joined',ownerPaused:false,ownerPauseVersion:1,platformRestricted:false,platformVersion:1,sharingGeneration:1}};},
 };
 const owner:Principal={kind:'owner',ownerId,ownerAuthVersion:1,credentialId:'synthetic-owner-session',credentialVersion:1,authorizationVersion:'synthetic-filter-authority',recoveryEpoch:f.identity.recoveryEpoch,source:'owner',expiresAt:null};
 const source={async canObserveBehavior(_ctx:RuntimeReadContext,row:BehaviorRecord){return !denied.has(row.id);},async describeBehavior(_ctx:RuntimeReadContext,row:BehaviorRecord):Promise<BehaviorDetails|null>{
  if(row.node!=='relationships.gift.expired')return null;
  return {version:1,completeness:'recorded',phase:'gift',startedAt:row.occurredAt-1000,endedAt:row.occurredAt,durationMs:1000,location:null,journey:null,participants:[],resultCode:'expired',gaps:[],journal:{items:[{itemId:'synthetic-item',name:'合成物品',quantity:1,role:'released'}],moneyDelta:null,energySpent:null,energyRestored:null,quotaRefunded:false,stopCode:null}};
 }};
 const logs=createBehaviorLogService(identity,{world:source,relationships:source,interaction:source,life:source},{journalEnabled:true});
 const human=(input:JsonObject={})=>f.runtime.read(ctx=>logs.humanOwnerHistory(ctx,owner,{agentId,limit:2,...input}));
 const history=(input:JsonObject={})=>f.runtime.read(ctx=>logs.ownerHistory(ctx,owner,{agentId,limit:2,...input}));
 await f.query("INSERT INTO iam.agents(id,version,_present,_nulls) VALUES($1,1,'{}','{}')",[agentId]);
 for(const scope of BEHAVIOR_SCOPES)await f.query('INSERT INTO behavior.coverage(scope,from_at,policy_version,partial) VALUES($1,0,1,false) ON CONFLICT DO NOTHING',[scope]);
 let serial=0;
 async function append(node:BehaviorNode,at:number){
  return f.runtime.transaction(async ctx=>{
   const n=++serial,eventId='synthetic-filter-event-'+n,domain=node.startsWith('relationships.')?'relationships':'interaction',invitation=node==='interaction.invitation.expired',gift=domain==='relationships',sourceId='synthetic-filter-source-'+n;
   const kind=invitation?'interaction.invitation.expire':node==='interaction.activity.expired'?'interaction.activity.expire':node==='interaction.feedback.submitted'?'interaction.activity.submit_feedback':node==='interaction.activity.closed'?'interaction.activity.close':node;
   const actor=node.endsWith('.expired')?{kind:'system' as const,id:'synthetic-expiry-rule'}:{kind:'agent' as const,id:agentId};
   const event=await ctx.events.append({eventId,domain,kind,schemaVersion:1,subject:{type:gift?'relationship.gift':invitation?'invitation':'activity',id:sourceId,version:2},actor,source:actor.kind==='system'?'rules':'external_agent',occurredAt:at,causationId:eventId,correlationId:eventId,audience:{kind:'agents',agentIds:[agentId]},payload:{syntheticReadModel:true,...(node==='interaction.activity.expired'?{outcome:'submitted_unconfirmed',feedbackId:'synthetic-existing-feedback'}:{})}});
   return ctx.repository(BEHAVIOR_REPOSITORY).append({scope:domain,sourceDomain:domain,sourceEventId:event.eventId,sourceRef:{type:gift?'relationship_gift':invitation?'interaction_invitation':'interaction_activity',id:sourceId,version:2},node,agentId,occurredAt:at,recordedAt:ctx.now(),causationId:eventId,correlationId:eventId,initiator:actor,executor:actor,origin:event.source,ownerAudience:proof(domain),publicProjection:null});
  });
 }
 const at=f.now()-10000,feedback=await append('interaction.feedback.submitted',at),closed=await append('interaction.activity.closed',at),gift=await append('relationships.gift.expired',at),reference=await append('interaction.activity.expired',at-1000);
 const statement=await f.runtime.transaction(async ctx=>{
  const entryId='synthetic-final-entry',eventId='synthetic-final-event',submittedAt=at+1000,text='我保留已发生的反馈，不把到期说成没有交流。';
  await ctx.events.append({eventId,domain:'life',kind:'life.journal.authored',schemaVersion:1,subject:{type:'life.journal',id:entryId,version:1},actor:{kind:'agent',id:agentId},source:'external_agent',occurredAt:submittedAt,causationId:eventId,correlationId:eventId,audience:{kind:'agents',agentIds:[agentId]},payload:{textDigest:createHash('sha256').update(text).digest('hex')}});
  await ctx.repository(BEHAVIOR_REPOSITORY).insertJournal({entryId,version:1,agentId,clientEntryId:'synthetic-entry-01',expectedAudienceRef:null,payloadHash:'0'.repeat(64),submittedAt,title:null,text,sourceRefs:[{recordId:reference.id}],sourceEventId:eventId,ownerAudience:proof('life')});
  return ctx.repository(BEHAVIOR_REPOSITORY).append({scope:'life',sourceDomain:'life',sourceEventId:eventId,sourceRef:{type:'life_journal',id:entryId,version:1},node:'life.journal.authored',agentId,occurredAt:submittedAt,recordedAt:ctx.now(),causationId:eventId,correlationId:eventId,initiator:{kind:'agent',id:agentId},executor:{kind:'agent',id:agentId},origin:'external_agent',ownerAudience:proof('life'),publicProjection:null});
 });
 // More than the application's 500-source scan bound: post-LIMIT filtering
 // would lose the older meaningful rows or return misleading empty pages.
 for(let i=0;i<620;i++)await append(i%2?'interaction.invitation.expired':'interaction.activity.expired',f.now()-1000+i);
 const first=(await human()).originalData as JsonObject;
 assert.equal((first.items as JsonObject[]).length,2);assert.equal(first.partial,false);assert.ok(first.nextPageToken);
 assert.equal((first.items as JsonObject[])[0]!.id,statement.id);
 assert.deepEqual(((first.items as JsonObject[])[0]!.authored as JsonObject).sourceRefs,[{recordId:reference.id}]);
 const full=await history();assert.equal((full.items as JsonObject[]).length,2);assert.ok(full.nextPageToken);assert.ok((full.items as JsonObject[]).every(row=>String((row.source as JsonObject).node).endsWith('.expired')));
 await assert.rejects(human({pageToken:full.nextPageToken}),{code:'invalid_cursor'});
 await assert.rejects(history({pageToken:first.nextPageToken}),{code:'invalid_cursor'});
 f.tick(1);const later=await append('interaction.feedback.submitted',f.now());
 const fingerprint=async()=>f.query("SELECT (SELECT md5(string_agg(row_to_json(r)::text,E'\\n' ORDER BY id)) FROM behavior.records r) AS records,(SELECT md5(string_agg(row_to_json(e)::text,E'\\n' ORDER BY event_id)) FROM runtime.events e) AS events,(SELECT md5(string_agg(row_to_json(j)::text,E'\\n' ORDER BY id)) FROM behavior.journal_entries j) AS journals,(SELECT write_generation::text FROM platform.instance_state WHERE singleton=1) AS generation");
 const before=await fingerprint(),second=(await human({pageToken:first.nextPageToken})).originalData as JsonObject;
 assert.equal((second.items as JsonObject[]).length,2);assert.equal(second.partial,false);assert.equal(second.nextPageToken,null);
 const ids=[...(first.items as JsonObject[]),...(second.items as JsonObject[])].map(row=>row.id);
 assert.deepEqual(ids,[statement.id,...[feedback,closed,gift].sort((a,b)=>a.id<b.id?1:-1).map(row=>row.id)]);
 assert.ok(!ids.includes(later.id));assert.equal(new Set(ids).size,4);
 assert.deepEqual(await fingerprint(),before,'Reads preserve all events, projected facts, final text and write generation');
 denied.add(reference.id);
 const withoutRef=(await human({limit:50})).originalData as JsonObject;
 assert.ok(!(withoutRef.items as JsonObject[]).some(row=>row.id===statement.id),'Original source permission still withholds the complete authored entry');
 denied.clear();assert.ok((((await human({limit:50})).originalData as JsonObject).items as JsonObject[]).some(row=>row.id===statement.id));
 bindingVersion++;
 await assert.rejects(human({pageToken:first.nextPageToken}),{code:'invalid_cursor'});
 assert.deepEqual((((await human()).originalData as JsonObject).items),[],'Fresh selection does not bypass occurrence-time Owner proof');
 await f.runtime.read(async ctx=>{
  const repo=ctx.repository(BEHAVIOR_REPOSITORY),cut=await repo.cut();
  assert.ok((await repo.list({maxSequence:cut.maxSequence,agentId,limit:50})).some(row=>row.node.endsWith('.expired')));
  await assert.rejects(repo.list({maxSequence:cut.maxSequence,limit:1,omitSystemInteractionExpiry:false as never}),{code:'invalid_usage'});
 });
 console.info(JSON.stringify({purpose:'owner-journal-filter',database:f.database,oid:created.oid,systemExpiryRows:621,meaningfulFrozenPages:[2,2],sourceRefsPreserved:true,mixedCursorsRejected:true,sourceFingerprintsPreserved:true}));
});
