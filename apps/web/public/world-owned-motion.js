const hash=value=>[...value].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,7);
function blockedSegment(a,b,rect){
  const left=rect.left-4,right=rect.right+4,top=rect.top-4,bottom=rect.bottom+4;
  if(a.x===b.x)return a.x>=left&&a.x<=right&&Math.max(a.y,b.y)>=top&&Math.min(a.y,b.y)<=bottom;
  if(a.y===b.y)return a.y>=top&&a.y<=bottom&&Math.max(a.x,b.x)>=left&&Math.min(a.x,b.x)<=right;
  return true;
}

// Client-side presentation only: no runtime, owner or service state enters here.
export function createOwnedAgentMotion(graph,{blockedRects=[]}={}){
  const roads=new Map(),states=new Map();
  for(const node of graph.values()){
    const neighbors=node.neighbors.filter(id=>{const next=graph.get(id);return next&&Math.hypot(next.x-node.x,next.y-node.y)>0&&!blockedRects.some(rect=>blockedSegment(node,next,rect));});
    if(neighbors.length)roads.set(node.id,{id:node.id,x:node.x,y:node.y,neighbors});
  }
  const spawns=[];
  for(const node of roads.values()){
    spawns.push({fromId:node.id,toId:node.neighbors[0],progress:0,x:node.x,y:node.y});
    for(const id of node.neighbors)if(node.id<id){const next=roads.get(id),length=Math.hypot(next.x-node.x,next.y-node.y);for(let d=48;d<length-24;d+=48)spawns.push({fromId:node.id,toId:id,progress:d,x:node.x+(next.x-node.x)*d/length,y:node.y+(next.y-node.y)*d/length});}
  }
  spawns.sort((a,b)=>Math.hypot(a.x-768,a.y-560)-Math.hypot(b.x-768,b.y-560)||a.fromId.localeCompare(b.fromId)||a.progress-b.progress);
  const random=state=>{state.seed=(Math.imul(state.seed,1664525)+1013904223)>>>0;return state.seed/4294967296;};
  function direction(state){const a=roads.get(state.fromId),b=roads.get(state.toId);return a.x===b.x?(b.y<a.y?'N':'S'):(b.x<a.x?'W':'E');}
  function sync(ids){
    const wanted=new Set(ids);for(const id of states.keys())if(!wanted.has(id))states.delete(id);
    for(const agentId of [...wanted].sort()){
      if(states.has(agentId)||!spawns.length)continue;
      const offset=hash(agentId)%Math.min(16,spawns.length),candidates=[...spawns.slice(offset),...spawns.slice(0,offset)];
      const spawn=candidates.find(p=>![...states.values()].some(s=>Math.hypot(s.x-p.x,s.y-p.y)<40))||candidates[0];
      const state={...spawn,agentId,seed:hash(agentId),previousId:'',clock:0,pause:0,walking:false,frame:0,direction:'S'};
      state.speed=20+random(state)*8;state.pause=.4+random(state)*2.4;state.direction=direction(state);states.set(agentId,state);
    }
  }
  function step(dt,{paused=false,visible=true,heldIds=[]}={}){
    if(paused||!visible||!Number.isFinite(dt)||dt<=0)return;
    const delta=Math.min(dt,.05),held=new Set(heldIds);
    for(const state of states.values()){
      if(held.has(state.agentId)){state.walking=false;state.frame=0;continue;}
      if(state.pause>0){state.pause=Math.max(0,state.pause-delta);state.walking=false;state.frame=0;continue;}
      const from=roads.get(state.fromId),to=roads.get(state.toId),length=Math.hypot(to.x-from.x,to.y-from.y);
      state.progress=Math.min(length,state.progress+state.speed*delta);const t=state.progress/length;
      state.x=from.x+(to.x-from.x)*t;state.y=from.y+(to.y-from.y)*t;state.clock+=delta;state.walking=true;state.frame=Math.floor(state.clock*6)%4;state.direction=direction(state);
      if(t===1){
        state.previousId=state.fromId;state.fromId=state.toId;state.progress=0;
        const choices=to.neighbors.filter(id=>id!==state.previousId),next=choices.length?choices:to.neighbors;
        state.toId=next[Math.floor(random(state)*next.length)];state.pause=.6+random(state)*2.4;state.walking=false;state.frame=0;
      }
    }
  }
  function read(agentId){const s=states.get(agentId);return s?{agentId:s.agentId,x:s.x,y:s.y,fromId:s.fromId,toId:s.toId,progress:s.progress,pause:s.pause,walking:s.walking,frame:s.frame,direction:s.direction}:null;}
  return{sync,step,read,clear(){states.clear();}};
}
