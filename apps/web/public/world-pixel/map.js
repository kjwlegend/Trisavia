export const PIXEL_MAP=Object.freeze({version:'pixel-town-commons@1',worldId:'default',rulesetVersion:1,topologyVersion:1,width:768,height:512,gridWidth:16,gridHeight:16,cellSize:16,origin:Object.freeze({x:264,y:136}),commons:Object.freeze({left:256,top:128,right:512,bottom:384})});
export function assertPixelRules(rules){
  if(rules?.worldId!==PIXEL_MAP.worldId||rules.version!==PIXEL_MAP.rulesetVersion||rules.topologyVersion!==PIXEL_MAP.topologyVersion||rules.width!==PIXEL_MAP.gridWidth||rules.height!==PIXEL_MAP.gridHeight)throw new Error('pixel_rules_incompatible');
}
export function pixelPoint(point,rules){
  assertPixelRules(rules);
  if(!Number.isSafeInteger(point?.x)||!Number.isSafeInteger(point?.y)||point.x<0||point.x>=16||point.y<0||point.y>=16)throw new Error('pixel_position_invalid');
  return{x:PIXEL_MAP.origin.x+PIXEL_MAP.cellSize*point.x,y:PIXEL_MAP.origin.y+PIXEL_MAP.cellSize*point.y};
}
export function assertPixelSnapshot(value,previous){
  if(value.rules)assertPixelRules(value.rules);
  if(value.phase==='demo')throw new Error('pixel_scene_requires_world');
  if(!value.complete)return;
  if(!value.rules||!Number.isSafeInteger(value.asOf)||!Number.isSafeInteger(value.worldRevision))throw new Error('pixel_snapshot_invalid');
  if(previous?.complete&&(value.asOf<previous.asOf||value.worldRevision<previous.worldRevision))throw new Error('pixel_snapshot_stale');
  const old=new Map((previous?.avatars||[]).map(row=>[row.agentId,row]));
  for(const row of value.avatars){pixelPoint(row.position,value.rules);const prior=old.get(row.agentId);if(prior&&(row.id!==prior.id||row.version<prior.version||row.version===prior.version&&(row.position.x!==prior.position.x||row.position.y!==prior.position.y)))throw new Error('pixel_avatar_version_changed');}
}
