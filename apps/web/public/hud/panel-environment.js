// One environment preserves outer scroll across main and additional hosts.
// A main window keeps the existing HUD reachable; a detail is the only layer.
let environment;
export function getPanelEnvironment(){
  if(environment)return environment;
  const hosts=new Map(),blocked=new Map(),backdrop=document.createElement('div');backdrop.className='pixel-panel-backdrop';backdrop.hidden=true;(document.querySelector('#world-layout')||document.body).append(backdrop);
  let styles=null;
  function update(){
    for(const [node,value]of blocked)node.inert=value;blocked.clear();
    const top=hosts.get('detail')||[...hosts.values()].at(-1);
    if(!top){backdrop.hidden=true;if(styles){document.documentElement.style.overflow=styles.html;document.body.style.overflow=styles.body;document.documentElement.style.scrollbarGutter=styles.gutter;styles=null;}return;}
    if(!styles){styles={html:document.documentElement.style.overflow,body:document.body.style.overflow,gutter:document.documentElement.style.scrollbarGutter};if(document.documentElement.scrollHeight>innerHeight)document.documentElement.style.scrollbarGutter='stable';document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';}
    backdrop.hidden=false;
    const selectors=['.world-map-column','#world-place-directory','.world-intro','#world-entry','body>footer','body>header','.hud-agent','.hud-locate-agent','.hud-explore-exit','.hud-map-tools'];
    const nodes=[...document.querySelectorAll(selectors.join(','))];if(hosts.has('detail'))nodes.push(document.querySelector('#hud-window'),document.querySelector('#hud-dock'));
    for(const node of nodes)if(node&&!node.contains(top.node)){blocked.set(node,node.inert);node.inert=true;}
  }
  function keydown(event){
    const top=hosts.get('detail')||[...hosts.values()].at(-1);if(!top||event.key!=='Tab')return;
    const areas=[top.node,...(!hosts.has('detail')?[document.querySelector('#hud-dock')]:[])].filter(Boolean);
    const controls=areas.flatMap(area=>[...area.querySelectorAll('button,a[href],input,textarea,select,[tabindex]')]).filter(node=>!node.disabled&&!node.closest('[inert]')&&node.tabIndex>=0&&node.getClientRects().length);
    if(!controls.length)return;event.preventDefault();const index=controls.indexOf(document.activeElement),next=event.shiftKey?(index<=0?controls.length-1:index-1):(index+1)%controls.length;controls[next].focus({preventScroll:true});
  }
  document.addEventListener('keydown',keydown,true);
  environment={set(key,node){if(node)hosts.set(key,{node});else hosts.delete(key);update();},destroy(){hosts.clear();update();document.removeEventListener('keydown',keydown,true);backdrop.remove();environment=null;}};return environment;
}
