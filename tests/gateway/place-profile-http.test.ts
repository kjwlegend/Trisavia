import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import Fastify from 'fastify';
import {Ajv} from 'ajv';
import {coreFixture} from '../world/runtime-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {townExpansionRules,TOWN_EXPANSION_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-expansion-v1.ts';
import {currentNpcIdentity} from '../../apps/platform/domains/town-services/npc-identity.ts';
import {publishedPlaceProfileCatalog} from '../../apps/platform/domains/world/place-profile-catalog.ts';
import {createPublishedWorldPlaceProfilesService} from '../../apps/platform/application/world-place-profiles-source.ts';
import {placeProfileGatewayOperations,placeProfilePublicReads,placeProfileGuideSection} from '../../apps/platform/application/agent-gateway-place-profiles.ts';
import {placeProfileWorldGuide} from '../../apps/platform/application/agent-gateway-place-profile-guide.ts';
import {approvedWorldGuide} from '../../apps/platform/application/agent-approved-current-guides.ts';
import {residentWorldGuide} from '../../apps/platform/application/agent-gateway-npc-identities.ts';
import {runtimeWorldGuide} from '../../apps/platform/application/agent-runtime-publication.ts';
import {createAgentGateway,canonicalGatewayDocument} from '../../apps/platform/application/agent-gateway.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerPlaceProfileRoutes} from '../../apps/platform/transport/http/world-place-profiles-routes.ts';
import {registerPublicWorldReadPool,PUBLIC_WORLD_READ_REVISION} from '../../apps/platform/domains/world/public-read-revision.ts';
import {PUBLIC_WORLD_PATHS} from '../../apps/platform/application/public-world-read-budget.ts';
import {publicWorldReadStatus} from '../../apps/platform/application/public-world-read-cache.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';
import type {RuntimeStore,RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';

// Actual World/service/Gateway/HTTP handlers and approved source bytes. The
// storage port and credential are synthetic; no PG, listener, account or Agent.
async function fixture(){
 const f=coreFixture(),read=async(name:string)=>JSON.parse(await readFile(new URL('../../apps/web/public/world-life/'+name,import.meta.url),'utf8')),rules=townExpansionRules(await read('world-map-expansion-v1.json'),TOWN_EXPANSION_LAYOUT_SHA256,await read('spatial-manifest-expansion-v1.json'));
 await f.store.transaction(ctx=>bootstrapWorld(ctx,rules));const principal=f.addAgent('place-http-fixture');let generation=1,gate=true,readScopes=0,active=0,maximum=0,projections=0,hold:(()=>Promise<void>)|undefined;
 const store:RuntimeStore={...f.store,async read(work){readScopes++;active++;maximum=Math.max(maximum,active);try{return await f.store.read(ctx=>work({...ctx,repository:(port:any)=>port===PUBLIC_WORLD_READ_REVISION?{read:async()=>({instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,writeGeneration:String(generation),writeGate:gate})}:ctx.repository(port)} as RuntimeReadContext));}finally{active--;}}};registerPublicWorldReadPool(store,4);
 const world=createWorldService(f.identity),service=createPublishedWorldPlaceProfilesService({async readPublicRules(ctx,id){projections++;await hold?.();return world.readPublicRules(ctx,id);}},currentNpcIdentity),identity={...f.identity,async authenticate(_ctx:RuntimeReadContext,bearer:unknown){if(bearer!=='synthetic-place-runtime')fail('authentication_failed',401,'Fixture credential required');return principal;}},operations=placeProfileGatewayOperations(service),reads=placeProfilePublicReads(service),gateway=createAgentGateway({store,identity,operations,publicReads:reads,guides:[placeProfileWorldGuide],retainedGuides:[approvedWorldGuide,residentWorldGuide,runtimeWorldGuide]}),app=Fastify();registerPlaceProfileRoutes(gateway,registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now}));
 return{f,app,gateway,rules,operations,reads,store,gate(value:boolean){gate=value;generation++;},change(){generation++;},hold(fn:(()=>Promise<void>)|undefined){hold=fn;},stats:()=>({readScopes,active,maximum,projections})};
}
const request=(operation:string,input:object)=>({protocolVersion:1,consumerId:'place-profile-inject',purpose:'agent-manual',operation,input});
const pause=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('mounted public and authenticated place reads expose the same actual 48 targets and preserve World24/23/19 exact bytes',async t=>{
 t.mock.method(performance,'now',()=>0);const f=await fixture();t.after(()=>f.app.close());
 const response=await f.app.inject('/v1/world/place-profiles');assert.equal(response.statusCode,200,response.body);const list=response.json();assert.equal(list.data.profiles.length,48);assert.equal(new Set(list.data.profiles.map((p:any)=>p.profileId)).size,48);assert(list.data.profiles.every((p:any)=>p.owner===null&&p.ownerNpcId===null));assert.equal(response.headers['cache-control'],'no-store');assert.match(String(response.headers['server-timing']),/public_read;dur=/);assert.equal(response.headers['x-request-id'],list.requestId);
 assert.equal(f.stats().readScopes,2,'The public projection reuses its guarded read context instead of acquiring a nested read');assert.equal(f.stats().projections,1);
 const cached=await f.app.inject('/v1/world/place-profiles');assert.equal(cached.statusCode,200);assert.deepEqual(cached.json().data,list.data);assert.notEqual(cached.json().requestId,list.requestId);assert.equal(f.stats().projections,1);
 const target=publishedPlaceProfileCatalog.profiles.find(p=>p.kind==='building')!,detail=await f.app.inject('/v1/world/place-profile?targetId='+encodeURIComponent(target.targetIds[0]!));assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().data.profile.profileId,target.profileId);assert.equal(detail.json().data.profile.placeId,null);
 const before=publicWorldReadStatus(f.store) as any,agent=await f.app.inject({method:'POST',url:'/v1/gateway/query',headers:{authorization:'Bearer synthetic-place-runtime'},payload:request('world.place_profile',{targetId:target.targetIds[0]})});assert.equal(agent.statusCode,200,agent.body);assert.deepEqual(agent.json().data,detail.json().data);assert.equal((publicWorldReadStatus(f.store) as any).builds,before.builds,'Authenticated reads keep their original store path');
 assert.equal((await f.app.inject({method:'POST',url:'/v1/gateway/query',payload:request('world.place_profiles',{})})).statusCode,401);
 assert.equal((await f.app.inject('/v1/world/place-profile?targetId=unknown-exact-target')).statusCode,404);assert.equal((await f.app.inject('/v1/world/place-profile?targetId=commons&agentId=private')).statusCode,400);
 const ajv=new Ajv({strict:false}),validate=ajv.compile(f.reads.find(r=>r.id==='world.public_place_profiles')!.output);assert(validate(list.data),JSON.stringify(validate.errors));
 const discovery=(await f.app.inject('/v1/gateway/discovery')).json().data;assert.deepEqual(discovery.operations.filter((o:any)=>o.id.includes('place_profile')).map((o:any)=>[o.id,o.usageGuide.version,o.inputSchema.version]),[['world.place_profiles',25,1],['world.place_profile',25,1],['world.public_place_profiles',25,1],['world.public_place_profile',25,1]]);
 assert.deepEqual(f.gateway.guide('world','25').document,{...approvedWorldGuide.document,version:25,placeProfiles:placeProfileGuideSection});
 for(const [version,digest]of [[24,'0510f1ab9cb12730819f2515bfea467a201dd050ca6c5b61485a2b99891bd0b1'],[23,'bea974eaea33b2accc8f33ce6116f2bbf084f6b770ca72021f5a258d4a0731a3'],[19,'9c069d7b318d380c07310b4f036298e36f2700821a83481569cc45498d19a7c3']] as const)assert.equal(f.gateway.guide('world',String(version)).digest,digest);
 assert.equal(f.f.state.receipts.size,0);assert.equal(f.f.state.events.length,0);assert.equal(f.f.state.tasks.size,0);assert.equal(f.f.state.avatars.size,0);
});

