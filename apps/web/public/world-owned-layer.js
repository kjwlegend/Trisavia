import {el} from './common.js';
import {avatarSprite} from './scene.js';
import {createOwnedAgentMotion} from './world-owned-motion.js';

const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function freeAreas(bounds,blocked){
  let areas=[bounds];
  for(const obstacle of blocked){const next=[];for(const area of areas){
    if(!overlaps(area,obstacle)){next.push(area);continue;}
    const left=Math.max(area.left,obstacle.left),right=Math.min(area.right,obstacle.right),top=Math.max(area.top,obstacle.top),bottom=Math.min(area.bottom,obstacle.bottom);
    for(const rect of [{...area,bottom:top},{...area,top:bottom},{left:area.left,right:left,top,bottom},{left:right,right:area.right,top,bottom}])if(rect.right>rect.left&&rect.bottom>rect.top)next.push(rect);
  }areas=next;}
  return areas;
}
function nearestRect(areas,width,height,desired){return areas.filter(a=>a.right-a.left>=width&&a.bottom-a.top>=height).map(area=>{
  const left=Math.max(area.left,Math.min(area.right-width,desired.left)),top=Math.max(area.top,Math.min(area.bottom-height,desired.top));
  return{left,right:left+width,top,bottom:top+height,distance:Math.hypot(left-desired.left,top-desired.top)};
}).sort((a,b)=>a.distance-b.distance)[0]||null;}

