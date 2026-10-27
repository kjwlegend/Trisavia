import {el} from '../common.js';
import {worldOverlayRects,overlaps,freeAreas} from '../world-safe-area.js';
import {expressionPolicy as policy,expressionActorKey,expressionPreview} from './world-expression-reader.js';
export function expressionBudget(bounds,blocked=[],density='standard'){
 const max=policy.limits.visibleBubblesPerViewport[density]??0;if(density!=='standard')return max;
 const room=freeAreas({left:0,right:bounds.width,top:0,bottom:bounds.height},blocked).some(r=>r.right-r.left>=900&&r.bottom-r.top>=520);return room?max:Math.min(2,max);
}
export function placeExpression(rect,size,bounds,blocked=[],gap=12,actors=[]){
 const x=(rect.left+rect.right)/2,w=size.width,h=size.height;
 if(rect.left<0||rect.right>bounds.width||rect.top<0||rect.bottom>bounds.height||blocked.some(b=>x>=b.left&&x<=b.right&&rect.top>=b.top&&rect.top<=b.bottom))return null;
 for(const candidate of [{left:x-w/2},{left:x-w+20},{left:x-20}]){
  const left=Math.round(Math.max(gap,Math.min(bounds.width-w-gap,candidate.left))),top=Math.floor(rect.top-h-12-gap),box={left,right:left+w,top,bottom:top+h+12};
  if(box.left<gap||box.right>bounds.width-gap||box.top<gap||box.bottom>bounds.height-gap||[...blocked,...actors].some(b=>overlaps({left:box.left-gap,right:box.right+gap,top:box.top-gap,bottom:box.bottom+gap},b)))continue;
  return{left,top,tail:Math.max(8,Math.min(w-16,x-left)),box};
 }return null;
}
function createExpressionArt(redraw){
 const loaded=new Map(),pending=new Map(),failed=new Set();let disposed=false;const controller=new AbortController();
 function get(ref){if(!ref||disposed)return null;if(loaded.has(ref.url))return loaded.get(ref.url);if(pending.has(ref.url)||failed.has(ref.url))return null;
  pending.set(ref.url,(async()=>{try{const response=await fetch(ref.url,{credentials:'omit',cache:'no-cache',signal:controller.signal});if(!response.ok)throw Error('art');const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==ref.bytes||hash!==ref.sha256)throw Error('digest');const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{if(bitmap.width!==ref.size[0]||bitmap.height!==ref.size[1]||disposed)throw Error('size');loaded.set(ref.url,URL.createObjectURL(new Blob([bytes],{type:'image/png'})));}finally{bitmap.close();}}catch{if(!disposed)failed.add(ref.url);}finally{pending.delete(ref.url);if(!disposed)redraw();}})());return null;
 }
 return{get,dispose(){disposed=true;controller.abort();for(const url of loaded.values())URL.revokeObjectURL(url);loaded.clear();pending.clear();}};
}
export function createExpressionLayer(root,lifecycle,{redraw=()=>{},onActive=()=>{},now=()=>performance.now()}={}){
 const node=el('div','world-expression-layer');root.append(node);const art=createExpressionArt(redraw),nodes=new Map();let lastFull='',density='standard',setId='gestures',lastEnteredAt=-Infinity;
 function clear(){for(const child of nodes.values())child.remove();nodes.clear();}
 function tick({actors,scale,active,reducedMotion,error=null}={}){
  node.dataset.protocolError=error||'';
  const full=active?lifecycle.full():[],key=JSON.stringify(full);if(key!==lastFull){lastFull=key;onActive(full);}
  if(!active){lifecycle.suspend();clear();return;}
  const candidates=lifecycle.candidates();if(density==='off'||!candidates.length){lifecycle.admit([],{discardPending:density==='off'});clear();return;}
  const locations=typeof actors==='function'?actors():actors,bounds=root.getBoundingClientRect(),blocked=worldOverlayRects(root,0),admitted=[],seen=new Set(),actorIds=new Set(),low=scale<.75,set=policy.sets.find(s=>s.id===setId);
  for(const element of document.querySelectorAll('#world-owned-tooltip,#world-town-tooltip,dialog[open]'))if(!element.hidden&&element.getClientRects().length){const b=element.getBoundingClientRect();blocked.push({left:b.left-bounds.left,right:b.right-bounds.left,top:b.top-bounds.top,bottom:b.bottom-bounds.top});}
  const max=expressionBudget(bounds,blocked,density),actorRects=[...locations.values()].map(actor=>actor.rect);
  for(const record of candidates){const row=record.row,actorId=expressionActorKey(row.actor),actor=locations.get(actorId);if(!actor||actorIds.has(actorId)||admitted.length>=max||!record.entered&&now()-lastEnteredAt<policy.limits.entryGapMs)continue;let bubble=nodes.get(row.expressionId);
   if(!bubble){bubble=el('div','world-expression');bubble.dataset.expressionId=row.expressionId;bubble.dataset.origin=row.origin;bubble.dataset.kind=row.kind;bubble.setAttribute('role','img');node.append(bubble);nodes.set(row.expressionId,bubble);}
   const emote=policy.emotes.find(e=>e.id===row.emoteId),content=row.kind==='emote'?emote.label:row.text,signature=JSON.stringify([actor.name,row.kind,content,low,setId]);
   if(bubble.dataset.content!==signature){bubble.dataset.content=signature;bubble.className='world-expression '+row.kind+(low?' is-dot':'');bubble.replaceChildren();bubble.setAttribute('aria-label',`${actor.name}：${content}`);if(!low)bubble.append(el('div','world-expression-meta',actor.name));
    const body=el('div','world-expression-body');bubble.artRef=null;bubble.artSpan=null;if(row.kind==='emote'){const sprite=el('span','world-expression-emote'),size=low?24:28;sprite.setAttribute('aria-hidden','true');sprite.textContent='·';sprite.style.backgroundPosition=`-${set.rects[row.emoteId][0]/48*size}px 0`;sprite.style.backgroundSize=`${size*8}px ${size}px`;bubble.artRef=set.atlas;bubble.artSpan=sprite;body.append(sprite);if(!low)body.append(el('span','',emote.label));}
    else if(row.kind==='status'){const a=actor.activity,semantic=a?.actionId==='fish.session'?'state.fishing':a?.actionId==='book.read'?'state.reading':['rest.bench','rest.inn','rest.voucher'].includes(a?.actionId)?'state.resting':null,ref=policy.states.find(s=>s.id===semantic);if(ref){const sprite=el('span','world-expression-state');sprite.setAttribute('aria-hidden','true');sprite.textContent='·';bubble.artRef=ref;bubble.artSpan=sprite;body.append(sprite);}else if(low)body.append(el('span','','·'));if(!low)body.append(el('span','',expressionPreview(row.text)));}
    else body.append(el('span','',low?'···':row.kind==='speech'?`「${expressionPreview(row.text)}」`:expressionPreview(row.text)));bubble.append(body);
   }
   bubble.hidden=false;const size=bubble.getBoundingClientRect(),position=placeExpression(actor.rect,size,bounds,blocked,12,actorRects);
   if(!position){bubble.hidden=true;continue;}bubble.style.left=position.left+'px';bubble.style.top=position.top+'px';bubble.style.setProperty('--expression-tail',position.tail+'px');
   const url=art.get(bubble.artRef);if(url){bubble.artSpan.style.backgroundImage=`url("${url}")`;bubble.artSpan.textContent='';}
   const enter=!record.static&&!record.entered&&!reducedMotion;if(enter)bubble.classList.add('is-entering');if(record.static||reducedMotion)bubble.classList.remove('is-entering');bubble.style.opacity=reducedMotion?'1':String(Math.max(0,Math.min(1,lifecycle.remaining(record)/140)));bubble.dataset.static=String(record.static||reducedMotion);if(!record.entered)lastEnteredAt=now();blocked.push(position.box);admitted.push(row.expressionId);seen.add(row.expressionId);actorIds.add(actorId);
  }
  lifecycle.admit(admitted);for(const[id,bubble]of nodes)if(!seen.has(id)){bubble.remove();nodes.delete(id);}
 }
 return{node,tick,settings(value){if(value.density in policy.limits.visibleBubblesPerViewport)density=value.density;if(policy.sets.some(s=>s.id===value.setId))setId=value.setId;for(const bubble of nodes.values())delete bubble.dataset.content;redraw();},dispose(){art.dispose();clear();node.remove();onActive([]);}};
}
