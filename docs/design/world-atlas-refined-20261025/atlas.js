(() => {
 'use strict';
 const data=window.TrisaviaAtlasData,G=window.AtlasGeometry,$=s=>document.querySelector(s);
 const dialog=$('#atlas'),viewport=$('#map-viewport'),stage=$('#map-stage'),details=$('#details'),pins=$('#pins');
 let region=data.regions.find(r=>r.id==='dawn'),destination=null,mode='region',zoom=1,pan={x:0,y:0},base={w:0,h:0},drag=null,lastTrigger=$('#open-map'),artOnly=false;
 const current=data.regions.flatMap(r=>r.destinations).find(d=>d.id===data.currentDestinationId);
 const isOpen=d=>d?.id==='qingzhou-town'&&d.state==='open'&&d.worldId==='default';
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icons={城镇:'<path d="m3 11 9-7 9 7M5 10v11h14V10M10 21v-7h4v7M8 10h2m4 0h2"/>',场景:'<path d="m2 20 7-13 5 8 3-5 5 10ZM9 7l3 6M5 20h16"/>',场所:'<path d="M5 21V7h14v14M9 7V3h6v4M3 21h18M9 11h1m4 0h1m-6 4h1m4 0h1"/>'};
 const tag=d=>`<span class="tag ${isOpen(d)?'open':''}">${isOpen(d)?'已开放':'未开放'}</span>`;
 function regionAnchor(r){return G.regions[r.id].label;}
 function destinationAnchor(d){return G.destinations[d.id].anchor;}
 function transform(){
  const W=viewport.clientWidth,H=viewport.clientHeight;
  const minX=Math.min(0,W-base.w*zoom),minY=Math.min(0,H-base.h*zoom);
  pan.x=base.w*zoom<=W?(W-base.w*zoom)/2:Math.min(0,Math.max(minX,pan.x));
  pan.y=base.h*zoom<=H?(H-base.h*zoom)/2:Math.min(0,Math.max(minY,pan.y));
  stage.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;stage.style.setProperty('--zoom',zoom);
  viewport.classList.toggle('zoomed',zoom>1);$('#zoom-reset').textContent=Math.round(zoom*100)+'%';$('#zoom-out').disabled=zoom<=1;$('#zoom-in').disabled=zoom>=2.5;
  for(const el of stage.querySelectorAll('button')){const x=pan.x+parseFloat(el.style.left)/100*base.w*zoom,y=pan.y+parseFloat(el.style.top)/100*base.h*zoom,visible=x>8&&x<W-8&&y>8&&y<H-8;el.tabIndex=visible?0:-1;el.setAttribute('aria-hidden',String(!visible));}
 }
 function fit(){const W=viewport.clientWidth,H=viewport.clientHeight;if(!W||!H)return;base.w=Math.min(W,H*1.5);base.h=base.w/1.5;stage.style.width=base.w+'px';stage.style.height=base.h+'px';dialog.style.setProperty('--atlas-details-height',(H+document.querySelector('.map-key').offsetHeight)+'px');transform();}
 function zoomTo(value,anchor=null){const old=zoom;zoom=Math.min(2.5,Math.max(1,value));const W=viewport.clientWidth,H=viewport.clientHeight;if(anchor){pan={x:W/2-anchor[0]/100*base.w*zoom,y:H/2-anchor[1]/100*base.h*zoom};}else{pan={x:W/2-(W/2-pan.x)*zoom/old,y:H/2-(H/2-pan.y)*zoom/old};}transform();}
 function render(){
  $('#region-tabs').innerHTML=data.regions.map(r=>`<button data-region="${r.id}" aria-pressed="${r.id===region.id}">${escape(r.name)}</button>`).join('');
  $('#boundaries').innerHTML=data.regions.map(r=>`<path class="boundary ${r.id===region.id?'selected':''}" data-outline="${r.id}" d="${G.regions[r.id].path}"/>`).join('');
  $('#region-labels').innerHTML=data.regions.map(r=>{const [x,y]=regionAnchor(r);return `<button class="region-label" data-region="${r.id}" style="left:${x}%;top:${y}%" aria-pressed="${r.id===region.id}" aria-label="查看${escape(r.name)}，${r.id==='dawn'?'仅清昼小镇开放':'未开放地区'}"><b>${escape(r.name)}</b><small>${escape(G.regions[r.id].english)}</small></button>`;}).join('');
  pins.innerHTML=data.regions.flatMap(r=>r.destinations).map(d=>{const [x,y]=destinationAnchor(d),selected=destination?.id===d.id;return `<button class="pin ${isOpen(d)?'open':''} ${selected?'selected':''} ${G.destinations[d.id].labelUp?'label-up':''}" data-destination="${d.id}" style="left:${x}%;top:${y}%" aria-label="${escape(d.name)}，${isOpen(d)?'当前镇，已开放':'未开放，查看规划'}"><i class="pin-mark"></i>${isOpen(d)||selected?`<span class="pin-name">${escape(d.name)}${isOpen(d)?'<small>当前</small>':''}</span>`:''}</button>`;}).join('');
  const thumb=G.regions[region.id].thumb;
  if(mode==='region'){
   details.innerHTML=`<div class="detail-kicker">${escape(region.subtitle)}<span class="tag ${region.id==='dawn'?'open':''}">${region.id==='dawn'?'局部开放':'未开放'}</span></div><h2 tabindex="-1">${escape(region.name)}</h2><div class="region-thumb" style="background-position:${thumb[0]}% ${thumb[1]}%" role="img" aria-label="${escape(region.name)}地貌细节"></div><p>${escape(region.summary)}</p><div class="section-label"><span>城镇与场景</span><span>${region.destinations.length} 处</span></div><ul class="destination-list">${region.destinations.map(d=>`<li><button class="destination-row ${isOpen(d)?'selected':''}" data-destination="${d.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[d.kind]}</svg><span><strong>${escape(d.name)}</strong><small>${escape(d.kind)} · ${isOpen(d)?'当前镇 · 已开放':'规划中 · 未开放'}</small></span><span class="arrow" aria-hidden="true">›</span></button></li>`).join('')}</ul><p class="details-note">${region.id==='dawn'?'目前仅清昼小镇开放，其余地点仍在规划中。':'远方尚未开放；地图上的地貌与建筑描绘未来的世界设想。'}</p>`;
  }else{
   details.innerHTML=`<button class="detail-back" data-region="${region.id}">← 返回${escape(region.name)}</button><div class="detail-kicker">${escape(destination.kind)} ${tag(destination)}</div><h2 tabindex="-1">${escape(destination.name)}</h2><div class="region-thumb" style="background-position:${thumb[0]}% ${thumb[1]}%" role="img" aria-label="${escape(region.name)}地貌细节"></div><p>${escape(destination.summary)}</p>${destination.places.length?`<div class="section-label">镇中场所</div><ul class="place-chips">${destination.places.map(p=>`<li>${escape(p)}</li>`).join('')}</ul>`:''}<p class="details-note">${isOpen(destination)?'回到清昼小镇后，在当前地图中查看场所。地图册不触发移动或跨城传送。':'这里展示未来的世界设想，地点尚未开放，暂时无法进入。'}</p>`;
  }
  const available=mode==='region'?region.id==='dawn':isOpen(destination);$('#enter').disabled=!available;$('#enter').innerHTML=available?'回到清昼小镇 <span aria-hidden="true">↗</span>':'尚未开放';
  details.scrollTop=0;transform();
 }
 function selectRegion(id,focus=false){const next=data.regions.find(r=>r.id===id);if(!next)return;region=next;destination=null;mode='region';if(zoom>1)zoomTo(zoom,regionAnchor(region));render();if(focus)details.querySelector('h2').focus({preventScroll:true});}
 function selectDestination(id){const nextRegion=data.regions.find(r=>r.destinations.some(d=>d.id===id));if(!nextRegion)return;region=nextRegion;destination=region.destinations.find(d=>d.id===id);mode='destination';if(zoom>1)zoomTo(zoom,destinationAnchor(destination));render();details.querySelector('h2').focus({preventScroll:true});}
 for(const container of [$('#region-tabs'),$('#region-labels'),pins,details])container.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.region)selectRegion(b.dataset.region,true);if(b.dataset.destination)selectDestination(b.dataset.destination);});
 $('#region-labels').addEventListener('pointerover',e=>{const b=e.target.closest('[data-region]');if(b)$(`[data-outline="${b.dataset.region}"]`).classList.add('hovered');});$('#region-labels').addEventListener('pointerout',()=>document.querySelectorAll('.boundary.hovered').forEach(p=>p.classList.remove('hovered')));
 $('#zoom-in').addEventListener('click',()=>zoomTo(zoom+.5));$('#zoom-out').addEventListener('click',()=>zoomTo(zoom-.5));$('#zoom-reset').addEventListener('click',()=>zoomTo(1));
 $('#art-only').addEventListener('click',()=>{artOnly=!artOnly;viewport.classList.toggle('art-only',artOnly);$('#art-only').setAttribute('aria-pressed',String(artOnly));$('#art-only').textContent=artOnly?'显示地点':'欣赏底图';});
 viewport.addEventListener('pointerdown',e=>{if(zoom<=1||e.target.closest('button'))return;drag={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y,id:e.pointerId};viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');e.preventDefault();});
 viewport.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;pan={x:drag.px+e.clientX-drag.x,y:drag.py+e.clientY-drag.y};transform();});
 const endDrag=()=>{drag=null;viewport.classList.remove('dragging');};viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);
 $('#locate').addEventListener('click',()=>{region=data.regions.find(r=>r.id==='dawn');destination=current;mode='destination';artOnly=false;viewport.classList.remove('art-only');$('#art-only').setAttribute('aria-pressed','false');$('#art-only').textContent='欣赏底图';zoomTo(1);render();pins.querySelector('.open').focus({preventScroll:true});});
 $('#enter').addEventListener('click',()=>{if($('#enter').disabled)return;dialog.close();$('#status').textContent='已收起地图 · 本页为设计预览，未触发实际移动';});
 function open(trigger){lastTrigger=trigger;$('#status').textContent='';dialog.showModal();fit();render();$('#close-map').focus();}
 $('#open-map').addEventListener('click',e=>open(e.currentTarget));$('#close-map').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>lastTrigger.focus());
 dialog.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const all=[...dialog.querySelectorAll('button:not(:disabled):not([tabindex="-1"])')].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
 const img=$('#terrain');const ready=()=>{$('#loading').hidden=true;window.atlasReady=true;};if(img.complete&&img.naturalWidth)ready();else img.addEventListener('load',ready,{once:true});img.addEventListener('error',()=>{$('#loading').textContent='地图底图未加载，请刷新重试。';});
 new ResizeObserver(fit).observe(viewport);open($('#open-map'));
})();
