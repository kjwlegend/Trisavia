import {APPEARANCE_VERSION,lookFor} from './world-pixel/look.js';
function failure(code){const error=new Error(code);error.code=code;return error;}

export const managerActions=new Set(['saveProfile','saveWorldAccess','saveDraft','publishProfile','join','profilePolicy','participation']);
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function parseIntervalSeconds(text,unit){
  if(!['1','60','3600'].includes(unit))throw failure('invalid_interval');
  if(text.trim()==='')return null;
  if(!/^\d+$/.test(text.trim())||text.length>100)throw failure('invalid_interval');
  const seconds=BigInt(text.trim())*BigInt(unit);if(seconds<=0n||seconds>BigInt(Number.MAX_SAFE_INTEGER))throw failure('invalid_interval');return Number(seconds);
}
export function managerInput(action,input){
  const invalid=()=>{throw failure('invalid_backup');};
  if(!managerActions.has(action)||!input||!positive(input.expectedVersion))invalid();
  const clean={expectedVersion:input.expectedVersion};
  if(action==='participation'){
    if(Object.keys(input).some(key=>!['operationId','expectedVersion','paused'].includes(key))||typeof input.paused!=='boolean')invalid();
    return{...clean,paused:input.paused};
  }
  if(action==='saveWorldAccess'){if(input.intervalSeconds!==null&&!positive(input.intervalSeconds))invalid();return{...clean,intervalSeconds:input.intervalSeconds};}
  if(action==='join'){if(!positive(input.expectedProfileVersion))invalid();return{...clean,expectedProfileVersion:input.expectedProfileVersion};}
  if(!positive(input.expectedPolicyVersion))invalid();clean.expectedPolicyVersion=input.expectedPolicyVersion;
  if(action==='profilePolicy'){
    if(Object.keys(input).some(key=>!['operationId','expectedVersion','expectedPolicyVersion','mode','lockedFields'].includes(key))||!['agent_autonomous','owner_specified','proposal_required'].includes(input.mode)||!Array.isArray(input.lockedFields)||new Set(input.lockedFields).size!==input.lockedFields.length||input.lockedFields.some(field=>!['displayName','avatar','bio','interests'].includes(field)))invalid();
    return{...clean,mode:input.mode,lockedFields:[...input.lockedFields]};
  }
  if(action==='publishProfile')return clean;
  const fields=input.fields;if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(key=>!['displayName','avatar','bio','interests'].includes(key)))invalid();
  clean.fields={};
  if(fields.displayName!==undefined){if(typeof fields.displayName!=='string'||!fields.displayName.trim()||fields.displayName.length>60)invalid();clean.fields.displayName=fields.displayName;}
  if(fields.avatar!==undefined){
    if(fields.avatar?.lookId!==undefined){if(!lookFor(fields.avatar.lookId)||fields.avatar.catalogVersion!==APPEARANCE_VERSION||Object.keys(fields.avatar).some(key=>!['lookId','catalogVersion'].includes(key)))invalid();clean.fields.avatar={lookId:fields.avatar.lookId,catalogVersion:fields.avatar.catalogVersion};}
    else{if(fields.avatar?.template!=='basic'||!['olive','cream','blue','coral'].includes(fields.avatar.color)||Object.keys(fields.avatar).some(key=>!['template','color'].includes(key)))invalid();clean.fields.avatar={template:'basic',color:fields.avatar.color};}
  }
  if(fields.bio!==undefined){if(typeof fields.bio!=='string'||fields.bio.length>500)invalid();clean.fields.bio=fields.bio;}
  if(fields.interests!==undefined){if(!Array.isArray(fields.interests)||fields.interests.length>10||fields.interests.some(value=>typeof value!=='string'||!value.trim()||value.length>40))invalid();clean.fields.interests=[...fields.interests];}
  if(input.removeFields!==undefined){if(!Array.isArray(input.removeFields)||new Set(input.removeFields).size!==input.removeFields.length||input.removeFields.some(key=>!['bio','interests'].includes(key)||key in fields))invalid();clean.removeFields=[...input.removeFields];}
  return clean;
}
export function managerRequest(pending){
  if(!managerActions.has(pending.action))return null;
  const agent=encodeURIComponent(pending.targetId);
  if(pending.action==='profilePolicy'||pending.action==='participation')return{path:`/owner/agents/${agent}/${pending.action==='profilePolicy'?'profile-policy':'participation'}`,method:'PUT'};
  if(pending.action==='saveWorldAccess')return{path:`/owner/agents/${agent}/world-access`,method:'PUT'};
  if(pending.action==='join')return{path:`/agents/${agent}/membership/join`,method:'POST'};
  return{path:`/agents/${agent}/profile${{saveProfile:'',saveDraft:'/draft',publishProfile:'/publish'}[pending.action]}`,method:pending.action==='publishProfile'?'POST':'PUT'};
}
export function assertManagerResult(result,pending,ownerId){
  if(!managerActions.has(pending.action))return;
  const mismatch=()=>{throw failure('operation_mismatch');};
  if(result.operationId!==pending.operationId||pending.scope!==`owner:${ownerId}`||result.agentId!==pending.targetId)mismatch();
  if(pending.action==='profilePolicy'){if(result.mode!==pending.input?.mode||JSON.stringify(result.lockedFields)!==JSON.stringify(pending.input?.lockedFields)||!positive(result.version)||!positive(result.policyVersion))mismatch();}
  else if(pending.action==='participation'){if(result.ownerPaused!==pending.input?.paused||!positive(result.version))mismatch();}
  else if(pending.action==='saveWorldAccess'){if(result.intervalSeconds!==pending.input?.intervalSeconds||!positive(result.version))mismatch();}
  else if(pending.action==='saveProfile'||pending.action==='saveDraft'){
    const fields=pending.action==='saveProfile'?result.published:result.draft;
    if(!fields||!positive(result.version)||(pending.action==='saveProfile'&&(result.saveEffect!=='public'||!fields.displayName||!fields.avatar)))mismatch();
    for(const [key,value]of Object.entries(pending.input?.fields||{}))if(JSON.stringify(fields[key])!==JSON.stringify(value))mismatch();
    for(const key of pending.input?.removeFields||[])if(Object.hasOwn(fields,key))mismatch();
  }
  else if(pending.action==='publishProfile'&&!result.published?.displayName)mismatch();
  else if(pending.action==='join'&&result.state!=='joined')mismatch();
}
