import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {withAutonomousLifeOperations,withAutonomousLifeReads,retainedLifeActionSchemas} from '../../apps/platform/application/agent-gateway-autonomous-life.ts';
import {autonomousLifeGuide} from '../../apps/platform/application/agent-autonomous-life-guide.ts';
import {lifeCGatewayOperations,lifeCPublicReads,lifeCGatewayGuide} from '../../apps/platform/application/agent-gateway-life-c.ts';
import {coreFixture} from '../world/runtime-fixture.ts';
import {lifeCUiFixture} from '../fixtures/life-c-ui.ts';
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
