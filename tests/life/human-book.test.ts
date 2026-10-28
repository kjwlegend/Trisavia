import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Fastify from 'fastify';
import {humanBookPresentation} from '../../apps/platform/application/human-book-presentation.ts';
import {lifeBook} from '../../apps/platform/domains/life/c-books.ts';
import {hashRuntimeRequest} from '../../apps/platform/domains/runtime/command.ts';
import {lifeFixture} from './fixture.ts';
import {LIFE_C_COMMERCE_REPOSITORY} from '../../apps/platform/domains/life-assets/c-repository.ts';
import type {LifeCItemInstance} from '../../apps/platform/domains/life-assets/c-types.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';
import type {Principal} from '../../apps/platform/domains/access/public.ts';
import {fail} from '../../apps/platform/domains/common/errors.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {lifeCGatewayOperations,lifeCGatewayGuide,lifeCPublicReads} from '../../apps/platform/application/agent-gateway-life-c.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerLifeObservationRoutes,registerHumanBookRoutes} from '../../apps/platform/transport/http/life-routes.ts';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';

const resource=JSON.parse(await readFile(new URL('../../apps/platform/domains/life/locales/books/en.json',import.meta.url),'utf8'));
const data=(id='qingzhou_life_guide'):JsonObject=>({book:lifeBook(id)! as unknown as JsonObject,asOf:1793200000000});
const resigned=(book:JsonObject)=>{const {digest:_,...source}=book;return{...source,digest:hashRuntimeRequest(source)};};
const translated=(value:JsonObject)=>value.presentation as JsonObject;

test('human books bind the complete authorized source and exact server translation, with explicit original fallback',async()=>{
 for(const id of ['qingzhou_life_guide','harbor_handbook']){const original=data(id),wrapped=await humanBookPresentation(original);assert.deepEqual(wrapped.originalData,original);const p=translated(wrapped);assert.equal(p.status,'translated');assert.deepEqual(p.translation,resource.books.find((b:any)=>b.sourceId===id));}
 for(const mutate of [
  (r:any)=>{r.books[0].translatedFields.body+='changed';},
  (r:any)=>{r.books[0].unknown=true;},
  (r:any)=>{r.books[0].translatedFields.unknown='extra';},
  (r:any)=>{r.books[0].translationRevision=0;},
  (r:any)=>{r.books[0].translatedFields.body='x'.repeat(10001);},
  (r:any)=>{r.books[0].translatedFields.body='<script>';},
  (r:any)=>{r.books=[r.books[0],structuredClone(r.books[0])];},
  (r:any)=>{r.books=[];},
 ]){const r=structuredClone(resource);mutate(r);const value=await humanBookPresentation(data(),r);assert.deepEqual(value.originalData,data());assert.deepEqual(value.presentation,{status:'original',sourceLocale:'zh-CN',reason:'translation-unavailable'});}
 for(const body of ['<script>','x'.repeat(10001),'invalid\u0001control']){const r=structuredClone(resource),entry=r.books[0];entry.translatedFields.body=body;const {digest:_,...unsigned}=entry;entry.digest=hashRuntimeRequest(unsigned);assert.equal(translated(await humanBookPresentation(data(),r)).status,'original','even a correctly hashed resource must satisfy the plain-text/length contract');}
 assert.equal(translated(await humanBookPresentation(data(),null)).status,'original');
 for(const field of ['bookId','version','authorDisplay','title','locale','readingScope','body']){
  const b=structuredClone(data().book as JsonObject);b[field]=field==='version'?2:String(b[field])+' changed';
  const original={book:resigned(b),asOf:1};
  if(['bookId','version','locale'].includes(field))await assert.rejects(humanBookPresentation(original),{code:'source_unavailable'});
  else assert.deepEqual(translated(await humanBookPresentation(original)),{status:'original',sourceLocale:'zh-CN',reason:'source-changed'},field);
 }
 const broken=structuredClone(data());(broken.book as JsonObject).readingScope='unverified change';await assert.rejects(humanBookPresentation(broken),{code:'source_unavailable'});
 const extra=structuredClone(data());(extra.book as JsonObject).extra='not an original field';await assert.rejects(humanBookPresentation(extra),{code:'source_unavailable'});
});

