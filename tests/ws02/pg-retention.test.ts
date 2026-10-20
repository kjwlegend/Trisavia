import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,requestBase} from './helpers.ts';

test('bounded cleanup reaches expired sessions beyond 200 live IDs, preserves live continuations and the retention boundary',async t=>{
 const f=await fixture(t),first=await f.read('POST','/list',requestBase('world',{categoryId:'items',limit:1}));
 assert(first.nextPageToken);
 const at=Date.UTC(2026,9,20),retention=7*86400000;
 await f.storage(store=>store.transaction(async tx=>{
  const session=(await tx.get('perception_sessions',first.nextPageToken))!,fact=(await tx.find('perception_access'))[0]!;
  for(let n=0;n<200;n++){
   const suffix=String(n).padStart(4,'0');
   await tx.insert('perception_sessions',{id:`ps_000_live_${suffix}`,version:1,data:{...session.data,actorId:f.sibling.agentId,expiresAt:at+300000}});
   const id=`access_000_live_${suffix}`;
   await tx.insert('perception_access',{id,version:1,data:{...fact.data,recordId:id,recordedAt:at-retention}});
  }
  for(let n=0;n<401;n++){
   const suffix=String(n).padStart(4,'0'),id=`access_zzz_expired_${suffix}`;
   await tx.insert('perception_access',{id,version:1,data:{...fact.data,recordId:id,recordedAt:at-retention-1}});
   if(n<200)await tx.insert('perception_sessions',{id:`ps_zzz_expired_${suffix}`,version:1,data:{...session.data,expiresAt:at}});
  }
 }));
 const read=await f.call('POST','/list',requestBase('world',{categoryId:'items',limit:1}));
 assert.equal(read.status,200,`expired sessions must be reclaimed before the actor quota: ${read.error?.code}`);
 await f.storage(store=>store.read(async tx=>{
  const sessions=await tx.find('perception_sessions'),facts=await tx.find('perception_access');
  assert.equal(sessions.filter(r=>r.id.startsWith('ps_000_live_')).length,200);
  assert.equal(sessions.filter(r=>r.id.startsWith('ps_zzz_expired_')).length,0);
  assert.equal(facts.filter(r=>r.id.startsWith('access_000_live_')).length,200);
  assert.equal(facts.filter(r=>r.id.startsWith('access_zzz_expired_')).length,1,'the existing two cleanup scopes each remove at most 200 expired access facts');
 }));
 const resumed=await f.call('POST','/list',requestBase('world',{categoryId:'items',limit:1,pageToken:first.nextPageToken}));
 assert.equal(resumed.status,200);assert.equal(resumed.data.records.length,1);
});
