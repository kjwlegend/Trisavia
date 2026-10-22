import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {createWorldAudio} from '../../apps/web/public/world-audio.js';
const keys=['ui-confirm','panel-open','panel-close','result-success','result-notice','result-error','world-focus','dialogue-tick-a','dialogue-tick-b','dialogue-tick-c'];
const track=(key:string)=>({duration:key==='bgm'?80:1,sources:[{url:`/assets/audio/town-v1/${key}.wav`,type:'audio/wav'}]});
const manifest={id:'town-v1',version:1,bgm:{...track('bgm'),loop:{start:0,end:80}},sfx:Object.fromEntries(keys.map(key=>[key,track(key)]))};
function fixture(saved:unknown=null){
 let stamp=0,timerId=0;const stored=new Map<string,string>(),timers=new Map<number,()=>void>(),sources:FakeSource[]=[],gains:FakeGain[]=[],contexts:FakeContext[]=[];
 if(saved)stored.set('connet.audio.v1',JSON.stringify(saved));
 class FakeGain{gain={value:1,cancelScheduledValues(){},setValueAtTime(value:number){this.value=value;},linearRampToValueAtTime(value:number){this.value=value;}};connect(){}disconnect(){}}
 class FakeSource{loop=false;loopStart=0;loopEnd=0;buffer=null;stopped=false;started=false;typing=false;peak=0;onended:(()=>void)|null=null;connect(){}disconnect(){}start(){this.started=true;}stop(){this.stopped=true;this.onended?.();}}
 class FakeContext{state='suspended';currentTime=0;destination={};constructor(){contexts.push(this);}createGain(){const gain=new FakeGain();gains.push(gain);return gain;}createBufferSource(){const source=new FakeSource();sources.push(source);return source;}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}async decodeAudioData(){return{duration:80,numberOfChannels:1,getChannelData:()=>Float32Array.of(1,-1)};}}
 const request=async(url:string)=>url.endsWith('manifest.json')?{ok:true,json:async()=>manifest}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};
 const audio=createWorldAudio({storage:{getItem:(key:string)=>stored.get(key),setItem:(key:string,value:string)=>stored.set(key,value)},Context:FakeContext,request,visible:true,now:()=>stamp,setTimer:(callback:()=>void)=>{timers.set(++timerId,callback);return timerId;},clearTimer:(id:number)=>timers.delete(id)});
 return{audio,stored,timers,sources,gains,contexts,advance:(ms=140)=>{stamp+=ms;},flush:()=>{for(const callback of [...timers.values()])callback();timers.clear();}};
}
test('saved preference still waits for enable; the local mixer bounds voices, receipts and worst-case coherent peaks',async()=>{
 const f=fixture({version:1,enabled:true,bgm:1,sfx:1});assert.equal(f.contexts.length,0);assert.equal(await f.audio.cue('panel-open'),false);await f.audio.enable();assert.equal(f.contexts.length,1);assert.equal(f.sources.filter(source=>source.loop&&source.started).length,1);
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
