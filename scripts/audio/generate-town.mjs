import {mkdirSync,writeFileSync,readFileSync,statSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Original score and deterministic synthesis. No samples, soundfonts, network or paid API.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=resolve(ROOT,'apps/web/public/audio/town-v1'),PREVIEW=resolve(ROOT,'outputs/audio-town-v1');
mkdirSync(OUT,{recursive:true});mkdirSync(PREVIEW,{recursive:true});
const SR=48000,BPM=72,BEAT=60/BPM,BAR=4*BEAT,SECONDS=80,FRAMES=SR*SECONDS,TAU=2*Math.PI;
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

const left=new Float64Array(FRAMES),right=new Float64Array(FRAMES);
function addNote(midi,start,duration,amplitude,pan,voice='felt',phase=0){
 const startFrame=Math.round(start*SR),count=Math.round(duration*SR),frequency=hz(midi),lg=Math.sqrt((1-pan)/2),rg=Math.sqrt((1+pan)/2);
 for(let i=0;i<count;i++){
  const t=i/SR,x=t/duration,attack=1-Math.exp(-t/(voice==='pad'?.34:voice==='bass'?.09:.006)),release=Math.sin(Math.min(1,(1-x)/(voice==='pad'?.38:.2))*Math.PI/2)**2;
  const fundamental=TAU*frequency*t+phase;let sample;
  if(voice==='pad')sample=(Math.sin(fundamental)+.20*Math.sin(fundamental*2+.3)+.08*Math.sin(fundamental*3))*attack*release*(.83+.17*Math.sin(Math.PI*x));
  else if(voice==='bass')sample=(Math.sin(fundamental)+.10*Math.sin(fundamental*2))*attack*release*Math.exp(-t*.32);
  else sample=(Math.sin(fundamental)*Math.exp(-t/1.35)+.32*Math.sin(fundamental*2+.12)*Math.exp(-t/.55)+.10*Math.sin(fundamental*3+.25)*Math.exp(-t/.23)+.035*Math.sin(fundamental*5)*Math.exp(-t/.08))*attack*release;
  const frame=((startFrame+i)%FRAMES+FRAMES)%FRAMES;left[frame]+=sample*amplitude*lg;right[frame]+=sample*amplitude*rg;
 }
}
// Dmaj9 | Aadd9/C# | Bm7 | F#m7 | Gmaj9 | Dadd9/F# | Em9 | Asus4(add9).
const chords=[[50,57,61,64,66],[49,57,59,64,69],[47,54,57,62,66],[42,54,57,61,64],[43,55,59,62,66],[42,57,62,64,69],[40,55,59,62,66],[45,57,59,62,64]];
const melody=[
 [[74,0],[78,1.5],[76,3]],[[76,.5],[69,2.5]],[[74,0],[71,2]],[[69,.5],[66,2.5]],[[67,0],[71,1.75],[69,3]],[[66,.5],[76,2.25]],[[64,.5],[67,2]],[[69,0],[76,2.5]],
 [[74,.25],[78,2.25]],[[76,.5],[81,2.5]],[[78,0],[74,2]],[[73,.75],[69,2.5]],[[71,0],[74,1.75],[76,3]],[[69,.5],[66,2.5]],[[67,.5],[76,2.25]],[[76,0],[69,2.5]],
 [[78,0],[81,1.5],[83,3]],[[81,.5],[76,2.5]],[[78,0],[74,1.5],[71,3]],[[69,.5],[73,2.5]],[[79,0],[78,1.5],[74,3]],[[76,.25],[78,1.75],[69,3]],[[67,.5],[76,2.5]],[[76,.5]],
];
for(let bar=0;bar<24;bar++){
 const chord=[...chords[bar%8]],start=bar*BAR;
 if(bar>=8&&bar<16){chord[1]+=12;if(bar%2===0)chord[2]+=12;}
 addNote(chord[0],start+.05,BAR+.7,.055,-.06,'bass',.2);
 for(let v=1;v<chord.length;v++)addNote(chord[v],start-.30,BAR+1.75,.018,v%2?-.57:.57,'pad',v*.47);
 for(const [note,beat] of melody[bar])addNote(note,start+beat*BEAT,3.15,note>80?.055:.073,bar%2? .17:-.17,'felt');
 // Very sparse lower wooden answers, never a metronomic arpeggio.
 if([2,5,10,13,18,21].includes(bar))addNote(chord[2],start+3.25*BEAT,1.9,.032,bar%2?-.36:.36,'felt',.1);
}
// Circular room taps wrap tails into the beginning; no end fade or empty loop gap.
const dryL=left.slice(),dryR=right.slice();
for(const [seconds,gain,cross] of [[.137,.105,true],[.239,.085,false],[.397,.070,true],[.571,.055,false],[.811,.040,true],[1.093,.027,false],[1.477,.018,true]]){
 const delay=Math.round(seconds*SR);for(let i=0;i<FRAMES;i++){const source=(i-delay+FRAMES)%FRAMES;left[i]+=(cross?dryR:dryL)[source]*gain;right[i]+=(cross?dryL:dryR)[source]*gain;}
}
const raw=resolve(PREVIEW,'bgm-synthesis-float.wav'),bgmWav=resolve(OUT,'lanterns-in-the-breeze.wav');wav(raw,left,right,true);
const first=loudness(raw);
run(['-i',raw,'-af',`loudnorm=I=-23:TP=-3:LRA=10:measured_I=${first.integratedLUFS}:measured_TP=${first.truePeakDbTP}:measured_LRA=${first.loudnessRangeLU}:measured_thresh=${first.threshold}:offset=${first.offset}:linear=true`,'-ar',String(SR),'-ac','2','-c:a','pcm_s16le',bgmWav]);
const bgmMetric={...metric(bgmWav),...loudness(bgmWav)};
if(bgmMetric.frames!==FRAMES||bgmMetric.integratedLUFS< -24||bgmMetric.integratedLUFS> -21||bgmMetric.truePeakDbTP> -3)throw new Error('BGM duration/loudness check failed');
if(bgmMetric.loopBoundaryStep.some(v=>Math.abs(v)>.005))throw new Error('Unexpected PCM loop boundary discontinuity');

const effects=[
 ['ui-confirm',.080,'木质轻确认','active',[[74,0,.07,.6]],'wood'],
 ['panel-open',.220,'打开面板，柔升双音','active',[[69,.008,.13,.65],[74,.073,.14,.55]],'tone'],
 ['panel-close',.170,'关闭面板，柔落双音','active',[[71,.005,.10,.55],[66,.055,.11,.50]],'tone'],
 ['result-success',.560,'实际轻成功，低调三音','active',[[62,0,.31,.55],[66,.135,.31,.50],[69,.270,.28,.48]],'tone'],
 ['result-notice',.320,'中性通知或尚未完成','active',[[62,0,.29,.55],[69,.075,.23,.30]],'tone'],
 ['result-error',.260,'实际未成功的柔和反馈，非警报','active',[[50,0,.24,.55],[51,.026,.23,.27]],'tone'],
 ['world-focus',.200,'选择并定位当前对象','active',[[69,.004,.13,.55],[74,.070,.12,.44]],'tone'],
 ['world-step-a',.090,'柔砂木脚步备用，不自动接线','standby',[[50,0,.085,.32]],'step'],
 ['world-step-b',.100,'第二种柔砂木脚步备用','standby',[[52,0,.095,.32]],'step'],
 ['dialogue-tick-a',.032,'真实逐字呈现备用，不伪造聊天','standby',[[62,0,.030,.25]],'paper'],
 ['dialogue-tick-b',.036,'真实逐字呈现的纸木变体','standby',[[64,0,.034,.25]],'paper'],
 ['dialogue-tick-c',.040,'真实逐字呈现的第三变体','standby',[[59,0,.038,.25]],'paper'],
];
const sfx={};
for(let e=0;e<effects.length;e++){
 const [id,duration,usage,status,notes,voice]=effects[e],n=Math.round(duration*SR),l=new Float64Array(n),r=new Float64Array(n),random=seedRandom(74003+e*73);let noise=0;
 for(let i=0;i<n;i++){
  const t=i/SR,envelope=Math.sin(Math.min(1,t/.002)*Math.PI/2)**2*Math.sin(Math.min(1,(duration-t-1/SR)/.006)*Math.PI/2)**2;noise+=.16*((random()*2-1)-noise);let value=0;
  for(const [note,at,life,level] of notes){const q=t-at;if(q>=0&&q<life){const a=(1-Math.exp(-q/.0025))*Math.exp(-q/(voice==='tone'?.075:.014))*Math.sin(Math.min(1,(life-q)/.012)*Math.PI/2)**2,f=hz(note);value+=(Math.sin(TAU*f*q)+.14*Math.sin(TAU*f*2.7*q))*a*level;}}
  if(voice!=='tone')value+=noise*Math.exp(-t/(voice==='step'?.024:.007))*(voice==='step'?1.0:.50);
  l[i]=value*envelope;r[i]=value*envelope;
 }
 l[0]=r[0]=l[n-1]=r[n-1]=0;peakNormalize(l,r,id.startsWith('dialogue')?-18:-10);
 const path=resolve(OUT,id+'.wav');wav(path,l,r);sfx[id]={id,usage,status,duration,loop:null,recommendedGain:.55,...(id.startsWith('dialogue')?{recommendedMultiplier:.35}:{}),metrics:metric(path)};
 const measured=sfx[id].metrics,quiet=id.startsWith('dialogue');
 if(measured.frames!==n||measured.loopBoundaryStep.some(value=>value!==0)||measured.peakDbFS<(quiet?-20:-12)||measured.peakDbFS>(quiet?-16:-8))throw new Error(id+' duration, envelope or peak check failed');
}
function encode(id){
 const input=resolve(OUT,id+'.wav'),ogg=resolve(OUT,id+'.ogg'),mp3=resolve(OUT,id+'.mp3');
 run(['-i',input,'-c:a','libopus','-b:a',id==='lanterns-in-the-breeze'?'128k':'64k','-vbr','on','-application','audio','-fflags','+bitexact',ogg]);
 run(['-i',input,'-c:a','libmp3lame','-q:a','3',mp3]);
 return [{url:'/assets/audio/town-v1/'+id+'.ogg',type:'audio/ogg; codecs=opus'},{url:'/assets/audio/town-v1/'+id+'.mp3',type:'audio/mpeg'},{url:'/assets/audio/town-v1/'+id+'.wav',type:'audio/wav'}].map(source=>{const path=resolve(ROOT,'apps/web/public',source.url.slice('/assets/'.length));return {...source,bytes:statSync(path).size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};});
}
const bgmSources=encode('lanterns-in-the-breeze');for(const [id,value] of Object.entries(sfx))value.sources=encode(id);
const decoded={ogg:decode(resolve(OUT,'lanterns-in-the-breeze.ogg'),'bgm-ogg'),mp3:decode(resolve(OUT,'lanterns-in-the-breeze.mp3'),'bgm-mp3')};
for(const [format,value] of Object.entries(decoded))if(value.frames!==FRAMES||value.loopBoundaryStep.some(v=>Math.abs(v)>.005)||value.truePeakDbTP> -3)throw new Error(format+' decoded loop check failed');
const manifest={id:'town-v1',version:1,source:'Original deterministic composition and synthesis; no third-party samples or audio-generation API.',reproduce:'node scripts/audio/generate-town.mjs',sampleRate:SR,bgm:{id:'lanterns-in-the-breeze',title:'风灯小镇 / Lanterns in the Breeze',usage:'梦幻小镇背景音乐，安静、留白，无鼓点推进',status:'active',sources:bgmSources,duration:SECONDS,frames:FRAMES,loop:{start:0,end:SECONDS,startFrame:0,endFrame:FRAMES},recommendedGain:.50,composition:{bpm:BPM,meter:'4/4',bars:24,key:'D major, pentatonic emphasis',form:'A / A′ / B, 8 bars each',melodyRange:'D4–B5',loopMethod:'Circular note tails and room taps; no end fade'},metrics:bgmMetric,decoded},sfx};
writeFileSync(resolve(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
run(['-i',bgmWav,'-filter_complex','[0:a]asplit=2[a][b];[a]atrim=start=72:end=80,asetpts=PTS-STARTPTS[tail];[b]atrim=start=0:end=8,asetpts=PTS-STARTPTS[head];[tail][head]concat=n=2:v=0:a=1[out]','-map','[out]','-c:a','pcm_s16le',resolve(PREVIEW,'loop-seam-tail8-head8.wav')]);
// 64-second audition: music opening, all twelve SFX with breathing room, then the actual seam.
const montageInputs=effects.flatMap(([id])=>['-i',resolve(OUT,id+'.wav')]);
const pieces=['[0:a]atrim=0:30,asetpts=PTS-STARTPTS,volume=0.5[first]'];let at=31;
for(let i=0;i<effects.length;i++){pieces.push(`[${i+1}:a]volume=${effects[i][0].startsWith('dialogue')?.55*.35:.55},adelay=${Math.round(at*1000)}|${Math.round(at*1000)}[fx${i}]`);at+=1.25;}
pieces.push(`[0:a]atrim=72:80,asetpts=PTS-STARTPTS,volume=0.5,adelay=48000|48000[tail]`,'[0:a]atrim=0:8,asetpts=PTS-STARTPTS,volume=0.5,adelay=56000|56000[head]');
pieces.push('[first]'+effects.map((_,i)=>`[fx${i}]`).join('')+'[tail][head]amix=inputs=15:normalize=0,apad,atrim=0:64[out]');
run(['-i',bgmWav,...montageInputs,'-filter_complex',pieces.join(';'),'-map','[out]','-c:a','pcm_s16le',resolve(PREVIEW,'town-audio-montage-64s.wav')]);
writeFileSync(resolve(PREVIEW,'checks.json'),JSON.stringify({bgm:bgmMetric,decoded,sfx:Object.fromEntries(Object.entries(sfx).map(([id,value])=>[id,value.metrics]))},null,2)+'\n');
const rows=effects.map(([id,,usage])=>`<li><strong>${id}</strong> — ${usage}<br><audio controls preload="none" src="/assets/audio/town-v1/${id}.wav"></audio></li>`).join('');
writeFileSync(resolve(PREVIEW,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>风灯小镇 · 原创音频试听</title><style>body{max-width:900px;margin:40px auto;padding:0 20px;background:#fbf8ef;color:#34413e;font:16px/1.7 system-ui}audio{width:min(100%,620px)}li{margin:18px 0}button{font:inherit;padding:8px 18px}small{color:#64746b}</style><h1>风灯小镇 / Lanterns in the Breeze</h1><p>原创确定性合成。点击才播放；此页不接真实账号或产品事件。听感待负责人和用户确认。</p><p>80秒 · 72 BPM · D大调 · A/A′/B · 48kHz/16bit stereo</p><h2>完整配乐 WAV</h2><audio controls loop preload="none" src="/assets/audio/town-v1/lanterns-in-the-breeze.wav"></audio><h2>OGG Opus 循环</h2><audio controls loop preload="none" src="/assets/audio/town-v1/lanterns-in-the-breeze.ogg"></audio><h2>接缝：尾8秒 → 首8秒</h2><audio controls preload="none" src="/preview/loop-seam-tail8-head8.wav"></audio><h2>64秒综合试听</h2><p><small>0–30秒配乐；31–45秒短音效；48–64秒尾首接缝。音效只供试听，不代表服务成功或真实对话。</small></p><audio controls preload="none" src="/preview/town-audio-montage-64s.wav"></audio><h2>短音效</h2><ul>${rows}</ul><p><a href="/assets/audio/town-v1/manifest.json">素材及实测清单</a></p></html>`);
// Only this run's named intermediate verification files are removed; audition files stay available.
for(const path of [raw,resolve(PREVIEW,'bgm-ogg-decoded.wav'),resolve(PREVIEW,'bgm-mp3-decoded.wav')])unlinkSync(path);
console.log(JSON.stringify({manifest:resolve(OUT,'manifest.json'),preview:resolve(PREVIEW,'index.html'),bgm:bgmMetric,decoded:Object.fromEntries(Object.entries(decoded).map(([id,v])=>[id,{frames:v.frames,integratedLUFS:v.integratedLUFS,truePeakDbTP:v.truePeakDbTP,loopBoundaryStep:v.loopBoundaryStep}])),sfx:effects.length},null,2));
