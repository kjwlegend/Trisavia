import test from 'node:test';
import assert from 'node:assert/strict';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import type {WorldRuleset} from '../../apps/platform/domains/world/types.ts';
import type {PlaceProfileCatalog} from '../../apps/platform/domains/world/place-profiles.ts';
import {createWorldPlaceProfilesService} from '../../apps/platform/application/world-place-profiles-service.ts';
import {placeProfileGatewayOperations,placeProfilePublicReads} from '../../apps/platform/application/agent-gateway-place-profiles.ts';
import {M1Error} from '../../apps/platform/domains/common/errors.ts';

const map={mapId:'pixel-town-v2',layoutSha256:'a'.repeat(64),geometryDigest:'b'.repeat(64)};
function source():PlaceProfileCatalog{return {version:1,map,profiles:[
  {profileId:'s-green',placeId:null,targetIds:['s-green'],kind:'building',name:'园丁之家',area:'南侧',description:'用于只读服务测试的场所原文。',ownerNpcId:null,image:{url:'/assets/world-life/test-map.png',sourceWidth:2048,sourceHeight:1536,frame:[480,768,112,128],sourceRef:'source test map'},availabilityNote:'这里暂未开放入内。'},
  {profileId:'life:harbor_tavern',placeId:'harbor_tavern',targetIds:['life:harbor_tavern','harbor_tavern','life-place:harbor_tavern'],kind:'life-place',name:'港湾酒馆',area:'港湾',description:'用于只读服务测试的外场原文。',ownerNpcId:'npc-example-owner',image:{url:'/assets/world-life/test-map.png',sourceWidth:2048,sourceHeight:1536,frame:[1312,624,160,96],sourceRef:'source test map'},availabilityNote:null},
]};}
const context={} as RuntimeReadContext;
const rules=()=>({worldId:'default',mapManifest:{...map,buildings:[{id:'s-green'}]}} as unknown as WorldRuleset);
function fixture(catalog=source()){
  let reads=0;const r=rules();
  const service=createWorldPlaceProfilesService({catalog,assetExists:()=>true,resolveNpcIdentity:id=>id==='npc-example-owner'?{name:'正式姓名'}:undefined,world:{async readPublicRules(ctx,worldId){assert.equal(ctx,context);assert.equal(worldId,'default');reads++;return{rules:r,asOf:1234};}}});
  return {service,r,reads:()=>reads};
}
test('human and Agent descriptors read the same World place source without writes or provider-based ownership',async()=>{
  const f=fixture(),operation=placeProfileGatewayOperations(f.service).find(o=>o.id==='world.place_profile')!,publicRead=placeProfilePublicReads(f.service).find(o=>o.id==='world.public_place_profile')!;
  assert.equal(operation.kind,'query');
  const publicValue=await publicRead.read(context,{targetId:'s-green'}),agentValue=await f.service.query(context,{kind:'agent',agentId:'source-fixture-agent'} as any,'world.place_profile',{targetId:'s-green'});
  assert.deepEqual(publicValue,agentValue);assert.equal((publicValue.profile as any).owner,null);assert.equal((publicValue.profile as any).ownerNpcId,null);
  const aliased=await f.service.query(context,null,'world.place_profile',{targetId:'life-place:harbor_tavern'});
  assert.deepEqual((aliased.profile as any).owner,{npcId:'npc-example-owner',name:'正式姓名'});assert.equal((aliased.profile as any).placeId,'harbor_tavern');assert.equal(f.reads(),3);
  (aliased.profile as any).description='mutated transport copy';
  assert.equal(((await f.service.query(context,null,'world.place_profiles',{})).profiles as any[])[1].description,source().profiles[1]!.description);
});
test('missing identities omit resolved ownership; unknown IDs and a changed map fail closed',async()=>{
  const catalog=source();catalog.profiles[1]!.ownerNpcId='npc-unresolved';const f=fixture(catalog);
  assert.equal(((await f.service.query(context,null,'world.place_profile',{targetId:'harbor_tavern'})).profile as any).owner,null);
  await assert.rejects(f.service.query(context,null,'world.place_profile',{targetId:'not-on-this-map'}),e=>e instanceof M1Error&&e.code==='place_profile_not_found');
  f.r.mapManifest!.geometryDigest='c'.repeat(64);
  await assert.rejects(f.service.query(context,null,'world.place_profiles',{}),e=>e instanceof M1Error&&e.code==='place_profiles_unavailable');
});
test('assembly rejects missing assets, unbounded image frames and duplicate click aliases',()=>{
  const world={async readPublicRules(){return{rules:rules(),asOf:1};}};
  assert.throws(()=>createWorldPlaceProfilesService({world,catalog:source(),assetExists:()=>false}),/asset_missing/);
  const bad=source();bad.profiles[0]!.image.frame=[2040,0,20,20];assert.throws(()=>fixture(bad),/image_invalid/);
  const repeated=source();repeated.profiles[1]!.targetIds.push('s-green');assert.throws(()=>fixture(repeated),/target_invalid/);
});
test('a removed source asset fails the read rather than returning an invented or broken picture',async()=>{
  let available=true;
  const service=createWorldPlaceProfilesService({catalog:source(),assetExists:()=>available,world:{async readPublicRules(){return{rules:rules(),asOf:1};}}});
  available=false;
  for(const [operation,input]of [['world.place_profile',{targetId:'s-green'}],['world.place_profiles',{}]] as const)await assert.rejects(service.query(context,null,operation,input),e=>e instanceof M1Error&&e.code==='place_profile_image_unavailable');
});
