import {LIFE_ASSET_RULES} from './b-catalog.ts';
/** Sole runtime C values, from the approved WS03 catalog revision1; execution catalog3 is separately activated. */
export const LIFE_C_RULES={revision:3 as const,ruleVersion:1 as const,currency:'star_coin' as const,currencyScale:0 as const,
 items:[...LIFE_ASSET_RULES.items,
 {id:'bread_meal',name:'麦香便餐',kind:'food',buyPrice:6,sellPrice:null,energyGain:20,durationSeconds:60,assetId:'life-item-bread_meal'},
 {id:'herbal_tea',name:'草本茶',kind:'food',buyPrice:3,sellPrice:null,energyGain:8,durationSeconds:30,assetId:'life-item-herbal_tea'},
 {id:'grilled_fish',name:'香煎鱼餐',kind:'food',buyPrice:null,sellPrice:null,energyGain:28,durationSeconds:60,assetId:'life-item-grilled_fish'},
 {id:'harbor_handbook',name:'港湾生活手册',kind:'book',buyPrice:10,sellPrice:null,assetId:'life-item-harbor_handbook'}],
 fishing:LIFE_ASSET_RULES.fishing,
 services:{mealPreparation:{placeId:'harbor_tavern',fishUnits:1,fee:3,durationSeconds:60,outputItemId:'grilled_fish'},innRest:{placeId:'stone_inn',price:12,durationSeconds:180,energyGain:70},reading:{placeId:'blue_library',durationSeconds:180},visit:{staySeconds:30,revisitRecordCooldownSeconds:86400}},
 gifts:{maxUnits:5,maxPending:3,durationMs:86400000},
};
export const LIFE_C_SPATIAL_SHA256='e30e46f7a6d66315b11af0eb7896908e84e5a70af0a0bfe72006fbbb8199152a';
