export const PIXEL_LAYOUT_URL='/assets/world-life/world-map-life-b-v1.json';
export const PIXEL_LAYOUT_SHA256='ca3e40e358594e6fd60a49bde053b9de1f54cc8b3a3ea72a05560680ca04bcd8';
export const PIXEL_GEOMETRY_DIGEST='aba61c4d5211e7f1a71282c5a5f34b8a7e7fdfa2f6a0881e03db07b2567b499f';
export const PIXEL_MAP=Object.freeze({version:'pixel-town-v2',worldId:'default',rulesetVersion:4,topologyVersion:4,width:1536,height:1152,gridWidth:88,gridHeight:64,cellSize:16,origin:Object.freeze({x:520,y:520}),bounds:Object.freeze({minX:-28,minY:-28,maxX:59,maxY:35}),commons:Object.freeze({left:512,top:512,right:768,bottom:768})});
export function assertPixelRules(rules){
 const m=rules?.mapManifest,b=PIXEL_MAP.bounds;
 if(rules?.worldId!==PIXEL_MAP.worldId||rules.version!==PIXEL_MAP.rulesetVersion||rules.topologyVersion!==PIXEL_MAP.topologyVersion||rules.width!==PIXEL_MAP.gridWidth||rules.height!==PIXEL_MAP.gridHeight||Object.keys(b).some(key=>rules.bounds?.[key]!==b[key])||m?.mapId!==PIXEL_MAP.version||m.version!==4||m.layoutUrl!==PIXEL_LAYOUT_URL||m.layoutSha256!==PIXEL_LAYOUT_SHA256||m.geometryDigest!==PIXEL_GEOMETRY_DIGEST||m.counts?.walkable!==1180||m.counts.physicalBlocked!==1622||m.counts.unopened!==2830||m.source?.width!==1536||m.source.height!==1152||m.tileSize!==16||m.origin?.x!==520||m.origin.y!==520||Object.keys(b).some(key=>m.bounds?.[key]!==b[key]))throw new Error('pixel_rules_incompatible');
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
