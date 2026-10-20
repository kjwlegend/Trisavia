// Presentation only. The server appearance and world position remain unchanged.
export const HUMAN_GEOMETRY=Object.freeze({width:96,height:64,anchor:{x:48,y:39},hitBox:{left:-9,right:9,top:-19,bottom:0},minHit:{width:38,height:52},hitPadding:{width:8,height:10}});
export function humanHitSize(geometry,scale){const b=geometry.hitBox;return{width:Math.max(geometry.minHit?.width??44,(b.right-b.left)*scale+(geometry.hitPadding?.width??0)),height:Math.max(geometry.minHit?.height??44,(b.bottom-b.top)*scale+(geometry.hitPadding?.height??0))};}
export function presentationHair(kit,entry){const color=entry.fact?.profile.appearance.color;if(color==='blue')return'curlyhair';if(color==='amber')return'longhair';let index=0;for(const char of String(entry.fact?.id||entry.agentId))index=(index*31+char.charCodeAt(0))>>>0;return kit.human.hairKeys[index%kit.human.hairKeys.length];}
export function humanFrame(kit,entry,frame){const action=entry.walking?'walk':'idle',clip=kit.human.clips[action];let remaining=frame.reducedMotion||frame.paused?0:frame.elapsed%clip.durationMs;for(const current of clip.frames){if(remaining<current.duration)return{action,rect:current.rect};remaining-=current.duration;}return{action,rect:clip.frames[0].rect};}
export function drawHuman(ctx,entry,frame,assets){
  const {action,rect}=humanFrame(assets.kit,entry,frame),layers=assets.kit.human.layers,hair=presentationHair(assets.kit,entry),anchor=assets.kit.human.groundAnchor;
  ctx.save();ctx.translate(Math.round(entry.x),Math.round(entry.y));if(entry.facing==='left')ctx.scale(-1,1);if(entry.fact?.status==='suspended')ctx.globalAlpha=.62;
  for(const key of [layers.base[action],layers[hair][action]])ctx.drawImage(assets.images.get(key),...rect,-anchor[0],-anchor[1],rect[2],rect[3]);ctx.restore();
}
export function drawHumanFoot(ctx,entry,selected=false,theme='day'){
  ctx.save();ctx.translate(Math.round(entry.x),Math.round(entry.y));ctx.fillStyle='#31492e27';ctx.fillRect(-5,-1,10,2);ctx.fillRect(-3,1,6,1);
  if(selected){ctx.fillStyle=theme==='dusk'?'#e5e8a9':'#f9f7c4';for(const rect of [[-7,-2,3,1],[4,-2,3,1],[-8,-1,1,3],[7,-1,1,3],[-6,3,12,1]])ctx.fillRect(...rect);ctx.fillStyle='#4c7c65';ctx.fillRect(-5,4,10,1);}ctx.restore();
}
// A bounded transition is allowed only between two received adjacent facts.
export function receivePosition(entry,agent,{animate=true,now=performance.now()}={}){
  const previous=entry.fact,dx=previous?agent.fact.position.x-previous.position.x:0,dy=previous?agent.fact.position.y-previous.position.y:0;
  const compatible=animate&&previous&&agent.fact.version>previous.version&&Math.abs(dx)+Math.abs(dy)===1&&previous.status!=='suspended'&&agent.fact.status!=='suspended';
  if(dx)entry.facing=dx<0?'left':'right';else entry.facing||='right';
  const changed=!previous||dx!==0||dy!==0;
  if(compatible){entry.transition={from:{x:entry.x,y:entry.y},to:{x:agent.x,y:agent.y},startedAt:now,deadline:now+180};entry.walking=true;}
  else if(changed||!animate||agent.fact.status==='suspended'){entry.x=agent.x;entry.y=agent.y;entry.transition=null;entry.walking=false;}
  entry.target={x:agent.x,y:agent.y};
}
export function advancePosition(entry,now=performance.now(),{paused=false,visible=true}={}){
  if(!entry.transition)return;if(paused||!visible){Object.assign(entry,entry.transition.to);entry.transition=null;entry.walking=false;return;}
  const move=entry.transition,t=Math.max(0,Math.min(1,(now-move.startedAt)/(move.deadline-move.startedAt)));entry.x=move.from.x+(move.to.x-move.from.x)*t;entry.y=move.from.y+(move.to.y-move.from.y)*t;if(t===1){entry.transition=null;entry.walking=false;}
}
