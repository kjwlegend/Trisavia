import policy from '../world-expressions/v1/manifest.json' with {type:'json'};
export const expressionPolicy=policy;
const keys=['expressionId','kind','origin','actor','worldId','sceneId','createdAt','expiresAt','text','emoteId','sourceActivityId'];
const text=(v,max)=>typeof v==='string'&&Array.from(v).length>0&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f]/u.test(v);
const fail=()=>{throw Error('world_expression_invalid');};
export const expressionActorKey=actor=>actor.kind+':'+actor.id;
export function expressionActors(avatars=[],npcs=[]){return new Map([...avatars.map(row=>['agent:'+row.agentId,{name:row.profile.displayName,activity:row.activity,status:row.status}]),...npcs.map(row=>['npc:'+row.npcId,{name:row.name,activity:row.activity,status:'idle'}])]);}
export function expressionMatches(row,actors){const actor=actors.get(expressionActorKey(row.actor));if(!actor||actor.status==='suspended'||actor.status==='left')return false;if(['status','ambient'].includes(row.kind)){const a=actor.activity;return a?.state==='active'&&a.activityId===row.sourceActivityId&&(row.kind==='status'?policy.statusTemplates.some(t=>t.actionId===a.actionId&&t.text===row.text):row.actor.kind==='npc');}return true;}
export function readExpressions(value,{worldId='default',mapId='pixel-town-v2',actors=new Map()}={}){
 if(value===undefined)return{expressions:[],expressionError:null};
 try{
  if(!Array.isArray(value)||value.length>policy.limits.expressionsPerReadMax||new TextEncoder().encode(JSON.stringify(value)).length>policy.limits.expressionBatchBytesMax)fail();const ids=new Set();
  const expressions=value.map(row=>{const spec=policy.kinds[row?.kind];if(!row||Object.keys(row).length!==keys.length||keys.some(k=>!Object.hasOwn(row,k))||!spec||row.origin!==spec.origin||!text(row.expressionId,180)||ids.has(row.expressionId)||row.worldId!==worldId||row.sceneId!==worldId+':'+mapId||!row.actor||Object.keys(row.actor).length!==2||!['agent','npc'].includes(row.actor.kind)||!text(row.actor.id,180)||!Number.isSafeInteger(row.createdAt)||row.createdAt<0||!Number.isSafeInteger(row.expiresAt)||!(['status','ambient'].includes(row.kind)?[6000,12000]:[spec.ttlMs]).includes(row.expiresAt-row.createdAt))fail();
   if(row.kind==='emote'?(row.text!==null||row.sourceActivityId!==null||row.actor.kind!=='agent'||!policy.emotes.some(e=>e.id===row.emoteId)):!text(row.text,spec.maxCodePoints)||row.emoteId!==null)fail();
   if(row.kind==='speech'&&(row.actor.kind!=='agent'||row.sourceActivityId!==null)||['status','ambient'].includes(row.kind)&&!text(row.sourceActivityId,180)||row.kind==='ambient'&&row.actor.kind!=='npc')fail();ids.add(row.expressionId);return Object.fromEntries(keys.map(key=>[key,key==='actor'?{kind:row.actor.kind,id:row.actor.id}:row[key]]));
  });return{expressions:expressions.filter(row=>expressionMatches(row,actors)),expressionError:null};
 }catch{return{expressions:[],expressionError:'world_expression_invalid'};}
}
export function mergeExpressions(batches,options){
 if(batches.some(b=>b.expressionError))return{expressions:[],expressionError:'world_expression_invalid'};
 const rows=new Map();for(const batch of batches)for(const row of batch.expressions){const previous=rows.get(row.expressionId);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))return{expressions:[],expressionError:'world_expression_invalid'};rows.set(row.expressionId,row);}
 const sorted=[...rows.values()].filter(row=>expressionMatches(row,options.actors)).sort((a,b)=>policy.kinds[b.kind].priority-policy.kinds[a.kind].priority||b.createdAt-a.createdAt||a.expressionId.localeCompare(b.expressionId)),actors=new Set(),result=[];
 for(const row of sorted){const key=expressionActorKey(row.actor);if(actors.has(key))continue;actors.add(key);if(result.length===16)break;const candidate=[...result,row];if(new TextEncoder().encode(JSON.stringify(candidate)).length<=8192)result.push(row);}return{expressions:result,expressionError:null};
}
export function expressionPreview(value,max=28){if(typeof Intl.Segmenter!=='function')return Array.from(value).length<=max?value:'…';const graphemes=[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(value)].map(v=>v.segment);return graphemes.length>max?graphemes.slice(0,max).join('')+'…':value;}