test('only the exact two new public paths share the existing bounded budget; gate-false reads remain fresh',async t=>{
 t.mock.method(performance,'now',()=>0);const f=await fixture();t.after(()=>f.app.close());
 for(let n=0;n<20;n++){const path=n%2?'/v1/world/place-profile?targetId=commons':'/v1/world/place-profiles';assert.equal((await f.app.inject({url:path,headers:{cookie:'synthetic-only=true',authorization:'Bearer synthetic-header'}})).statusCode,200);}
 const limited=await f.app.inject('/v1/world/place-profiles');assert.equal(limited.statusCode,429);assert.equal(limited.headers['retry-after'],'1');assert.equal((publicWorldReadStatus(f.store) as any).builds,2);assert(f.stats().maximum<=2);
 assert(PUBLIC_WORLD_PATHS.has('/v1/world/place-profiles'));assert(PUBLIC_WORLD_PATHS.has('/v1/world/place-profile'));assert(!PUBLIC_WORLD_PATHS.has('/v1/world/place-profile/private'));assert(!PUBLIC_WORLD_PATHS.has('/v1/gateway/query'));
 assert.equal((await f.app.inject({method:'POST',url:'/v1/gateway/query',headers:{authorization:'Bearer synthetic-place-runtime'},payload:request('world.place_profiles',{})})).statusCode,200,'The public bucket cannot spend the authenticated query budget');
 f.gate(false);const validate=()=>true,first=f.stats().projections;await f.gateway.publicRead('world.public_place_profiles',{},validate);await f.gateway.publicRead('world.public_place_profiles',{},validate);assert.equal(f.stats().projections,first+2);assert.equal((publicWorldReadStatus(f.store) as any).cacheEntries,0);assert.equal(f.stats().active,0);
});

test('cancelling one public place reader does not cancel another waiter or create a nested store read',async t=>{
 const f=await fixture();t.after(()=>f.app.close());let release!:()=>void,entered=false;const wait=new Promise<void>(resolve=>release=resolve);f.hold(async()=>{entered=true;await wait;});
 const abort=new AbortController(),one=f.gateway.publicRead('world.public_place_profile',{targetId:'commons'},()=>true,abort.signal);for(let turn=0;turn<100&&!entered;turn++)await pause();assert(entered,'The source projection must start within the bounded fixture turn');
 const two=f.gateway.publicRead('world.public_place_profile',{targetId:'commons'},()=>true);await pause();abort.abort();await assert.rejects(one,(error:any)=>error.name==='AbortError');release();assert.equal(((await two).profile as Record<string,unknown>).owner,null);assert.equal(f.stats().projections,1);assert.equal(f.stats().active,0);assert(f.stats().maximum<=2);
});
