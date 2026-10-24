import {el} from './common.js';
import {avatarSprite} from './scene.js';
import {createOwnedAgentMotion} from './world-owned-motion.js';
import {overlaps,freeAreas,worldOverlayRects} from './world-safe-area.js';
import {humanHitSize,receivePosition,advancePosition} from './world-pixel/human.js';
function nearestRect(areas,width,height,desired){return areas.filter(a=>a.right-a.left>=width&&a.bottom-a.top>=height).map(area=>{
  const left=Math.max(area.left,Math.min(area.right-width,desired.left)),top=Math.max(area.top,Math.min(area.bottom-height,desired.top));
  return{left,right:left+width,top,bottom:top+height,distance:Math.hypot(left-desired.left,top-desired.top)};
}).sort((a,b)=>a.distance-b.distance)[0]||null;}
export function findAvatarHit(entries,point,scale,shape,previousId){
  const hits=entries.map(entry=>{const geometry=shape(entry),b=geometry.hitBox,size=humanHitSize(geometry,scale);return{entry,d:Math.hypot(point.x-entry.x,point.y-entry.y),x:entry.x+(b.left+b.right)/2,y:entry.y+(b.top+b.bottom)/2,halfWidth:size.width/(2*scale),halfHeight:size.height/(2*scale)};}).filter(hit=>Math.abs(point.x-hit.x)<=hit.halfWidth&&Math.abs(point.y-hit.y)<=hit.halfHeight).sort((a,b)=>a.d-b.d);
  if(!hits.length)return;const first=hits[0].entry;if(previousId===undefined)return first;
  const sameCell=hits.filter(({entry})=>entry.x===first.x&&entry.y===first.y).map(hit=>hit.entry);return sameCell[(sameCell.findIndex(entry=>entry.agentId===previousId)+1)%sameCell.length];
}

