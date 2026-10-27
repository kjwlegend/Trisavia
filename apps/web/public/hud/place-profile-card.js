import {api,el} from '../common.js';

const validText=(v,max=2000)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\p{Cc}]/u.test(v);
const id=v=>validText(v,100)&&/^[A-Za-z0-9_.:-]+$/.test(v);
const invalid=()=>{throw Error('place_profile_response_invalid');};
/** Validate the same server profile contract; this module has no local place copy or NPC dictionary. */
export function readPlaceProfile(raw,placeId,rules){
  const v=raw?.data,p=v?.profile,im=p?.image,f=im?.frame;
  if(raw?.protocolVersion!==1||!validText(raw.instanceId,180)||v?.version!==1||!id(v.worldId)||!Number.isSafeInteger(v.asOf)||!id(p?.placeId)||!Array.isArray(p.targetIds)||!p.targetIds.includes(placeId)||!p.targetIds.includes(p.placeId)||!p.targetIds.every(id)||!['building','commons','region','life-place','care-point','notice'].includes(p.kind)||!validText(p.name,100)||!validText(p.area,100)||!validText(p.description)||p.availabilityNote!==null&&!validText(p.availabilityNote,500)||p.ownerNpcId!==null&&!id(p.ownerNpcId))invalid();
  if(!im||!/^\/assets\/[A-Za-z0-9_./-]+\.(png|webp|svg)$/.test(im.url)||im.url.includes('..')||!Number.isSafeInteger(im.sourceWidth)||!Number.isSafeInteger(im.sourceHeight)||im.sourceWidth<1||im.sourceHeight<1||!validText(im.sourceRef,500)||!Array.isArray(f)||f.length!==4||f.some(n=>!Number.isSafeInteger(n)||n<0)||f[2]<1||f[3]<1||f[0]+f[2]>im.sourceWidth||f[1]+f[3]>im.sourceHeight)invalid();
  if(p.owner!==null&&(!p.owner||p.owner.npcId!==p.ownerNpcId||!id(p.owner.npcId)||!validText(p.owner.name,100)))invalid();
  if(!v.map||!id(v.map.mapId)||!['layoutSha256','geometryDigest'].every(key=>/^[a-f0-9]{64}$/.test(v.map[key])))invalid();
  if(rules&&(!rules.mapManifest||['mapId','layoutSha256','geometryDigest'].some(key=>v.map[key]!==rules.mapManifest[key])))invalid();
  return {instanceId:raw.instanceId,data:structuredClone(v)};
}
/** NPC/person cards keep their original identity entry. Never infer a place from its service provider. */
export function placeProfileTargetId(target){
  if(!target||['world-avatar','world-npc','owned-agent'].includes(target.kind))return null;
  return id(target.placeId)?target.placeId:id(target.id)?target.id:null;
}
function sourceImage(profile,onRetry){
  const frame=el('div','place-profile-image'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),image=document.createElementNS('http://www.w3.org/2000/svg','image'),fallback=el('div','place-profile-image-fallback');
  svg.setAttribute('viewBox',profile.image.frame.join(' '));svg.setAttribute('preserveAspectRatio','xMidYMax meet');svg.setAttribute('role','img');svg.setAttribute('aria-label',profile.name+'的当前场景');
  image.setAttribute('width',String(profile.image.sourceWidth));image.setAttribute('height',String(profile.image.sourceHeight));image.setAttribute('href',profile.image.url);svg.append(image);
  const retry=el('button','','重试');retry.type='button';retry.addEventListener('click',onRetry);fallback.append(el('span','','图片暂未载入'),retry);fallback.hidden=true;
  image.addEventListener('error',()=>{svg.setAttribute('hidden','');fallback.hidden=false;});frame.append(svg,fallback);return frame;
}
export function createPlaceProfileCard({request=api,getRules=()=>null,onChange=()=>{}}={}){
  const node=el('section','place-profile-card');node.hidden=true;
  let active=false,targetId=null,controller=null,generation=0,profile=null;
  function render(status=''){
    node.replaceChildren();node.hidden=!active;if(!active)return;
    if(status){const message=el('p','place-profile-status',status);message.setAttribute('role','status');node.append(message);if(status==='场所介绍暂未取得。'){const retry=el('button','','重新读取');retry.type='button';retry.addEventListener('click',()=>void refresh());node.append(retry);}return;}
    if(!profile)return;
    const text=el('div','place-profile-copy');text.append(el('p','place-profile-area',profile.area),el('h3','place-profile-name',profile.name),el('p','place-profile-description',profile.description));
    if(profile.owner)text.append(el('p','place-profile-owner','所属：'+profile.owner.name));
    node.append(sourceImage(profile,()=>render()),text);
    if(profile.availabilityNote)node.append(el('p','place-profile-availability',profile.availabilityNote));
  }
  async function refresh(){
    controller?.abort();const turn=++generation,id=targetId;if(!active||!id)return false;
    controller=new AbortController();profile=null;render('正在读取场所介绍…');onChange({phase:'loading',profile:null,targetId:id});
    try{const raw=await request('/world/place-profile?placeId='+encodeURIComponent(id),{signal:controller.signal}),value=readPlaceProfile(raw,id,getRules());if(!active||turn!==generation)return false;profile=value.data.profile;render();onChange({phase:'ready',profile,instanceId:value.instanceId,targetId:id});return true;}
    catch{if(!active||turn!==generation)return false;profile=null;render('场所介绍暂未取得。');onChange({phase:'error',profile:null,targetId:id});return false;}
  }
  function close(){active=false;generation++;controller?.abort();controller=null;targetId=null;profile=null;render();}
  return {node,open(target){targetId=placeProfileTargetId(target);active=Boolean(targetId);if(!active){close();return Promise.resolve(false);}return refresh();},refresh,close,dispose(){close();node.remove();}};
}
