import '/apps/web/public/world-pixel/asset-kit.js';
import {loadPixelAssets} from '/apps/web/public/world-pixel/assets.js';
import {createTownV2Art} from './assets/native-renderer.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const L=await fetch('world-map-expansion-v1.json').then(r=>r.json());
const assets=await loadPixelAssets(globalThis.PIXEL_ASSETS,{baseURL:new URL('/apps/web/public/world-pixel/',location.origin).href});
const art=createTownV2Art(assets,L),base=document.createElement('canvas');base.width=2048;base.height=1536;const bc=base.getContext('2d');bc.imageSmoothingEnabled=false;
const image=async path=>{const i=new Image();i.src=path;await i.decode();return i;};
const actorImages=await Promise.all(['shorthair','longhair','mophair','curlyhair','spikeyhair'].map(t=>image('../life-journal-bubbles-20261026/assets/actors/'+t+'.png')));
const canopyInn=await image('../m3-life-c-20261025/assets/fixtures/canopy-inn.png').catch(()=>null),canopyLibrary=await image('../m3-life-c-20261025/assets/fixtures/canopy-library.png').catch(()=>null);
bc.drawImage(art.ground,0,0);for(const o of [...art.objects].sort((a,b)=>a.y-b.y))o.draw(bc);
if(canopyInn)bc.drawImage(canopyInn,844,554);if(canopyLibrary)bc.drawImage(canopyLibrary,792,314);
const regions=L.districts.filter(d=>['pine-walk','river-walk','east-street'].includes(d.id));
const source=([x,y])=>({x:520+16*x,y:520+16*y});
const actors=[
{id:'lin',name:'林溪',cell:[-17,44],look:0,kind:'status',text:'正在沿小路移动',region:'pine-walk'},
{id:'pine-an',name:'阿宁',cell:[-7,46],look:1,kind:'status',text:'正在散步',region:'pine-walk'},
{id:'pine-xu',name:'小序',cell:[-14,50],look:3,kind:'status',text:'正在沿小路移动',region:'pine-walk'},
{id:'pine-ke',name:'可可',cell:[-3,48],look:4,kind:'status',text:'正在散步',region:'pine-walk'},
{id:'river-lin',name:'林溪',cell:[18,41],look:0,kind:'status',text:'正在沿小路移动',region:'river-walk'},
{id:'an',name:'阿宁',cell:[23,45],look:1,kind:'status',text:'正在沿河边移动',region:'river-walk'},
{id:'river-xu',name:'小序',cell:[28,46],look:3,kind:'status',text:'正在散步',region:'river-walk'},
{id:'river-ke',name:'可可',cell:[24,54],look:4,kind:'status',text:'正在沿小路移动',region:'river-walk'},
{id:'east-lin',name:'林溪',cell:[66,10],look:0,kind:'status',text:'正在沿外街移动',region:'east-street'},
{id:'neighbor',name:'自由镇民',cell:[74,18],look:2,kind:'ambient',text:'路过这里，跟你打个招呼。',region:'east-street'},
{id:'east-an',name:'阿宁',cell:[82,24],look:1,kind:'status',text:'正在散步',region:'east-street'},
{id:'east-xu',name:'小序',cell:[74,28],look:3,kind:'status',text:'正在沿小路移动',region:'east-street'},
{id:'clerk',name:'渔具店员',cell:[28,17],look:4,kind:'ambient',text:'想钓鱼？挑根顺手的竿吧。'},
{id:'tavern',name:'酒保',cell:[53,12],look:3,kind:'ambient',text:'欢迎，坐下歇歇吧。'},
{id:'librarian',name:'书屋管理员',cell:[21,-3],look:2,kind:'ambient',text:'不着急，挑本喜欢的书。'}
].map(a=>({...a,...source(a.cell)}));
// Fixture only. Actual Agent status uses a public authoritative moving/active fact; these are not live statements.
let view='all',scale=1,px=0,py=0,phase=0,playing=false,cycleStart=0;
const scene=$('#scene'),c=$('#terrain'),g=$('#geometry'),ctx=c.getContext('2d'),gx=g.getContext('2d');
const titleAll='熟悉的小镇，<br>更宽阔的日常。',introAll=$('#description').textContent;
$('#region-cards').innerHTML=regions.map((r,i)=>`<button class="region-card" data-region="${r.id}"><b><em>0${i+1}</em>${r.name}</b><p>${r.description}</p></button>`).join('');
for(const n of $$('[data-view]'))n.onclick=()=>setView(n.dataset.view);for(const n of $$('[data-region]'))n.onclick=()=>setView(n.dataset.region);
function setView(v){view=v;const r=regions.find(r=>r.id===v);$$('[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===v));$('#title').innerHTML=r?r.name:titleAll;$('#description').textContent=r?r.description:introAll;$('#view-caption').textContent=r?'顺着小路，与旧镇相连':'三个新区 · 同一片世界';resize(true);}
function resize(reset=false){c.width=g.width=scene.clientWidth;c.height=g.height=scene.clientHeight;if(reset){const r=regions.find(r=>r.id===view);if(r){scale=Math.min(2.5,scene.clientWidth/660,scene.clientHeight/560);px=scene.clientWidth/2-r.focus[0]*scale;py=scene.clientHeight*.52-r.focus[1]*scale;}else{scale=Math.min((c.width-28)/2048,(c.height-42)/1536);px=(c.width-2048*scale)/2;py=(c.height-1536*scale)/2;}}render();}
function render(){ctx.imageSmoothingEnabled=false;ctx.fillStyle='#91b873';ctx.fillRect(0,0,c.width,c.height);ctx.save();ctx.translate(px,py);ctx.scale(scale,scale);ctx.drawImage(art.ground,0,0);const sceneObjects=[...art.objects,...actors.map(a=>({y:a.y,draw:x=>x.drawImage(actorImages[a.look],a.x-48,a.y-39)}))];if(canopyInn)sceneObjects.push({y:600,draw:x=>x.drawImage(canopyInn,844,554)});if(canopyLibrary)sceneObjects.push({y:360,draw:x=>x.drawImage(canopyLibrary,792,314)});for(const o of sceneObjects.sort((a,b)=>a.y-b.y))o.draw(ctx);ctx.restore();gx.clearRect(0,0,g.width,g.height);if($('#show-walk').checked){gx.save();gx.translate(px,py);gx.scale(scale,scale);L.walkableMask.forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1'){gx.fillStyle='#f4f6d94a';gx.fillRect(512+16*(i+L.bounds.minX),512+16*(j+L.bounds.minY),15,15);}}));gx.restore();}if($('#show-regions').checked){gx.save();gx.translate(px,py);gx.scale(scale,scale);gx.lineWidth=1.5/scale;gx.setLineDash([5/scale,4/scale]);for(const r of regions){gx.strokeStyle=r.color;gx.fillStyle=r.color+'12';gx.beginPath();r.polygon.forEach((p,i)=>i?gx.lineTo(...p):gx.moveTo(...p));gx.closePath();gx.fill();gx.stroke();}gx.restore();}$('#scale-label').textContent=Math.round(scale*100)+'%';renderPins();renderBubbles();}
function renderPins(){$('#pins').replaceChildren();if(view!=='all')return;for(const r of regions){const x=px+r.focus[0]*scale,y=py+(r.focus[1]-105)*scale;if(x<50||x>c.width-50||y<70||y>c.height-50)continue;const n=document.createElement('button');n.className='pin';n.style=`left:${x}px;top:${y}px;--tone:${r.color}`;n.innerHTML=`<b></b>${r.name}<small>点击走近看看</small>`;n.onclick=()=>setView(r.id);$('#pins').append(n);}}
function overlap(a,b,gap=12){return a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;}
function renderBubbles(){
 const box=$('#bubbles');box.replaceChildren();if(view==='all')return;
 const elapsed=playing?performance.now()-cycleStart:0,limit=c.width<900||c.height<520?2:4;
 const obstacles=$$('.topline,.maptools,.map-foot').map(n=>{const r=n.getBoundingClientRect(),s=scene.getBoundingClientRect();return{x:r.x-s.x,y:r.y-s.y,w:r.width,h:r.height};});
 const heads=actors.map(a=>({id:a.id,x:px+(a.x-11)*scale,y:py+(a.y-32)*scale,w:22*scale,h:33*scale}));
 let count=0;
 for(const [i,a] of actors.filter(a=>a.region===view).entries()){
  if(count>=limit)break;if(playing&&(elapsed<i*1500||elapsed>=i*1500+6000))continue;
  const n=document.createElement('div');n.className='bubble'+(a.kind==='ambient'?' ambient':'');n.dataset.actor=a.id;
  n.setAttribute('aria-label',`${a.name}：${a.text}`);n.innerHTML=`<b>${a.name}</b><p>${a.text}</p>`;box.append(n);
  const head={x:px+a.x*scale,y:py+(a.y-34)*scale},w=n.offsetWidth,h=n.offsetHeight;
  const candidates=[{x:head.x-w/2,y:head.y-h-12},{x:head.x-w+20,y:head.y-h-12},{x:head.x-20,y:head.y-h-12}];
  const q=candidates.find(q=>q.x>8&&q.y>8&&q.x+w<c.width-8&&q.y+h<c.height-8&&!obstacles.some(o=>overlap({...q,w,h},o))&&!heads.some(o=>overlap({...q,w,h},o,12)));
  if(!q){n.remove();continue;}n.style.left=q.x+'px';n.style.top=q.y+'px';n.style.setProperty('--tail',(head.x-q.x-5)+'px');obstacles.push({...q,w,h});count++;
 }
}
function zoom(f){const x=c.width/2,y=c.height/2,n=Math.min(3,Math.max(.25,scale*f));px=x-(x-px)*n/scale;py=y-(y-py)*n/scale;scale=n;render();}
$('#zoom-in').onclick=()=>zoom(1.25);$('#zoom-out').onclick=()=>zoom(.8);$('#reset').onclick=()=>resize(true);$('#show-walk').onchange=render;$('#show-regions').onchange=render;$('#next').onclick=()=>{phase++;cycleStart=performance.now();if(view==='all')setView('east-street');renderBubbles();};$('#play').onchange=e=>{playing=e.target.checked;cycleStart=performance.now();if(view==='all')setView('east-street');renderBubbles();};
let drag=null;scene.onpointerdown=e=>{if(e.target.closest('button'))return;drag={x:e.clientX,y:e.clientY,px,py};scene.setPointerCapture(e.pointerId);scene.classList.add('dragging');};scene.onpointermove=e=>{if(drag){px=drag.px+e.clientX-drag.x;py=drag.py+e.clientY-drag.y;render();}};scene.onpointerup=()=>{drag=null;scene.classList.remove('dragging');};new ResizeObserver(()=>resize(false)).observe(scene);
setView(new URLSearchParams(location.search).get('view')||'all');window.previewReady=true;window.mapDesign={layout:L,base,regions,actors,setView,render,exportPNG:()=>base.toDataURL('image/png')};
let lastStep=-1;setInterval(()=>{if(!playing)return;let t=performance.now()-cycleStart;if(t>=15000){cycleStart=performance.now();phase++;t=0;}const step=Math.floor(t/1500);if(step!==lastStep){renderBubbles();lastStep=step;}},200);
