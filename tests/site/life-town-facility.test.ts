import test from 'node:test';import assert from 'node:assert/strict';
import {lifeUiFixture,lifeEnvelope,lifeAsOf,lifeLayoutSha} from '../fixtures/life-ui.ts';
// @ts-expect-error Browser adapter is plain JavaScript.
import {readTownService} from '../../apps/web/public/hud/town-services.js';
test('legacy service separates fixed facility arrival from the real moving NPC without assuming provider presence',async()=>{
 const f=await lifeUiFixture(),npc={npcId:'npc-tavern-keeper',name:'酒馆老板',role:'招待',definitionVersion:1,version:2,actorKind:'npc',buildingId:'h-tavern',position:{x:47,y:13},approachCells:[{x:47,y:12}],appearance:{lookId:'sunnyside-human-curlyhair',catalogVersion:'2026-10-21.appearance-v1.1'},serverManaged:true,countsAsAgent:false,readOnly:false,status:'available',serviceIds:['tavern.host'],actions:['town_services.tavern.host'],motion:null,motionVersion:null,activity:null,providerPresent:false,nextCheckAt:lifeAsOf+1000};
 const facility={kind:'facility',position:{x:53,y:12},approachCells:[{x:53,y:13}],providerRequired:true,providerPresent:false,nextCheckAt:lifeAsOf+1000};
 const raw=lifeEnvelope({catalogVersion:1,map:{...f.catalog.data.map,layoutSha256:lifeLayoutSha},npc,facility,service:{serviceId:'tavern.host',npcId:npc.npcId,name:'酒馆招待',description:'实际服务',action:'town_services.tavern.host',durationMs:0,itemCost:'tavern_voucher',topics:[{id:'town',label:'小镇'}]},asOf:lifeAsOf});
 const value=readTownService(raw,'tavern.host');assert.deepEqual(value.facility.position,{x:53,y:12});assert.deepEqual(value.npc.position,{x:47,y:13});assert.equal(value.facility.providerPresent,false);
 assert.throws(()=>readTownService({...raw,data:{...raw.data,facility:{...facility,providerPresent:'available'}}},'tavern.host'));
});
