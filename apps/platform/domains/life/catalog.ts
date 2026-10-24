import type {LifeCatalog,LifeNpcProfile,LifePlace} from './types.ts';
import type {WorldRuleset,GridPoint} from '../world/types.ts';
import type {TownCatalog} from '../town-services/types.ts';
import {validateLifeCatalog} from './rules.ts';
export const LIFE_SPATIAL_SHA256='4b5fbb66add90a1ac0ca297bbdd71e147e837601966ede318dc6c83459dcc12b';
/** This runtime catalog is the sole numeric source shared with the wallet participant. */
export const LIFE_RULES=Object.freeze({revision:1 as const,ruleVersion:1 as const,currency:'star_coin' as const,currencyScale:0 as const,
 jobs:[{id:'harbor_shift' as const,placeId:'harbor_work',name:'盐风仓棚短工',durationSeconds:600,coinReward:36,energyCost:24},{id:'tavern_shift' as const,placeId:'harbor_tavern',name:'港湾酒馆帮工',durationSeconds:480,coinReward:24,energyCost:16}],
 npcPolicy:{initialCoins:80,initialEnergy:100,decisionIntervalSeconds:60,minDwellSeconds:120},
 npcProfiles:[{id:'npc-mayor',stage:'A' as const},{id:'npc-tavern',stage:'A' as const},{id:'npc-innkeeper',stage:'A' as const},{id:'npc-harbor-hand',stage:'A' as const}],
});
/** Geometry comes only from the frozen, separately reviewed semantic manifest. */
export function lifeCatalog(input:{activatedAt:number;map:LifeCatalog['map'];places:LifePlace[];npcProfiles:LifeNpcProfile[]}):LifeCatalog{return {...structuredClone(LIFE_RULES),...structuredClone(input)};}
/** Exact semantic artifact conversion; no coordinate is derived from pixels or a layout preview. */
export function lifeCatalogFromSpatial(spatial:Record<string,any>,rules:WorldRuleset,town:TownCatalog,activatedAt:number):LifeCatalog{
 if(spatial.id!=='m3-life-a-semantic-v1'||spatial.revision!==1||spatial.parent?.worldId!=='default'||rules.version!==3||!rules.mapManifest)throw new Error('Unexpected life spatial manifest');
 const point=(v:number[]):GridPoint=>({x:v[0]!,y:v[1]!}),points=(v:number[][])=>v.map(point);
 const places:LifePlace[]=spatial.places.map((p:any)=>({placeId:p.placeId,name:p.name,parentSceneId:p.parentSceneId,anchorBuildingId:p.anchorBuildingId,cells:points(p.cells),entrances:points(p.entrances),approachCells:points(p.approachCells),waitingCells:points(p.waitingCells),stations:p.stations.map((s:any)=>({id:s.id,actionIds:s.actionIds,capacity:s.capacity,cells:points(s.cells),approachCells:points(s.approachCells),facing:s.facing}))}));
 const preferences:Record<string,Record<string,number>>={'npc-mayor':{duty:30,rest:10,read:25,visit:20},'npc-tavern':{duty:25,rest:10,eat:25,fish_shore:20,sell:10},'npc-innkeeper':{duty:25,rest:20,read:25,visit:15},'npc-harbor-hand':{work_harbor:30,rest:10,eat:20,fish_pier:25,sell:10}};
 const npcProfiles:LifeNpcProfile[]=spatial.npcs.map((n:any)=>({id:n.npcId,name:n.name,stage:'A',role:n.role,buildingId:n.anchorBuildingId,lookId:n.appearance.lookId,initialPosition:point(n.initialCell),dutyPlaceId:n.npcId==='npc-harbor-hand'?null:n.dutyPlaceId,preferences:preferences[n.npcId]}));
 for(const n of spatial.npcs as any[]){if(n.npcId==='npc-harbor-hand')continue;const cell=point(n.dutyCell);let p=places.find(p=>p.placeId===n.dutyPlaceId);if(!p){p={placeId:n.dutyPlaceId,name:n.npcId==='npc-mayor'?'市政厅门前':'石岸旅舍门前',parentSceneId:'qingzhou-town',anchorBuildingId:n.anchorBuildingId,cells:[cell,...points(n.approachCells)],entrances:points(n.approachCells),approachCells:[cell],waitingCells:[],stations:[]};places.push(p);}else p.cells.push(cell);p.stations.push({id:n.npcId+'-duty',actionIds:['npc.duty'],capacity:1,cells:[cell],approachCells:[cell]});}
 const inn=places.find(p=>p.placeId==='stone_inn')!,innNpc=town.npcs.find(n=>n.npcId==='npc-innkeeper')!;inn.stations.push({id:'stone_inn-legacy-rest',actionIds:['rest.voucher'],capacity:4,cells:innNpc.approachCells,approachCells:innNpc.approachCells,physical:false});
 const result=lifeCatalog({activatedAt,map:{mapId:rules.mapManifest.mapId,geometryDigest:rules.mapManifest.geometryDigest,rulesetVersion:3,topologyVersion:3},places,npcProfiles});validateLifeCatalog(result,rules);return result;
}
