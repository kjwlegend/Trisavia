import assert from 'node:assert/strict';
import test from 'node:test';
import {performance} from 'node:perf_hooks';
import Fastify from 'fastify';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {worldGatewayGuide,worldGatewayOperations,worldPublicReads} from '../../apps/platform/application/agent-gateway-world.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerWorldObservationRoutes} from '../../apps/platform/transport/http/agent-gateway-world-routes.ts';
import {PUBLIC_WORLD_READ_REVISION,registerPublicWorldReadPool} from '../../apps/platform/domains/world/public-read-revision.ts';
import {createPublicWorldReader,publicWorldReadStatus,type PublicWorldBundle} from '../../apps/platform/application/public-world-read-cache.ts';
import {createPublicWorldDbQueue,createPublicWorldHttpBudget,PublicWorldLimitError} from '../../apps/platform/application/public-world-read-budget.ts';
import type {RuntimeReadContext,RuntimeStore} from '../../apps/platform/contracts/runtime-store.ts';

const pause=()=>new Promise<void>(resolve=>setImmediate(resolve));
const request=[{id:'world.public_rules',input:{worldId:'default'}}];
function model(pool=4){let clock=0,generation=1,gate=true,active=0,maximumActive=0;const instanceId='instance_public_read_model',recoveryEpoch='epoch_public_read_model';
 const store:RuntimeStore={instanceId,recoveryEpoch,async read(work){active++;maximumActive=Math.max(active,maximumActive);const cut={instanceId,recoveryEpoch,writeGeneration:String(generation),writeGate:gate};try{return await work({instanceId,recoveryEpoch,now:()=>clock,repository:()=>({read:async()=>cut})} as unknown as RuntimeReadContext);}finally{active--;}},async transaction(){throw new Error('No model writes');},async close(){}};
 registerPublicWorldReadPool(store,pool);const bundle=():PublicWorldBundle=>({instanceId,asOf:clock,results:{'world.public_rules':{generation}}});
 return{store,bundle,now:()=>clock,advance:(n:number)=>{clock+=n;},change:()=>generation++,gate:(v:boolean)=>{gate=v;generation++;},get active(){return active;},get maximumActive(){return maximumActive;}};
}

test('five independent 1s readers cross two complete windows; public costs do not consume the command budget',async t=>{
 let clock=0;const wall=Date.UTC(2026,9,26);t.mock.method(Date,'now',()=>wall+clock);t.mock.method(performance,'now',()=>clock);
 const f=coreFixture();f.now=wall;await f.store.transaction(bootstrapWorld);const agent=f.addAgent('public-reader-fixture'),world=createWorldService(f.identity);assert(agent.kind==='agent');assert.equal((await f.store.transaction(ctx=>world.execute(ctx,agent,f.key(agent,'world.avatar.create'),{worldId:'default',expectedRulesetVersion:1}))).outcome,'committed');
 let generation=1,active=0,maximumActive=0,projections=0;
 const store:RuntimeStore={...f.store,async read(work){active++;maximumActive=Math.max(active,maximumActive);try{return await f.store.read(ctx=>work({...ctx,repository:(port:any)=>port===PUBLIC_WORLD_READ_REVISION?{read:async()=>({instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,writeGeneration:String(generation),writeGate:true})}:ctx.repository(port)} as RuntimeReadContext));}finally{active--;}}};registerPublicWorldReadPool(store,4);
 const reads=worldPublicReads(world).map(r=>({...r,read:async(ctx:RuntimeReadContext,input:any)=>{if(r.id==='world.public_scene')projections++;return r.read(ctx,input);}}));
 const gateway=createAgentGateway({store,identity:f.identity,operations:worldGatewayOperations(world),publicReads:reads,guides:[worldGatewayGuide]}),app=Fastify();registerWorldObservationRoutes(gateway,registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now}));
 try{const ids=new Set<string>();for(let second=0;second<=120;second++){clock=second*1000;f.now=wall+clock;
   const responses=await Promise.all(Array.from({length:5},()=>app.inject('/v1/world/scene?worldId=default&limit=50')));
   for(const r of responses){assert.equal(r.statusCode,200,r.body);const body=r.json();assert.equal(body.data.avatars[0].agentId,agent.agentId);assert(!ids.has(body.requestId));ids.add(body.requestId);assert.equal(r.headers['cache-control'],'no-store');}
   if(second%30===0)for(let n=0;n<5;n++)assert.equal((await app.inject('/v1/world/rules?worldId=default')).statusCode,200);
   if(second===0){const startup=await app.inject('/v1/world/startup?version=1&worldId=default&limit=50');assert.equal(startup.statusCode,200,startup.body);const d=startup.json().data;assert.equal(d.worldRevision,d.scene.worldRevision);assert.equal(d.rules.world.revision,d.scene.worldRevision);assert.equal(d.asOf,d.scene.asOf);assert(!JSON.stringify(d).includes('epoch'));}
  }
  assert.equal(ids.size,605);assert.equal(projections,121,'Five clients share one fresh projection per second, not five');assert(maximumActive<=2);assert.equal(active,0);
  const before=publicWorldReadStatus(store) as any;assert.equal(before.poolMax,4);assert.equal(before.publicConcurrency,2);assert(before.hits>=484);
  // A real committed visibility transition is represented by a new cut, never worldRevision alone.
  await f.store.transaction(async()=>{f.state.publicAgents.delete(agent.agentId);});generation++;
  const hidden=await app.inject('/v1/world/scene?worldId=default');assert.equal(hidden.statusCode,200);assert.equal(hidden.json().data.avatars.length,0);
  for(let n=0;n<239;n++)assert.equal((await app.inject('/v1/gateway/discovery')).statusCode,200);
  const unauth=await app.inject({method:'POST',url:'/v1/gateway/commands',payload:{}});assert.equal(unauth.statusCode,401,'Public polling did not spend any command/discovery units');assert.equal((await app.inject('/v1/gateway/discovery')).statusCode,429);
  clock+=1000;assert.equal((await app.inject('/v1/world/scene?worldId=default')).statusCode,200,'The legacy command bucket cannot consume the independent public read budget');
 }finally{await app.close();}
});

