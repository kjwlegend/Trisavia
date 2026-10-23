import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';
import {initializePerceptionCatalog} from '../../apps/platform/application/perception-catalog.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {worldGatewayGuide,worldGatewayOperations} from '../../apps/platform/application/agent-gateway-world.ts';
import {coreFixture} from '../world/runtime-fixture.ts';
import {M1_TABLES,type M1Table,type M1Store,type M1Transaction,type StoredRow,type JsonObject,type ExactFilters} from '../../apps/platform/contracts/store.ts';

/** Pre-existing synthetic identity/token rows precede the new policy; no registration or real PG is used. */
async function fixture(){
 const agentId='legacy-agent-http',otherId='other-agent-http',ownerId='owner-policy-http',now=1_900_000_000_000;
 let tables=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(name=>[name,new Map()]));
 const put=(table:M1Table,id:string,data:JsonObject,version=1)=>tables.get(table)!.set(id,{id,version,data});
 const rows=(table:M1Table,filters:ExactFilters={})=>[...tables.get(table)!.values()].filter(row=>Object.entries(filters).every(([key,value])=>row.data[key]===value)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(row=>structuredClone(row));
 const tx={get:async(table:M1Table,id:string)=>structuredClone(tables.get(table)!.get(id)),find:async(table:M1Table,filters:ExactFilters={})=>rows(table,filters),scan:async(table:M1Table,filters:ExactFilters,options:{limit:number;afterId?:string})=>rows(table,filters).filter(row=>!options.afterId||row.id>options.afterId).slice(0,options.limit),count:async(table:M1Table,filters:ExactFilters,limit:number)=>Math.min(limit,rows(table,filters).length),quotaCount:async()=>0,insert:async(table:M1Table,row:StoredRow)=>{assert(!tables.get(table)!.has(row.id));tables.get(table)!.set(row.id,structuredClone(row));},update:async(table:M1Table,row:StoredRow,expected:number)=>{if(tables.get(table)!.get(row.id)?.version!==expected)return false;assert.equal(row.version,expected+1);tables.get(table)!.set(row.id,structuredClone(row));return true;},remove:async()=>false} as unknown as M1Transaction;
 const store={instanceId:'policy-http-instance',recoveryEpoch:'policy-http-epoch',read:async(work:(ctx:M1Transaction)=>Promise<unknown>)=>work(tx),transaction:async(work:(ctx:M1Transaction)=>Promise<unknown>)=>{const before=structuredClone(tables);try{return await work(tx);}catch(error){tables=before;throw error;}},close:async()=>{}} as unknown as M1Store;
 function credential(kind:string,data:JsonObject){const token=`${randomUUID()}.${randomBytes(32).toString('base64url')}`,parsed=parseToken(token,true);put('credentials',parsed.id,{kind,fingerprint:parsed.fingerprint,verifier:verifier(kind,parsed),active:true,epoch:store.recoveryEpoch,expiresAt:null,agentId:null,ownerId:null,...data});return token;}
 put('agents',agentId,{runtimeVersion:1,runtimeActive:true,createdAt:now-86400000,worldAccess:{version:1,intervalSeconds:3600}});put('agents',otherId,{runtimeVersion:1,runtimeActive:true});
 for(const id of [agentId,otherId])put('memberships',id,{agentId:id,worldId:'default',state:'joined',ownerPaused:false,ownerPauseVersion:1,platformRestricted:false,platformVersion:1,sharingGeneration:1});
 put('owners',ownerId,{status:'active',epoch:store.recoveryEpoch,authVersion:1});put('bindings','policy-http-binding',{ownerId,agentId,active:true});
 const runtime=credential('runtime',{agentId,runtimeVersion:1}),owner=credential('owner_session',{ownerId,ownerAuthVersion:1}),credentialsBefore=rows('credentials');
 await store.transaction(initializePerceptionCatalog);
 const f=coreFixture(),world=createWorldService(f.identity),gateway=createAgentGateway({store:f.store,identity:f.identity,operations:worldGatewayOperations(world),guides:[worldGatewayGuide]}),service=createM1Service(store,{now:()=>now,gateway:gateway.capabilities}),app=Fastify();registerM1Routes(app,service);registerAgentGatewayRoutes(app,gateway,{instanceId:store.instanceId,now:()=>now});registerSiteRoutes(app);
 async function call(method:'GET'|'PUT'|'POST',url:string,token:string|undefined,input?:JsonObject){const response=await app.inject({method,url,headers:token?{authorization:'Bearer '+token}:{},...(input?{payload:input}:{})});return {status:response.statusCode,data:response.json()};}
 return {agentId,otherId,ownerId,now,runtime,owner,credentialsBefore,rows,put,tx,app,call,close:()=>app.close()};
}

