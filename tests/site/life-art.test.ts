import test from 'node:test';import assert from 'node:assert/strict';
// @ts-expect-error Browser art recipe is plain JavaScript.
import {drawLifeHuman,lifeSortOffset,fadeGardenBuilding} from '../../apps/web/public/world-pixel/life-art.js';
const look={lookId:'sunnyside-human-longhair',catalogVersion:'2026-10-21.appearance-v1.1'};
const actor=(actionId='work.shift',placeId='harbor_work')=>({x:100,y:100,walking:false,facing:'right',fact:{id:'own-art-fixture',position:{x:-21,y:28},activity:{state:'active',actionId,placeId,startedAt:0},profile:{appearance:look}}});
const ctx=()=>{const draws:any[]=[];return{draws,save(){},restore(){},translate(){},scale(){},drawImage(...args:any[]){draws.push(args);}};};
const imageKeys=['human-base-doing','human-longhair-doing','crate','tray','bench-back','bench-front','seated-legs'],images=new Map(imageKeys.map(id=>[id,{id}])),pixel={images:new Map([['human_base_idle',{id:'base-idle'}],['human_longhair_idle',{id:'hair-idle'}]])};
test('six work keyframes freeze offline, recover on fresh facts and honor reduced motion without changing authority',()=>{
 const entry=actor(),c=ctx(),before=structuredClone(entry.fact),frame=(time:number,stale=false,reducedMotion=false)=>({serverTime:time,stale,reducedMotion,paused:false});
 for(const [i,expected]of [0,1,2,4,5,7].entries()){c.draws.length=0;drawLifeHuman(c,entry,frame(i*180),pixel,{images});assert.equal(c.draws[0][1],expected*96);}
 c.draws.length=0;drawLifeHuman(c,entry,frame(600000,true),pixel,{images});assert.equal(c.draws[0][1],7*96);assert.deepEqual(entry.fact,before);
 c.draws.length=0;drawLifeHuman(c,entry,frame(1080),pixel,{images});assert.equal(c.draws[0][1],0);drawLifeHuman(c,entry,frame(1260,false,true),pixel,{images});assert.equal(c.draws.at(-3)[1],0);
});
test('bench uses the approved composite and only actual right-column occupancy or garden selection fades the lodge',()=>{
 const entry=actor('rest.bench','garden_bench'),c=ctx();assert.equal(drawLifeHuman(c,entry,{serverTime:0,reducedMotion:true},pixel,{images}),true);assert.deepEqual(c.draws.map(row=>row[0].id),['bench-back','bench-front','base-idle','hair-idle','seated-legs']);assert.equal(c.draws[2][4],36);assert.equal(lifeSortOffset(entry),5);assert.equal(fadeGardenBuilding({selectedBuildingId:'g-pavilion',avatars:[]},[]),true);assert.equal(fadeGardenBuilding({selectedBuildingId:null,avatars:[entry]},[]),true);assert.equal(fadeGardenBuilding({selectedBuildingId:null,avatars:[]},[]),false);entry.walking=true;assert.equal(drawLifeHuman(c,entry,{serverTime:0},pixel,{images}),false);assert.equal(lifeSortOffset(entry),0);
});
