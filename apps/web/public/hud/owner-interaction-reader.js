const invalid=()=>Object.assign(new Error('interaction_response_invalid'),{code:'interaction_response_invalid'});
const id=value=>typeof value==='string'&&value.length>0&&value.length<=180;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const text=value=>typeof value==='string';
const statuses=['awaiting_response','awaiting_feedback','reply_received','receipt_confirmed','declined','withdrawn','expired','unavailable'];
export function artifactRef(value){if(!id(value?.artifactId)||!integer(value.revision)||value.revision<1)throw invalid();return{artifactId:value.artifactId,revision:value.revision};}
export function readOwnerArtifact(value,{full=false,available=false}={}){
 const ref=artifactRef(full?value:value?.artifact);if(!integer(value.version)||!id(value.authorAgentId)||!text(value.title)||!integer(value.createdAt)||!(value.withdrawnAt===null||integer(value.withdrawnAt)))throw invalid();
 if(full&&!(value.body===null||text(value.body)))throw invalid();
 if(!full&&typeof value.contentAvailable!=='boolean')throw invalid();
 return{artifact:ref,version:value.version,authorAgentId:value.authorAgentId,title:value.title,createdAt:value.createdAt,withdrawnAt:value.withdrawnAt,contentAvailable:full?available:value.contentAvailable,...(full?{body:available&&value.withdrawnAt===null?value.body:null}:{})};
}
export function readOwnerExchange(value,direction){
 if(!id(value?.invitationId)||value.direction!==direction||!statuses.includes(value.status)||!integer(value.createdAt)||typeof value.contentAvailable!=='boolean'||!(value.title===null||text(value.title)))throw invalid();
 const counterpart=value.counterpart;if(counterpart!==null&&(!id(counterpart?.agentId)||!(counterpart.displayName===null||text(counterpart.displayName))))throw invalid();
 return{invitationId:value.invitationId,direction,artifact:value.artifact===null?null:artifactRef(value.artifact),title:value.title,counterpart:counterpart?{agentId:counterpart.agentId,displayName:counterpart.displayName}:null,status:value.status,createdAt:value.createdAt,contentAvailable:value.contentAvailable};
}
export function readOwnerInteractionResponse(envelope,{agentId,view,direction,detail=false,reference}={}){
 const data=envelope?.data;if(envelope?.protocolVersion!==1||!id(envelope.instanceId)||data?.agentId!==agentId||!integer(data.asOf))throw invalid();
 if(!detail){
  if(!Array.isArray(data.items)||typeof data.complete!=='boolean'||(data.complete?data.nextCursor!==null:!(typeof data.nextCursor==='string'&&data.nextCursor.length>0&&data.nextCursor.length<=2048))||view==='exchanges'&&data.direction!==direction)throw invalid();
  const items=data.items.map(value=>view==='artifacts'?readOwnerArtifact(value):readOwnerExchange(value,direction)),keys=items.map(value=>view==='artifacts'?JSON.stringify(value.artifact):value.invitationId);
  if(new Set(keys).size!==keys.length||view==='artifacts'&&items.some(value=>value.authorAgentId!==agentId))throw invalid();
  return{agentId,items,complete:data.complete,nextCursor:data.nextCursor,asOf:data.asOf};
 }
 if(view==='artifacts'){
  if(typeof data.contentAvailable!=='boolean')throw invalid();const artifact=readOwnerArtifact(data.artifact,{full:true,available:data.contentAvailable});if(artifact.authorAgentId!==agentId||JSON.stringify(artifact.artifact)!==JSON.stringify(artifactRef(reference)))throw invalid();return{artifact,contentAvailable:data.contentAvailable};
 }
 const exchange=readOwnerExchange(data.exchange,direction);if(exchange.invitationId!==reference)throw invalid();
 const artifact=data.artifact===null?null:readOwnerArtifact(data.artifact,{full:true,available:exchange.contentAvailable});if(artifact&&JSON.stringify(artifact.artifact)!==JSON.stringify(exchange.artifact))throw invalid();
 if(!(data.intent===null||text(data.intent)))throw invalid();const feedback=data.feedback;
 if(feedback!==null&&(!id(feedback?.id)||!id(feedback.activityId)||!id(feedback.authorAgentId)||!integer(feedback.version)||!text(feedback.body)||!integer(feedback.submittedAt)||feedback.withdrawnAt!==null))throw invalid();
 return{exchange,artifact,intent:exchange.contentAvailable?data.intent:null,feedback:exchange.contentAvailable&&feedback?{body:feedback.body,submittedAt:feedback.submittedAt}:null};
}
export function interactionStatus(value){return({awaiting_response:value.direction==='sent'?'已发送，待回应':'收到邀请，待回应',awaiting_feedback:'已接受，待回复',reply_received:value.direction==='sent'?'已收到回复':'已回复',receipt_confirmed:'已确认收到',declined:'已拒绝',withdrawn:'已撤回',expired:'已到期',unavailable:'当前不可查看'})[value.status]||'当前进展暂不可用';}
const blank=phase=>({phase,items:[],complete:false,nextCursor:null,asOf:null,error:null,detail:null,detailPhase:'idle',detailError:null});
// Source text stays only in memory and is invalidated on every Owner/Agent boundary.
export function createOwnerInteractionReader(session,{view='artifacts',direction='received',artifact=null}={}){
 let context=session.snapshot(),identity=context.observationRevision,active=false,disposed=false,revision=0,detailRevision=0,request=null,detailRequest=null,state=blank('idle');const listeners=new Set();
 const snapshot=()=>structuredClone(state),emit=value=>{state={...state,...value};for(const listener of listeners)listener(snapshot());};
 const agent=()=>context.authenticated&&['ready','refreshing'].includes(context.phase)&&context.agents?.some(value=>value.agentId===context.selectedAgentId)?context.selectedAgentId:'';
 function clearDetail(){detailRevision++;detailRequest?.abort();detailRequest=null;emit({detail:null,detailPhase:'idle',detailError:null});}
 function clear(){revision++;request?.abort();request=null;detailRevision++;detailRequest?.abort();detailRequest=null;emit(blank(!context.authenticated?'session':!agent()?'no_agent':'idle'));}
 async function load(more=false){
  if(disposed||!active)return;if(!agent()){clear();return;}revision++;request?.abort();const turn=revision,controller=new AbortController();request=controller;const previous=state,target=agent(),current=()=>!disposed&&active&&revision===turn&&!controller.signal.aborted;
  clearDetail();emit({phase:'loading',...(more?{}:{items:[],complete:false,nextCursor:null}),error:null});
  try{const result=readOwnerInteractionResponse(await session.readInteraction(view,{...(view==='exchanges'?{direction,...(artifact?{artifact}: {})}:{}),...(more?{cursor:previous.nextCursor}:{})},{signal:controller.signal}),{agentId:target,view,direction});if(!current())return;const items=more?[...previous.items,...result.items]:result.items,keys=items.map(value=>view==='artifacts'?JSON.stringify(value.artifact):value.invitationId);if(new Set(keys).size!==keys.length||more&&!result.complete&&result.nextCursor===previous.nextCursor)throw invalid();emit({...result,items,phase:'ready',error:null});}
  catch(error){if(current()&&error.name!=='AbortError')emit({...blank('error'),error:{status:error.status||null,code:error.code||'network_unknown'}});}finally{if(request===controller)request=null;}
 }
 async function detail(item){
  if(disposed||!active||!agent())return;detailRevision++;detailRequest?.abort();const turn=detailRevision,target=agent(),controller=new AbortController();detailRequest=controller;emit({detail:null,detailPhase:'loading',detailError:null});
  const reference=view==='artifacts'?item.artifact:item.invitationId;
  try{const result=readOwnerInteractionResponse(await session.readInteraction(view==='artifacts'?'artifact':'exchange',view==='artifacts'?{artifact:reference}:{invitationId:reference},{signal:controller.signal}),{agentId:target,view,direction,detail:true,reference});if(disposed||!active||turn!==detailRevision||controller.signal.aborted)return;emit({detail:result,detailPhase:'ready',detailError:null});}
  catch(error){if(!disposed&&active&&turn===detailRevision&&!controller.signal.aborted&&error.name!=='AbortError')emit({detail:null,detailPhase:'error',detailError:{status:error.status||null,code:error.code||'network_unknown'}});}finally{if(detailRequest===controller)detailRequest=null;}
 }
 const stop=session.subscribe(value=>{context=value;if(identity===value.observationRevision)return;identity=value.observationRevision;clear();if(active)void load();});clear();
 return{snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},setActive(value){if(active===Boolean(value)||disposed)return;active=Boolean(value);clear();if(active)void load();},configure(next){const nextDirection=next.direction??direction,nextArtifact=next.artifact??null;if(nextDirection===direction&&JSON.stringify(nextArtifact)===JSON.stringify(artifact))return;direction=nextDirection;artifact=nextArtifact;clear();if(active)void load();},load:()=>load(),loadMore:()=>state.phase==='ready'&&!state.complete?load(true):Promise.resolve(),detail,clearDetail,dispose(){disposed=true;active=false;clear();stop();listeners.clear();}};
}
