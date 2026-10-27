import { M1Error } from '../common/errors.ts';
import { assertCell, worldBounds } from './rules.ts';
import type { GridPoint, WorldRuleset } from './types.ts';

/** Grid steps, never animation frames. Each Avatar reuses one fenced persisted task. */
export const IDLE_LIFE_POLICY_V1 = Object.freeze({ version: 1, stepIntervalMs: 4000, minRestMs: 20000, restJitterMs: 10000, maxPathLength: 3, scanBatch: 10, scanIntervalMs: 10000 });
export const IDLE_LIFE_POLICY_V2=Object.freeze({version:2,stepIntervalMs:1000,minRestMs:5000,restJitterMs:5000,maxPathLength:24,scanBatch:10,scanIntervalMs:10000});
export const CURRENT_IDLE_LIFE_POLICY=IDLE_LIFE_POLICY_V2;
export function idleSeed(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0;
  return result;
}
export const cellKey = (cell: GridPoint) => cell.x + ',' + cell.y;
export function isWalkable(rules: WorldRuleset, cell: GridPoint): boolean {
  try { assertCell(rules, cell); return true; } catch (error) { if (error instanceof M1Error) return false; throw error; }
}
const distance = (a: GridPoint, b: GridPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const separation = (cell: GridPoint, occupied: GridPoint[]) => occupied.length ? Math.min(...occupied.map(other => distance(cell, other))) : 0;

/** Bounded candidates include the configured legal fallback even for a very large future world. */
export function spawnCandidates(rules: WorldRuleset, occupied: GridPoint[], seed: number): GridPoint[] {
  const bounds=worldBounds(rules),total = rules.width * rules.height, count = Math.min(total, 16384), candidates = new Map<string, GridPoint>();
  for (let index = 0; index < count; index++) {
    const ordinal = total <= count ? (index + seed % total) % total : (Math.imul(index, 2654435761) + seed >>> 0) % total;
    const cell = { x: bounds.minX+ordinal % rules.width, y: bounds.minY+Math.floor(ordinal / rules.width) };
    if (isWalkable(rules, cell)) candidates.set(cellKey(cell), cell);
  }
  candidates.set(cellKey(rules.spawn), { ...rules.spawn });
  return [...candidates.values()].sort((a, b) => separation(b, occupied) - separation(a, occupied));
}

/** A short breadth-first destination choice; occupied cells are avoided, not made impassable world rules. */
export function idlePath(rules: WorldRuleset, from: GridPoint, occupied: GridPoint[], seed: number): GridPoint[] {
  const blockedByAvatar = new Set(occupied.map(cellKey)), seen = new Set([cellKey(from)]);
  const queue: { cell: GridPoint; path: GridPoint[] }[] = [{ cell: from, path: [] }], choices: GridPoint[][] = [];
  const directions = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  const maximum = Math.min(rules.maxPathLength, 1 + seed % IDLE_LIFE_POLICY_V1.maxPathLength);
  for (let index = 0; index < queue.length; index++) {
    const next = queue[index]!;
    if (next.path.length === maximum) continue;
    for (let offset = 0; offset < directions.length; offset++) {
      const direction = directions[(offset + seed % 4) % 4]!, cell = { x: next.cell.x + direction.x, y: next.cell.y + direction.y }, key = cellKey(cell);
      if (seen.has(key) || blockedByAvatar.has(key) || !isWalkable(rules, cell)) continue;
      seen.add(key); const path = [...next.path, cell]; queue.push({ cell, path }); choices.push(path);
    }
  }
  choices.sort((a, b) => separation(b.at(-1)!, occupied) - separation(a.at(-1)!, occupied) || b.length - a.length);
  return choices[0] ?? [];
}

/** A finite leg toward a reachable authored outdoor entrance, never an inferred visit/activity.
 * One bounded graph search uses current walkability and occupancy; a disconnected target is skipped.
 * No map coordinates, user choices, station claims, events or random read-time decisions are created.
 */
export function roamingPath(rules:WorldRuleset,from:GridPoint,occupied:GridPoint[],seed:number):GridPoint[]{
 const blocked=new Set([...occupied,...rules.blocked,...rules.unopened??[]].map(cellKey)),bounds=worldBounds(rules),closed=rules.places.filter(p=>p.access==='closed'),seen=new Map<string,{cell:GridPoint;parent:string|null}>(),queue=[from];
 seen.set(cellKey(from),{cell:from,parent:null});
 const directions=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
 for(let i=0;i<queue.length&&seen.size<16384;i++)for(let n=0;n<4;n++){
  const d=directions[(n+seed%4)%4]!,cell={x:queue[i]!.x+d.x,y:queue[i]!.y+d.y},key=cellKey(cell);
  if(seen.has(key)||blocked.has(key)||cell.x<bounds.minX||cell.x>bounds.maxX||cell.y<bounds.minY||cell.y>bounds.maxY||closed.some(p=>cell.x>=p.bounds.left&&cell.x<=p.bounds.right&&cell.y>=p.bounds.top&&cell.y<=p.bounds.bottom))continue;
  seen.set(key,{cell,parent:cellKey(queue[i]!)});queue.push(cell);
 }
 const path=(end:GridPoint)=>{const result:GridPoint[]=[];let key:string|null=cellKey(end);while(key){const v:{cell:GridPoint;parent:string|null}=seen.get(key)!;if(v.parent===null)break;result.push(v.cell);key=v.parent;}return result.reverse();};
 const targets=[...(rules.mapManifest?.walkingRegions??[]).flatMap(r=>r.roamTargets),...(rules.mapManifest?.buildings??[]).map(b=>b.entrance)].filter(c=>seen.has(cellKey(c))&&distance(c,from)>=4);
 const fallback=queue.filter(c=>distance(c,from)>=4),destination=targets.length?targets[seed%targets.length]!:fallback[seed%Math.max(1,fallback.length)];
 if(!destination)return idlePath(rules,from,occupied,seed);
 return path(destination).slice(0,Math.min(rules.maxPathLength,CURRENT_IDLE_LIFE_POLICY.maxPathLength));
}
