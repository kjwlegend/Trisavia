// Adoption is an Agent report, never a platform claim that a local job ran.
import {accountLabel} from './owner-i18n.js';
// Adoption is an Agent report, never a platform claim that a local job ran.
export function worldAccessAdoptionText(access,policy){
 const value=access?.adoption,unknown=accountLabel("access.unknown");
 if(!Number.isSafeInteger(access?.version)||access.version<1||value?.source!=='agent_report'||!['current','awaiting','unknown'].includes(value.status)||!['scheduled','stopped','unknown'].includes(value.jobState)||!(value.appliedVersion===null||Number.isSafeInteger(value.appliedVersion)&&value.appliedVersion>=1)||!(value.reportedAt===null||Number.isSafeInteger(value.reportedAt)&&value.reportedAt>=0))return unknown;
 if(access?.scheduling!==undefined||policy?.mode==='manual'){
  const intent=access?.scheduling,mode=intent?.mode,reason=mode==='manual'?'manual':mode==='observe'?'legacy_observe':access?.intervalSeconds===null?'interval_stopped':'autonomous_interval';
  if(intent?.version!==1||intent.source!=='server_intent'||intent.serverControlsJob!==false||!['autonomous','manual','observe'].includes(mode)||!Number.isSafeInteger(intent.policyVersion)||intent.policyVersion<0||intent.reason!==reason||intent.effectiveState!==(reason==='autonomous_interval'?'on':'off')||(policy&&(intent.policyVersion!==policy.version||mode!==policy.mode)))return unknown;
  if(value.appliedVersion!==access.version||value.appliedPolicyVersion!==intent.policyVersion)return accountLabel('access.awaiting');
  if(value.jobState!=='unknown'&&value.jobState!==(intent.effectiveState==='on'?'scheduled':'stopped'))return unknown;
 }
 if(value.status==='unknown')return unknown;
 if(value.status==='awaiting')return accountLabel("access.awaiting");
 if(value.appliedVersion!==access.version||value.reportedAt===null||value.jobState==='unknown')return unknown;
 return value.jobState==='stopped'?accountLabel("access.stoppedReport"):accountLabel("access.adoptedReport");
}

// Only a current server intent is named; neither this nor adoption controls a host job.
export function worldAccessSchedulingText(access,policy){
 const value=access?.scheduling,mode=policy?.mode,reason=mode==='manual'?'manual':mode==='observe'?'legacy_observe':access?.intervalSeconds===null?'interval_stopped':'autonomous_interval';
 if(!policy||access?.agentId!==policy.agentId||!Number.isSafeInteger(access.version)||access.version<1||!(access.intervalSeconds===null||Number.isSafeInteger(access.intervalSeconds)&&access.intervalSeconds>0)||value?.version!==1||value.source!=='server_intent'||value.serverControlsJob!==false||value.mode!==mode||value.policyVersion!==policy.version||value.reason!==reason||value.effectiveState!==(reason==='autonomous_interval'?'on':'off'))return accountLabel('access.unknown');
 return accountLabel('access.schedulingIntent',{state:accountLabel(value.effectiveState==='on'?'access.schedulingOn':'access.schedulingOff'),adoption:worldAccessAdoptionText(access,policy)});
}
