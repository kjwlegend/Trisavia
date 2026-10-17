import {validToken,tokenId} from './common.js';
import {accountFields,normalizeIdentifier} from './owner-account.js';
export class BackupError extends Error {
  constructor(code, originalOrigin=null){super(code);this.code=code;this.originalOrigin=originalOrigin;}
}
const validId=value=>typeof value==='string'&&value.length>=8&&value.length<=100;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const generation=value=>Number.isSafeInteger(value)&&value>0;
function readAccountInput(input){
  if(!input||typeof input.username!=='string'||typeof input.email!=='string')throw new BackupError('invalid_backup');
  const fields=accountFields(input.username,input.email);
  if(fields.username!==input.username||fields.email!==input.email)throw new BackupError('invalid_backup');
  return fields;
}
export function parseOwnerBackup(text,origin){
  const invalid=()=>{throw new BackupError('invalid_backup');};
  if(typeof text!=='string'||text.length>32768)invalid();
  let saved;try{saved=JSON.parse(text);}catch{invalid();}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))invalid();
  if(['connet-agent-v1','connet-handoff-v1','connet-runtime-v1','connet-invite-v1'].includes(saved.format))throw new BackupError('agent_material');
  if(saved.format!=='connet-owner-v2')invalid();
  const loginOnly=saved.ownerId===undefined;
  if(!loginOnly&&!uuid(saved.ownerId))invalid();
  if(saved.origin!==origin)throw new BackupError('different_origin',['https://38.207.178.31','https://world.kjwlabs.com'].includes(saved.origin)?saved.origin:null);
  const next={format:'connet-owner-v2',origin:saved.origin,...(!loginOnly?{ownerId:saved.ownerId}:{})};
  for(const key of ['sessionToken','recoveryToken','setupToken','sourceRecoveryToken']){
    if(saved[key]!==undefined&&!validToken(saved[key]))invalid();
    if(saved[key])next[key]=saved[key];
  }
  if(loginOnly&&(!next.sessionToken||saved.recoveryToken!==undefined||saved.setupToken!==undefined||saved.sourceRecoveryToken!==undefined||saved.setupExchange!==undefined))invalid();
  if(!loginOnly&&!next.sessionToken&&!next.recoveryToken&&!next.setupToken)invalid();
  if(saved.setupExchange){const e=saved.setupExchange;
    if(loginOnly||!validId(e.operationId)||e.ownerId!==next.ownerId||!validId(e.agentId)||!generation(e.generation)||!validToken(e.handoffToken)||!validToken(e.setupToken)||e.setupToken!==next.setupToken)invalid();
    next.setupExchange={operationId:e.operationId,ownerId:e.ownerId,agentId:e.agentId,generation:e.generation,handoffToken:e.handoffToken,setupToken:e.setupToken};
  }
  if(saved.claimContext){const c=saved.claimContext;
    if(!validId(c.agentId)||!generation(c.generation)||Boolean(c.handoffToken)===Boolean(c.setupToken)||!validToken(c.handoffToken||c.setupToken))invalid();
    const e=next.setupExchange;if(e&&(c.agentId!==e.agentId||c.generation!==e.generation||(c.handoffToken?c.handoffToken!==e.handoffToken:c.setupToken!==e.setupToken)))invalid();
    next.claimContext={agentId:c.agentId,generation:c.generation,...(c.handoffToken?{handoffToken:c.handoffToken}:{setupToken:c.setupToken})};
  }
  if(saved.pendingOperation){const p=saved.pendingOperation;
    if(!p||!validId(p.operationId)||typeof p.scope!=='string')invalid();
    const input=p.input;let clean;
    try{
      if(p.action==='login'){
        if(!loginOnly||!next.sessionToken||p.scope!==`owner-login:${tokenId(next.sessionToken)}`||!input||typeof input.identifier!=='string')invalid();
        clean={identifier:normalizeIdentifier(input.identifier)};if(clean.identifier!==input.identifier)invalid();
      }else if(loginOnly)invalid();
      else if(p.action==='recover'){
        if(p.scope!==`owner:${next.ownerId}`||!next.sessionToken||!next.recoveryToken||!next.sourceRecoveryToken)invalid();
      }else if(p.action==='completeSetup'){
        if(!next.setupToken||!next.sessionToken||!next.recoveryToken||p.scope!==`setup:${tokenId(next.setupToken)}`)invalid();
        clean=readAccountInput(input);
      }else if(p.action==='registerOwner'){
        if(!next.sessionToken||!next.recoveryToken||p.scope!==`owner-registration:${next.ownerId}`||input?.attemptId!==next.ownerId)invalid();
        clean={attemptId:next.ownerId,...readAccountInput(input)};
      }else if(p.action==='claimAgent'){
        const c=next.claimContext;
        if(!next.sessionToken||p.scope!==`owner:${next.ownerId}`||!c||input?.agentId!==c.agentId||input.expectedGeneration!==c.generation)invalid();
        clean={agentId:c.agentId,expectedGeneration:c.generation};
      }else invalid();
    }catch{invalid();}
    // Imported files never choose request paths, methods, passwords or actions.
    next.pendingOperation={operationId:p.operationId,scope:p.scope,action:p.action,...(clean?{input:clean}:{}),uncertain:true};
  }else if(loginOnly)invalid();
  return next;
}
