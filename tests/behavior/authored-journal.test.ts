import test from 'node:test';import assert from 'node:assert/strict';
import {lifeFixture} from '../life/fixture.ts';
import {createBehaviorLogService} from '../../apps/platform/application/behavior-log-service.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {BEHAVIOR_SCOPES} from '../../apps/platform/domains/behavior/types.ts';
import {parseJournalInput,journalAudienceRef} from '../../apps/platform/domains/behavior/journal.ts';
import type {Principal} from '../../apps/platform/domains/access/public.ts';

async function fixture(){
 const f=await lifeFixture(),a=await f.add('authored-a'),b=await f.add('authored-b',{x:9,y:8});let visible=true;if(a.kind!=='agent'||b.kind!=='agent')throw Error('Synthetic Agent identity required');
 const source={...f.engine,canObserveBehavior:async(ctx:any,row:any,audience:any)=>visible&&await f.engine.canObserveBehavior(ctx,row,audience)};
 const service=createBehaviorLogService(f.identity,{world:createWorldService(f.identity),relationships:createRelationshipsService(f.identity),interaction:createInteractionService(f.identity,f.f.decisions),life:source},{journalEnabled:true});
 for(const scope of BEHAVIOR_SCOPES)await f.f.behavior.activateCoverage(scope,f.now);
 const owner=(id='owner-authored-a'):Principal=>({kind:'owner',ownerId:id,ownerAuthVersion:1,credentialId:'owner-session-'+id,credentialVersion:1,authorizationVersion:'owner-auth-'+id,recoveryEpoch:f.context.recoveryEpoch,source:'owner',expiresAt:null});
 const history=(who:Principal=a,input={})=>f.store.read(ctx=>service.journalHistory(ctx,who,input));
 const input=async(clientEntryId='stable-entry-01',text='最终生活自述\n保留自己的段落。')=>({clientEntryId,expectedAudienceRef:(await history()).submissionContext.expectedAudienceRef,text});
 const submit=(body:any,who:Principal=a,commandId='submit-command-01')=>f.store.transaction(ctx=>service.submitJournal(ctx,who,{domain:'behavior',action:'behavior.journal.submit',commandId,principal:{kind:who.kind,id:who.kind==='agent'?who.agentId:who.ownerId},recoveryEpoch:ctx.recoveryEpoch},body));
 return{f,a,b,service,owner,history,input,submit,hideSource(){visible=false;},showSource(){visible=true;},async work(){const r=await f.invoke(a,'life.activities.start',f.startInput);assert.equal(r.outcome,'committed');await f.run(600000);return[...f.f.state.behaviorRecords.values()].find(v=>v.agentId===a.agentId&&v.node==='life.work.completed')!;}};
}

test('final text keeps exact paragraphs and Unicode bounds; draft ID, audience and optional title are explicit',()=>{
 const input={clientEntryId:'stable-entry-01',expectedAudienceRef:null,text:'🌱'.repeat(4000),title:'🌱'.repeat(32)};assert.equal(Array.from(parseJournalInput(input).text).length,4000);assert.equal(parseJournalInput({...input,text:'一段\n\t二段'}).text,'一段\n\t二段');
 for(const text of['a'.repeat(4001),'\r\n','bad\u0001','\ud800','   '])assert.throws(()=>parseJournalInput({...input,text}),{code:'journal_text_invalid'});
 for(const title of['x'.repeat(33),'\n',''])assert.throws(()=>parseJournalInput({...input,title}),{code:'journal_title_invalid'});
 assert.throws(()=>parseJournalInput({...input,agentId:'foreign'}),{code:'invalid_request'});assert.throws(()=>parseJournalInput({text:'no stable draft'}),{code:'invalid_request'});
});

test('one private statement survives same-command and cross-command retries; observe/pause never turns it into a world action',async()=>{
 const x=await fixture(),body=await x.input();x.f.f.membership('authored-a',{ownerPaused:true});const state=x.f.f.state.participants.get('authored-a')!;x.f.f.state.participants.set('authored-a',{...state,actionPolicy:{...state.actionPolicy,mode:'observe'}});
 const first=await x.submit(body);assert.equal(first.outcome,'committed');assert.deepEqual(await x.submit(body),first);const second=await x.submit(body,x.a,'submit-command-02');assert.deepEqual(second.result,first.result);assert.equal(x.f.f.state.behaviorJournals.size,1);assert.equal(x.f.f.state.behaviorRecords.size,1);assert.equal(x.f.f.state.events.filter(e=>e.kind==='life.journal.authored').length,1);
 assert.equal((await x.history()).items.length,1);assert.equal(((await x.history()).items as any[])[0].authored.text,body.text);
 const world=createWorldService(x.f.identity),avatar=(await x.f.f.world.getAvatar('default','authored-a'))!;
 const denied=await x.f.store.transaction(ctx=>world.execute(ctx,x.a,{domain:'world',action:'world.avatar.move',commandId:'world-still-denied',principal:{kind:'agent',id:'authored-a'},recoveryEpoch:ctx.recoveryEpoch},{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:1,expectedTopologyVersion:1,path:[{x:2,y:2}]}));assert.notEqual(denied.outcome,'committed');assert.equal(denied.result.code,'world_action_observe_only');
 assert.deepEqual((await x.service.publicWorld(x.f.context,{})).items,[]);assert.deepEqual((await x.service.publicRecent(x.f.context,{agentId:'authored-a'})).items,[]);
 const different=await x.submit({...body,text:'changed draft'},x.a,'submit-command-03');assert.equal(different.result.code,'client_entry_id_conflict');assert.equal(x.f.f.state.behaviorJournals.size,1);
 await assert.rejects(x.submit(body,x.owner()),{code:'agent_identity_required'});await assert.rejects(x.f.store.transaction(ctx=>x.service.submitJournal(ctx,x.b,{...first.key,commandId:'foreign-principal'},body)),{code:'agent_identity_required'});
});

