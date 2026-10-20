// This is a display projection, never a path, place or collision rule. Logical
// cells are spread across the existing canvas independently of its scenery.
export const WORLD_PROJECTION_VERSION='logical-grid-to-town@1';
const invalid=()=>{const error=new Error('world_response_invalid');error.code='world_response_invalid';throw error;};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function readWorldRules(data,worldId='default'){
  const {world,rules,asOf}=data||{};
  if(world?.worldId!==worldId||world.active!==true||!integer(world.revision)||!integer(asOf)||rules?.worldId!==worldId||!integer(rules.version)||world.rulesetVersion!==rules.version||!integer(rules.topologyVersion)||!Number.isSafeInteger(rules.width)||rules.width<1||!Number.isSafeInteger(rules.height)||rules.height<1)invalid();
  return{worldId,version:rules.version,topologyVersion:rules.topologyVersion,width:rules.width,height:rules.height};
}
export function readWorldPage(data,rules){
  if(data?.worldId!==rules.worldId||data.scope!=='world'||!integer(data.worldRevision)||!integer(data.asOf)||!Array.isArray(data.avatars)||typeof data.complete!=='boolean'||(data.complete?data.nextCursor!==null:typeof data.nextCursor!=='string'||!data.nextCursor))invalid();
  const avatars=[];
  for(const row of data.avatars){
    const profile=row?.profile,p=row?.position;
    if(typeof row?.id!=='string'||!row.id||typeof row.agentId!=='string'||!row.agentId||row.worldId!==rules.worldId||!integer(row.version)||!['idle','suspended','left'].includes(row.status)||row.rulesetVersion!==rules.version||!integer(p?.x)||p.x>=rules.width||!integer(p?.y)||p.y>=rules.height||!(row.placeId===null||typeof row.placeId==='string')||!integer(row.createdAt)||!integer(row.updatedAt)||profile?.agentId!==row.agentId||!integer(profile.publishedVersion)||typeof profile.displayName!=='string'||!profile.displayName||profile.appearance?.template!=='basic'||!['olive','cream','blue','coral'].includes(profile.appearance.color))invalid();
    if(row.status==='left')continue;
    avatars.push({id:row.id,worldId:row.worldId,agentId:row.agentId,version:row.version,status:row.status,position:{x:p.x,y:p.y},placeId:row.placeId,rulesetVersion:row.rulesetVersion,createdAt:row.createdAt,updatedAt:row.updatedAt,profile:{agentId:row.agentId,publishedVersion:profile.publishedVersion,displayName:profile.displayName,appearance:{template:'basic',color:profile.appearance.color}}});
  }
  return{worldId:rules.worldId,worldRevision:data.worldRevision,asOf:data.asOf,avatars,complete:data.complete,nextCursor:data.nextCursor};
}
export function projectWorldAvatars(avatars,rules,{width=1536,height=1024}={}){
  return avatars.map(row=>({agentId:row.agentId,name:row.profile.displayName,avatar:{...row.profile.appearance},fact:structuredClone(row),projectionVersion:WORLD_PROJECTION_VERSION,
    // Keep the display extent inside the canvas so the (0,0) spawn is not
    // covered by the fixed header/source note. This does not move its cell.
    x:width/4+(rules.width===1?.5:row.position.x/(rules.width-1))*width/2,y:height/4+(rules.height===1?.5:row.position.y/(rules.height-1))*height/2,walking:false,frame:0,direction:'down'}));
}