test('an original runtime discovers and reads latest policy; Owner observe rejects that same token write while reads and receipts remain available',async()=>{
 const t=await fixture();try{
  const path=`/v1/agents/${t.agentId}/world-action-policy`,ownerPath=`/v1/owner/agents/${t.agentId}/world-action-policy`;
  const cap=await t.call('GET','/v1/capabilities',undefined);assert.equal(cap.status,200);assert(cap.data.operations.some((op:any)=>op.action==='readWorldActionPolicy'&&op.path==='/v1/agents/:agentId/world-action-policy'&&op.actors.includes('runtime')));assert.equal(cap.data.scheduling,false);
  const initial=await t.call('GET',path,t.runtime);assert.deepEqual(initial.data,{agentId:t.agentId,version:0,mode:'autonomous',updatedAt:null,source:'current',asOf:t.now});assert.equal(t.rows('agents').find(row=>row.id===t.agentId)!.data.worldActionPolicy,undefined,'Implicit legacy default causes no backfill');
  assert.equal(cap.data.hostParticipation.serverCreatesJobs,false);assert.equal(cap.data.hostParticipation.newOnboardingDefaultIntervalSeconds,3600);assert.equal(cap.data.hostParticipation.managedRequiredBeforeJob,true);
  const discovery=(await t.call('GET','/v1/gateway/discovery',undefined)).data.data,ref=discovery.modules.find((module:any)=>module.moduleId==='world').usageGuide,guide=(await t.call('GET',ref.path,undefined)).data.data;assert.equal(ref.version,10);assert.equal(createHash('sha256').update(guide.canonicalDocument).digest('hex'),guide.digest);assert.match(guide.document.autonomousParticipation.instruction,/本人的GET \/v1\/agents\/:agentId\/world-action-policy/);assert.match(guide.document.hostParticipation,/每小时3600秒/);assert.match(guide.document.hostParticipation,/Trisavia（新城）/);
  const input={operationId:randomUUID(),expectedVersion:0,mode:'observe'},saved=await t.call('PUT',ownerPath,t.owner,input);assert.equal(saved.status,200);assert.equal(saved.data.mode,'observe');assert.equal(saved.data.version,1);assert.equal(saved.data.changed,true);assert.deepEqual((await t.call('PUT',ownerPath,t.owner,input)).data,saved.data);
  assert.equal((await t.call('GET',path,t.runtime)).data.mode,'observe');const blocked=await t.call('POST',`/v1/agents/${t.agentId}/membership/leave`,t.runtime,{operationId:randomUUID(),expectedVersion:1});assert.equal(blocked.status,403);assert.equal(blocked.data.error.code,'world_action_observe_only');assert.equal((await t.call('GET',`/v1/agents/${t.agentId}/membership`,t.runtime)).status,200);
  assert.equal((await t.call('PUT',ownerPath,t.runtime,{operationId:randomUUID(),expectedVersion:1,mode:'autonomous'})).status,403);assert.equal((await t.call('GET',`/v1/agents/${t.otherId}/world-action-policy`,t.runtime)).status,404);assert.equal((await t.call('GET',`/v1/agents/${t.otherId}/world-action-policy`,t.owner)).status,404);
  const restored=await t.call('PUT',ownerPath,t.owner,{operationId:randomUUID(),expectedVersion:1,mode:'autonomous'});assert.equal(restored.data.version,2);const leaveId=randomUUID(),left=await t.call('POST',`/v1/agents/${t.agentId}/membership/leave`,t.runtime,{operationId:leaveId,expectedVersion:1});assert.equal(left.status,200);assert.equal(left.data.outcome,'committed');
  await t.call('PUT',ownerPath,t.owner,{operationId:randomUUID(),expectedVersion:2,mode:'observe'});const receipt=await t.call('GET',`/v1/operations/${leaveId}?scope=agent:${t.agentId}&action=leave`,t.runtime);assert.equal(receipt.status,200);assert.equal(receipt.data.receiptId,left.data.receiptId);assert.deepEqual(t.rows('credentials'),t.credentialsBefore,'The exact original runtime is retained without replacement');
 }finally{await t.close();}
});

