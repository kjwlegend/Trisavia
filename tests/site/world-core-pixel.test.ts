import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {PIXEL_MAP,pixelPoint,assertPixelRules,assertPixelSnapshot} from '../../apps/web/public/world-pixel/map.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {pixelFitScale,nextPixelScale} from '../../apps/web/public/world-pixel/camera.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {loadPixelAssets} from '../../apps/web/public/world-pixel/assets.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {createPixelRenderLayer,avatarBounds} from '../../apps/web/public/world-pixel/render-layer.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {findAvatarHit} from '../../apps/web/public/world-owned-layer.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {HUMAN_GEOMETRY,humanHitSize,humanFrame,drawHuman,receivePosition,advancePosition} from '../../apps/web/public/world-pixel/human.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {createPixelTown,validatePixelLayout,PIXEL_LAYOUT_SHA256} from '../../apps/web/public/world-pixel/town.js';
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

test('frozen bundle files retain the design hashes and the actual exported layout',async()=>{
 const root=new URL('../../apps/web/public/world-pixel/',import.meta.url),manifest=JSON.parse(await readFile(new URL('source-manifest.json',root),'utf8'));
 assert.equal(manifest.bundleDigest,'e51eaf38c10765eceaee2cb22147211b76e2adbc5d98447b74d6f9386dca29b1');
 for(const file of manifest.files)assert.equal(createHash('sha256').update(await readFile(new URL(file.path,root))).digest('hex'),file.sha256,file.path);
 assert.equal(manifest.files.filter((file:any)=>file.path.endsWith('.png')).length,19);
 assert.equal(createHash('sha256').update(await readFile(new URL('scene-layout.json',root))).digest('hex'),PIXEL_LAYOUT_SHA256);
 const layout=JSON.parse(await readFile(new URL('scene-layout.json',root),'utf8'));assert.equal(layout.modules.length,94);assert.equal(layout.modules.filter((item:any)=>item.id.startsWith('scenery-')).length,7);
 assert.deepEqual(layout.authorityMapping,{worldId:'default',sourceOrigin:[264,136],sourceUnitsPerCell:16,gridBounds:{minX:0,minY:0,maxX:15,maxY:15}});
});

test('locked human body gives independent native sheets, synchronized frames, fixed mirrored anchor and CSS hit allowance',()=>{
 const kit=(globalThis as any).PIXEL_ASSETS;assert.deepEqual(humanHitSize(HUMAN_GEOMETRY,1),{width:38,height:52});assert.deepEqual(humanHitSize(HUMAN_GEOMETRY,3),{width:62,height:67});
 const entry={agentId:'a',x:264,y:136,walking:true,facing:'left',fact:{id:'avatar-a',status:'idle',profile:{appearance:{color:'blue'}}}};
 assert.deepEqual(humanFrame(kit,entry,{elapsed:701,paused:false,reducedMotion:false}).rect,[672,0,96,64]);assert.deepEqual(humanFrame(kit,entry,{elapsed:701,reducedMotion:true}).rect,[0,0,96,64]);
 const calls:any[]=[],ctx={save(){},restore(){},translate(...a:any[]){calls.push(['translate',...a]);},scale(...a:any[]){calls.push(['scale',...a]);},drawImage(...a:any[]){calls.push(['image',...a]);}};
 drawHuman(ctx,entry,{elapsed:701,paused:false,reducedMotion:false},{kit,images:new Map([['human_base_walk','body'],['human_curlyhair_walk','hair']])});
 assert.deepEqual(calls,[['translate',264,136],['scale',-1,1],['image','body',672,0,96,64,-48,-39,96,64],['image','hair',672,0,96,64,-48,-39,96,64]]);
 const rows=[{agentId:'a',x:264,y:136},{agentId:'b',x:264,y:136}];assert.equal(findAvatarHit(rows,{x:264,y:126},3,()=>HUMAN_GEOMETRY,'a').agentId,'b');assert.deepEqual(rows.map(row=>[row.x,row.y]),[[264,136],[264,136]]);
});

