import test from 'node:test';
import assert from 'node:assert/strict';
import {Ajv} from 'ajv';
import {coreFixture} from '../world/runtime-fixture.ts';
import {createBehaviorLogService} from '../../apps/platform/application/behavior-log-service.ts';
import {WORLD_LOG_PUBLIC_RULES,eligibleForPublicWorldLog} from '../../apps/platform/domains/behavior/world-public-selection.ts';
import {BEHAVIOR_SCOPES,type BehaviorDetails,type BehaviorNode,type BehaviorRecord} from '../../apps/platform/domains/behavior/types.ts';
import type {Principal} from '../../apps/platform/domains/access/public.ts';
import {createBehaviorRepository} from '../../apps/platform/infrastructure/postgresql/behavior-repository.ts';
import type {RuntimeSql} from '../../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import {behaviorCLifeReads} from '../../apps/platform/application/agent-gateway-life-c-projections.ts';
import {withJournalReads} from '../../apps/platform/application/agent-gateway-journal.ts';

async function fixture(){
 const f=coreFixture();f.now=100_000_000;for(const id of ['a','b','c','d'])f.addAgent(id);
 let bindingVersion=1,denied=new Set<string>(),scanned=0,queries:any[]=[];
 const proof=(sourceDomain:any)=>({ownerId:'owner-a',bindingId:'binding-a',bindingVersion,authorizationVersion:'owner-proof',sharingGeneration:1,sourceDomain});
 const identity={...f.identity,async authorizeAgent(){return{agentId:'a',authorizationVersion:'owner-proof',binding:{id:'binding-a',version:bindingVersion}};},async captureOwnerObservation(_ctx:any,_id:string,domain:any){return proof(domain);}};
 const source={async canObserveBehavior(ctx:any,row:BehaviorRecord,audience:string){scanned++;if(denied.has(row.id))return false;return audience==='owner'||row.agentId===null||!!await identity.readPublicAgent(ctx,row.agentId);},
  async describeBehavior(_ctx:any,row:BehaviorRecord,audience:string):Promise<BehaviorDetails>{return{version:1,completeness:'recorded',phase:row.sourceDomain==='town_services'?'npc_service':'life_work',startedAt:row.occurredAt-600000,endedAt:row.occurredAt,durationMs:600000,location:{from:null,to:{kind:'place',name:row.sourceDomain==='town_services'?'港湾酒馆':'盐风仓棚'},via:[],mapId:null,rulesetVersion:null,topologyVersion:null},journey:null,participants:[],resultCode:'completed',gaps:[],...(row.sourceDomain==='town_services'?{service:{npcId:'npc-tavern',npcName:'酒保',serviceId:'tavern.host',serviceName:'使用酒馆招待券',choice:null,response:null}}:{life:{activityId:row.sourceRef.id,actionId:'work.shift',jobId:'harbor_shift',resultId:row.sourceRef.id,scheduledEndAt:row.occurredAt,energySpent:audience==='owner'?24:null,energyRestored:audience==='owner'?0:null,coinReward:audience==='owner'?36:null}}),...(audience==='owner'?{journal:{items:[{itemId:'bait',name:'通用鱼饵',quantity:3,role:'bought'}],moneyDelta:-6,energySpent:24,energyRestored:0,quotaRefunded:false,stopCode:null}}:{})};}};
 const service=createBehaviorLogService(identity,{world:source,relationships:source,interaction:source,life:source,town_services:source},{journalEnabled:true});
 for(const scope of BEHAVIOR_SCOPES)await f.behavior.activateCoverage(scope,0);
 const list=f.behavior.list;f.behavior.list=async input=>{queries.push(structuredClone(input));return list(input);};
 function add(node:BehaviorNode,agentId:string|null='a',at=f.now-10000,overrides:Partial<BehaviorRecord>={}){const n=f.state.behaviorRecords.size+1,id='row-'+String(n).padStart(6,'0'),row:BehaviorRecord={id,sequence:n,scope:'life',sourceDomain:'life',sourceEventId:'event-'+n,sourceRef:{type:'life_activity',id:'activity-'+n,version:2},node,agentId,...(agentId===null?{npcId:'npc-harbor-hand'}:{}),occurredAt:at,recordedAt:at,causationId:id,correlationId:id,initiator:{kind:agentId===null?'npc':'agent',id:agentId??'npc-harbor-hand'},executor:{kind:'system',id:'life-rules'},origin:'rules',ownerAudience:agentId===null?null:proof('life'),publicProjection:{policyVersion:1,worldId:'default',sharingGeneration:1,placeId:'harbor_work',placeName:'盐风仓棚'},...overrides};f.state.behaviorRecords.set(id,row);return row;}
 return{f,service,add,denied,queries,get scanned(){return scanned;},changeBinding(){bindingVersion++;},owner:{kind:'owner',ownerId:'owner-a'} as Principal};
}

