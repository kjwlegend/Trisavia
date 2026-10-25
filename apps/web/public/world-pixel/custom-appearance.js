const sha=/^[a-f0-9]{64}$/,id=/^[A-Za-z0-9_-]{8,100}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const invalid=()=>{throw Error('custom_avatar_invalid');};
const origin=()=>globalThis.location?.origin||'https://avatar-validation.invalid';
const samePath=(value,path)=>{if(typeof value!=='string')return false;try{const url=new URL(value,origin());return url.origin===origin()&&!url.search&&!url.hash&&!url.username&&!url.password&&url.pathname===path;}catch{return false;}};
export function readCustomAppearance(value){
 if(!exact(value,['kind','assetId','version','digest','manifestUrl'])||value.kind!=='custom'||!id.test(value.assetId)||value.version!==1||!sha.test(value.digest)||!samePath(value.manifestUrl,`/v1/avatar-assets/public/${value.assetId}/1/${value.digest}/manifest.json`))invalid();
 return{kind:'custom',assetId:value.assetId,version:1,digest:value.digest,manifestUrl:new URL(value.manifestUrl,origin()).pathname};
}
export function readAvatarManifest(value){
 if(!exact(value,['version','type','frame','facing','clips','fallback'])||value.version!==1||value.type!=='trisavia-avatar-strips'||!exact(value.frame,['width','height','foot'])||value.frame.width!==96||value.frame.height!==64||!exact(value.frame.foot,['x','y'])||value.frame.foot.x!==48||value.frame.foot.y!==39||!exact(value.facing,['default','left','vertical'])||value.facing.default!=='right'||value.facing.left!=='mirror-about-foot'||value.facing.vertical!=='keep-last-horizontal'||!exact(value.fallback,['work','rest'])||value.fallback.work!=='idle'||value.fallback.rest!=='idle'||!value.clips||!['idle','walk'].every(key=>Object.hasOwn(value.clips,key))||Object.keys(value.clips).some(key=>!['idle','walk','work','rest'].includes(key)))invalid();
 for(const [name,clip]of Object.entries(value.clips)){if(!exact(clip,['file','frames','frameMs'])||clip.file!==name+'.png'||!Number.isSafeInteger(clip.frames)||!Number.isSafeInteger(clip.frameMs)||(name==='idle'?clip.frames!==9||clip.frameMs!==125:name==='walk'?clip.frames!==8||clip.frameMs!==100:clip.frames<1||clip.frames>16||clip.frameMs<100||clip.frameMs>1000))invalid();}
 return structuredClone(value);
}
export const customAppearanceKey=value=>{const ref=readCustomAppearance(value);return`${ref.assetId}:1:${ref.digest}`;};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
function fileSet(manifest,files){
 const names=Object.values(manifest.clips).map(clip=>clip.file);if(!Array.isArray(files)||files.length!==names.length||new Set(files.map(file=>file.name)).size!==files.length)invalid();
 for(const file of files){const clip=Object.values(manifest.clips).find(clip=>clip.file===file.name);if(!clip||!sha.test(file.sha256??file.digest)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>2*1024*1024||file.width!==clip.frames*96||file.height!==64)invalid();}return files;
}
async function loadImages(manifest,files,read,key){
 const images=new Map();try{for(const file of fileSet(manifest,files)){const bytes=await read(file);if(bytes.byteLength!==file.bytes||await digest(bytes)!==(file.sha256??file.digest))invalid();const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));if(image.width!==file.width||image.height!==64){image.close();invalid();}images.set(file.name,image);}return{key,manifest,images,dispose(){for(const image of images.values())image.close();images.clear();}};}catch(error){for(const image of images.values())image.close();throw error;}
}
const cache=new Map(),notify=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('avatar:resource'));};
export function customAppearanceState(value){
 const ref=readCustomAppearance(value),key=customAppearanceKey(ref);let state=cache.get(key);if(state)return state;
 state={key,phase:'loading',resource:null,error:null};cache.set(key,state);
 state.promise=(async()=>{
  const response=await fetch(ref.manifestUrl,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Object.assign(Error('custom_avatar_unavailable'),{status:response.status});const bytes=await response.arrayBuffer();if(bytes.byteLength>65536||await digest(bytes)!==ref.digest)invalid();const doc=JSON.parse(new TextDecoder().decode(bytes));if(!exact(doc,['version','manifest','files'])||doc.version!==1)invalid();const manifest=readAvatarManifest(doc.manifest);
  for(const file of fileSet(manifest,doc.files))if(!exact(file,['name','url','sha256','bytes','width','height','contentType'])||file.contentType!=='image/png'||!samePath(file.url,`/v1/avatar-assets/public/${ref.assetId}/1/${file.sha256}/${file.name}`))invalid();
  const resource=await loadImages(manifest,doc.files,async file=>{const result=await fetch(file.url,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});if(!result.ok)throw Object.assign(Error('custom_avatar_unavailable'),{status:result.status});return result.arrayBuffer();},key);
  if(cache.get(key)!==state){resource.dispose();throw new DOMException('Custom appearance superseded','AbortError');}state.resource=resource;state.phase='ready';return resource;
 })().catch(error=>{state.phase='error';state.error=error;state.resource?.dispose();state.resource=null;throw error;}).finally(notify);void state.promise.catch(()=>{});return state;
}
export const loadCustomAppearance=value=>customAppearanceState(value).promise;
export function forgetCustomAppearance(value){if(value?.kind!=='custom')return;const key=customAppearanceKey(value);cache.get(key)?.resource?.dispose();cache.delete(key);}
export function retryCustomAppearance(value){const key=customAppearanceKey(value);cache.get(key)?.resource?.dispose();cache.delete(key);return customAppearanceState(value).promise;}
export async function loadDraftAppearance(draft,readFile){
 if(draft.kind!=='avatar'||draft.validation?.valid!==true)invalid();const manifest=readAvatarManifest(draft.manifest);return loadImages(manifest,draft.files,file=>readFile(file.path),`draft:${draft.agentId}:${draft.assetId}:${draft.version}`);
}
export function drawCustomAppearance(ctx,resource,player,{x=0,y=0,scale=1,action='idle',facing='right',time=performance.now(),paused=false,reducedMotion=false,alpha=1,frameIndex=null}={}){
 const chosen=resource.manifest.clips[action]?action:'idle',clip=resource.manifest.clips[chosen],index=frameIndex===null?player.sample({resourceKey:resource.key,action,frameCount:clip.frames,fps:1000/clip.frameMs,time,paused:paused||reducedMotion,reducedMotion}):Math.max(0,Math.min(clip.frames-1,frameIndex));
 ctx.save();ctx.imageSmoothingEnabled=false;ctx.translate(Math.round(x),Math.round(y));ctx.scale((facing==='left'?-1:1)*scale,scale);ctx.globalAlpha=alpha;ctx.drawImage(resource.images.get(clip.file),index*96,0,96,64,-48,-39,96,64);ctx.restore();return{action:chosen,requestedAction:action,frameIndex:index,fallback:chosen!==action};
}
export function drawCustomUnavailable(ctx,{x=0,y=0,scale=1}={}){ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(scale,scale);ctx.strokeStyle='#68746e';ctx.lineWidth=1;ctx.strokeRect(-7,-15,14,14);ctx.beginPath();ctx.moveTo(-4,-12);ctx.lineTo(4,-4);ctx.moveTo(4,-12);ctx.lineTo(-4,-4);ctx.stroke();ctx.restore();}
if(typeof window!=='undefined')window.addEventListener('pagehide',event=>{if(!event.persisted){for(const state of cache.values())state.resource?.dispose();cache.clear();}});
