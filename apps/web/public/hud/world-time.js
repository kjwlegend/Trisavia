const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function shanghaiTime(epoch){const p=Object.fromEntries(formatter.formatToParts(epoch).map(part=>[part.type,part.value])),minute=Number(p.hour)*60+Number(p.minute)+Number(p.second)/60+((epoch%1000+1000)%1000)/60000;return{minute,period:minute>=360&&minute<1020?'day':minute>=1020&&minute<1140?'dusk':'night',text:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`};}
const palettes={day:{color:[217,138,96],opacity:0,lamps:0,people:1},dusk:{color:[217,138,96],opacity:.12,lamps:.65,people:1.06},night:{color:[12,20,38],opacity:.70,lamps:1,people:1.12}};
// Only the map's presentation follows real Shanghai time. No world action or
// simulation clock uses these colors; each boundary blends over thirty minutes.
export function daylightAt(epoch,{reducedMotion=false}={}){
  const {minute,period}=shanghaiTime(epoch);let from=period,to=period,t=0;
  if(!reducedMotion)for(const [boundary,a,b]of [[360,'night','day'],[1020,'day','dusk'],[1140,'dusk','night']])if(minute>=boundary-15&&minute<=boundary+15){from=a;to=b;t=(minute-boundary+15)/30;t=t*t*(3-2*t);break;}
  const a=palettes[from],b=palettes[to],mix=(x,y)=>x+(y-x)*t;
  return{period,color:a.color.map((value,index)=>Math.round(mix(value,b.color[index]))),opacity:mix(a.opacity,b.opacity),lamps:mix(a.lamps,b.lamps),people:mix(a.people,b.people),nightAmount:mix(from==='night'?1:0,to==='night'?1:0),ambientOpacity:mix(from==='night'?0:a.opacity,to==='night'?0:b.opacity),ambientColor:from==='night'?b.color:to==='night'?a.color:a.color.map((value,index)=>Math.round(mix(value,b.color[index])))};
}
export function createSceneClock({now=()=>performance.now(),wallNow=Date.now}={}){
  let base=wallNow(),anchor=now(),last=anchor,correction=0,target=0,instance='',source='local';
  function read(){const stamp=now(),elapsed=Math.max(0,stamp-last);correction+=Math.max(-elapsed*.05,Math.min(elapsed*.05,target-correction));last=stamp;return base+Math.max(0,stamp-anchor)+correction;}
  return{now:read,get source(){return source;},calibrate(epoch,instanceId,timeSource='serverTime'){
    if(!Number.isSafeInteger(epoch)||epoch<0||epoch>8.64e15)return false;
    const difference=epoch-read();if(source==='local'||instance!==instanceId||Math.abs(difference)>30000){base=epoch;anchor=last=now();correction=target=0;instance=instanceId;source=timeSource;return true;}
    // Slew modest skew at at most 50ms per second. Repeated reads neither reset
    // the clock anchor nor restart lighting, and cannot reverse the clock.
    if(Math.abs(difference)>250)target=correction+difference;source=timeSource;return false;
  }};
}
