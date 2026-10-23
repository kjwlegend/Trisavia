import {api} from '../common.js';
const invalid=()=>Object.assign(new Error('log_response_invalid'),{code:'log_response_invalid'});
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max=1000)=>typeof value==='string'&&value.length<=max;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
export function browserLogTimeZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai';}catch{return'Asia/Shanghai';}}
export function logDateTime(epoch,timeZone){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(epoch).map(part=>[part.type,part.value]));return`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;}
export function readBehaviorLogs(envelope,{mode,agentId,timeZone}){
 const data=envelope?.data,coverage=data?.historyCoverage,maximum=mode==='world'?30:mode==='recent'?10:50;
 if(envelope?.protocolVersion!==1||data?.worldId!=='default'||data.agentId!==(mode==='world'?null:agentId)||data.timeZone!==timeZone||!Array.isArray(data.items)||data.items.length>maximum||!integer(data.asOf)||typeof data.partial!=='boolean'||!(data.nextPageToken===null||mode==='owner'&&text(data.nextPageToken,4096)&&data.nextPageToken.length>0)||!coverage||!(coverage.from===null||integer(coverage.from))||!(coverage.to===null||integer(coverage.to))||typeof coverage.complete!=='boolean'||!Array.isArray(coverage.gaps)||coverage.gaps.some(gap=>!text(gap,500)))throw invalid();
 const ids=new Set();for(const item of data.items){if(!text(item?.id,200)||!item.id||ids.has(item.id)||!text(item.agent?.agentId,180)||!item.agent.agentId||!(item.agent.displayName===null||text(item.agent.displayName,60))||mode!=='world'&&item.agent.agentId!==agentId||!text(item.title)||!text(item.action)||!text(item.result)||!integer(item.occurredAt)||!date(item.date)||!/^\d{2}:\d{2}$/.test(item.time)||!['world','relationships','interaction'].includes(item.source?.domain)||!text(item.source.node,180)||!(item.source.detail===null||typeof item.source.detail?.operation==='string'&&item.source.detail.input&&typeof item.source.detail.input==='object'&&!Array.isArray(item.source.detail.input)))throw invalid();ids.add(item.id);}
 return structuredClone(data);
}
// Only explicit open/refresh/range/page actions read. A scene poll never calls it.
export function createBehaviorLogReader({mode,session,request=api,timeZone=browserLogTimeZone(),eventTarget=globalThis.document}={}){
 let active=false,disposed=false,revision=0,abort=null,agentId='',identity='',context=session?.snapshot(),tokens=[null],page=0,filters={timeZone,fromDate:'',toDate:''};const listeners=new Set();
 let state={phase:'idle',data:null,errorStatus:null,page:0,canPrevious:false,canNext:false,filters:{...filters},agentName:'',retryPage:null};
 const snapshot=()=>structuredClone(state),emit=patch=>{state={...state,...patch};for(const listener of listeners)listener(snapshot());},available=()=>!disposed&&active&&!eventTarget?.hidden;
 function clear(phase='idle'){revision++;abort?.abort();abort=null;tokens=[null];page=0;emit({phase,data:null,errorStatus:null,page:0,canPrevious:false,canNext:false,filters:{...filters},retryPage:null});}
 function allowed(){if(mode!=='owner')return mode==='world'||Boolean(agentId);return context?.authenticated&&['ready','refreshing'].includes(context.phase)&&context.agents?.some(agent=>agent.agentId===agentId);}
 async function load(index=0,{refresh=false}={}){
  if(!available())return;if(!allowed()){clear(mode==='owner'?(context?.authenticated?'no_agent':'session'):'idle');return;}
  try{new Intl.DateTimeFormat('en',{timeZone:filters.timeZone});if(filters.fromDate&&!date(filters.fromDate)||filters.toDate&&!date(filters.toDate)||filters.fromDate&&filters.toDate&&filters.fromDate>filters.toDate)throw invalid();}catch{clear('invalid');return;}
  const previous=refresh?null:state.data,target=agentId,turn=++revision,controller=new AbortController(),input={timeZone:filters.timeZone,...(mode==='owner'?{...(filters.fromDate?{fromDate:filters.fromDate}:{}),...(filters.toDate?{toDate:filters.toDate}:{}),limit:20,...(tokens[index]?{pageToken:tokens[index]}:{})}:{})};abort?.abort();abort=controller;emit({phase:'loading',data:previous,errorStatus:null,retryPage:null});
  try{const result=mode==='owner'?await session.readBehaviorHistory(input,{signal:controller.signal}):await request(`/world/${mode==='world'?'logs':'agent-logs'}?${new URLSearchParams({...input,...(mode==='world'?{worldId:'default'}:{agentId:target})})}`,{signal:controller.signal});if(!available()||turn!==revision||controller.signal.aborted)return;const data=readBehaviorLogs(result,{mode,agentId:target,timeZone:filters.timeZone});if(index===0)tokens=[null];tokens=tokens.slice(0,index+1);if(data.nextPageToken)tokens[index+1]=data.nextPageToken;page=index;emit({phase:'ready',data,agentName:mode==='owner'?context?.agents?.find(agent=>agent.agentId===target)?.name||'':'',errorStatus:null,page,canPrevious:mode==='owner'&&page>0,canNext:mode==='owner'&&Boolean(data.nextPageToken),retryPage:null});}
  catch(error){if(!available()||turn!==revision||controller.signal.aborted||error.name==='AbortError')return;const lost=[401,403,404,409].includes(error.status);if(lost){clear(error.status===409?'changed':'forbidden');emit({errorStatus:error.status,agentName:''});}else emit({phase:'error',data:previous,errorStatus:error.status||null,retryPage:index});}
  finally{if(abort===controller)abort=null;}
 }
 const stop=session?.subscribe(value=>{context=value;const next=JSON.stringify([value.observationRevision,value.selectedAgentId]);if(next===identity)return;identity=next;if(mode==='owner'){agentId=value.selectedAgentId||'';state.agentName=value.agents?.find(agent=>agent.agentId===agentId)?.name||'';}clear(allowed()?'idle':value.authenticated?'no_agent':'session');if(available())void load(0,{refresh:true});});
 const visibility=()=>{if(eventTarget.hidden)clear();else if(active)void load(0,{refresh:true});};eventTarget?.addEventListener('visibilitychange',visibility);
 return{snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
  setActive(value){value=Boolean(value);if(disposed||active===value)return;active=value;clear(allowed()?'idle':mode==='owner'?context?.authenticated?'no_agent':'session':'idle');if(available())void load(0,{refresh:true});},
  target(value){if(mode!=='recent'||agentId===value)return;agentId=value||'';clear();if(available())void load(0,{refresh:true});},
  configure(patch){const next={...filters,...patch};if(JSON.stringify(next)===JSON.stringify(filters))return;filters=next;clear();if(available())void load(0,{refresh:true});},
  refresh:()=>load(0,{refresh:true}),retry:()=>load(state.retryPage??page,{refresh:!state.data}),next:()=>state.canNext?load(page+1):Promise.resolve(),previous:()=>state.canPrevious?load(page-1):Promise.resolve(),
  dispose(){if(disposed)return;disposed=true;active=false;clear();stop?.();eventTarget?.removeEventListener('visibilitychange',visibility);listeners.clear();},
 };
}
