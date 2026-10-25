import {isUnknown} from './common.js';
const actions={
 'avatar_assets.tasks.create':()=>'/tasks',
 'avatar_assets.tasks.revoke':input=>`/tasks/${encodeURIComponent(input.taskId)}/revoke`,
 'avatar_assets.drafts.create':()=>'/drafts',
 'avatar_assets.apply':()=>'/apply',
 'avatar_assets.restore_builtin':()=>'/restore-builtin',
};
const failure=code=>Object.assign(new Error(code),{code});
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
// Private bytes remain in memory. Only the original operation key, input hash
// and small JSON fields survive reload, so an unknown upload is recovered first.
export function createAvatarOperations({context,request,storage=globalThis.sessionStorage}){
 let pending=null,busy=false;
 const active=()=>{const value=context();if(!value?.scope||!value.agentId||!value.ownerId)throw failure('authentication_required');return value;};
 const key=scope=>'connet.avatar.operation.v1:'+scope;
 function saved(ctx){if(pending?.scope===ctx.scope)return pending;const source=storage.getItem(key(ctx.scope));pending=source?JSON.parse(source):null;if(pending&&(!actions[pending.action]||pending.scope!==ctx.scope||typeof pending.operationId!=='string'||!/^[a-f0-9]{64}$/.test(pending.hash)))throw failure('avatar_operation_invalid');return pending;}
 function persist(value){const {files,...fields}=value.body;storage.setItem(key(value.scope),JSON.stringify({...value,body:fields,missingFiles:Boolean(files?.length)}));}
 const current=ctx=>context()?.scope===ctx.scope;
 function finish(ctx,receipt){
  if(receipt?.key?.domain!=='avatar_assets'||receipt.key.action!==pending.action||receipt.key.commandId!==pending.operationId||receipt.key.principal?.kind!=='owner'||receipt.key.principal.id!==ctx.ownerId||receipt.result?.agentId!==ctx.agentId||!['committed','rejected','conflict','expired'].includes(receipt.outcome))throw failure('avatar_receipt_invalid');
  storage.removeItem(key(ctx.scope));pending=null;
  if(receipt.outcome!=='committed')throw failure(receipt.result?.code||'avatar_operation_rejected');
  return receipt;
 }
 async function send(ctx){
  const input=pending;
  try{const value=await request(input.path,{method:'POST',body:input.body});if(!current(ctx))throw failure('avatar_context_changed');if(value.protocolVersion!==1||value.instanceId!==ctx.instanceId)throw failure('avatar_receipt_invalid');return finish(ctx,value.data);}
  catch(error){if(!isUnknown(error)&&!['avatar_context_changed','avatar_receipt_invalid'].includes(error.code)){storage.removeItem(key(ctx.scope));pending=null;}throw error;}
 }
 async function recover(ctx){
  const operation=saved(ctx);if(!operation)return null;
  try{const value=await request(`/agents/${encodeURIComponent(ctx.agentId)}/avatar-assets/receipts/${encodeURIComponent(operation.operationId)}?${new URLSearchParams({action:operation.action})}`);if(!current(ctx))throw failure('avatar_context_changed');if(value.protocolVersion!==1||value.instanceId!==ctx.instanceId)throw failure('avatar_receipt_invalid');return finish(ctx,value.data);}
  catch(error){if(error.status!==404)throw error;if(operation.missingFiles&&!operation.body.files)throw failure('avatar_original_files_required');return send(ctx);}
 }
 return{
  pending(){const ctx=active(),value=saved(ctx);if(!value)return null;const{files,operationId,...fields}=value.body;return{operationId:value.operationId,action:value.action,missingFiles:value.missingFiles===true,fields};},
  async run(action,input){
   if(busy)throw failure('avatar_operation_busy');busy=true;
   try{
    const ctx=active();if(!actions[action])throw failure('avatar_operation_invalid');const path=`/agents/${encodeURIComponent(ctx.agentId)}/avatar-assets`+actions[action](input),body={...input};if(action==='avatar_assets.tasks.revoke')delete body.taskId;
    const digest=await hash({path,body});if(!current(ctx))throw failure('avatar_context_changed');const previous=saved(ctx);
    if(previous){if(previous.action!==action||previous.hash!==digest)throw failure('avatar_operation_pending');previous.body={...body,operationId:previous.operationId};return await recover(ctx);}
    pending={scope:ctx.scope,action,operationId:crypto.randomUUID(),hash:digest,path,body:{...body}};pending.body.operationId=pending.operationId;persist(pending);return await send(ctx);
   }finally{busy=false;}
  },
  async recover(){if(busy)throw failure('avatar_operation_busy');busy=true;try{return await recover(active());}finally{busy=false;}},
  clearMemory(){pending=null;},
 };
}
