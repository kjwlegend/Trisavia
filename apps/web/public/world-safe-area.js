export const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
export function freeAreas(bounds,blocked){
  let areas=[bounds];
  for(const obstacle of blocked){const next=[];for(const area of areas){
    if(!overlaps(area,obstacle)){next.push(area);continue;}
    const left=Math.max(area.left,obstacle.left),right=Math.min(area.right,obstacle.right),top=Math.max(area.top,obstacle.top),bottom=Math.min(area.bottom,obstacle.bottom);
    for(const rect of [{...area,bottom:top},{...area,top:bottom},{left:area.left,right:left,top,bottom},{left:right,right:area.right,top,bottom}])if(rect.right>rect.left&&rect.bottom>rect.top)next.push(rect);
  }areas=next;}
  return areas;
}
export function worldOverlayRects(root,margin=8){
  const box=root.getBoundingClientRect(),rects=[];
  for(const selector of ['header','#hud-dock','#hud-agent','#hud-locate-agent','#hud-window','#hud-detail-window','#world-detail','#hud-tooltip','.world-demo','.hud-map-tools','.hud-map-menu','.hud-mail-feedback']){
    const node=document.querySelector(selector);if(!node||node.hidden||!node.getClientRects().length)continue;
    const r=node.getBoundingClientRect();let {left,right,top,bottom}=r;
    // Reserve the final centered window as well as its animated silhouette.
    // A scaled opening frame must not briefly admit a label beneath its edge.
    if(box.width>=760&&node.dataset.panelState&&node.matches('.hud-window,.world-detail')){
      const parent=node.offsetParent?.getBoundingClientRect();
      if(parent){const x=parent.left+node.offsetLeft,y=parent.top+node.offsetTop;left=Math.min(left,x-node.offsetWidth/2);right=Math.max(right,x+node.offsetWidth/2);top=Math.min(top,y-node.offsetHeight/2);bottom=Math.max(bottom,y+node.offsetHeight/2+8);}
    }
    rects.push({left:left-box.left-margin,right:right-box.left+margin,top:top-box.top-margin,bottom:bottom-box.top+margin});
  }
  return rects;
}
