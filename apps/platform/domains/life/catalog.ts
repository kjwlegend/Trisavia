import type {LifeCatalog,LifeNpcProfile,LifePlace} from './types.ts';
import type {WorldRuleset,GridPoint} from '../world/types.ts';
import type {TownCatalog} from '../town-services/types.ts';
import {LIFE_B_RULES} from './b-catalog.ts';
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
export function lifeCatalogFromSpatial(spatial:Record<string,any>,rules:WorldRuleset,town:TownCatalog,activatedAt:number):LifeCatalog{return catalogFromSpatial(spatial,rules,town,activatedAt,1);}
export const LIFE_B_SPATIAL_SHA256='8ff3fd1b58dddd91623c7979eb22ea37785a3d19139b8555c43ffd90b673945e';
export const LIFE_B_RUNTIME_RULES={...structuredClone(LIFE_RULES),revision:2 as const,npcProfiles:[...LIFE_RULES.npcProfiles,{id:LIFE_B_RULES.npc.id,stage:'B' as const}]};
export function lifeBCatalogFromSpatial(spatial:Record<string,any>,rules:WorldRuleset,town:TownCatalog,activatedAt:number):LifeCatalog{return catalogFromSpatial(spatial,rules,town,activatedAt,2);}
export function catalogFromSpatial(spatial:Record<string,any>,rules:WorldRuleset,town:TownCatalog,activatedAt:number,revision:1|2|3):LifeCatalog{
 if(spatial.id!==(revision===1?'m3-life-a-semantic-v1':revision===2?'m3-life-b-semantic-v1':'m3-life-c-semantic-v1')||spatial.revision!==revision||spatial.parent?.worldId!=='default'||rules.version!==revision+2||!rules.mapManifest)throw new Error('Unexpected life spatial manifest');
 const point=(v:number[]):GridPoint=>({x:v[0]!,y:v[1]!}),points=(v:number[][])=>v.map(point);
 const places:LifePlace[]=spatial.places.map((p:any)=>({placeId:p.placeId,name:p.name,parentSceneId:p.parentSceneId,anchorBuildingId:p.anchorBuildingId,cells:points(p.cells),entrances:points(p.entrances),approachCells:points(p.approachCells),waitingCells:points(p.waitingCells),...(p.shopPurchaseApproach||p.bookPurchaseApproach?{shopApproachCells:[point(p.shopPurchaseApproach??p.bookPurchaseApproach)]}:{}),stations:p.stations.map((s:any)=>({id:s.id,actionIds:s.actionIds,capacity:s.capacity,cells:points(s.cells),approachCells:points(s.approachCells),facing:s.facing}))}));
 const preferences:Record<string,Record<string,number>>={'npc-mayor':{duty:30,rest:10,read:25,visit:20},'npc-tavern':{duty:25,rest:10,eat:25,fish_shore:20,sell:10},'npc-innkeeper':{duty:25,rest:20,read:25,visit:15},'npc-harbor-hand':{work_harbor:30,rest:10,eat:20,fish_pier:25,sell:10}};
 preferences[LIFE_B_RULES.npc.id]=LIFE_B_RULES.npc.preferences;preferences['npc-librarian']={duty:30,read:30,visit:15,rest:10};preferences['npc-neighbor']={read:25,visit:30,eat:20,rest:10,fish_shore:15};
 const npcProfiles:LifeNpcProfile[]=spatial.npcs.map((n:any)=>({id:n.npcId,name:n.name,stage:n.npcId===LIFE_B_RULES.npc.id?'B':['npc-librarian','npc-neighbor'].includes(n.npcId)?'C':'A',role:n.role,buildingId:n.anchorBuildingId,lookId:n.appearance.lookId,...(n.appearance.hairColorId?{hairColorId:n.appearance.hairColorId}:{}),...(n.appearance.clothingColorId?{clothingColorId:n.appearance.clothingColorId}:{}),initialPosition:point(n.initialCell),dutyPlaceId:n.npcId==='npc-harbor-hand'?null:n.dutyPlaceId,preferences:preferences[n.npcId]}));
 for(const n of spatial.npcs as any[]){if(n.npcId==='npc-harbor-hand'||!n.dutyPlaceId||!n.dutyCell)continue;const cell=point(n.dutyCell);let p=places.find(p=>p.placeId===n.dutyPlaceId);if(!p){p={placeId:n.dutyPlaceId,name:n.npcId==='npc-mayor'?'市政厅门前':'石岸旅舍门前',parentSceneId:'qingzhou-town',anchorBuildingId:n.anchorBuildingId,cells:[cell,...points(n.approachCells)],entrances:points(n.approachCells),approachCells:[cell],waitingCells:[],stations:[]};places.push(p);}else p.cells.push(cell);p.stations.push({id:n.npcId+'-duty',actionIds:['npc.duty'],capacity:1,cells:[cell],approachCells:[cell]});}
 const inn=places.find(p=>p.placeId==='stone_inn')!,innNpc=town.npcs.find(n=>n.npcId==='npc-innkeeper')!;if(revision<3)inn.stations.push({id:'stone_inn-legacy-rest',actionIds:['rest.voucher'],capacity:4,cells:innNpc.approachCells,approachCells:innNpc.approachCells,physical:false});else for(const s of inn.stations)if(s.actionIds.includes('rest.inn'))s.actionIds.push('rest.voucher');
 const result={...lifeCatalog({activatedAt,map:{mapId:rules.mapManifest.mapId,geometryDigest:rules.mapManifest.geometryDigest,rulesetVersion:rules.version,topologyVersion:rules.topologyVersion},places,npcProfiles}),revision};validateLifeCatalog(result,rules);return result;
}