export function createOwnedAgentLayer(root,graph,{blockedRects=[],onSelect=()=>{},onOverlayChange=()=>{},renderer=null}={}){
  const labels=el('div','world-owned-labels');labels.setAttribute('aria-label','我的 Agent 地图操作');root.append(labels);
  const tooltip=el('div','world-owned-tooltip');tooltip.id='world-owned-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;labels.append(tooltip);
  const motion=createOwnedAgentMotion(graph,{blockedRects}),entries=new Map();
  let selectedId='',hoveredId='',focusedId='',lastProjection=null,destroyed=false,geometry=null,authoritative=false,frozen=false,lastHitId='';
  const shape=entry=>renderer?.avatarGeometry(entry)||{width:32,height:40,anchor:{x:16,y:36},hitBox:{left:-16,right:16,top:-36,bottom:4}};
  function copyPositions(){for(const entry of entries.values()){const position=motion.read(entry.agentId);if(position)Object.assign(entry,position);}}
  function layout(project=lastProjection){
    if(destroyed||!project)return;lastProjection=project;
    const box=root.getBoundingClientRect();
    if(!geometry||geometry.width!==box.width||geometry.height!==box.height){
      const obstacles=worldOverlayRects(root);
      geometry={width:box.width,height:box.height,areas:freeAreas({left:12,right:box.width-12,top:76,bottom:box.height-12},obstacles),obstacles};
    }
    const active=entries.get(focusedId)||entries.get(hoveredId);
    for(const entry of entries.values()){
      const p=project.point(entry.x,entry.y),hit=shape(entry).hitBox,{width,height}=humanHitSize(shape(entry),project.scale),center={x:p.x+(hit.left+hit.right)/2*project.scale,y:p.y+(hit.top+hit.bottom)/2*project.scale};
      let rect={left:center.x-width/2,right:center.x+width/2,top:center.y-height/2,bottom:center.y+height/2};
      const clipped=rect.left<0||rect.right>box.width||rect.top<76||rect.bottom>box.height||geometry.obstacles.some(b=>overlaps(rect,b));
      if(clipped&&entry.agentId===focusedId)rect=nearestRect(geometry.areas,width,height,rect)||rect;
      entry.button.hidden=clipped&&entry.agentId!==focusedId;
      entry.button.style.left=`${rect.left}px`;entry.button.style.top=`${rect.top}px`;entry.button.style.width=`${rect.right-rect.left}px`;entry.button.style.height=`${rect.bottom-rect.top}px`;
      if(entry===active)entry.button.setAttribute('aria-describedby',tooltip.id);else entry.button.removeAttribute('aria-describedby');
    }
    tooltip.hidden=!active;if(!active)return;
    tooltip.textContent=active.nameValue;tooltip.style.left='0px';tooltip.style.top='0px';tooltip.style.maxWidth='176px';
    const p=project.point(active.x,active.y),r=tooltip.getBoundingClientRect(),desired={left:p.x-r.width/2,top:p.y+shape(active).hitBox.top*project.scale-r.height-6};
    let rect=nearestRect(geometry.areas,r.width,r.height,desired);
    if(!rect){const area=geometry.areas.filter(a=>a.right-a.left>=32&&a.bottom-a.top>=22).sort((a,b)=>(b.right-b.left)-(a.right-a.left))[0];if(area){tooltip.style.maxWidth=`${Math.min(176,area.right-area.left)}px`;const size=tooltip.getBoundingClientRect();rect=nearestRect(geometry.areas,size.width,size.height,desired);}}
    if(rect){tooltip.style.left=`${rect.left}px`;tooltip.style.top=`${rect.top}px`;}else tooltip.hidden=true;
  }
  function overlayChanged(){if(destroyed)return;geometry=null;onOverlayChange();layout();}
  const observer=new MutationObserver(overlayChanged),resizer=new ResizeObserver(overlayChanged);
  for(const selector of ['#hud-root','#world-detail','#world-status-hud']){const node=document.querySelector(selector);if(node)observer.observe(node,{subtree:true,attributes:true,attributeFilter:['hidden','class','style','open','data-panel-state']});}
  const layoutRoot=document.querySelector('#world-layout');if(layoutRoot)observer.observe(layoutRoot,{attributes:true,attributeFilter:['style']});
  for(const selector of ['header','#hud-dock','#hud-agent','#hud-locate-agent','#hud-window','#world-detail','#world-status-hud']){const node=document.querySelector(selector);if(node)resizer.observe(node);}
  function set(projection){
    if(destroyed)return;authoritative=projection.source==='server';frozen=authoritative&&projection.stale===true;selectedId=projection.selectedAgentId;const ids=new Set(projection.agents.map(agent=>agent.agentId));motion.sync(authoritative?[]:[...ids]);
    labels.setAttribute('aria-label',authoritative?'服务器公开角色地图操作':'我的 Agent 地图操作');
    for(const [id,entry]of entries)if(!ids.has(id)){entry.button.remove();entries.delete(id);}
    if(!ids.has(focusedId))focusedId='';if(!ids.has(hoveredId))hoveredId='';
    const now=performance.now();for(const agent of projection.agents){
      let entry=entries.get(agent.agentId);if(!authoritative&&!motion.read(agent.agentId))continue;
      if(!entry){
        const button=el('button','world-owned-hit');button.type='button';labels.append(button);entry={agentId:agent.agentId,kind:'owned-agent',button,sprites:new Map()};entries.set(agent.agentId,entry);
        // Pointer hits stay on the canvas, where nearest live footpoint wins.
        // The stable transparent button supplies the equivalent keyboard entry.
        button.addEventListener('click',()=>onSelect(entry.agentId,button));
        button.addEventListener('focus',()=>{focusedId=agent.agentId;layout();});button.addEventListener('blur',()=>{focusedId='';layout();});
      }
      const spriteKey=JSON.stringify(agent.avatar);if(entry.spriteKey!==spriteKey){entry.sprites.clear();entry.spriteKey=spriteKey;}entry.avatar=agent.avatar;entry.nameValue=agent.name;
      entry.owned=authoritative?agent.owned:true;
      if(authoritative){if(frozen){entry.x??=agent.x;entry.y??=agent.y;entry.renderPosition={x:entry.x,y:entry.y};entry.walking=false;}else if(renderer)receivePosition(entry,agent,{now,serverTime:projection.serverTime??now});else Object.assign(entry,{x:agent.x,y:agent.y,walking:false,frame:0,direction:'down'});entry.projectionVersion=agent.projectionVersion;}
      entry.fact=authoritative?agent.fact:null;
      entry.button.dataset.agentId=entry.agentId;entry.button.dataset.worldSource=authoritative?'server':'demo';
      entry.button.setAttribute('aria-label',authoritative?`${agent.name}，服务器角色，${agent.fact.placeId==='commons'?'公共庭，':''}${agent.fact.status==='suspended'?'已暂停':'已加入'}${entry.owned?'，我的 Agent，选择并管理':'，查看公开事实'}`:`${agent.name}，${agent.agentId===selectedId?'当前 Agent':'我的 Agent'}，选择并管理`);entry.button.setAttribute('aria-pressed',String(agent.agentId===selectedId));
    }
    if(!authoritative)copyPositions();labels.hidden=!entries.size;const note=document.querySelector('#world-owned-note');if(note){note.hidden=!entries.size;note.textContent=authoritative?renderer?'角色位置来自服务器 · 小镇道路已开放，建筑内部尚未开放':'角色位置来自服务器 · 背景为演示，不表示在线':'自有角色动画仅供展示，不代表在线';}layout();
  }
  return{
    set,actors:()=>[...entries.values()],
    step(dt,options={}){if(authoritative){if(renderer&&!frozen)for(const entry of entries.values())advancePosition(entry,options.now??performance.now(),options);return;}motion.step(dt,{...options,heldIds:[focusedId,hoveredId]});copyPositions();},
    draw(ctx,entry,scale,frame={}){
      if(entry.agentId===selectedId){if(renderer)renderer.drawSelection(ctx,entry,scale,frame);else{const rx=Math.max(24,12/scale),ry=Math.max(9,5/scale);ctx.fillStyle='#C7E8DC';ctx.globalAlpha=.24;ctx.beginPath();ctx.ellipse(entry.x,entry.y+2,rx,ry,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=2;ctx.strokeStyle='#397E80';ctx.stroke();}}
      if(renderer){renderer.drawAvatar(ctx,entry,frame);return;}
      const key=`${entry.direction}:${entry.walking?entry.frame:'idle'}`;
      if(!entry.sprites.has(key))entry.sprites.set(key,avatarSprite({avatar:entry.avatar},entry.agentId,{walking:entry.walking,step:entry.frame,direction:entry.direction}));
      const geometry=shape(entry);ctx.drawImage(entry.sprites.get(key),entry.x-geometry.anchor.x,entry.y-geometry.anchor.y);
    },
    layout,hover(id){if(hoveredId===id)return;hoveredId=entries.has(id)?id:'';layout();},
    hit(point,scale,cycle=false){const selected=findAvatarHit([...entries.values()],point,scale,shape,cycle?lastHitId:undefined);if(cycle&&selected)lastHitId=selected.agentId;return selected;},
    geometry(id){const entry=entries.get(id);return entry?structuredClone(shape(entry)):null;},
    point(id){const position=authoritative?entries.get(id):motion.read(id);return position?{x:position.x,y:position.y}:null;},
    destroy(){destroyed=true;observer.disconnect();resizer.disconnect();motion.clear();entries.clear();labels.remove();const note=document.querySelector('#world-owned-note');if(note)note.hidden=true;},
  };
}
