import {ApiError,validToken,tokenId} from './common.js';
import {accountFields} from './owner-account.js';

const key='connet.owner.email.v1';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const actions={registration:['startRegistration','sendRegistrationCode','verifyRegistrationEmail','cancelRegistration','registerOwner','completeSetup'],recovery:['startEmailRecovery','sendRecoveryCode','verifyRecoveryEmail','recoverByEmail']};
export const emailScope=state=>`${state.kind==='registration'?'owner-registration':'owner-email-recovery'}:${state.attemptId}`;

// This record is private to this tab and origin. Passwords/codes and imported
// request paths are deliberately absent; all HTTP dispatch lives in the flow.
export function readEmailProgress(){
  let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{throw new ApiError('private_storage_unavailable',400);}
  if(!saved)return null;
  const invalid=()=>{throw new ApiError('email_progress_invalid',400);};
  if(saved.format!=='connet-email-progress-v1'||saved.origin!==location.origin||!Object.hasOwn(actions,saved.kind)||typeof saved.attemptId!=='string'||saved.attemptId.length<8||saved.attemptId.length>100||!validToken(saved.browserToken)||(saved.kind==='registration'&&!uuid(saved.attemptId)))invalid();
  const next={format:saved.format,origin:saved.origin,kind:saved.kind,attemptId:saved.attemptId,browserToken:saved.browserToken};
  if(saved.verificationMode!==undefined){if(!['experience','resend'].includes(saved.verificationMode)||saved.codeLength!==(saved.verificationMode==='experience'?4:8))invalid();next.verificationMode=saved.verificationMode;next.codeLength=saved.codeLength;}
  if(saved.kind==='registration'){
    let fields;try{fields=accountFields(saved.username,saved.email);}catch{invalid();}
    if(fields.username!==saved.username||fields.email!==saved.email)invalid();Object.assign(next,fields);
    if(saved.target){const target=saved.target;if(!uuid(target.ownerId)||typeof target.agentId!=='string'||target.agentId.length<8||target.agentId.length>100||!positive(target.generation)||Boolean(target.handoffToken)===Boolean(target.setupToken)||!validToken(target.handoffToken||target.setupToken))invalid();next.target={ownerId:target.ownerId,agentId:target.agentId,generation:target.generation,...(target.handoffToken?{handoffToken:target.handoffToken}:{setupToken:target.setupToken})};}
  }else{
    if(!validToken(saved.assistanceToken)||saved.requestId!==tokenId(saved.assistanceToken)||!uuid(saved.ownerId)||typeof saved.agentId!=='string'||saved.agentId.length<8||saved.agentId.length>100||saved.attemptId!==tokenId(saved.browserToken))invalid();
    Object.assign(next,{assistanceToken:saved.assistanceToken,requestId:saved.requestId,ownerId:saved.ownerId,agentId:saved.agentId});
  }
  if(saved.sessionToken!==undefined){if(!validToken(saved.sessionToken))invalid();next.sessionToken=saved.sessionToken;}
  if(saved.recoveryToken!==undefined){if(!validToken(saved.recoveryToken))invalid();next.recoveryToken=saved.recoveryToken;}
  if(saved.backupSaved===true&&next.recoveryToken)next.backupSaved=true;
  if(saved.started===true)next.started=true;
  if(saved.completed===true&&saved.kind==='recovery'&&!saved.pending)next.completed=true;
  if(saved.startOperationId!==undefined){if(typeof saved.startOperationId!=='string'||saved.startOperationId.length<8||saved.startOperationId.length>100)invalid();next.startOperationId=saved.startOperationId;}
  if(saved.sendOperationId!==undefined){if(typeof saved.sendOperationId!=='string'||saved.sendOperationId.length<8||saved.sendOperationId.length>100)invalid();next.sendOperationId=saved.sendOperationId;}
  if(saved.sendUiLocale!==undefined){if(!saved.sendOperationId||!['zh-CN','en'].includes(saved.sendUiLocale))invalid();next.sendUiLocale=saved.sendUiLocale;}
  if(saved.pending){const p=saved.pending;if(typeof p.operationId!=='string'||p.operationId.length<8||p.operationId.length>100||!actions[next.kind].includes(p.action)||p.scope!==emailScope(next))invalid();
    if((p.action==='completeSetup'&&!next.target)||(p.action==='registerOwner'&&next.target)||(['registerOwner','completeSetup','recoverByEmail'].includes(p.action)&&!next.sessionToken))invalid();
    next.pending={operationId:p.operationId,scope:p.scope,action:p.action,uncertain:true};
    if(p.uiLocale!==undefined){if(!['sendRegistrationCode','sendRecoveryCode','recoverByEmail'].includes(p.action)||!['zh-CN','en'].includes(p.uiLocale))invalid();next.pending.uiLocale=p.uiLocale;}
    if(['sendRegistrationCode','sendRecoveryCode'].includes(p.action)&&saved.sendUiLocale!==undefined&&p.uiLocale!==saved.sendUiLocale)invalid();
    if(p.action.startsWith('verify')){const challengeOperationId=p.challengeOperationId||next.sendOperationId;if(typeof challengeOperationId!=='string'||challengeOperationId.length<8||challengeOperationId.length>100)invalid();next.pending.challengeOperationId=challengeOperationId;if(p.challengeBound!==undefined&&p.challengeBound!==true)invalid();if(p.challengeBound===true)next.pending.challengeBound=true;}
  }
  return next;
}
export function saveEmailProgress(state){
  try{const text=JSON.stringify(state);sessionStorage.setItem(key,text);if(sessionStorage.getItem(key)!==text)throw new Error();}
  catch{throw new ApiError('private_storage_unavailable',400);}
}
export function clearEmailProgress(){try{sessionStorage.removeItem(key);}catch{}}
