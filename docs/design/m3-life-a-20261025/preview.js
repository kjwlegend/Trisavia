import {loadPixelAssets} from '/frozen/world-pixel/assets.js';
import {createTownV2Art} from '/frozen/world-pixel/town-v2-art.js';
import {loadPoseAssets,drawPose} from './pose-preview.js';
const $=s=>document.querySelector(s);
const specs={
 harbor_work:{name:'港湾码头',capacity:4,occupied:2,duration:10,reward:36,energy:-24,intro:'帮忙整理靠岸的货物。做完一班短工，领取本次的星币报酬。',note:'保留仓库门口及原来的公共通路。',service:'无工具和余额门槛。每个 UTC 日最多开始 4 次工作，与酒馆帮工共用额度。',crop:[1160,464],state:'work',hair:'bowlhair',prop:'crate',activity:'码头短工'},
 harbor_tavern:{name:'港湾酒馆',capacity:3,occupied:1,duration:8,reward:24,energy:-16,intro:'在酒馆外场整理杯盘。时间更短，体力消耗也更少。',note:'帮工位在南侧外场；门前一整行通路保留。',service:'帮工与迎新招待分开。酒保离岗时显示暂时无法招待，不扣招待券。',crop:[1240,616],state:'work',hair:'curlyhair',prop:'tray',activity:'酒馆帮工'},
 garden_bench:{name:'花园凉亭',capacity:6,occupied:3,duration:5,reward:0,energy:30,intro:'找张长椅坐一会儿。免费恢复体力，再决定接下来去哪里。',note:'六张长椅沿公共过道排列；凉亭入口与西侧旁路保留。',service:'无需星币或物品。完成后恢复 30 体力，最多恢复到 100。',crop:[64,872],state:'rest',hair:'longhair',prop:'tray',activity:'长椅休息'},
};
const names={available:'有空位',running:'进行中',full:'暂时满员',offline:'待同步',cancelled:'已取消',completed:'已完成'};
let place='harbor_work',state='available',tick=0,timer=null;
const [layout,manifest,images]=await Promise.all([fetch('world-map-life-v1.json').then(r=>r.json()),fetch('spatial-manifest.json').then(r=>r.json()),loadPoseAssets()]);
const assets=await loadPixelAssets(window.PIXEL_ASSETS,{baseURL:new URL('/frozen/world-pixel/',location.origin).href});
const art=createTownV2Art(assets,layout),source=document.createElement('canvas');source.width=1536;source.height=1152;const sc=source.getContext('2d');sc.imageSmoothingEnabled=false;
const point=c=>[520+c[0]*16,520+c[1]*16];
const phase=state=>state==='rest'?Math.floor(tick*180/1600):state==='duty'?0:tick;
function drawWorld(){
 const cfg=specs[place],info=manifest.places.find(p=>p.placeId===place);sc.clearRect(0,0,1536,1152);sc.drawImage(art.ground,0,0);
 const objects=art.objects.map(o=>({y:o.y,draw:c=>{c.save();if(o.id==='g-lodge'&&place==='garden_bench')c.globalAlpha=.28;o.draw(c);c.restore();}}));
 // Fixed sample occupancy, never a representation of live residents.
 for(const p of manifest.places){const s=specs[p.placeId];p.stations.forEach((station,index)=>{const [x,y]=point(station.cells[0]),occupied=p.placeId===place&&state==='full'?true:index<s.occupied;
  if(s.state==='rest'&&!occupied)objects.push({y:y+5,draw:c=>{c.drawImage(images.get('bench-back'),x-14,y-13);c.drawImage(images.get('bench-front'),x-14,y-2);}});
  if(occupied)objects.push({y:y+5,draw:c=>drawPose(c,images,{x,y,hair:s.hair,state:s.state,prop:s.prop,phase:phase(s.state),facing:station.facing})});
  else if(s.state==='work')objects.push({y,draw:c=>c.drawImage(images.get(s.prop),x+5,y-11)});
 });}
 for(const n of manifest.npcs){const [x,y]=point(n.dutyCell);objects.push({y,draw:c=>drawPose(c,images,{x,y,hair:n.appearance.hair,state:'duty'})});}
 objects.sort((a,b)=>a.y-b.y).forEach(o=>o.draw(sc));
 if($('#geometry').checked){const cell=(c,color,label)=>{const [x,y]=point(c);sc.fillStyle=color+'55';sc.fillRect(x-7,y-7,14,14);sc.strokeStyle=color;sc.lineWidth=1;sc.strokeRect(x-7.5,y-7.5,15,15);if(label){sc.fillStyle='#fff9e7';sc.fillRect(x-3,y-4,6,8);sc.fillStyle=color;sc.font='7px monospace';sc.fillText(label,x-2,y+3);}};info.publicBypassCells.forEach(c=>cell(c,'#558b72'));info.approachCells.forEach(c=>cell(c,'#558b72'));info.waitingCells.forEach(c=>cell(c,'#667eaa'));info.stations.forEach((s,i)=>cell(s.cells[0],'#b96944',String(i+1)));}
 const ctx=$('#world').getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,768,480);ctx.drawImage(source,...cfg.crop,256,160,0,0,768,480);
 for(const [id,pose]of [['pose-work','work'],['pose-rest','rest'],['pose-duty','duty']]){const c=$('#'+id),ct=c.getContext('2d');ct.clearRect(0,0,c.width,c.height);ct.save();ct.scale(4,4);drawPose(ct,images,{x:23,y:23,hair:cfg.hair,state:pose,prop:cfg.prop,phase:phase(pose)});ct.restore();}
}
function renderCard(){
 const c=specs[place],rest=place==='garden_bench',occupied=state==='full'?c.capacity:c.occupied;
 $('#scene-name').textContent=c.name;$('#place-name').textContent=c.name;$('#place-icon').src=`assets/place-${place}.svg`;$('#intro').textContent=c.intro;$('#scene-note').textContent=c.note;$('#service-note').textContent=c.service;
 $('#status-pill').textContent=names[state];$('#status-pill').classList.toggle('warning',['full','offline'].includes(state));$('#capacity-label').textContent=state==='full'?`${c.capacity} 个位置正在使用`:`${c.capacity-occupied} 个空位 / 共 ${c.capacity} 位`;
 $('#capacity-dots').innerHTML=Array.from({length:c.capacity},(_,i)=>`<i class="${i<occupied?'filled':''}"></i>`).join('');
 $('#duration').textContent=`${c.duration} 分钟`;$('#reward-label').textContent=rest?'参与费用':'完成收益';$('#reward').textContent=rest?'免费':`+${c.reward} 星币`;$('#energy').textContent=(c.energy>0?'+':'−')+Math.abs(c.energy);
 const remaining=rest?'03:40':place==='harbor_work'?'07:20':'05:52';
 const activity={
 available:`<div class="activity-title"><b>${c.activity}</b><span>可参加</span></div><p>${rest?'体力不足时可以来这里恢复。':'完成整班后结算收益；动画循环不会重复发薪。'}每位居民同时进行一项活动。</p>`,
 running:`<div class="activity-title"><b>${c.activity}</b><span>剩余约 ${remaining}</span></div><div class="bar"><span></span></div><p>正在进行 · ${rest?'体力恢复':'工作报酬'}尚未结算。以下进度为样例。</p>`,
 full:'<div class="activity-title"><b>暂时没有空位</b><span>可等候</span></div><p>候位最多 2 位、等候上限 2 分钟。可以稍后再来，或让 Agent 选择其他活动。</p>',
 offline:'<div class="activity-title"><b>连接中断，等待同步</b><span>进度已冻结</span></div><div class="bar"><span></span></div><p>保留上次确认的状态。重新连接后核对结果；不推断活动已完成。</p>',
 cancelled:`<div class="activity-title"><b>本次活动已取消</b><span>位置已释放</span></div><p>${rest?'未完成本次休息，没有增加体力。':'未完成本班，不发工资；体力按实际进行比例结算，剩余预留释放。'}已完成的其他步骤保留。</p>`,
 completed:`<div class="activity-title"><b>${c.activity}已完成</b><span>已确认</span></div><p>${rest?'体力恢复 +30（示例，未触及上限）。':`获得 ${c.reward} 星币，体力消耗 ${Math.abs(c.energy)}。`}本条为结果布局样例。</p>`,
 };
 $('#activity').innerHTML=activity[state];document.querySelectorAll('[data-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.state===state)));document.querySelectorAll('[data-place]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.place===place)));$('#scene-state').textContent=state==='offline'?'最后确认状态 · 已冻结':'空间设计预览';$('.legend').hidden=!$('#geometry').checked;
 if(state==='offline'){clearInterval(timer);timer=null;$('#animate').checked=false;}
 drawWorld();
}
for(const n of manifest.npcs){const article=document.createElement('article');article.className='npc';article.innerHTML=`<canvas width="144" height="144" aria-label="${n.name}形象"></canvas><div><h3>${n.name}</h3><p>${n.dutyPlaceId==='town_hall'?'市政厅':n.dutyPlaceId==='stone_inn'?'石岸旅舍':specs[n.dutyPlaceId].name}</p><small>${n.npcId==='npc-harbor-hand'?'新增角色 · 短号由系统分配':'沿用原身份与短号'}</small></div>`;$('#npc-list').append(article);const ctx=article.querySelector('canvas').getContext('2d');ctx.scale(4,4);drawPose(ctx,images,{x:18,y:29,hair:n.appearance.hair,state:'duty'});}
document.querySelectorAll('[data-place]').forEach(b=>b.addEventListener('click',()=>{place=b.dataset.place;renderCard();}));document.querySelectorAll('[data-state]').forEach(b=>b.addEventListener('click',()=>{state=b.dataset.state;renderCard();}));$('#geometry').addEventListener('change',renderCard);
$('#animate').addEventListener('change',()=>{clearInterval(timer);timer=null;if($('#animate').checked&&state!=='offline'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){timer=setInterval(()=>{tick++;drawWorld();},180);}else{$('#animate').checked=false;tick=0;drawWorld();}});
$('#explain').addEventListener('click',()=>{const c=specs[place];$('#details-title').textContent=c.activity;$('#details-body').innerHTML=`<p>${c.intro}</p><p>${c.service}</p><p>本页仅展示设计样例。生产中由 Agent 的合法意图触发活动；满员、取消、离线与结果均以服务端确认状态为准。</p>`;$('#details').showModal();$('#close-details').focus();});$('#close-details').addEventListener('click',()=>{$('#details').close();$('#explain').focus();});$('#details').addEventListener('close',()=>$('#explain').focus());$('#details').addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();$('#close-details').focus();}});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInterval(timer);timer=null;$('#animate').checked=false;}});
renderCard();window.previewReady=true;
