import {validToken,tokenId} from './common.js';
export class BackupError extends Error {
  constructor(code, originalOrigin=null){super(code);this.code=code;this.originalOrigin=originalOrigin;}
}
export function parseOwnerBackup(text,origin){
  if(text.length>32768)throw new BackupError('invalid_backup');
  let saved;try{saved=JSON.parse(text);}catch{throw new BackupError('invalid_backup');}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))throw new BackupError('invalid_backup');
  if(['connet-agent-v1','connet-handoff-v1','connet-runtime-v1','connet-invite-v1'].includes(saved.format))throw new BackupError('agent_material');
  if(saved.format!=='connet-owner-v1'||typeof saved.ownerId!=='string'||saved.ownerId.length<8||saved.ownerId.length>100)throw new BackupError('invalid_backup');
  if(saved.origin!==origin)throw new BackupError('different_origin',['https://38.207.178.31','https://world.kjwlabs.com'].includes(saved.origin)?saved.origin:null);
  const next={format:saved.format,origin:saved.origin,ownerId:saved.ownerId};
  for(const key of ['sessionToken','recoveryToken','setupToken','sourceRecoveryToken']){
    if(saved[key]!==undefined&&!validToken(saved[key]))throw new BackupError('invalid_backup');
    if(saved[key])next[key]=saved[key];
  }
  if(saved.pendingOperation){const p=saved.pendingOperation;
    if(!['login','completeSetup','recover'].includes(p.action)||typeof p.operationId!=='string'||(p.operationId.length<8||p.operationId.length>100)||!((['login','recover'].includes(p.action)&&p.scope===`owner:${saved.ownerId}`)||(p.action==='completeSetup'&&saved.setupToken&&p.scope===`setup:${tokenId(saved.setupToken)}`)))throw new BackupError('invalid_backup');
    next.pendingOperation={operationId:p.operationId,scope:p.scope,action:p.action,kind:p.kind,uncertain:true};
  }
  return next;
}
