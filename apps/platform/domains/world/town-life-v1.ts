import {hashRuntimeRequest} from '../runtime/command.ts';
import {assertRuleset} from './rules.ts';
import type {GridPoint,WorldRuleset,WorldMapManifest,WorldNpc} from './types.ts';
import type {JsonObject} from '../../contracts/store.ts';
export const LIFE_LAYOUT_SHA256='740961688871187a4d058a00822073283bc19642508ff128229c4420cb60b4b0';
const point=(cell:number[]):GridPoint=>({x:cell[0]!,y:cell[1]!});
/** A pure conversion of the one published design artifact, never a second handwritten map. */
export function townLifeRules(layout:Record<string,any>,layoutSha256:string):WorldRuleset {
 const bounds=layout.bounds,width=bounds.maxX-bounds.minX+1,height=bounds.maxY-bounds.minY+1;
 if(layout.mapId!=='pixel-town-v2'||width!==88||height!==64||layout.tileSize!==16||layout.source.width!==1536||layout.source.height!==1152||layoutSha256!==LIFE_LAYOUT_SHA256)throw new Error('Unexpected town v2 artifact');
 for(const name of ['walkableMask','physicalBlockedMask','outsideWalkableMask'])if(!Array.isArray(layout[name])||layout[name].length!==height||layout[name].some((row:unknown)=>typeof row!=='string'||row.length!==width||/[^01]/.test(row)))throw new Error('Invalid bounded town mask');
 const blocked:GridPoint[]=[],unopened:GridPoint[]=[];let walkable=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const walk=layout.walkableMask[y][x]==='1',physical=layout.physicalBlockedMask[y][x]==='1',outside=layout.outsideWalkableMask[y][x]==='1';
  if(Number(walk)+Number(physical)+Number(outside)!==1)throw new Error('Town cell classifications overlap or leave a gap');
  const cell={x:x+bounds.minX,y:y+bounds.minY};if(walk)walkable++;else(physical?blocked:unopened).push(cell);
 }
 if(walkable!==1175||blocked.length!==1622||unopened.length!==2835)throw new Error('Town cell counts differ from the fixed design');
 const buildings=layout.buildings.map((b:any)=>({id:b.id,name:b.name,entrance:point(b.entrance.cell),interior:false as const}));
 const bridges=layout.bridges.map((b:any)=>({id:b.id,name:b.name,deckCells:b.deckCells.map(point),bankApproachCells:b.bankApproachCells.map(point)}));
 const stairs=layout.stairs.map((s:any)=>({id:s.id,name:s.name,cells:s.cells.map(point),lowerEndpoint:point(s.lowerEndpoint),upperEndpoint:point(s.upperEndpoint)}));
 const npcs:WorldNpc[]=layout.npcServicePoints.map((n:any)=>({npcId:n.id,name:n.name,role:n.role,position:point(n.standingCell),approachCells:n.approachCells.map(point),appearance:{lookId:'sunnyside-human-'+n.hair,catalogVersion:'2026-10-21.appearance-v1.1'},serverManaged:true,readOnly:true,actions:[],status:'service_unavailable',countsAsAgent:false}));
 const geometry={bounds,spawn:layout.spawn.cell,commons:layout.commons.bounds,walkableMask:layout.walkableMask,physicalBlockedMask:layout.physicalBlockedMask,unopenedMask:layout.outsideWalkableMask,buildings,bridges,stairs,npcs};
 const mapManifest:WorldMapManifest={mapId:'pixel-town-v2',version:3,layoutUrl:'/world-map-life-v1.json',layoutSha256,geometryDigest:hashRuntimeRequest(JSON.parse(JSON.stringify(geometry)) as JsonObject),source:{width:1536,height:1152},tileSize:16,origin:point(layout.origin.source),bounds:{...bounds},counts:{walkable,physicalBlocked:blocked.length,unopened:unopened.length},singleSurface:true,visualElevationOnly:true,buildings,bridges,stairs,npcs};
 const rules:WorldRuleset={worldId:'default',version:3,topologyVersion:3,width,height,bounds:{...bounds},spawn:point(layout.spawn.cell),blocked,unopened,mapManifest,places:[{id:'commons',bounds:{left:0,top:0,right:15,bottom:15},access:'members',capacity:null}],maxPathLength:64};
 assertRuleset(rules);return rules;
}
