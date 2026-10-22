import {assertWorldActionAllowed} from '../domains/access/world-action-policy.ts';
import {randomUUID} from 'node:crypto';
import type {JsonObject} from '../contracts/store.ts';
import type {CommandKey,CommandReceipt,RuntimeReadContext,RuntimeTransaction} from '../contracts/runtime-store.ts';
import {commitRuntimeCommandIn,hashRuntimeRequest} from '../domains/runtime/command.ts';
import {M1Error,fail,object,text,version} from '../domains/common/errors.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {decisionRepository,type DecisionIntent,type DecisionRequest} from '../domains/decision/repository.ts';
import {INITIAL_DISPATCH_POLICY,type DecisionDispatchPolicy,type DecisionIntentSink,type DecisionOrigin,type DecisionTarget} from '../domains/decision/public.ts';
import {createDecisionCursor} from '../domains/decision/cursor.ts';
const terminal=new Set(['resolved','expired','cancelled','failed']);
const actions={invitation_response:['interaction.invitation.accept','interaction.invitation.decline'],feedback:['interaction.activity.submit_feedback','interaction.activity.leave'],acknowledgement:['interaction.activity.close','interaction.activity.leave']};
const json=(value:unknown):JsonObject=>JSON.parse(JSON.stringify(value)) as JsonObject;
function proposalObject(value:unknown):JsonObject{
 if(value===null||typeof value!=='object'||Array.isArray(value))fail('invalid_request',400,'Expected a business input object');
 const record=value as JsonObject;
 if(Object.keys(record).length>20||Object.keys(record).some(key=>key.length>100))fail('invalid_request',400,'Business proposal has too many fields');
 try{hashRuntimeRequest(record);}catch{fail('invalid_request',400,'Expected finite JSON business input');}
 if(Buffer.byteLength(JSON.stringify(record))>16384)fail('invalid_request',400,'Business proposal is too large');
 return record;
}
function intentOf(row:DecisionIntent):DecisionIntent{return {deduplicationKey:row.deduplicationKey,agentId:row.agentId,stage:row.stage,target:row.target,worldId:row.worldId,templateVersion:row.templateVersion,configVersion:row.configVersion,deadline:row.deadline,allowedActions:row.allowedActions,contextRefs:row.contextRefs};}
const classify=(id:string)=>(error:unknown)=>error instanceof M1Error&&error.statusCode<500?{outcome:error.statusCode===409?'conflict' as const:error.statusCode===410?'expired' as const:'rejected' as const,result:{decisionId:id,error:{code:error.code,message:error.message}}}:undefined;
export function createDecisionService(options:{identity:IdentityAccess<RuntimeReadContext>;target:DecisionTarget;policy?:DecisionDispatchPolicy}){
 const policy=Object.freeze({...INITIAL_DISPATCH_POLICY,...options.policy});
 const cursors=createDecisionCursor(),executing=new WeakMap<RuntimeTransaction,Set<string>>();
 if(Object.values(policy).some(value=>!Number.isSafeInteger(value)||value<1)||policy.maxListSize>100||policy.agentDailyLimit>10000||policy.platformDailyLimit>100000)throw new Error('Invalid Decision dispatch policy');
 function requireAgent(principal:Principal):asserts principal is Extract<Principal,{kind:'agent'}>{if(principal.kind!=='agent')fail('insufficient_scope',403,'Only the independent Agent may handle its decisions');}
 async function owned(ctx:RuntimeReadContext,p:Principal,id:string){
  requireAgent(p);await options.identity.authorizeAgent(ctx,p,p.agentId);
  const row=await ctx.repository(decisionRepository).get(id);
  if(!row||row.agentId!==p.agentId||row.recoveryEpoch!==ctx.recoveryEpoch)fail('target_not_accessible',404,'Target is not accessible');
  return row;
 }
 async function eligibility(ctx:RuntimeReadContext,p:Principal,row:DecisionRequest){
  const state=await options.identity.readParticipation(ctx,row.agentId);
  return hashRuntimeRequest({actionPolicy:state.actionPolicy,credential:p.authorizationVersion,runtimeVersion:state.runtimeVersion,runtimeActive:state.runtimeActive,membershipState:state.membership.state,ownerPauseVersion:state.membership.ownerPauseVersion,platformVersion:state.membership.platformVersion,sharingGeneration:state.membership.sharingGeneration,templateVersion:row.templateVersion,configVersion:row.configVersion,dispatchPolicyVersion:policy.version});
 }
 async function validateCommit(ctx:RuntimeTransaction,p:Principal,row:DecisionRequest,action:'decision.claim'|'decision.respond'){
  assertWorldActionAllowed((await options.identity.readParticipation(ctx,row.agentId)).actionPolicy,action);
  const stamp=await eligibility(ctx,p,row);ctx.validateBeforeCommit(async current=>{assertWorldActionAllowed((await options.identity.readParticipation(current,row.agentId)).actionPolicy,action);if(row.deadline<=current.now())fail('decision_expired',410,'Decision request expired before commit');if(stamp!==await eligibility(current,p,row))fail('decision_scope_changed',409,'Decision authorization changed before commit');});
 }
 async function inspection(ctx:RuntimeReadContext,p:Principal,row:DecisionRequest){const current=await options.target.inspect(ctx,p,row);if(!current)fail('target_not_accessible',404,'Target is not accessible');return current;}
 function active(ctx:RuntimeReadContext,row:DecisionRequest,current:{intent:DecisionIntent;actionable:boolean}){
  if(row.deadline<=ctx.now())fail('decision_expired',410,'Decision request expired');
  if(terminal.has(row.status))fail('decision_closed',409,'Decision request is closed');
  if(!current.actionable||current.intent.target.version!==row.target.version||current.intent.configVersion!==row.configVersion||current.intent.templateVersion!==row.templateVersion)fail('decision_scope_changed',409,'The current business stage or authorization changed');
 }
 function expected(row:DecisionRequest,value:unknown){if(version(value)!==row.version)fail('version_conflict',409,'Decision version changed');}
 async function event(ctx:RuntimeTransaction,row:DecisionRequest,kind:string,origin:DecisionOrigin,extra:JsonObject={}){
  const fact=await ctx.events.append({eventId:randomUUID(),domain:'decision',kind,schemaVersion:1,subject:{type:'decision.request',id:row.id,version:row.version},worldId:row.worldId,actor:origin.actor,source:origin.source,occurredAt:ctx.now(),causationId:origin.commandId,correlationId:origin.correlationId,audience:{kind:'agents',agentIds:[row.agentId]},payload:{decisionId:row.id,stage:row.stage,status:row.status,...extra}});
  const generation=await ctx.tasks.currentGeneration('decision');if(generation<1)fail('decision_unavailable',503,'Decision lifecycle is not initialized');
  await ctx.outbox.enqueue({outboxId:randomUUID(),eventId:fact.eventId,consumerId:'decision.changed',dedupeKey:`decision.changed:${fact.eventId}`,generation,dueAt:ctx.now(),maxAttempts:3});
  return fact.eventId;
 }
 function validateIntent(intent:DecisionIntent,at:number){
  text(intent.agentId,'agentId',1,100);text(intent.deduplicationKey,'deduplicationKey',1,200);text(intent.target.id,'target.id',1,100);text(intent.worldId,'worldId',1,100);
  if(!Object.hasOwn(actions,intent.stage)||!['invitation','activity'].includes(intent.target.kind)||!Number.isSafeInteger(intent.deadline)||intent.deadline<=at||[intent.target.version,intent.templateVersion,intent.configVersion].some(n=>!Number.isSafeInteger(n)||n<1)||!Array.isArray(intent.allowedActions)||!intent.allowedActions.length||intent.allowedActions.length>4||new Set(intent.allowedActions).size!==intent.allowedActions.length||intent.allowedActions.some(action=>!actions[intent.stage].includes(action)))fail('invalid_request',400,'Invalid decision intent');
  if(!Array.isArray(intent.contextRefs)||intent.contextRefs.length>10||intent.contextRefs.some(ref=>!['invitation','artifact','activity'].includes(ref.kind)||typeof ref.id!=='string'||ref.id.length<1||ref.id.length>100||!Number.isSafeInteger(ref.version)||ref.version<1))fail('invalid_request',400,'Invalid decision references');
 }
 const sink:DecisionIntentSink={
  async ensure(ctx,intent,origin){
   validateIntent(intent,ctx.now());const repo=ctx.repository(decisionRepository),prior=await repo.findByReason(intent.agentId,intent.deduplicationKey);
   if(prior){if(hashRuntimeRequest(json(intentOf(intent)))!==hashRuntimeRequest(json(intentOf(prior))))fail('decision_reason_conflict',409,'A decision reason already has a different target');return {decisionId:prior.id,version:prior.version};}
   const generation=await ctx.tasks.currentGeneration('decision');if(generation<1)fail('decision_unavailable',503,'Decision lifecycle is not initialized');
   const row:DecisionRequest={...structuredClone(intent),id:randomUUID(),version:1,recoveryEpoch:ctx.recoveryEpoch,createdAt:ctx.now(),status:'pending',claim:null,response:null,resolution:null,invalidation:null};
   await repo.save(row,null);await event(ctx,row,'decision.created',origin);
   await ctx.tasks.schedule({taskId:randomUUID(),domain:'decision',kind:'decision.expire',handlerVersion:1,dedupeKey:`decision.expire:${row.id}`,target:{type:'decision.request',id:row.id,version:1},timeKind:'utc',dueAt:row.deadline,generation,maxAttempts:3,payloadVersion:1,payload:{decisionId:row.id,deadline:row.deadline}});
   return {decisionId:row.id,version:1};
  },
  async cancel(ctx,agentId,deduplicationKey,code,origin){
   const repo=ctx.repository(decisionRepository),row=await repo.findByReason(agentId,deduplicationKey);if(!row||terminal.has(row.status))return;
   if(code==='stage_advanced'&&executing.get(ctx)?.has(row.id))return;
   const next:DecisionRequest={...row,version:row.version+1,status:'cancelled',invalidation:{code,at:ctx.now()}};await repo.save(next,row.version);await event(ctx,next,'decision.cancelled',origin);
  },
 };
 async function project(ctx:RuntimeReadContext,p:Principal,row:DecisionRequest){
  const current=await inspection(ctx,p,row),authorizationChanged=row.claim!==null&&row.claim.authorizationVersion!==await eligibility(ctx,p,row);
  const status=!terminal.has(row.status)&&authorizationChanged?'cancelled':!terminal.has(row.status)&&row.deadline<=ctx.now()?'expired':row.status;
  const canReconcile=status==='responded'&&row.response?.executionOutcome==='unknown'&&current.actionable&&!authorizationChanged;
  return json({decisionId:row.id,version:row.version,stage:row.stage,status,deadline:row.deadline,createdAt:row.createdAt,target:current.intent.target,worldId:current.intent.worldId,templateVersion:current.intent.templateVersion,configVersion:current.intent.configVersion,contextRefs:current.intent.contextRefs,allowedActions:current.actionable&&['pending','claimed'].includes(status)?current.intent.allowedActions:[],actionable:current.actionable&&['pending','claimed'].includes(status),claimId:!authorizationChanged?row.claim?.id??null:null,response:row.response,resolution:row.resolution,invalidation:authorizationChanged?{code:'authorization_changed',at:ctx.now()}:row.invalidation,canReconcile,budget:{platformDispatch:'bounded_reservation',hostCost:'unknown',ownerBudgetRequired:false,reservation:row.claim?'retained':'not_reserved'},nextAction:canReconcile?'query_original_execution':status==='pending'?'claim':status==='claimed'?'respond':'none'});
 }
 async function authorizeCommand(ctx:RuntimeTransaction,p:Principal,id:string){const row=await owned(ctx,p,id);await inspection(ctx,p,row);}
 function key(ctx:RuntimeTransaction,p:Principal,action:string,commandId:string):CommandKey{requireAgent(p);return {domain:'decision',action,commandId,principal:{kind:'agent',id:p.agentId},recoveryEpoch:ctx.recoveryEpoch};}
 function origin(p:Principal,commandId:string):DecisionOrigin{requireAgent(p);return {actor:{kind:'agent',id:p.agentId},source:'external_agent',commandId,correlationId:commandId};}
 return {
  sink,policy,
  async query(ctx:RuntimeReadContext,p:Principal,raw:unknown){
   requireAgent(p);await options.identity.authorizeAgent(ctx,p,p.agentId);const input=object(raw,['cursor','limit']);const limit=input.limit===undefined?20:input.limit;
   if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>policy.maxListSize)fail('invalid_request',400,'Invalid decision page limit');
   const pageLimit=limit as number,scope={instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,agentId:p.agentId,limit:pageLimit};
   let afterId=input.cursor===undefined?undefined:cursors.decode(text(input.cursor,'cursor',1,2048),scope,ctx.now()),complete=false,scanned=0;const records:JsonObject[]=[];
   while(records.length<pageLimit&&scanned<500&&!complete){
    const batchSize=Math.min(50,500-scanned),rows=await ctx.repository(decisionRepository).listForAgent(p.agentId,{...(afterId?{afterId}:{}),limit:batchSize});
    if(!rows.length){complete=true;break;}
    for(let index=0;index<rows.length;index++){const row=rows[index]!;afterId=row.id;scanned++;try{records.push(await project(ctx,p,row));}catch(error){if(!(error instanceof M1Error)||error.code!=='target_not_accessible')throw error;}if(records.length===pageLimit){complete=index===rows.length-1&&rows.length<batchSize;break;}}
    if(records.length<pageLimit&&rows.length<batchSize)complete=true;
   }
   return {records,complete,nextCursor:!complete&&afterId?cursors.encode(afterId,scope,ctx.now()):null,observedAt:ctx.now(),scope:{agentId:p.agentId},coverage:'current_state_only'} as JsonObject;
  },
  async detail(ctx:RuntimeReadContext,p:Principal,id:string){return await project(ctx,p,await owned(ctx,p,text(id,'decisionId',1,100)));},
  async authorizeReceipt(ctx:RuntimeReadContext,p:Principal,receipt:CommandReceipt){
   requireAgent(p);if(receipt.key.domain!=='decision'||!['decision.claim','decision.respond'].includes(receipt.key.action)||receipt.key.principal.kind!=='agent'||receipt.key.principal.id!==p.agentId||typeof receipt.result.decisionId!=='string')fail('target_not_accessible',404,'Receipt is not accessible');
   await inspection(ctx,p,await owned(ctx,p,receipt.result.decisionId));
  },
  async claim(ctx:RuntimeTransaction,p:Principal,commandId:string,raw:unknown):Promise<CommandReceipt>{
   const input=object(raw,['decisionId','expectedVersion']),id=text(input.decisionId,'decisionId',1,100);version(input.expectedVersion);text(commandId,'commandId',8,100);
   return await commitRuntimeCommandIn(ctx,{key:key(ctx,p,'decision.claim',commandId),requestHash:hashRuntimeRequest(json(input)),authorize:tx=>authorizeCommand(tx,p,id),classifyRejection:classify(id),handle:async tx=>{
    const repo=tx.repository(decisionRepository),row=await owned(tx,p,id),current=await inspection(tx,p,row);assertWorldActionAllowed((await options.identity.readParticipation(tx,row.agentId)).actionPolicy,'decision.claim');expected(row,input.expectedVersion);active(tx,row,current);await validateCommit(tx,p,row,'decision.claim');
    if(row.status==='claimed'){
     if(row.claim!.authorizationVersion!==await eligibility(tx,p,row))fail('decision_scope_changed',409,'The original claim authorization changed');
     return {result:{decisionId:row.id,version:row.version,status:row.status,claimId:row.claim!.id,deadline:row.deadline,alreadyClaimed:true,nextAction:'recover_original_claim_or_execution'},eventIds:[]};
    }
    if(row.status!=='pending')fail('decision_closed',409,'Decision request has already been handled');
    const reservationId=randomUUID(),reserved=await repo.reserveDispatch({id:reservationId,decisionId:row.id,agentId:row.agentId,periodStart:Math.floor(tx.now()/86400000)*86400000,reservedAt:tx.now(),agentLimit:policy.agentDailyLimit,platformLimit:policy.platformDailyLimit});
    if(!reserved)fail('decision_budget_exhausted',429,'Platform dispatch allowance is exhausted');
    const next:DecisionRequest={...row,version:row.version+1,status:'claimed',claim:{id:randomUUID(),commandId,authorizationVersion:await eligibility(tx,p,row),claimedAt:tx.now(),reservationId}};
    await repo.save(next,row.version);const eventId=await event(tx,next,'decision.claimed',origin(p,commandId));
    return {result:{decisionId:next.id,version:next.version,status:next.status,claimId:next.claim!.id,deadline:next.deadline,budgetReservation:'retained',hostCost:'unknown'},eventIds:[eventId]};
   }});
  },
  async respond(ctx:RuntimeTransaction,p:Principal,commandId:string,raw:unknown):Promise<CommandReceipt>{
   const input=object(raw,['decisionId','expectedVersion','claimId','action','input','executionId','executionOutcome']),id=text(input.decisionId,'decisionId',1,100),claimId=text(input.claimId,'claimId',1,100);version(input.expectedVersion);text(commandId,'commandId',8,100);
   const executionOutcome=input.executionOutcome??'not_reported';if(!['completed','unknown','not_reported'].includes(executionOutcome as string))fail('invalid_request',400,'Invalid execution outcome');
   const executionId=input.executionId===undefined?null:text(input.executionId,'executionId',1,100),action=input.action===undefined?null:text(input.action,'action',1,100),proposal=input.input===undefined?{}:proposalObject(input.input);
   if(executionOutcome==='unknown'&&(!executionId||action!==null||Object.keys(proposal).length))fail('invalid_request',400,'Unknown execution needs its original execution ID and no proposal');
   if(executionOutcome!=='unknown'&&action===null)fail('invalid_request',400,'An explicit action or no_action is required');
   if(action==='no_action'&&Object.keys(proposal).length)fail('invalid_request',400,'No action must not contain a business proposal');
   if(['expectedVersion','agentId','ownerId','source','invitationId','activityId','commandId'].some(field=>Object.hasOwn(proposal,field)))fail('invalid_request',400,'Business identity and target fields are server supplied');
   return await commitRuntimeCommandIn(ctx,{key:key(ctx,p,'decision.respond',commandId),requestHash:hashRuntimeRequest(json(input)),authorize:tx=>authorizeCommand(tx,p,id),classifyRejection:classify(id),handle:async tx=>{
    const repo=tx.repository(decisionRepository),row=await owned(tx,p,id),current=await inspection(tx,p,row);assertWorldActionAllowed((await options.identity.readParticipation(tx,row.agentId)).actionPolicy,'decision.respond');expected(row,input.expectedVersion);active(tx,row,current);await validateCommit(tx,p,row,'decision.respond');
    if(!row.claim||row.claim.id!==claimId||row.claim.authorizationVersion!==await eligibility(tx,p,row))fail('decision_scope_changed',409,'The current claim is required');
    if(row.status!=='claimed'&&!(row.status==='responded'&&row.response?.executionOutcome==='unknown'))fail('decision_closed',409,'Decision request is not accepting a response');
    if(row.response?.executionOutcome==='unknown'&&(executionId!==row.response.executionId||executionOutcome==='not_reported'))fail('execution_reconciliation_required',409,'Reconcile the original execution ID');
    if(action!==null&&action!=='no_action'&&(!row.allowedActions.includes(action)||!current.intent.allowedActions.includes(action)))fail('invalid_request',400,'Action is not allowed for this decision stage');
    const responded:DecisionRequest={...row,version:row.version+1,status:'responded',response:{commandId,action,inputHash:hashRuntimeRequest(json(proposal)),respondedAt:tx.now(),executionId,executionOutcome:executionOutcome as 'completed'|'unknown'|'not_reported'}};
    await repo.save(responded,row.version);const events=[await event(tx,responded,'decision.responded',origin(p,commandId))];
    if(executionOutcome==='unknown')return {result:{decisionId:id,version:responded.version,status:'responded',executionId,executionOutcome:'unknown',budgetReservation:'retained',nextAction:'query_original_execution'},eventIds:events};
    let resolution:NonNullable<DecisionRequest['resolution']>;
    if(action==='no_action')resolution={targetCommandId:null,domain:'decision',action:'no_action',outcome:'no_action',result:{businessStateChanged:false},eventIds:[],resolvedAt:tx.now()};
    else{
     const targetCommandId=`dc_${hashRuntimeRequest({decisionId:id,responseCommandId:commandId})}`,targetInput={...json(proposal),[row.target.kind==='invitation'?'invitationId':'activityId']:row.target.id,expectedVersion:row.target.version};
     let receipt:CommandReceipt;const active=executing.get(tx)??new Set<string>();executing.set(tx,active);active.add(id);
     try{receipt=await options.target.execute(tx,p,{domain:'interaction',action:action!,commandId:targetCommandId,principal:{kind:'agent',id:row.agentId},recoveryEpoch:tx.recoveryEpoch},action!,targetInput);}finally{active.delete(id);if(!active.size)executing.delete(tx);}
     resolution={targetCommandId,domain:receipt.key.domain,action:receipt.key.action,outcome:receipt.outcome,result:receipt.result,eventIds:receipt.eventIds,resolvedAt:tx.now()};
    }
    const resolved:DecisionRequest={...responded,version:responded.version+1,status:'resolved',resolution};await repo.save(resolved,responded.version);events.push(await event(tx,resolved,'decision.resolved',origin(p,commandId),{businessOutcome:resolution.outcome}));
    return {result:{decisionId:id,version:resolved.version,status:'resolved',resolution:json(resolution),businessSucceeded:resolution.outcome==='committed'},eventIds:[...events,...resolution.eventIds]};
   }});
  },
  async expire(ctx:RuntimeTransaction,decisionId:string){
   const repo=ctx.repository(decisionRepository),row=await repo.get(decisionId);if(!row||terminal.has(row.status)||row.deadline>ctx.now())return;
   const next:DecisionRequest={...row,version:row.version+1,status:'expired',invalidation:{code:'deadline',at:ctx.now()}};await repo.save(next,row.version);await event(ctx,next,'decision.expired',{actor:{kind:'system',id:'decision-expiry'},source:'system',commandId:`decision-expire:${row.id}`,correlationId:row.id});
  },
 };
}
export type DecisionService=ReturnType<typeof createDecisionService>;
