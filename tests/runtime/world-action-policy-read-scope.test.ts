import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {M1_TABLES,StorageError,type M1Store,type M1ReadSession,type M1Transaction,type M1Table,type StoredRow,type JsonObject,type ExactFilters} from '../../apps/platform/contracts/store.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';

/** Synthetic identities exercise real M1 authentication and target selection; no PG or listener. */
function fixture(){
 const agentId='policy-read-agent-a',otherId='policy-read-agent-b',ownerId='policy-read-owner',epoch='policy-read-epoch';let now=1_900_000_000_000;
 let tables=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(table=>[table,new Map()])),readFailure:StorageError|undefined;
 const scopes={reads:0,transactions:0},put=(table:M1Table,id:string,data:JsonObject)=>tables.get(table)!.set(id,{id,version:1,data}),rows=(table:M1Table,filters:ExactFilters={})=>[...tables.get(table)!.values()].filter(row=>Object.entries(filters).every(([key,value])=>row.data[key]===value)).sort((a,b)=>a.id.localeCompare(b.id)).map(row=>structuredClone(row));
 const read:M1ReadSession={get:async<T extends JsonObject=JsonObject>(table:M1Table,id:string)=>structuredClone(tables.get(table)!.get(id)) as StoredRow<T>|undefined,find:async<T extends JsonObject=JsonObject>(table:M1Table,filters:ExactFilters={})=>rows(table,filters) as StoredRow<T>[],scan:async<T extends JsonObject=JsonObject>(table:M1Table,filters:ExactFilters,options:{limit:number;afterId?:string})=>rows(table,filters).filter(row=>!options.afterId||row.id>options.afterId).slice(0,options.limit) as StoredRow<T>[],count:async(table,filters,limit)=>Math.min(limit,rows(table,filters).length),quotaCount:async()=>0};
 const tx:M1Transaction={...read,insert:async(table,row)=>{assert(!tables.get(table)!.has(row.id));tables.get(table)!.set(row.id,structuredClone(row));},update:async(table,row,expected)=>{if(tables.get(table)!.get(row.id)?.version!==expected)return false;assert.equal(row.version,expected+1);tables.get(table)!.set(row.id,structuredClone(row));return true;},remove:async()=>false};
 const store:M1Store={instanceId:'policy-read-instance',recoveryEpoch:epoch,read:async work=>{scopes.reads++;if(readFailure)throw readFailure;return work(Object.freeze(read));},transaction:async work=>{scopes.transactions++;const before=structuredClone(tables);try{return await work(tx);}catch(error){tables=before;throw error;}},close:async()=>{}};
 put('agents',agentId,{runtimeVersion:1,runtimeActive:true});put('agents',otherId,{runtimeVersion:1,runtimeActive:true});put('owners',ownerId,{status:'active',epoch,authVersion:1});put('bindings','policy-read-binding',{agentId,ownerId,active:true});
 function credential(kind:string,data:JsonObject){const raw=randomUUID()+'.'+randomBytes(32).toString('base64url'),parsed=parseToken(raw,true);put('credentials',parsed.id,{kind,fingerprint:parsed.fingerprint,verifier:verifier(kind,parsed),active:true,epoch,expiresAt:null,agentId:null,ownerId:null,...data});return raw;}
 const runtime=credential('runtime',{agentId,runtimeVersion:1}),owner=credential('owner_session',{ownerId,ownerAuthVersion:1}),service=createM1Service(store,{now:()=>now});
 return{agentId,otherId,runtime,owner,service,scopes,put,rows,snapshot:()=>structuredClone(tables),tick(){now++;},failReads(error:StorageError){readFailure=error;},read:()=>service.invoke('readWorldActionPolicy',{agentId},runtime)};
}

