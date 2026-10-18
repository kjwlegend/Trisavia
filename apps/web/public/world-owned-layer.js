import {el} from './common.js';
import {avatarSprite} from './scene.js';

const overlaps=(a,b,gap=0)=>a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;
const hash=value=>[...value].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,7);
function freeAreas(bounds,blocked){
  let areas=[bounds];
  for(const obstacle of blocked){
    const next=[];
    for(const area of areas){
      if(!overlaps(area,obstacle)){next.push(area);continue;}
      const left=Math.max(area.left,obstacle.left),right=Math.min(area.right,obstacle.right),top=Math.max(area.top,obstacle.top),bottom=Math.min(area.bottom,obstacle.bottom);
      for(const rect of [{...area,bottom:top},{...area,top:bottom},{left:area.left,right:left,top,bottom},{left:right,right:area.right,top,bottom}])if(rect.right>rect.left&&rect.bottom>rect.top)next.push(rect);
    }
    areas=next;
  }
  return areas;
}
function standingSpots(objects){
  const blocked=objects.map(o=>({left:o.x-o.sprite.ax-8,right:o.x-o.sprite.ax+o.sprite.canvas.width+8,top:o.y-o.sprite.ay-4,bottom:o.y-o.sprite.ay+o.sprite.canvas.height+8}));
  const points=[],add=(x,y)=>{
    if(x>680&&x<848&&y>896)return;
    const bounds={left:x-16,right:x+16,top:y-36,bottom:y+6};
    if(blocked.some(box=>overlaps(bounds,box))||points.some(p=>Math.hypot(x-p.x,y-p.y)<48))return;
    points.push({x,y});
  };
  // Prefer the empty central court, then extend over existing dry, empty land.
  for(const y of [488,552,616])for(const x of [608,672,736,800,864,928])add(x,y);
  const preferred=points.length;
  for(let y=272;y<=944;y+=48)for(let x=80;x<=1456;x+=48)add(x,y);
  return{points,preferred};
}

