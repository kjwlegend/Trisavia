import {BackupError} from './owner-backup.js';

// A receipt for the same owner may still describe another Agent or request.
// Validate the fixed command target before discarding any continuation material.
export function assertOwnerOperationResult(result,pending,vault){
  if(!['recover','unpublishProfile','rejectRecoveryRequest'].includes(pending.action))return;
  const mismatch=()=>{throw new BackupError('operation_mismatch');};
  if(result.operationId!==pending.operationId||pending.scope!==`owner:${vault.ownerId}`)mismatch();
  if(pending.action==='unpublishProfile'){
    if(result.agentId!==pending.targetId||result.published!==null)mismatch();
    return;
  }
  if(result.ownerId!==vault.ownerId)mismatch();
  const context=vault.assistanceContext;
  if(pending.action==='rejectRecoveryRequest'&&!context)mismatch();
  if(context){
    if(context.ownerId!==vault.ownerId||result.requestId!==context.requestId)mismatch();
    if(pending.action==='rejectRecoveryRequest'&&(pending.targetId!==context.agentId||result.agentId!==context.agentId))mismatch();
  }
}
