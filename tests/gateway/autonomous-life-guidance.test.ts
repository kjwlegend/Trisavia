import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {withAutonomousLifeOperations,withAutonomousLifeReads,retainedLifeActionSchemas} from '../../apps/platform/application/agent-gateway-autonomous-life.ts';
import {autonomousLifeGuide} from '../../apps/platform/application/agent-autonomous-life-guide.ts';
import {lifeCGatewayOperations,lifeCPublicReads,lifeCGatewayGuide} from '../../apps/platform/application/agent-gateway-life-c.ts';
import {coreFixture} from '../world/runtime-fixture.ts';
import {lifeCUiFixture} from '../fixtures/life-c-ui.ts';
import Fastify from 'fastify';
import {autonomousWorldGuide} from '../../apps/platform/application/agent-autonomous-life-guide.ts';
import {quoteWorldGuide} from '../../apps/platform/application/agent-quote-communication-guide.ts';
import {runtimeWorldGuide} from '../../apps/platform/application/agent-runtime-publication.ts';
import {worldExpressionGuide} from '../../apps/platform/application/agent-gateway-world-expressions.ts';
import {worldGatewayOperations,worldGatewayLegacyOperations} from '../../apps/platform/application/agent-gateway-world.ts';
import {gatewayOperationSchemas} from '../../apps/platform/application/agent-gateway.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {registerAgentRuntimeRoute} from '../../apps/platform/transport/http/agent-runtime-routes.ts';
import {CURRENT_MOVEMENT_POLICY} from '../../apps/platform/domains/world/movement-policy.ts';
import {CURRENT_IDLE_LIFE_POLICY} from '../../apps/platform/domains/world/idle-life.ts';
import {CURRENT_EXPRESSION_POLICY} from '../../apps/platform/domains/world/expression-current-policy.ts';
// @ts-expect-error Browser DTO reader, no HTTP request or authenticated session.
import {readLifeActions} from '../../apps/web/public/hud/life-readers.js';
// @ts-expect-error Pure browser intent generator.
import {buildLifeBIntent} from '../../apps/web/public/hud/life-b-intent.js';
// @ts-expect-error Pure browser intent generator.
import {buildLifeCIntent} from '../../apps/web/public/hud/life-c-contract.js';
// @ts-expect-error Browser strict read-only request adapter.
import {lifeReadInput} from '../../apps/web/public/hud/life-owner-input.js';

test('current Life read4 preserves actual source and frozen schema3 while advertising guide4',async()=>{
 const f=coreFixture(),sample=await lifeCUiFixture(),before=structuredClone(sample.catalog.data);let calls=0;
 const life={query:async(ctx:any,_p:any,id:string)=>{assert.equal(ctx,f.context);assert.equal(id,'life.actions');calls++;return sample.catalog.data;}} as any;
 const originalOps=lifeCGatewayOperations(life).filter(o=>o.id==='life.actions'),originalReads=lifeCPublicReads(life).filter(o=>o.id==='life.public_actions'),ops=withAutonomousLifeOperations(originalOps),reads=withAutonomousLifeReads(originalReads),schemas=retainedLifeActionSchemas(originalOps,originalReads);
 const gateway=createAgentGateway({store:f.store,identity:f.identity,operations:ops,publicReads:reads,guides:[autonomousLifeGuide],retainedGuides:[lifeCGatewayGuide],retainedSchemas:schemas});
 // Captured from exact 6a8f8bd baseline Gateway registration, not regenerated expected output.
 const oldDigests={'life.actions.input':'cd91f953b9c6cdc40c507a42cb056a6b371ec9f004673fe553ed686989993bcc','life.actions.output':'d422923fd387f2086e10d8ae41471f28a4af775e53d2e2d52c7b2504705c1ee2','life.public_actions.input':'251807061b7fa411bd9af77089c3cbb4f65ec253aa21f87e86e1d3097195b034','life.public_actions.output':'fc9fa8bc6de6e9b2c352f57e8bbe5e7c1483f31713b229e0682d51922befef7c'};
 for(const[id,digest]of Object.entries(oldDigests)){assert.equal(gateway.schema(id,'3').digest,digest);assert.equal(gateway.schema(id,'4').version,4);assert.throws(()=>gateway.schema(id,'5'),{code:'schema_version_not_available'});}
 const current=await reads[0]!.read(f.context,{});assert.equal(calls,1);assert.deepEqual(sample.catalog.data,before);assert((current.actions as any[]).every(a=>a.guideRef.version===4));
 assert.equal(readLifeActions({...sample.catalog,data:current},sample.rules).data.actions[0].guideRef.version,4);assert.equal(readLifeActions(sample.catalog,sample.rules).data.actions[0].guideRef.version,3);
 const bad=structuredClone(current);(bad.actions as any[])[0].guideRef.version=5;assert.throws(()=>readLifeActions({...sample.catalog,data:bad},sample.rules));
 assert(gateway.discovery().operations.every(o=>o.usageGuide.version===4&&o.inputSchema.version===4&&o.outputSchema.version===4));assert.deepEqual(ops[0]!.actors,originalOps[0]!.actors);assert.equal(ops[0]!.input,originalOps[0]!.input);
 assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations:ops,publicReads:reads,guides:[autonomousLifeGuide],retainedSchemas:[schemas[0]!,schemas[0]!]}),/Invalid retained/);
 assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations:ops,publicReads:reads,guides:[autonomousLifeGuide],retainedSchemas:[{...schemas[0]!,id:'unknown.input'}]}),/Invalid retained/);
});

