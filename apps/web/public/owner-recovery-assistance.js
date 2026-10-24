import {publicIdLabel} from './public-id.js';
import {$ as query,api,ApiError,validToken,tokenId,stamp} from './common.js';
import {BackupError} from './owner-backup.js';

const storageKey='connet.owner.assistance.v1';
const statuses={pending:'等待主人验证',completed:'本次协助已完成',cancelled:'本次协助已取消',expired:'本次协助已过期'};

// The private entry locates one request. It never supplies owner authority.
export function createRecoveryAssistance(onChange,root=document){
  const $=selector=>query(selector,root);
  let proof='',context=null,verified=false,available=false,agentName='',generation=0,controller=null;
  try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.origin===location.origin&&validToken(saved.assistanceToken))proof=saved.assistanceToken;}catch{}
  function render(error){
    $('#assistance-context').hidden=!proof;
    $('#assistance-status').textContent=error?'暂时无法读取协助状态，请重试。':verified&&context?.status==='pending'?'主人备份已验证，尚未重设密码。':statuses[context?.status]||'正在读取协助请求…';
    $('#assistance-agent-name').textContent=agentName||'发起协助的 Agent';
    $('#assistance-target').hidden=!context?.agentId;
    $('#assistance-agent-id').textContent=publicIdLabel(context?.publicId);
    $('#assistance-expiry').textContent=context?.expiresAt?`有效期至 ${stamp(context.expiresAt)}`:'';
    $('#assistance-refresh').hidden=!error;
    $('#assistance-terminal').hidden=!context||context.status==='pending';
    if(context&&context.status!=='pending')$('#assistance-terminal').textContent=context.status==='completed'?'这次协助已完成，不能再次重设。请用新密码登录。':context.status==='cancelled'?'这次协助已取消，不能继续重设。你仍可使用当前有效的登录备份自行找回。':'这次协助已过期，不能继续重设。请让 Agent 在有效授权下重新发起，或使用当前有效的登录备份自行找回。';
    onChange();
  }
  function snapshot(){return context?.ownerId?{assistanceToken:proof,requestId:context.requestId,agentId:context.agentId,publicId:context.publicId,ownerId:context.ownerId,version:context.version}:null;}
  function accept(result){
    if(result?.requestId!==tokenId(proof)||!result.ownerId||!result.agentId||!Number.isSafeInteger(result.version)||result.version<1||!Object.hasOwn(statuses,result.status)||!Number.isFinite(result.expiresAt)||result.requires!=='owner_recovery')throw new ApiError('response_unknown',0);
    context=result;available=true;
  }
  async function read(nextProof=proof){
    if(!validToken(nextProof))throw new ApiError('authentication_failed',401);
    const nextGeneration=++generation;controller?.abort();controller=new AbortController();
    if(proof!==nextProof){context=null;verified=false;agentName='';}proof=nextProof;available=false;
    try{sessionStorage.setItem(storageKey,JSON.stringify({origin:location.origin,assistanceToken:proof}));}catch{throw new ApiError('private_storage_unavailable',400);}
    render();
    try{const result=await api('/owner/recovery-assistance',{token:proof,signal:controller.signal});if(nextGeneration!==generation)return false;accept(result);render();
      void api(`/public/agents/${encodeURIComponent(context.agentId)}`,{signal:controller.signal}).then(result=>{if(nextGeneration===generation&&result.profile?.displayName){agentName=result.profile.displayName;render();}}).catch(()=>{});
      return true;}
    catch(error){if(nextGeneration!==generation)return false;if(error.code==='recovery_request_expired'){context={requestId:tokenId(proof),status:'expired'};verified=false;render();}else render(error);throw error;}
  }
  async function verify(source){
    if(!available)throw new ApiError('response_unknown',0);
    if(!context?.ownerId||context.status!=='pending')throw new ApiError(context?.status==='expired'?'recovery_request_expired':'recovery_request_closed',409);
    if(source.ownerId!==context.ownerId)throw new BackupError('owner_mismatch');
    const target=proof,targetAgent=context.agentId,nextGeneration=generation;
    const result=await api('/owner/recovery-assistance/verify',{method:'POST',token:source.recoveryToken,body:{assistanceToken:target}});
    if(nextGeneration!==generation||proof!==target)throw new ApiError('response_unknown',0);
    if(result.ownerId!==source.ownerId||result.agentId!==targetAgent||result.status!=='pending')throw new ApiError('response_unknown',0);
    accept(result);verified=true;render();return snapshot();
  }
  function restore(nextProof){
    if(!validToken(nextProof))throw new ApiError('authentication_failed',401);
    if(proof!==nextProof){generation++;controller?.abort();proof=nextProof;context=null;verified=false;available=false;agentName='';}
    try{sessionStorage.setItem(storageKey,JSON.stringify({origin:location.origin,assistanceToken:proof}));}catch{throw new ApiError('private_storage_unavailable',400);}
    render();
  }
  function clear(){generation++;controller?.abort();proof='';context=null;verified=false;available=false;agentName='';try{sessionStorage.removeItem(storageKey);}catch{}render();}
  return {read,verify,restore,clear,snapshot,get token(){return proof;},get context(){return context;},get ready(){return available;},get verified(){return verified;},get terminal(){return Boolean(context&&context.status!=='pending');},showResult(result){accept(result);verified=false;render();}};
}