test('runtime and Owner share authoritative frequency CAS; adoption is self-report for one exact version, never verified host execution',async()=>{
 const t=await fixture();try{
  const path=`/v1/agents/${t.agentId}/world-access`,ownerPath=`/v1/owner/agents/${t.agentId}/world-access`,adoptionPath=path+'/adoption';
  const initial=(await t.call('GET',path,t.runtime)).data;assert.equal(initial.intervalSeconds,3600);assert.deepEqual(initial.adoption,{appliedVersion:null,jobState:'unknown',reportedAt:null,status:'unknown',source:'agent_report'});
  const input={operationId:randomUUID(),expectedVersion:initial.version,intervalSeconds:600},saved=await t.call('PUT',path,t.runtime,input);assert.equal(saved.status,200);assert.equal(saved.data.version,2);assert.equal(saved.data.intervalSeconds,600);assert.deepEqual((await t.call('PUT',path,t.runtime,input)).data,saved.data);assert.equal((await t.call('PUT',ownerPath,t.owner,{operationId:randomUUID(),expectedVersion:1,intervalSeconds:300})).status,409);
  const appliedInput={operationId:randomUUID(),expectedVersion:2,jobState:'scheduled'},applied=await t.call('PUT',adoptionPath,t.runtime,appliedInput);assert.equal(applied.status,200);assert.equal(applied.data.version,2,'Adoption does not increment desired configuration');assert.equal(applied.data.adoption.appliedVersion,2);assert.equal(applied.data.adoption.status,'current');assert.equal(applied.data.adoption.source,'agent_report');assert.deepEqual((await t.call('PUT',adoptionPath,t.runtime,appliedInput)).data,applied.data);
  const newer=await t.call('PUT',ownerPath,t.owner,{operationId:randomUUID(),expectedVersion:2,intervalSeconds:300});assert.equal(newer.data.version,3);assert.equal(newer.data.adoption.status,'awaiting');assert.equal(newer.data.adoption.appliedVersion,2);assert.equal((await t.call('PUT',adoptionPath,t.runtime,{operationId:randomUUID(),expectedVersion:2,jobState:'scheduled'})).status,409);assert.equal((await t.call('PUT',adoptionPath,t.owner,{operationId:randomUUID(),expectedVersion:3,jobState:'scheduled'})).status,403);
  await t.call('PUT',`/v1/owner/agents/${t.agentId}/world-action-policy`,t.owner,{operationId:randomUUID(),expectedVersion:0,mode:'observe'});await t.call('PUT',`/v1/owner/agents/${t.agentId}/participation`,t.owner,{operationId:randomUUID(),expectedVersion:1,paused:true});
  const stopped=await t.call('PUT',path,t.runtime,{operationId:randomUUID(),expectedVersion:3,intervalSeconds:null});assert.equal(stopped.status,200);assert.equal(stopped.data.version,4);assert.equal((await t.call('PUT',adoptionPath,t.runtime,{operationId:randomUUID(),expectedVersion:4,jobState:'scheduled'})).status,400);const report=await t.call('PUT',adoptionPath,t.runtime,{operationId:randomUUID(),expectedVersion:4,jobState:'stopped'});assert.equal(report.status,200);assert.equal(report.data.adoption.status,'current');assert.equal(report.data.adoption.jobState,'stopped');
  assert.equal((await t.call('PUT',`/v1/agents/${t.otherId}/world-access`,t.runtime,{operationId:randomUUID(),expectedVersion:1,intervalSeconds:600})).status,404);assert.deepEqual(t.rows('credentials'),t.credentialsBefore);assert.equal(t.rows('agents').find(row=>row.id===t.agentId)!.data.runtimeVersion,1);
 }finally{await t.close();}
});

test('a newly registered Gateway module does not inherit autonomous Agent command permission',async()=>{
 const f=coreFixture(),principal=f.addAgent('existing-future-agent');let called=false;
 const identity={...f.identity,authenticate:async()=>principal},gateway=createAgentGateway({store:f.store,identity,operations:[{id:'future.write',moduleId:'future',schemaVersion:1,kind:'command',actors:['agent'],description:'Synthetic unknown future action',input:{type:'object'},output:{type:'object'},command:async()=>{called=true;throw new Error('Unknown future action must not execute');},authorizeReceipt:async()=>{}}],guides:[{moduleId:'future',version:1,document:{moduleId:'future',version:1}}]});
 await assert.rejects(gateway.command({protocolVersion:1,consumerId:'future-guard',purpose:'agent-manual',operation:'future.write',input:{},commandId:randomUUID()},'synthetic-existing-token',()=>true),(error:any)=>error.code==='world_action_not_allowed');assert.equal(called,false);
});
