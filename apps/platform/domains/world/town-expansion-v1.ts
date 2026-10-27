import {hashRuntimeRequest} from '../runtime/command.ts';
import {assertCell,assertRuleset} from './rules.ts';
import type {GridPoint,WorldRuleset,WorldMapManifest,WorldNpc} from './types.ts';
import type {JsonObject} from '../../contracts/store.ts';
export const TOWN_EXPANSION_LAYOUT_SHA256='6c7424d586209179299f57439c9df8e4eb6bc63df23e57c69422d5c53ff8955f';
export const TOWN_EXPANSION_SPATIAL_SHA256='861fef772675ad2ec01fa57d7a49e5eeb5e3482d43ae9f370fb48fe2b6d866c4';
export const TOWN_EXPANSION_LAYOUT_URL='/assets/world-life/world-map-expansion-v1.json';
export const TOWN_EXPANSION_SPATIAL_URL='/assets/world-life/spatial-manifest-expansion-v1.json';
export const TOWN_EXPANSION_GEOMETRY_DIGEST='9ddf08135f2a1604b768c872b4f9d5b385df2828a5181c89cfbdf2dcd9af57a4';
export const TOWN_EXPANSION_SPATIAL_REF=Object.freeze({url:TOWN_EXPANSION_SPATIAL_URL,revision:4,sha256:TOWN_EXPANSION_SPATIAL_SHA256});
const point=(cell:number[]):GridPoint=>({x:cell[0]!,y:cell[1]!});
/** A pure conversion of the one published design artifact, never a second handwritten map. */
export function townExpansionRules(layout:Record<string,any>,layoutSha256:string,spatial:Record<string,any>):WorldRuleset {
 const bounds=layout.bounds,width=bounds.maxX-bounds.minX+1,height=bounds.maxY-bounds.minY+1;
 if(layout.mapId!=='pixel-town-v2'||layout.layoutId!=='town-expansion-layout-v1'||layout.rulesetVersion!==6||layout.topologyVersion!==6||width!==120||height!==88||layout.tileSize!==16||layout.source.width!==2048||layout.source.height!==1536||layoutSha256!==TOWN_EXPANSION_LAYOUT_SHA256)throw new Error('Unexpected town v2 artifact');
 for(const name of ['walkableMask','blockedMask','physicalBlockedMask','outsideWalkableMask','v1InheritedMask'])if(!Array.isArray(layout[name])||layout[name].length!==height||layout[name].some((row:unknown)=>typeof row!=='string'||row.length!==width||/[^01]/.test(row)))throw new Error('Invalid bounded town mask');
 const blocked:GridPoint[]=[],unopened:GridPoint[]=[];let walkable=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const walk=layout.walkableMask[y][x]==='1',physical=layout.physicalBlockedMask[y][x]==='1',outside=layout.outsideWalkableMask[y][x]==='1';
  if(Number(walk)+Number(physical)+Number(outside)!==1)throw new Error('Town cell classifications overlap or leave a gap');
  const cell={x:x+bounds.minX,y:y+bounds.minY};if(walk)walkable++;else(physical?blocked:unopened).push(cell);
 }
 if(walkable!==1966||blocked.length!==2093||unopened.length!==6501)throw new Error('Town cell counts differ from the fixed design');
 const buildings=layout.buildings.map((b:any)=>({id:b.id,name:b.name,entrance:point(b.entrance.cell),interior:false as const}));
 const bridges=layout.bridges.map((b:any)=>({id:b.id,name:b.name,deckCells:b.deckCells.map(point),bankApproachCells:b.bankApproachCells.map(point)}));
 const stairs=layout.stairs.map((s:any)=>({id:s.id,name:s.name,cells:s.cells.map(point),lowerEndpoint:point(s.lowerEndpoint),upperEndpoint:point(s.upperEndpoint)}));
 const npcs:WorldNpc[]=layout.npcServicePoints.map((n:any)=>({npcId:n.id,name:n.name,role:n.role,position:point(n.standingCell),approachCells:n.approachCells.map(point),appearance:{lookId:'sunnyside-human-'+n.hair,catalogVersion:'2026-10-21.appearance-v1.1',...(n.appearanceColors?{hairColorId:n.appearanceColors.hairColorId,clothingColorId:n.appearanceColors.clothingColorId}:{})},serverManaged:true,readOnly:true,actions:[],status:'service_unavailable',countsAsAgent:false}));
 const geometry={bounds,spawn:layout.spawn.cell,commons:layout.commons.bounds,walkableMask:layout.walkableMask,physicalBlockedMask:layout.physicalBlockedMask,unopenedMask:layout.outsideWalkableMask,buildings,bridges,stairs,npcs};
 if(spatial.id!=='town-expansion-semantic-v1'||spatial.map?.rulesetVersion!==6||spatial.map.layoutSha256!==layoutSha256||spatial.publicWalkingRegions?.length!==3)throw new Error('Unexpected expansion semantic artifact');
 const walkingRegions=spatial.publicWalkingRegions.map((r:any)=>({id:r.id,name:r.name,description:r.description,roamTargets:r.roamTargets.map(point)}));
 if(walkingRegions.reduce((n:number,r:any)=>n+r.roamTargets.length,0)!==12)throw new Error('Expected twelve authored walking targets');
 const mapManifest:WorldMapManifest={mapId:'pixel-town-v2',version:6,layoutId:'town-expansion-layout-v1',walkingRegions,layoutUrl:TOWN_EXPANSION_LAYOUT_URL,layoutSha256,geometryDigest:hashRuntimeRequest(JSON.parse(JSON.stringify(geometry)) as JsonObject),source:{width:2048,height:1536},tileSize:16,origin:point(layout.origin.source),bounds:{...bounds},counts:{walkable,physicalBlocked:blocked.length,unopened:unopened.length},singleSurface:true,visualElevationOnly:true,buildings,bridges,stairs,npcs};
 const rules:WorldRuleset={worldId:'default',version:6,topologyVersion:6,width,height,bounds:{...bounds},spawn:point(layout.spawn.cell),blocked,unopened,mapManifest,places:[{id:'commons',bounds:{left:0,top:0,right:15,bottom:15},access:'members',capacity:null}],maxPathLength:64};
 assertRuleset(rules);if(mapManifest.geometryDigest!==TOWN_EXPANSION_GEOMETRY_DIGEST)throw new Error('Expansion canonical geometry differs');for(const region of walkingRegions)for(const target of region.roamTargets)assertCell(rules,target);return rules;
}
