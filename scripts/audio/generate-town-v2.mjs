import {mkdirSync,writeFileSync,readFileSync,statSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Original score and deterministic synthesis. No samples, soundfonts, network or paid API.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=resolve(ROOT,'apps/web/public/audio/town-v2'),PREVIEW=resolve(ROOT,'outputs/audio-town-v2');
mkdirSync(OUT,{recursive:true});mkdirSync(PREVIEW,{recursive:true});
const SR=48000,BPM=96,BEAT=60/BPM,BAR=4*BEAT,SECONDS=80,FRAMES=SR*SECONDS,TAU=2*Math.PI;
const db=v=>20*Math.log10(Math.max(1e-12,v));
const hz=m=>440*2**((m-69)/12);
const seedRandom=seed=>()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
function run(args){const p=spawnSync('ffmpeg',['-hide_banner','-nostdin','-y',...args],{encoding:'utf8',maxBuffer:8*1024*1024});if(p.status!==0)throw new Error(p.stderr);return p.stderr;}
function wav(path,l,r,float=false){
 const n=l.length,bits=float?32:16,size=n*2*bits/8,b=Buffer.allocUnsafe(44+size);b.write('RIFF');b.writeUInt32LE(size+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(float?3:1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(SR,24);b.writeUInt32LE(SR*2*bits/8,28);b.writeUInt16LE(2*bits/8,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(size,40);
 for(let i=0;i<n;i++)for(let c=0;c<2;c++){const v=(c?r:l)[i];if(float)b.writeFloatLE(v,44+(i*2+c)*4);else b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+(i*2+c)*2);}writeFileSync(path,b);
}
function peakNormalize(l,r,target){let peak=0;for(let i=0;i<l.length;i++)peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));const scale=10**(target/20)/peak;for(let i=0;i<l.length;i++){l[i]*=scale;r[i]*=scale;}}
function metric(path){
 const b=readFileSync(path),offset=b.indexOf(Buffer.from('data')),size=b.readUInt32LE(offset+4),n=size/4,start=offset+8;let peak=0,sum=0,dc=0,step=0;
 for(let i=0;i<n;i++)for(let c=0;c<2;c++){const v=b.readInt16LE(start+i*4+c*2)/32768;peak=Math.max(peak,Math.abs(v));sum+=v*v;dc+=v;if(i)step=Math.max(step,Math.abs(v-b.readInt16LE(start+(i-1)*4+c*2)/32768));}
 const seam=[0,1].map(c=>(b.readInt16LE(start+c*2)-b.readInt16LE(start+(n-1)*4+c*2))/32768);
 return {frames:n,duration:n/SR,sampleRate:SR,channels:2,peakDbFS:+db(peak).toFixed(3),rmsDbFS:+db(Math.sqrt(sum/(n*2))).toFixed(3),dc:+(dc/(n*2)).toFixed(8),maxAdjacentStep:step,loopBoundaryStep:seam};
}
function loudness(path){const log=run(['-i',path,'-af','loudnorm=I=-23:TP=-3:LRA=10:print_format=json','-f','null','-']),json=JSON.parse(log.slice(log.lastIndexOf('{'),log.lastIndexOf('}')+1));return {integratedLUFS:Number(json.input_i),truePeakDbTP:Number(json.input_tp),loudnessRangeLU:Number(json.input_lra),threshold:Number(json.input_thresh),offset:Number(json.target_offset)};}
function decode(path,name){const target=resolve(PREVIEW,name+'-decoded.wav');run(['-i',path,'-ar',String(SR),'-ac','2','-c:a','pcm_s16le',target]);return {...metric(target),...loudness(target)};}

const v1Dir=resolve(ROOT,'apps/web/public/audio/town-v1');
const v1Manifest=JSON.parse(readFileSync(resolve(v1Dir,'manifest.json')));
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const v1Files=['manifest.json',...v1Manifest.bgm.sources.concat(...Object.values(v1Manifest.sfx).map(v=>v.sources)).map(v=>v.url.split('/').pop())];
const before=Object.fromEntries(v1Files.map(file=>[file,digest(resolve(v1Dir,file))]));
const left=new Float64Array(FRAMES),right=new Float64Array(FRAMES);
function note(midi,start,life,level,pan=0,voice='melody',phase=0){
 const n=Math.round(life*SR),begin=Math.round(start*SR),f=hz(midi),lg=Math.sqrt((1-pan)/2),rg=Math.sqrt((1+pan)/2);
 for(let i=0;i<n;i++){
  const t=i/SR,remaining=life-t,attack=1-Math.exp(-t/(voice==='pad'?.30:.0035)),release=Math.sin(Math.min(1,remaining/(voice==='pad'?.8:.025))*Math.PI/2)**2,angle=TAU*f*t+phase;let v;
  if(voice==='pad')v=(Math.sin(angle)+.10*Math.sin(2*angle+.3))*attack*release;
  else if(voice==='bass')v=(Math.sin(angle)+.28*Math.sin(2*angle)+.08*Math.sin(3*angle))*attack*release*Math.exp(-t/.13);
  else if(voice==='chord')v=(Math.sin(angle)+.22*Math.sin(2*angle+.12)+.045*Math.sin(4*angle))*attack*release*Math.exp(-t/.10);
  else v=(Math.sin(angle)*Math.exp(-t/.43)+.30*Math.sin(2*angle+.10)*Math.exp(-t/.16)+.075*Math.sin(3*angle+.20)*Math.exp(-t/.07))*attack*release;
  const j=((begin+i)%FRAMES+FRAMES)%FRAMES;left[j]+=v*level*lg;right[j]+=v*level*rg;
 }
}
function wood(start,level,variant){
 const life=.090,n=Math.round(life*SR),begin=Math.round(start*SR),random=seedRandom(909+variant*33);let filtered=0;
 for(let i=0;i<n;i++){
  const t=i/SR;filtered+=.12*((random()*2-1)-filtered);
  const a=(1-Math.exp(-t/.0015))*Math.exp(-t/.015)*Math.sin(Math.min(1,(life-t)/.009)*Math.PI/2)**2;
  const v=(.65*Math.sin(TAU*(385+variant*13)*t)+.22*Math.sin(TAU*(790+variant*11)*t)+.60*filtered)*a*level,j=(begin+i)%FRAMES;
  left[j]+=v*.72;right[j]+=v*.69;
 }
}
// Original rhythmic recomposition of the v1 D–F#–E / E–A response seed, not a speed conversion.
const chords=[[50,54,57,59,64],[49,57,59,64,69],[47,54,57,62,66],[42,54,57,61,64],[43,55,59,62,66],[42,57,62,64,69],[40,55,59,62,66],[45,57,59,62,64]];
const theme=[
 [[74,0,.55],[78,.75,.70],[76,1.75,.55],[74,2.75,.85]],
 [[76,.5,.60],[69,1.5,.55],[71,2.25,.50],[69,3,.45]],
 [[74,0,.50],[78,.75,.50],[74,1.5,.65],[71,2.5,1]],
 [[69,.25,.70],[73,1.25,.45],[69,2,.50],[66,2.75,.50]],
 [[67,0,.50],[71,.75,.50],[74,1.5,.50],[71,2.25,.50],[69,3,.65]],
 [[66,.5,.75],[69,1.5,.50],[76,2.25,.75]],
 [[64,0,.50],[67,.75,.50],[71,1.5,.50],[67,2.5,.50],[76,3.25,.45]],
 [[69,0,.75],[71,1,.50],[76,1.75,.75],[74,3,.45]],
];
const lift=[
 [[78,0,.50],[81,.75,.55],[83,1.5,.60],[81,2.5,.70]],
 [[81,.25,.55],[78,1,.45],[76,1.75,.65],[73,2.75,.60]],
 [[78,0,.50],[81,.75,.50],[78,1.5,.50],[74,2.25,.50],[71,3,.65]],
 [[73,.5,.55],[76,1.25,.55],[73,2.25,.55],[69,3,.45]],
 [[79,0,.50],[78,.75,.50],[74,1.5,.65],[71,2.5,.80]],
 [[76,.25,.55],[78,1,.55],[74,1.75,.55],[69,2.75,.65]],
 [[71,0,.55],[76,.75,.60],[74,1.75,.55],[71,2.75,.60]],
 [[76,.5,.60],[74,1.5,.60],[71,2.5,.60]],
];
for(let bar=0;bar<32;bar++){
 const chord=chords[bar%8],start=bar*BAR,section=Math.floor(bar/8),gentle=bar%2===1;
 // The first bar already has its bass pulse and soft backbeats inside the first two seconds.
 note(chord[0],start,.43,.089,-.06,'bass');
 // Two deliberately unequal main pulses; the second avoids a mechanical repeated accent.
 note(chord[0],start+2*BEAT,.40,gentle?.065:.078,.04,'bass');
 if(bar%4===0||bar%4===2)note(chord[0]+7,start+1.5*BEAT,.25,.035,.05,'bass');
 if(bar%4===1)note(chord[0]+12,start+3.5*BEAT,.22,.027,-.04,'bass');
 wood(start+BEAT,gentle?.022:.027,bar%3);wood(start+3*BEAT,gentle?.030:.024,(bar+1)%3);
 if([3,10,18,26].includes(bar))wood(start+2.5*BEAT,.012,4);
 const responses=bar%2===0?[.5,2.5]:[1.5,3.5];
 for(let h=0;h<responses.length;h++)for(let v=1;v<4;v++)note(chord[v],start+responses[h]*BEAT,.25,.015*(h? .74:1),v%2?-.40:.40,'chord',v*.18);
 for(let v=2;v<5;v++)note(chord[v],start-.20,BAR+1.05,.007,v%2?-.62:.62,'pad',v*.31);
 let line=section===2?lift[bar%8]:theme[bar%8];
 if(section===1&&bar%8===0)line=[[74,0,.5],[76,.75,.5],[78,1.5,.65],[76,2.75,.65]];
 if(section===3&&bar%8===7)line=[[69,.25,.65],[76,1.5,.7],[74,2.75,.65]];
 for(let k=0;k<line.length;k++){const [midi,beat,length]=line[k];note(midi,start+beat*BEAT,length*BEAT,.075*(k===0?1:.79)*(section===2?.93:1),bar%2?.16:-.16,'melody');}
}
const dryL=left.slice(),dryR=right.slice();
for(const [seconds,gain,cross] of [[.131,.065,true],[.227,.048,false],[.389,.032,true],[.613,.018,false]]){
 const delay=Math.round(seconds*SR);for(let i=0;i<FRAMES;i++){const j=(i-delay+FRAMES)%FRAMES;left[i]+=(cross?dryR:dryL)[j]*gain;right[i]+=(cross?dryL:dryR)[j]*gain;}
}
const name='lanterns-in-the-breeze-light-steps',raw=resolve(PREVIEW,'bgm-synthesis-float.wav'),path=resolve(OUT,name+'.wav');wav(raw,left,right,true);const first=loudness(raw);
run(['-i',raw,'-af',`loudnorm=I=-23:TP=-3:LRA=10:measured_I=${first.integratedLUFS}:measured_TP=${first.truePeakDbTP}:measured_LRA=${first.loudnessRangeLU}:measured_thresh=${first.threshold}:offset=${first.offset}:linear=true`,'-ar',String(SR),'-ac','2','-c:a','pcm_s16le',path]);
const measured={...metric(path),...loudness(path)};
if(measured.frames!==FRAMES||Math.abs(measured.integratedLUFS+23)>.3||measured.truePeakDbTP> -3||measured.loopBoundaryStep.some(v=>Math.abs(v)>.005))throw new Error('v2 PCM duration/loudness/seam check failed');
run(['-i',path,'-c:a','libopus','-b:a','128k','-vbr','on','-application','audio','-fflags','+bitexact',resolve(OUT,name+'.ogg')]);
run(['-i',path,'-c:a','libmp3lame','-q:a','3',resolve(OUT,name+'.mp3')]);
const decoded={ogg:decode(resolve(OUT,name+'.ogg'),'bgm-ogg'),mp3:decode(resolve(OUT,name+'.mp3'),'bgm-mp3')};
for(const [format,value] of Object.entries(decoded))if(value.frames!==FRAMES||value.loopBoundaryStep.some(v=>Math.abs(v)>.005)||value.truePeakDbTP> -3)throw new Error(format+' decoded v2 loop check failed');
const sources=[['ogg','audio/ogg; codecs=opus'],['mp3','audio/mpeg'],['wav','audio/wav']].map(([ext,type])=>{const file=name+'.'+ext,target=resolve(OUT,file);return {url:'/assets/audio/town-v2/'+file,type,bytes:statSync(target).size,sha256:digest(target)};});
const manifest={id:'town-v2',version:2,source:'Original deterministic rhythmic recomposition and synthesis; no third-party samples or audio-generation API.',reproduce:'node scripts/audio/generate-town-v2.mjs',sampleRate:SR,defaultWorldReplacement:true,sharedSfxManifest:'/assets/audio/town-v1/manifest.json',bgm:{id:name,title:'风灯小镇 v2 · 轻步 / Lanterns in the Breeze – Light Steps',usage:'用户已选定的主世界默认背景音乐：轻快律动',status:'active',sources,duration:SECONDS,frames:FRAMES,loop:{start:0,end:SECONDS,startFrame:0,endFrame:FRAMES},recommendedGain:.50,composition:{bpm:BPM,meter:'4/4',bars:32,key:'D major',form:'A / A′ / B / A″, 8 bars each',melodyRange:'D4–B5',rhythm:'Short warm bass on beats 1/3, soft wooden backbeats on 2/4, sparse offbeat chords; no heavy kick/snare or continuous hi-hat',loopMethod:'Circular note tails and room taps; no end fade'},metrics:measured,decoded}};
writeFileSync(resolve(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
run(['-i',path,'-filter_complex','[0:a]asplit=2[a][b];[a]atrim=start=72:end=80,asetpts=PTS-STARTPTS[tail];[b]atrim=start=0:end=8,asetpts=PTS-STARTPTS[head];[tail][head]concat=n=2:v=0:a=1[out]','-map','[out]','-c:a','pcm_s16le',resolve(PREVIEW,'loop-seam-tail8-head8.wav')]);
const after=Object.fromEntries(v1Files.map(file=>[file,digest(resolve(v1Dir,file))]));if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('v1 audio or manifest changed');
writeFileSync(resolve(PREVIEW,'checks.json'),JSON.stringify({bgm:measured,decoded,v1FilesPreserved:before},null,2)+'\n');
writeFileSync(resolve(PREVIEW,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>风灯小镇 · v1/v2 A/B试听</title><style>body{max-width:850px;margin:40px auto;padding:0 20px;background:#fbf8ef;color:#34413e;font:16px/1.75 system-ui}audio{width:min(100%,720px)}section{padding:18px 0;border-bottom:1px solid #d6ded5}small{color:#64746b}</style><h1>风灯小镇 · v1 / v2 A/B试听</h1><p>两版均为80秒、-23 LUFS附近；以下按素材原始响度、相同音量播放。默认暂停，一次只播一条，页面隐藏自动暂停。</p><p><strong>B · v2已被选定为主世界默认，正在接入。上线以交付回执为准。</strong>产品初始BGM50%／SFX55%，打字另乘35%。A · v1保留作对照。</p><section><h2>A · v1 柔和舒缓</h2><p>72 BPM · 24小节 · 风灯小镇</p><audio controls loop preload="none" src="/assets/audio/town-v1/lanterns-in-the-breeze.wav"></audio></section><section><h2>B · v2 轻快律动</h2><p>96 BPM · 32小节 · 轻步：拨弦低音、柔木回拍、反拍和弦</p><audio controls loop preload="none" src="/assets/audio/town-v2/${name}.wav"></audio></section><section><h2>v2循环接缝：尾8秒 → 首8秒</h2><audio controls preload="none" src="/v2-preview/loop-seam-tail8-head8.wav"></audio></section><p><a href="/v1">保留的v1完整试听／12个音效</a> · <a href="/assets/audio/town-v2/manifest.json">v2素材清单</a></p><script>const players=[...document.querySelectorAll('audio')];for(const current of players){current.volume=1;current.addEventListener('play',()=>{for(const other of players)if(other!==current)other.pause()})}document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const player of players)player.pause()});</script></html>`);
for(const file of [raw,resolve(PREVIEW,'bgm-ogg-decoded.wav'),resolve(PREVIEW,'bgm-mp3-decoded.wav')])unlinkSync(file);
console.log(JSON.stringify({manifest:resolve(OUT,'manifest.json'),preview:resolve(PREVIEW,'index.html'),bgm:measured,decoded:Object.fromEntries(Object.entries(decoded).map(([id,v])=>[id,{frames:v.frames,integratedLUFS:v.integratedLUFS,truePeakDbTP:v.truePeakDbTP,loopBoundaryStep:v.loopBoundaryStep}])),v1FilesPreserved:v1Files.length},null,2));
