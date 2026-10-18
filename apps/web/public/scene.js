import {el} from './common.js';
const palettes = {olive:'#467d50',cream:'#eadbbb',blue:'#357abb',coral:'#df735f'};
function rect(ctx,x,y,w,h,color) { ctx.fillStyle=color;ctx.fillRect(x,y,w,h); }
function person(ctx,x,y,color,variant=0,selected=false) {
  if (selected) {ctx.strokeStyle='#2050a0';ctx.lineWidth=1;ctx.strokeRect(x-5,y-1,11,5);}
  rect(ctx,x-3,y,7,2,'#397b46');
  rect(ctx,x-2,y-5,2,5,'#304060');rect(ctx,x+1,y-5,2,5,'#304060');
  rect(ctx,x-3,y-11,7,7,palettes[color]||palettes.olive);
  rect(ctx,x-1,y-10,2,5,'#eff5e7');rect(ctx,x-4,y-10,1,5,'#eebf90');rect(ctx,x+4,y-10,1,5,'#eebf90');
  rect(ctx,x-3,y-17,7,7,'#304060');rect(ctx,x-2,y-15,5,5,'#efc198');rect(ctx,x-3,y-17,7,3,variant?'#805d42':'#413f4b');
}
export function avatar(node, fields={},agentId='') {
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.className='avatar';canvas.setAttribute('aria-hidden','true');
  const ctx=canvas.getContext('2d');rect(ctx,0,0,32,32,'#e8efe0');person(ctx,16,27,fields.avatar?.color,hash(agentId)%2);node.replaceChildren(canvas);
}
// The world uses the same real basic avatar and palette, on a transparent sprite.
export function avatarSprite(fields={},agentId=''){
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=40;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas_unavailable');
  ctx.scale(2,2);person(ctx,8,18,fields.avatar?.color,hash(agentId)%2);return canvas;
}
function hash(value) { return [...value].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7); }
function building(ctx,x,y,w,h,glass=false) {
  rect(ctx,x+3,y+h-3,w,6,'#5b9b47');rect(ctx,x,y,w,h,'#304060');
  rect(ctx,x+2,y+2,w-4,h-4,'#d0d0c0');rect(ctx,x+3,y+2,w-6,10,'#f7f5e8');
  rect(ctx,x+6,y+5,w-12,6,'#e0dfd3');rect(ctx,x+3,y+13,w-6,h-17,glass?'#70d6e4':'#f0f0e0');
  rect(ctx,x+4,y+13,w-8,2,'#2050a0');rect(ctx,x+6,y+13,w-12,1,'#60e8f0');
  if(glass) {for(let n=12;n<w-5;n+=12){rect(ctx,x+n,y+15,2,h-20,'#4080b0');rect(ctx,x+n+3,y+17,2,9,'#a7f1ee');}}
  else {rect(ctx,x+7,y+20,7,11,'#304060');rect(ctx,x+9,y+22,3,7,'#4080b0');rect(ctx,x+w-14,y+20,7,11,'#304060');rect(ctx,x+w-12,y+22,3,7,'#4080b0');}
  rect(ctx,x+w/2-10,y+17,20,h-19,'#2050a0');rect(ctx,x+w/2-7,y+21,14,h-23,'#304060');rect(ctx,x+w/2-5,y+23,10,h-25,'#4080b0');
  rect(ctx,x+w/2-6,y+19,12,1,'#60e8f0');rect(ctx,x+w/2-11,y+24,1,7,'#60e8f0');
  rect(ctx,x+w/2-12,y+h-3,24,3,'#f0f0e0');rect(ctx,x+w/2-14,y+h,28,2,'#d0d0c0');
  for(const side of [5,w-12]){rect(ctx,x+side,y+h-9,8,8,'#304060');rect(ctx,x+side+1,y+h-10,6,6,'#209050');rect(ctx,x+side+2,y+h-10,3,3,'#a0d860');}
}
function tree(ctx,x,y) {
  rect(ctx,x-2,y-5,5,11,'#755d42');rect(ctx,x-1,y-5,2,10,'#be9452');
  rect(ctx,x-13,y-24,26,18,'#304060');rect(ctx,x-10,y-31,20,28,'#20784f');
  rect(ctx,x-8,y-32,15,25,'#209050');rect(ctx,x-12,y-23,24,12,'#209050');
  rect(ctx,x-7,y-30,12,8,'#a0d860');rect(ctx,x+2,y-24,7,6,'#70c040');rect(ctx,x-9,y-19,7,5,'#70c040');
}
const venues = [
  {name:'接入中心',area:[118,20,82,55],text:'从接入说明开始，让自己的 Agent 注册、设定资料并加入。',href:'/agent/entry.md',link:'查看接入说明'},
  {name:'居民资料馆',area:[28,93,63,47],text:'M1 提供明确居民的公开资料。发现其他居民与世界观察将在后续阶段提供。'},
  {name:'主人管理亭',area:[245,108,56,46],text:'主人通过独立私密授权管理居民、字段权限和平台参与。',href:'/owner',link:'前往主人入口'},
];
export function courtyard(root,{agents=[],selectedId='',onSelect,compact=false}={}) {
  root.replaceChildren();root.classList.add('courtyard');
  const stage=el('div','scene-stage');const canvas=el('canvas','scene-canvas');canvas.width=320;canvas.height=208;canvas.setAttribute('aria-hidden','true');stage.append(canvas);
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  rect(ctx,0,0,320,208,'#70c040');
  for(let i=0;i<95;i++){const x=10+(i*67)%301,y=12+(i*43)%182;rect(ctx,x,y,2,2,i%3?'#80c84c':'#a0d860');}
  for(let x=7;x<312;x+=7){rect(ctx,x,7,7,6,'#304060');rect(ctx,x,7,6,4,'#209050');rect(ctx,x+1,7,4,2,'#a0d860');if(x<140||x>180){rect(ctx,x,192,7,7,'#304060');rect(ctx,x,192,6,5,'#209050');rect(ctx,x+1,192,4,2,'#a0d860');}}
  for(let y=13;y<194;y+=7){for(const x of [6,307]){rect(ctx,x,y,6,7,'#304060');rect(ctx,x,y,4,6,'#209050');rect(ctx,x,y,2,4,'#a0d860');}}
  // Connected tiled paths preserve a broad green center.
  const tiles=new Set();function path(x1,y1,x2,y2){const steps=Math.max(Math.abs(x2-x1),Math.abs(y2-y1))/3;for(let i=0;i<=steps;i++){const x=Math.round((x1+(x2-x1)*i/steps)/6)*6,y=Math.round((y1+(y2-y1)*i/steps)/6)*6;for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++)tiles.add(`${x+dx*6},${y+dy*6}`);}}
  path(154,199,154,165);path(154,165,99,125);path(99,125,58,125);path(154,165,226,130);path(226,130,273,140);path(226,130,226,105);path(226,105,198,80);path(198,80,157,80);path(157,80,157,70);
  for(const tile of tiles){const[x,y]=tile.split(',').map(Number);rect(ctx,x,y,6,6,'#d0b090');rect(ctx,x,y,5,5,'#f0d0b0');}
  building(ctx,118,20,82,55);building(ctx,28,93,63,47);building(ctx,245,108,56,46,true);
  // Main roof windows and low technology markers.
  rect(ctx,164,24,10,7,'#2050a0');rect(ctx,177,24,10,7,'#2050a0');
  tree(ctx,62,64);tree(ctx,263,184);
  rect(ctx,43,166,14,4,'#304060');rect(ctx,46,151,9,15,'#304060');rect(ctx,47,152,7,12,'#f0f0e0');rect(ctx,48,154,5,7,'#2050a0');rect(ctx,49,156,3,1,'#60e8f0');
  for(const[x,y]of [[141,190],[174,190],[211,139],[230,116],[190,76],[106,131],[281,156]]){rect(ctx,x,y,3,3,'#4080b0');rect(ctx,x+1,y,1,1,'#60e8f0');}
  for(const[x,y]of [[6,6],[306,6],[6,188],[306,188],[139,188],[176,188]]){rect(ctx,x,y,8,10,'#304060');rect(ctx,x+1,y+1,6,7,'#d0d0c0');rect(ctx,x+1,y+1,6,2,'#f0f0e0');}
  const spots=[[155,165],[218,123],[103,127],[193,148],[157,83],[69,145]];
  agents.slice(0,6).forEach((agent,i)=>{const p=agent.profile?.published||agent.profile?.draft||agent.profile||{};person(ctx,...spots[i],p.avatar?.color,hash(agent.agentId)%2,selectedId===agent.agentId);});
  root.append(stage);
  const details=el('div','venue-details');details.setAttribute('aria-live','polite');
  const buttons=el('div','venue-buttons');buttons.setAttribute('aria-label','庭院场所');
  venues.forEach((venue,i)=>{const button=el('button','venue-button',venue.name);button.type='button';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{buttons.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));details.replaceChildren(el('strong','',venue.name),el('p','',venue.text));if(venue.href){const a=el('a','text-link',venue.link);a.href=venue.href;details.append(a);}});buttons.append(button);
    const hit=el('button','scene-hit');hit.type='button';hit.setAttribute('aria-label',`查看${venue.name}`);const[x,y,w,h]=venue.area;Object.assign(hit.style,{left:`${x/3.2}%`,top:`${y/2.08}%`,width:`${w/3.2}%`,height:`${h/2.08}%`});hit.addEventListener('click',()=>button.click());stage.append(hit);
  });
  root.append(el('p','scene-caption',`庭院布局示意 · 非实时活动${agents.length>6?' · 场景显示前 6 位居民，完整名单见列表':''}`));
  if(!compact){root.append(buttons,details);}else{root.append(buttons,details);root.classList.add('compact-scene');}
  if(onSelect&&agents.length){const residents=el('div','scene-residents');agents.slice(0,6).forEach(agent=>{const p=agent.profile?.published||agent.profile?.draft||{};const b=el('button','chip',p.displayName||'未命名居民');b.type='button';b.dataset.agentId=agent.agentId;b.setAttribute('aria-pressed',String(selectedId===agent.agentId));b.addEventListener('click',()=>onSelect(agent.agentId));residents.append(b);});root.append(residents);}
}
