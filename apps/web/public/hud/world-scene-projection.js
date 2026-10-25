import {readCustomAppearance} from '../world-pixel/custom-appearance.js';
import {readPublicLifeActivity} from './life-public-state.js';
import {readPublicId} from '../public-id.js';
// Public DTO validation and display projection. No client route or future
// movement is inferred from scenery; the native renderer verifies its manifest.
import appearanceColors from '../world-pixel/appearance-colors-v1.json' with {type:'json'};
export const WORLD_PROJECTION_VERSION='logical-grid-to-town@1';
const invalid=()=>{const error=new Error('world_response_invalid');error.code='world_response_invalid';throw error;};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const within=(p,rules)=>Number.isSafeInteger(p?.x)&&Number.isSafeInteger(p?.y)&&p.x>=(rules.bounds?.minX??0)&&p.x<=(rules.bounds?.maxX??rules.width-1)&&p.y>=(rules.bounds?.minY??0)&&p.y<=(rules.bounds?.maxY??rules.height-1);
export function readWorldMotion(value,row,rules){if(value==null)return null;if(!(value.movementId===null||typeof value.movementId==='string'&&value.movementId)||typeof value.segmentId!=='string'||value.segmentId!==row.id+':'+row.version||!['explicit','idle'].includes(value.source)||value.status!=='committed'||!within(value.from,rules)||!within(value.to,rules)||Math.abs(value.from.x-value.to.x)+Math.abs(value.from.y-value.to.y)!==1||value.to.x!==row.position.x||value.to.y!==row.position.y||!((value.rulesetVersion===rules.version&&value.topologyVersion===rules.topologyVersion)||([3,4,5].includes(rules.version)&&value.rulesetVersion===2&&value.topologyVersion===2)||([4,5].includes(rules.version)&&value.rulesetVersion===3&&value.topologyVersion===3)||(rules.version===5&&value.rulesetVersion===4&&value.topologyVersion===4)||([2,3,4,5].includes(rules.version)&&value.rulesetVersion===1&&value.topologyVersion===1&&[value.from,value.to].every(p=>p.x>=0&&p.x<16&&p.y>=0&&p.y<16)))||!integer(value.startedAt)||!integer(value.arriveAt)||value.arriveAt-value.startedAt!==(value.source==='idle'?4000:1000))invalid();return{segmentId:value.segmentId,movementId:value.movementId,source:value.source,from:{...value.from},to:{...value.to},startedAt:value.startedAt,arriveAt:value.arriveAt,rulesetVersion:value.rulesetVersion,topologyVersion:value.topologyVersion,status:'committed'};}
export function readWorldNpcs(rows,rules){
 if(!Array.isArray(rows))invalid();const seen=new Set();return rows.map(row=>{
  if(typeof row?.npcId!=='string'||!row.npcId||seen.has(row.npcId)||typeof row.name!=='string'||!row.name||typeof row.role!=='string'||!within(row.position,rules)||!Array.isArray(row.approachCells)||row.approachCells.some(p=>!within(p,rules))||row.serverManaged!==true||row.countsAsAgent!==false||!Array.isArray(row.actions)||row.actions.some(action=>typeof action!=='string'))invalid();
  const current=row.readOnly===false&&row.status==='available';
  if(current?(!Number.isSafeInteger(row.definitionVersion)||row.definitionVersion<1||!(row.buildingId===null||typeof row.buildingId==='string')||!Array.isArray(row.serviceIds)||row.serviceIds.some(id=>!['welcome.claim','tavern.host','inn.rest','greet'].includes(id))):row.readOnly!==true||row.status!=='service_unavailable'||row.actions.length)invalid();
  if(row.providerPresent!==undefined&&typeof row.providerPresent!=='boolean'||row.nextCheckAt!==undefined&&!integer(row.nextCheckAt))invalid();
  if(row.actorKind!==undefined&&row.actorKind!=='npc'||row.version!==undefined&&(!integer(row.version)||row.version<1))invalid();
  const motionVersion=row.motionVersion??row.version;if(row.motion&&(!integer(motionVersion)||motionVersion<1||motionVersion>row.version))invalid();const motion=readWorldMotion(row.motion,{id:row.npcId,version:motionVersion,position:row.position},rules);
  seen.add(row.npcId);return{providerPresent:row.providerPresent??null,nextCheckAt:row.nextCheckAt??null,actorKind:'npc',version:row.version??null,motionVersion:motionVersion??null,motion,activity:readPublicLifeActivity(row.activity),npcId:row.npcId,publicId:readPublicId(row.publicId,'N'),name:row.name,role:row.role,position:{...row.position},approachCells:row.approachCells.map(p=>({...p})),appearance:readAppearance(row.appearance),serverManaged:true,readOnly:!current,countsAsAgent:false,status:row.status,actions:[...row.actions],...(current?{definitionVersion:row.definitionVersion,buildingId:row.buildingId,serviceIds:[...row.serviceIds]}:{})};
 });
}
export function readAppearance(value){if(value?.kind==='custom'){try{return readCustomAppearance(value);}catch{invalid();}}if(value&&typeof value.lookId==='string'&&value.lookId.length>0&&value.lookId.length<=100&&typeof value.catalogVersion==='string'&&value.catalogVersion.length>0&&value.catalogVersion.length<=100&&Object.keys(value).every(key=>['lookId','catalogVersion','hairColorId','clothingColorId'].includes(key))&&['hair','clothing'].every(kind=>value[kind+'ColorId']===undefined||appearanceColors[kind==='hair'?'hairColors':'clothingColors'].some(color=>color.id===value[kind+'ColorId'])))return{lookId:value.lookId,catalogVersion:value.catalogVersion,...(value.hairColorId!==undefined?{hairColorId:value.hairColorId}:{}),...(value.clothingColorId!==undefined?{clothingColorId:value.clothingColorId}:{})};if(value?.template==='basic'&&['olive','cream','blue','coral'].includes(value.color)&&Object.keys(value).every(key=>['template','color'].includes(key)))return{template:'basic',color:value.color};invalid();}
export function readWorldRules(data,worldId='default'){
  const {world,rules,asOf}=data||{};
  if(world?.worldId!==worldId||world.active!==true||!integer(world.revision)||!integer(asOf)||rules?.worldId!==worldId||!integer(rules.version)||world.rulesetVersion!==rules.version||!integer(rules.topologyVersion)||!Number.isSafeInteger(rules.width)||rules.width<1||!Number.isSafeInteger(rules.height)||rules.height<1)invalid();
  if(rules.places!==undefined&&!Array.isArray(rules.places))invalid();
  const places=rules.places?.map(place=>{if(typeof place?.id!=='string'||!place.id||!['members','closed'].includes(place.access))invalid();return{id:place.id,access:place.access};});
  const bounds=rules.bounds;if(bounds&&(!Object.values(bounds).every(Number.isSafeInteger)||bounds.maxX-bounds.minX+1!==rules.width||bounds.maxY-bounds.minY+1!==rules.height))invalid();
  return{worldId,version:rules.version,topologyVersion:rules.topologyVersion,width:rules.width,height:rules.height,...(bounds?{bounds:{...bounds}}:{}),...(rules.mapManifest?{mapManifest:structuredClone(rules.mapManifest)}:{}),...(places?{places}: {})};
}
export function readWorldPage(data,rules){
  if(data?.worldId!==rules.worldId||data.scope!=='world'||!integer(data.worldRevision)||!integer(data.asOf)||!Array.isArray(data.avatars)||typeof data.complete!=='boolean'||(data.complete?data.nextCursor!==null:typeof data.nextCursor!=='string'||!data.nextCursor))invalid();
  if(data.npcCatalogVersion!==undefined&&data.npcCatalogVersion!==null&&(!integer(data.npcCatalogVersion)||data.npcCatalogVersion<1))invalid();
  const avatars=[];
  for(const row of data.avatars){
    const profile=row?.profile,p=row?.position;
    if(typeof row?.id!=='string'||!row.id||typeof row.agentId!=='string'||!row.agentId||row.worldId!==rules.worldId||!integer(row.version)||!['idle','suspended','left'].includes(row.status)||!Number.isSafeInteger(row.rulesetVersion)||row.rulesetVersion<1||row.rulesetVersion>rules.version||!within(p,rules)||!(row.placeId===null||typeof row.placeId==='string')||!integer(row.createdAt)||!integer(row.updatedAt)||profile?.agentId!==row.agentId||!integer(profile.publishedVersion)||typeof profile.displayName!=='string'||!profile.displayName)invalid();
    if(row.status==='left')continue;
    avatars.push({id:row.id,worldId:row.worldId,agentId:row.agentId,publicId:readPublicId(row.publicId),version:row.version,status:row.status,position:{x:p.x,y:p.y},motion:readWorldMotion(row.motion,row,rules),placeId:row.placeId,activity:readPublicLifeActivity(row.activity),rulesetVersion:row.rulesetVersion,createdAt:row.createdAt,updatedAt:row.updatedAt,profile:{agentId:row.agentId,publicId:readPublicId(profile.publicId),publishedVersion:profile.publishedVersion,displayName:profile.displayName,appearance:readAppearance(profile.appearance)}});
  }
  return{worldId:rules.worldId,worldRevision:data.worldRevision,asOf:data.asOf,avatars,npcCatalogVersion:data.npcCatalogVersion??null,npcs:readWorldNpcs(data.npcs??[],rules),complete:data.complete,nextCursor:data.nextCursor};
}
export function projectWorldAvatars(avatars,rules,{width=1536,height=1024,projectPoint,projectionVersion=WORLD_PROJECTION_VERSION}={}){
  return avatars.map(row=>({agentId:row.agentId,publicId:row.publicId,name:row.profile.displayName,avatar:{...row.profile.appearance},fact:structuredClone(row),projectionVersion,
    // Keep the display extent inside the canvas so the (0,0) spawn is not
    // covered by the fixed header/source note. This does not move its cell.
    ...(projectPoint?projectPoint(row.position,rules):{x:width/4+(rules.width===1?.5:row.position.x/(rules.width-1))*width/2,y:height/4+(rules.height===1?.5:row.position.y/(rules.height-1))*height/2}),renderMotion:row.motion?{...row.motion,from:projectPoint?projectPoint(row.motion.from,rules):row.motion.from,to:projectPoint?projectPoint(row.motion.to,rules):row.motion.to}:null,walking:false,frame:0,direction:'down'}));
}
