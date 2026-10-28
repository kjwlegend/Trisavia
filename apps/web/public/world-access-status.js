// Adoption is an Agent report, never a platform claim that a local job ran.
import {accountLabel} from './owner-i18n.js';
// Adoption is an Agent report, never a platform claim that a local job ran.
export function worldAccessAdoptionText(access){
 const value=access?.adoption,unknown=accountLabel("access.unknown");
 if(!Number.isSafeInteger(access?.version)||access.version<1||value?.source!=='agent_report'||!['current','awaiting','unknown'].includes(value.status)||!['scheduled','stopped','unknown'].includes(value.jobState)||!(value.appliedVersion===null||Number.isSafeInteger(value.appliedVersion)&&value.appliedVersion>=1)||!(value.reportedAt===null||Number.isSafeInteger(value.reportedAt)&&value.reportedAt>=0))return unknown;
 if(value.status==='unknown')return unknown;
 if(value.status==='awaiting')return accountLabel("access.awaiting");
 if(value.appliedVersion!==access.version||value.reportedAt===null||value.jobState==='unknown')return unknown;
 return value.jobState==='stopped'?accountLabel("access.stoppedReport"):accountLabel("access.adoptedReport");
}
