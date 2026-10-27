// This queue contains already observed committed edges only. Display windows
// may lag authority; the source points, IDs and timestamps remain immutable.
export const OBSERVED_MOTION_LIMITS=Object.freeze({edges:2,lagMs:2000,readGapMs:2000});
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const key=edge=>JSON.stringify([edge.segmentId,edge.movementId,edge.source,edge.from.x,edge.from.y,edge.to.x,edge.to.y,edge.startedAt,edge.arriveAt,edge.rulesetVersion,edge.topologyVersion]);
const modern=edge=>edge?.status==='committed'&&[500,1000].includes(edge.arriveAt-edge.startedAt);
export function clearObservedMotion(state){return{last:null,lastReadAt:null,watermark:state?.watermark??null};}
export function observeCommittedEdge(state,motion,{serverTime,target,segments=[]}={}){
 const previous=state??clearObservedMotion(),gap=previous.lastReadAt===null?Infinity:serverTime-previous.lastReadAt,next={...previous,lastReadAt:serverTime};
 const result=(mode,queue,relocate=null)=>({state:next,segments:queue,relocate,mode});
 if(!motion){
  if(gap<=OBSERVED_MOTION_LIMITS.readGapMs&&previous.last&&same(target,previous.last.to)&&segments.every(edge=>(edge.displayArriveAt??edge.arriveAt)-edge.arriveAt<=OBSERVED_MOTION_LIMITS.lagMs))return result('settling',segments);
  next.last=null;return result('position',[],target);
 }
 const fingerprint=key(motion),watermark=previous.watermark;
 if(watermark?.segmentId===motion.segmentId&&watermark.key!==fingerprint)return{state:previous,segments,relocate:null,mode:'changed'};
 if(previous.last?.segmentId===motion.segmentId&&key(previous.last)===fingerprint)return result('duplicate',segments,segments.length?null:target);
 if(watermark&&(motion.startedAt<watermark.startedAt||motion.startedAt===watermark.startedAt&&motion.segmentId!==watermark.segmentId)){
  return{state:previous,segments,relocate:null,mode:'old'};
 }
 const freshId=!watermark||motion.segmentId!==watermark.segmentId;
 next.watermark={segmentId:motion.segmentId,startedAt:motion.startedAt,key:fingerprint};next.last=structuredClone(motion);
 const connected=modern(motion)&&modern(previous.last)&&same(previous.last.to,motion.from)&&motion.startedAt>previous.last.startedAt;
 const displayStartedAt=Math.max(serverTime,motion.startedAt,segments.at(-1)?.displayArriveAt??segments.at(-1)?.arriveAt??serverTime),displayArriveAt=displayStartedAt+motion.arriveAt-motion.startedAt;
 if(freshId&&connected&&gap>=0&&gap<=OBSERVED_MOTION_LIMITS.readGapMs&&segments.length<OBSERVED_MOTION_LIMITS.edges&&displayArriveAt-motion.arriveAt<=OBSERVED_MOTION_LIMITS.lagMs){
  return result('buffered',[...segments,{...structuredClone(motion),displayStartedAt,displayArriveAt}]);
 }
 // A first snapshot, gap, unknown connector or exceeded bound relocates using
 // the received authority edge/time. Never fill in or accelerate a missing edge.
 const reason=!freshId?'reset':!connected?'unconnected':gap>OBSERVED_MOTION_LIMITS.readGapMs?'gap':segments.length>=OBSERVED_MOTION_LIMITS.edges?'capacity':'lag';
 return result(reason,serverTime<motion.arriveAt?[structuredClone(motion)]:[],serverTime<motion.arriveAt?motion.from:target);
}