test('world eligibility precedes LIMIT for historical NPC/private-result prefixes; read retains all source facts',async()=>{
 const x=await fixture(),old=x.add('life.work.completed');
 for(let i=0;i<620;i++)x.add('life.work.completed',null,x.f.now-i);
 for(let i=0;i<520;i++)x.add('life.purchase.completed','a',x.f.now-i);
 const before=structuredClone(x.f.state),world=await x.service.publicWorld(x.f.context,{});
 assert.deepEqual((world.items as any[]).map(i=>i.id),[old.id]);assert.equal(world.partial,false);assert.equal(x.scanned,1);
 assert.equal(x.queries[0].worldPublicOnly,true);assert(x.queries.every(q=>q.limit<=50));
 assert(!JSON.stringify(world).includes('moneyDelta'));assert(!JSON.stringify(world).includes('36星币'));assert(!JSON.stringify(world).includes('24体力'));
 assert.deepEqual(x.f.state,before,'Historical/new source rows, events, receipts and money are never rewritten by world selection');
});

test('Town Agent result can involve an NPC; source/current visibility still controls eligible public rows',async()=>{
 const x=await fixture(),town=x.add('town_services.service.completed','a',x.f.now-9000,{scope:'town_services',sourceDomain:'town_services',sourceRef:{type:'town_service',id:'town-result',version:2},executor:{kind:'npc',id:'npc-mayor'},ownerAudience:null});
 assert(eligibleForPublicWorldLog(town));const world=await x.service.publicWorld(x.f.context,{});assert.equal(world.items.length,1);assert.equal((world.items as any[])[0].result,'在港湾酒馆完成了一次镇民服务');assert.equal((world.items as any[])[0].details.service,null);assert(!JSON.stringify(world).includes('招待券'));assert(!JSON.stringify(world).includes('迎新茶'));assert(!JSON.stringify(world).includes('moneyDelta'));
 const validate=new Ajv().compile(withJournalReads(behaviorCLifeReads(x.service)).find(read=>read.id==='behavior.public_world')!.output);assert(validate(world),JSON.stringify(validate.errors));
 const recent=await x.service.publicRecent(x.f.context,{agentId:'a'});assert.match((recent.items as any[])[0].result,/招待券/,'Selected-Agent presentation is unchanged');
 x.denied.add(town.id);assert.deepEqual((await x.service.publicWorld(x.f.context,{})).items,[]);
 x.denied.clear();x.f.state.publicAgents.delete('a');assert.deepEqual((await x.service.publicWorld(x.f.context,{})).items,[]);
 const unknown={...town,node:'future.npc.public.event' as BehaviorNode};assert.equal(eligibleForPublicWorldLog(unknown),false);
 assert.equal(eligibleForPublicWorldLog({...town,sourceRef:{...town.sourceRef,type:'resident_gift'}}),false);
 assert.equal(eligibleForPublicWorldLog({...town,publicProjection:null}),false);
});

