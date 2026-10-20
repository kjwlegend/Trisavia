import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {stat} from 'node:fs/promises';
import test from 'node:test';
import {buildApp} from '../../apps/platform/app.ts';
import {M1_TABLES} from '../../apps/platform/contracts/store.ts';
import {INTERACTION_REPOSITORY} from '../../apps/platform/domains/interaction/repository.ts';
import {gatewayFixture} from './postgresql-fixture.ts';
const origin='http://127.0.0.1:18894';
async function request(path:string,body?:unknown,token?:string){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json() as any};
}
const envelope=(operation:string,input:unknown,commandId?:string)=>({protocolVersion:1,consumerId:'gateway-http-story',purpose:'agent-manual',operation,input,...(commandId?{commandId}:{})});
const savedToken=()=>randomUUID()+'.'+randomBytes(32).toString('base64url');
test('same-origin HTTP discovers real handlers and independently registered Agents receive server-advanced logical movement',async()=>{
 const f=await gatewayFixture({interaction:false}),app=await buildApp({...f.options,email:{mode:'experience'},worldCoreEnabled:true});
 try{
  await app.listen({host:'127.0.0.1',port:18894});
  assert.equal(await f.runtime.read(ctx=>ctx.repository(INTERACTION_REPOSITORY).getConfiguration(1)),undefined);
  const entry=await fetch(origin+'/agent/entry.md');assert.equal(entry.status,200);assert((await entry.text()).includes('/v1/gateway/discovery'));
  const capabilities=await request('/v1/capabilities');assert.equal(capabilities.status,200);const cap=capabilities.body.gateway;assert.equal(cap.ownerBindingRequiredForAgent,false);assert.deepEqual(cap.modules,['world']);assert(capabilities.body.perceptionApi);assert(capabilities.body.walletApi);
  const discovery=await request(cap.discovery.path);assert.equal(discovery.status,200);assert.equal(discovery.body.data.catalogRevision,cap.catalogRevision);
  for(const operation of discovery.body.data.operations){assert(!operation.http.path.includes('8789'));for(const ref of [operation.inputSchema,operation.outputSchema]){const schema=await request(ref.path);assert.equal(schema.status,200);assert.equal(createHash('sha256').update(schema.body.data.canonicalDocument).digest('hex'),schema.body.data.digest);assert.deepEqual(JSON.parse(schema.body.data.canonicalDocument),schema.body.data.document);}}
  const guide=await request('/v1/gateway/guides/world?version=1');assert.equal(guide.status,200);assert.equal(guide.body.data.document.worldRuleAdvancement.enabled,true);
  assert.equal((await request('/v1/gateway/schemas/world.avatar.input?version=2')).status,404);assert.equal((await request('/v1/gateway/discovery?private=true')).status,400);
  const runtimeToken=savedToken(),continuationToken=savedToken(),registrationInput={operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken};
  const saved=await f.savePrivate('agent-a-materials.json',{origin,registrationInput});assert.equal((await stat(saved)).mode&0o077,0);
  const registered=await request('/v1/registrations',registrationInput);assert.equal(registered.status,200);assert.equal(registered.body.outcome,'committed');assert.equal(registered.body.managementStatus,'pending_setup');assert.equal(registered.body.gateway.ownerBindingRequired,false);
  const secondRuntime=savedToken(),secondContinuation=savedToken(),secondInput={operationId:randomUUID(),attemptId:randomUUID(),runtimeToken:secondRuntime,continuationToken:secondContinuation};await f.savePrivate('agent-b-materials.json',{origin,registrationInput:secondInput});const second=await request('/v1/registrations',secondInput);assert.equal(second.status,200);assert.notEqual(second.body.agentId,registered.body.agentId);assert.equal(second.body.managementStatus,'pending_setup');assert.equal(await f.legacy.read(tx=>tx.count('bindings',{active:true},10)),0);
  const rules=await request('/v1/gateway/query',envelope('world.rules',{worldId:'default'}),runtimeToken);assert.equal(rules.status,200);
  for(const bad of [['agent-manual'],1,true,null,{purpose:'agent-manual'}]){const rejected=await request('/v1/gateway/query',{...envelope('world.rules',{worldId:'default'}),purpose:bad},runtimeToken);assert.equal(rejected.status,400);}
  const badLimit=await request('/v1/gateway/query',envelope('world.scene',{worldId:'default',limit:'1'}),runtimeToken);assert.equal(badLimit.status,400,'schema validation must not coerce a body field');
  const createInput={worldId:'default',expectedRulesetVersion:rules.body.data.rules.version},commandId=randomUUID(),created=await request('/v1/gateway/commands',envelope('world.avatar.create',createInput,commandId),runtimeToken);assert.equal(created.status,200);assert.equal(created.body.data.outcome,'committed');const avatar=created.body.data.result;
  const secondCreated=await request('/v1/gateway/commands',envelope('world.avatar.create',createInput,randomUUID()),secondRuntime);assert.equal(secondCreated.status,200);assert.equal(secondCreated.body.data.outcome,'committed');
  const firstPublic=await request('/v1/world/scene?worldId=default&limit=1');assert.equal(firstPublic.status,200);assert.equal(firstPublic.body.data.complete,false);assert(firstPublic.body.data.nextCursor);const crossReader=await request('/v1/gateway/query',envelope('world.scene',{worldId:'default',limit:1,cursor:firstPublic.body.data.nextCursor}),runtimeToken);assert.equal(crossReader.status,409);assert.equal(crossReader.body.error.code,'world_cursor_invalid');const nextPublic=await request('/v1/world/scene?worldId=default&limit=1&cursor='+encodeURIComponent(firstPublic.body.data.nextCursor));assert.equal(nextPublic.status,200);assert.equal(nextPublic.body.data.avatars.length,1);assert.notEqual(nextPublic.body.data.avatars[0].agentId,firstPublic.body.data.avatars[0].agentId);
  assert.deepEqual((await request('/v1/gateway/commands',envelope('world.avatar.create',createInput,commandId),runtimeToken)).body.data,created.body.data);
  const receipt=await request('/v1/gateway/receipts/query',{protocolVersion:1,consumerId:'gateway-http-story',purpose:'agent-manual',operation:'world.avatar.create',commandId},runtimeToken);assert.equal(receipt.status,200);assert.deepEqual(receipt.body.data,created.body.data);
  const x=avatar.position.x,y=avatar.position.y,path=[{x:x+1,y},{x:x+2,y}];
  const moved=await request('/v1/gateway/commands',envelope('world.avatar.move',{worldId:'default',expectedVersion:avatar.version,expectedRulesetVersion:rules.body.data.rules.version,expectedTopologyVersion:rules.body.data.rules.topologyVersion,path},randomUUID()),runtimeToken);assert.equal(moved.status,200);assert.equal(moved.body.data.outcome,'committed');assert.equal(moved.body.data.result.state,'pending');assert.equal(moved.body.data.result.nextStep,0);assert.equal(moved.body.data.result.pathLength,2);assert(!('position'in moved.body.data.result));
  const pendingAvatar=await request('/v1/gateway/query',envelope('world.avatar',{worldId:'default'}),runtimeToken);assert.deepEqual(pendingAvatar.body.data.avatar.position,{x,y});
  let publicScene:any,movement:any;const deadline=Date.now()+7000;
  do{await delay(150);publicScene=await request('/v1/world/scene?worldId=default');movement=await request('/v1/gateway/query',envelope('world.movement',{worldId:'default',movementId:moved.body.data.result.movementId}),runtimeToken);assert.equal(publicScene.status,200);assert.equal(movement.status,200);}while(movement.body.data.state!=='completed'&&Date.now()<deadline);
  assert.equal(movement.body.data.state,'completed');assert.equal(movement.body.data.nextStep,2);assert(!JSON.stringify(movement.body.data).includes('"path"'));
  const visible=publicScene.body.data.avatars.find((row:any)=>row.agentId===registered.body.agentId);assert(visible);assert.deepEqual(visible.position,path[1]);assert.equal(visible.profile.agentId,registered.body.agentId);assert(visible.profile.displayName);assert(!JSON.stringify(publicScene.body).includes(runtimeToken));assert(!JSON.stringify(publicScene.body).includes('movementId'));
  const facts=await f.runtime.read(ctx=>ctx.events.list({domain:'world',limit:100}));assert.equal(facts.filter(row=>row.kind==='world.avatar.moved'&&row.source==='rules').length,2);
  const profile=await f.service.invoke('readProfile',{agentId:registered.body.agentId},runtimeToken);await f.service.invoke('unpublishProfile',{operationId:randomUUID(),agentId:registered.body.agentId,expectedVersion:profile.version,expectedPolicyVersion:profile.policyVersion},runtimeToken);
  const hidden=await request('/v1/world/scene?worldId=default');assert.equal(hidden.status,200);assert.equal(hidden.body.data.avatars.length,1);assert.equal(hidden.body.data.avatars[0].agentId,second.body.agentId);
  const targetRead=await request('/v1/gateway/query',envelope('world.avatar',{worldId:'default',agentId:registered.body.agentId}),secondRuntime);assert.equal(targetRead.status,404);
  for(const who of [{name:'a',agentId:registered.body.agentId,continuation:continuationToken},{name:'b',agentId:second.body.agentId,continuation:secondContinuation}]){const handoffToken=savedToken(),input={operationId:randomUUID(),expectedGeneration:0,handoffToken};await f.savePrivate('agent-'+who.name+'-handoff-command.json',input);const issued=await request('/v1/agent/self/handoffs',input,who.continuation);assert.equal(issued.status,200);const managementUrl=new URL('/owner#handoff='+encodeURIComponent(handoffToken),origin).href;assert.equal(new URL(managementUrl).origin,origin);const handoffFile=await f.savePrivate('agent-'+who.name+'-owner-handoff.json',{agentId:who.agentId,managementUrl,expiresAt:issued.body.expiresAt});assert.equal((await stat(handoffFile)).mode&0o077,0);}
 }finally{await app.close();await f.dispose();}
});
test('closed write gate permits build, health, public reads and wallet pure reads without persistent changes',async()=>{
 const f=await gatewayFixture({interaction:false});let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  const actor=await f.register();await f.gate(false);
  const snapshot=()=>f.legacy.read(async tx=>{const result:unknown[]=[];for(const table of M1_TABLES)result.push([table,await tx.find(table,{})]);return result;});
  const before=await snapshot();app=await buildApp({...f.options,email:{mode:'experience'},worldCoreEnabled:true});await app.listen({host:'127.0.0.1',port:18894});
  assert.equal((await request('/health')).status,200);assert.equal((await request('/v1/world/scene?worldId=default')).status,200);assert.equal((await request('/v1/world/rules?worldId=default')).status,200);
  const wallet=await request('/v1/wallet/query',{protocolVersion:1,consumerId:'closed-gate-story',purpose:'agent-inspect'},actor.runtimeToken);assert.equal(wallet.status,200);assert.equal(wallet.body.data.balance,0);
  await delay(1200);assert.deepEqual(await snapshot(),before);assert.equal((await f.runtime.read(ctx=>ctx.events.list({limit:10}))).length,0);assert.equal((await f.runtime.read(ctx=>ctx.tasks.list({limit:10}))).length,0);
  const refused=await request('/v1/gateway/commands',envelope('world.avatar.create',{worldId:'default',expectedRulesetVersion:1},randomUUID()),actor.runtimeToken);assert.equal(refused.status,503);
 }finally{await app?.close();await f.dispose();}
});
