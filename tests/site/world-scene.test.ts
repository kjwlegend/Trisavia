import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS and has no declaration file.
import {WORLD_SIZE,places,roadSegments,buildRoadGraph} from '../../apps/web/public/world-scene.js';
// @ts-expect-error Generated runtime metadata is intentionally plain JS.
import {townAssets} from '../../apps/web/public/world-town/assets.js';

test('town contract keeps six areas, eleven buildings and a connected graph to every door and both bridges',()=>{
 assert.deepEqual(WORLD_SIZE,{width:1536,height:1024});
 assert.equal(new Set(places.map((p:any)=>p.area)).size,6);
 const buildings=places.filter((p:any)=>townAssets.assets[p.assetId].category==='buildings');assert.equal(buildings.length,11);
 const graph:Map<string,any>=buildRoadGraph(),seen=new Set<string>(),queue=[graph.keys().next().value!];
 while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);queue.push(...graph.get(id).neighbors);}
 assert.equal(seen.size,graph.size,'All walkable nodes belong to the same town');
 for(const p of buildings)assert.ok(seen.has(`${p.x},${p.y+8}`),'A door has a reachable approach with room for the feet');
 for(const x of [384,1152])for(const y of [64,224])assert.ok(seen.has(`${x},${y}`),'Both ends of both bridges are connected');
});

test('every walking edge keeps the full foot box outside buildings and water except the bridge decks',()=>{
 const boxes=places.filter((p:any)=>townAssets.assets[p.assetId].category==='buildings'||p.id==='beacon').map((p:any)=>{
  const a=townAssets.assets[p.assetId],f=a.footprint;return{x:p.x-a.anchor.x+f.x,y:p.y-a.anchor.y+f.y,width:f.width,height:f.height};
 });
 const fountain=townAssets.assets.fountain,f=fountain.footprint;
 boxes.push({x:768-fountain.anchor.x+f.x,y:560-fountain.anchor.y+f.y,width:f.width,height:f.height});
 for(const [x1,y1,x2,y2]of roadSegments){
  assert.ok(x1===x2||y1===y2,'Walking edges follow the axis-aligned streets');
  const steps=Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)/2));
  for(let i=0;i<=steps;i++){
   const x=x1+(x2-x1)*i/steps,y=y1+(y2-y1)*i/steps;
   if(y>96&&y<192)assert.ok(x===384||x===1152,'Water crossings remain on the two bridges');
   for(const b of boxes)assert.equal(x-6<b.x+b.width&&x+6>b.x&&y-6<b.y+b.height&&y>b.y,false,'The 12 by 6 foot box must not cross an occupied footprint');
  }
 }
});
