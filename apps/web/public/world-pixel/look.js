import './appearance-catalog.js';
// This finite art dictionary resolves appearance identities, never authority.
export const APPEARANCE_CATALOG=globalThis.PIXEL_APPEARANCE_CATALOG;
export const APPEARANCE_VERSION=APPEARANCE_CATALOG.version;
export const APPEARANCE_DIGEST='30c00558d539a194e6936b24e0179a2558cad4b047251265231388e9c63c2b82';
const looks=new Map(APPEARANCE_CATALOG.appearances.map(look=>[look.key,look]));
export const lookFor=id=>looks.get(id)||null;
export function legacyLook(appearance,{avatarId,rendererHair}={}){
  if(appearance?.template!=='basic')return null;
  const rules=APPEARANCE_CATALOG.legacyResolution;
  if(rendererHair&&rules.rendererHairToAppearanceKey[rendererHair])return lookFor(rules.rendererHairToAppearanceKey[rendererHair]);
  const fixed=rules.knownLegacyColorBranches[appearance.color];if(fixed)return lookFor(fixed);
  if(!['olive','cream','coral'].includes(appearance.color)||typeof avatarId!=='string'||!avatarId)return null;
  let index=0;for(const char of avatarId)index=(index*31+char.charCodeAt(0))>>>0;
  return lookFor(rules.rendererHairToAppearanceKey[APPEARANCE_CATALOG.legacyHashOrder[index%APPEARANCE_CATALOG.legacyHashOrder.length]]);
}
export function resolveLook(appearance,legacyEvidence){
  if(typeof appearance?.lookId==='string')return appearance.catalogVersion===APPEARANCE_VERSION?lookFor(appearance.lookId):null;
  return legacyLook(appearance,legacyEvidence);
}
export function lookFrame(action='idle',elapsed=0,still=false){
  const clip=APPEARANCE_CATALOG.shared.clips[action];if(!clip)return null;
  const duration=clip.frames.reduce((sum,frame)=>sum+frame.durationMs,0);let remaining=still?0:Math.max(0,elapsed)%duration;
  for(const frame of clip.frames){if(remaining<frame.durationMs)return frame;remaining-=frame.durationMs;}return clip.frames[0];
}
export function drawLookPlaceholder(ctx,{x=0,y=0,scale=1}={}){
  ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(scale,scale);ctx.fillStyle='#718370';ctx.fillRect(-5,-18,10,8);ctx.fillRect(-6,-9,12,8);ctx.fillRect(-4,-1,3,1);ctx.fillRect(1,-1,3,1);ctx.restore();
}
export function drawLook(ctx,look,images,{x=0,y=0,scale=1,action='idle',facing='right',elapsed=0,still=false,alpha=1}={}){
  const definition=typeof look==='string'?lookFor(look):look,frame=lookFrame(action,elapsed,still),layers=definition?.clips?.[action]?.layers;
  if(!definition||!frame||!layers||layers.some(layer=>!images?.get(layer.imageKey))){drawLookPlaceholder(ctx,{x,y,scale});return false;}
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.translate(Math.round(x),Math.round(y));ctx.scale((facing==='left'?-1:1)*scale,scale);ctx.globalAlpha=alpha;
  for(const layer of layers)ctx.drawImage(images.get(layer.imageKey),...frame.rect,-definition.groundAnchor[0],-definition.groundAnchor[1],...APPEARANCE_CATALOG.shared.frameSize);
  ctx.restore();return true;
}
