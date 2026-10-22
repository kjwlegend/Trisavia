const windowFrames={
  enter:[{opacity:0,transform:'translateY(6px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],
  exit:[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(6px) scale(.985)'}],
};

// The actual panel node stays mounted. Animation completion and the timeout
// share one generation-checked finish path; neither can hide a reopened panel.
export function createPanelTransition(node,{
  motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),
  setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout,variant='window',
}={}){
  let state=node.hidden?'closed':'open',generation=0,active=null,destroyed=false;
  node.dataset.panelState=state;
  function cancel(){
    if(!active)return;
    const previous=active;active=null;clearTimer(previous.timer);
    previous.animation?.cancel();previous.resolve(false);
  }
  function finish(turn,visible){
    if(destroyed||turn!==generation||!active)return;
    const previous=active;active=null;if(previous){clearTimer(previous.timer);previous.animation?.cancel();}
    node.hidden=!visible;node.inert=!visible;node.style.pointerEvents=visible?'':'none';
    node.setAttribute('aria-hidden',String(!visible));state=visible?'open':'closed';node.dataset.panelState=state;
    previous?.resolve(true);
  }
  function move(visible){
    if(destroyed)return Promise.resolve(false);
    if((visible&&['open','opening'].includes(state))||(!visible&&['closed','closing'].includes(state)))return active?.promise||Promise.resolve(true);
    const interrupted=state==='opening'||state==='closing';
    const computed=interrupted?node.ownerDocument?.defaultView?.getComputedStyle(node):null;
    const first=computed?{opacity:computed.opacity,transform:computed.transform}:null;
    const turn=++generation;cancel();
    node.hidden=false;node.inert=!visible;node.style.pointerEvents=visible?'':'none';node.setAttribute('aria-hidden',String(!visible));
    state=visible?'opening':'closing';node.dataset.panelState=state;
    let resolve;const promise=new Promise(done=>{resolve=done;});active={promise,resolve,animation:null,timer:null};
    if(motion?.matches||typeof node.animate!=='function'){finish(turn,visible);return promise;}
    const tooltip=variant==='tooltip',duration=tooltip?(visible?100:80):(visible?160:120);
    const frames=tooltip?[{opacity:visible?0:1},{opacity:visible?1:0}]:windowFrames[visible?'enter':'exit'].map(frame=>({...frame}));
    if(first)frames[0]=tooltip?{opacity:first.opacity}:first;
    try{
      const animation=node.animate(frames,{duration,easing:visible?'cubic-bezier(.2,.8,.2,1)':'cubic-bezier(.4,0,1,1)',fill:'both'});
      active.animation=animation;
      // animate() can still be pending with startTime=null. Do not let a wall
      // clock cancel its first frame before the document starts playback.
      const armFallback=()=>{
        if(destroyed||turn!==generation||active?.animation!==animation)return;
        active.timer=setTimer(()=>finish(turn,visible),duration+80);
      };
      if(animation.ready?.then)animation.ready.then(armFallback,()=>finish(turn,visible));else armFallback();
      animation.finished.then(()=>finish(turn,visible),()=>{});
    }catch{finish(turn,visible);}
    return promise;
  }
  function reducedChanged(){if(motion.matches&&active)finish(++generation,state==='opening');}
  motion?.addEventListener('change',reducedChanged);
  return{show:()=>move(true),hide:()=>move(false),get state(){return state;},destroy(){if(destroyed)return;destroyed=true;generation++;cancel();motion?.removeEventListener('change',reducedChanged);}};
}