export function createOwnedAgentLayer(root,objects,{onSelect=()=>{}}={}){
  const labels=el('div','world-owned-labels');labels.setAttribute('aria-label','我的 Agent 地图标注');root.append(labels);
  const slots=standingSpots(objects),entries=new Map();let selectedId='',hoveredId='',focusedId='',lastProjection=null,destroyed=false;
  function text(entry,short=false){
    entry.name.textContent=short?'':entry.nameValue;
    entry.badge.textContent=short?'我的':`${entry.agentId===selectedId?'当前 Agent':'我的 Agent'}${entry.profileSource==='draft'?' · 未发布':''}`;
    entry.button.classList.toggle('is-short',short);entry.button.classList.remove('is-marker');
  }
  function layout(project=lastProjection){
    if(destroyed||!project)return;lastProjection=project;
    const box=root.getBoundingClientRect(),obstacles=[];
    for(const selector of ['header','#hud-dock','#hud-agent','#hud-locate-agent','#hud-window','#world-detail','.world-demo']){
      const node=document.querySelector(selector);if(!node||node.hidden||!node.getClientRects().length)continue;
      const r=node.getBoundingClientRect();obstacles.push({left:r.left-box.left-8,right:r.right-box.left+8,top:r.top-box.top-8,bottom:r.bottom-box.top+8});
    }
    const used=[],rank=entry=>entry.agentId===selectedId?0:entry.agentId===focusedId?1:entry.agentId===hoveredId?2:3;
    const order=[...entries.values()].sort((a,b)=>rank(a)-rank(b)||a.agentId.localeCompare(b.agentId));
    for(const entry of order){
      const p=project.point(entry.x,entry.y),full=rank(entry)<3,outside=p.x<0||p.x>box.width||p.y<0||p.y>box.height;
      entry.button.hidden=outside&&!full;
      if(entry.button.hidden)continue;
      text(entry);entry.button.classList.toggle('is-priority',full);entry.button.classList.remove('is-compact-label');entry.button.style.maxWidth='';entry.button.style.left='0px';entry.button.style.top='0px';
      const place=()=>{
        const r=entry.button.getBoundingClientRect(),width=r.width,height=r.height;
        const left=Math.max(12,Math.min(box.width-width-12,p.x-width/2)),top=p.y-36*project.scale-height-6;
        const rect={left,right:left+width,top,bottom:top+height};
        if(top<76||rect.bottom>box.height-12||obstacles.some(b=>overlaps(rect,b))||used.some(b=>overlaps(rect,b,4)))return null;
        return rect;
      };
      let rect=place();
      if(!rect&&full){
        const bounds={left:12,right:box.width-12,top:76,bottom:box.height-12};
        const blocked=[...obstacles,...used.map(r=>({left:r.left-4,right:r.right+4,top:r.top-4,bottom:r.bottom+4}))];
        const areas=freeAreas(bounds,blocked),desired={left:p.x-entry.button.offsetWidth/2,top:p.y-36*project.scale-entry.button.offsetHeight-6};
        function nearest(){
          const {width,height}=entry.button.getBoundingClientRect();
          return areas.filter(area=>area.right-area.left>=width&&area.bottom-area.top>=height).map(area=>{
            const left=Math.max(area.left,Math.min(area.right-width,desired.left)),top=Math.max(area.top,Math.min(area.bottom-height,desired.top));
            return{left,right:left+width,top,bottom:top+height,distance:Math.hypot(left-desired.left,top-desired.top)};
          }).sort((a,b)=>a.distance-b.distance)[0]||null;
        }
        rect=nearest();
        if(!rect){
          // Keep the identity and its 44px entry; shorten the name, never hide a
          // current/focused Agent merely because its original head label clips.
          const area=areas.filter(a=>a.right-a.left>=54&&a.bottom-a.top>=44).sort((a,b)=>(b.right-b.left)-(a.right-a.left))[0];
          if(area){entry.button.classList.add('is-compact-label');entry.button.style.maxWidth=`${Math.min(176,area.right-area.left)}px`;entry.badge.textContent=entry.agentId===selectedId?'当前 Agent':'我的 Agent';rect=nearest();
            if(!rect){entry.badge.textContent=entry.agentId===selectedId?'当前':'我的';rect=nearest();}}
        }
      }
      if(!rect&&!full){text(entry,true);rect=place();}
      if(!rect&&!full){entry.button.classList.add('is-marker');entry.name.textContent='';entry.badge.textContent='';rect=place();}
      entry.button.hidden=!rect;
      if(rect){entry.button.style.left=`${rect.left}px`;entry.button.style.top=`${rect.top}px`;used.push(rect);}
    }
  }
  const observer=new MutationObserver(()=>layout());
  for(const selector of ['#hud-root','#world-detail','.world-demo']){const node=document.querySelector(selector);if(node)observer.observe(node,{subtree:true,attributes:true,attributeFilter:['hidden','class','style','open']});}
  function set(projection){
    if(destroyed)return;selectedId=projection.selectedAgentId;
    const ids=new Set(projection.agents.map(agent=>agent.agentId));
    for(const [id,entry]of entries)if(!ids.has(id)){entry.button.remove();entries.delete(id);}
    for(const agent of [...projection.agents].sort((a,b)=>a.agentId.localeCompare(b.agentId))){
      let entry=entries.get(agent.agentId);
      if(!entry){
        const offset=hash(agent.agentId)%Math.max(1,slots.preferred),candidates=[...slots.points.slice(0,slots.preferred).slice(offset),...slots.points.slice(0,offset),...slots.points.slice(slots.preferred)];
        const spot=candidates.find(p=>![...entries.values()].some(other=>Math.hypot(p.x-other.x,p.y-other.y)<48));
        if(!spot)continue;
        const button=el('button','world-owned-label'),name=el('span','world-owned-name'),badge=el('span','world-owned-badge');button.type='button';button.append(name,badge);labels.append(button);
        entry={...spot,kind:'owned-agent',agentId:agent.agentId,button,name,badge};entries.set(agent.agentId,entry);
        button.addEventListener('click',()=>onSelect(agent.agentId,button));
        button.addEventListener('mouseenter',()=>{hoveredId=agent.agentId;layout();});button.addEventListener('mouseleave',()=>{hoveredId='';layout();});
        button.addEventListener('focus',()=>{focusedId=agent.agentId;layout();});button.addEventListener('blur',()=>{focusedId='';layout();});
      }
      const spriteKey=JSON.stringify(agent.avatar);if(entry.spriteKey!==spriteKey){entry.sprite=avatarSprite({avatar:agent.avatar},agent.agentId);entry.spriteKey=spriteKey;}
      entry.nameValue=agent.name;entry.profileSource=agent.profileSource;entry.button.title=`${agent.name} · ${agent.profileSource==='draft'?'未发布，仅自己可见':'我的 Agent'}`;
      entry.button.setAttribute('aria-label',`${agent.name}，${agent.agentId===selectedId?'当前 Agent':'我的 Agent'}${agent.profileSource==='draft'?'，未发布，仅自己可见':''}，选择并管理`);entry.button.setAttribute('aria-pressed',String(agent.agentId===selectedId));
      entry.button.classList.toggle('is-current',agent.agentId===selectedId);text(entry);
    }
    if(!entries.size){hoveredId='';focusedId='';}labels.hidden=!entries.size;const note=document.querySelector('#world-owned-note');if(note)note.hidden=!entries.size;layout();
  }
  return{
    set,actors:()=>[...entries.values()],
    draw(ctx,entry,scale){
      if(entry.agentId===selectedId){const rx=Math.max(24,12/scale),ry=Math.max(9,5/scale);ctx.fillStyle='#C7E8DC';ctx.globalAlpha=.24;ctx.beginPath();ctx.ellipse(entry.x,entry.y+2,rx,ry,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=2;ctx.strokeStyle='#397E80';ctx.stroke();}
      ctx.drawImage(entry.sprite,entry.x-16,entry.y-36);
    },
    layout,hover(id){if(hoveredId===id)return;hoveredId=id||'';layout();},
    hit(point,scale){return[...entries.values()].map(entry=>({entry,d:Math.hypot(point.x-entry.x,point.y-entry.y+16)})).filter(({entry})=>Math.abs(point.x-entry.x)<=Math.max(16,22/scale)&&Math.abs(point.y-entry.y+16)<=Math.max(20,22/scale)).sort((a,b)=>a.d-b.d)[0]?.entry;},
    point(id){const entry=entries.get(id);return entry?{x:entry.x,y:entry.y}:null;},
    destroy(){destroyed=true;observer.disconnect();entries.clear();labels.remove();const note=document.querySelector('#world-owned-note');if(note)note.hidden=true;},
  };
}
