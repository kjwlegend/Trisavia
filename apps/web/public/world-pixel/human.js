import {observeCommittedEdge,clearObservedMotion} from './observed-motion.js';
import {createClipPlayer} from './clip-player.js';
import {customAppearanceState,drawCustomAppearance,drawCustomUnavailable} from './custom-appearance.js';
import {resolveLook,drawLook} from './look.js';
// Presentation only. The server appearance and world position remain unchanged.
export const HUMAN_GEOMETRY=Object.freeze({width:96,height:64,anchor:{x:48,y:39},hitBox:{left:-9,right:9,top:-19,bottom:0},minHit:{width:38,height:52},hitPadding:{width:8,height:10}});
export function humanHitSize(geometry,scale){const b=geometry.hitBox;return{width:Math.max(geometry.minHit?.width??44,(b.right-b.left)*scale+(geometry.hitPadding?.width??0)),height:Math.max(geometry.minHit?.height??44,(b.bottom-b.top)*scale+(geometry.hitPadding?.height??0))};}
export function presentationHair(_kit,entry){return resolveLook(entry.fact?.profile.appearance,{avatarId:entry.fact?.id})?.nativeHairKey||null;}
export function humanFrame(kit,entry,frame){const action=entry.walking?'walk':'idle',clip=kit.human.clips[action];let remaining=frame.reducedMotion||frame.paused?0:frame.elapsed%clip.durationMs;for(const current of clip.frames){if(remaining<current.duration)return{action,rect:current.rect};remaining-=current.duration;}return{action,rect:clip.frames[0].rect};}
export function drawHuman(ctx,entry,frame,assets){
  if(entry.fact?.profile.appearance?.kind==='custom'){
    const state=customAppearanceState(entry.fact.profile.appearance),activity=entry.fact.activity,observedAction=entry.walking?'walk':activity?.state==='active'?(activity.actionId==='work.shift'?'work':['rest.bench','rest.voucher'].includes(activity.actionId)?'rest':'idle'):'idle',action=frame.stale?(entry.lastCustomAction||observedAction):observedAction;if(!frame.stale)entry.lastCustomAction=observedAction;entry.customPlayer??=createClipPlayer();
    if(state.resource){const shown=drawCustomAppearance(ctx,state.resource,entry.customPlayer,{x:entry.x,y:entry.y,action,facing:entry.facing,time:frame.elapsed,paused:frame.paused||frame.stale,reducedMotion:frame.reducedMotion,alpha:entry.fact.status==='suspended'?.62:1});entry.customFallback=shown.fallback;entry.customAssetState='ready';if(entry.button){entry.button.dataset.appearanceResource=state.key;entry.button.dataset.appearanceClip=shown.action;entry.button.dataset.appearanceFrame=String(shown.frameIndex);}if(entry.button)entry.button.title=shown.fallback?`未提供${action==='work'?'工作':'休息'}专用动作，使用本角色待机；活动状态来自服务器。`:'';}
    else{drawCustomUnavailable(ctx,{x:entry.x,y:entry.y});entry.customAssetState=state.phase;if(entry.button)entry.button.title=state.phase==='error'?'已应用，形象暂未显示；可从角色资料重试。':'正在读取已应用形象…';}return true;
  }
  return drawLook(ctx,resolveLook(entry.fact?.profile.appearance,{avatarId:entry.fact?.id}),assets.images,{x:entry.x,y:entry.y,action:entry.walking?'walk':'idle',facing:entry.facing,elapsed:frame.elapsed,still:frame.reducedMotion||frame.paused,alpha:entry.fact?.status==='suspended'?.62:1});
}
export function drawHumanFoot(ctx,entry,selected=false,theme='day'){
  ctx.save();ctx.translate(Math.round(entry.x),Math.round(entry.y));ctx.fillStyle='#31492e27';ctx.fillRect(-5,-1,10,2);ctx.fillRect(-3,1,6,1);
  if(selected){ctx.fillStyle=theme==='dusk'?'#e5e8a9':'#f9f7c4';for(const rect of [[-7,-2,3,1],[4,-2,3,1],[-8,-1,1,3],[7,-1,1,3],[-6,3,12,1]])ctx.fillRect(...rect);ctx.fillStyle='#4c7c65';ctx.fillRect(-5,4,10,1);}ctx.restore();
}
// Only committed server edges enter this presentation queue. Integer authority
// stays in entry.fact; every visual layer uses the same continuous footpoint.
function receiveLegacyPosition(entry,agent,{now=performance.now(),serverTime=now}={}){
 const previous=entry.fact,motion=agent.renderMotion,target={x:agent.x,y:agent.y};
 if(previous)advancePosition(entry,now,{serverTime});
 entry.target=target;entry.renderPosition??={...target};entry.segments??=[];
 if(!previous){entry.x=target.x;entry.y=target.y;entry.renderPosition={...target};}
 if(motion){
  if(entry.segmentId!==motion.segmentId){
   const last=entry.segments.at(-1),connected=last&&last.to.x===motion.from.x&&last.to.y===motion.from.y,next=structuredClone(motion);
   // A delivery gap cannot authorize a guessed connector or a diagonal shortcut.
   if(!connected){entry.segments=[];entry.x=motion.from.x;entry.y=motion.from.y;entry.renderPosition={x:entry.x,y:entry.y};}
   // Explicit retargeting can supersede a slower idle display window. Finish
   // its known edge at the corner before the new edge; never blend diagonally.
   if(connected&&last.arriveAt>next.startedAt){let join=serverTime;for(let i=0;i<entry.segments.length;i++){const edge=entry.segments[i];if(i===0)edge.from={x:entry.x,y:entry.y};edge.startedAt=join;edge.arriveAt=join+180;join=edge.arriveAt;}next.startedAt=Math.max(next.startedAt,join);next.arriveAt=Math.max(next.arriveAt,next.startedAt+180);}
   entry.segments.push(next);entry.segmentId=motion.segmentId;
  }
 }else{
  entry.segmentId??=null;const active=entry.segments[0],onEdge=active&&(target.x===active.to.x&&target.y===active.to.y);
  if(onEdge&&entry.walking){entry.segments=[{from:{x:entry.x,y:entry.y},to:target,startedAt:serverTime,arriveAt:Math.max(serverTime+1,Math.min(active.arriveAt,serverTime+180))}];}
  else{entry.segments=[];entry.x=target.x;entry.y=target.y;entry.renderPosition={...target};entry.walking=false;}
 }
 advancePosition(entry,now,{serverTime});
}
export function resetPosition(entry,{newInstance=false}={}){entry.observedMotion=clearObservedMotion(newInstance?null:entry.observedMotion);entry.segments=[];entry.segmentId=null;entry.walking=false;}
export function receivePosition(entry,agent,{now=performance.now(),serverTime=now}={}){
 const motion=agent.renderMotion,legacy=motion?.arriveAt-motion?.startedAt===4000||entry.segments?.some(edge=>edge.arriveAt-edge.startedAt===4000);
 if(legacy){entry.observedMotion=clearObservedMotion(entry.observedMotion);receiveLegacyPosition(entry,agent,{now,serverTime});return;}
 advancePosition(entry,now,{serverTime});entry.target={x:agent.x,y:agent.y};
 const next=observeCommittedEdge(entry.observedMotion,motion,{serverTime,target:entry.target,segments:entry.segments||[]});entry.observedMotion=next.state;entry.segments=next.segments;entry.segmentId=motion?.segmentId??entry.segmentId;
 if(next.relocate){entry.x=next.relocate.x;entry.y=next.relocate.y;entry.renderPosition={x:entry.x,y:entry.y};}
 advancePosition(entry,now,{serverTime});
}
export function advancePosition(entry,now=performance.now(),{serverTime=now}={}){
 const segments=entry.segments;if(!segments?.length){entry.walking=false;return;}
 while(segments.length){const segment=segments[0],start=segment.displayStartedAt??segment.startedAt,end=segment.displayArriveAt??segment.arriveAt,t=Math.max(0,Math.min(1,(serverTime-start)/(end-start)));
  entry.x=segment.from.x+(segment.to.x-segment.from.x)*t;entry.y=segment.from.y+(segment.to.y-segment.from.y)*t;entry.renderPosition={x:entry.x,y:entry.y};
  if(segment.to.x!==segment.from.x)entry.facing=segment.to.x<segment.from.x?'left':'right';
  if(t<1){entry.walking=segment.displayStartedAt===undefined||serverTime>=start;return;}segments.shift();
 }
 entry.walking=false;
}
