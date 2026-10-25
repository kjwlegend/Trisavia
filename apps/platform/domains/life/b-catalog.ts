import type {LifeBItemId,LifeSpotId} from './b-types.ts';

/** Runtime B rules, copied once from approved design catalog rev1; shared with asset settlement. */
export const LIFE_B_RULES=Object.freeze({catalogRevision:2 as const,ruleVersion:1 as const,
 quoteTtlMs:7200000,shopQuantityMax:20,castsPerSession:5,castsPerUtcDay:30,castDurationMs:60000,baitPerCast:1 as const,energyPerCast:2 as const,
 shop:{placeId:'fisher_shop' as const,anchorBuildingId:'e-stall',selfService:true,
  items:[{id:'basic_rod',name:'木柄鱼竿',kind:'tool',buyPrice:30,sellPrice:null,assetId:'life-item-basic_rod'},
   {id:'bait',name:'通用鱼饵',kind:'consumable',buyPrice:2,sellPrice:null,assetId:'life-item-bait'},
   {id:'sardine',name:'银纹沙丁鱼',kind:'fish',buyPrice:null,sellPrice:4,minWeightGrams:100,maxWeightGrams:300,assetId:'life-item-sardine'},
   {id:'mackerel',name:'青背鲭鱼',kind:'fish',buyPrice:null,sellPrice:8,minWeightGrams:400,maxWeightGrams:900,assetId:'life-item-mackerel'},
   {id:'sea_bass',name:'花斑海鲈',kind:'fish',buyPrice:null,sellPrice:14,minWeightGrams:800,maxWeightGrams:1800,assetId:'life-item-sea_bass'}] satisfies {id:LifeBItemId;name:string;kind:string;buyPrice:number|null;sellPrice:number|null;minWeightGrams?:number;maxWeightGrams?:number;assetId:string}[]},
 spots:[{id:'shore_spot',placeId:'harbor_shore',name:'港区近岸',capacity:4,outcomes:[{itemId:null,tickets:2000},{itemId:'sardine',tickets:5000},{itemId:'mackerel',tickets:2500},{itemId:'sea_bass',tickets:500}]},
  {id:'pier_spot',placeId:'harbor_pier',name:'外侧栈桥',capacity:3,outcomes:[{itemId:null,tickets:3500},{itemId:'sardine',tickets:2500},{itemId:'mackerel',tickets:2500},{itemId:'sea_bass',tickets:1500}]}] satisfies {id:LifeSpotId;placeId:string;name:string;capacity:number;outcomes:{itemId:'sardine'|'mackerel'|'sea_bass'|null;tickets:number}[]}[],
 npc:{id:'npc-fishing-clerk',stage:'B' as const,dutyPlaceId:'fisher_shop',initialCoins:80,initialEnergy:100,preferences:{duty:20,rest:10,fish_shore:25,fish_pier:30,sell:25}},
});

/** The economic participant consumes this projection of the very same frozen rules. */
export const LIFE_ASSET_RULES={revision:2,ruleVersion:LIFE_B_RULES.ruleVersion,currency:'star_coin' as const,currencyScale:0 as const,items:LIFE_B_RULES.shop.items.map(i=>({...i,...('minWeightGrams'in i?{weightGrams:[i.minWeightGrams!,i.maxWeightGrams!]}:{})})),fishing:{castSeconds:LIFE_B_RULES.castDurationMs/1000,baitPerCast:LIFE_B_RULES.baitPerCast,spots:LIFE_B_RULES.spots.map(s=>({id:s.id,outcomes:s.outcomes.map(o=>({itemId:o.itemId,probability:o.tickets/10000}))}))}};
