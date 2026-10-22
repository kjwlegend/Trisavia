import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {townV2Rules,TOWN_V2_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-v2.ts';
import {assertCell,assertRuleset,validatePath} from '../../apps/platform/domains/world/rules.ts';
import {spawnCandidates} from '../../apps/platform/domains/world/idle-life.ts';
import type {GridPoint} from '../../apps/platform/domains/world/types.ts';
import {M1Error} from '../../apps/platform/domains/common/errors.ts';
export function townRules(){const bytes=readFileSync(new URL('../../apps/web/public/world-map-v2.json',import.meta.url));return townV2Rules(JSON.parse(bytes.toString()),createHash('sha256').update(bytes).digest('hex'));}
const key=(p:GridPoint)=>p.x+','+p.y;
const adjacent=(p:GridPoint)=>[{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}];
test('one immutable artifact gives all 5632 cells, connected entrances/bridges/stairs and distinct scenery limits',()=>{
 const r=townRules(),m=r.mapManifest!;assert.equal(m.layoutSha256,TOWN_V2_LAYOUT_SHA256);assert.equal(m.geometryDigest,'b2c52a8a77dcf352670d5fb95a755d442c5a424c27d4762b921e0ce817d4f772');
 assert.deepEqual(m.counts,{walkable:1150,physicalBlocked:1622,unopened:2860});assert.equal(r.maxPathLength,64);assert.equal(r.blocked.length+r.unopened!.length,4482);
 const forbidden=new Set([...r.blocked,...r.unopened!].map(key)),walk=new Map<string,GridPoint>();for(let y=-28;y<=35;y++)for(let x=-28;x<=59;x++)if(!forbidden.has(key({x,y})))walk.set(key({x,y}),{x,y});
 const seen=new Map([[key(r.spawn),0]]),q=[r.spawn];for(let i=0;i<q.length;i++)for(const next of adjacent(q[i]!))if(walk.has(key(next))&&!seen.has(key(next))){seen.set(key(next),seen.get(key(q[i]!))!+1);q.push(next);}
 assert.equal(seen.size,1150);assert.equal(Math.max(...seen.values()),83);assert.equal(m.buildings.length,31);assert.equal(m.npcs.length,3);
 for(let y=0;y<16;y++)for(let x=0;x<16;x++)assertCell(r,{x,y});
 for(const b of m.buildings)assert(seen.has(key(b.entrance)));for(const b of m.bridges)for(const cell of [...b.deckCells,...b.bankApproachCells])assertCell(r,cell);for(const s of m.stairs)for(const cell of [...s.cells,s.lowerEndpoint,s.upperEndpoint])assertCell(r,cell);
 for(const n of m.npcs){assert.equal(n.countsAsAgent,false);assert.deepEqual(n.actions,[]);for(const cell of n.approachCells)assert(seen.has(key(cell)));}
 assert.throws(()=>assertCell(r,r.unopened![0]!),e=>e instanceof M1Error&&e.code==='cell_unopened');assert.throws(()=>assertCell(r,r.blocked[0]!),e=>e instanceof M1Error&&e.code==='path_invalid');assert.throws(()=>assertRuleset({...r,unopened:[...r.unopened!,r.blocked[0]!]}));
 assert.throws(()=>validatePath(r,{x:0,y:0},Array.from({length:65},(_,i)=>({x:i%2?0:1,y:0}))));
 const spawn=spawnCandidates(r,[{x:0,y:0}],42);assert(spawn.some(p=>p.x<0||p.y<0));for(const candidate of spawn)assertCell(r,candidate);
});
test('negative-coordinate stairs and both bridges are ordinary legal orthogonal paths',()=>{
 const r=townRules();for(const x of [-7,16])validatePath(r,{x,y:-10},Array.from({length:4},(_,i)=>({x,y:-11-i})));
 validatePath(r,{x:28,y:0},Array.from({length:14},(_,i)=>({x:29+i,y:0})));
 validatePath(r,{x:29,y:27},Array.from({length:14},(_,i)=>({x:30+i,y:27})));
});