export function createOwnedAgentLayer(root,graph,{blockedRects=[],onSelect=()=>{}}={}){
  const labels=el('div','world-owned-labels');labels.setAttribute('aria-label','我的 Agent 地图操作');root.append(labels);
  const tooltip=el('div','world-owned-tooltip');tooltip.id='world-owned-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;labels.append(tooltip);
  const motion=createOwnedAgentMotion(graph,{blockedRects}),entries=new Map();
  let selectedId='',hoveredId='',focusedId='',lastProjection=null,destroyed=false,geometry=null;
  function copyPositions(){for(const entry of entries.values()){const position=motion.read(entry.agentId);if(position)Object.assign(entry,position);}}
  function layout(project=lastProjection){
    if(destroyed||!project)return;lastProjection=project;
    const box=root.getBoundingClientRect();
    if(!geometry||geometry.width!==box.width||geometry.height!==box.height){
      const obstacles=[];
      for(const selector of ['header','#hud-dock','#hud-agent','#hud-locate-agent','#hud-window','#world-detail','.world-demo']){
        const node=document.querySelector(selector);if(!node||node.hidden||!node.getClientRects().length)continue;
        const r=node.getBoundingClientRect();obstacles.push({left:r.left-box.left-8,right:r.right-box.left+8,top:r.top-box.top-8,bottom:r.bottom-box.top+8});
      }
      geometry={width:box.width,height:box.height,areas:freeAreas({left:12,right:box.width-12,top:76,bottom:box.height-12},obstacles),obstacles};
    }
    const active=entries.get(focusedId)||entries.get(hoveredId);
    for(const entry of entries.values()){
      const p=project.point(entry.x,entry.y),width=Math.max(44,32*project.scale),height=Math.max(44,40*project.scale);
      let rect={left:p.x-width/2,right:p.x+width/2,top:p.y-16*project.scale-height/2,bottom:p.y-16*project.scale+height/2};
      const clipped=rect.left<0||rect.right>box.width||rect.top<76||rect.bottom>box.height||geometry.obstacles.some(b=>overlaps(rect,b));
      if(clipped&&entry.agentId===focusedId)rect=nearestRect(geometry.areas,44,44,rect)||rect;
      entry.button.hidden=clipped&&entry.agentId!==focusedId;
      entry.button.style.left=`${rect.left}px`;entry.button.style.top=`${rect.top}px`;entry.button.style.width=`${rect.right-rect.left}px`;entry.button.style.height=`${rect.bottom-rect.top}px`;
      if(entry===active)entry.button.setAttribute('aria-describedby',tooltip.id);else entry.button.removeAttribute('aria-describedby');
    }
    tooltip.hidden=!active;if(!active)return;
    tooltip.textContent=active.nameValue;tooltip.style.left='0px';tooltip.style.top='0px';tooltip.style.maxWidth='176px';
    const p=project.point(active.x,active.y),r=tooltip.getBoundingClientRect(),desired={left:p.x-r.width/2,top:p.y-36*project.scale-r.height-6};
    let rect=nearestRect(geometry.areas,r.width,r.height,desired);
    if(!rect){const area=geometry.areas.filter(a=>a.right-a.left>=32&&a.bottom-a.top>=22).sort((a,b)=>(b.right-b.left)-(a.right-a.left))[0];if(area){tooltip.style.maxWidth=`${Math.min(176,area.right-area.left)}px`;const size=tooltip.getBoundingClientRect();rect=nearestRect(geometry.areas,size.width,size.height,desired);}}
    if(rect){tooltip.style.left=`${rect.left}px`;tooltip.style.top=`${rect.top}px`;}else tooltip.hidden=true;
  }
  const observer=new MutationObserver(()=>{geometry=null;layout();});
  for(const selector of ['#hud-root','#world-detail','.world-demo']){const node=document.querySelector(selector);if(node)observer.observe(node,{subtree:true,attributes:true,attributeFilter:['hidden','class','style','open']});}
  function set(projection){
    if(destroyed)return;selectedId=projection.selectedAgentId;const ids=new Set(projection.agents.map(agent=>agent.agentId));motion.sync([...ids]);
    for(const [id,entry]of entries)if(!ids.has(id)){entry.button.remove();entries.delete(id);}
    if(!ids.has(focusedId))focusedId='';if(!ids.has(hoveredId))hoveredId='';
    for(const agent of projection.agents){
      let entry=entries.get(agent.agentId);if(!motion.read(agent.agentId))continue;
      if(!entry){
        const button=el('button','world-owned-hit');button.type='button';labels.append(button);entry={agentId:agent.agentId,kind:'owned-agent',button,sprites:new Map()};entries.set(agent.agentId,entry);
        // Pointer hits stay on the canvas, where nearest live footpoint wins.
        // The stable transparent button supplies the equivalent keyboard entry.
        button.addEventListener('click',()=>onSelect(agent.agentId,button));
        button.addEventListener('focus',()=>{focusedId=agent.agentId;layout();});button.addEventListener('blur',()=>{focusedId='';layout();});
      }
      const spriteKey=JSON.stringify(agent.avatar);if(entry.spriteKey!==spriteKey){entry.sprites.clear();entry.spriteKey=spriteKey;}entry.avatar=agent.avatar;entry.nameValue=agent.name;
      entry.button.setAttribute('aria-label',`${agent.name}，${agent.agentId===selectedId?'当前 Agent':'我的 Agent'}，选择并管理`);entry.button.setAttribute('aria-pressed',String(agent.agentId===selectedId));
    }
    copyPositions();labels.hidden=!entries.size;const note=document.querySelector('#world-owned-note');if(note)note.hidden=!entries.size;layout();
  }
  return{
    set,actors:()=>[...entries.values()],
    step(dt,options){motion.step(dt,{...options,heldIds:[focusedId,hoveredId]});copyPositions();},
    draw(ctx,entry,scale){
      if(entry.agentId===selectedId){const rx=Math.max(24,12/scale),ry=Math.max(9,5/scale);ctx.fillStyle='#C7E8DC';ctx.globalAlpha=.24;ctx.beginPath();ctx.ellipse(entry.x,entry.y+2,rx,ry,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=2;ctx.strokeStyle='#397E80';ctx.stroke();}
      const key=`${entry.direction}:${entry.walking?entry.frame:'idle'}`;
      if(!entry.sprites.has(key))entry.sprites.set(key,avatarSprite({avatar:entry.avatar},entry.agentId,{walking:entry.walking,step:entry.frame,direction:entry.direction}));
      ctx.drawImage(entry.sprites.get(key),entry.x-16,entry.y-36);
    },
    layout,hover(id){if(hoveredId===id)return;hoveredId=entries.has(id)?id:'';layout();},
    hit(point,scale){return[...entries.values()].map(entry=>({entry,d:Math.hypot(point.x-entry.x,point.y-entry.y)})).filter(({entry})=>Math.abs(point.x-entry.x)<=Math.max(16,22/scale)&&Math.abs(point.y-entry.y+16)<=Math.max(20,22/scale)).sort((a,b)=>a.d-b.d)[0]?.entry;},
    point(id){const position=motion.read(id);return position?{x:position.x,y:position.y}:null;},
    destroy(){destroyed=true;observer.disconnect();motion.clear();entries.clear();labels.remove();const note=document.querySelector('#world-owned-note');if(note)note.hidden=true;},
  };
}
