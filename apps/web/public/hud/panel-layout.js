// Fixed hosts use viewport coordinates, independently of document scroll.
export function panelRectangle(root,dock,header,viewport){
  const left=Math.max(root.left,viewport.left),right=Math.min(root.right,viewport.right),upper=Math.max(root.top,viewport.top),lower=Math.min(root.bottom,viewport.bottom);
  const top=Math.max(viewport.top+88,upper,header.bottom+16),bottom=Math.min(lower,dock.top-40);
  return{left:(left+right)/2,top:(top+Math.max(top,bottom))/2,width:Math.max(0,right-left-48),height:Math.max(0,bottom-top),safeTop:top};
}
export function createPanelLayout(root,dock,header){
  function update(){
    const vv=window.visualViewport,v={left:vv?.offsetLeft||0,top:vv?.offsetTop||0,right:(vv?.offsetLeft||0)+(vv?.width||innerWidth),bottom:(vv?.offsetTop||0)+(vv?.height||innerHeight)};
    const box=panelRectangle(root.getBoundingClientRect(),dock.getBoundingClientRect(),header?.getBoundingClientRect()||{bottom:0},v);
    for(const [key,value]of Object.entries({'--world-panel-top':box.safeTop,'--world-panel-center-x':box.left,'--world-panel-center-y':box.top,'--world-panel-width':box.width,'--world-panel-height':box.height}))root.style.setProperty(key,`${value}px`);
  }
  const observer=new ResizeObserver(update);observer.observe(root);observer.observe(dock);if(header)observer.observe(header);
  window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);update();
  return{update,destroy(){observer.disconnect();window.removeEventListener('scroll',update);window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);}};
}
