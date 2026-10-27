export const PIXEL_LAYOUT_URL='/assets/world-life/world-map-expansion-v1.json';
export const PIXEL_LAYOUT_SHA256='6c7424d586209179299f57439c9df8e4eb6bc63df23e57c69422d5c53ff8955f';
export const PIXEL_GEOMETRY_DIGEST='9ddf08135f2a1604b768c872b4f9d5b385df2828a5181c89cfbdf2dcd9af57a4';
export const PIXEL_MAP=Object.freeze({version:'pixel-town-v2',layoutId:'town-expansion-layout-v1',worldId:'default',rulesetVersion:6,topologyVersion:6,width:2048,height:1536,gridWidth:120,gridHeight:88,initialCamera:Object.freeze({x:768,y:576}),cellSize:16,origin:Object.freeze({x:520,y:520}),bounds:Object.freeze({minX:-28,minY:-28,maxX:91,maxY:59}),commons:Object.freeze({left:512,top:512,right:768,bottom:768})});
export function assertPixelRules(rules){
 const m=rules?.mapManifest,b=PIXEL_MAP.bounds;
 if(rules?.worldId!==PIXEL_MAP.worldId||rules.version!==PIXEL_MAP.rulesetVersion||rules.topologyVersion!==PIXEL_MAP.topologyVersion||rules.width!==PIXEL_MAP.gridWidth||rules.height!==PIXEL_MAP.gridHeight||Object.keys(b).some(key=>rules.bounds?.[key]!==b[key])||m?.mapId!==PIXEL_MAP.version||m.layoutId!==PIXEL_MAP.layoutId||m.version!==6||m.layoutUrl!==PIXEL_LAYOUT_URL||m.layoutSha256!==PIXEL_LAYOUT_SHA256||m.geometryDigest!==PIXEL_GEOMETRY_DIGEST||m.counts?.walkable!==1966||m.counts.physicalBlocked!==2093||m.counts.unopened!==6501||m.source?.width!==2048||m.source.height!==1536||m.tileSize!==16||m.origin?.x!==520||m.origin.y!==520||Object.keys(b).some(key=>m.bounds?.[key]!==b[key]))throw new Error('pixel_rules_incompatible');
}
export function pixelPoint(point,rules){
 assertPixelRules(rules);const b=PIXEL_MAP.bounds;
 if(!Number.isSafeInteger(point?.x)||!Number.isSafeInteger(point?.y)||point.x<b.minX||point.x>b.maxX||point.y<b.minY||point.y>b.maxY)throw new Error('pixel_position_invalid');
 return{x:PIXEL_MAP.origin.x+PIXEL_MAP.cellSize*point.x,y:PIXEL_MAP.origin.y+PIXEL_MAP.cellSize*point.y};
}
export function assertPixelSnapshot(value,previous){
 if(value.rules)assertPixelRules(value.rules);
 if(value.phase==='demo')throw new Error('pixel_scene_requires_world');
 if(!value.complete)return;
 if(!value.rules||!Number.isSafeInteger(value.asOf)||!Number.isSafeInteger(value.worldRevision))throw new Error('pixel_snapshot_invalid');
 if(previous?.complete&&(value.asOf<previous.asOf||value.worldRevision<previous.worldRevision))throw new Error('pixel_snapshot_stale');
 const old=new Map((previous?.avatars||[]).map(row=>[row.agentId,row]));
 for(const row of value.avatars){pixelPoint(row.position,value.rules);const prior=old.get(row.agentId);if(prior&&(row.id!==prior.id||row.version<prior.version||row.version===prior.version&&(row.position.x!==prior.position.x||row.position.y!==prior.position.y||row.motion&&prior.motion&&JSON.stringify(row.motion)!==JSON.stringify(prior.motion))))throw new Error('pixel_avatar_version_changed');}
}
