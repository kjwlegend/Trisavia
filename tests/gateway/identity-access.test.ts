import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import type {M1ReadSession,M1Table,StoredRow,ExactFilters,JsonObject} from '../../apps/platform/contracts/store.ts';
import {createIdentityAccess} from '../../apps/platform/domains/access/facade.ts';
import {authenticateCredential} from '../../apps/platform/domains/access/authentication.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import type {Principal} from '../../apps/platform/domains/access/public.ts';
const now=1_900_000_000_000,epoch='isolated-current-epoch',agentId='isolated-agent';
function fixture(){
 const tables=new Map<M1Table,Map<string,StoredRow>>(),reads:{table:M1Table;id:string}[]=[];
 function table(name:M1Table){let value=tables.get(name);if(!value){value=new Map();tables.set(name,value);}return value;}
 const put=(name:M1Table,id:string,data:JsonObject,version=1)=>table(name).set(id,{id,version,data});
 const rows=(name:M1Table,filters:ExactFilters={})=>[...table(name).values()].filter(row=>Object.entries(filters).every(([key,value])=>row.data[key]===value));
 const session:M1ReadSession={get:async<T extends JsonObject>(name:M1Table,id:string)=>{reads.push({table:name,id});return table(name).get(id) as StoredRow<T>|undefined;},find:async<T extends JsonObject>(name:M1Table,filters?:ExactFilters)=>rows(name,filters) as StoredRow<T>[],scan:async<T extends JsonObject>(name:M1Table,filters:ExactFilters,options:{limit:number;afterId?:string})=>rows(name,filters).filter(row=>!options.afterId||row.id>options.afterId).slice(0,options.limit) as StoredRow<T>[],count:async(name,filters,limit)=>Math.min(limit,rows(name,filters).length),quotaCount:async()=>{throw new Error('Identity must not issue a decision quota query');}};
 function credential(kind:string,data:JsonObject={}){
  const token=`${randomUUID()}.${randomBytes(32).toString('base64url')}`,parsed=parseToken(token,true);
  put('credentials',parsed.id,{kind,fingerprint:parsed.fingerprint,verifier:verifier(kind,parsed),active:true,epoch,expiresAt:null,agentId:null,ownerId:null,...data});
  return {token,id:parsed.id};
 }
 put('agents',agentId,{runtimeVersion:1,runtimeActive:true});
 put('memberships',agentId,{agentId,worldId:'default',state:'joined',ownerPaused:false,ownerPauseVersion:1,platformRestricted:false,platformVersion:1});
 const context={session},access=createIdentityAccess({session:(ctx:typeof context)=>ctx.session,recoveryEpoch:epoch,now:()=>now});
 return {put,table,reads,session,credential,context,access};
}
const rejects=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,(error:any)=>error.code===code);

test('an independent runtime needs no Owner binding and exposes no pending Owner or verifier',async()=>{
 const f=fixture(),runtime=f.credential('runtime',{agentId,runtimeVersion:1,ownerId:'pending-owner'});
 f.put('owners','pending-owner',{status:'pending_setup',epoch,authVersion:1});
 const actor=await f.access.authenticate(f.context,runtime.token,['runtime']);
 assert.equal(actor.kind,'agent');assert.equal(actor.source,'external_agent');assert.equal('ownerId'in actor,false);
 assert.equal((await f.access.authorizeAgent(f.context,actor,agentId)).binding,null);
 assert.equal((await f.access.readParticipation(f.context,agentId)).membership.state,'joined');
 assert(!f.reads.some(row=>row.table==='owners'),'runtime authentication must not turn a pending account into an Owner gate');
 const output=JSON.stringify(actor);assert(!output.includes(runtime.token));assert(!output.includes('verifier'));assert(!output.includes('pending-owner'));
 await rejects(f.access.authorizeAgent(f.context,actor,'other-agent'),'target_not_accessible');
});

