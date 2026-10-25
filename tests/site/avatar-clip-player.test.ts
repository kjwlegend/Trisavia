import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser presentation module.
import {createClipPlayer} from '../../apps/web/public/world-pixel/clip-player.js';
test('the same immutable resource/action keeps its phase through repeated projections and direction changes',()=>{
 const player=createClipPlayer(),clip={resourceKey:'owned-resource:v1:sha',action:'walk',frameCount:8,fps:8};
 assert.equal(player.sample({...clip,time:1000}),0);
 assert.equal(player.sample({...structuredClone(clip),time:1375}),3);
 assert.equal(player.sample({...structuredClone(clip),time:1500}),4);
 assert.equal(player.sample({...clip,resourceKey:'owned-resource:v2:other-sha',time:1501}),0);
 assert.equal(player.sample({...clip,action:'idle',time:1502}),0);
});
test('stale or paused rendering freezes its phase and resumes without extrapolating offline elapsed time',()=>{
 const player=createClipPlayer(),clip={resourceKey:'owned-resource:v1:sha',action:'walk',frameCount:8,fps:8};
 assert.equal(player.sample({...clip,time:1000}),0);
 assert.equal(player.sample({...clip,time:1375}),3);
 assert.equal(player.sample({...clip,time:1400,paused:true}),3);
 assert.equal(player.sample({...clip,time:12000,paused:true}),3);
 assert.equal(player.sample({...clip,time:13000}),3);
 assert.equal(player.sample({...clip,time:13125}),4);
 assert.equal(player.sample({...clip,time:13250,reducedMotion:true}),0);
});
test('actor clocks are independent and malformed clips fail without inventing frames',()=>{
 const one=createClipPlayer(),two=createClipPlayer(),clip={resourceKey:'owned-resource:v1:sha',action:'idle',frameCount:4,fps:8};
 one.sample({...clip,time:0});two.sample({...clip,time:1000});assert.equal(one.sample({...clip,time:375}),3);assert.equal(two.sample({...clip,time:1125}),1);
 assert.throws(()=>one.sample({...clip,frameCount:0,time:500}),/avatar_clip_invalid/);assert.throws(()=>one.sample({...clip,fps:0,time:500}),/avatar_clip_invalid/);
});
