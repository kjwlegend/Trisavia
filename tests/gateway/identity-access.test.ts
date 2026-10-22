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

test('public observation requires the current published source and projects only the allowed profile',async()=>{
 const f=fixture(),profile={displayName:'Public Agent',bio:'unused public biography',avatar:{template:'basic',color:'blue'},privateNote:'never projected'};
 f.put('profiles',agentId,{agentId,published:profile,publishedVersion:2,draft:{displayName:'private draft'}});
 const view=await f.access.readPublicAgent(f.context,agentId);
 assert.deepEqual(view,{agentId,publishedVersion:2,displayName:'Public Agent',appearance:{lookId:'sunnyside-human-curlyhair',catalogVersion:'2026-10-21.appearance-v1.1'}});
 assert(!JSON.stringify(view).includes('private'));assert.equal(await f.access.readPublicAgent(f.context,'missing'),null);
 for(const member of [{state:'left',platformRestricted:false},{state:'joined',platformRestricted:true}]){f.put('memberships',agentId,{agentId,...member});assert.equal(await f.access.readPublicAgent(f.context,agentId),null);}
 f.put('memberships',agentId,{agentId,state:'joined',platformRestricted:false});f.put('profiles',agentId,{agentId,published:null,publishedVersion:3});assert.equal(await f.access.readPublicAgent(f.context,agentId),null);
 f.put('profiles',agentId,{agentId,published:{...profile,avatar:{template:'unreleased',color:'blue'}},publishedVersion:4});assert.equal(await f.access.readPublicAgent(f.context,agentId),null);
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

test('a write composition can reject a credential that expires while an authorized handler is running',async()=>{
 const f=fixture(),runtime=f.credential('runtime',{agentId,runtimeVersion:1,expiresAt:now+10}),checks:Array<()=>Promise<void>>=[];let clock=now;
 const access=createIdentityAccess({session:(ctx:typeof f.context)=>ctx.session,recoveryEpoch:epoch,now:()=>clock,registerCommitValidation:(_ctx,check)=>{checks.push(check);}});
 const p=await access.authenticate(f.context,runtime.token,['runtime']);await access.authorizeAgent(f.context,p,agentId);assert.equal(checks.length,1);
 clock=now+10;await rejects(checks[0]!(),'authentication_failed');
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

test('the existing M1 registration/leave/rejoin path advances sharing generation only on actual leave',async()=>{
 const {createM1Service}=await import('../../apps/platform/application/m1-service.ts');
 const f=fixture(),transaction={...f.session,quotaCount:async()=>0,
  insert:async(name:M1Table,row:StoredRow)=>{assert(!f.table(name).has(row.id));f.table(name).set(row.id,structuredClone(row));},
  update:async(name:M1Table,row:StoredRow,expected:number)=>{if(f.table(name).get(row.id)?.version!==expected)return false;f.table(name).set(row.id,structuredClone(row));return true;},
  remove:async(name:M1Table,id:string,expected:number)=>f.table(name).get(id)?.version===expected&&f.table(name).delete(id),
 };
 const store:import('../../apps/platform/contracts/store.ts').M1Store={instanceId:'isolated-auth-unit',recoveryEpoch:epoch,read:work=>work(f.session),transaction:work=>work(transaction),close:async()=>{}};
 const service=createM1Service(store,{now:()=>now}),runtimeToken=`${randomUUID()}.${randomBytes(32).toString('base64url')}`,continuationToken=`${randomUUID()}.${randomBytes(32).toString('base64url')}`;
 const registered=await service.invoke('register',{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken}),id=String(registered.agentId);
 const member=()=>f.table('memberships').get(id)!;
 assert.equal(member().data.sharingGeneration,1);assert.equal((await service.invoke('self',{},runtimeToken)).agentId,id);
 const leave={operationId:randomUUID(),agentId:id,expectedVersion:member().version};await service.invoke('leave',leave,runtimeToken);assert.equal(member().data.sharingGeneration,2);
 await service.invoke('leave',leave,runtimeToken);assert.equal(member().data.sharingGeneration,2,'exact replay must not advance twice');
 await service.invoke('join',{operationId:randomUUID(),agentId:id,expectedVersion:member().version,expectedProfileVersion:f.table('profiles').get(id)!.version},runtimeToken);
 assert.equal(member().data.state,'joined');assert.equal(member().data.sharingGeneration,2,'rejoining never revives the previous sharing generation');
 f.put('owners','bound-owner',{status:'active',epoch,authVersion:1});f.put('bindings','active-management',{agentId:id,ownerId:'bound-owner',active:true});
 const owner=f.credential('owner_session',{ownerId:'bound-owner',ownerAuthVersion:1});
 for(const paused of [true,false])await service.invoke('participation',{operationId:randomUUID(),agentId:id,expectedVersion:member().version,paused},owner.token);
 assert.equal(member().data.sharingGeneration,2,'pause/resume is an execution gate, not a permanent sharing withdrawal');
 await service.invoke('leave',{operationId:randomUUID(),agentId:id,expectedVersion:member().version},runtimeToken);assert.equal(member().data.sharingGeneration,3);
});
