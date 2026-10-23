import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {bootstrapInteraction,createInteractionService} from '../../apps/platform/application/interaction-service.ts';
import {createRelationshipsService} from '../../apps/platform/application/relationships-service.ts';
import {createBehaviorLogService} from '../../apps/platform/application/behavior-log-service.ts';
import {behaviorGatewayGuide,behaviorGatewayOperations,behaviorPublicReads} from '../../apps/platform/application/agent-gateway-behavior.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerBehaviorLogRoutes} from '../../apps/platform/transport/http/behavior-log-routes.ts';
import {createIdentityAccess} from '../../apps/platform/domains/access/facade.ts';
import {hashRuntimeRequest} from '../../apps/platform/domains/runtime/command.ts';
import {BEHAVIOR_SCOPES,type BehaviorRecord,type BehaviorNode} from '../../apps/platform/domains/behavior/types.ts';
import type {IdentityAccess,OwnerAudienceProof,Principal} from '../../apps/platform/domains/access/public.ts';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {M1ReadSession,JsonObject,StoredRow} from '../../apps/platform/contracts/store.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';

/** Isolated facts only: no actual user, identity, text, credential, service or database. */
async function fixture(){
 const f=coreFixture();f.now=Date.parse('2026-10-23T10:00:00Z');
 const agents=new Map(['a','b','c','d'].map(id=>[id,f.addAgent(id)])),bindings=new Map(['a','b','c','d'].map(id=>[id,{ownerId:id==='b'?'owner-b':'owner-a',id:'binding-'+id,version:1}]));
 const owner=(id:string):Principal=>({kind:'owner',ownerId:id,ownerAuthVersion:1,source:'owner',credentialId:id,credentialVersion:1,recoveryEpoch:f.context.recoveryEpoch,authorizationVersion:'auth-'+id,expiresAt:null}),owners=new Map(['owner-a','owner-b'].map(id=>[id,owner(id)]));
 const identity:IdentityAccess<RuntimeReadContext>={...f.identity,
  async authenticate(_ctx,token,kinds){const p=owners.get(String(token))??agents.get(String(token));if(!p)fail('authentication_failed',401,'Unknown synthetic credential');if(!kinds.includes(p.kind==='owner'?'owner_session':'runtime'))fail('insufficient_scope',403,'Credential does not permit this read');return p;},
  async authorizeAgent(ctx,p,id){if(p.kind==='agent')return f.identity.authorizeAgent(ctx,p,id);const binding=bindings.get(id);if(!binding||binding.ownerId!==p.ownerId)fail('target_not_accessible',404,'Target is not accessible');return {agentId:id,binding:{id:binding.id,version:binding.version},authorizationVersion:hashRuntimeRequest({ownerId:p.ownerId,id,binding})};},
  async captureOwnerObservation(ctx,id,sourceDomain){const binding=bindings.get(id);if(!binding)return null;const member=(await f.identity.readParticipation(ctx,id)).membership,basis={ownerId:binding.ownerId,bindingId:binding.id,bindingVersion:binding.version,sharingGeneration:member.sharingGeneration,sourceDomain};return {...basis,authorizationVersion:hashRuntimeRequest(basis)};},
 };
 const observation={capture:async(ctx:RuntimeReadContext,id:string,domain:'world'|'relationships'|'interaction')=>await identity.captureOwnerObservation!(ctx,id,domain)},world=createWorldService(identity,{observation}),relationships=createRelationshipsService(identity,{observation}),interaction=createInteractionService(identity,f.decisions,{observation});
 await f.store.transaction(async ctx=>{await bootstrapWorld(ctx);await bootstrapInteraction(ctx);for(const scope of BEHAVIOR_SCOPES)await f.behavior.activateCoverage(scope,Date.parse('2026-10-21T00:00:00Z'));});
 for(const p of agents.values())await f.store.transaction(ctx=>world.execute(ctx,p,f.key(p,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}));
 const service=createBehaviorLogService(identity,{world,relationships,interaction}),gateway=createAgentGateway({store:f.store,identity,operations:behaviorGatewayOperations(service),publicReads:behaviorPublicReads(service),guides:[behaviorGatewayGuide]}),app=Fastify(),validator=Fastify();registerBehaviorLogRoutes(gateway,registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now}));
 for(const op of gateway.discovery().operations)validator.post('/'+op.id,{schema:{body:gateway.schema(op.outputSchema.id,String(op.outputSchema.version)).document}},async()=>({ok:true}));
 async function check(response:Awaited<ReturnType<typeof app.inject>>,op:string){if(response.statusCode===200)assert.equal((await validator.inject({method:'POST',url:'/'+op,payload:response.json()})).statusCode,200,op+' exact output schema');return {status:response.statusCode,data:response.json().data,error:response.json().error};}
 const query=(input:JsonObject,token='owner-a')=>app.inject({method:'POST',url:'/v1/gateway/query',headers:{authorization:'Bearer '+token},payload:{protocolVersion:1,consumerId:'synthetic-log-reader',purpose:token.startsWith('owner')?'human-inspect':'agent-manual',operation:'behavior.owner_history',input}}).then(r=>check(r,'behavior.owner_history'));
 const publicRead=(url:string)=>app.inject({method:'GET',url}).then(r=>check(r,url.startsWith('/v1/world/agent-logs')?'behavior.public_recent':'behavior.public_world'));
 let next=0;
 async function add(agentId:string,occurredAt:number,options:{public?:boolean;oldOwner?:OwnerAudienceProof;node?:BehaviorNode;generation?:number}={}){const avatar=(await f.world.getAvatar('default',agentId))!,ownerAudience=options.oldOwner??await observation.capture(f.context,agentId,'world');const sourceEventId='synthetic-event-'+(++next);await f.context.events.append({eventId:sourceEventId,domain:'world',kind:'world.idle.completed',schemaVersion:1,subject:{type:'avatar',id:avatar.id,version:1},actor:{kind:'system',id:'idle-rules'},source:'rules',occurredAt,causationId:'synthetic-cause',correlationId:'synthetic-correlation',audience:{kind:'agents',agentIds:[agentId]},payload:{}});return f.behavior.append({scope:'world_idle',sourceDomain:'world',sourceEventId,sourceRef:{type:'avatar',id:avatar.id,version:1},node:options.node??'world.idle.completed',agentId,occurredAt,recordedAt:f.now,causationId:'synthetic-cause',correlationId:'synthetic-correlation',initiator:{kind:'system',id:'idle-rules'},executor:{kind:'system',id:'idle-rules'},origin:'rules',ownerAudience,publicProjection:options.public===false?null:{policyVersion:1,worldId:'default',sharingGeneration:options.generation??1,placeId:'commons',placeName:'公共庭'}});}
 return {f,agents,bindings,identity,world,relationships,interaction,service,gateway,app,query,publicRead,add,async close(){await app.close();await validator.close();}};
}

