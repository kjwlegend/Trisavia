/**
 * One synthetic, real-clock M3-A HTTP run. Does not create databases, prepare data or start a server.
 * Wait for TD's reviewed candidate and explicit isolated-resource authorization before --execute.
 * node scripts/m3-a-http-acceptance.ts --self-check       # offline; no requests or files
 * node scripts/m3-a-http-acceptance.ts --execute --base-url http://127.0.0.1:18958 \
 *   --expected-source-sha <40hex> --expected-instance <instance> --expected-epoch <epoch> --run-id <stable-id>
 * Reuse exactly these arguments after interruption. Private credentials/original command inputs remain
 * in outputs/m3-a-http/<run-id>/private-state.json (0600); evidence.json excludes credentials.
 * Missed timed checkpoints fail this run; recovery never creates a replacement plan or identity.
 * A failed run retains immutable failure snapshots and can recover original facts, but never becomes passed.
 * The initial plan response is deliberately discarded, then recovered from the original receipt.
 * This is client-response-loss simulation, not a claim of server unknown_commit fault injection.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

type ObjectValue=Record<string,any>;
type Target={baseUrl:string;sourceCommit:string;instanceId:string;recoveryEpoch:string;runId:string};
type Command={operation:string;commandId:string;input:ObjectValue};
type PrivateState={version:1;target:Target;consumerId:string;startedAt:number;registration:ObjectValue;runtimeToken:string;agentId?:string;publicId?:string;avatar?:Command;plan?:Command;receipt?:ObjectValue;work?:ObjectValue;rest?:ObjectValue};
const root=fileURLToPath(new URL('../',import.meta.url));
const requiredOperations=['world.rules','world.avatar','world.avatar.create','world.map_manifest','life.actions','life.options','life.state','life.plans.submit','life.plans.get','life.activities.get','behavior.public_recent'];
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function requireValue(condition:unknown,code:string):asserts condition{if(!condition)throw new Error(code);}
function targetFrom(args:string[]):Target{
 const allowed=new Set(['--base-url','--expected-source-sha','--expected-instance','--expected-epoch','--run-id']),values=new Map<string,string>();
 requireValue(args[0]==='--execute','execute_flag_required');
 for(let i=1;i<args.length;i+=2){const key=args[i]!,value=args[i+1];requireValue(allowed.has(key)&&!values.has(key)&&typeof value==='string'&&!value.startsWith('--'),'invalid_arguments');values.set(key,value);}
 requireValue(values.size===5,'all_target_arguments_required');
 const base=values.get('--base-url')!;
 requireValue(base==='http://127.0.0.1:18958'||base==='http://127.0.0.1:18958/','only_reserved_isolated_loopback_target_allowed');
 const sourceCommit=values.get('--expected-source-sha')!,instanceId=values.get('--expected-instance')!,recoveryEpoch=values.get('--expected-epoch')!,runId=values.get('--run-id')!;
 requireValue(/^[a-f0-9]{40}$/.test(sourceCommit),'full_source_sha_required');
 requireValue(/^[A-Za-z0-9_-]{8,100}$/.test(instanceId)&&/^[A-Za-z0-9_-]{8,100}$/.test(recoveryEpoch),'explicit_paired_identity_required');
 requireValue(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(runId),'stable_run_id_required');
 return {baseUrl:base.replace(/\/$/,''),sourceCommit,instanceId,recoveryEpoch,runId};
}
function planInput(now:number){return {expectedCatalogRevision:1,deadlineAt:now+1_800_000,maxSpendByCurrency:{star_coin:0},maxConsumeByItem:{},steps:[
 {stepId:'go-work',type:'move.to',placeId:'harbor_work'},
 {stepId:'work',type:'act',actionId:'work.shift',placeId:'harbor_work',jobId:'harbor_shift'},
 {stepId:'go-rest',type:'move.to',placeId:'garden_bench'},
 {stepId:'rest',type:'act',actionId:'rest.bench',placeId:'garden_bench'},
]};}
function receiptBody(state:PrivateState,c:Command){return {protocolVersion:1,consumerId:state.consumerId,purpose:'agent-manual',operation:c.operation,commandId:c.commandId};}
function commandBody(state:PrivateState,c:Command){return {...receiptBody(state,c),input:c.input};}
function validatedWork(checkpoint:ObjectValue){
 requireValue(checkpoint.workStartQuota?.starts===1,'work_start_quota_not_one');
 requireValue(checkpoint.activity?.actionId==='work.shift'&&checkpoint.activity.state==='active'&&checkpoint.activity.scheduledEndAt-checkpoint.activity.startedAt===600_000,'work_duration_not_600s');return checkpoint;
}
function validatedRest(checkpoint:ObjectValue,places:ObjectValue[]){
 requireValue(checkpoint.activity?.actionId==='rest.bench'&&checkpoint.activity.state==='active'&&checkpoint.activity.scheduledEndAt-checkpoint.activity.startedAt===300_000&&checkpoint.life?.energy?.current===76,'work_result_or_rest_duration_invalid');
 const position=checkpoint.avatar?.avatar?.position,place=places.find(p=>p.placeId==='garden_bench');
 requireValue(position&&place&&place.stations.some((s:ObjectValue)=>s.actionIds.includes('rest.bench')&&s.cells.some((p:ObjectValue)=>p.x===position.x&&p.y===position.y)),'rest_not_at_actual_map3_station');return checkpoint;
}
function recordFailure(evidence:ObjectValue,code:string,at:number){const failure={code,at};evidence.status='failed';evidence.failure??=failure;evidence.failures??=[];evidence.failures.push(failure);evidence.finishedAt=at;return failure;}
function recordCompletion(evidence:ObjectValue,at:number){
 if(evidence.status==='failed'||evidence.failure||evidence.failures?.length){evidence.status='failed';evidence.recovery={conditionsPassed:true,finishedAt:at,originalFailureRetained:true};return false;}
 evidence.status='passed';evidence.finishedAt=at;return true;
}
async function jsonFile(path:string,value:unknown){const tmp=path+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,path);}
async function existingJson(path:string){try{const s=await lstat(path);requireValue(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&s.size<=1_000_000,'private_evidence_file_mode_invalid');return JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}}
class HttpFailure extends Error{readonly status:number;readonly code:string;constructor(status:number,code:string){super('http_'+status+'_'+code);this.status=status;this.code=code;}}

async function run(target:Target){
 requireValue(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()===target.sourceCommit,'checkout_not_expected_candidate');
 execFileSync('git',['diff','--quiet','HEAD'],{cwd:root,stdio:'ignore'});
 const directory=join(root,'outputs/m3-a-http',target.runId);await mkdir(directory,{recursive:true,mode:0o700});
 const privateFile=join(directory,'private-state.json'),evidenceFile=join(directory,'evidence.json');
 let state:PrivateState=await existingJson(privateFile);
 if(!state){const runtimeToken=randomUUID()+'.'+randomBytes(32).toString('base64url'),continuationToken=randomUUID()+'.'+randomBytes(32).toString('base64url');state={version:1,target,consumerId:'m3-http-'+randomUUID(),startedAt:Date.now(),registration:{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken},runtimeToken};await jsonFile(privateFile,state);}
 assert.deepEqual(state.target,target,'resume_target_must_match');
 const evidence:ObjectValue=await existingJson(evidenceFile)??{version:1,target,mode:'isolated-synthetic-http-real-clock',startedAt:state.startedAt,status:'running',requests:[],observations:{},boundaries:{clockInjection:false,serverFaultInjection:false,clientResponseLossSimulation:true,ownerBinding:false,welcomeClaim:false,databaseWritesByScript:false,ordinaryUiAcceptance:false}};
 if(evidence.status==='failed'){const original='failure-before-recovery-'+randomUUID()+'.json';await writeFile(join(directory,original),JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});evidence.failureSnapshots??=[];evidence.failureSnapshots.push(original);}
 const save=async()=>{await jsonFile(privateFile,state);await jsonFile(evidenceFile,evidence);};
 let lastRequestAt=0;
 function safePath(path:string){requireValue(path.startsWith('/v1/')||path==='/health','unexpected_http_path');const url=new URL(path,target.baseUrl);requireValue(url.origin===target.baseUrl&&!url.username&&!url.password&&!url.hash,'cross_origin_http_path');return url;}
 async function http(method:string,path:string,body?:ObjectValue,token?:string):Promise<ObjectValue>{
  const startedAt=Date.now();lastRequestAt=startedAt;let status=0;
  try{const response=await fetch(safePath(path),{method,redirect:'error',signal:AbortSignal.timeout(15_000),headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});status=response.status;
   const raw=await response.text();requireValue(raw.length<2_000_000,'http_document_too_large');const data=JSON.parse(raw);
   evidence.requests.push({method,path,operation:body?.operation??null,status,startedAt,endedAt:Date.now()});
   if(!response.ok)throw new HttpFailure(status,typeof data.error?.code==='string'&&/^[a-z0-9_]+$/.test(data.error.code)?data.error.code:'request_failed');
   if(data.instanceId!==undefined)requireValue(data.instanceId===target.instanceId,'http_instance_mismatch');return data;
  }catch(error){if(!status)evidence.requests.push({method,path,operation:body?.operation??null,status:0,startedAt,endedAt:Date.now()});if(error instanceof HttpFailure)throw error;throw new HttpFailure(status,'transport_or_document_failure');}finally{lastRequestAt=Date.now();}
 }
 const get=(path:string,token?:string)=>http('GET',path,undefined,token);
 const post=(path:string,body:ObjectValue,token=state.runtimeToken)=>http('POST',path,body,token);
 const unbox=(body:ObjectValue)=>{requireValue(body.protocolVersion===1&&body.instanceId===target.instanceId&&body.data&&typeof body.data==='object','gateway_envelope_invalid');return body.data as ObjectValue;};
 const progress=(phase:string)=>{console.info(JSON.stringify({runId:target.runId,phase,at:new Date().toISOString()}));};
 async function waitUntil(until:number,phase:string){requireValue(Number.isSafeInteger(until)&&until<=state.startedAt+2_100_000,'wait_out_of_run_bounds');progress(phase);while(Date.now()<until){await save();await delay(Math.min(30_000,until-Date.now()));}}
 try{
  const health=await get('/health');requireValue(health.status==='ok'&&health.appVersion==='0.3.0'&&health.instanceId===target.instanceId,'reviewed_m3_service_not_ready');evidence.observations.health=health;
  const capabilities=await get('/v1/capabilities');requireValue(capabilities.instanceId===target.instanceId&&capabilities.defaultPublicRole===true,'registration_capability_missing');
  const gateway=capabilities.gateway;requireValue(gateway?.discovery?.path&&gateway.command?.path&&gateway.receipt?.path&&gateway.query?.path,'gateway_capabilities_missing');
  const discovery=unbox(await get(gateway.discovery.path)),operations=new Map<string,ObjectValue>(discovery.operations.map((op:ObjectValue)=>[op.id,op]));
  for(const id of requiredOperations)requireValue(operations.has(id),'required_operation_missing_'+id);
  const documents=new Map<string,ObjectValue>();
  for(const id of requiredOperations){const op=operations.get(id)!;for(const reference of [op.inputSchema,op.outputSchema,op.usageGuide]){const path=reference.path;if(documents.has(path))continue;const d=unbox(await get(path));requireValue(d.digestAlgorithm==='sha256-utf8-hex'&&sha(d.canonicalDocument)===d.digest&&canonical(d.document)===d.canonicalDocument,'discovered_document_digest_invalid');documents.set(path,{version:d.version,digest:d.digest});}}
  evidence.observations.discovery={catalogRevision:discovery.catalogRevision,documents:[...documents].map(([path,v])=>({path,...v}))};
  const query=async(operation:string,input:ObjectValue={})=>unbox(await post(operations.get(operation)!.http.path,{protocolVersion:1,consumerId:state.consumerId,purpose:'agent-manual',operation,input}));
  async function recover(c:Command){for(let i=0;i<3;i++){try{return unbox(await post(gateway.receipt.path,receiptBody(state,c)));}catch(e){if(!(e instanceof HttpFailure)||e.status!==404)throw e;if(i<2)await delay(1000);}}return undefined;}
  function checkReceipt(receipt:ObjectValue,c:Command){requireValue(receipt.key?.commandId===c.commandId&&receipt.key?.action===c.operation&&receipt.key?.principal?.id===state.agentId&&receipt.key?.recoveryEpoch===target.recoveryEpoch&&receipt.outcome==='committed','command_receipt_invalid');return receipt;}
  async function command(c:Command,discardResponse=false){
   let response:ObjectValue|undefined;
   try{response=unbox(await post(operations.get(c.operation)!.http.path,commandBody(state,c)));}catch(e){if(!(e instanceof HttpFailure)||!['unknown_commit','unavailable','busy','transport_or_document_failure'].includes(e.code))throw e;}
   if(response&&!discardResponse)return checkReceipt(response,c);
   evidence.observations.receiptRecovery={operation:c.operation,commandId:c.commandId,mode:discardResponse?'client_deliberately_discarded_response':'unknown_response',at:Date.now()};
   const receipt=await recover(c);requireValue(receipt,'original_receipt_unresolved_do_not_create_new_command');return checkReceipt(receipt,c);
  }
  if(!state.agentId){let registration:ObjectValue;try{registration=await http('POST','/v1/registrations',state.registration);}catch(e){if(!(e instanceof HttpFailure)||e.status<500&&e.status!==0)throw e;registration=await get('/v1/registration-attempts/'+state.registration.attemptId,state.runtimeToken);}
   requireValue(typeof registration.agentId==='string'&&/^A\d{3,}$/.test(registration.publicId),'synthetic_registration_invalid');state.agentId=registration.agentId;state.publicId=registration.publicId;await save();}
  evidence.syntheticAgent={agentId:state.agentId,publicId:state.publicId};
  const walletPath=capabilities.walletApi?.query?.path;requireValue(walletPath==='/v1/wallet/query','wallet_capability_missing');
  const wallet=async()=>unbox(await post(walletPath,{protocolVersion:1,consumerId:state.consumerId,purpose:'agent-inspect'}));
  const rules=await query('world.rules',{worldId:'default'}),map=await query('world.map_manifest',{worldId:'default'}),actions=await query('life.actions');
  requireValue(rules.rules?.version===3&&rules.rules?.topologyVersion===3&&map.manifest?.version===3&&actions.map?.rulesetVersion===3&&actions.map?.topologyVersion===3&&actions.map?.geometryDigest===map.manifest?.geometryDigest,'life_map3_not_active');
  requireValue(actions.actions.some((a:ObjectValue)=>a.actionId==='work.shift'&&a.jobId==='harbor_shift'&&a.durationSeconds===600&&a.reward.star_coin===36)&&actions.actions.some((a:ObjectValue)=>a.actionId==='rest.bench'&&a.durationSeconds===300&&a.costs.star_coin===0),'approved_life_actions_not_discovered');
  const quota=()=>query('life.options',{actionId:'work.shift',jobId:'harbor_shift',placeId:'harbor_work'});
  // Revalidate persisted acceptance proofs before using checkpoints to skip a timed phase.
  if(state.work)validatedWork(state.work);if(state.rest)validatedRest(state.rest,actions.places);
  if(!state.plan){const initial={wallet:await wallet(),life:await query('life.state'),quota:await quota()};requireValue(initial.wallet.balance===0&&initial.life.energy.current===100&&initial.life.recentResults.length===0&&!initial.life.body.activity&&!initial.life.body.plan&&initial.quota.workQuota.starts===0,'not_a_fresh_zero_coin_synthetic_agent');evidence.observations.initial=initial;
   state.avatar??={operation:'world.avatar.create',commandId:randomUUID(),input:{worldId:'default',expectedRulesetVersion:rules.rules.version}};await save();await command(state.avatar);
   state.plan={operation:'life.plans.submit',commandId:randomUUID(),input:planInput(Date.now())};await save();}
  if(!state.receipt){const prior=await recover(state.plan);state.receipt=prior?checkReceipt(prior,state.plan):await command(state.plan,true);await save();}
  const planId=state.receipt.result?.plan?.planId;requireValue(typeof planId==='string','persisted_plan_id_missing');evidence.planId=planId;
  async function phaseActivity(actionId:string){for(let i=0;i<18;i++){const life=await query('life.state');if(life.body.activity?.actionId===actionId&&life.body.activity.state==='active')return {activity:life.body.activity,life,observedAt:Date.now()};
    const plan=await query('life.plans.get',{planId});requireValue(['queued','running','waiting_condition'].includes(plan.plan?.state),'plan_finished_before_expected_phase_'+actionId);await delay(10_000);}throw new Error('phase_not_reached_'+actionId);}
  if(!state.work){const candidate=await phaseActivity('work.shift'),q=await quota();const checkpoint=validatedWork({...candidate,workStartQuota:q.workQuota});state.work=checkpoint;evidence.observations.workStartQuota=checkpoint.workStartQuota;evidence.observations.work=checkpoint;await save();}
  if(!state.rest){const quietFrom=lastRequestAt;await waitUntil(state.work.activity.scheduledEndAt+2000,'work_no_external_http_wait');evidence.observations.workQuietWindow={from:quietFrom,to:Date.now(),durationMs:Date.now()-quietFrom};const candidate=await phaseActivity('rest.bench'),avatar=await query('world.avatar',{worldId:'default'});
   const checkpoint=validatedRest({...candidate,avatar},actions.places);state.rest=checkpoint;evidence.observations.rest=checkpoint;await save();}
  const quietFrom=lastRequestAt;await waitUntil(state.rest.activity.scheduledEndAt+3000,'rest_no_external_http_wait');evidence.observations.restQuietWindow={from:quietFrom,to:Date.now(),durationMs:Date.now()-quietFrom};
  let finalPlan:ObjectValue|undefined;for(let i=0;i<5;i++){const p=await query('life.plans.get',{planId});if(p.plan?.state==='completed'){finalPlan=p.plan;break;}requireValue(['running','waiting_condition'].includes(p.plan?.state),'plan_terminal_failure');await delay(5000);}
  requireValue(finalPlan&&finalPlan.stepCount===4&&finalPlan.nextStep===4&&finalPlan.results.length===4,'four_step_plan_not_complete');
  const workStep=finalPlan.results.find((r:ObjectValue)=>r.stepId==='work'),restStep=finalPlan.results.find((r:ObjectValue)=>r.stepId==='rest');requireValue(workStep?.activityId===workStep?.resultId&&restStep?.activityId===restStep?.resultId,'activity_result_identity_invalid');
  requireValue(workStep.activityId===state.work.activity.activityId&&restStep.activityId===state.rest.activity.activityId,'observed_activity_identity_changed');
  const work=await query('life.activities.get',{activityId:workStep.activityId}),rest=await query('life.activities.get',{activityId:restStep.activityId}),finalWallet=await wallet(),finalLife=await query('life.state');
  requireValue(work.activity.state==='completed'&&work.activity.endedAt-work.activity.startedAt>=600_000&&work.activity.result.coinReward===36&&work.activity.result.energySpent===24,'real_work_result_invalid');
  requireValue(rest.activity.state==='completed'&&rest.activity.endedAt-rest.activity.startedAt>=300_000&&rest.activity.result.coinReward===0&&rest.activity.result.energyRestored===24,'real_rest_result_invalid');
  requireValue(finalWallet.balance===36&&finalLife.energy.current===100&&finalLife.energy.reserved===0&&!finalLife.body.activity&&!finalLife.body.plan,'final_wallet_or_energy_invalid');
  const logOperation=operations.get('behavior.public_recent')!,logs=async()=>unbox(await get(logOperation.http.path+'?agentId='+encodeURIComponent(state.agentId!)));
  let before:ObjectValue|undefined;for(let i=0;i<4;i++){before=await logs();if(before.items.filter((r:ObjectValue)=>r.source.domain==='life').length===2)break;await delay(2000);}
  const beforeIds=before!.items.filter((r:ObjectValue)=>r.source.domain==='life').map((r:ObjectValue)=>r.id).sort();requireValue(beforeIds.length===2&&new Set(beforeIds).size===2,'two_committed_life_logs_not_visible');
  const recovered=checkReceipt((await recover(state.plan))!,state.plan);assert.deepEqual(recovered,state.receipt,'original_receipt_changed');
  const replay=await command(state.plan);assert.deepEqual(replay,state.receipt,'completion_replay_changed_original_receipt');
  const afterWallet=await wallet(),afterPlan=await query('life.plans.get',{planId});await delay(2000);const afterLogs=await logs();
  assert.deepEqual(afterPlan.plan,finalPlan,'completion_replay_changed_plan');assert.equal(afterWallet.balance,36);assert.equal(afterWallet.accountVersion,finalWallet.accountVersion);assert.deepEqual(afterLogs.items.filter((r:ObjectValue)=>r.source.domain==='life').map((r:ObjectValue)=>r.id).sort(),beforeIds,'completion_replay_duplicated_logs');
  evidence.observations.final={plan:finalPlan,work:work.activity,rest:rest.activity,wallet:afterWallet,life:finalLife,avatar:await query('world.avatar',{worldId:'default'}),quota:await quota(),lifeLogIds:beforeIds};
  const finishedAt=Date.now(),passed=recordCompletion(evidence,finishedAt);evidence.elapsedMs=finishedAt-state.startedAt;await save();progress(passed?'passed':'original_results_recovered_prior_failure_retained');if(!passed)process.exitCode=1;
 }catch(error){const failure=recordFailure(evidence,error instanceof HttpFailure?error.code:error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:'acceptance_assertion_failed',Date.now());
  // Immutable per-failure evidence precedes the mutable current summary; it contains no private state.
  const failureFile='failure-'+failure.at+'-'+randomUUID()+'.json';await writeFile(join(directory,failureFile),JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});evidence.failureSnapshots??=[];evidence.failureSnapshots.push(failureFile);await save();console.error(JSON.stringify({runId:target.runId,status:'failed',code:failure.code}));process.exitCode=1;}
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--self-check'){
  const valid=['--execute','--base-url','http://127.0.0.1:18958','--expected-source-sha','a'.repeat(40),'--expected-instance','instance_synthetic','--expected-epoch','epoch_synthetic','--run-id','offline-check'];
  const target=targetFrom(valid);assert.equal(target.baseUrl,'http://127.0.0.1:18958');
  for(const url of ['http://127.0.0.1:18893','http://127.0.0.1:18993','https://trisavia.kjwlabs.com','http://127.0.0.1:18958/?host=other','http://user@127.0.0.1:18958','http://127.0.0.1:18958/#x'])assert.throws(()=>targetFrom(valid.map(v=>v==='http://127.0.0.1:18958'?url:v)));
  assert.equal(planInput(123).deadlineAt,1_800_123);assert.equal(planInput(0).steps.length,4);assert.deepEqual(planInput(0).maxSpendByCurrency,{star_coin:0});
  const state={consumerId:'synthetic-client'} as PrivateState,c:Command={operation:'life.plans.submit',commandId:'stable-command',input:planInput(0)};
  assert.equal('input'in receiptBody(state,c),false);assert.deepEqual(commandBody(state,c).input,c.input);
  assert.equal(canonical({b:1,a:[2]}),'{"a":[2],"b":1}');
  const work={activity:{actionId:'work.shift',state:'active',startedAt:0,scheduledEndAt:600_000},workStartQuota:{starts:1}},places=[{placeId:'garden_bench',stations:[{actionIds:['rest.bench'],cells:[{x:4,y:5}]}]}],rest={activity:{actionId:'rest.bench',state:'active',startedAt:600_000,scheduledEndAt:900_000},life:{energy:{current:76}},avatar:{avatar:{position:{x:99,y:99}}}};
  const persisted:ObjectValue={runtimeToken:'offline-synthetic-token',plan:c,receipt:{key:{commandId:c.commandId}}};
  assert.throws(()=>{persisted.work=validatedWork({...work,workStartQuota:{starts:0}});},/work_start_quota_not_one/);assert.equal(persisted.work,undefined);
  assert.throws(()=>{persisted.work=validatedWork({...work,activity:{...work.activity,scheduledEndAt:1}});},/work_duration_not_600s/);assert.equal(persisted.work,undefined);
  persisted.work=validatedWork(work);
  for(let retry=0;retry<2;retry++){const resumed=JSON.parse(JSON.stringify(persisted));validatedWork(resumed.work);assert.throws(()=>{resumed.rest=validatedRest(rest,places);},/rest_not_at_actual_map3_station/);assert.equal(resumed.rest,undefined);assert.equal(resumed.runtimeToken,persisted.runtimeToken);assert.deepEqual(resumed.plan,c);assert.deepEqual(resumed.receipt,persisted.receipt);}
  assert.throws(()=>validatedWork({activity:work.activity}),/work_start_quota_not_one/);assert.throws(()=>validatedRest({...rest,avatar:undefined},places),/rest_not_at_actual_map3_station/);
  const verified=validatedRest({...rest,avatar:{avatar:{position:{x:4,y:5}}}},places);assert.deepEqual(validatedRest(JSON.parse(JSON.stringify(verified)),places),verified);
  const failed:ObjectValue={};recordFailure(failed,'rest_not_at_actual_map3_station',10);const firstFailure=JSON.stringify(failed.failure),firstSnapshot=JSON.stringify(failed);recordFailure(failed,'work_start_quota_not_one',20);assert.equal(recordCompletion(failed,30),false);assert.equal(failed.status,'failed');assert.equal(JSON.stringify(failed.failure),firstFailure);assert.equal(failed.failures.length,2);assert.equal(JSON.parse(firstSnapshot).failure.code,'rest_not_at_actual_map3_station');assert.equal(failed.recovery.originalFailureRetained,true);
  assert.equal(recordCompletion({status:'failed'},30),false);assert.equal(recordCompletion({status:'running'},30),true);
  console.info(JSON.stringify({offlineChecks:'passed',networkRequests:0,filesWritten:0,realClockRun:'not_started'}));return;
 }
 if(args.length===1&&args[0]==='--help'){console.info('See the script header for --self-check, exact isolated --execute arguments and original-run recovery.');return;}
 await run(targetFrom(args));
}
await main().catch(()=>{console.error(JSON.stringify({status:'failed',code:'configuration_or_private_state_invalid'}));process.exitCode=1;});
