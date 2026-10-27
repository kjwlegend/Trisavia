import {expressionPolicy as policy,expressionActors,expressionMatches} from './world-expression-reader.js';
// Absolute server expiry is converted once to a monotonic deadline per ID.
export function createExpressionLifecycle({now=()=>performance.now()}={}){
 let anchor=null,scope='',initial=true,actors=new Map();const seen=new Map();
 const serverNow=()=>anchor===null?null:anchor.server+Math.max(0,now()-anchor.at);
 function observe(state){
  const nextScope=state.instanceId+'|'+state.worldId+'|'+(state.rules?.mapManifest?.mapId||'pixel-town-v2');if(scope!==nextScope){seen.clear();scope=nextScope;anchor=null;initial=true;}
  actors=expressionActors(state.avatars,state.npcs);if(!state.complete||state.stale||!['ready','refreshing'].includes(state.phase)||!Number.isSafeInteger(state.serverTime)){suspend();initial=true;return;}
  const at=now(),observed=Number.isFinite(state.expressionObservedAtMono)?Math.max(0,at-state.expressionObservedAtMono):0,server=(state.expressionServerTime??state.serverTime)+observed;anchor={server,at};const current=new Set();
  for(const row of state.expressions||[]){if(!expressionMatches(row,actors))continue;current.add(row.expressionId);const previous=seen.get(row.expressionId),key=JSON.stringify(row);if(previous){previous.authorized=previous.key===key;if(!previous.authorized)previous.dropped=true;continue;}
   const remaining=Math.max(0,row.expiresAt-serverNow()),valid=remaining>0&&row.createdAt<=serverNow();seen.set(row.expressionId,{row,key,authorized:valid,static:initial,at,expires:at+remaining,visual:at+Math.min(remaining,row.kind==='speech'?policy.limits.speechVisualMaxMs:policy.limits.otherVisualMaxMs),dropped:!valid,entered:false});
  }
  for(const [id,record]of seen){if(!current.has(id)){record.authorized=false;record.dropped=true;}if(at-record.at>60000&&at>=record.expires)seen.delete(id);}while(seen.size>1024)seen.delete(seen.keys().next().value);initial=false;
 }
 function suspend(){for(const record of seen.values()){record.authorized=false;record.dropped=true;}}
 const full=()=>[...seen.values()].filter(r=>r.authorized&&r.expires>now()&&expressionMatches(r.row,actors)).map(r=>r.row);
 const candidates=()=>[...seen.values()].filter(r=>r.authorized&&!r.dropped&&r.visual>now()&&expressionMatches(r.row,actors)).sort((a,b)=>policy.kinds[b.row.kind].priority-policy.kinds[a.row.kind].priority||b.row.createdAt-a.row.createdAt||a.row.expressionId.localeCompare(b.row.expressionId));
 // A currently authorized, unseen expression may wait for room only until its
 // original visual deadline. Once shown, losing its slot never replays it.
 function admit(ids,{discardPending=false}={}){const accepted=new Set(ids);for(const r of candidates()){if(accepted.has(r.row.expressionId))r.entered=true;else if(r.entered||discardPending)r.dropped=true;}}
 return{observe,full,candidates,admit,suspend,serverNow,remaining:record=>Math.max(0,record.visual-now()),actor:key=>actors.get(key),clear(){seen.clear();actors.clear();anchor=null;scope='';initial=true;}};
}
