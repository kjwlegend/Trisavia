import {$,api,ApiError,errorText,isUnknown,credential,id,tokenId,stamp,downloadPrivate} from './common.js';
import {accountFields} from './owner-account.js';
import {readEmailProgress,saveEmailProgress,clearEmailProgress,emailScope} from './owner-email-state.js';

const finalActions=['registerOwner','completeSetup','recoverByEmail'];
const states=['pending_email','email_proved','completed','cancelled','expired'];
const deliveries=['unavailable','none','queued','accepted','failed','unknown'];
const copy={
  unavailable:'邮件服务暂不可用。你仍可登录已有账号、关联 Agent，或使用有效的备用恢复文件。',
  none:'尚未发送验证码。',queued:'邮件正在处理，尚未确认服务商受理。',
  accepted:'邮件服务商已受理。请自行查看收件箱；这不代表已收到或已验证。',
  failed:'这次邮件未能发出。请稍后重试，原账号和密码没有改变。',
  unknown:'暂时无法确认邮件投递状态。请先重新读取状态，不要重复发信。',
};
function mismatch(){throw new ApiError('operation_mismatch',400);}

export function createOwnerEmailFlow(hooks){
  let progress=null,currentView=null,viewFromRead=false,active=false,localBusy=false,lease=null,generation=0,storageError=null,backupDownloaded=false,proposedTarget=null;
  try{progress=readEmailProgress();}catch(error){storageError=error;}
  const node=$('#email-view');
  const save=()=>saveEmailProgress(progress);
  const registration=()=>progress?.kind==='registration';
  const verifiedMessage=()=>registration()?`邮箱已验证，请完成注册${progress.target?'并关联 Agent':''}。`:'邮箱已验证，尚未重设密码。请设置新密码并确认。';
  const pending=()=>Boolean(progress?.pending);
  const editable=()=>!progress&&!storageError;
  const canRenewChallenge=()=>viewFromRead&&currentView?.status==='pending_email'&&currentView.challengeExpired===true;
  const inform=(text,tone='')=>{const output=$('#email-feedback');output.textContent=text;output.className=`notice ${tone}`;output.hidden=!text;};
  function fail(error){
    const unavailable=error.code==='email_unavailable'&&error.status===503;
    const message=unavailable?copy.unavailable:error.code==='email_code_invalid'?'验证码无效或已失效，请重新核对。':error.code==='email_rate_limited'?'操作较频繁，请稍后再试。':error.code==='email_delivery_pending'?'上一封邮件仍在处理中，请先读取原投递结果。':error.code==='email_progress_invalid'?'本次浏览器进度无法读取，请保留此标签页。':error.code==='private_storage_unavailable'?'浏览器无法安全保存这次续接进度。你的填写仍保留，请启用会话存储后继续。':error.code==='operation_mismatch'?'返回结果与本次账号、Agent 或请求不符。原进度仍保留，请勿重新注册或重设。':errorText(error);
    inform(message,isUnknown(error)&&!unavailable?'pending':'error');
  }
  function targetLabel(){return hooks.targetName(progress?.target?.agentId||progress?.agentId||proposedTarget?.agentId)||'这位 Agent';}
  function assertView(result){
    const p=progress;if(!p||result.attemptId!==p.attemptId||result.purpose!==(registration()?'registration':'recovery')||!states.includes(result.status)||!deliveries.includes(result.deliveryStatus)||!Number.isFinite(result.expiresAt))mismatch();
    if(result.sendOperationId!==undefined&&(typeof result.sendOperationId!=='string'||result.sendOperationId.length<8||result.sendOperationId.length>100))mismatch();
    if((result.codeExpiresAt!==null&&(!Number.isFinite(result.codeExpiresAt)||result.codeExpiresAt<=0))||typeof result.challengeExpired!=='boolean')mismatch();
    if(registration()){if(p.target&&(result.agentId!==p.target.agentId||result.generation!==p.target.generation||result.ownerId!==p.target.ownerId))mismatch();if(!p.target&&result.agentId!==undefined)mismatch();}
    else if(result.ownerId!==p.ownerId||result.agentId!==p.agentId||result.requestId!==p.requestId)mismatch();
  }
  function assertReceipt(result,command){
    if(!result||result.operationId!==command.operationId||command.scope!==emailScope(progress)||result.attemptId!==progress.attemptId)mismatch();
    if(finalActions.includes(command.action)){
      if(result.sessionId!==tokenId(progress.sessionToken))mismatch();
      if(registration()){
        if(result.ownerId!==(progress.target?.ownerId||progress.attemptId)||result.emailVerified!==true||result.accountComplete!==true)mismatch();
        if(progress.target&&(result.agentId!==progress.target.agentId||result.managementStatus!=='managed'))mismatch();
      }else if(result.ownerId!==progress.ownerId||result.agentId!==progress.agentId||result.requestId!==progress.requestId)mismatch();
    }else{
      assertView(result);
      if(result.verification==='invalid')throw new ApiError('email_code_invalid',400);
      if(command.action.startsWith('verify')&&(result.verification!=='valid'||result.status!=='email_proved'))mismatch();
      if(command.action.startsWith('verify')&&result.sendOperationId!==command.challengeOperationId)mismatch();
    }
  }
  function render(){
    if(!active)return;
    const reg=!progress||registration(),status=currentView?.status;
    $('#email-title').textContent=reg?(progress?.target||proposedTarget?'注册并关联 Agent':'创建主人账号'):'通过注册邮箱找回登录';
    $('#email-intro').textContent=reg?'填写账号资料，验证邮箱后完成注册。登录备份是可选的备用方式。':'验证码只会发往账号原已存邮箱。请在此网页输入，不要告诉 Agent。';
    $('#email-account-fields').hidden=!reg;$('#email-password-label').textContent=reg?'登录密码':'新登录密码';
    $('#email-username').required=reg;$('#email-address').required=reg;$('#email-password-confirm').required=!reg;
    const fixedAgentId=progress?.target?.agentId||progress?.agentId||proposedTarget?.agentId;
    $('#email-target').hidden=!fixedAgentId;$('#email-target').textContent=`本次目标：${targetLabel()} · ${fixedAgentId||''}`;
    $('#email-start').hidden=Boolean(progress);$('#email-start').textContent='发送注册验证码';
    $('#email-challenge').hidden=!progress||status==='completed';
    $('#email-delivery').textContent=progress?`${copy[currentView?.deliveryStatus]||'正在确认邮件状态…'}${canRenewChallenge()?' 上一验证码已过期，可以明确重新发送新验证码；这不表示旧邮件肯定没有发出。':''}`:'';
    $('#email-expiry').textContent=currentView?`本次流程有效至 ${stamp(currentView.expiresAt)}${currentView.resendAfter>Date.now()?`；${stamp(currentView.resendAfter)} 后可重发。`:''}`:'';
    $('#email-code-row').hidden=status==='email_proved'||status==='completed';
    $('#email-finish').hidden=status!=='email_proved'&&!finalActions.includes(progress?.pending?.action);
    $('#email-finish').textContent=reg?(progress?.target?`注册并关联${targetLabel()}`:'完成注册'):'确认重设密码';
    $('#email-password-row').hidden=!reg&&status!=='email_proved'&&!finalActions.includes(progress?.pending?.action);$('#email-password-confirm-row').hidden=reg;
    $('#email-proof-status').textContent=status==='email_proved'?verifiedMessage():status==='expired'?(reg?'这次注册已过期，请重新开始。':'这次重设授权已过期。请返回并让原 Agent 取消旧请求，再私密交付新找回入口。'):status==='cancelled'?'这次注册已取消。':'';
    $('#email-continue').hidden=!pending();$('#email-cancel').hidden=!progress||!reg||finalActions.includes(progress.pending?.action)||status==='completed';
    $('#email-retry-start').hidden=!progress||progress.started||pending();
    $('#email-delivery-retry').hidden=!progress?.sendOperationId||!['queued','unknown'].includes(currentView?.deliveryStatus)||pending()||canRenewChallenge();
    $('#email-send').textContent=canRenewChallenge()?'重新发送新验证码':'发送／重发验证码';
    $('#email-recovery-backup').hidden=reg||status!=='email_proved';
    $('#email-completed').hidden=status!=='completed'||reg;
    $('#email-form').hidden=status==='completed'&&!reg;
    $('#email-back').textContent=reg?'返回登录':'返回找回方式';
    $('#email-restart').hidden=!['expired','cancelled'].includes(status)||pending();
    controls(hooks.uiState());
  }
  function controls({busy=false,mainPending=false}={}){
    if(!active)return;const locked=localBusy||busy||mainPending,closed=['completed','expired','cancelled'].includes(currentView?.status);
    node.querySelectorAll('input,button').forEach(input=>input.disabled=locked);
    for(const field of ['email-username','email-address'])$(`#${field}`).disabled=locked||!editable();
    $('#email-start').disabled=locked||Boolean(progress)||Boolean(storageError);
    $('#email-code').disabled=locked||closed||Boolean(progress?.pending&&!['verifyRegistrationEmail','verifyRecoveryEmail'].includes(progress.pending.action));
    $('#email-verify').disabled=locked||!progress||closed||currentView?.status==='email_proved'||Boolean(progress.pending&&!['verifyRegistrationEmail','verifyRecoveryEmail'].includes(progress.pending.action));
    $('#email-send').disabled=locked||!progress?.started||closed||currentView?.status==='email_proved'||Boolean(progress.pending)||(['queued','unknown'].includes(currentView?.deliveryStatus)&&!canRenewChallenge())||(currentView?.resendAfter||0)>Date.now();
    $('#email-finish').disabled=locked||closed||(currentView?.status!=='email_proved'&&!finalActions.includes(progress?.pending?.action))||Boolean(progress?.pending&&!finalActions.includes(progress.pending.action))||Boolean(progress?.recoveryToken&&!progress.backupSaved);
    $('#email-continue').disabled=locked||!pending();$('#email-refresh').disabled=locked||!progress;
    $('#email-password').disabled=locked||Boolean(progress?.pending&&!finalActions.includes(progress.pending.action));
    $('#email-back').disabled=locked||pending();$('#email-cancel').disabled=locked||pending();
    $('#email-backup-download').disabled=locked||pending();$('#email-backup-saved').disabled=locked||!backupDownloaded;
  }
  async function run(work){
    if(localBusy||hooks.uiState().busy||hooks.uiState().mainPending)return;
    localBusy=true;const revision=++generation;lease=hooks.lock();const ownLease=lease;controls(hooks.uiState());
    try{await work(revision);}catch(error){if(revision===generation)fail(error);}finally{localBusy=false;hooks.unlock(ownLease);render();}
  }
  function show(){active=true;hooks.show(node);render();hooks.focus('#email-title');}
  function openRegistration(target=null){
    if(progress?.completed&&!pending())clear();
    if(storageError){show();fail(storageError);return;}
    if(progress&&(!registration()||JSON.stringify(progress.target||null)!==JSON.stringify(target))){show();inform('请先继续或取消当前邮箱流程，再打开另一位 Agent 的注册入口。','pending');return;}
    proposedTarget=target;
    if(progress){$('#email-username').value=progress.username;$('#email-address').value=progress.email;}
    show();if(progress)void refresh();else hooks.focus('#email-username');
  }
  function baseState(kind){return{format:'connet-email-progress-v1',origin:location.origin,kind,browserToken:credential('browser')};}
  async function startRegistration(){
    if(progress||storageError)return;
    let fields;try{fields=accountFields($('#email-username').value,$('#email-address').value);}catch(error){inform(error.field==='username'?'用户名须为 2—32 个英文字母、数字或下划线。':'请填写当前支持的有效邮箱。','error');hooks.focus(error.field==='username'?'#email-username':'#email-address');return;}
    if(!$('#email-password').reportValidity())return;
    await run(async()=>{
      const target=proposedTarget;progress={...baseState('registration'),attemptId:id(),...fields,...(target?{target}:{})};try{save();}catch(error){progress=null;throw error;}
      $('#email-username').value=fields.username;$('#email-address').value=fields.email;
      await issue('startRegistration');await issue('sendRegistrationCode');
    });
  }
  async function openRecovery(context){
    if(!context)return;
    if(progress?.completed&&!pending()&&progress.assistanceToken!==context.assistanceToken)clear();
    if(storageError){show();fail(storageError);return;}
    if(progress&&(registration()||progress.assistanceToken!==context.assistanceToken)){show();inform('当前还有另一项邮箱流程，请先继续该流程。','pending');return;}
    if(!progress){const state=baseState('recovery');progress={...state,attemptId:tokenId(state.browserToken),...context};try{save();}catch(error){progress=null;show();fail(error);return;}}
    show();await run(async()=>{save();if(!currentView)await issue('startEmailRecovery');else await read();});
  }
  const basePath=()=>registration()?`/owner/registration-attempts/${encodeURIComponent(progress.attemptId)}`:`/owner/email-recovery-attempts/${encodeURIComponent(progress.attemptId)}`;
  function payload(action){
    const p=progress,operationId=p.pending.operationId;
    if(action==='startRegistration')return{operationId,attemptId:p.attemptId,browserToken:p.browserToken,username:p.username,email:p.email,...(p.target?{agentId:p.target.agentId,expectedGeneration:p.target.generation,...(p.target.handoffToken?{handoffToken:p.target.handoffToken}:{setupToken:p.target.setupToken})}:{})};
    if(action==='startEmailRecovery')return{operationId,browserToken:p.browserToken};
    if(['verifyRegistrationEmail','verifyRecoveryEmail'].includes(action))return{operationId,code:$('#email-code').value.trim()};
    if(finalActions.includes(action))return{operationId,...(registration()?{attemptId:p.attemptId}:{}),password:$('#email-password').value,sessionToken:p.sessionToken,...(p.recoveryToken?{recoveryToken:p.recoveryToken}:{}),...(p.target?(p.target.handoffToken?{handoffToken:p.target.handoffToken}:{setupToken:p.target.setupToken}):{})};
    return{operationId};
  }
  function path(action){return{startRegistration:'/owner/registration-attempts',startEmailRecovery:'/owner/recovery-assistance/email-attempts',sendRegistrationCode:`${basePath()}/email-challenges`,sendRecoveryCode:`${basePath()}/email-challenges`,verifyRegistrationEmail:`${basePath()}/email-verifications`,verifyRecoveryEmail:`${basePath()}/email-verifications`,cancelRegistration:`${basePath()}/cancel`,registerOwner:'/owner/accounts',completeSetup:'/owner/setup/complete',recoverByEmail:`${basePath()}/complete`}[action];}
  function authorization(action){return action==='startRegistration'?undefined:action==='startEmailRecovery'?progress.assistanceToken:progress.browserToken;}
  async function issue(action){
    if(progress.pending)throw new ApiError('idempotency_payload_mismatch',409);
    if(finalActions.includes(action)){progress.sessionToken??=credential('session');}
    if(action.startsWith('start'))progress.startOperationId??=id();
    const sending=['sendRegistrationCode','sendRecoveryCode'].includes(action);
    if(sending&&(canRenewChallenge()||!['queued','unknown'].includes(currentView?.deliveryStatus)))progress.sendOperationId=id();
    if(sending&&!progress.sendOperationId)throw new ApiError('email_progress_invalid',400);
    const verifying=action.startsWith('verify');
    if(verifying&&!progress.sendOperationId)throw new ApiError('email_progress_invalid',400);
    progress.pending={action,scope:emailScope(progress),operationId:action.startsWith('start')?progress.startOperationId:sending?progress.sendOperationId:id(),...(verifying?{challengeOperationId:progress.sendOperationId}:{})};save();await submit();
  }
  async function accept(result,command){
    assertReceipt(result,command);
    if(finalActions.includes(command.action)){
      // Adoption is delegated only after the exact original target has matched.
      if(registration()){
        await hooks.registered(result,{...progress});
        clear();return;
      }
      currentView={...result,purpose:'recovery',status:'completed',deliveryStatus:'accepted'};
      delete progress.pending;progress.completed=true;save();$('#email-password').value='';$('#email-password-confirm').value='';$('#email-code').value='';
      hooks.recovered(result);inform('密码已重设，本次 Agent 协助已完成。请用新密码正常登录。','success');render();return;
    }
    progress.started=true;
    if(command.action.startsWith('verify')){
      // A historical verification receipt cannot prove the current challenge.
      const latest=await api(basePath(),{token:progress.browserToken});assertView(latest);currentView=latest;viewFromRead=true;
      if(latest.sendOperationId!==command.challengeOperationId||latest.status!=='email_proved'){
        delete progress.pending;save();$('#email-code').value='';inform('验证码或验证授权的状态已变化，请按当前页面继续。','pending');render();return;
      }
    }else{currentView=result;viewFromRead=false;}
    delete progress.pending;save();$('#email-code').value='';
    if(command.action.startsWith('verify'))inform(verifiedMessage());
    else if(command.action==='cancelRegistration'){clear();hooks.back();return;}
    else if(['sendRegistrationCode','sendRecoveryCode'].includes(command.action)){await read();inform(copy[currentView.deliveryStatus]||'当前进度已保存。');}
    else inform(copy[result.deliveryStatus]||'当前进度已保存。');render();
  }
  async function read(){const result=await api(basePath(),{token:progress.browserToken});assertView(result);currentView=result;viewFromRead=true;progress.started=true;if(!progress.pending&&result.sendOperationId)progress.sendOperationId=result.sendOperationId;if(!pending()&&!registration()&&result.status==='completed')progress.completed=true;save();render();return result;}
  async function originalReceipt(){const p=progress.pending;return api(`/operations/${encodeURIComponent(p.operationId)}?scope=${encodeURIComponent(p.scope)}&action=${encodeURIComponent(p.action)}`,{token:progress.browserToken});}
  async function submit(){
    const command=progress.pending;if(!command)return;
    save();let received=false;
    try{const result=await api(path(command.action),{method:'POST',token:authorization(command.action),body:payload(command.action)});received=true;await accept(result,command);}
    catch(error){
      if(received&&error.code!=='email_code_invalid')throw error;
      if(error.code==='operation_mismatch')throw error;
      // A rejected code is a finished verification attempt, never a new grant.
      if(error.code==='email_code_invalid'){delete progress.pending;save();$('#email-code').value='';try{await read();}catch{}throw error;}
      if(error.code==='email_unavailable'&&error.status===503){
        if(command.uncertain){try{await accept(await originalReceipt(),command);return;}catch(receiptError){if(receiptError.status!==404)throw receiptError;}}
        delete progress.pending;save();throw error;
      }
      if(!isUnknown(error)&&!command.uncertain&&error.code!=='idempotency_payload_mismatch'){
        delete progress.pending;save();if(command.action==='startRegistration'){progress=null;currentView=null;clearEmailProgress();}else try{await read();}catch{}throw error;
      }
      try{await accept(await originalReceipt(),command);return;}catch(receiptError){if(receiptError.code==='operation_mismatch')throw receiptError;if(receiptError.code==='email_code_invalid'){delete progress.pending;save();throw receiptError;}}
      progress.pending.uncertain=true;save();
      try{await read();}catch{}
      throw error;
    }
  }
  async function continuePending(){
    if(!progress?.pending)return;const command=progress.pending;
    try{const result=await originalReceipt();await accept(result,command);return;}
    catch(error){if(error.code==='operation_mismatch')throw error;if(error.code==='email_code_invalid'){delete progress.pending;save();throw error;}if(error.status!==404&&!(command.action.startsWith('start')&&error.status===401)){throw error;}}
    if(finalActions.includes(command.action)&&!$('#email-password').reportValidity()){inform('原进度已保存，请重新输入上次使用的密码，再继续。','pending');hooks.focus('#email-password');return;}
    if(command.action.startsWith('verify')&&!/^[0-9]{8}$/.test($('#email-code').value.trim())){inform('请重新输入本次验证码；会先核对原验证结果，不会重复消费已成功的验证码。','pending');hooks.focus('#email-code');return;}
    await submit();
  }
  async function refresh(){await run(async()=>{if(progress?.pending)await continuePending();else if(progress)await read();});}
  function clear(){generation++;progress=null;currentView=null;viewFromRead=false;active=false;storageError=null;backupDownloaded=false;proposedTarget=null;clearEmailProgress();node.hidden=true;$('#email-password').value='';$('#email-password-confirm').value='';$('#email-code').value='';}
  async function finish(event){event.preventDefault();if(!progress||(!finalActions.includes(progress.pending?.action)&&currentView?.status!=='email_proved'))return;if(!$('#email-password').reportValidity())return;
    if(!registration()&&$('#email-password').value!==$('#email-password-confirm').value){inform('两次新密码不一致，请重新确认。','error');hooks.focus('#email-password-confirm');return;}
    await run(async()=>{if(progress.pending)await continuePending();else await issue(registration()?(progress.target?'completeSetup':'registerOwner'):'recoverByEmail');});
  }
  $('#email-start').addEventListener('click',startRegistration);
  $('#email-send').addEventListener('click',()=>run(async()=>{if(!progress||pending())return;await read();if(currentView.status!=='pending_email')return;if(['queued','unknown'].includes(currentView.deliveryStatus)&&!canRenewChallenge()){inform('上一封邮件尚未确认，请继续确认原投递结果。','pending');return;}await issue(registration()?'sendRegistrationCode':'sendRecoveryCode');}));
  $('#email-verify').addEventListener('click',()=>run(async()=>{if(!/^[0-9]{8}$/.test($('#email-code').value.trim())){inform('请输入邮件中的 8 位数字验证码。','error');return;}if(pending())await continuePending();else await issue(registration()?'verifyRegistrationEmail':'verifyRecoveryEmail');}));
  $('#email-refresh').addEventListener('click',refresh);$('#email-continue').addEventListener('click',refresh);$('#email-form').addEventListener('submit',finish);
  $('#email-retry-start').addEventListener('click',()=>run(async()=>{if(progress&&!pending()&&!progress.started)await issue(registration()?'startRegistration':'startEmailRecovery');}));
  $('#email-delivery-retry').addEventListener('click',()=>run(async()=>{if(!progress||pending()||!progress.sendOperationId)return;await read();if(canRenewChallenge()){inform('上一验证码已过期。请点击“重新发送新验证码”继续；旧邮件投递状态仍以当前显示为准。');return;}if(['queued','unknown'].includes(currentView.deliveryStatus))await issue(registration()?'sendRegistrationCode':'sendRecoveryCode');}));
  $('#email-cancel').addEventListener('click',()=>run(async()=>{if(!pending()&&registration())await issue('cancelRegistration');}));
  $('#email-back').addEventListener('click',()=>{if(localBusy||pending())return;active=false;node.hidden=true;hooks.back();});
  $('#email-restart').addEventListener('click',()=>{if(localBusy||pending())return;const reg=registration(),target=progress?.target;clear();if(reg)openRegistration(target);else hooks.back();});
  $('#email-login').addEventListener('click',()=>{if(currentView?.status!=='completed')return;const ownerId=progress.ownerId;clear();hooks.loginAfterRecovery(ownerId);});
  $('#email-backup-download').addEventListener('click',()=>{if(!progress||pending()||currentView?.status!=='email_proved')return;
    try{progress.sessionToken??=credential('session');progress.recoveryToken??=credential('recovery');save();downloadPrivate('connet-owner-recovery.private.json',{format:'connet-owner-v2',origin:location.origin,ownerId:progress.ownerId,sessionToken:progress.sessionToken,recoveryToken:progress.recoveryToken});backupDownloaded=true;inform('请确认文件已保存。这份备用恢复文件在本次密码重设成功后生效。');render();}catch(error){fail(error);}
  });
  $('#email-backup-saved').addEventListener('change',()=>{if(!progress||!backupDownloaded)return;try{progress.backupSaved=$('#email-backup-saved').checked;save();controls(hooks.uiState());}catch(error){fail(error);}});
  return{openRegistration,openRecovery,controls,clear,
    get pending(){return pending();},get active(){return active;},get unfinished(){return Boolean(progress&&!progress.completed&&currentView?.status!=='completed');},
    canNavigate(){if(localBusy||pending()){inform('请先继续当前操作，确认结果后再打开新的任务。','pending');show();return false;}return true;},
    endRequest(ownerId,requestId){if(progress?.kind==='recovery'&&progress.ownerId===ownerId&&progress.requestId===requestId&&!pending())clear();},
    async resume(){if(!progress)return false;if(registration()){$('#email-username').value=progress.username;$('#email-address').value=progress.email;}show();await refresh();return true;},
  };
}
