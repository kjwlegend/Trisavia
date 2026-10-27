import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module.
import {readPlaceProfile,placeProfileTargetId} from '../../apps/web/public/hud/place-profile-card.js';
const map={mapId:'pixel-town-v2',layoutSha256:'a'.repeat(64),geometryDigest:'b'.repeat(64)};
const envelope=()=>({protocolVersion:1,instanceId:'own-source-fixture',data:{worldId:'default',version:1,map,asOf:1234,profile:{placeId:'s-green',targetIds:['s-green'],kind:'building',name:'园丁之家',area:'南侧',description:'源页面测试用文字。',ownerNpcId:null,owner:null,image:{url:'/assets/world-life/test-map.png',sourceWidth:2048,sourceHeight:1536,frame:[480,768,112,128],sourceRef:'source fixture exact frame'},availabilityNote:'这里暂未开放入内。'}}});
test('reader keeps the exact image frame and nullable ownership, tied to the active map',()=>{
  const raw=envelope(),value=readPlaceProfile(raw,'s-green',{mapManifest:map});assert.deepEqual(value.data.profile.image,raw.data.profile.image);assert.equal(value.data.profile.owner,null);
  assert.throws(()=>readPlaceProfile(raw,'different-place',{mapManifest:map}));assert.throws(()=>readPlaceProfile(raw,'s-green',{mapManifest:{...map,geometryDigest:'c'.repeat(64)}}));
  const bad=envelope();bad.data.profile.image.url='https://example.com/stock.png';assert.throws(()=>readPlaceProfile(bad,'s-green'));
  const wrongOwner:any=envelope();wrongOwner.data.profile.owner={npcId:'npc-nearby',name:'旁边的 NPC'};assert.throws(()=>readPlaceProfile(wrongOwner,'s-green'));
});
test('place target resolution preserves existing IDs and does not turn a person/provider into property',()=>{
  assert.equal(placeProfileTargetId({kind:'world-place',id:'s-green',serviceNpc:{npcId:'npc-gardener'}}),'s-green');
  assert.equal(placeProfileTargetId({kind:'life-place',id:'life-place:harbor_work',placeId:'harbor_work'}),'harbor_work');
  assert.equal(placeProfileTargetId({kind:'world-region',id:'region:east-street'}),'region:east-street');
  assert.equal(placeProfileTargetId({kind:'world-npc',id:'npc-gardener',buildingId:'s-green'}),null);
  assert.equal(placeProfileTargetId({kind:'world-avatar',id:'agent-1',buildingId:'s-green'}),null);
});
