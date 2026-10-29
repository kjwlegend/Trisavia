import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {createWorldAudio} from '../../apps/web/public/world-audio.js';
const keys=['ui-confirm','panel-open','panel-close','result-success','result-notice','result-error','world-focus','world-step-a','world-step-b','dialogue-tick-a','dialogue-tick-b','dialogue-tick-c'];
const track=(key:string)=>({duration:key==='bgm'?80:1,sources:[{url:`/assets/audio/town-v1/${key}.wav`,type:'audio/wav'}]});
const manifest={id:'town-v1',version:1,sfx:Object.fromEntries(keys.map(key=>[key,track(key)]))},music={id:'town-v2',version:2,bgm:{...track('bgm'),sources:[{url:'/assets/audio/town-v2/bgm.wav',type:'audio/wav'}],loop:{start:0,end:80}}};
function fixture(saved:unknown=null,catalogues={effects:manifest,music}){
 let stamp=0,timerId=0;const stored=new Map<string,string>(),timers=new Map<number,()=>void>(),sources:FakeSource[]=[],gains:FakeGain[]=[],contexts:FakeContext[]=[],requested:string[]=[];
 if(saved)stored.set('connet.audio.v1',JSON.stringify(saved));
 class FakeGain{gain={value:1,cancelScheduledValues(){},setValueAtTime(value:number){this.value=value;},linearRampToValueAtTime(value:number){this.value=value;}};connect(){}disconnect(){}}
 class FakeSource{loop=false;loopStart=0;loopEnd=0;buffer=null;stopped=false;started=false;typing=false;peak=0;onended:(()=>void)|null=null;connect(){}disconnect(){}start(){this.started=true;}stop(){this.stopped=true;this.onended?.();}}
 class FakeContext{state='suspended';currentTime=0;destination={};constructor(){contexts.push(this);}createGain(){const gain=new FakeGain();gains.push(gain);return gain;}createBufferSource(){const source=new FakeSource();sources.push(source);return source;}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}async decodeAudioData(){return{duration:80,numberOfChannels:1,getChannelData:()=>Float32Array.of(1,-1)};}}
 const request=async(url:string)=>{requested.push(url);return url.endsWith('manifest.json')?{ok:true,json:async()=>url.includes('/town-v2/')?catalogues.music:catalogues.effects}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};};
 const audio=createWorldAudio({storage:{getItem:(key:string)=>stored.get(key),setItem:(key:string,value:string)=>stored.set(key,value)},Context:FakeContext,request,visible:true,now:()=>stamp,setTimer:(callback:()=>void)=>{timers.set(++timerId,callback);return timerId;},clearTimer:(id:number)=>timers.delete(id)});
 return{audio,stored,timers,sources,gains,contexts,requested,advance:(ms=140)=>{stamp+=ms;},flush:()=>{for(const callback of [...timers.values()])callback();timers.clear();}};
}
test('default sound is on but stays locked without requests; explicit mute and saved volumes remain local',()=>{
 for(const saved of [null,{version:1,bgm:.3,sfx:.4},{version:1,enabled:true,bgm:.3,sfx:.4}]){const f=fixture(saved);assert.equal(f.audio.snapshot().enabled,true);assert.equal(f.audio.snapshot().unlocked,false);assert.equal(f.audio.snapshot().phase,'locked');assert.deepEqual(f.requested,[]);assert.equal(f.contexts.length,0);if(saved){assert.equal(f.audio.snapshot().bgm,.3);assert.equal(f.audio.snapshot().sfx,.4);}f.audio.dispose();}
 const muted=fixture({version:1,enabled:false,bgm:0,sfx:.25});assert.equal(muted.audio.snapshot().enabled,false);assert.equal(muted.audio.snapshot().bgm,0);assert.equal(muted.audio.snapshot().sfx,.25);assert.deepEqual(muted.requested,[]);muted.audio.dispose();
});
test('saved preference still waits for enable; the local mixer bounds voices, receipts and worst-case coherent peaks',async()=>{
 const f=fixture({version:1,enabled:true,bgm:1,sfx:1});assert.equal(f.contexts.length,0);assert.equal(await f.audio.cue('panel-open'),false);await f.audio.enable();assert.equal(f.contexts.length,1);assert.equal(f.sources.filter(source=>source.loop&&source.started).length,1);assert.deepEqual(f.requested.slice(0,3),['/assets/audio/town-v1/manifest.json','/assets/audio/town-v2/manifest.json','/assets/audio/town-v2/bgm.wav']);assert.equal(f.sources[0]!.loopEnd,80);
 for(let index=0;index<4;index++){f.advance();assert.equal(await f.audio.cue('result-success',{key:'receipt:'+index}),true);}
 assert.equal(f.sources.filter(source=>!source.loop&&source.started&&!source.stopped).length,4);assert.ok(f.gains[0]!.gain.value*5<=.850001,'One full-scale BGM and four coherent full-scale SFX retain digital headroom');f.advance();assert.equal(await f.audio.cue('ui-confirm'),false);
 f.audio.clearEffects();f.advance();assert.equal(await f.audio.cue('result-success',{key:'receipt:0'}),false,'An already heard receipt cannot celebrate again');assert.equal(await f.audio.cue('world-step-a'),false,'Standby footsteps never play through normal UI cues');
 f.audio.volume('bgm',.7);f.audio.volume('sfx',.8);assert.deepEqual(JSON.parse(f.stored.get('connet.audio.v1')!),{version:1,enabled:true,bgm:.7,sfx:.8});f.audio.dispose();
});
test('background/identity boundaries discard pending short sounds; resume brings back only one BGM',async()=>{
 const f=fixture();await f.audio.enable();const pending=f.audio.cue('panel-open',{key:'old-window'});f.audio.setVisible(false);assert.equal(await pending,false);assert.equal(f.contexts[0]!.state,'suspended');assert.ok(f.sources.every(source=>source.stopped));f.advance();assert.equal(await f.audio.cue('result-notice',{key:'background'}),false);
 f.audio.setVisible(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.sources.filter(source=>source.loop&&!source.stopped).length,1);assert.equal(f.sources.filter(source=>!source.loop&&source.started).length,0,'No background queue is replayed');
 f.advance();const oldIdentity=f.audio.cue('world-focus');f.audio.clearEffects();assert.equal(await oldIdentity,false);f.audio.disable();assert.equal(f.timers.size,1);await f.audio.enable();assert.equal(f.timers.size,0);assert.equal(f.sources.filter(source=>source.loop&&!source.stopped).length,1,'Quick off/on does not layer a second BGM');f.audio.disable();f.flush();assert.equal(f.contexts[0]!.state,'suspended');f.audio.dispose();
});
test('reserved glyph hook skips whitespace/punctuation, caps one tick and failure remains isolated',async()=>{
 const f=fixture();await f.audio.enable();assert.equal(await f.audio.typing('stream',0,' '),false);assert.equal(await f.audio.typing('stream',1,'。'),false);assert.equal(await f.audio.typing('stream',2,'字'),true);f.advance(100);assert.equal(await f.audio.typing('stream',3,'符'),false,'Only one tick may be active');f.audio.clearEffects();f.advance(100);assert.equal(await f.audio.typing('stream',3,'符'),true);f.audio.dispose();
 const audio=createWorldAudio({storage:null,Context:class{constructor(){throw Error('unsupported');}},visible:true});assert.equal(await audio.enable(),false);assert.equal(audio.snapshot().phase,'unavailable');assert.equal(await audio.cue('result-error'),false);audio.disable();audio.dispose();
});

test('the selected v2 identity and BGM directory stay strict while all twelve effects remain in v1',async()=>{
 for(const catalogues of [
  {effects:manifest,music:{...music,id:'town-v1'}},
  {effects:manifest,music:{...music,version:1}},
  {effects:manifest,music:{...music,bgm:{...music.bgm,sources:track('bgm').sources}}},
  {effects:{...manifest,sfx:{...manifest.sfx,'world-step-a':music.bgm}},music},
  {effects:manifest,music:{...music,bgm:{...music.bgm,sources:[{url:'/assets/audio/town-v2/../bgm.wav',type:'audio/wav'}]}}},
 ]){const f=fixture(null,catalogues);assert.equal(await f.audio.enable(),false);assert.equal(f.audio.snapshot().phase,'unavailable');assert.equal(f.sources.length,0);f.audio.dispose();}
});