test('human HTTP calls the original book reader once, preserves ownership and exposes no server resource publicly',async t=>{
 const items=new Map<string,LifeCItemInstance>();let itemReads=0,queries=0,reads=0,writes=0,translations=0;
 const f=await lifeFixture({extension:{repository(port){return port===LIFE_C_COMMERCE_REPOSITORY?{async getItem(actor:LifeCItemInstance['actorRef'],id:string){itemReads++;const item=items.get(id);return item?.actorRef.kind===actor.kind&&item.actorRef.id===actor.id?structuredClone(item):undefined;}}:undefined;},snapshot(){return null;},restore(){}}});t.after(()=>f.scheduler.close());f.c.revision=3;
 const agent=await f.add('book-a');await f.add('book-b');
 const owner=(id:string):Principal=>({kind:'owner',ownerId:id,ownerAuthVersion:1,credentialId:'synthetic-owner-session',credentialVersion:1,authorizationVersion:'synthetic-owner-proof',recoveryEpoch:f.context.recoveryEpoch,source:'owner',expiresAt:null});
 // Only the credential transport adapter is synthetic. Original Life selection and item checks run below.
 f.identity.authenticate=async(_ctx,token,kinds)=>{if(token==='synthetic-owner'&&kinds.includes('owner_session'))return owner('owner-book-a');if(token==='synthetic-other-owner'&&kinds.includes('owner_session'))return owner('owner-book-b');if(token==='synthetic-runtime'&&kinds.includes('runtime'))return agent;fail('authentication_failed',401,'Synthetic credential required');};
 const authorize=f.identity.authorizeAgent;f.identity.authorizeAgent=async(ctx,p,id)=>{if(p.kind==='owner'&&f.proofs.get(id)!==p.ownerId)fail('insufficient_scope',403,'Current binding required');return authorize(ctx,p,id);};
 const item:LifeCItemInstance={id:'owned-handbook',version:1,actorRef:{kind:'agent',id:'book-a'},itemId:'harbor_handbook',state:'available',reservationId:null,sourceId:'synthetic-owned-source',issuedAt:f.now,updatedAt:f.now,fish:null};items.set(item.id,item);items.set('foreign-handbook',{...item,id:'foreign-handbook',actorRef:{kind:'agent',id:'book-b'}});
 const service={...f.engine,async query(...args:Parameters<typeof f.engine.query>){queries++;return f.engine.query(...args);}},store={...f.store,async read<T>(fn:Parameters<typeof f.store.read<T>>[0]){reads++;return f.store.read(fn);},async transaction<T>(fn:Parameters<typeof f.store.transaction<T>>[0]){writes++;return f.store.transaction(fn);}};
 const options={store,identity:f.identity,operations:lifeCGatewayOperations(service),publicReads:lifeCPublicReads(service),guides:[lifeCGatewayGuide]},old=createAgentGateway(options),gateway=createAgentGateway({...options,humanBook:async(value:JsonObject)=>{translations++;return humanBookPresentation(value);}});
 assert.deepEqual(gateway.discovery(),old.discovery());assert.deepEqual(gateway.capabilities(),old.capabilities());for(const suffix of ['input','output'])assert.deepEqual(gateway.schema('life.books.get.'+suffix,'3'),old.schema('life.books.get.'+suffix,'3'));
 const app=Fastify({logger:false});t.after(()=>app.close());const http=registerAgentGatewayRoutes(app,gateway,{instanceId:f.store.instanceId,now:()=>f.now});registerLifeObservationRoutes(gateway,http,3);registerHumanBookRoutes(gateway,http);registerSiteRoutes(app,{assetMode:'source'});
 const original=await app.inject('/v1/world/life/books?bookId=qingzhou_life_guide&bookVersion=1');assert.equal(original.statusCode,200,original.body);
 const before={reads,queries,itemReads},publicResult=await app.inject('/v1/human/life/books?bookId=qingzhou_life_guide&bookVersion=1');assert.equal(publicResult.statusCode,200,publicResult.body);const body=publicResult.json();assert.equal(body.schema,'human-book');assert.equal(body.version,1);assert.deepEqual(body.original.data,original.json().data);assert.equal(body.original.requestId,publicResult.headers['x-request-id']);assert.equal(publicResult.headers['cache-control'],'no-store');assert.equal(body.presentation.status,'translated');assert.deepEqual({reads:reads-before.reads,queries:queries-before.queries,itemReads:itemReads-before.itemReads},{reads:1,queries:1,itemReads:0});
 const request={method:'POST' as const,url:'/v1/human/life/books',headers:{authorization:'Bearer synthetic-owner'},payload:{protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',input:{agentId:'book-a',bookId:'harbor_handbook',bookVersion:1,itemInstanceId:item.id}}};
 const unchanged=structuredClone({items,activities:f.state.activities,plans:f.state.plans,events:f.f.state.events,receipts:f.f.state.receipts});
 for(const state of ['available','reserved'] as const){item.state=state;const b={reads,queries,itemReads},result=await app.inject(request);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().presentation.translation.sourceId,'harbor_handbook');assert.deepEqual(result.json().original.data,{book:lifeBook('harbor_handbook'),asOf:f.now});assert.deepEqual({reads:reads-b.reads,queries:queries-b.queries,itemReads:itemReads-b.itemReads},{reads:1,queries:1,itemReads:1});assert(Buffer.byteLength(result.body)<=128*1024);}
 const runtime=await app.inject({...request,headers:{authorization:'Bearer synthetic-runtime'},payload:{...request.payload,purpose:'agent-manual'}});assert.equal(runtime.statusCode,200,runtime.body);
 for(const invalid of [
  {...request,headers:{}},
  {...request,headers:{authorization:'Bearer synthetic-other-owner'}},
  {...request,payload:{...request.payload,input:{...request.payload.input,agentId:'book-b'}}},
  {...request,payload:{...request.payload,input:{...request.payload.input,itemInstanceId:'foreign-handbook'}}},
  {...request,payload:{...request.payload,input:{...request.payload.input,itemInstanceId:'absent'}}},
  {...request,payload:{...request.payload,operation:'life.books.get'}},
  {...request,payload:{...request.payload,input:{...request.payload.input,locale:'en'}}},
 ]){const count=translations,result=await app.inject(invalid);assert(result.statusCode>=400,result.body);assert.equal(translations,count);assert(!result.body.includes('translatedFields'));assert(!result.body.includes(lifeBook('harbor_handbook')!.body));}
 for(const state of ['consumed','sold'] as const){item.state=state;const count=translations,result=await app.inject(request);assert.equal(result.statusCode,404,result.body);assert.equal(translations,count);}
 item.state='available';f.proofs.set('book-a','new-owner');assert.equal((await app.inject(request)).statusCode,403);f.proofs.set('book-a','owner-book-a');
 for(const url of ['/v1/human/life/books?bookId=harbor_handbook&bookVersion=1','/v1/human/life/books?bookId=qingzhou_life_guide&bookVersion=1&locale=en','/assets/life/locales/books/en.json','/assets/../../platform/domains/life/locales/books/en.json']){const result=await app.inject(url);assert(result.statusCode>=400);assert(!result.body.includes('translatedFields'));}
 assert.equal(writes,0);assert.deepEqual(items,unchanged.items);assert.deepEqual({activities:f.state.activities,plans:f.state.plans,events:f.f.state.events,receipts:f.f.state.receipts},{activities:unchanged.activities,plans:unchanged.plans,events:unchanged.events,receipts:unchanged.receipts});
 const builder=await readFile(new URL('../../scripts/web-build/build.mjs',import.meta.url),'utf8');assert(builder.includes('Browser JSON dependency escapes public root'));assert(!new URL('../../apps/platform/domains/life/locales/books/en.json',import.meta.url).pathname.includes('/web/public/'));
});
