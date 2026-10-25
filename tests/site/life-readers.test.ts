import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeState,lifeActivity} from '../fixtures/life-ui.ts';
import {lifeBUiFixture as lifeUiFixture} from '../fixtures/life-b-ui.ts';
// @ts-expect-error Browser DTO adapter is plain JavaScript.
import {readLifeActions,readLifeOptions,readLifeState} from '../../apps/web/public/hud/life-readers.js';
test('life catalog and live conditions share the exact map and keep unknown values distinct from zero',async()=>{
 const f=await lifeUiFixture(),catalog=readLifeActions(f.catalog,f.rules);assert.equal(catalog.data.actions.length,7);const action=catalog.data.actions[0],option=f.options('own-life-agent-a',action);assert.equal(readLifeOptions(option,'own-life-agent-a',action).data.capacity.available,3);assert.throws(()=>readLifeActions(f.catalog,{...f.rules,mapManifest:{...f.rules.mapManifest,geometryDigest:'wrong'}}));assert.throws(()=>readLifeOptions({...option,data:{...option.data,capacity:{total:4,occupied:1}}},'own-life-agent-a',action));assert.throws(()=>readLifeOptions(option,'own-life-agent-b',action));
});
test('private life projection preserves real results while excluding internal authority and routes',()=>{
 const raw=lifeState();const value=readLifeState({...raw,data:{...raw.data,qualification:'private',route:[{x:0,y:0}],ownerAudience:'private'}},'own-life-agent-a');assert.equal(value.data.recentResults[0].result.coinReward,36);assert.equal(value.data.energy.available,76);assert.doesNotMatch(JSON.stringify(value),/qualification|ownerAudience|route/u);assert.throws(()=>readLifeState(raw,'own-life-agent-b'));const active=lifeState('own-life-agent-a',{body:{activity:lifeActivity('own-active','active'),plan:null},recentResults:[]});assert.equal(readLifeState(active,'own-life-agent-a').data.body.activity.result,null);assert.throws(()=>readLifeState(lifeState('own-life-agent-a',{energy:{current:76,reserved:24,available:76,max:100}}),'own-life-agent-a'));
});
test('legacy voucher is read-only state and virtual inn quota never becomes invented physical seats',async()=>{
 const legacy={...lifeActivity(),actionId:'rest.voucher',jobId:null,placeId:'stone_inn',placeName:'石桥旅舍',stationId:'stone_inn-legacy-rest',result:{...lifeActivity().result,energyBefore:30,energyAfter:100,energySpent:0,energyRestored:70,coinReward:0}};
 assert.equal(readLifeState(lifeState('own-life-agent-a',{recentResults:[legacy]}),'own-life-agent-a').data.recentResults[0].actionId,'rest.voucher');
 const f=await lifeUiFixture(),station={id:'stone_inn-legacy-rest',physical:false,actionIds:['rest.voucher'],capacity:4,cells:[{x:28,y:9}]},place={...f.catalog.data.places[0],placeId:'stone_inn',name:'石桥旅舍',stations:[station]};
 const raw={...f.catalog,data:{...f.catalog.data,places:[...f.catalog.data.places,place]}};assert.equal(readLifeActions(raw,f.rules).data.actions.length,7);
 assert.throws(()=>readLifeActions({...raw,data:{...raw.data,places:[...f.catalog.data.places,{...place,stations:[{...station,id:'invented-beds'}]}]}},f.rules));
 assert.throws(()=>readLifeActions({...raw,data:{...raw.data,spatialManifestRef:{...raw.data.spatialManifestRef,sha256:'0'.repeat(64)}}},f.rules));
});