test('Owner account references never substitute for a current active management binding',async()=>{
 const f=fixture(),ownerId='active-owner';f.put('owners',ownerId,{status:'active',epoch,authVersion:1});
 const owner=f.credential('owner_session',{ownerId,ownerAuthVersion:1}),actor=await f.access.authenticate(f.context,owner.token,['owner_session']);
 await rejects(f.access.authorizeAgent(f.context,actor,agentId),'target_not_accessible');
 f.put('bindings','current-binding',{agentId,ownerId,active:true});
 assert.deepEqual((await f.access.authorizeAgent(f.context,actor,agentId)).binding,{id:'current-binding',version:1});
 f.put('bindings','current-binding',{agentId,ownerId,active:false},2);
 await rejects(f.access.authorizeAgent(f.context,actor,agentId),'target_not_accessible');
 f.put('owners',ownerId,{status:'pending_setup',epoch,authVersion:1});
 await rejects(f.access.authenticate(f.context,owner.token,['owner_session']),'authentication_failed');
});

test('participation pause/restriction remain current domain inputs and revoked runtime/epoch fail authentication',async()=>{
 const f=fixture(),runtime=f.credential('runtime',{agentId,runtimeVersion:1}),actor=await f.access.authenticate(f.context,runtime.token,['runtime']);
 f.put('memberships',agentId,{agentId,worldId:'default',state:'joined',ownerPaused:true,ownerPauseVersion:2,platformRestricted:true,platformVersion:3},4);
 const participation=await f.access.readParticipation(f.context,agentId);assert.equal(participation.membership.ownerPaused,true);assert.equal(participation.membership.platformRestricted,true);assert.equal(participation.membership.version,4);
 // Identity alone does not bypass those business gates; only runtime revocation invalidates this credential.
 f.put('agents',agentId,{runtimeVersion:1,runtimeActive:false},2);
 await rejects(f.access.authenticate(f.context,runtime.token,['runtime']),'authentication_failed');
 await rejects(f.access.authorizeAgent(f.context,actor,agentId),'authentication_failed');
 f.put('agents',agentId,{runtimeVersion:2,runtimeActive:true},3);
 await rejects(f.access.authenticate(f.context,runtime.token,['runtime']),'authentication_failed');
 const row=f.table('credentials').get(runtime.id)!;f.put('credentials',row.id,{...row.data,epoch:'older-epoch'},2);
 await rejects(f.access.authenticate(f.context,runtime.token,['runtime']),'restore_access_unsupported');
});

test('a Principal is confined to the context that authenticated it and stale/forged principals cannot authorize',async()=>{
 const f=fixture(),runtime=f.credential('runtime',{agentId,runtimeVersion:1}),actor=await f.access.authenticate(f.context,runtime.token,['runtime']);
 await rejects(f.access.authorizeAgent({session:f.session},actor,agentId),'authentication_failed');
 await rejects(f.access.authorizeAgent(f.context,{...actor} as Principal,agentId),'authentication_failed');
 const row=f.table('credentials').get(runtime.id)!;f.put('credentials',row.id,{...row.data,active:false},2);
 await rejects(f.access.authorizeAgent(f.context,actor,agentId),'authentication_failed');
 await rejects(f.access.authenticate(f.context,runtime.token,['runtime']),'authentication_failed');
});

test('extracted M1 authentication preserves proof purpose, expiry, handoff generation and Owner auth versions',async()=>{
 const f=fixture(),pending='pending-owner';f.put('owners',pending,{status:'pending_setup',epoch,authVersion:1,handoffGeneration:2});
 const handoff=f.credential('handoff',{ownerId:pending,handoffGeneration:2,expiresAt:now+1});
 assert.equal((await authenticateCredential(f.session,handoff.token,['handoff'],{recoveryEpoch:epoch,now:()=>now})).id,handoff.id);
 await rejects(authenticateCredential(f.session,handoff.token,['runtime'],{recoveryEpoch:epoch,now:()=>now}),'insufficient_scope');
 await rejects(authenticateCredential(f.session,handoff.token,['handoff'],{recoveryEpoch:epoch,now:()=>now+1}),'authentication_failed');
 f.put('owners',pending,{status:'pending_setup',epoch,authVersion:1,handoffGeneration:3},2);
 await rejects(authenticateCredential(f.session,handoff.token,['handoff'],{recoveryEpoch:epoch,now:()=>now}),'authentication_failed');
 f.put('owners','owner',{status:'active',epoch,authVersion:2});
 const session=f.credential('owner_session',{ownerId:'owner',ownerAuthVersion:1});
 await rejects(authenticateCredential(f.session,session.token,['owner_session'],{recoveryEpoch:epoch,now:()=>now}),'authentication_failed');
});
