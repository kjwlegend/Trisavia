import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {worldFixture} from './postgresql-fixture.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {defaultPublicProfile} from '../../apps/platform/domains/profile/profile-rules.ts';
import {RELATIONSHIPS_REPOSITORY} from '../../apps/platform/domains/relationships/runtime-repository.ts';
import {makeFriendshipInvitation} from '../../apps/platform/domains/relationships/transitions.ts';
import {prepareFriendshipLifecycle} from '../../scripts/friendships-prepare.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

test('isolated PG: 126 friends and 60 requests use real published-name codec, literal search, time/ID seek and effective-state count without writes',async t=>{
 const f=await worldFixture();t.after(f.dispose);const selected=await f.register(),now=f.now();
 await f.legacy.transaction(async tx=>{
  const profile=(await tx.get('profiles',selected.agentId))!,published=defaultPublicProfile(selected.agentId);
  await tx.update('profiles',{...profile,version:profile.version+1,data:{...profile.data,published,draft:published,publishedVersion:1}},profile.version);
  const membership=(await tx.get('memberships',selected.agentId))!;
  await tx.update('memberships',{...membership,version:membership.version+1,data:{...membership.data,state:'joined',ownerPaused:false,platformRestricted:false}},membership.version);
  for(let i=0;i<186;i++){
   const id='synthetic-peer-'+String(i).padStart(4,'0'),name=i===125?'Final Needle_%':i===184?'Last Request Needle':'Synthetic peer '+i,p={...defaultPublicProfile(id),displayName:name};
   await tx.insert('agents',{id,version:1,data:{runtimeActive:true,runtimeVersion:1}});
   await tx.insert('profiles',{id,version:1,data:{agentId:id,published:p,draft:{...p,bio:'private-draft-only'},publishedVersion:1}});
   await tx.insert('memberships',{id,version:1,data:{agentId:id,worldId:'default',state:'joined',ownerPaused:false,platformRestricted:false,sharingGeneration:1}});
   if(i<126){const [firstAgentId,secondAgentId]=[selected.agentId,id].sort();await tx.insert('friendships',{id:'synthetic-friend-'+String(i).padStart(4,'0'),version:1,data:{firstAgentId:firstAgentId!,secondAgentId:secondAgentId!,status:'confirmed',confirmedAt:now-10000+Math.floor((126-i)/3),firstConfirmationId:'first-'+i,secondConfirmationId:'second-'+i,intimacyScore:0}});}
  }
 });
 await f.runtime.transaction(async ctx=>{
  const repo=ctx.repository(RELATIONSHIPS_REPOSITORY);
  for(let i=0;i<60;i++){
   const id='synthetic-peer-'+String(i+126).padStart(4,'0'),from=i%2?id:selected.agentId,to=i%2?selected.agentId:id;
   const createdAt=i%4<2?now-1000+Math.floor(i/4):now-604800000-1000+Math.floor(i/4);
   await repo.saveInvitation(makeFriendshipInvitation({id:'synthetic-request-'+String(i).padStart(3,'0'),fromAgentId:from,toAgentId:to,message:'private-note-not-searchable',sentBy:{kind:'agent',id:from},senderConfirmationId:'send-'+i,sharedGeneration:0,participantGenerations:{from:1,to:1},now:createdAt}),null);
  }
 });
 await prepareFriendshipLifecycle(join(f.privateConnections!,'migration-database-url'),join(f.privateConnections!,'identity.json'),f.database);
 const service=createRelationshipsService(f.access);
 const friends=(input:JsonObject={})=>f.runtime.read(async ctx=>service.friends(ctx,await f.access.authenticate(ctx,selected.runtimeToken,['runtime']),input));
 const inbox=(input:JsonObject={})=>f.runtime.read(async ctx=>service.inbox(ctx,await f.access.authenticate(ctx,selected.runtimeToken,['runtime']),{direction:'sent',...input}));
 const gate=await f.query('SELECT write_generation,writes_enabled FROM platform.instance_state WHERE singleton=1');
 const sources=await f.query('SELECT id,version,state FROM relationships.friendship_invitations ORDER BY id');
 const ids:string[]=[];let cursor:string|null=null;do{const page=await friends({limit:19,...(cursor?{cursor}:{})});assert.equal(page.total,126);ids.push(...page.friends.map(row=>String(row.relationshipId)));cursor=page.nextCursor;assert.equal(page.complete,cursor===null);}while(cursor);
 assert.equal(ids.length,126);assert.equal(new Set(ids).size,126);assert.deepEqual(ids,[...ids].sort((a,b)=>{const ai=Number(a.slice(-4)),bi=Number(b.slice(-4));return Math.floor((126-bi)/3)-Math.floor((126-ai)/3)||(a<b?1:a>b?-1:0);}));
 const name=await friends({search:' NEEDLE_% ',limit:1});assert.equal(name.total,1);assert.equal(name.friends[0]!.agentId,'synthetic-peer-0125');assert.equal(name.complete,true);
 assert.equal((await friends({search:'SYNTHETIC-PEER-0125'})).total,1);
 assert.equal((await friends({search:'private-draft-only'})).total,0);
 const oldest=await friends({order:'oldest',limit:19});assert.deepEqual(oldest.friends.map(row=>row.relationshipId),[...ids].reverse().slice(0,19));
 for(const direction of ['received','sent']){assert.equal((await inbox({direction})).total,30);assert.equal((await inbox({direction,state:'pending'})).total,15);const expired=await inbox({direction,state:'expired'});assert.equal(expired.total,15);assert(expired.items.every(row=>row.state==='expired'));}
 const request=await inbox({search:'LAST REQUEST NEEDLE',state:'expired'});assert.equal(request.total,1);assert.equal(request.items[0]!.requestId,'synthetic-request-058');
 assert.equal((await inbox({search:'private-note-not-searchable'})).total,0);
 assert.deepEqual(await f.query('SELECT write_generation,writes_enabled FROM platform.instance_state WHERE singleton=1'),gate);
 assert.deepEqual(await f.query('SELECT id,version,state FROM relationships.friendship_invitations ORDER BY id'),sources);
 console.info(JSON.stringify({database:f.database,friends:126,requests:60,publicNameCodec:true,literalSearch:true,stableSeek:true,effectiveExpiryReadOnly:true,accurateFilteredTotals:true}));
});