test('public world feed aggregates authorized per-Agent recent tens, not one role, and rejects historical bypasses',async()=>{
 const t=await fixture();try{
  for(let i=0;i<14;i++)for(const [index,id] of ['a','b','c','d'].entries())await t.add(id,t.f.now-i*1000-index,{public:i%4!==0});
  for(let i=0;i<12;i++)await t.add('a',t.f.now-i,{generation:2}); // Newer but no longer shared: filter before the ten limit.
  const before=structuredClone(t.f.state),world=await t.publicRead('/v1/world/logs?worldId=default&timeZone=Asia%2FShanghai');assert.equal(world.status,200);assert.equal(world.data.items.length,30);assert.equal(world.data.nextPageToken,null);assert.equal(world.data.partial,false);
  const perAgent:JsonObject[]=[];for(const id of ['a','b','c','d']){const recent=await t.publicRead('/v1/world/agent-logs?agentId='+id+'&timeZone=Asia%2FShanghai');assert.equal(recent.data.items.length,10);perAgent.push(...recent.data.items);assert(world.data.items.filter((row:any)=>row.agent.agentId===id).length<=10);}
  perAgent.sort((a,b)=>Number(b.occurredAt)-Number(a.occurredAt)||(String(a.id)<String(b.id)?1:-1));assert.deepEqual(world.data.items,perAgent.slice(0,30));assert(new Set(world.data.items.map((row:any)=>row.agent.agentId)).size>1);
  for(const suffix of ['&limit=50','&fromDate=2026-10-21','&pageToken=older','&cutoff=1'])assert.equal((await t.publicRead('/v1/world/agent-logs?agentId=a'+suffix)).status,400);
  assert.deepEqual(t.f.state,before,'Public reads do not advance tasks, events, business states or read markers');assert(!JSON.stringify(world.data).includes('sourceRef'));assert(!JSON.stringify(world.data).includes('position'));
  const ref=t.gateway.discovery().modules.find(m=>m.moduleId==='behavior')!.usageGuide,guide=(await t.app.inject({method:'GET',url:ref.path})).json().data;assert.equal(ref.version,1);assert.equal(createHash('sha256').update(guide.canonicalDocument).digest('hex'),guide.digest);
 }finally{await t.close();}
});

