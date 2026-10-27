import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {key} from '../../apps/platform/domains/perception/protocol.ts';
import {QUOTE_COMMUNICATION_GUIDE,quoteWorldGuide} from '../../apps/platform/application/agent-quote-communication-guide.ts';
import {runtimeWorldGuide} from '../../apps/platform/application/agent-runtime-publication.ts';
import {worldExpressionGuide} from '../../apps/platform/application/agent-gateway-world-expressions.ts';
import {readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {worldGatewayOperations} from '../../apps/platform/application/agent-gateway-world.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerAgentRuntimeRoute} from '../../apps/platform/transport/http/agent-runtime-routes.ts';
import {coreFixture} from '../world/runtime-fixture.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

test('retained quote World20 and World19/18 keep exact bytes as runtime rules advance',async()=>{
 const f=coreFixture(),world=createWorldService(f.identity),operations=worldGatewayOperations(world),old=createAgentGateway({store:f.store,identity:f.identity,operations,guides:[runtimeWorldGuide],retainedGuides:[worldExpressionGuide],runtimeGuide:readAgentRuntimeGuide}),gateway=createAgentGateway({store:f.store,identity:f.identity,operations,guides:[quoteWorldGuide],retainedGuides:[runtimeWorldGuide,worldExpressionGuide],runtimeGuide:readAgentRuntimeGuide}),app=Fastify();
 registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now});registerAgentRuntimeRoute(app,readAgentRuntimeGuide,f.context.instanceId);
 try{
  const snapshot=await readAgentRuntimeGuide(),raw=await app.inject('/agent/runtime.md');assert(snapshot.ruleVersion>=2);assert.equal(raw.statusCode,200);assert.equal(raw.body,snapshot.text);assert.equal(raw.headers['cache-control'],'no-store');assert.equal(raw.headers['x-instance-id'],f.context.instanceId);assert(String((quoteWorldGuide.document.humanCommunication as JsonObject).instruction).includes(QUOTE_COMMUNICATION_GUIDE));
  const exact=async(version:number)=>{const response=await app.inject(`/v1/gateway/guides/world?version=${version}`);assert.equal(response.statusCode,200);const result=response.json().data;assert.deepEqual(JSON.parse(result.canonicalDocument),result.document);assert.equal(result.digest,key(result.document));return result;};
  for(const version of [18,19]){const retained=await exact(version),prior=old.guide('world',String(version));assert.equal(retained.canonicalDocument,prior.canonicalDocument);assert.equal(retained.digest,prior.digest);assert.deepEqual(retained.document,prior.document);}
  assert.equal(key(runtimeWorldGuide.document),'9c069d7b318d380c07310b4f036298e36f2700821a83481569cc45498d19a7c3');
  const current=await exact(20),discovery=(await app.inject('/v1/gateway/discovery')).json().data,cap=await gateway.currentCapabilities();
  assert.deepEqual(current.runtimeRules,discovery.runtimeRules);assert.deepEqual((cap as unknown as JsonObject).runtimeRules,discovery.runtimeRules);assert.equal(current.runtimeRules.digest,snapshot.digest);assert.equal(discovery.catalogRevision,cap.catalogRevision);
  assert(discovery.operations.every((operation:any)=>operation.usageGuide.version===20));
  const machine=(list:any[])=>list.map(({usageGuide,...operation})=>operation);assert.deepEqual(machine(discovery.operations),machine(old.discovery().operations));assert.notEqual(discovery.catalogRevision,(await old.currentDiscovery()).catalogRevision);
  const newHuman=current.document.humanCommunication;assert.equal(newHuman.instruction,(runtimeWorldGuide.document.humanCommunication as JsonObject).instruction+'\n\n'+QUOTE_COMMUNICATION_GUIDE);
  const before={...runtimeWorldGuide.document},after={...current.document};delete before.version;delete after.version;delete before.humanCommunication;delete after.humanCommunication;assert.deepEqual(after,before);
 }finally{await app.close();}
});
