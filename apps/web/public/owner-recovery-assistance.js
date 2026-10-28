import {accountMessage,accountText} from './owner-i18n.js';
import {publicIdLabel} from './public-id.js';
import {$ as query,api,ApiError,validToken,tokenId,stamp} from './common.js';
import {BackupError} from './owner-backup.js';

const storageKey='connet.owner.assistance.v1';
const statuses={pending:accountMessage("recovery.assistance.status.pending"),completed:accountMessage("recovery.assistance.status.completed"),cancelled:accountMessage("recovery.assistance.status.cancelled"),expired:accountMessage("recovery.assistance.status.expired")};

// The private entry locates one request. It never supplies owner authority.
export function createRecoveryAssistance(onChange,root=document){
  const $=selector=>query(selector,root);
  let proof='',context=null,verified=false,available=false,agentName='',generation=0,controller=null;
  try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.origin===location.origin&&validToken(saved.assistanceToken))proof=saved.assistanceToken;}catch{}
  function render(error){
    $('#assistance-context').hidden=!proof;
    accountText($('#assistance-status'),()=>(error?accountMessage("recovery.assistance.status.unavailable"):verified&&context?.status==='pending'?accountMessage("recovery.assistance.status.backupVerified"):statuses[context?.status]||accountMessage("recovery.assistance.status.loading")));
    accountText($('#assistance-agent-name'),()=>(agentName||accountMessage("recovery.assistance.agentFallback")));
    $('#assistance-target').hidden=!context?.agentId;
    accountText($('#assistance-agent-id'),()=>(publicIdLabel(context?.publicId)));
    accountText($('#assistance-expiry'),()=>(context?.expiresAt?accountMessage("recovery.expiry",{time:stamp(context.expiresAt)}):''));
    $('#assistance-refresh').hidden=!error;
    $('#assistance-terminal').hidden=!context||context.status==='pending';
    if(context&&context.status!=='pending')accountText($('#assistance-terminal'),()=>(context.status==='completed'?accountMessage("recovery.assistance.terminal.completed"):context.status==='cancelled'?accountMessage("recovery.assistance.terminal.cancelled"):accountMessage("recovery.assistance.terminal.expired")));
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
