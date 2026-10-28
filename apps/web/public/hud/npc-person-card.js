import {el} from '../common.js';
import {resolveLook,drawLook} from '../world-pixel/look.js';
import {loadLookAssets} from '../world-pixel/look-assets.js';
import {readNpcSprite,NPC_LIFE_MANIFEST,NPC_LIFE_MANIFEST_SHA} from '../world-pixel/npc-life-art.js';
import {msg,bindAttribute} from '../i18n/core.js';
import {bindOfficialFields} from './official-content.js';

// A static portrait of the same finite NPC art as the world. No Agent identity,
// custom-avatar authority or arbitrary image URL is accepted here.
let manifestRead;
const portraits=new Map();
function crop(frame){const ctx=frame.getContext('2d'),pixels=ctx.getImageData(0,0,frame.width,frame.height).data;let left=frame.width,right=-1,top=frame.height,bottom=-1;for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++)if(pixels[(y*frame.width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}return{frame,left,top,width:right-left+1,height:bottom-top+1};}
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function verified(url,digest){const response=await fetch(url,{credentials:'omit',cache:'no-cache',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('npc_portrait_unavailable');const bytes=await response.arrayBuffer();if(await sha(bytes)!==digest)throw Error('npc_portrait_invalid');return bytes;}
async function npcPortrait(npc){
 const appearance=readNpcSprite(npc.appearance,npc.npcId),key=appearance.assetId+':'+appearance.digest;
 if(!portraits.has(key))portraits.set(key,(async()=>{
  manifestRead??=verified(NPC_LIFE_MANIFEST,NPC_LIFE_MANIFEST_SHA).then(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
  const manifest=await manifestRead,ref=manifest.characters.find(row=>row.lookId===appearance.assetId)?.actions.idle;
  if(!ref||!/^assets\/[a-z-]+\.png$/u.test(ref.file)||ref.frameSize[0]!==32||ref.frameSize[1]!==32)throw Error('npc_portrait_invalid');
  const image=await createImageBitmap(new Blob([await verified('/assets/npc-life-v1/'+ref.file,ref.sha256)],{type:'image/png'}));
  try{
   if(image.width!==ref.frames*32||image.height!==32)throw Error('npc_portrait_invalid');
   const frame=document.createElement('canvas');frame.width=frame.height=32;const ctx=frame.getContext('2d');ctx.drawImage(image,0,0,32,32,0,0,32,32);
   return crop(frame);
  }finally{image.close();}
 })());
 return portraits.get(key);
}
function portrait(node,npc){
 const canvas=el('canvas','avatar');canvas.width=canvas.height=80;canvas.setAttribute('role','img');bindAttribute(canvas,'aria-label','public:npc.portraitLabel',{name:npc.name});canvas.dataset.appearanceState='loading';node.replaceChildren(canvas);
 const read=async()=>{if(npc.appearance?.kind==='npc_sprite')return npcPortrait(npc);const look=resolveLook(npc.appearance);if(!look)throw Error('npc_portrait_unresolved');const assets=await loadLookAssets(),frame=document.createElement('canvas');frame.width=96;frame.height=64;drawLook(frame.getContext('2d'),look,assets.images,{x:48,y:39,still:true});return crop(frame);};
 void read().then(({frame,left,top,width,height})=>{if(node.firstChild!==canvas)return;if(width<=0||height<=0)throw Error('npc_portrait_empty');const ctx=canvas.getContext('2d'),scale=Math.max(1,Math.floor(Math.min(64/width,64/height)));ctx.imageSmoothingEnabled=false;ctx.drawImage(frame,left,top,width,height,Math.floor((80-width*scale)/2),Math.floor((80-height*scale)/2),width*scale,height*scale);canvas.dataset.visibleHeight=String(height*scale);canvas.dataset.appearanceState='ready';}).catch(()=>{if(node.firstChild!==canvas)return;canvas.dataset.appearanceState='error';bindAttribute(canvas,'title','public:npc.portraitUnavailable');});
}
export function createNpcPersonCard(){
 const node=el('section','npc-person-card'),picture=el('span','npc-person-picture'),copy=el('div','npc-person-copy'),name=el('h3','npc-person-name'),role=el('p','npc-person-role'),story=el('p','npc-person-story'),state=el('p','npc-person-state'),sourceNote=el('p','npc-person-state');copy.append(name,role);node.append(picture,copy,story,state,sourceNote);node.hidden=true;sourceNote.hidden=true;let key='',stopContent=()=>{};
 return{node,set(npc,{stale=false}={}){
  if(!npc){key='';stopContent();node.hidden=true;picture.replaceChildren();return;}
  const next=JSON.stringify([npc.npcId,npc.name,npc.role,npc.identity??null,npc.appearance,stale]);if(next===key)return;key=next;
  node.hidden=false;node.dataset.npcId=npc.npcId;name.textContent=npc.name;role.textContent=npc.role;
  stopContent();story.textContent=npc.identity?.story||'';story.hidden=!story.textContent;
  if(npc.identity)stopContent=bindOfficialFields({name,role,story},'world-content',{id:npc.npcId,ref:npc.identity.ref,version:npc.identity.version,values:npc.identity,nativeDigest:npc.identity.digest},{note:sourceNote});
  state.replaceChildren();if(stale)state.append(el('span','',msg('public:npc.stale')));else if(npc.readOnly||npc.status==='service_unavailable')state.append(el('span','',msg('public:npc.notOpen')));state.hidden=!state.childNodes.length;
  portrait(picture,npc);
 },clear(){key='';stopContent();node.hidden=true;picture.replaceChildren();}};
}