test('visual movement is finite between received adjacent positions and snaps on pause without predicting another cell',()=>{
 const fact=(x:number,y:number,version:number)=>({version,status:'idle',position:{x,y}}),entry:any={};const first={x:264,y:136,fact:fact(0,0,1)};
 receivePosition(entry,first);entry.fact=first.fact;assert.equal(entry.x,264);assert.equal(entry.walking,false);
 const second={x:280,y:136,fact:fact(1,0,2)};receivePosition(entry,second);entry.fact=second.fact;advancePosition(entry,.09,{});assert.equal(entry.x,272);assert.equal(entry.walking,true);
 advancePosition(entry,1,{});assert.equal(entry.x,280);assert.equal(entry.transition,null);assert.equal(entry.walking,false);advancePosition(entry,99,{});assert.equal(entry.x,280);
 const third={x:280,y:152,fact:fact(1,1,3)};receivePosition(entry,third);entry.fact=third.fact;assert.equal(entry.facing,'right');advancePosition(entry,0,{paused:true});assert.equal(entry.y,152);assert.equal(entry.walking,false);
 const jump={x:312,y:152,fact:fact(3,1,4)};receivePosition(entry,jump);assert.equal(entry.x,312);assert.equal(entry.transition,null);
});

test('newer same-revision filtered snapshots replace the set while older or incompatible facts fail closed',()=>{
 const row={id:'v-a',agentId:'a',version:2,position:{x:1,y:0}},prior={phase:'ready',rules,complete:true,asOf:100,worldRevision:3,avatars:[row]};
 assert.doesNotThrow(()=>assertPixelSnapshot({...prior,asOf:101,avatars:[]},prior));
 assert.throws(()=>assertPixelSnapshot({...prior,asOf:99},prior),/stale/u);assert.throws(()=>assertPixelSnapshot({...prior,worldRevision:2},prior),/stale/u);
 assert.throws(()=>assertPixelSnapshot({...prior,avatars:[{...row,position:{x:2,y:0}}]},prior),/version/u);assert.throws(()=>assertPixelSnapshot({...prior,rules:{...rules,width:32}},prior),/incompatible/u);
 assert.throws(()=>assertPixelSnapshot({phase:'demo'},prior),/requires_world/u);
});

test('actual layout draws native terrain and all foot-sorted modules without turning scenery into business places',async()=>{
 const kit=(globalThis as any).PIXEL_ASSETS,layout=JSON.parse(await readFile(new URL('../../apps/web/public/world-pixel/scene-layout.json',import.meta.url),'utf8')),images=new Map(Object.entries(kit.images).map(([key,value]:[string,any])=>[key,{width:value.width,height:value.height}]));
 const calls:any[]=[],ctx:any={save(){},restore(){},translate(){},rotate(){},scale(){},fillRect(){},createPattern(){return{};},drawImage(...args:any[]){calls.push(args);}};const assets={kit,images,dispose(){}};
 const layer=createPixelTown(assets,layout,{makeCanvas:()=>({getContext:()=>ctx})});assert.equal(layer.objects.length,94);assert.equal(layer.buildingCount,7);assert.deepEqual(layer.places.map((place:any)=>place.id),['commons']);
 layer.drawGround(ctx,{theme:'day',viewport:{top:-100,bottom:700},avatars:[]});for(const object of layer.objects)object.draw(ctx,{theme:'dusk'});layer.drawUpper(ctx);layer.drawEffects(ctx,{theme:'dusk',reducedMotion:false,quality:0});
 assert.ok(calls.some(args=>args.length===9&&args[3]===32&&args[4]===32&&args[7]===32&&args[8]===32),'Native forest rects never scaled down');assert.throws(()=>validatePixelLayout({...layout,mapId:'unknown'},kit),/layout_invalid/u);
});