test('Owner dates and stable same-time pagination freeze new facts and bind scope, current audience and source visibility',async()=>{
 const t=await fixture();try{
  const at=Date.parse('2026-10-22T16:00:00Z');await t.add('a',at-1);for(let i=0;i<5;i++)await t.add('a',at);await t.add('b',at);const input={agentId:'a',timeZone:'Asia/Shanghai',fromDate:'2026-10-22',toDate:'2026-10-23',limit:2},first=await t.query(input);assert.equal(first.status,200);assert(first.data.nextPageToken);assert(first.data.items.every((r:any)=>r.date==='2026-10-23'&&r.time==='00:00'));
  const inserted=await t.add('a',at-100),items=[...first.data.items];let token=first.data.nextPageToken;while(token){const page=await t.query({...input,pageToken:token});assert.equal(page.status,200);items.push(...page.data.items);token=page.data.nextPageToken;}assert.equal(items.length,6);assert(!items.some(row=>row.id===inserted.id));assert.equal(new Set(items.map(row=>row.id)).size,6);assert.equal(items.at(-1).date,'2026-10-22');assert.equal(items.at(-1).time,'23:59');assert.deepEqual(items.filter(row=>row.occurredAt===at).map(row=>row.id),items.filter(row=>row.occurredAt===at).map(row=>row.id).sort().reverse());
  assert.equal((await t.query(input,'a')).status,403);assert.equal((await t.query(input,'owner-b')).status,404);assert.equal((await t.query({...input,agentId:'b'})).status,404);
  assert.equal((await t.query({...input,pageToken:first.data.nextPageToken,timeZone:'UTC'})).status,409);assert.equal((await t.query({...input,pageToken:first.data.nextPageToken,toDate:'2026-10-22'})).status,409);
  await t.f.behavior.invalidateVisibility(['a']);assert.equal((await t.query({...input,pageToken:first.data.nextPageToken})).status,409);
  t.f.state.publicAgents.delete('a');t.f.membership('a',{ownerPaused:true});assert.equal((await t.query(input)).data.items.length,2,'Private Owner history survives public withdrawal and Owner pause');assert.equal((await t.publicRead('/v1/world/agent-logs?agentId=a')).status,404);
  t.bindings.set('a',{ownerId:'owner-b',id:'new-binding-a',version:1});assert.equal((await t.query(input)).status,404);const newOwner=await t.query(input,'owner-b');assert.equal(newOwner.status,200);assert.deepEqual(newOwner.data.items,[],'A new Owner does not inherit prior private audience');assert(newOwner.data.historyCoverage.gaps.includes('日常漫游仅记录部分完成节点'));
 }finally{await t.close();}
});

test('actual source withdrawal invalidates continuation; summaries never copy text, and source failure is not an empty list',async()=>{
 const t=await fixture();try{
  const a=t.agents.get('a')!,b=t.agents.get('b')!,command=(p:Principal,action:string,input:JsonObject)=>t.f.store.transaction(ctx=>t.interaction.execute(ctx,p,t.f.key(p,action,randomUUID()),input));
  const created=await command(a,'interaction.artifact.create',{title:'Synthetic work',body:'SYNTHETIC PRIVATE BODY MUST NEVER ENTER LOGS'}),sent=await command(a,'interaction.invitation.send',{worldId:'default',toAgentId:'b',artifact:created.result.artifact!,expectedArtifactVersion:1,templateVersion:1,configVersion:1,intent:'Synthetic invitation'});
  await command(b,'interaction.invitation.accept',{invitationId:sent.result.invitationId!,expectedVersion:1});const input={agentId:'a',limit:1},first=await t.query(input);assert.equal(first.data.items.length,1);assert(first.data.nextPageToken);assert(!JSON.stringify(first.data).includes('PRIVATE BODY'));assert.equal(first.data.items[0].source.detail.operation,'interaction.owner_exchange');
  await command(a,'interaction.artifact.withdraw',{artifact:created.result.artifact!,expectedVersion:1});assert.equal((await t.query({...input,pageToken:first.data.nextPageToken})).status,409);assert.deepEqual((await t.query(input)).data.items,[]);
  const original=t.f.behavior.getCoverage;t.f.behavior.getCoverage=async()=>{throw new Error('isolated source failure');};assert.equal((await t.publicRead('/v1/world/logs')).status,503);assert.equal((await t.query(input)).status,503);t.f.behavior.getCoverage=original;
 }finally{await t.close();}
});

test('the real identity facade captures only the then-active unique Owner binding, without a credential grant',async()=>{
 const rows=new Map<string,StoredRow>([['agents:a',{id:'a',version:1,data:{}}],['memberships:a',{id:'a',version:1,data:{sharingGeneration:1}}],['owners:o',{id:'o',version:1,data:{status:'active',epoch:'e',authVersion:1}}],['bindings:b',{id:'b',version:1,data:{agentId:'a',ownerId:'o',active:true}}]]);
 const session={get:async(table:string,id:string)=>rows.get(table+':'+id),scan:async(table:string,filters:Record<string,unknown>)=>[...rows].filter(([key,row])=>key.startsWith(table+':')&&Object.entries(filters).every(([field,value])=>row.data[field]===value)).map(([,row])=>row)} as unknown as M1ReadSession;
 const identity=createIdentityAccess({session:()=>session,recoveryEpoch:'e'}),first=await identity.captureOwnerObservation!({},'a','world');assert.equal(first!.ownerId,'o');assert(!JSON.stringify(first).includes('credential'));
 rows.get('owners:o')!.data.authVersion=2;assert.deepEqual(await identity.captureOwnerObservation!({},'a','world'),first,'Password/session rotation is not a historical content grant change');rows.get('bindings:b')!.version=2;assert.notEqual((await identity.captureOwnerObservation!({},'a','world'))!.authorizationVersion,first!.authorizationVersion);rows.get('bindings:b')!.data.active=false;assert.equal(await identity.captureOwnerObservation!({},'a','world'),null);
});