test('each of the six existing Agent Life result kinds stays eligible; NPC counterparts and other sources do not gain public scope',async()=>{
 const x=await fixture(),nodes:BehaviorNode[]=['life.work.completed','life.rest.completed','life.fishing.finished','life.meal.completed','life.reading.completed','life.visit.completed'];
 for(const node of nodes){const agent=x.add(node);assert(eligibleForPublicWorldLog(agent));assert.equal(eligibleForPublicWorldLog({...agent,agentId:null,npcId:'npc-harbor-hand'}),false);}
 const world=await x.service.publicWorld(x.f.context,{});assert.deepEqual(new Set((world.items as any[]).map(row=>row.source.node)),new Set(nodes));
 for(const node of ['life.purchase.completed','life.sale.completed','life.meal.prepared','life.activity.interrupted','relationships.invitation.accepted','interaction.activity.closed'] as BehaviorNode[])assert.equal(eligibleForPublicWorldLog({...x.add(node),sourceRef:{type:'life_activity',id:'not-a-new-source',version:1}}),false);
 assert.equal(WORLD_LOG_PUBLIC_RULES.some(rule=>rule.nodes.some(node=>node.includes('announcement'))),false,'Announcements retain their independent existing public source');
});

test('world 30/per-actor 10 and source-check 500 bounds remain; Owner and selected-Agent selection stay separate',async()=>{
 const x=await fixture();for(const id of ['a','b','c','d'])for(let i=0;i<12;i++)x.add('life.work.completed',id,x.f.now-i);
 const world=await x.service.publicWorld(x.f.context,{}),counts=new Map<string,number>();for(const row of world.items as any[])counts.set(row.agent.agentId,(counts.get(row.agent.agentId)??0)+1);
 assert.equal(world.items.length,30);assert([...counts.values()].every(n=>n<=10));
 x.queries.length=0;const recent=await x.service.publicRecent(x.f.context,{agentId:'a'});assert.equal(recent.items.length,10);assert(x.queries.every(q=>q.worldPublicOnly===undefined));
 const y=await fixture(),purchase=y.add('life.purchase.completed');const before=await y.service.ownerHistory(y.f.context,y.owner,{agentId:'a'});assert.equal(before.items.length,1);assert.equal((before.items as any[])[0].details.journal.moneyDelta,-6);
 await y.service.publicWorld(y.f.context,{});assert.deepEqual(await y.service.ownerHistory(y.f.context,y.owner,{agentId:'a'}),before);assert(y.queries.filter(q=>q.agentId==='a').every(q=>q.worldPublicOnly===undefined));
 y.changeBinding();assert.deepEqual((await y.service.ownerHistory(y.f.context,y.owner,{agentId:'a'})).items,[],'Occurrence Owner proof must still match the current binding');assert(y.f.state.behaviorRecords.has(purchase.id));
 const z=await fixture();for(let i=0;i<550;i++){const r=z.add('life.work.completed','a',z.f.now-i);z.denied.add(r.id);}const denied=await z.service.publicWorld(z.f.context,{});assert.deepEqual(denied.items,[]);assert.equal(denied.partial,true);assert.equal(z.scanned,500);
});

test('SQL uses the same explicit source/node/subject eligibility before keyset LIMIT; callers cannot supply a whitelist',async()=>{
 const queries:{sql:string;values:unknown[]}[]=[],sql={query:async(query:string,values:unknown[]=[])=>{queries.push({sql:query,values});return[];}} as unknown as RuntimeSql;
 await createBehaviorRepository(sql).reader.list({worldPublicOnly:true,publicOnly:true,userLogOnly:true,maxSequence:1000,after:{occurredAt:100,id:'old'},limit:30});
 const q=queries[0]!;assert(q.sql.indexOf('source_domain=')<q.sql.indexOf('LIMIT'));assert(q.sql.indexOf('node=ANY(')<q.sql.indexOf('ORDER BY'));assert.match(q.sql,/public_projection IS NOT NULL/);
 for(const rule of WORLD_LOG_PUBLIC_RULES){assert(q.values.includes(rule.sourceDomain));assert(q.values.includes(rule.sourceType));assert(q.values.includes(rule.nodes));}assert.equal(q.values.at(-1),30);
 await assert.rejects(()=>createBehaviorRepository(sql).reader.list({worldPublicOnly:false as any,maxSequence:1,limit:1}));
});
