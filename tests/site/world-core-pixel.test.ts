import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {PIXEL_MAP,pixelPoint,assertPixelRules} from '../../apps/web/public/world-pixel/map.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {pixelFitScale,nextPixelScale} from '../../apps/web/public/world-pixel/camera.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {loadPixelAssets} from '../../apps/web/public/world-pixel/assets.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {createPixelRenderLayer,avatarBounds} from '../../apps/web/public/world-pixel/render-layer.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {findAvatarHit} from '../../apps/web/public/world-owned-layer.js';
const rules={worldId:'default',version:1,topologyVersion:1,width:16,height:16};
const geometry={width:96,height:64,anchor:{x:48,y:39},hitBox:{left:-8,right:8,top:-24,bottom:0}}; // Synthetic geometry, not an adopted final human anchor.
const descriptor=(url='assets/forest.png',width=320,height=576)=>({url,width,height,sha256:'a'.repeat(64),sourcePath:'read-only/source.png'});
const options={baseURL:'http://test.local/assets/pixel/',origin:'http://test.local'};

test('fixed pixel mapping places every logical cell centre inside commons without changing facts or collocating offsets',()=>{
 assert.equal(PIXEL_MAP.width,768);assert.equal(PIXEL_MAP.height,512);
 assert.deepEqual(pixelPoint({x:0,y:0},rules),{x:264,y:136});assert.deepEqual(pixelPoint({x:15,y:15},rules),{x:504,y:376});
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){const point=pixelPoint({x,y},rules);assert.ok(point.x>PIXEL_MAP.commons.left&&point.x<PIXEL_MAP.commons.right&&point.y>PIXEL_MAP.commons.top&&point.y<PIXEL_MAP.commons.bottom);}
 assert.throws(()=>assertPixelRules({...rules,version:2}),/incompatible/u);assert.throws(()=>assertPixelRules({...rules,width:32}),/incompatible/u);assert.throws(()=>pixelPoint({x:16,y:0},rules),/invalid/u);
});

test('fit keeps the whole source stage inside HUD insets while close views use native integer density',()=>{
 const fit=pixelFitScale(PIXEL_MAP,{width:1440,height:900},{top:88,bottom:126,left:16,right:16});
 assert.ok(fit*768<=1408&&fit*512<=686);assert.equal(nextPixelScale(fit,1,fit),2);assert.equal(nextPixelScale(2,1,fit),3);assert.equal(nextPixelScale(3,-1,fit),2);assert.equal(nextPixelScale(2,-1,fit),fit);assert.equal(nextPixelScale(2,0,fit),2);
});

test('render layer uses dictionary rects and native anchors, preserving forest pixel density and exact public facts',()=>{
 const image={width:320,height:576},assets={kit:{version:'synthetic',sprites:{tree:{image:'forest',rect:[0,0,32,32],groundAnchor:[16,30]}}},images:new Map([['forest',image]])};
 const layer=createPixelRenderLayer({assets,avatarGeometry:geometry,drawAvatar(){},drawGround(){},drawSelection(){}});
 const calls:unknown[][]=[],ctx={imageSmoothingEnabled:true,drawImage(...args:unknown[]){calls.push(args);}};layer.drawSprite(ctx,'tree',100,200);
 assert.equal(ctx.imageSmoothingEnabled,false);assert.deepEqual(calls[0],[image,0,0,32,32,84,170,32,32],'Forest stays 32 source pixels, never rescaled to a 16px tile');
 const row={agentId:'a',position:{x:0,y:0},profile:{displayName:'真实名字',appearance:{template:'basic',color:'olive'}}};
 const projected=layer.projectAvatars([row,{...row,agentId:'b'}],rules);assert.deepEqual(projected.map((entry:any)=>[entry.x,entry.y]),[[264,136],[264,136]]);assert.deepEqual(projected[0].fact,row);assert.equal(projected[0].projectionVersion,PIXEL_MAP.version);
 assert.throws(()=>createPixelRenderLayer({assets,drawAvatar(){},drawGround(){},drawSelection(){}}),/geometry_invalid/u,'No candidate human anchor is silently chosen');
});

test('native human canvas and hit body are independent; same-cell clicks cycle without moving either person',()=>{
 const rows=[{agentId:'a',x:264,y:136},{agentId:'b',x:264,y:136}],before=structuredClone(rows),shape=()=>avatarBounds(geometry);
 const first=findAvatarHit(rows,{x:264,y:125},3,shape,'');assert.equal(first.agentId,'a');assert.equal(findAvatarHit(rows,{x:264,y:125},3,shape,first.agentId).agentId,'b');
 assert.equal(findAvatarHit(rows,{x:294,y:125},3,shape),undefined,'Transparent 96px sprite canvas is not treated as the hit body');assert.deepEqual(rows,before);
});

test('asset publication is atomic, same-origin and native-sized, retaining a read-only source index',async()=>{
 let closed=0;const kit={version:'synthetic',sourcePixelSize:16,images:{forest:descriptor()}};
 const loaded=await loadPixelAssets(kit,{...options,loadImage:async(ref:any)=>({width:ref.width,height:ref.height,close(){closed++;}})});
 assert.equal(loaded.images.get('forest').width,320);assert.equal(loaded.sourceIndex[0].sourcePath,'read-only/source.png');loaded.dispose();loaded.dispose();assert.equal(closed,1);
 await assert.rejects(loadPixelAssets({...kit,images:{forest:descriptor('../other.png')}},{...options,loadImage:async()=>{assert.fail('Invalid URL must not load');}}),/descriptor_invalid/u);
 await assert.rejects(loadPixelAssets(kit,{...options,baseURL:'https://other.invalid/assets/'}),/origin_invalid/u);
});

test('cancellation or any malformed image closes decoded resources and never publishes a partial kit',async()=>{
 let release:(image:unknown)=>void=()=>{},closed=0;const signal=new AbortController(),kit={version:'synthetic',sourcePixelSize:16,images:{forest:descriptor()}};
 const pending=loadPixelAssets(kit,{...options,signal:signal.signal,loadImage:async()=>new Promise(resolve=>{release=resolve;})});signal.abort();release({width:320,height:576,close(){closed++;}});await assert.rejects(pending,{name:'AbortError'});assert.equal(closed,1);
 await assert.rejects(loadPixelAssets(kit,{...options,loadImage:async()=>({width:160,height:288,close(){closed++;}})}),/size_mismatch/u);assert.equal(closed,2);
});
