import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {shanghaiTime,daylightAt,createSceneClock} from '../../apps/web/public/hud/world-time.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {sceneStatus} from '../../apps/web/public/hud/world-status.js';
const stamp=(time:string)=>Date.parse('2026-10-22T'+time+'+08:00');
test('Shanghai dates roll over and day/dusk/night use the exact 06/17/19 boundaries',()=>{
 for(const [time,period]of [['05:59:59','night'],['06:00:00','day'],['16:59:59','day'],['17:00:00','dusk'],['18:59:59','dusk'],['19:00:00','night']])assert.equal(shanghaiTime(stamp(time!)).period,period);
 assert.equal(shanghaiTime(stamp('23:59:59')+1000).text,'2026-10-23 00:00:00');
});
test('map light blends continuously within fifteen minutes of each boundary; reduced motion uses the correct static state',()=>{
 for(const time of ['06:00:00','17:00:00','19:00:00']){const before=daylightAt(stamp(time)-1),after=daylightAt(stamp(time)+1);assert.ok(Math.abs(before.opacity-after.opacity)<.00001);assert.ok(Math.abs(before.lamps-after.lamps)<.00001);}
 assert.equal(daylightAt(stamp('10:00:00')).opacity,0);assert.equal(daylightAt(stamp('18:00:00')).opacity,.12);assert.equal(daylightAt(stamp('23:00:00')).opacity,.70);
 assert.equal(daylightAt(stamp('06:00:00'),{reducedMotion:true}).opacity,0);assert.equal(daylightAt(stamp('17:00:00'),{reducedMotion:true}).opacity,.12);assert.equal(daylightAt(stamp('19:00:00'),{reducedMotion:true}).opacity,.70);
});
test('server-calibrated clock advances with monotonic time, ignores wall-clock changes, and slews ordinary later samples',()=>{
 let mono=0,wall=1000;const clock=createSceneClock({now:()=>mono,wallNow:()=>wall}),epoch=stamp('18:42:08');assert.equal(clock.now(),1000);assert.equal(clock.source,'local');assert.equal(clock.calibrate(epoch,'instance','serverTime'),true);
 mono+=1000;wall+=99_000_000;assert.equal(clock.now(),epoch+1000);assert.equal(clock.calibrate(epoch+1100,'instance'),false);mono+=1000;assert.equal(clock.now(),epoch+2000);
 assert.equal(clock.calibrate(epoch+1000,'instance'),false);mono+=1000;assert.equal(clock.now(),epoch+2950);assert.equal(clock.calibrate(epoch+60_000,'instance'),true);assert.equal(clock.now(),epoch+60_000);
});
test('HUD uses authoritative scene count/place, labels retained facts, and never treats an unread collection as zero',()=>{
 const ready={phase:'ready',complete:true,avatars:[{agentId:'a',placeId:'commons'}],rules:{places:[{id:'commons',access:'members'}]}};
 assert.equal(sceneStatus(ready,'a').location,'角色所在：公共庭');assert.equal(sceneStatus({...ready,avatars:[]}).location,'当前场景：公共庭');assert.equal(sceneStatus({...ready,avatars:[]}).count,'公开角色：0');
 assert.equal(sceneStatus({...ready,phase:'refreshing'}).count,'公开角色：1');assert.equal(sceneStatus({...ready,phase:'recovering'}).count,'上次画面（已过期）：1');assert.equal(sceneStatus({phase:'loading',complete:false,avatars:[]}).count,'公开角色：—');assert.equal(sceneStatus({phase:'loading',complete:false,avatars:[]}).location,'场景待确认');
});