test('default B/C intents refresh technical conditions without inventing commands or expanding selected goal bounds',()=>{
 const input={itemId:'basic_rod',quantity:1,quoteRef:'old-ephemeral-quote',maxTotalPrice:30},original=structuredClone(input),buy=buildLifeBIntent({origin:'https://own.invalid',agentLabel:'本人 · A901',description:'买一根鱼竿',placeId:'fisher_shop',actionId:'shop.buy',params:input,maxSpend:30});
 assert.deepEqual(input,original);assert(!buy.includes('old-ephemeral-quote'));assert(buy.includes('"quantity":1'));assert(buy.includes('"maxTotalPrice":30'));assert(buy.includes('星币支出最多 30'));assert(buy.includes('/agent/runtime.md'));assert(buy.includes('未知先查原回执'));assert(!buy.includes('变化时先停止并告诉我'));assert(!buy.includes('不购买其他东西'));
 const meal=buildLifeCIntent({origin:'https://own.invalid',agentLabel:'本人 · A901',description:'吃本人这份餐食',input:{expectedCatalogRevision:3,actionId:'meal.eat',placeId:'harbor_tavern',params:{itemInstanceId:'own-selected-meal',maxSpend:0}},maxSpend:0,consume:{bread_meal:1}});assert(meal.includes('own-selected-meal'));assert(meal.includes('"bread_meal":1'));
 const gift=buildLifeCIntent({origin:'https://own.invalid',agentLabel:'本人 · A901',description:'接受本人这份礼物',operation:'relationships.gifts.respond',input:{giftId:'own-gift',expectedVersion:1,decision:'accept'}});assert(gift.includes('只处理这一份已选礼物'));assert(gift.includes('不新建身体活动'));
 assert.throws(()=>buildLifeBIntent({origin:'https://own.invalid',description:'买竿',actionId:'shop.buy',placeId:'fisher_shop',params:{...input,password:'secret'},maxSpend:30}));
 assert.throws(()=>buildLifeBIntent({origin:'https://own.invalid',description:'买竿',actionId:'shop.buy',placeId:'fisher_shop',params:input,maxSpend:-1}));
 assert.throws(()=>lifeReadInput('activities.start',{},'own-agent'));assert.throws(()=>lifeReadInput('options',{actionId:'shop.buy',placeId:'fisher_shop',params:{itemId:'basic_rod',quantity:1,maxTotalPrice:30}},'own-agent'));
});

test('current World21 uses current policy exports and fixed rule3 while exact World20/19/18 and movement2 stay readable',async()=>{
 const f=coreFixture(),world=createWorldService(f.identity),ops=worldGatewayOperations(world),legacy=worldGatewayLegacyOperations(world).filter(o=>['world.movement','world.avatar.create','world.avatar.move','world.avatar.leave','world.movement.stop'].includes(o.id)),retained=legacy.flatMap(gatewayOperationSchemas),gateway=createAgentGateway({store:f.store,identity:f.identity,operations:ops,guides:[autonomousWorldGuide],retainedGuides:[quoteWorldGuide,runtimeWorldGuide,worldExpressionGuide],retainedSchemas:retained,runtimeGuide:readAgentRuntimeGuide}),app=Fastify();
 registerAgentGatewayRoutes(app,gateway,{instanceId:f.context.instanceId,now:()=>f.now});registerAgentRuntimeRoute(app,readAgentRuntimeGuide,f.context.instanceId);
 try{
  const current=(await app.inject('/v1/gateway/guides/world?version=21')).json().data,discovery=(await app.inject('/v1/gateway/discovery')).json().data,raw=await app.inject('/agent/runtime.md');assert.equal(current.runtimeRules.ruleVersion,3);assert.equal(current.runtimeRules.digest,discovery.runtimeRules.digest);assert.equal(raw.body,(await readAgentRuntimeGuide()).text);assert.equal(raw.headers['cache-control'],'no-store');
  assert.deepEqual(current.document.expressionPolicy,CURRENT_EXPRESSION_POLICY);assert.equal(current.document.worldRuleAdvancement.policyVersion,CURRENT_MOVEMENT_POLICY.version);assert.equal(current.document.worldRuleAdvancement.stepIntervalMs,CURRENT_MOVEMENT_POLICY.stepIntervalMs);assert.deepEqual(current.document.worldRuleAdvancement.idleLife,CURRENT_IDLE_LIFE_POLICY);
  for(const g of [quoteWorldGuide,runtimeWorldGuide,worldExpressionGuide]){const response=(await app.inject(`/v1/gateway/guides/world?version=${g.version}`)).json().data;assert.equal(response.canonicalDocument,gateway.guide('world',String(g.version)).canonicalDocument);assert.deepEqual(response.document,g.document);}
  assert.equal(gateway.guide('world','20').digest,'5d616eb629817ccb99841e0fafb68e1f45adf7588c76ae095e07c53acdac94c6');assert.equal(gateway.guide('world','19').digest,'9c069d7b318d380c07310b4f036298e36f2700821a83481569cc45498d19a7c3');
  for(const row of retained){assert.deepEqual(gateway.schema(row.id,'2').document,row.document);assert.equal(gateway.schema(row.id,'3').version,3);}
  assert(discovery.operations.every((operation:any)=>operation.usageGuide.version===21));
 }finally{await app.close();}
});
