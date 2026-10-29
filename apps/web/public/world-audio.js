const preferenceKey='connet.audio.v1',manifestUrl='/assets/audio/town-v1/manifest.json',bgmManifestUrl='/assets/audio/town-v2/manifest.json';
const liveCues=new Set(['ui-confirm','panel-open','panel-close','result-success','result-notice','result-error','world-focus']);
const ticks=['dialogue-tick-a','dialogue-tick-b','dialogue-tick-c'];
const sfxKeys=[...liveCues,'world-step-a','world-step-b',...ticks];
const sfxSource=/^\/assets\/audio\/town-v1\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:ogg|mp3|wav)$/,bgmSource=/^\/assets\/audio\/town-v2\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:ogg|mp3|wav)$/;
const clamp=value=>Math.max(0,Math.min(1,value));
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function emitWorldAudio(cue,key=''){
  try{globalThis.document?.dispatchEvent(new CustomEvent('town:audio',{detail:{cue,key}}));}catch{/* Audio never interrupts an interface action. */}
}

// One local mixer, with no notification polling, playback queue or world writes.
export function createWorldAudio({storage=browserStorage(),request=globalThis.fetch,Context=globalThis.AudioContext||globalThis.webkitAudioContext,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,visible=!globalThis.document?.hidden}={}){
  let preferences={enabled:true,bgm:.5,sfx:.55};
  try{const saved=JSON.parse(storage?.getItem(preferenceKey)||'null');if(saved?.version===1){preferences={enabled:saved.enabled!==false,bgm:Number.isFinite(saved.bgm)?clamp(saved.bgm):.5,sfx:Number.isFinite(saved.sfx)?clamp(saved.sfx):.55};}}catch{}
  let context=null,masterGain=null,bgmGain=null,sfxGain=null,manifest=null,loading=null,bgm=null,bgmPeak=0,offset=0,bgmStarted=0,unlocked=false,disposed=false,generation=0,effectGeneration=0,quietTimer=null,lastCue=-Infinity,phase='locked';
  const buffers=new Map(),voices=new Set(),seen=new Map(),listeners=new Set();
  const snapshot=()=>({...preferences,phase,unlocked,visible});
  const emit=()=>{for(const listener of listeners)listener(snapshot());};
  function persist(){try{storage?.setItem(preferenceKey,JSON.stringify({version:1,...preferences}));}catch{}}
  function ramp(node,value,duration=.16){if(!context||!node)return;const time=context.currentTime;try{node.gain.cancelScheduledValues(time);node.gain.setValueAtTime(node.gain.value,time);node.gain.linearRampToValueAtTime(value,time+duration);}catch{}}
  // Sum decoded absolute peaks, not nominal file levels. Before starting a new
  // voice, reduce the master immediately so even coherent peaks stay below .85.
  function headroom(){if(!context||!masterGain)return;const peak=(bgm?bgmPeak*Math.max(preferences.bgm,bgmGain.gain.value):0)+[...voices].reduce((sum,source)=>sum+source.peak*(source.typing?.35:1),0)*Math.max(preferences.sfx,sfxGain.gain.value),value=Math.min(1,.85/Math.max(.000001,peak));ramp(masterGain,value,value<masterGain.gain.value?0:.08);}
  function clearVoices(){effectGeneration++;for(const source of voices){try{source.stop();source.disconnect();}catch{}}voices.clear();headroom();}
  function stopBgm(){if(!bgm)return;if(manifest)offset=(offset+Math.max(0,context.currentTime-bgmStarted))%manifest.bgm.duration;try{bgm.stop();bgm.disconnect();}catch{}bgm=null;}
  function active(){return !disposed&&preferences.enabled&&unlocked&&visible&&context?.state==='running';}
  function clearQuiet(){if(quietTimer!==null)clearTimer(quietTimer);quietTimer=null;}
  function quiet(immediate=false){generation++;clearQuiet();clearVoices();ramp(bgmGain,0,immediate?0:.2);ramp(sfxGain,0,immediate?0:.2);const stop=()=>{quietTimer=null;stopBgm();try{context?.suspend()?.catch(()=>{});}catch{}};if(immediate)stop();else quietTimer=setTimer(stop,210);}
  function validTrack(track,path){return track&&Number.isFinite(track.duration)&&track.duration>0&&Array.isArray(track.sources)&&track.sources.length>0&&track.sources.length<=3&&track.sources.every(source=>typeof source.type==='string'&&path.test(source.url));}
  async function loadManifest(){
    if(manifest)return manifest;if(loading)return loading;
    loading=(async()=>{const response=await request(manifestUrl,{credentials:'omit'});if(!response.ok)throw Error('audio_unavailable');const value=await response.json();if(value?.id!=='town-v1'||value.version!==1||!sfxKeys.every(key=>validTrack(value.sfx?.[key],sfxSource)))throw Error('audio_manifest_invalid');const bgmResponse=await request(bgmManifestUrl,{credentials:'omit'});if(!bgmResponse.ok)throw Error('audio_unavailable');const music=await bgmResponse.json(),loop=music?.bgm?.loop;if(music?.id!=='town-v2'||music.version!==2||!validTrack(music.bgm,bgmSource)||!loop||loop.start!==0||!Number.isFinite(loop.end)||loop.end<=0||loop.end>music.bgm.duration)throw Error('audio_manifest_invalid');manifest={...value,bgm:music.bgm};return manifest;})();
    try{return await loading;}finally{loading=null;}
  }
  async function buffer(track){
    const key=track.sources[0].url;if(buffers.has(key))return buffers.get(key);
    const pending=(async()=>{for(const source of track.sources)try{const response=await request(source.url,{credentials:'omit'});if(!response.ok)continue;const decoded=await context.decodeAudioData(await response.arrayBuffer());let peak=0;for(let channel=0;channel<decoded.numberOfChannels;channel++){const samples=decoded.getChannelData(channel);for(let index=0;index<samples.length;index++)peak=Math.max(peak,Math.abs(samples[index]));}if(!Number.isFinite(peak))continue;decoded.townPeak=peak;return decoded;}catch{}throw Error('audio_unavailable');})();buffers.set(key,pending);
    try{return await pending;}catch(error){buffers.delete(key);throw error;}
  }
  async function startBgm(turn){
    const decoded=await buffer(manifest.bgm);if(turn!==generation||!active())return;if(bgm){ramp(bgmGain,preferences.bgm,.8);return;}
    const source=context.createBufferSource();source.buffer=decoded;source.loop=true;source.loopStart=manifest.bgm.loop.start;source.loopEnd=Math.min(manifest.bgm.loop.end,decoded.duration);offset%=source.loopEnd;source.connect(bgmGain);bgm=source;bgmPeak=decoded.townPeak;bgmStarted=context.currentTime;headroom();source.start(0,offset);ramp(bgmGain,preferences.bgm,.8);
  }
  async function resume(){
    if(!preferences.enabled||!unlocked||!visible||disposed)return false;const turn=++generation;clearQuiet();
    try{await context.resume();await loadManifest();if(turn!==generation||!active())return false;ramp(sfxGain,preferences.sfx);await startBgm(turn);if(turn!==generation||!active())return false;phase='playing';emit();return true;}
    catch{if(turn===generation&&!disposed){phase='unavailable';emit();}return false;}
  }
  async function enable(){
    if(disposed)return false;preferences.enabled=true;persist();
    try{if(!context){if(!Context)throw Error('audio_unavailable');context=new Context();masterGain=context.createGain();bgmGain=context.createGain();sfxGain=context.createGain();bgmGain.gain.value=0;sfxGain.gain.value=0;bgmGain.connect(masterGain);sfxGain.connect(masterGain);masterGain.connect(context.destination);}unlocked=true;phase='loading';emit();return await resume();}
    catch{phase='unavailable';emit();return false;}
  }
  function disable(){preferences.enabled=false;persist();quiet();phase='off';emit();}
  function volume(channel,value){if(!['bgm','sfx'].includes(channel)||!Number.isFinite(value))return;preferences[channel]=clamp(value);persist();if(active()){headroom();ramp(channel==='bgm'?bgmGain:sfxGain,preferences[channel]);}emit();}
  async function cue(name,{key='',typing=false}={}){
    if(!active()||!manifest||!(liveCues.has(name)||typing&&ticks.includes(name)))return false;
    const stamp=now(),minimum=typing?90:130;
    if(stamp-lastCue<minimum||voices.size>=4||typing&&[...voices].some(source=>source.typing)||key&&seen.has(key))return false;
    lastCue=stamp;if(key){seen.set(key,stamp);if(seen.size>256)seen.delete(seen.keys().next().value);}
    const turn=generation,effects=effectGeneration;
    try{const decoded=await buffer(manifest.sfx[name]);if(turn!==generation||effects!==effectGeneration||!active()||voices.size>=4||typing&&[...voices].some(source=>source.typing)||now()-stamp>250)return false;const source=context.createBufferSource(),gain=context.createGain();source.buffer=decoded;source.typing=typing;source.peak=decoded.townPeak;gain.gain.value=typing?.35:1;source.connect(gain);gain.connect(sfxGain);voices.add(source);source.onended=()=>{voices.delete(source);headroom();try{source.disconnect();gain.disconnect();}catch{}};headroom();source.start();return true;}
    catch{return false;}
  }
  function setVisible(value){if(visible===Boolean(value)||disposed)return;visible=Boolean(value);if(!visible)quiet(true);else if(unlocked&&preferences.enabled)void resume();emit();}
  return{snapshot,enable,disable,volume,cue,clearEffects:clearVoices,
    // Reserved for a real revealed glyph. Reading a complete message never calls this.
    typing:(streamId,index,glyph)=>typeof streamId==='string'&&streamId&&Number.isSafeInteger(index)&&index>=0&&typeof glyph==='string'&&/[\p{L}\p{N}]/u.test(glyph)?cue(ticks[index%3],{key:`typing:${streamId}:${index}`,typing:true}):Promise.resolve(false),
    setVisible,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    dispose(){if(disposed)return;quiet(true);disposed=true;try{context?.close()?.catch(()=>{});}catch{}listeners.clear();buffers.clear();seen.clear();},
  };
}
