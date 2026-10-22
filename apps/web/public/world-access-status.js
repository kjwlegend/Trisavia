// Adoption is an Agent report, never a platform claim that a local job ran.
export function worldAccessAdoptionText(access){
 const value=access?.adoption,unknown='采用情况：未知。';
 if(!Number.isSafeInteger(access?.version)||access.version<1||value?.source!=='agent_report'||!['current','awaiting','unknown'].includes(value.status)||!['scheduled','stopped','unknown'].includes(value.jobState)||!(value.appliedVersion===null||Number.isSafeInteger(value.appliedVersion)&&value.appliedVersion>=1)||!(value.reportedAt===null||Number.isSafeInteger(value.reportedAt)&&value.reportedAt>=0))return unknown;
 if(value.status==='unknown')return unknown;
 if(value.status==='awaiting')return'等待同步：尚未收到这次设置的采用报告。';
 if(value.appliedVersion!==access.version||value.reportedAt===null||value.jobState==='unknown')return unknown;
 return value.jobState==='stopped'?'Agent 已报告停止本地任务。':'Agent 已报告采用。';
}