test('cache keeps original asOf, invalidates on generation, never retains errors/closed-gate/large results, and enforces real pool limits',async()=>{
 const m=model();let calls=0,failure=false,padding='';const reader=createPublicWorldReader(m.store,'catalog-fixed',async()=>{calls++;if(failure)throw new Error('source_failed');const b=m.bundle();if(padding)b.results.padding={text:padding};return b;},m.now)!;
 const first=await reader.read(request);m.advance(20);const cached=await reader.read(request);assert.deepEqual(cached,first);assert.equal(calls,1);cached.results['world.public_rules']!.generation=999;assert.equal((await reader.read(request)).results['world.public_rules']!.generation,1);
 m.change();assert.equal((await reader.read(request)).results['world.public_rules']!.generation,2);assert.equal(calls,2);m.advance(251);await reader.read(request);assert.equal(calls,3);
 m.change();failure=true;for(let n=0;n<2;n++)await assert.rejects(reader.read(request),/source_failed/);assert.equal(calls,5);failure=false;
 m.gate(false);await reader.read(request);await reader.read(request);assert.equal(calls,7);assert.equal(reader.inspect().cacheEntries,0);
 m.gate(true);padding='x'.repeat(1_048_576);await reader.read(request);await reader.read(request);assert.equal(reader.inspect().cacheEntries,0);assert.equal(reader.inspect().cacheBytes,0);
 const one=model(1),limited=createPublicWorldReader(one.store,'c',async()=>one.bundle(),one.now)!;await assert.rejects(limited.read(request),(e:any)=>e.code==='busy');assert.equal(one.active,0);assert.equal(limited.inspect().maximumActive,0);
 const two=model(2),small=createPublicWorldReader(two.store,'c',async()=>two.bundle(),two.now)!;await small.read(request);assert.equal(small.inspect().publicConcurrency,1);
 reader.close();limited.close();small.close();assert.equal(reader.inspect().cacheBytes,0);
});

test('singleflight followers wait without DB scopes; one cancellation cannot cancel the other reader',async()=>{
 const m=model();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let builds=0;
 const reader=createPublicWorldReader(m.store,'c',async()=>{builds++;entered();await gate;return m.bundle();},m.now)!,first=new AbortController();
 const a=reader.read(request,first.signal);await started;const b=reader.read(request);await pause();assert.equal(reader.inspect().clients,2);assert.equal(m.active,1,'Only the actual projection holds a model DB scope; its follower holds none');
 first.abort();await assert.rejects(a,(e:any)=>e.name==='AbortError');assert.equal(reader.inspect().clients,1);release();assert.equal((await b).instanceId,m.store.instanceId);assert.equal(builds,1);assert.equal(m.active,0);assert.equal(reader.inspect().clients,0);assert.equal(reader.inspect().flights,0);reader.close();
});