test('refs require actual own visible source; storage failure rolls back only the new log and leaves the completed business intact',async()=>{
 const x=await fixture(),work=await x.work();assert(work);const original=structuredClone([...x.f.state.activities.values()].find(v=>v.actionId==='work.shift'));
 const body={...await x.input(),sourceRefs:[{recordId:work.id}]};x.f.f.failAt='behavior';await assert.rejects(x.submit(body));x.f.f.failAt='';assert.equal(x.f.f.state.behaviorJournals.size,0);assert.deepEqual([...x.f.state.activities.values()].find(v=>v.actionId==='work.shift'),original);assert.equal(x.f.state.balances.get('agent:authored-a'),36);
 const missing=await x.submit({...body,sourceRefs:[{recordId:'0'.repeat(64)}]},x.a,'missing-ref-command');assert.equal(missing.result.code,'journal_reference_not_accessible');
 const foreign=await x.submit({...body,clientEntryId:'foreign-source-01',expectedAudienceRef:(await x.history(x.b)).submissionContext.expectedAudienceRef},x.b,'foreign-source-command');assert.equal(foreign.result.code,'journal_reference_not_accessible');
 x.hideSource();assert.equal((await x.submit(body,x.a,'hidden-source-command')).result.code,'journal_reference_not_accessible');x.showSource();assert.equal((await x.submit(body)).outcome,'committed');
});

test('Owner reads intersect the original audience and every current source; old drafts cannot retarget after binding changes',async()=>{
 const x=await fixture(),work=await x.work(),body={...await x.input(),title:'我的一天',sourceRefs:[{recordId:work.id}]},first=await x.submit(body);assert.equal(first.outcome,'committed');
 const readOwner=(p=x.owner())=>x.service.ownerHistory(x.f.context,p,{agentId:'authored-a'});let data=await readOwner();assert.equal((data.items as any[]).filter(i=>i.authored).length,1);assert.equal((data.items as any[]).find(i=>i.authored).authored.sourceRefs[0].recordId,work.id);
 x.hideSource();data=await readOwner();assert.equal((data.items as any[]).filter(i=>i.authored).length,0,'whole authored entry is withheld, not stripped');assert.equal((await x.history()).items.length,1);x.showSource();
 x.f.proofs.set('authored-a','new-owner');const newOwner=x.owner('new-owner');assert.equal((await readOwner(newOwner)).items.length,0);await assert.rejects(readOwner());
 assert.deepEqual((await x.submit(body,x.a,'old-draft-recovery')).result,first.result);const oldTarget=await x.submit({...body,clientEntryId:'unsubmitted-old-draft'},x.a,'old-target-command');assert.equal(oldTarget.result.code,'journal_audience_changed');assert.equal(x.f.f.state.behaviorJournals.size,1);
 const current=(await x.history()).submissionContext.expectedAudienceRef;assert.notEqual(current,body.expectedAudienceRef);assert.equal(current,journalAudienceRef('authored-a',await x.f.identity.captureOwnerObservation!(x.f.context,'authored-a','life')));
});

test('private pagination freezes the cut and isolates Agent cursors without refilling old facts as authored text',async()=>{
 const x=await fixture();for(let i=0;i<3;i++){x.f.now+=1;assert.equal((await x.submit(await x.input('page-entry-'+i,'原稿'+i),x.a,'page-command-'+i)).outcome,'committed');}
 const page=await x.history(x.a,{limit:1}),first=(page.items as any[])[0];assert(page.nextPageToken);x.f.now+=1;await x.submit(await x.input('later-entry-01','分页后新稿'),x.a,'later-command');
 const next=await x.history(x.a,{limit:1,pageToken:page.nextPageToken as string});assert.equal(next.items.length,1);assert.notEqual((next.items as any[])[0].id,first.id);assert.notEqual((next.items as any[])[0].authored.text,'分页后新稿');
 await assert.rejects(x.history(x.b,{limit:1,pageToken:page.nextPageToken as string}),{code:'invalid_cursor'});assert.deepEqual((await x.history(x.b)).items,[]);
 const work=await x.work(),owner=await x.service.ownerHistory(x.f.context,x.owner(),{agentId:'authored-a'});assert((owner.items as any[]).some(i=>i.source.node===work.node&&i.authored===null));
});