test('runtime and current Owner policy GET use the read-only scope without implicit policy, receipt or fact writes',async()=>{
 const f=fixture(),before=f.snapshot(),first=await f.read();assert.deepEqual(first,{agentId:f.agentId,version:0,mode:'autonomous',updatedAt:null,source:'current',asOf:1_900_000_000_000});
 assert.deepEqual(await f.service.invoke('readWorldActionPolicy',{agentId:f.agentId},f.owner),first);assert.deepEqual(f.scopes,{reads:2,transactions:0});assert.deepEqual(f.snapshot(),before);
 f.tick();f.put('agents',f.agentId,{runtimeVersion:1,runtimeActive:true,worldActionPolicy:{version:1,mode:'observe',updatedAt:1_900_000_000_000}});assert.equal((await f.read()).mode,'observe');assert.equal((await f.read()).asOf,1_900_000_000_001);assert.equal(f.scopes.transactions,0);
});

test('read-only policy preserves exact input, runtime-self, active binding and current credential guards',async()=>{
 const f=fixture(),before=f.snapshot();
 await assert.rejects(f.service.invoke('readWorldActionPolicy',{agentId:f.agentId,approved:true},f.runtime),{code:'invalid_request'});
 await assert.rejects(f.service.invoke('readWorldActionPolicy',{agentId:f.otherId},f.runtime),{code:'target_not_accessible'});
 await assert.rejects(f.service.invoke('readWorldActionPolicy',{agentId:f.otherId},f.owner),{code:'target_not_accessible'});
 await assert.rejects(f.service.invoke('readWorldActionPolicy',{agentId:f.agentId},randomUUID()+'.'+randomBytes(32).toString('base64url')),{code:'authentication_failed'});
 assert.deepEqual(f.snapshot(),before);assert.equal(f.scopes.transactions,0);
 f.put('bindings','policy-read-binding',{agentId:f.agentId,ownerId:'policy-read-owner',active:false});await assert.rejects(f.service.invoke('readWorldActionPolicy',{agentId:f.agentId},f.owner),{code:'target_not_accessible'});
 f.put('agents',f.agentId,{runtimeVersion:2,runtimeActive:true});await assert.rejects(f.read(),{code:'authentication_failed'});assert.equal(f.scopes.transactions,0);
});

test('invalid stored policy and storage read failure retain their errors without write fallback',async()=>{
 const f=fixture();f.put('agents',f.agentId,{runtimeVersion:1,runtimeActive:true,worldActionPolicy:{version:1,mode:'unrestricted',updatedAt:1}});const before=f.snapshot();
 await assert.rejects(f.read(),{code:'world_action_policy_unavailable',statusCode:503});assert.deepEqual(f.snapshot(),before);assert.equal(f.scopes.transactions,0);
 const busy=new StorageError('busy','Synthetic read-fence failure');f.failReads(busy);await assert.rejects(f.read(),error=>error===busy);assert.equal(f.scopes.transactions,0);
});

test('Owner save remains a transaction with version CAS and original-operation replay; runtime cannot save',async()=>{
 const f=fixture(),input={agentId:f.agentId,operationId:'policy-save-original',expectedVersion:0,mode:'observe'};
 const saved=await f.service.invoke('saveWorldActionPolicy',input,f.owner);assert.equal(saved.version,1);assert.equal(saved.changed,true);assert.deepEqual(await f.service.invoke('saveWorldActionPolicy',input,f.owner),saved);
 assert.deepEqual(f.scopes,{reads:0,transactions:2});assert.equal(f.rows('operations').length,1);assert.equal(f.rows('facts').length,1);
 await assert.rejects(f.service.invoke('saveWorldActionPolicy',{...input,operationId:'policy-save-stale-key'},f.owner),{code:'version_conflict'});
 await assert.rejects(f.service.invoke('saveWorldActionPolicy',{...input,operationId:'runtime-save-denied'},f.runtime),{code:'insufficient_scope'});assert.equal(f.rows('operations').length,1);assert.equal(f.rows('facts').length,1);
 assert.equal((await f.read()).mode,'observe');assert.equal(f.scopes.reads,1);assert.equal(f.scopes.transactions,4);
});