test('a follower revalidates its cut after connection-free waiting rather than returning the old leader snapshot',async()=>{
 const m=model();const projected=new WeakSet<RuntimeReadContext>();let releases:Array<()=>void>=[],builds=0;
 const store:RuntimeStore={...m.store,async read(work){let built=false;const result=await m.store.read(async ctx=>{const value=await work(ctx);built=projected.has(ctx);return value;});if(built)m.change();return result;}};registerPublicWorldReadPool(store,4);
 const reader=createPublicWorldReader(store,'changing',async ctx=>{projected.add(ctx);builds++;await new Promise<void>(resolve=>releases.push(resolve));return m.bundle();},m.now)!;
 const leader=reader.read(request);while(builds<1)await pause();const follower=reader.read(request);await pause();releases.shift()!();await leader;
 while(builds<2)await pause();releases.shift()!();const result=await follower;assert.equal(result.results['world.public_rules']!.generation,2,'A follower never returns the stale first cut; it may become the next native leader');assert.equal(m.active,0);reader.close();
});

test('public admission and DB queues enforce flood, IP, queue, waiter and cache size bounds without private resources',async()=>{
 let clock=0;const http=createPublicWorldHttpBudget(()=>clock);for(let n=0;n<20;n++)http.take('same-ip');assert.throws(()=>http.take('same-ip'),PublicWorldLimitError);clock+=100;http.take('same-ip');http.take('other-ip');
 const full=createPublicWorldHttpBudget(()=>clock);for(let n=0;n<10_000;n++)full.take('ip-'+n);assert.throws(()=>full.take('overflow'),PublicWorldLimitError);assert.equal(full.size(),10_000);clock+=60_000;full.take('new');assert.equal(full.size(),1);
 const db=createPublicWorldDbQueue(2);let release!:()=>void;const gate=new Promise<void>(r=>release=r),one=db.run(()=>gate),two=db.run(()=>gate),cancel=new AbortController();const waiting=db.run(async()=>{},cancel.signal);const rest=Array.from({length:15},()=>db.run(async()=>{}));await assert.rejects(db.run(async()=>{}),PublicWorldLimitError);assert.deepEqual(db.inspect(),{active:2,queued:16,maximumActive:2});cancel.abort();await assert.rejects(waiting,(e:any)=>e.name==='AbortError');assert.equal(db.inspect().queued,15);release();await Promise.all([one,two,...rest]);assert.equal(db.inspect().active,0);assert.equal(db.inspect().queued,0);
 const m=model();let finish!:()=>void,begin!:()=>void;const blocked=new Promise<void>(r=>finish=r),started=new Promise<void>(r=>begin=r),reader=createPublicWorldReader(m.store,'c',async()=>{begin();await blocked;return m.bundle();},m.now)!;
 const clients=[reader.read(request)];await started;for(let n=1;n<64;n++){clients.push(reader.read(request));await pause();}assert.equal(reader.inspect().clients,64);assert.equal(m.active,1);await assert.rejects(reader.read(request),PublicWorldLimitError);const settled=Promise.allSettled(clients);finish();const results=await settled;assert(results.some(r=>r.status==='fulfilled'));assert(results.filter(r=>r.status==='rejected').every(r=>r.status==='rejected'&&r.reason instanceof PublicWorldLimitError),'A simultaneous final probe burst keeps the independent 16-entry DB queue bound');assert.equal(reader.inspect().clients,0);assert.equal(m.active,0);reader.close();
 const sized=model(),large=createPublicWorldReader(sized.store,'c',async()=>{const b=sized.bundle();b.results.padding={text:'x'.repeat(1_000_000)};return b;},sized.now)!;
 for(let n=0;n<10;n++)await large.read([{id:'world.public_rules',input:{worldId:'bounded-'+n}}]);assert(large.inspect().cacheBytes<=8*1_048_576);assert(large.inspect().cacheEntries<=16);await assert.rejects(large.read([{id:'world.public_rules',input:{worldId:'cost-limit'}}]),PublicWorldLimitError);large.close();
});
