// One presentation clock per actor/stage. Refreshing the same immutable asset
// and action never restarts its clip; paused observations never catch up later.
export function createClipPlayer(){
 let identity=null,elapsed=0,lastTime=null,wasPaused=false;
 return{
  sample({resourceKey,action,frameCount,fps,time,paused=false,reducedMotion=false}){
   if(typeof resourceKey!=='string'||!resourceKey||typeof action!=='string'||!Number.isSafeInteger(frameCount)||frameCount<1||!Number.isFinite(fps)||fps<=0||fps>60||!Number.isFinite(time))throw Error('avatar_clip_invalid');
   const next=JSON.stringify([resourceKey,action]);
   if(identity!==next){identity=next;elapsed=0;lastTime=time;}
   else if(!paused&&!wasPaused&&lastTime!==null)elapsed+=Math.max(0,time-lastTime);
   lastTime=time;wasPaused=paused;
   return reducedMotion?0:Math.floor(elapsed*fps/1000)%frameCount;
  },
  seek(index,{frameMs,time}){if(!Number.isSafeInteger(index)||index<0||!Number.isFinite(frameMs)||frameMs<=0||!Number.isFinite(time))throw Error('avatar_clip_invalid');elapsed=index*frameMs;lastTime=time;wasPaused=true;},
  clear(){identity=null;elapsed=0;lastTime=null;wasPaused=false;},
 };
}
