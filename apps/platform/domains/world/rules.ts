import { fail, version } from '../common/errors.ts';
import type { GridPoint, WorldPlace, WorldRuleset, WorldBounds } from './types.ts';

export const DEFAULT_WORLD_RULES: Readonly<WorldRuleset> = Object.freeze<WorldRuleset>({ worldId: 'default', version: 1, topologyVersion: 1,
  width: 16, height: 16, spawn: { x: 0, y: 0 }, blocked: [],
  places: [{ id: 'commons', bounds: { left: 0, top: 0, right: 15, bottom: 15 }, access: 'members', capacity: null }], maxPathLength: 64 });

export function point(input: unknown): GridPoint {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['x', 'y'].includes(key))) fail('invalid_request', 400, 'Expected a logical grid point');
  const { x, y } = input as Record<string, unknown>;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) fail('invalid_request', 400, 'Grid coordinates must be safe integers');
  return { x: x as number, y: y as number };
}
export function containingPlace(rules: WorldRuleset, position: GridPoint): WorldPlace | undefined {
  return rules.places.find(({ bounds }) => position.x >= bounds.left && position.x <= bounds.right && position.y >= bounds.top && position.y <= bounds.bottom);
}
export const MAX_WORLD_CELLS=16384,MAX_NONWALKABLE_CELLS=12288,MAX_WORLD_COORDINATE=100000;
export function worldBounds(rules:WorldRuleset):WorldBounds {return rules.bounds??{minX:0,minY:0,maxX:rules.width-1,maxY:rules.height-1};}
export function assertCell(rules: WorldRuleset, position: GridPoint): void {
  const bounds=worldBounds(rules);
  if(position.x<bounds.minX||position.y<bounds.minY||position.x>bounds.maxX||position.y>bounds.maxY)fail('path_invalid',409,'The logical cell is outside the world');
  if(rules.unopened?.some(cell=>cell.x===position.x&&cell.y===position.y))fail('cell_unopened',409,'This scenery cell is not open for traversal');
  if(rules.blocked.some(cell=>cell.x===position.x&&cell.y===position.y))fail('path_invalid',409,'The logical cell has a physical obstruction');
  if(containingPlace(rules,position)?.access==='closed')fail('place_not_accessible',403,'The place is not accessible');
}
export function assertRuleset(rules: WorldRuleset): void {
  version(rules.version);version(rules.topologyVersion);version(rules.width);version(rules.height);version(rules.maxPathLength);
  const bounds=worldBounds(rules),total=rules.width*rules.height,nonwalk=[...rules.blocked,...rules.unopened??[]];
  if(Object.values(bounds).some(edge=>!Number.isSafeInteger(edge)||Math.abs(edge)>MAX_WORLD_COORDINATE)||bounds.maxX-bounds.minX+1!==rules.width||bounds.maxY-bounds.minY+1!==rules.height||total>MAX_WORLD_CELLS||rules.maxPathLength>64||nonwalk.length>MAX_NONWALKABLE_CELLS||nonwalk.length>=total||rules.places.length>128)fail('invalid_request',400,'World rules exceed supported bounds');
  const ids=new Set<string>(),cells=new Set<string>();
  for(const place of rules.places){
    if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(place.id)||ids.has(place.id))fail('invalid_request',400,'Invalid or duplicate place');ids.add(place.id);
    const b=place.bounds;
    if(Object.values(b).some(edge=>!Number.isSafeInteger(edge))||b.left<bounds.minX||b.top<bounds.minY||b.right>bounds.maxX||b.bottom>bounds.maxY||b.left>b.right||b.top>b.bottom||!['members','closed'].includes(place.access)||place.capacity!==null&&(!Number.isSafeInteger(place.capacity)||place.capacity<1))fail('invalid_request',400,'Invalid place rules');
  }
  for(let i=0;i<rules.places.length;i++)for(const other of rules.places.slice(i+1)){const a=rules.places[i]!.bounds,b=other.bounds;if(a.left<=b.right&&a.right>=b.left&&a.top<=b.bottom&&a.bottom>=b.top)fail('invalid_request',400,'Place boundaries overlap');}
  for(const cell of nonwalk){point(cell);const key=cell.x+','+cell.y;if(cells.has(key)||cell.x<bounds.minX||cell.y<bounds.minY||cell.x>bounds.maxX||cell.y>bounds.maxY)fail('invalid_request',400,'Invalid, duplicate or overlapping nonwalkable cell');cells.add(key);}
  assertCell(rules,point(rules.spawn));
}
export function validatePath(rules: WorldRuleset, from: GridPoint, input: unknown): GridPoint[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > rules.maxPathLength) fail('invalid_request', 400, 'A bounded nonempty logical path is required');
  let previous = from; const path = input.map(point);
  for (const cell of path) {
    if (Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y) !== 1) fail('path_invalid', 409, 'Path steps must be adjacent on one axis');
    assertCell(rules, cell); previous = cell;
  }
  return path;
}
