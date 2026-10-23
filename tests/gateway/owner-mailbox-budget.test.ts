import assert from 'node:assert/strict';
import test from 'node:test';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {IdentityAccess} from '../../apps/platform/domains/access/public.ts';
import {createOwnerMailboxService,OWNER_MAILBOX_CANDIDATES,type OwnerMailboxCandidate} from '../../apps/platform/application/owner-mailbox-service.ts';
import {ownerMailboxKey,type OwnerMailboxItem} from '../../apps/platform/application/owner-mailbox-types.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';

test('mailbox scan/count budgets preserve an opaque continuation instead of inventing an empty complete collection',async()=>{
 const rows:OwnerMailboxCandidate[]=Array.from({length:1100},(_,i)=>{const ref={moduleId:'world',type:'world.announcement@1',id:'budget-'+String(i).padStart(4,'0')};return {key:ownerMailboxKey(ref),version:1,occurredAt:2000-i,source:{kind:'perception',channel:'world',ref}};});
 let available=true;
 const repository={async authorizationVersion(){return 'same-source';},async list(input:{after?:{key:string};limit:number}){if(!available)fail('source_unavailable',503,'Isolated unavailable source');const index=input.after?rows.findIndex(row=>row.key===input.after!.key)+1:0;return rows.slice(index,index+input.limit);}};
 const ctx={instanceId:'budget-instance',recoveryEpoch:'budget-epoch',now:()=>3000,repository(port:unknown){assert.equal(port,OWNER_MAILBOX_CANDIDATES);return repository;}} as unknown as RuntimeReadContext;
 const identity={async authenticate(){return {kind:'owner',ownerId:'synthetic-owner'};},async authorizeAgent(){return {authorizationVersion:'same-binding'};}} as unknown as IdentityAccess<RuntimeReadContext>;
 const service=createOwnerMailboxService(identity,{async perception(){return {authorizationVersion:'same-source-permission',legacyNotifications:false,sourceIds:['demo-announcements'],async project(ref){const row=rows.find(row=>row.source.kind==='perception'&&row.source.ref.id===ref.id)!;return {key:row.key,category:'announcement',eventKind:null,source:{id:'demo-announcements',label:'公告'},ref,version:1,title:ref.id==='budget-1050'?'Target outside budget':'Other title',summary:null,counterparty:null,occurredAt:row.occurredAt,timeKind:'published',status:null,detail:null} as OwnerMailboxItem;}};},async exchange(){throw new Error('No exchange source in this budget test');}});
 const query=(cursor?:string)=>service.query(ctx,'synthetic-token',{agentId:'selected-agent',box:'received',search:'Target outside budget',...(cursor?{cursor}:{})});
 const first=await query();assert.deepEqual(first.items,[]);assert.equal(first.total,null);assert.equal(first.partial,true);assert.equal(first.complete,false);assert.equal(typeof first.nextCursor,'string');
 const second=await query(String(first.nextCursor));assert.equal(second.complete,false);assert.equal(second.partial,true);
 const last=await query(String(second.nextCursor));assert.equal((last.items as OwnerMailboxItem[])[0]!.title,'Target outside budget');assert.equal(last.complete,true);assert.equal(last.nextCursor,null);
 available=false;await assert.rejects(query(),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='source_unavailable');
});
