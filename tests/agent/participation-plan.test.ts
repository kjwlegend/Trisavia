import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planParticipation,participationAdoptionEvidence,runAgent,type ParticipationJobObservation} from '../../scripts/m1-agent.ts';
const target={origin:'https://participation.invalid',instanceId:'synthetic-instance',agentId:'synthetic-agent'},policy={agentId:target.agentId,mode:'manual',version:4,source:'current'};
const access=(mode='manual',version=4,interval:number|null=3600)=>({agentId:target.agentId,version:7,intervalSeconds:interval,scheduling:{version:1,mode,policyVersion:version,effectiveState:mode==='autonomous'&&interval!==null?'on':'off',reason:mode==='manual'?'manual':mode==='observe'?'legacy_observe':interval===null?'interval_stopped':'autonomous_interval',source:'server_intent',serverControlsJob:false}});
const job:ParticipationJobObservation={...target,logicalTaskId:'logical-world-task',physicalJobId:'physical-old',control:'pause_resume',state:'scheduled',intervalSeconds:3600,stopConfirmed:false};
const proof={logicalTaskId:job.logicalTaskId,physicalJobId:job.physicalJobId,outcome:'succeeded' as const,state:'stopped' as const,intervalSeconds:3600,intervalVersion:7,policyVersion:4,readback:true};
test('manual plans pause the same physical job and never acquire world permissions or report adoption',()=>{
 const plan=planParticipation(target,policy,access(),job);assert.equal(plan.recommendation,'pause-original-job');assert.equal(plan.hostExecution,'not_executed');assert.equal(plan.adoption,'not_reported');assert.equal(plan.worldActionPermission,'unchanged-current-business-guards');assert.equal((plan.intent as any).intervalSeconds,3600);
 assert.deepEqual(participationAdoptionEvidence(plan,proof),{expectedVersion:7,expectedPolicyVersion:4,jobState:'stopped',source:'host_readback',reportSent:false});
 for(const change of [{outcome:'unknown'},{outcome:'unsupported'},{readback:false},{policyVersion:3},{intervalVersion:6},{logicalTaskId:'another-task'},{physicalJobId:'another-job'}])assert.equal(participationAdoptionEvidence(plan,{...proof,...change} as typeof proof),null);
 const resume=planParticipation(target,{...policy,mode:'autonomous',version:5},access('autonomous',5),{...job,state:'paused',stopConfirmed:true});assert.equal(resume.recommendation,'resume-original-job');assert.equal(participationAdoptionEvidence(resume,{...proof,state:'scheduled',policyVersion:5,physicalJobId:'replacement'}),null);assert.equal(participationAdoptionEvidence(resume,{...proof,state:'scheduled',policyVersion:5})?.jobState,'scheduled');
});
test('delete/create controls preserve logical identity and require confirmed old stop; unsupported and unknown stay unexecuted',()=>{
 const deleting=planParticipation(target,policy,access(),{...job,control:'delete_create'});assert.equal(deleting.recommendation,'delete-original-job');
 const current={...policy,mode:'autonomous',version:5},stopped={...job,physicalJobId:null,control:'delete_create' as const,state:'absent' as const,stopConfirmed:true};
 const creating=planParticipation(target,current,access('autonomous',5),stopped);assert.equal(creating.recommendation,'create-unique-replacement');assert.equal(creating.logicalTaskId,job.logicalTaskId);assert.equal(participationAdoptionEvidence(creating,{...proof,state:'scheduled',physicalJobId:'new-physical',policyVersion:5})?.jobState,'scheduled');
 assert.equal(planParticipation(target,current,access('autonomous',5),{...stopped,stopConfirmed:false}).recommendation,'query-original-host-result');
 for(const control of ['pause_resume','delete_create'] as const){const unknown=planParticipation(target,current,access('autonomous',5),{...job,control,state:'unknown'});assert.equal(unknown.recommendation,'query-original-host-result');assert.equal(participationAdoptionEvidence(unknown,{...proof,state:'scheduled',policyVersion:5}),null);}
 assert.equal(planParticipation(target,current,access('autonomous',5),{...job,control:'unsupported'}).recommendation,'unsupported');
 // A delete/create-only host cannot update the old scheduled job in place.
 const faster=access('autonomous',5,300),deleteBeforeChange=planParticipation(target,current,faster,{...job,control:'delete_create'}),newReadback={...proof,state:'scheduled' as const,physicalJobId:'replacement-300',policyVersion:5,intervalSeconds:300};
 assert.equal(deleteBeforeChange.recommendation,'delete-original-job');assert.equal(deleteBeforeChange.logicalTaskId,job.logicalTaskId);
 assert.equal(participationAdoptionEvidence(deleteBeforeChange,newReadback),null,'cannot adopt a replacement before confirming the old stop');
 const notConfirmed=planParticipation(target,current,faster,{...stopped,stopConfirmed:false});assert.equal(notConfirmed.recommendation,'query-original-host-result');assert.equal(participationAdoptionEvidence(notConfirmed,newReadback),null);
 const replaceAfterStop=planParticipation(target,current,faster,stopped);assert.equal(replaceAfterStop.recommendation,'create-unique-replacement');assert.equal(replaceAfterStop.logicalTaskId,job.logicalTaskId);
 assert.deepEqual(participationAdoptionEvidence(replaceAfterStop,newReadback),{expectedVersion:7,expectedPolicyVersion:5,jobState:'scheduled',source:'host_readback',reportSent:false});
 assert.equal(participationAdoptionEvidence(replaceAfterStop,{...newReadback,logicalTaskId:'another-task'}),null);assert.equal(participationAdoptionEvidence(replaceAfterStop,{...newReadback,intervalSeconds:3600}),null);

});
test('null interval never resumes a job, legacy observe remains distinct, and inconsistent snapshots are rejected',()=>{
 const off=planParticipation(target,{...policy,mode:'autonomous'},access('autonomous',4,null),job);assert.equal(off.recommendation,'pause-original-job');assert.equal((off.intent as any).effectiveState,'off');
 assert.equal((planParticipation(target,{...policy,mode:'observe'},access('observe')).intent as any).mode,'observe');assert.equal(planParticipation(target,policy,access()).recommendation,'inspect-original-job');
 assert.throws(()=>planParticipation(target,policy,access('manual',3)),/participation_snapshot_changed/);assert.throws(()=>planParticipation(target,{...policy,mode:'future'},access()),/participation_snapshot_invalid/);assert.throws(()=>planParticipation(target,policy,access(),{...job,agentId:'another-agent'}),/host_job_identity_mismatch/);
});
test('the optional CLI plan reads only current capabilities/self/policy/access and never resumes a pending business write',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'participation-plan-')),file=join(directory,'synthetic-state.json'),runtime='runtime_synthetic.'+'a'.repeat(43),continuation='continuation_synthetic.'+'b'.repeat(43);
 const state={format:'connet-agent-v1',...target,apiVersion:'v1',documentationVersion:'v1',runtimeToken:runtime,continuationToken:continuation,fields:{displayName:'Synthetic',bio:'',avatar:{template:'basic',color:'blue'}},commands:{registration:{method:'POST',path:'/v1/registrations',action:'register',scope:'registration:synthetic-attempt',body:{operationId:'synthetic-register',attemptId:'synthetic-attempt',runtimeToken:runtime,continuationToken:continuation},status:'committed',result:{outcome:'committed'}},pending:{method:'PUT',path:'/v1/agents/synthetic-agent/profile',scope:'agent:synthetic-agent',action:'saveProfile',body:{operationId:'synthetic-pending'},status:'pending'}},pendingMutation:{name:'profile-update',key:'pending',intent:{fields:{bio:'pending draft'}}}};
 const bytes=JSON.stringify(state),originalFetch=globalThis.fetch,requests:string[]=[];await writeFile(file,bytes,{mode:0o600});globalThis.fetch=async(input,options)=>{assert.equal(options?.method,'GET');const url=new URL(String(input));assert.equal(url.origin,target.origin);requests.push(url.pathname);if(url.pathname==='/v1/capabilities')return Response.json({apiVersion:'v1',instanceId:target.instanceId});assert.equal((options?.headers as Record<string,string>).authorization,'Bearer '+runtime);if(url.pathname==='/v1/agent/self')return Response.json(target);if(url.pathname.endsWith('/world-action-policy'))return Response.json(policy);if(url.pathname.endsWith('/world-access'))return Response.json(access());throw Error('unexpected fixture read');};
 try{const result=await runAgent(['participation-plan','--state',file]);assert.equal(result.hostExecution,'not_executed');assert.equal(result.adoption,'not_reported');assert.equal(result.recommendation,'inspect-original-job');assert.deepEqual(requests,['/v1/capabilities','/v1/agent/self','/v1/agents/synthetic-agent/world-action-policy','/v1/agents/synthetic-agent/world-access']);assert.equal(await readFile(file,'utf8'),bytes);assert.deepEqual(await readdir(directory),['synthetic-state.json']);assert(!JSON.stringify(result).includes(runtime));}
 finally{globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});}
});
