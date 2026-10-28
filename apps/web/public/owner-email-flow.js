import {accountNotice as notice,accountMessage,accountText} from './owner-i18n.js';
import {$ as query,api,ApiError,errorMessage,isUnknown,credential,id,tokenId,stamp,downloadPrivate} from './common.js';
import {accountFields} from './owner-account.js';
import {readEmailProgress,saveEmailProgress,clearEmailProgress,emailScope} from './owner-email-state.js';

const finalActions=['registerOwner','completeSetup','recoverByEmail'];
const states=['pending_email','email_proved','completed','cancelled','expired'];
const deliveries=['unavailable','none','queued','accepted','failed','unknown','not_sent'];
const copy={
  unavailable:accountMessage("email.delivery.unavailable"),
  none:accountMessage("email.delivery.none"),queued:accountMessage("email.delivery.queued"),
  accepted:accountMessage("email.delivery.accepted"),
  failed:accountMessage("email.delivery.failed"),
  unknown:accountMessage("email.delivery.unknown"),
  not_sent:accountMessage("email.delivery.demo",{"code":"1234"}),
};
function mismatch(){throw new ApiError('operation_mismatch',400);}

export function createOwnerEmailFlow(hooks){
  const $=selector=>query(selector,hooks.root||document);
  let progress=null,currentView=null,viewFromRead=false,active=false,localBusy=false,lease=null,generation=0,storageError=null,backupDownloaded=false,proposedTarget=null;
  let capabilityMode='',capabilityRevision=0;
  try{progress=readEmailProgress();}catch(error){storageError=error;}
  const node=$('#email-view');
  const save=()=>saveEmailProgress(progress);
  const registration=()=>progress?.kind==='registration';
  const mode=()=>currentView?.verificationMode||progress?.verificationMode||(progress?'resend':capabilityMode);
  const experience=()=>mode()==='experience';
  const codeLength=()=>experience()?4:8;
  const modeMismatch=()=>currentView?.modeMismatch===true;
  const mismatchMessage=()=>registration()?accountMessage("email.mode.registrationChanged"):accountMessage("email.mode.recoveryChanged");
  const validCode=()=>new RegExp(`^[0-9]{${codeLength()}}$`).test($('#email-code').value.trim());
  const verifiedMessage=()=>experience()?(registration()?accountMessage("email.proof.experienceRegistration",{linkStatus:progress.target?accountMessage("email.proof.agentNotLinkedClause"):''}):accountMessage("email.proof.recoveryDemo")):registration()?accountMessage("email.proof.registration",{linkStatus:progress.target?accountMessage("email.proof.linkAgentClause"):''}):accountMessage("email.proof.recoveryEmail");
  async function readCapabilities(){const revision=++capabilityRevision;try{const result=await api('/capabilities');if(revision!==capabilityRevision)return;if(!['experience','resend','unavailable'].includes(result.emailMode))return;capabilityMode=result.emailMode;render();hooks.modeChanged?.();}catch{/* Current attempt state remains authoritative, even if capabilities cannot be read. */}}
  function retainMode(result){progress.verificationMode=result.verificationMode||'resend';progress.codeLength=result.codeLength??8;}
  const pending=()=>Boolean(progress?.pending);
  const editable=()=>!progress&&!storageError;
  const canRenewChallenge=()=>viewFromRead&&currentView?.status==='pending_email'&&currentView.challengeExpired===true;
  const inform=(text,tone='')=>{const output=$('#email-feedback');accountText(output,()=>(text));output.className=`notice ${tone}`;output.hidden=!text;};
  function fail(error){
    const unavailable=error.code==='email_unavailable'&&error.status===503;
    const message=unavailable?copy.unavailable:error.code==='email_mode_mismatch'?mismatchMessage():error.code==='email_code_invalid'?accountMessage("email.error.invalidCode"):error.code==='email_rate_limited'?accountMessage("email.error.rateLimited"):error.code==='email_delivery_pending'?accountMessage("email.error.deliveryPending"):error.code==='email_progress_invalid'?accountMessage("email.error.progressUnreadable"):error.code==='private_storage_unavailable'?accountMessage("email.error.storageUnavailable"):error.code==='operation_mismatch'?accountMessage("email.error.operationMismatch"):errorMessage(error);
    inform(message,isUnknown(error)&&!unavailable?'pending':'error');
  }
  function targetLabel(){return hooks.targetName(progress?.target?.agentId||progress?.agentId||proposedTarget?.agentId)||accountMessage("email.target.fallback");}
  function assertView(result){
    const p=progress;if(!p||result.attemptId!==p.attemptId||result.purpose!==(registration()?'registration':'recovery')||!states.includes(result.status)||!deliveries.includes(result.deliveryStatus)||!Number.isFinite(result.expiresAt))mismatch();
    if(result.sendOperationId!==undefined&&result.sendOperationId!==null&&(typeof result.sendOperationId!=='string'||result.sendOperationId.length<8||result.sendOperationId.length>100))mismatch();
    if((result.codeExpiresAt!==null&&(!Number.isFinite(result.codeExpiresAt)||result.codeExpiresAt<=0))||typeof result.challengeExpired!=='boolean')mismatch();
    const viewMode=result.verificationMode||'resend',length=result.codeLength??8;
    if(!['experience','resend'].includes(viewMode)||length!==(viewMode==='experience'?4:8)||(progress.verificationMode&&progress.verificationMode!==viewMode))mismatch();
    if(result.currentMode!==undefined&&(!['experience','resend','unavailable'].includes(result.currentMode)||typeof result.modeMismatch!=='boolean'||result.modeMismatch!==(result.currentMode!==viewMode)))mismatch();
    if(result.sendOperationIdRequired!==undefined&&typeof result.sendOperationIdRequired!=='boolean')mismatch();
    if((viewMode==='experience'&&['queued','accepted','failed','unknown'].includes(result.deliveryStatus))||(viewMode==='resend'&&result.deliveryStatus==='not_sent'))mismatch();
    if(registration()){if(p.target&&(result.agentId!==p.target.agentId||result.generation!==p.target.generation||result.ownerId!==p.target.ownerId))mismatch();if(!p.target&&result.agentId!==undefined)mismatch();}
    else if(result.ownerId!==p.ownerId||result.agentId!==p.agentId||result.requestId!==p.requestId)mismatch();
  }
  function assertReceipt(result,command){
    if(!result||result.operationId!==command.operationId||command.scope!==emailScope(progress)||result.attemptId!==progress.attemptId)mismatch();
    if(finalActions.includes(command.action)){
      const resultMode=result.verificationMode||'resend',expectedSource=resultMode==='experience'?'experience_code':registration()?'registration_code':'recovery_code';
      if(resultMode!==(progress.verificationMode||'resend')||(result.verificationSource!==undefined&&result.verificationSource!==expectedSource)||(resultMode==='experience'&&result.verificationSource!=='experience_code'))mismatch();
      if(result.sessionId!==tokenId(progress.sessionToken))mismatch();
      if(registration()){
        if(result.ownerId!==(progress.target?.ownerId||progress.attemptId)||result.emailVerified!==(resultMode!=='experience')||result.accountComplete!==true)mismatch();
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
    const exp=experience();
    accountText($('#email-title'),()=>(reg?(status==='email_proved'?accountMessage("registration.complete"):progress?.target||proposedTarget?accountMessage("email.title.registerAndLink"):accountMessage("registration.createAccount")):exp?accountMessage("email.title.recoveryDemo"):accountMessage("email.title.recoveryEmail")));
    accountText($('#email-intro'),()=>((exp?(reg?accountMessage("email.intro.registrationDemo"):accountMessage("email.intro.recoveryDemo")):reg?accountMessage("email.intro.registrationEmail"):accountMessage("email.intro.recoveryEmail"))+(reg&&(progress?.target||proposedTarget)?accountMessage("email.linkNextStep"):'')));
    $('#email-mode-notice').hidden=!exp&&!modeMismatch();accountText($('#email-mode-notice'),()=>(modeMismatch()?mismatchMessage():exp?accountMessage("email.mode.demoNotice",{"code":"1234"}):''));
    accountText($('#email-address-hint'),()=>(exp?accountMessage("email.address.demoHint"):accountMessage("form.emailHint")));
    accountText($('#email-code-label'),()=>(exp?accountMessage("email.code.demoLabel"):accountMessage("registration.codeLabel")));$('#email-code').maxLength=codeLength();$('#email-code').pattern=`[0-9]{${codeLength()}}`;
    accountText($('#email-code-help'),()=>(exp?accountMessage("email.code.demoHelp",{"code":"1234"}):accountMessage("email.code.hint",{digits:codeLength()})));
    accountText($('#email-verify'),()=>(exp?accountMessage("email.action.verifyDemo"):accountMessage("registration.verify")));
    $('#email-account-fields').hidden=!reg;accountText($('#email-password-label'),()=>(reg?accountMessage("auth.password"):accountMessage("form.newPassword")));
    $('#email-username').required=reg;$('#email-address').required=reg;$('#email-password-confirm').required=!reg;
    const fixedAgentId=progress?.target?.agentId||progress?.agentId||proposedTarget?.agentId;
    $('#email-target-context').hidden=!fixedAgentId;accountText($('#email-target'),()=>(accountMessage("email.target.summary",{name:targetLabel(),agentId:fixedAgentId||''})));
    $('#email-start').hidden=Boolean(progress);accountText($('#email-start'),()=>(exp||!mode()?accountMessage("email.action.continueVerification"):accountMessage("email.action.sendCode")));
    $('#email-challenge').hidden=!progress||status==='completed';
    accountText($('#email-delivery'),()=>(progress?(modeMismatch()?mismatchMessage():exp?(canRenewChallenge()?accountMessage("email.delivery.demoExpired"):accountMessage("email.delivery.demo",{"code":"1234"})):canRenewChallenge()?accountMessage("email.delivery.codeExpired"):copy[currentView?.deliveryStatus]||accountMessage("email.delivery.checking")):''));
    accountText($('#email-expiry'),()=>(currentView?accountMessage("email.expiry.summary",{time:stamp(currentView.expiresAt),resend:currentView.resendAfter>Date.now()?accountMessage("email.expiry.resend",{time:stamp(currentView.resendAfter)}):''}):''));
    $('#email-code-row').hidden=modeMismatch()||status==='email_proved'||status==='completed';
    $('#email-finish').hidden=status!=='email_proved'&&!finalActions.includes(progress?.pending?.action);
    accountText($('#email-finish'),()=>(reg?(progress?.target?accountMessage("email.action.registerAndLink",{name:targetLabel()}):accountMessage("registration.complete")):accountMessage("recoveryView.confirmReset")));
    $('#email-password-row').hidden=!reg&&status!=='email_proved'&&!finalActions.includes(progress?.pending?.action);$('#email-password-confirm-row').hidden=reg;
    accountText($('#email-proof-status'),()=>(modeMismatch()?mismatchMessage():status==='email_proved'?verifiedMessage():status==='expired'?(reg?accountMessage("email.proof.registrationExpired"):accountMessage("email.proof.recoveryExpired")):status==='cancelled'?accountMessage("email.proof.registrationCancelled"):''));
    $('#email-continue').hidden=!pending();$('#email-cancel').hidden=!progress||!reg||finalActions.includes(progress.pending?.action)||status==='completed';
    $('#email-retry-start').hidden=!progress||progress.started||pending();
    $('#email-delivery-retry').hidden=!progress?.sendOperationId||!['queued','unknown'].includes(currentView?.deliveryStatus)||pending()||canRenewChallenge();
    accountText($('#email-send'),()=>(exp?accountMessage("email.action.prepareDemoAgain"):canRenewChallenge()?accountMessage("email.action.sendNewCode"):accountMessage("registration.sendAgain")));
    $('#email-recovery-backup').hidden=reg||status!=='email_proved';
    $('#email-completed').hidden=status!=='completed'||reg;
    $('#email-form').hidden=status==='completed'&&!reg;
    accountText($('#email-back'),()=>(reg?(progress?.target||proposedTarget?accountMessage("registration.existingAccount"):accountMessage("auth.backToSignIn")):accountMessage("recoveryView.backToMethods")));
    $('#email-restart').hidden=!['expired','cancelled'].includes(status)||pending();
    controls(hooks.uiState());hooks.onView?.();
  }
  function controls({busy=false,mainPending=false}={}){
    if(!active)return;const locked=localBusy||busy||mainPending,closed=['completed','expired','cancelled'].includes(currentView?.status)||modeMismatch()||!viewFromRead;
    node.querySelectorAll('input,button').forEach(input=>input.disabled=locked);
    for(const field of ['email-username','email-address'])$(`#${field}`).disabled=locked||!editable();
    $('#email-start').disabled=locked||Boolean(progress)||Boolean(storageError);
    $('#email-code').disabled=locked||closed||Boolean(progress?.pending&&!['verifyRegistrationEmail','verifyRecoveryEmail'].includes(progress.pending.action));
    $('#email-verify').disabled=locked||!progress||!currentView?.sendOperationId||closed||currentView?.status==='email_proved'||Boolean(progress.pending&&!['verifyRegistrationEmail','verifyRecoveryEmail'].includes(progress.pending.action));
    $('#email-send').disabled=locked||!progress?.started||closed||currentView?.status==='email_proved'||Boolean(progress.pending)||(['queued','unknown'].includes(currentView?.deliveryStatus)&&!canRenewChallenge())||(currentView?.resendAfter||0)>Date.now();
    $('#email-delivery-retry').disabled=locked||closed||pending();
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
    if(progress&&(!registration()||JSON.stringify(progress.target||null)!==JSON.stringify(target))){show();inform(accountMessage("email.progress.finishBeforeOtherAgent"),'pending');return;}
    proposedTarget=target;
    if(progress){$('#email-username').value=progress.username;$('#email-address').value=progress.email;}
    show();void readCapabilities();if(progress)void refresh();else hooks.focus('#email-username');
  }
  function baseState(kind){return{format:'connet-email-progress-v1',origin:location.origin,kind,browserToken:credential('browser')};}
  async function startRegistration(){
    if(progress||storageError)return;
    let fields;try{fields=accountFields($('#email-username').value,$('#email-address').value);}catch(error){inform(error.field==='username'?accountMessage("email.validation.username"):accountMessage("email.validation.email"),'error');hooks.focus(error.field==='username'?'#email-username':'#email-address');return;}
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
    if(progress&&(registration()||progress.assistanceToken!==context.assistanceToken)){show();inform(accountMessage("email.progress.continueExisting"),'pending');return;}
    if(!progress){const state=baseState('recovery');progress={...state,attemptId:tokenId(state.browserToken),...context};try{save();}catch(error){progress=null;show();fail(error);return;}}
    show();void readCapabilities();await run(async()=>{
      save();if(!currentView)await issue('startEmailRecovery');else await read();
      if(experience()&&!modeMismatch()&&!pending()&&currentView?.status==='pending_email'&&!progress.sendOperationId)await issue('sendRecoveryCode');
    });
  }
  const basePath=()=>registration()?`/owner/registration-attempts/${encodeURIComponent(progress.attemptId)}`:`/owner/email-recovery-attempts/${encodeURIComponent(progress.attemptId)}`;
  function payload(action){
    const p=progress,operationId=p.pending.operationId;
    if(action==='startRegistration')return{operationId,attemptId:p.attemptId,browserToken:p.browserToken,username:p.username,email:p.email,...(p.target?{agentId:p.target.agentId,expectedGeneration:p.target.generation,...(p.target.handoffToken?{handoffToken:p.target.handoffToken}:{setupToken:p.target.setupToken})}:{})};
    if(action==='startEmailRecovery')return{operationId,browserToken:p.browserToken};
    if(['verifyRegistrationEmail','verifyRecoveryEmail'].includes(action))return{operationId,code:$('#email-code').value.trim(),...(p.pending.challengeBound?{sendOperationId:p.pending.challengeOperationId}:{})};
    if(finalActions.includes(action))return{operationId,...(registration()?{attemptId:p.attemptId}:{}),password:$('#email-password').value,sessionToken:p.sessionToken,...(p.recoveryToken?{recoveryToken:p.recoveryToken}:{}),...(p.target?(p.target.handoffToken?{handoffToken:p.target.handoffToken}:{setupToken:p.target.setupToken}):{})};
    return{operationId};
  }
  function path(action){return{startRegistration:'/owner/registration-attempts',startEmailRecovery:'/owner/recovery-assistance/email-attempts',sendRegistrationCode:`${basePath()}/email-challenges`,sendRecoveryCode:`${basePath()}/email-challenges`,verifyRegistrationEmail:`${basePath()}/email-verifications`,verifyRecoveryEmail:`${basePath()}/email-verifications`,cancelRegistration:`${basePath()}/cancel`,registerOwner:'/owner/accounts',completeSetup:'/owner/setup/complete',recoverByEmail:`${basePath()}/complete`}[action];}
  function authorization(action){return action==='startRegistration'?undefined:action==='startEmailRecovery'?progress.assistanceToken:progress.browserToken;}
  async function issue(action){
    if(progress.pending)throw new ApiError('idempotency_payload_mismatch',409);
    // Historical receipts do not authorize writes after a configuration switch.
    if(!action.startsWith('start')&&action!=='cancelRegistration'){await read();if(modeMismatch()){inform(mismatchMessage(),'pending');return;}}
    if(finalActions.includes(action)){progress.sessionToken??=credential('session');}
    if(action.startsWith('start'))progress.startOperationId??=id();
    const sending=['sendRegistrationCode','sendRecoveryCode'].includes(action);
    if(sending&&(canRenewChallenge()||!['queued','unknown'].includes(currentView?.deliveryStatus)))progress.sendOperationId=id();
    if(sending&&!progress.sendOperationId)throw new ApiError('email_progress_invalid',400);
    const verifying=action.startsWith('verify');
    if(verifying&&(!viewFromRead||!currentView?.sendOperationId||progress.sendOperationId!==currentView.sendOperationId))throw new ApiError('email_progress_invalid',400);
    progress.pending={action,scope:emailScope(progress),operationId:action.startsWith('start')?progress.startOperationId:sending?progress.sendOperationId:id(),...(verifying?{challengeOperationId:progress.sendOperationId,challengeBound:true}:{})};save();await submit();
  }
  async function accept(result,command){
    assertReceipt(result,command);
    if(finalActions.includes(command.action)){
      // Adoption is delegated only after the exact original target has matched.
      if(registration()){
        await hooks.registered(result,{...progress});
        clear();return;
      }
      currentView={...result,purpose:'recovery',status:'completed',codeLength:experience()?4:8,deliveryStatus:experience()?'not_sent':currentView?.deliveryStatus||'none'};
      delete progress.pending;progress.completed=true;save();$('#email-password').value='';$('#email-password-confirm').value='';$('#email-code').value='';
      hooks.recovered(result);inform(experience()?accountMessage("email.recovery.demoCompleted"):accountMessage("email.recovery.completed"),'success');render();return;
    }
    progress.started=true;
    if(command.action.startsWith('verify')){
      // A historical verification receipt cannot prove the current challenge.
      const latest=await api(basePath(),{token:progress.browserToken});assertView(latest);currentView=latest;viewFromRead=true;
      if(latest.sendOperationId!==command.challengeOperationId||latest.status!=='email_proved'){
        delete progress.pending;save();$('#email-code').value='';inform(accountMessage("email.progress.verificationChanged"),'pending');render();return;
      }
    }else{currentView=result;viewFromRead=false;}
    retainMode(currentView);
    delete progress.pending;save();$('#email-code').value='';
    if(command.action.startsWith('verify'))inform(modeMismatch()?mismatchMessage():verifiedMessage(),modeMismatch()?'pending':'');
    else if(command.action==='cancelRegistration'){clear();hooks.back();return;}
    // A start receipt recovered by originalReceipt needs the same current-state read as a fresh start.
    else if(['startRegistration','startEmailRecovery'].includes(command.action)){await read();inform(modeMismatch()?mismatchMessage():copy[currentView.deliveryStatus]||accountMessage("email.progress.saved"));}
    else if(['sendRegistrationCode','sendRecoveryCode'].includes(command.action)){await read();inform(modeMismatch()?mismatchMessage():copy[currentView.deliveryStatus]||accountMessage("email.progress.saved"));}
    else inform(copy[result.deliveryStatus]||accountMessage("email.progress.saved"));render();
  }
  async function read(){const result=await api(basePath(),{token:progress.browserToken});assertView(result);currentView=result;retainMode(result);viewFromRead=true;progress.started=true;if(!progress.pending&&result.sendOperationId)progress.sendOperationId=result.sendOperationId;if(!pending()&&!registration()&&result.status==='completed')progress.completed=true;save();render();return result;}
  async function originalReceipt(){const p=progress.pending;return api(`/operations/${encodeURIComponent(p.operationId)}?scope=${encodeURIComponent(p.scope)}&action=${encodeURIComponent(p.action)}`,{token:progress.browserToken});}
  async function acceptOriginalReceipt(result,command){
    try{await accept(result,command);}
    catch(error){if(error.code==='email_code_invalid'){delete progress.pending;save();}throw error;}
  }
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
        if(command.uncertain){
          let receipt;try{receipt=await originalReceipt();}catch(receiptError){if(receiptError.status!==404)throw receiptError;}
          if(receipt!==undefined){await acceptOriginalReceipt(receipt,command);return;}
        }
        delete progress.pending;save();throw error;
      }
      if(!isUnknown(error)&&!command.uncertain&&error.code!=='idempotency_payload_mismatch'){
        delete progress.pending;save();if(command.action==='startRegistration'){progress=null;currentView=null;clearEmailProgress();}else try{await read();}catch{}throw error;
      }
      let receipt;
      try{receipt=await originalReceipt();}catch(receiptError){if(receiptError.code==='operation_mismatch')throw receiptError;if(receiptError.code==='email_code_invalid'){delete progress.pending;save();throw receiptError;}}
      // Once a receipt is found, failures in its follow-up read must not restart the command.
      if(receipt!==undefined){await acceptOriginalReceipt(receipt,command);return;}
      progress.pending.uncertain=true;save();
      try{await read();}catch{}
      throw error;
    }
  }
  async function continuePending(){
    if(!progress?.pending)return;const command=progress.pending;
    let receipt;
    try{receipt=await originalReceipt();}
    catch(error){if(error.code==='operation_mismatch')throw error;if(error.code==='email_code_invalid'){delete progress.pending;save();throw error;}if(error.status!==404&&!(command.action.startsWith('start')&&error.status===401)){throw error;}}
    if(receipt!==undefined){await acceptOriginalReceipt(receipt,command);return;}
    try{await read();if(modeMismatch()){inform(mismatchMessage(),'pending');return;}}catch(error){if(!command.action.startsWith('start')||![401,404].includes(error.status))throw error;}
    if(finalActions.includes(command.action)&&!$('#email-password').reportValidity()){inform(accountMessage("email.progress.reenterPassword"),'pending');hooks.focus('#email-password');return;}
    if(command.action.startsWith('verify')&&!validCode()){inform(accountMessage("email.code.resume",{digits:codeLength()}),'pending');hooks.focus('#email-code');return;}
    await submit();
  }
  async function refresh(){await run(async()=>{if(progress?.pending)await continuePending();else if(progress)await read();});}
  function clear(){generation++;progress=null;currentView=null;viewFromRead=false;active=false;storageError=null;backupDownloaded=false;proposedTarget=null;clearEmailProgress();node.hidden=true;$('#email-password').value='';$('#email-password-confirm').value='';$('#email-code').value='';}
  async function finish(event){event.preventDefault();if(!progress||(!finalActions.includes(progress.pending?.action)&&currentView?.status!=='email_proved'))return;if(!$('#email-password').reportValidity())return;
    if(!registration()&&$('#email-password').value!==$('#email-password-confirm').value){inform(accountMessage("email.validation.passwordMismatch"),'error');hooks.focus('#email-password-confirm');return;}
    await run(async()=>{if(progress.pending)await continuePending();else await issue(registration()?(progress.target?'completeSetup':'registerOwner'):'recoverByEmail');});
  }
  $('#email-start').addEventListener('click',startRegistration);
  $('#email-send').addEventListener('click',()=>run(async()=>{if(!progress||pending())return;await read();if(currentView.status!=='pending_email')return;if(['queued','unknown'].includes(currentView.deliveryStatus)&&!canRenewChallenge()){inform(accountMessage("email.delivery.checkOriginal"),'pending');return;}await issue(registration()?'sendRegistrationCode':'sendRecoveryCode');}));
  $('#email-verify').addEventListener('click',()=>run(async()=>{if(pending()){await continuePending();return;}await read();if(!validCode()){inform(experience()?accountMessage("email.validation.demoCode"):accountMessage("email.code.hint",{digits:codeLength()}),'error');return;}await issue(registration()?'verifyRegistrationEmail':'verifyRecoveryEmail');}));
  $('#email-refresh').addEventListener('click',refresh);$('#email-continue').addEventListener('click',refresh);$('#email-form').addEventListener('submit',finish);
  $('#email-retry-start').addEventListener('click',()=>run(async()=>{if(progress&&!pending()&&!progress.started)await issue(registration()?'startRegistration':'startEmailRecovery');}));
  $('#email-delivery-retry').addEventListener('click',()=>run(async()=>{if(!progress||pending()||!progress.sendOperationId)return;await read();if(canRenewChallenge()){inform(accountMessage("email.delivery.expiredRetry"));return;}if(['queued','unknown'].includes(currentView.deliveryStatus))await issue(registration()?'sendRegistrationCode':'sendRecoveryCode');}));
  $('#email-cancel').addEventListener('click',()=>run(async()=>{if(!pending()&&registration())await issue('cancelRegistration');}));
  $('#email-back').addEventListener('click',()=>{if(localBusy||pending())return;active=false;node.hidden=true;hooks.back();});
  $('#email-restart').addEventListener('click',()=>{if(localBusy||pending())return;const reg=registration(),target=progress?.target;clear();if(reg)openRegistration(target);else hooks.back();});
  $('#email-login').addEventListener('click',()=>{if(currentView?.status!=='completed')return;const ownerId=progress.ownerId;clear();hooks.loginAfterRecovery(ownerId);});
  $('#email-backup-download').addEventListener('click',()=>{if(!progress||pending()||currentView?.status!=='email_proved')return;
    try{progress.sessionToken??=credential('session');progress.recoveryToken??=credential('recovery');save();downloadPrivate('connet-owner-recovery.private.json',{format:'connet-owner-v2',origin:location.origin,ownerId:progress.ownerId,sessionToken:progress.sessionToken,recoveryToken:progress.recoveryToken});backupDownloaded=true;inform(accountMessage("email.backup.pendingReset"));render();}catch(error){fail(error);}
  });
  $('#email-backup-saved').addEventListener('change',()=>{if(!progress||!backupDownloaded)return;try{progress.backupSaved=$('#email-backup-saved').checked;save();controls(hooks.uiState());}catch(error){fail(error);}});
  return{openRegistration,openRecovery,controls,clear,readCapabilities,get verificationMode(){return mode();},
    get target(){if(!active||progress?.completed)return null;const target=progress?.target||proposedTarget;if(target)return{agentId:target.agentId};return progress?.kind==='recovery'?{agentId:progress.agentId,recovery:true}:null;},
    get pending(){return pending();},get active(){return active;},get unfinished(){return Boolean(progress&&!progress.completed&&currentView?.status!=='completed');},
    canNavigate(){if(localBusy||pending()){inform(accountMessage("email.progress.confirmBeforeNavigation"),'pending');show();return false;}return true;},
    endRequest(ownerId,requestId){if(progress?.kind==='recovery'&&progress.ownerId===ownerId&&progress.requestId===requestId&&!pending())clear();},
    async resume(){if(!progress)return false;if(registration()){$('#email-username').value=progress.username;$('#email-address').value=progress.email;}show();await refresh();return true;},
  };
}
