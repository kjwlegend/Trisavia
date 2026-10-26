import {el} from '../common.js';
import {worldOverlayRects,overlaps} from '../world-safe-area.js';
import {expressionPolicy as policy,expressionActorKey,expressionPreview} from './world-expression-reader.js';
export function placeExpression(rect,size,bounds,blocked=[],gap=12){
 const x=(rect.left+rect.right)/2,w=size.width,h=size.height;
 if(rect.left<0||rect.right>bounds.width||rect.top<0||rect.bottom>bounds.height||blocked.some(b=>x>=b.left&&x<=b.right&&rect.top>=b.top&&rect.top<=b.bottom))return null;
 for(const candidate of [{left:x-w/2,top:rect.top-h-12},{left:x-w+20,top:rect.top-h-12},{left:x-20,top:rect.top-h-12},{left:x-w/2,top:rect.bottom+12,below:true}]){
  const left=Math.max(gap,Math.min(bounds.width-w-gap,candidate.left)),top=candidate.top,box={left,right:left+w,top:top-(candidate.below?12:0),bottom:top+h+(candidate.below?0:12)};
  if(box.left<gap||box.right>bounds.width-gap||box.top<gap||box.bottom>bounds.height-gap||blocked.some(b=>overlaps({left:box.left-gap,right:box.right+gap,top:box.top-gap,bottom:box.bottom+gap},b)))continue;
  return{left,top,below:Boolean(candidate.below),tail:Math.max(8,Math.min(w-16,x-left)),box};
 }return null;
}
function createExpressionArt(redraw){
 const loaded=new Map(),pending=new Map(),failed=new Set();let disposed=false;const controller=new AbortController();
 function get(ref){if(!ref||disposed)return null;if(loaded.has(ref.url))return loaded.get(ref.url);if(pending.has(ref.url)||failed.has(ref.url))return null;
  pending.set(ref.url,(async()=>{try{const response=await fetch(ref.url,{credentials:'omit',cache:'no-cache',signal:controller.signal});if(!response.ok)throw Error('art');const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==ref.bytes||hash!==ref.sha256)throw Error('digest');const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{if(bitmap.width!==ref.size[0]||bitmap.height!==ref.size[1]||disposed)throw Error('size');loaded.set(ref.url,URL.createObjectURL(new Blob([bytes],{type:'image/png'})));}finally{bitmap.close();}}catch{if(!disposed)failed.add(ref.url);}finally{pending.delete(ref.url);if(!disposed)redraw();}})());return null;
 }
 return{get,dispose(){disposed=true;controller.abort();for(const url of loaded.values())URL.revokeObjectURL(url);loaded.clear();pending.clear();}};
}
export function createExpressionLayer(root,lifecycle,{redraw=()=>{},onActive=()=>{}}={}){
 const node=el('div','world-expression-layer');root.append(node);const art=createExpressionArt(redraw),nodes=new Map();let lastFull='',density='standard',setId='gestures';
 function clear(){for(const child of nodes.values())child.remove();nodes.clear();}
 function tick({actors,scale,active,reducedMotion,error=null}={}){
  node.dataset.protocolError=error||'';
  const full=active?lifecycle.full():[],key=JSON.stringify(full);if(key!==lastFull){lastFull=key;onActive(full);}
  if(!active){lifecycle.suspend();clear();return;}
  const max=policy.limits.visibleBubblesPerViewport[density],candidates=lifecycle.candidates();if(!max||!candidates.length){lifecycle.admit([]);clear();return;}
  const locations=typeof actors==='function'?actors():actors,bounds=root.getBoundingClientRect(),blocked=worldOverlayRects(root,0),admitted=[],seen=new Set(),actorIds=new Set(),low=scale<.75,set=policy.sets.find(s=>s.id===setId);
  for(const element of document.querySelectorAll('#world-owned-tooltip,#world-town-tooltip,dialog[open]'))if(!element.hidden&&element.getClientRects().length){const b=element.getBoundingClientRect();blocked.push({left:b.left-bounds.left,right:b.right-bounds.left,top:b.top-bounds.top,bottom:b.bottom-bounds.top});}
  for(const record of candidates){const row=record.row,actorId=expressionActorKey(row.actor),actor=locations.get(actorId);if(!actor||actorIds.has(actorId)||admitted.length>=max)continue;let bubble=nodes.get(row.expressionId);
   if(!bubble){bubble=el('div','world-expression');bubble.dataset.expressionId=row.expressionId;bubble.dataset.origin=row.origin;bubble.dataset.kind=row.kind;bubble.setAttribute('role','img');node.append(bubble);nodes.set(row.expressionId,bubble);}
   const emote=policy.emotes.find(e=>e.id===row.emoteId),content=row.kind==='emote'?emote.label:row.text,signature=JSON.stringify([actor.name,row.kind,content,low,setId]);
   if(bubble.dataset.content!==signature){bubble.dataset.content=signature;bubble.className='world-expression '+row.kind+(low?' is-dot':'');bubble.replaceChildren();bubble.setAttribute('aria-label',`${actor.name}：${content}`);if(!low)bubble.append(el('div','world-expression-meta',actor.name));
    const body=el('div','world-expression-body');bubble.artRef=null;bubble.artSpan=null;if(row.kind==='emote'){const sprite=el('span','world-expression-emote');sprite.setAttribute('aria-hidden','true');sprite.textContent='·';sprite.style.backgroundPosition=`-${set.rects[row.emoteId][0]/48*28}px 0`;sprite.style.backgroundSize='224px 28px';bubble.artRef=set.atlas;bubble.artSpan=sprite;body.append(sprite);if(!low)body.append(el('span','',emote.label));}
    else if(row.kind==='status'){const a=actor.activity,semantic=a?.actionId==='fish.session'?'state.fishing':a?.actionId==='book.read'?'state.reading':['rest.bench','rest.inn','rest.voucher'].includes(a?.actionId)?'state.resting':null,ref=policy.states.find(s=>s.id===semantic);if(ref){const sprite=el('span','world-expression-state');sprite.setAttribute('aria-hidden','true');sprite.textContent='·';bubble.artRef=ref;bubble.artSpan=sprite;body.append(sprite);}else if(low)body.append(el('span','','·'));if(!low)body.append(el('span','',expressionPreview(row.text)));}
    else body.append(el('span','',low?'···':row.kind==='speech'?`「${expressionPreview(row.text)}」`:expressionPreview(row.text)));bubble.append(body);
   }
   bubble.hidden=false;const size=bubble.getBoundingClientRect(),position=placeExpression(actor.rect,size,bounds,blocked);
   if(!position){bubble.hidden=true;continue;}bubble.style.left=Math.round(position.left)+'px';bubble.style.top=Math.round(position.top)+'px';bubble.style.setProperty('--expression-tail',position.tail+'px');bubble.classList.toggle('below',position.below);
   const url=art.get(bubble.artRef);if(url){bubble.artSpan.style.backgroundImage=`url("${url}")`;bubble.artSpan.textContent='';}
   const enter=!record.static&&!record.entered&&!reducedMotion;if(enter)bubble.classList.add('is-entering');if(record.static||reducedMotion)bubble.classList.remove('is-entering');bubble.style.opacity=reducedMotion?'1':String(Math.max(0,Math.min(1,lifecycle.remaining(record)/140)));bubble.dataset.static=String(record.static||reducedMotion);blocked.push(position.box);admitted.push(row.expressionId);seen.add(row.expressionId);actorIds.add(actorId);
  }
  lifecycle.admit(admitted);for(const[id,bubble]of nodes)if(!seen.has(id)){bubble.remove();nodes.delete(id);}
 }
 return{node,tick,settings(value){if(value.density in policy.limits.visibleBubblesPerViewport)density=value.density;if(policy.sets.some(s=>s.id===value.setId))setId=value.setId;for(const bubble of nodes.values())delete bubble.dataset.content;redraw();},dispose(){art.dispose();clear();node.remove();onActive([]);}};
}
