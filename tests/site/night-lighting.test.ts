import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// @ts-expect-error Browser lighting is plain JavaScript.
import {createNightLighting} from '../../apps/web/public/world-pixel/night-lighting.js';
test('approved lights are unique, retain seven actual old anchors and change no layout bytes',async()=>{
 const bytes=await readFile('apps/web/public/world-life/night-lights.json'),lights=JSON.parse(bytes.toString()),layoutBytes=await readFile('apps/web/public/world-map-life-v1.json'),layout=JSON.parse(layoutBytes.toString());assert.equal(createHash('sha256').update(bytes).digest('hex'),'09b5d73fc406a2bcb4f6b31ac060e0c4703db5d11255101f47334bdacdddeb7b');assert.equal(createHash('sha256').update(layoutBytes).digest('hex'),lights.layoutSha256);assert.equal(lights.lights.length,26);assert.equal(new Set(lights.lights.map((l:any)=>l.id)).size,26);for(const light of lights.lights.filter((l:any)=>l.kind==='existing-street'))assert(layout.props.some((p:any)=>p.id===light.sourcePropId&&JSON.stringify(p.groundAnchor)===JSON.stringify(light.groundAnchor)));assert.equal(lights.lights.filter((l:any)=>l.kind==='existing-street').length,7);
});
test('two bounded caches build once; repeated draw, zoom or reduced-motion frames do no gradients or readback',()=>{
 const canvases:any[]=[],count={gradients:0,readbacks:0,images:0,maskMinimum:0};
 const context=()=>({save(){},restore(){},fillRect(){},createRadialGradient(){count.gradients++;return{addColorStop(){}};},getImageData(){count.readbacks++;return{data:new Uint8ClampedArray(768*576*4)};},putImageData(pixels:any){count.maskMinimum=Math.min(...pixels.data.filter((_v:number,i:number)=>i%4===3).subarray(0,100));},drawImage(){count.images++;}});
 const night=createNightLighting({makeCanvas:()=>{const canvas={width:0,height:0,getContext:()=>context()};canvases.push(canvas);return canvas;}}),ctx=context();night.draw(ctx,0);assert.equal(canvases.length,0);
 night.draw(ctx,1,{left:0,right:1536,top:0,bottom:1152});assert.equal(canvases.length,2);assert.equal(canvases.reduce((n,c)=>n+c.width*c.height*4,0),3538944);assert.equal(count.images,2);assert.equal(count.gradients,52);assert.equal(count.readbacks,1);assert.equal(count.maskMinimum,51);
 for(let i=0;i<20;i++)night.draw(ctx,i%2?1:.5,{left:-100,right:1700,top:-100,bottom:1300});assert.equal(canvases.length,2);assert.equal(count.images,42);assert.equal(count.gradients,52);assert.equal(count.readbacks,1);night.dispose();assert(canvases.every(c=>c.width===0&&c.height===0));night.draw(ctx,1);assert.equal(count.images,42);
});
