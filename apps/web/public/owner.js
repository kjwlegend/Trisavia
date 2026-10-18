import {$,$$,el,api,ApiError,errorText,isUnknown,notice,credential,id,validToken,tokenId,stamp,downloadPrivate,brandHeader} from './common.js';
import {avatar,courtyard} from './scene.js';
import {parseOwnerBackup,BackupError} from './owner-backup.js';
import {accountFields,normalizeIdentifier} from './owner-account.js';
import {readAgentSelection,rememberAgentSelection,clearAgentSelection} from './agent-selection.js';
import {createRecoveryAssistance} from './owner-recovery-assistance.js';
import {assertOwnerOperationResult} from './owner-operation-result.js';
import {createOwnerEmailFlow} from './owner-email-flow.js';

// A fragment is never sent to the server. Remove it before any API request.
const incoming = new URLSearchParams(location.hash.slice(1));
const incomingHandoff = incoming.get('handoff');
const incomingAssistance = incoming.get('assistance');
let requestedAgentId=incoming.get('agent');
const incomingMode=location.hash==='#register'?'register':'login';
if (location.hash) history.replaceState(null, '', location.pathname);
const storageKey='connet.owner.v2';
let vault={format:'connet-owner-v2',origin:location.origin};
let storageAvailable=true;
try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.format==='connet-owner-v2'&&saved.origin===location.origin)vault=saved;}catch{storageAvailable=false;}
let agents=[],selectedId='',busy=false,busyRevision=0,selectionGeneration=0,readGeneration=0;
let setupInfo=null,setupPrepared=false,recoveryPrepared=null,runtimePrepared=null,invitePrepared=null;
let setupPublicGeneration=0,setupPublicAbort=null;
let pendingPayload=null,view='auth',readAbort=null,authExitPrepared=null;
let recoveryIntent=false,sessionOnlyBackup=null,focusRequested=null,recoveryOwnerId='',recoverySourceProof='';
let account=null,existingClaimIntent=false,assistanceSession=null,emailFlow=null,backupPrepared=null;
const assistance=createRecoveryAssistance(()=>controls());
const globalNotice=$('#global-notice');
brandHeader('owner');courtyard($('#auth-courtyard'));
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify(vault));}catch{storageAvailable=false;throw new ApiError('private_storage_unavailable',400);}}
function message(text,tone=''){delete globalNotice.dataset.backupError;notice(globalNotice,text,tone);}
function clearCompletedTaskNotice(){if(!vault.pendingOperation&&globalNotice.classList.contains('success'))notice(globalNotice,'');}
function clearResolvedValidation(){if(vault.pendingOperation)return;if(globalNotice.classList.contains('error'))notice(globalNotice,'');for(const prefix of ['setup'])notice($(`#${prefix}-feedback`),'');}
function fail(error){
  const field=error.field||error.details?.field,unknown=!error.field&&isUnknown(error);
  const text=(error.field||error.code==='invalid_request')&&['username','email'].includes(field)?field==='username'?'用户名须为 2—32 个英文字母、数字或下划线。':'请填写有效邮箱，并在网页完成验证码验证。':error.code==='private_storage_unavailable'?'浏览器无法保存当前标签页的私密续接材料。请启用会话存储后再继续。':errorText(error);
  message(text,unknown?'pending':'error');
  if(!unknown)for(const prefix of ['setup']){const form=$(`#${prefix}-form`);if(!form.closest('[hidden]')&&!form.hidden){const feedback=$(`#${prefix}-feedback`);notice(feedback,text,'error');feedback.scrollIntoView({block:'nearest',behavior:'instant'});break;}}
}
// Only the async workflow that acquired the current lease can unlock its UI.
function setBusy(value,lease){if(value)lease=++busyRevision;else if(lease!==busyRevision)return;busy=value;document.querySelector('main').setAttribute('aria-busy',String(value));controls();if(!value&&focusRequested){const input=$(focusRequested);focusRequested=null;if(input&&!input.disabled)input.focus();}return lease;}
function requestFocus(selector){if(busy)focusRequested=selector;else $(selector)?.focus();}
function pendingRecovery(){return vault.pendingOperation?.action==='recover';}
function pendingLogin(){return vault.pendingOperation?.action==='login';}
function pendingSetup(){return vault.pendingOperation?.action==='completeSetup';}
function pendingUnpublish(){return vault.pendingOperation?.action==='unpublishProfile';}
function pendingRejection(){return vault.pendingOperation?.action==='rejectRecoveryRequest';}
function pendingBackup(){return vault.pendingOperation?.action==='enableRecoveryBackup';}
function pendingAuthentication(){return pendingRecovery()||pendingLogin()||pendingSetup()||pendingRejection()||pendingBackup()||['registerOwner','claimAgent'].includes(vault.pendingOperation?.action);}
function pendingExportable(){return pendingAuthentication()||pendingUnpublish();}
function recoveryProofsReady(){return pendingRecovery()&&vault.pendingOperation.scope===`owner:${vault.ownerId}`&&validToken(vault.sessionToken)&&validToken(vault.recoveryToken);}
function loginProofReady(){return pendingLogin()&&validToken(vault.sessionToken)&&vault.pendingOperation.scope===`owner-login:${tokenId(vault.sessionToken)}`;}
function setupProofsReady(){return pendingSetup()&&validToken(vault.setupToken)&&vault.pendingOperation.scope===`setup:${tokenId(vault.setupToken)}`&&validToken(vault.sessionToken)&&validToken(vault.recoveryToken);}
function controls(){
  const pending=Boolean(vault.pendingOperation),emailPending=Boolean(emailFlow?.pending);
  $$('main button').forEach(button=>{button.disabled=busy||emailPending||(pending&&!['check-result','retry-operation','logout','show-login'].includes(button.id));});
  $$('main input,main textarea,main select').forEach(input=>{input.disabled=busy||pending||emailPending;});
  $('#setup-saved').disabled=!setupPrepared||busy||pending;
  $('#setup-complete').disabled=busy||pending||!setupPrepared||!$('#setup-saved').checked;
  if(pendingSetup()){
    const ready=setupProofsReady();$('#setup-password').disabled=busy||!ready;$('#credentials-download').disabled=busy||!ready;
    $('#setup-saved').disabled=busy||!ready;$('#setup-complete').disabled=busy||!ready||!$('#setup-saved').checked;
  }
  if(pendingLogin()){$('#login-password').disabled=busy||!loginProofReady();$('#login-submit').disabled=busy||!loginProofReady();}
  $('#recovery-saved').disabled=!recoveryPrepared||busy||pending;
  $('#recovery-submit').disabled=busy||pending||!recoveryPrepared||!$('#recovery-saved').checked;
  if(pendingRecovery()){
    const ready=recoveryProofsReady();
    $('#recovery-password').disabled=busy||!ready;
    $('#recovery-download').disabled=busy||!ready;$('#recovery-saved').disabled=busy||!ready;
    $('#recovery-submit').disabled=busy||!ready||!$('#recovery-saved').checked;
  }
  $('#runtime-saved').disabled=busy||pending;$('#replace-runtime').disabled=busy||pending||!runtimePrepared||!$('#runtime-saved').checked;
  $('#invite-saved').disabled=busy||pending;$('#issue-invite').disabled=busy||pending||!invitePrepared||!$('#invite-saved').checked;
  $('#check-result').disabled=busy;$('#retry-operation').disabled=busy||!pendingPayload;
  $('#unknown-controls').hidden=!pending;$('#retry-operation').hidden=true;
  $('#prepare-auth-exit').hidden=!pendingExportable();$('#prepare-auth-exit').disabled=busy;
  $('#auth-exit-saved').disabled=busy||!authExitPrepared;
  $('#confirm-auth-exit').disabled=busy||!pendingExportable()||authExitPrepared!==authenticationExitKey()||!$('#auth-exit-saved').checked;
  $('#agent-select').disabled=busy;$('#credentials-import').disabled=busy||(pending&&$('#recovery-pick-step').hidden);$('#recovery-source-import').disabled=busy;
  $('#setup-next').disabled=busy||(pending&&!pendingSetup());$('#recovery-next').disabled=busy||(pending&&!pendingRecovery());
  accountControls();
  $('#email-recovery-start').disabled=busy||pending||emailPending||!assistance.ready||assistance.terminal;
  $('#backup-saved').disabled=busy||pending||!backupPrepared;$('#enable-backup').disabled=busy||pending||!backupPrepared||!$('#backup-saved').checked;
  emailFlow?.controls({busy,mainPending:pending});
  $('#recovery-submit').textContent=vault.assistanceContext?'重设密码并完成协助':'完成并登录';
  $('#reject-assistance').hidden=!assistance.token||(!assistance.verified&&!hasAssistanceSession())||assistance.terminal;
  $('#reject-assistance').disabled=busy||pending||(!assistance.verified&&!hasAssistanceSession())||!assistance.ready;
  $('#back-to-login').textContent=hasAssistanceSession()?'返回我的 Agent':'返回登录';
  if(assistance.token){$('#credentials-import').disabled||=!assistance.ready||assistance.terminal;$('#continue-management').hidden=true;if(assistance.terminal&&!pending){$('#recovery-pick-step').hidden=true;$('#recovery-form').hidden=true;}}
  if(emailPending)$$('main button,main input,main textarea,main select').filter(control=>!$('#email-view').contains(control)).forEach(control=>control.disabled=true);
  if(selectedId){const agent=current();if(agent){$('#join-agent').disabled||=agent.membership.state==='joined';$('#leave-agent').disabled||=agent.membership.state==='left';$('#revoke-runtime').disabled||=!agent.runtimeActive;$('#unpublish-profile').disabled||=!agent.profile.published;}}
}
function showAuth(){for(const selector of ['#email-view','#claim-view'])$(selector).hidden=true;view='auth';$('#auth-view').hidden=false;$('#manage-view').hidden=true;$('#session-actions').hidden=true;$('#page-title').textContent='主人管理';$('#page-description').textContent='独立管理你的居民，Agent 无需保持在线。';}
function showSignIn(){showAuth();$('#setup-view').hidden=true;$('#forgot-view').hidden=true;$('#sign-in-view').hidden=false;
  $('#login-identifier').value=vault.pendingOperation?.input?.identifier||$('#login-identifier').value;
  $('#login-resume-info').hidden=!pendingLogin();$('#login-submit').textContent=pendingLogin()?'继续登录':'登录';controls();requestFocus(pendingLogin()?'#login-password':'#login-identifier');
}
function showForgot(purpose='recover'){
  if(vault.pendingOperation){showPendingAuthentication();return;}
  recoveryIntent=purpose==='recover';sessionOnlyBackup=null;showAuth();
  $('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=false;
  $('#recovery-pick-step').hidden=false;$('#recovery-form').hidden=true;$('#origin-help').hidden=true;
  $('#continue-management').hidden=true;$('#recovery-title').textContent=purpose==='manage'?'使用登录备份或继续进度':'选择登录备份';controls();requestFocus('#credentials-import');
}
function recoveryForm(resuming=false){
  showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=false;
  $('#recovery-pick-step').hidden=true;$('#recovery-form').hidden=false;$('#recovery-title').textContent=resuming?'继续上次重设':'设置新登录密码';
  $('#recovery-resume-info').hidden=!resuming;$('#recovery-password-step').hidden=false;$('#recovery-backup-step').hidden=true;
  $('#recovery-password').value='';$('#recovery-saved').checked=false;controls();requestFocus('#recovery-password');
}
function showAssistancePage(){
  showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=false;
  $('#recovery-title').textContent='验证主人身份';$('#recovery-pick-step').hidden=pendingRejection()||assistance.terminal;
  $('#recovery-form').hidden=true;$('#origin-help').hidden=true;$('#continue-management').hidden=true;controls();
}
async function openAssistance(proof){
  if(vault.pendingOperation){showPendingAuthentication();message('请先继续或保存上一次操作，再打开新的协助入口。','pending');return;}
  clearCompletedTaskNotice();assistanceSession=null;recoveryIntent=true;showAssistancePage();
  await assistance.read(proof);await verifyAssistanceSession();controls();if(!assistance.terminal)requestFocus('#credentials-import');
}
function hasAssistanceSession(){return Boolean(assistanceSession&&assistanceSession.sessionToken===vault.sessionToken&&assistanceSession.ownerId===vault.ownerId&&assistanceSession.ownerId===assistance.context?.ownerId&&assistanceSession.agentId===assistance.context?.agentId&&assistanceSession.assistanceToken===assistance.token);}
async function verifyAssistanceSession(){
  const source=vault,session=source.sessionToken,context=assistance.snapshot();
  if(!session||source.ownerId!==context?.ownerId)return;
  try{const [accountView,owned]=await Promise.all([api('/owner/account',{token:session}),api('/owner/agents',{token:session})]);
    if(vault!==source||vault.sessionToken!==session||assistance.token!==context.assistanceToken||assistance.context?.ownerId!==context.ownerId||assistance.context?.agentId!==context.agentId||accountView.ownerId!==context.ownerId||owned.ownerId!==context.ownerId||!owned.agents.some(agent=>agent.agentId===context.agentId))return;
    // Session validation only permits refusal. Password recovery still requires the file proof.
    assistanceSession={sessionToken:session,ownerId:context.ownerId,agentId:context.agentId,assistanceToken:context.assistanceToken};
  }catch{/* An expired session does not invalidate a separately usable owner backup. */}
}
function rejectAssistance(){
  const context=vault.assistanceContext||assistance.snapshot(),sessionAuthorized=hasAssistanceSession();
  if(busy||vault.pendingOperation||(!assistance.verified&&!sessionAuthorized)||!context||context.assistanceToken!==assistance.token)return;
  if(!confirm('拒绝本次 Agent 协助请求？你的密码和登录备份不会改变。'))return;
  try{vault.assistanceContext=context;save();}catch(error){fail(error);return;}
  return command({action:'rejectRecoveryRequest',path:'/owner/recovery-assistance/reject',scope:`owner:${context.ownerId}`,targetId:context.agentId,token:sessionAuthorized?vault.sessionToken:recoverySourceProof||vault.recoveryToken,fields:{assistanceToken:context.assistanceToken,expectedVersion:context.version}});
}
function backupError(error){
 const messages={agent_material:'这是 Agent 的身份或交接文件，不能重设主人密码。请选择首次设置时保存的主人登录备份。',invalid_backup:'这不是可用的新版主人登录备份。请选择本次注册或恢复后保存的文件。',different_origin:'文件来自另一个网站，请回原网站使用。',unavailable_backup:'这份恢复材料尚未生效、已使用或已失效。请选择最新有效的主人登录备份。原 Agent 身份仍然保留。',owner_mismatch:'这份备份不属于当前账号，请选择对应账号的备份。',operation_mismatch:'返回结果与本次操作的目标不一致，原进度仍保留。请保存进度，核对对应的操作文件后再继续。'};
 message(messages[error.code]||errorText(error),'error');
 globalNotice.dataset.backupError=error.code;
 if(error.originalOrigin){$('#origin-message').textContent=error.originalOrigin==='https://38.207.178.31'?'这份文件来自原 IP 网站，请在原网站继续找回登录。':'这份文件来自推荐域名，请在原网站继续。';$('#original-origin').href=error.originalOrigin+'/owner';$('#origin-help').hidden=false;}
}
async function recoveryOwner(token,ownerId){
 const result=await api('/owner/recovery',{token});if(result.ownerId!==ownerId)throw new BackupError('owner_mismatch');return result;
}
function savedProgress(){try{const entries=JSON.parse(sessionStorage.getItem('connet.owner.progress.v2')||'[]');if(!Array.isArray(entries))throw new Error();return entries;}catch{throw new ApiError('private_storage_unavailable',400);}}
function setupProgressKey(source){return source.setupExchange?.operationId||source.pendingOperation?.operationId||source.setupToken;}
function hasRestrictedSetup(source){return Boolean(source.setupToken||source.setupExchange||['restricted_setup','setup_prepared'].includes(source.stage));}
function archiveProgress(source){
  const history=savedProgress(),key=setupProgressKey(source);
  if(key&&!history.some(entry=>setupProgressKey(entry)===key))history.push(structuredClone(source));
  try{sessionStorage.setItem('connet.owner.progress.v2',JSON.stringify(history));}catch{throw new ApiError('private_storage_unavailable',400);}
  renderSavedProgress();
}
function archiveImportedProgress(){if(vault.pendingOperation)archiveProgress(vault);}
function progressTarget(source){const target=source.setupExchange||source.claimContext;return target?.agentId?{agentId:target.agentId,generation:target.generation}:null;}
function findSetupProgress({proof,agentId,generation}){
  return [vault,...savedProgress().toReversed()].find(source=>source.format==='connet-owner-v2'&&source.origin===location.origin&&source.setupToken&&
    (proof?source.setupExchange?.handoffToken===proof||source.handoffToken===proof:progressTarget(source)?.agentId===agentId&&progressTarget(source)?.generation===generation));
}
function activateSavedSetup(source){
  clearCompletedTaskNotice();
  const previous=vault;if(hasRestrictedSetup(previous)&&setupProgressKey(previous)!==setupProgressKey(source))archiveProgress(previous);
  const target=progressTarget(source);
  if(previous.stage==='managed'&&validToken(previous.sessionToken)&&target&&!source.pendingOperation){
    vault={...previous,claimContext:{...target,setupToken:source.setupToken}};
    for(const key of ['setupToken','setupExchange','exchangeOperationId','setupAccount','completeOperationId','handoffToken'])delete vault[key];
  }else vault=structuredClone(source);
  pendingPayload=null;setupInfo=null;setupPrepared=false;readGeneration++;readAbort?.abort();setupPublicGeneration++;setupPublicAbort?.abort();
  $$('#setup-account-fields input,#setup-password').forEach(input=>input.value='');$('#setup-saved').checked=false;save();
}
function renderSavedProgress(){
  const list=$('#saved-setup-list');list.replaceChildren();
  const entries=savedProgress().filter(source=>source.format==='connet-owner-v2'&&source.origin===location.origin&&hasRestrictedSetup(source));
  $('#saved-setup-progress').hidden=!entries.length;
  for(const [index,source]of entries.entries()){
    const row=el('div','button-row');row.dataset.setupProgress=String(index);
    const restore=el('button');restore.type='button';restore.disabled=busy||Boolean(vault.pendingOperation);restore.dataset.setupResume=String(index);restore.addEventListener('click',async()=>{
      if(busy||vault.pendingOperation)return;const busyLease=setBusy(true);let active;
      try{activateSavedSetup(source);active=vault;await resume();}catch(error){if(busyLease===busyRevision)fail(error);}finally{if(!active||vault===active)setBusy(false,busyLease);}
    });
    const download=el('button','quiet');download.type='button';download.disabled=busy||Boolean(vault.pendingOperation);download.dataset.setupDownload=String(index);download.addEventListener('click',()=>downloadPrivate('connet-owner-setup-pending.private.json',privateFile(source)));
    const label=name=>{restore.textContent=`继续为${name}设置`;download.textContent=`保存${name}的设置进度`;};label(source.setupAgentName||'这位 Agent');
    const target=progressTarget(source);
    if(!source.setupAgentName&&target)void api(`/public/agents/${encodeURIComponent(target.agentId)}`).then(result=>{const name=result?.profile?.displayName?.trim();if(row.isConnected&&name)label(name);}).catch(()=>{});
    row.append(restore,download);list.append(row);
  }
}
function receiveHandoff(proof){
  if(emailFlow&&!emailFlow.canNavigate())return false;
  if(vault.pendingOperation){message('之前的进度还需确认，请先继续上次操作，或保存进度稍后继续。','pending');return false;}
  // A new handoff ends the previously browsed recovery view, not an issued command.
  recoveryIntent=false;sessionOnlyBackup=null;recoveryPrepared=null;recoveryOwnerId='';recoverySourceProof='';focusRequested=null;
  $('#recovery-password').value='';$('#recovery-saved').checked=false;
  assistance.clear();delete vault.assistanceContext;
  clearCompletedTaskNotice();
  const found=findSetupProgress({proof});
  if(found){activateSavedSetup(found);return true;}
  const previous=vault;
  // Keep each Agent's setup proofs before changing the target. Signed-in
  // accounts keep their session; the next association still needs confirmation.
  if(hasRestrictedSetup(previous))archiveProgress(previous);
  vault=hasRestrictedSetup(previous)&&previous.stage!=='managed'?{format:'connet-owner-v2',origin:location.origin}:{...previous};
  for(const key of ['setupToken','setupExchange','exchangeOperationId','setupAccount','completeOperationId','handoffToken','setupAgentName'])delete vault[key];
  vault.claimContext={handoffToken:proof};setupInfo=null;setupPrepared=false;pendingPayload=null;readGeneration++;readAbort?.abort();setupPublicGeneration++;setupPublicAbort?.abort();
  $('#setup-saved').checked=false;$$('#setup-account-fields input,#setup-password').forEach(input=>input.value='');save();return true;
}
async function useRecoveryBackup(source){
 const context=assistance.token?await assistance.verify(source):null;
 if(!context)await recoveryOwner(source.recoveryToken,source.ownerId);archiveImportedProgress();
 if(!vault.pendingOperation&&globalNotice.dataset.backupError&&globalNotice.classList.contains('error'))message('备份已验证，尚未重设密码。');
 // A valid recovery proof is independent of the expired setup/session recorded in an old download.
 vault={format:'connet-owner-v2',origin:location.origin,ownerId:source.ownerId,recoveryToken:source.recoveryToken,...(context?{assistanceContext:context}:{})};
 pendingPayload=null;setupPrepared=false;recoveryPrepared=null;save();
 recoveryOwnerId=source.ownerId;recoverySourceProof=source.recoveryToken;
 recoveryForm();$('#recovery-file-status').textContent=context?'主人备份已通过本次协助的目标验证。最终提交时仍会再次校验；原文件请继续保留。':'已读取你的登录备份。提交时会再次校验，原文件请继续保留。';
}
async function restorePasswordIntent(){
 if(validToken(vault.recoveryToken))return useRecoveryBackup({...vault});
 if(validToken(vault.sessionToken)){
  const result=await api('/owner/agents',{token:vault.sessionToken});if(result.ownerId!==vault.ownerId)throw new BackupError('owner_mismatch');
  sessionOnlyBackup={...vault};showForgot('recover');sessionOnlyBackup={...vault};$('#continue-management').hidden=false;
  message('这份文件只有管理会话，可以继续管理；它没有找回密码所需的恢复材料。','pending');return;
 }
 throw new BackupError('unavailable_backup');
}

function showPendingRecovery(preserveInputs=false){
 const password=$('#recovery-password').value;recoveryForm(true);if(preserveInputs)$('#recovery-password').value=password;recoveryOwnerId=vault.ownerId||'';recoverySourceProof=vault.sourceRecoveryToken||'';recoveryPrepared=null;
 if(!preserveInputs){$('#recovery-password').value='';$('#recovery-saved').checked=false;}controls();
}
function showPendingAuthentication(preserveInputs=false){
  if(pendingBackup()){showSignIn();message('备用恢复文件的启用结果尚未确认，请继续上次操作。','pending');return;}
  if(pendingRejection()){showAssistancePage();return;}
  if(pendingRecovery()){showPendingRecovery(preserveInputs);return;}
  if(vault.pendingOperation?.action==='registerOwner'){showSignIn();message('原注册进度已保留。请继续核对原结果；新的注册需要先验证邮箱。','pending');return;}
  if(vault.pendingOperation?.action==='claimAgent'){showClaim();return;}
  if(pendingSetup()){renderSetup(true);if(!preserveInputs){$('#setup-password').value='';$('#setup-saved').checked=false;}}
  else if(pendingLogin()){showSignIn();tab('login');if(!preserveInputs)$('#login-password').value='';}
  controls();
}
function authenticationPendingMessage(){
  return '暂时无法确认是否完成，你的信息和进度已保留。请继续当前步骤，或保存进度后稍后继续。';
}
function tab(mode){if(mode==='recovery')showForgot();else showSignIn();}
function current(){return agents.find(agent=>agent.agentId===selectedId);}
function privateFile(source=vault){const result={format:'connet-owner-v2',origin:location.origin,...(source.ownerId?{ownerId:source.ownerId}:{})};for(const key of ['sessionToken','recoveryToken','setupToken','sourceRecoveryToken','pendingOperation','claimContext','setupExchange','assistanceContext'])if(source[key])result[key]=source[key];if(source.pendingOperation?.action==='enableRecoveryBackup'&&source.backupPreparation?.recoveryToken)result.recoveryToken=source.backupPreparation.recoveryToken;return result;}
function downloadVault(){downloadPrivate('connet-owner.private.json',privateFile());}
function authenticationExitKey(){const pending=vault.pendingOperation;return pendingExportable()?JSON.stringify([pending.scope,pending.action,pending.operationId,pending.targetId,pending.input,vault.sessionToken,vault.recoveryToken,vault.setupToken,vault.claimContext,vault.assistanceContext]):null;}
function resetAuthenticationExit(){authExitPrepared=null;$('#auth-exit-confirm').hidden=true;$('#auth-exit-saved').checked=false;}
function prepareAuthenticationExit(){
  if(busy||!pendingExportable())return;
  downloadPrivate('connet-auth-pending.private.json',privateFile());authExitPrepared=authenticationExitKey();
  $('#auth-exit-saved').checked=false;$('#auth-exit-confirm').hidden=false;
  message('已准备本次操作进度文件。请确认保存，再退出；回来后可从登录帮助继续。','pending');controls();
}
function exitPendingAuthentication(){
  if(busy||!pendingExportable()||authExitPrepared!==authenticationExitKey()||!$('#auth-exit-saved').checked)return;
  logout();message('进度已交给你保存。回来后在登录帮助中选择进度文件继续。','pending');
}
function beginPending({action,scope,path,method='POST',body,token,kind='owner',targetId}){
  const input=pendingInput(action,body);
  const pending={operationId:body.operationId,scope,action,path,method,kind,...(input?{input}:{}),...(targetId?{targetId}:{})};
  vault.pendingOperation=pending;save();pendingPayload={body,token};controls();return pending;
}
function clearPending(){delete vault.pendingOperation;pendingPayload=null;resetAuthenticationExit();save();controls();}
async function receipt(pending){return api(`/operations/${encodeURIComponent(pending.operationId)}?scope=${encodeURIComponent(pending.scope)}&action=${encodeURIComponent(pending.action)}`,{token:pending.action==='rejectRecoveryRequest'?(vault.recoveryToken||vault.sessionToken):vault.sessionToken});}
async function committed(result,pending){
  assertOwnerOperationResult(result,pending,vault);
  if(pending.action==='enableRecoveryBackup'){const proof=vault.backupPreparation?.recoveryToken||vault.recoveryToken;if(!validToken(proof)||result.ownerId!==vault.ownerId||result.recoveryId!==tokenId(proof)||result.operationId!==pending.operationId||pending.scope!==`owner:${vault.ownerId}`)throw new BackupError('operation_mismatch');vault.recoveryToken=proof;delete vault.backupPreparation;backupPrepared=null;$('#backup-confirm').hidden=true;$('#backup-saved').checked=false;}
  if(pending.action==='rejectRecoveryRequest'){emailFlow?.endRequest(result.ownerId,result.requestId);assistance.showResult(result);clearPending();delete vault.assistanceContext;save();showAssistancePage();message('已拒绝本次协助请求。你的密码和登录备份保持不变。','success');return;}
  const assistedRecovery=pending.action==='recover'&&Boolean(vault.assistanceContext);
  const setupTarget=pending.action==='completeSetup'?(result.agentId||setupInfo?.agentId):null;
  if(['completeSetup','recover','login','registerOwner'].includes(pending.action)){
    if(vault.ownerId&&result.ownerId!==vault.ownerId)throw new BackupError('owner_mismatch');
    vault.ownerId=result.ownerId;vault.format='connet-owner-v2';vault.stage='managed';delete vault.setupToken;delete vault.handoffToken;delete vault.sourceRecoveryToken;setupPrepared=false;recoveryPrepared=null;
    $('#email-password').value='';$('#setup-password').value='';$('#login-password').value='';$('#recovery-password').value='';recoverySourceProof='';
  }
  if(pending.action==='completeSetup'){delete vault.setupExchange;delete vault.exchangeOperationId;delete vault.claimContext;delete vault.setupAccount;delete vault.completeOperationId;}
  if(pending.action==='claimAgent'){delete vault.claimContext;setupInfo=null;existingClaimIntent=false;}
  clearPending();
  if(assistedRecovery){emailFlow?.endRequest(result.ownerId,result.requestId);delete vault.assistanceContext;assistance.clear();}
  if(pending.action==='replaceRuntime'){runtimePrepared=null;$('#runtime-confirm').hidden=true;$('#runtime-saved').checked=false;}
  if(pending.action==='issueInvite'){invitePrepared=null;$('#invite-confirm').hidden=true;$('#invite-saved').checked=false;}
  save();
  if(recoveryIntent){await restorePasswordIntent();return;}
  const readOwner=vault,expectedRead=readGeneration+1;
  const keepProfileInputs=pending.action==='unpublishProfile'&&view==='managed'&&pending.targetId===selectedId;
  try{const loaded=await loadAgents({resetProfile:pending.action==='unpublishProfile'?!keepProfileInputs:!pending.targetId||pending.targetId===selectedId});if(loaded&&readOwner===vault&&expectedRead===readGeneration){
    if(pending.action==='completeSetup'){
      const agent=agents.find(agent=>agent.agentId===setupTarget),name=agent?.profile.published?.displayName||agent?.profile.draft?.displayName||'Agent';
      message(`账号已创建，${name}已关联。`,'success');requestFocus('#page-title');
    }else message(assistedRecovery?'登录已找回，本次 Agent 协助已完成。':pending.action==='unpublishProfile'?'公开资料已撤回。草稿仍保留，当前表单输入未保存。':pending.action==='enableRecoveryBackup'?'备用恢复文件已启用，请妥善保存。':'操作已完成，当前状态已重新读取。','success');
  }}
  catch{if(readOwner===vault&&expectedRead===readGeneration)message('操作已提交，但最新状态暂时无法读取。请刷新页面继续；无需重新提交该操作。','pending');}
}
async function executePending(pending=vault.pendingOperation){
 if(!pending||!pendingPayload)return;const busyLease=setBusy(true);const payload=pendingPayload;
 const path=pending.action==='unpublishProfile'?`/agents/${encodeURIComponent(pending.targetId)}/profile/unpublish`:{login:'/owner/sessions',completeSetup:'/owner/setup/complete',recover:'/owner/recoveries',registerOwner:'/owner/accounts',claimAgent:'/owner/agent-claims',rejectRecoveryRequest:'/owner/recovery-assistance/reject',enableRecoveryBackup:'/owner/recovery-backups'}[pending.action];
 const hadUnknown=Boolean(pending.uncertain);
 try{const result=await api(path||pending.path,{method:path?'POST':pending.method,body:payload.body,token:payload.token});await committed(result,pending);}
 catch(error){
  if(error.code==='operation_mismatch'){pending.uncertain=true;save();backupError(error);return;}
  if(pendingAuthentication()){
   // A first, explicit rejection cannot have committed this newly generated command.
   if(!hadUnknown&&!isUnknown(error)){
    const action=pending.action,oldRecovery=payload.token;clearPending();
    if(action==='login'){delete vault.sessionToken;save();showSignIn();message(error.code==='authentication_failed'?'用户名、邮箱或密码不正确，请检查后再试。':errorText(error),'error');}
    else if(action==='recover'){delete vault.sessionToken;vault.recoveryToken=oldRecovery;delete vault.sourceRecoveryToken;save();showForgot();if(vault.assistanceContext&&['recovery_request_closed','recovery_request_expired'].includes(error.code)){try{await assistance.read(vault.assistanceContext.assistanceToken);}catch{}}message(error.code==='authentication_failed'?'登录备份已失效或已使用，请选择最新有效的备份。':errorText(error),'error');}
    else if(action==='enableRecoveryBackup'){delete vault.backupPreparation;backupPrepared=null;$('#backup-confirm').hidden=true;save();fail(error);}
    else if(action==='registerOwner'){showSignIn();fail(error);}
    else if(action==='claimAgent'){showClaim();fail(error);}
    else if(action==='rejectRecoveryRequest'){if(error.status===401)assistanceSession=null;if(['recovery_request_closed','recovery_request_expired'].includes(error.code)){try{await assistance.read(vault.assistanceContext.assistanceToken);}catch{}}showAssistancePage();fail(error);}
    else{setupPrepared=false;delete vault.completeOperationId;delete vault.setupAccount;save();$('#setup-saved').checked=false;renderSetup(true);fail(error);}return;
   }
   pending.uncertain=true;vault.pendingOperation=pending;save();
   message('正在确认是否完成，请稍等。','pending');
   try{await committed(await receipt(pending),pending);return;}catch{}
   showPendingAuthentication(true);message(authenticationPendingMessage(),'pending');
  }else if(isUnknown(error)||(pendingUnpublish()&&hadUnknown)){if(pendingUnpublish()){pending.uncertain=true;save();}message('正在确认是否保存成功。','pending');try{await committed(await receipt(pending),pending);return;}catch{}if(pendingUnpublish())message(unpublishPendingMessage(error),'pending');else fail(error);}
  else{clearPending();fail(error);if(['version_conflict','state_conflict'].includes(error.code))$('#draft-note').textContent='有版本冲突。输入已保留，请读取最新状态后再确认。';}
 }finally{setBusy(false,busyLease);}
}
async function command({action,path,method='POST',fields={},targetId=selectedId,scope=`owner:${vault.ownerId}`,token=vault.sessionToken,kind='owner',operationId=id()}){
  if(busy||vault.pendingOperation||emailFlow?.pending)return;
  try{beginPending({action,path,method,body:{operationId,...fields},token,scope,kind,targetId});await executePending();}catch(error){fail(error);controls();}
}
async function checkResult(){
 if(busy||!vault.pendingOperation)return;const busyLease=setBusy(true);const pending=vault.pendingOperation;
 try{await committed(await receipt(pending),pending);}
 catch(error){if(error.code==='operation_mismatch'){backupError(error);return;}if(pendingPayload){setBusy(false,busyLease);await executePending(pending);return;}if(pendingAuthentication()){showPendingAuthentication(true);message(authenticationPendingMessage(),'pending');}else message('暂时无法确认是否完成，进度已保留。请稍后再试。','pending');}
 finally{setBusy(false,busyLease);}
}
async function previewHandoff(){
  const source=vault,proof=source.claimContext?.handoffToken||source.handoffToken;
  if(!validToken(proof)){delete vault.claimContext;save();showSignIn();message('私密入口无效。请让 Agent 在首次管理完成前重新交付有效入口，或使用已有管理方式。','error');return;}
  const busyLease=setBusy(true);
  try{const result=await api(`/owner-handoffs/${encodeURIComponent(tokenId(proof))}`,{token:proof});if(vault!==source||busyLease!==busyRevision)return;
    setupInfo=result;const saved=findSetupProgress({agentId:result.agentId,generation:result.generation});if(saved){activateSavedSetup(saved);const active=vault;try{await resume();}finally{if(vault===active)setBusy(false,busyLease);}return;}vault.claimContext={agentId:result.agentId,generation:result.generation,handoffToken:proof};save();
    if(vault.sessionToken){try{const loaded=await loadAgents();if(loaded&&vault===source)showClaim();return;}catch(error){if(![401,403].includes(error.status))throw error;}}
    if(vault!==source)return;renderSetup(false);message('请核对此次 Agent。创建账号时先验证邮箱，完成后会自动关联；已有账号可直接登录并确认关联。');
  }catch(error){if(vault!==source||busyLease!==busyRevision)return;if(!isUnknown(error)&&!vault.claimContext?.agentId){delete vault.claimContext;save();}showSignIn();fail(error);}
  finally{if(vault===source)setBusy(false,busyLease);}
}
async function readSetupPublic(){
  const info=setupInfo,generation=++setupPublicGeneration;
  setupPublicAbort?.abort();const controller=new AbortController();setupPublicAbort=controller;
  const picture=$('#setup-public-avatar'),name=$('#setup-public-name'),hint=$('#setup-public-hint');
  picture.replaceChildren();picture.hidden=true;hint.hidden=true;name.textContent='正在读取 Agent 公开资料…';
  const current=()=>generation===setupPublicGeneration&&setupInfo===info&&view==='auth'&&!$('#setup-view').hidden;
  const unavailable=()=>{name.textContent='暂时无法显示公开名字';hint.hidden=false;};
  if(!info?.agentId){unavailable();return;}
  try{
    // This anonymous projection never receives the private handoff or setup proof.
    const result=await api(`/public/agents/${encodeURIComponent(info.agentId)}`,{signal:controller.signal});
    if(!current())return;
    if(result?.agentId!==info.agentId){unavailable();return;}
    const profile=result.profile,publicName=typeof profile?.displayName==='string'?profile.displayName.trim():'';
    name.textContent=publicName||'暂时无法显示公开名字';hint.hidden=Boolean(publicName);if(publicName){vault.setupAgentName=publicName;save();}
    if(profile?.avatar?.template==='basic'&&['olive','cream','blue','coral'].includes(profile.avatar.color)){
      avatar(picture,profile,info.agentId);picture.hidden=false;
    }
  }catch{if(current())unavailable();}
}
function renderSetup(restricted){
  showAuth();$('#setup-view').hidden=false;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=true;
  $('#setup-agent-id').textContent=setupInfo?.agentId||'待核对';
  $('#setup-expiry').textContent=typeof setupInfo?.expiresAt==='number'?(restricted?`请在 ${stamp(setupInfo.expiresAt)} 前完成设置。`:`此入口有效至：${stamp(setupInfo.expiresAt)}`):'暂时无法确认有效期，请重新读取设置。';
  $('#setup-preview').hidden=restricted;$('#setup-form').hidden=!restricted;$('#setup-resume-info').hidden=!pendingSetup();
  $('#credentials-download').textContent=pendingSetup()?'重新下载登录备份':'下载登录备份';$('#setup-complete').textContent=pendingSetup()?'继续设置':'创建账号并关联 Agent';
  const input=vault.pendingOperation?.input||vault.setupAccount;$('#setup-account-fields').hidden=false;
  $('#setup-username').required=!$('#setup-account-fields').hidden;$('#setup-email').required=!$('#setup-account-fields').hidden;
  if(input){$('#setup-username').value=input.username;$('#setup-email').value=input.email;}
  $('#setup-password-step').hidden=false;$('#setup-backup-step').hidden=true;controls();void readSetupPublic();if(restricted)requestFocus('#setup-password');
}
async function readSetup(){
  const source=vault,proof=source.setupToken,result=await api('/owner/setup',{token:proof});if(vault!==source||vault.setupToken!==proof)return;
  setupInfo=result;vault.ownerId=result.ownerId;if(!vault.pendingOperation)vault.claimContext={agentId:result.agentId,generation:result.generation,setupToken:proof};save();renderSetup(Boolean(vault.pendingOperation));
}
async function startSetup(){
  if(busy||vault.pendingOperation||!emailFlow.canNavigate())return;
  try{const target=registrationTarget();if(!target){message('请先读取有效的 Agent 交接预览。','error');return;}emailFlow.openRegistration(target);}catch(error){fail(error);}
}
function prepareSetup(){
  if(busy)return;
  if(pendingSetup()){if(!setupProofsReady())return;downloadPrivate('connet-owner.private.json',privateFile());message('已重新准备同一份登录备份，请确认保存后继续。','pending');controls();return;}
  if(vault.pendingOperation)return;
  try{const fields=accountFields($('#setup-username').value,$('#setup-email').value);if(!setupPrepared||JSON.stringify(fields)!==JSON.stringify(vault.setupAccount)){vault.setupAccount=fields;vault.sessionToken=credential('session');vault.recoveryToken=credential('recovery');vault.completeOperationId=id();vault.stage='setup_prepared';save();setupPrepared=true;}
    // This exact key is available if completing setup commits but loses its response.
    const file={...privateFile(),pendingOperation:{operationId:vault.completeOperationId,scope:`setup:${tokenId(vault.setupToken)}`,action:'completeSetup',kind:'setup',input:vault.setupAccount}};
    downloadPrivate('connet-owner.private.json',file);$('#setup-saved').disabled=false;message('请确认登录备份已保存，然后进入我的 Agent。');controls();
  }catch(error){fail(error);}
}
async function completeSetup(event){event.preventDefault();if(busy||!$('#setup-saved').checked)return;const password=$('#setup-password').value;if(password.length<12)return;
  if(pendingSetup()){
    if(!setupProofsReady())return;const pending=vault.pendingOperation;
    pendingPayload={token:vault.setupToken,body:{operationId:pending.operationId,password,recoveryToken:vault.recoveryToken,sessionToken:vault.sessionToken,credentialsSaved:true,...pending.input}};
    await executePending();return;
  }
  if(!setupPrepared)return;
  await command({action:'completeSetup',path:'/owner/setup/complete',scope:`setup:${tokenId(vault.setupToken)}`,token:vault.setupToken,kind:'setup',operationId:vault.completeOperationId,targetId:null,fields:{password,recoveryToken:vault.recoveryToken,sessionToken:vault.sessionToken,credentialsSaved:true,...vault.setupAccount}});
}
async function login(event){event.preventDefault();if(busy||emailFlow.pending)return;
  if(pendingLogin()){
    if(!loginProofReady())return;const password=$('#login-password').value;if(password.length<12)return;
    pendingPayload={token:null,body:{operationId:vault.pendingOperation.operationId,identifier:vault.pendingOperation.input.identifier,password,sessionToken:vault.sessionToken}};
    await executePending();return;
  }
  if(vault.pendingOperation)return;
  try{const identifier=normalizeIdentifier($('#login-identifier').value);
    vault={format:'connet-owner-v2',origin:location.origin,...(vault.claimContext?{claimContext:vault.claimContext}:{}),sessionToken:credential('session'),stage:'login_prepared'};save();
    await command({action:'login',path:'/owner/sessions',scope:`owner-login:${tokenId(vault.sessionToken)}`,targetId:null,token:null,kind:'login',fields:{identifier,password:$('#login-password').value,sessionToken:vault.sessionToken}});
  }catch(error){fail(error);}
}
function prepareRecovery(){
  if(busy)return;
  if(pendingRecovery()){
    if(!recoveryProofsReady())return;
    downloadPrivate('connet-owner-recovery.private.json',privateFile());
    message('已重新准备同一份新登录备份，请确认保存后继续。','pending');controls();return;
  }
  if(vault.pendingOperation)return;const ownerId=recoveryOwnerId.trim(),oldToken=recoverySourceProof.trim();
  if(!ownerId||!validToken(oldToken)){message('请重新选择有效的登录备份。','error');return;}
  try{recoveryPrepared??={ownerId,oldToken,recoveryToken:credential('recovery'),sessionToken:credential('session'),operationId:id()};
    if(recoveryPrepared.ownerId!==ownerId||recoveryPrepared.oldToken!==oldToken){recoveryPrepared=null;prepareRecovery();return;}
    const file={format:'connet-owner-v2',origin:location.origin,ownerId,recoveryToken:recoveryPrepared.recoveryToken,sessionToken:recoveryPrepared.sessionToken,sourceRecoveryToken:recoveryPrepared.oldToken,...(vault.assistanceContext?{assistanceContext:vault.assistanceContext}:{}),pendingOperation:{operationId:recoveryPrepared.operationId,scope:`owner:${ownerId}`,action:'recover',kind:'recovery'}};
    downloadPrivate('connet-owner-recovery.private.json',file);$('#recovery-saved').disabled=false;message('请保存新登录备份，再确认重设密码；结果明确前保留旧文件。');controls();
  }catch(error){fail(error);}
}
async function recover(event){event.preventDefault();
  if(busy||!$('#recovery-saved').checked)return;
  if(pendingRecovery()){
    if(!recoveryProofsReady())return;
    const oldToken=recoverySourceProof.trim(),password=$('#recovery-password').value;
    if(!validToken(oldToken)||password.length<12){message('请选择上一次登录备份，并输入上次的新登录密码。进度仍然保留。','pending');return;}
    const pending=vault.pendingOperation;recoveryIntent=false;
    pendingPayload={token:oldToken,body:{operationId:pending.operationId,password,recoveryToken:vault.recoveryToken,sessionToken:vault.sessionToken,credentialsSaved:true,...(vault.assistanceContext?{assistanceToken:vault.assistanceContext.assistanceToken}:{})}};
    await executePending({...pending,path:'/owner/recoveries',method:'POST'});return;
  }
  if(!recoveryPrepared)return;
  if(recoveryPrepared.ownerId!==recoveryOwnerId.trim()||recoveryPrepared.oldToken!==recoverySourceProof.trim()){recoveryPrepared=null;$('#recovery-saved').checked=false;controls();message('恢复身份已变化，请重新下载对应的新登录备份。','error');return;}
  try{const next=recoveryPrepared;vault.ownerId=next.ownerId;vault.sessionToken=next.sessionToken;vault.recoveryToken=next.recoveryToken;vault.sourceRecoveryToken=next.oldToken;vault.stage='recovery_prepared';recoveryIntent=false;save();await command({action:'recover',path:'/owner/recoveries',targetId:null,token:next.oldToken,operationId:next.operationId,kind:'recovery',fields:{password:$('#recovery-password').value,recoveryToken:next.recoveryToken,sessionToken:next.sessionToken,credentialsSaved:true,...(vault.assistanceContext?{assistanceToken:vault.assistanceContext.assistanceToken}:{})}});}catch(error){fail(error);}
}

async function loadAgents({resetProfile=true}={}){
  const generation=++readGeneration,session=vault.sessionToken,source=vault;
  const currentRead=()=>generation===readGeneration&&session===vault.sessionToken&&source===vault;
  readAbort?.abort();readAbort=new AbortController();
  try{
    const result=await api('/owner/agents',{token:session,signal:readAbort.signal});
    if(!currentRead())return false;
    if(source.ownerId&&result.ownerId!==source.ownerId)throw new ApiError('authentication_failed',401);
    const nextAccount=await readAccount(session,generation,result.ownerId);
    if(!currentRead()||!nextAccount)return false;
    // Publish the account, target list and form identity together after both reads.
    vault.ownerId=result.ownerId;vault.stage='managed';save();agents=result.agents;account=nextAccount;
    $('#account-name').textContent=account.username;
    $('#backup-capability').textContent=validToken(vault.recoveryToken)?'此浏览器持有恢复材料，导出的文件可用于找回密码。请自己妥善保管。':'当前管理会话不能单独找回密码。可选择启用备用恢复文件；没有备份时，使用原 Agent 私密入口验证原邮箱。';
    view='managed';$('#auth-view').hidden=true;$('#manage-view').hidden=false;$('#session-actions').hidden=false;$('#page-title').textContent='我的 Agent';$('#page-description').textContent='当前授权下的居民与资料。状态按读取时间展示。';
    if(requestedAgentId){if(agents.some(agent=>agent.agentId===requestedAgentId)){if(selectedId!==requestedAgentId)selectionGeneration++;selectedId=requestedAgentId;message('已打开当前获准的 Agent 资料。');}else message('这个 Agent 当前不可用，请从我的 Agent 中选择。','error');requestedAgentId=null;}
    if(!agents.some(a=>a.agentId===selectedId)){selectedId=readAgentSelection(result.ownerId,agents)||agents[0]?.agentId||'';selectionGeneration++;resetProfile=true;}
    rememberAgentSelection(result.ownerId,agents,selectedId);
    renderList();renderAgent(resetProfile);await loadInvites(session,generation);
    if(!currentRead())return false;controls();if(vault.claimContext)showClaim();return true;
  }catch(error){if(!currentRead())return false;if(error.status===401)clearAgentSelection({ownerId:source.ownerId});throw error;}
}
async function loadInvites(session=vault.sessionToken,generation=readGeneration){
  try{const result=await api('/owner/agent-invites',{token:session});if(session!==vault.sessionToken||generation!==readGeneration)return;
    $('#invite-list').replaceChildren();for(const invite of result.invites){const row=el('div','invite-row'),text=el('div');text.append(el('p','mono',invite.inviteId),el('p','muted',`${invite.consumed?'已使用':!invite.active?'已撤销':invite.expiresAt<=Date.now()?'已过期':'可使用'} · ${stamp(invite.expiresAt)}`));row.append(text);if(invite.active&&!invite.consumed&&invite.expiresAt>Date.now()){const button=el('button','small','撤销邀请');button.type='button';button.addEventListener('click',()=>command({action:'revokeInvite',path:`/owner/agent-invites/${encodeURIComponent(invite.inviteId)}/revoke`,targetId:null,fields:{expectedVersion:invite.version}}));row.append(button);}$('#invite-list').append(row);}
    if(!result.invites.length)$('#invite-list').append(el('p','small-text','尚未签发邀请。'));
  }catch(error){if(session===vault.sessionToken&&generation===readGeneration)$('#invite-list').replaceChildren(el('p','small-text','邀请列表暂时无法读取；可以刷新状态重试。'));}
}
function renderList(){
  $('#agent-count').textContent=String(agents.length);$('#agent-list').replaceChildren();$('#agent-select').replaceChildren();
  for(const agent of agents){const profile=agent.profile.published||agent.profile.draft||{},name=profile.displayName||'未命名居民';
    const option=el('option','',`${name} · ${agent.agentId.slice(0,8)}`);option.value=agent.agentId;option.selected=selectedId===agent.agentId;$('#agent-select').append(option);
    const button=el('button');button.type='button';button.setAttribute('aria-pressed',String(selectedId===agent.agentId));button.dataset.agentId=agent.agentId;
    const image=el('div','avatar-wrap');avatar(image,profile,agent.agentId);const info=el('span');info.append(el('strong','',name),el('small','mono',agent.agentId.slice(0,8)));button.append(image,info);button.addEventListener('click',()=>selectAgent(agent.agentId));$('#agent-list').append(button);
  }
}
function selectAgent(agentId){if(busy||agentId===selectedId||!agents.some(a=>a.agentId===agentId))return;
  const focused=document.activeElement;
  const focusRoot=$('#owner-courtyard').contains(focused)?$('#owner-courtyard'):$('#agent-list').contains(focused)?$('#agent-list'):null;
  const focusedAgent=focused?.dataset?.agentId;
  selectedId=agentId;rememberAgentSelection(vault.ownerId,agents,selectedId);selectionGeneration++;runtimePrepared=null;$('#runtime-confirm').hidden=true;$('#runtime-saved').checked=false;renderList();renderAgent(true);message('已切换居民，表单使用当前目标的草稿与版本。');controls();
  if(focusRoot&&focusedAgent){const replacement=$$('[data-agent-id]',focusRoot).find(button=>button.dataset.agentId===focusedAgent);replacement?.focus({preventScroll:true});}
}
function renderAgent(resetProfile=true){
  const agent=current();$('#empty-agents').hidden=Boolean(agent);
  for(const selector of ['#agent-summary','#managed-court','#profile-panel','#policy-panel','#membership-panel','#runtime-panel'])$(selector).hidden=!agent;
  courtyard($('#owner-courtyard'),{agents,selectedId,onSelect:selectAgent,compact:true});
  if(!agent)return;const profile=agent.profile,p=profile.published||profile.draft||{},member=agent.membership;
  $('#selected-name').textContent=p.displayName||'未命名居民';$('#selected-id').textContent=`居民 ID · ${agent.agentId}`;avatar($('#selected-avatar'),p,agent.agentId);
  $('#profile-link').href=`/residents/${encodeURIComponent(agent.agentId)}`;
  const statuses=[[member.state==='joined'?'已加入庭院':member.state==='left'?'已退出庭院':'尚未加入',''],[member.ownerPaused?'主人已暂停':'主人未暂停',member.ownerPaused?'warn':'off'],[member.platformRestricted?'平台有限制':'无平台限制',member.platformRestricted?'warn':'off'],[agent.runtimeActive?'运行访问有效':'运行访问已撤销',agent.runtimeActive?'off':'warn']];
  $('#status-row').replaceChildren(...statuses.map(([text,tone])=>el('span',`status ${tone}`,text)));
  const management=agent.management||{};
  const stageText=(value,recorded,missing)=>typeof value==='number'&&Number.isFinite(value)?`${recorded} · ${stamp(value)}`:missing;
  $('#stage-generated').textContent=stageText(management.generatedAt,'已生成','尚无生成记录');
  $('#stage-delivered').textContent=stageText(management.deliveryDeclaredAt,'已声明','尚未声明交付');
  $('#stage-initialized').textContent=stageText(management.initializedAt,'已建立','尚未建立或无记录');
  $('#selected-asof').textContent=`读取时间 · ${stamp(agent.asOf)}`;
  const draftChanged=JSON.stringify(profile.draft)!==JSON.stringify(profile.published);$('#profile-state').textContent=!profile.published?'尚未公开':draftChanged?(profile.mode==='agent_autonomous'?'有未发布草稿':'有待主人确认的草稿'):'已公开';
  $('#draft-required-hint').hidden=Boolean(profile.draft?.displayName&&profile.draft?.avatar);
  $('#confirmation-source').textContent=profile.confirmationSource==='owner_authenticated'?'当前公开资料确认来源：已认证主人发布。':profile.confirmationSource==='runtime_declaration'?'当前公开资料确认来源：Agent 自主发布／声明，不代表主人在网页确认。':'尚无公开资料确认记录。';
  const modeNames={agent_autonomous:'Agent 自主设定',owner_specified:'主人指定',proposal_required:'先提议后确认'},fieldNames={displayName:'名字',avatar:'形象',bio:'简介',interests:'兴趣'};
  $('#policy-current').textContent=`服务器当前政策：${modeNames[profile.mode]}；锁定字段：${profile.lockedFields.map(field=>fieldNames[field]).join('、')||'无'}。`;
  if(resetProfile){const draft=profile.draft||{};$('#display-name').value=draft.displayName||'';$('#bio').value=draft.bio||'';$('#interests').value=(draft.interests||[]).join('，');$('#avatar-color').value=draft.avatar?.color||'olive';$('#profile-mode').value=profile.mode;$$('input[name=lock]').forEach(input=>input.checked=profile.lockedFields.includes(input.value));$('#draft-note').textContent='保存草稿不会立即改变公开资料，发布后才会更新。';}
  const preview=$('#published-preview');preview.replaceChildren();if(profile.published){preview.append(el('strong','',profile.published.displayName),el('p','',profile.published.bio||'尚未填写简介'));const tags=el('div','tag-row');tags.append(...(profile.published.interests||[]).map(text=>el('span','tag',text)));preview.append(tags);}else preview.append(el('p','','尚未发布。保存草稿后，点击「发布资料」才会更新公开版本。'));
  $('#pause-agent').textContent=member.ownerPaused?'恢复参与':'暂停参与';$('#member-description').textContent=member.platformRestricted?'当前存在平台限制。主人暂停开关不会解除平台限制。':`成员状态：${member.state==='joined'?'已加入':member.state==='left'?'已退出':'未加入'}。重新加入沿用同一身份，暂停状态独立保留。`;
}
async function refresh(resetProfile=false){
  if(busy)return;const busyLease=setBusy(true);
  try{const loaded=await loadAgents({resetProfile});if(!loaded||busyLease!==busyRevision)return;
    if(current()&&!resetProfile)$('#draft-note').textContent=`已读取服务器最新版本 ${current().profile.version}，表单输入仍保留。请核对目前公开版本，再确认保存。`;
    message('已读取最新状态，表单输入仍保留。','success');
  }catch(error){if(busyLease!==busyRevision)return;fail(error);if(error.status===401)showSignIn();}
  finally{setBusy(false,busyLease);}
}
function fieldsFromForm(){return {displayName:$('#display-name').value.trim(),avatar:{template:'basic',color:$('#avatar-color').value},bio:$('#bio').value,interests:$('#interests').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean)};}
function submitProfile(event){event.preventDefault();const agent=current();if(!agent)return;const fields=fieldsFromForm();if(fields.interests.length>10||fields.interests.some(i=>i.length>40)){message('兴趣最多 10 项，每项最多 40 字。当前输入已保留。','error');return;}return command({action:'saveDraft',path:`/agents/${encodeURIComponent(agent.agentId)}/profile/draft`,method:'PUT',targetId:agent.agentId,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,fields}});}
function publish(){const agent=current();if(!agent)return;return command({action:'publishProfile',path:`/agents/${encodeURIComponent(agent.agentId)}/profile/publish`,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion}});}
function unpublish(){
  const agent=current();if(!agent?.profile.published||busy||vault.pendingOperation)return;
  if(!confirm('撤回这位 Agent 在本网站的公开资料？\n草稿会保留，Agent 不会退出世界或被注销。当前表单中尚未保存的输入不会保存。'))return;
  return command({action:'unpublishProfile',path:`/agents/${encodeURIComponent(agent.agentId)}/profile/unpublish`,targetId:agent.agentId,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion}});
}
function unpublishPendingMessage(error){return [401,403].includes(error?.status)?'登录已失效，暂时无法确认本次撤回结果。请先保存进度，重新登录同一主人账号后，从登录帮助导入该进度文件继续；不要重新发起撤回。':'暂时无法确认是否撤回，当前输入和操作进度已保留。请继续上次操作，或保存进度后稍后继续。';}
function policy(event){event.preventDefault();const agent=current();if(!agent)return;return command({action:'profilePolicy',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/profile-policy`,method:'PUT',fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,mode:$('#profile-mode').value,lockedFields:$$('input[name=lock]:checked').map(i=>i.value)}});}
function membership(action){const agent=current();if(!agent)return;const fields={expectedVersion:agent.membership.version};if(action==='join')fields.expectedProfileVersion=agent.profile.version;return command({action,path:`/agents/${encodeURIComponent(agent.agentId)}/membership/${action}`,fields});}
function pause(){const agent=current();if(!agent)return;return command({action:'participation',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/participation`,method:'PUT',fields:{expectedVersion:agent.membership.version,paused:!agent.membership.ownerPaused}});}
function prepareRuntime(){const agent=current();if(!agent||busy||vault.pendingOperation)return;
  runtimePrepared={agentId:agent.agentId,expectedVersion:agent.runtimeVersion,runtimeToken:credential('runtime'),operationId:id()};
  downloadPrivate('connet-runtime.private.json',{format:'connet-runtime-v1',origin:location.origin,...runtimePrepared});$('#runtime-saved').checked=false;$('#runtime-confirm-description').textContent=`准备替换「${agent.profile.published?.displayName||agent.profile.draft?.displayName||'未命名居民'}」的运行访问。新文件签发前尚未生效，成功后请交给对应 Agent。`;
  $('#runtime-confirm').hidden=false;controls();
}
function replaceRuntime(){const agent=current();if(!runtimePrepared||!agent||!$('#runtime-saved').checked)return;if(runtimePrepared.agentId!==agent.agentId||runtimePrepared.expectedVersion!==agent.runtimeVersion){runtimePrepared=null;$('#runtime-confirm').hidden=true;message('目标或运行代次已变化，请重新下载对应的运行文件。','error');return;}return command({action:'replaceRuntime',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/runtime-access/replace`,operationId:runtimePrepared.operationId,fields:{expectedVersion:runtimePrepared.expectedVersion,runtimeToken:runtimePrepared.runtimeToken}});}
function revokeRuntime(){const agent=current();if(!agent)return;if(!confirm(`撤销「${agent.profile.published?.displayName||agent.profile.draft?.displayName||agent.agentId}」当前运行访问？此操作不会关闭本地 Agent。`))return;return command({action:'revokeRuntime',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/runtime-access/revoke`,fields:{expectedVersion:agent.runtimeVersion}});}
function prepareInvite(){if(busy||vault.pendingOperation)return;invitePrepared??={inviteToken:credential('invite'),operationId:id()};downloadPrivate('connet-invite.private.json',{format:'connet-invite-v1',origin:location.origin,ownerId:vault.ownerId,...invitePrepared});$('#invite-saved').checked=false;$('#invite-confirm').hidden=false;controls();}
function issueInvite(){if(!invitePrepared||!$('#invite-saved').checked)return;return command({action:'issueInvite',path:'/owner/agent-invites',targetId:null,operationId:invitePrepared.operationId,fields:{inviteToken:invitePrepared.inviteToken}});}

function prepareBackup(){
  if(busy||vault.pendingOperation||emailFlow.pending||!vault.sessionToken)return;
  try{backupPrepared??={ownerId:vault.ownerId,sessionToken:vault.sessionToken,recoveryToken:credential('recovery'),operationId:id()};
    if(backupPrepared.ownerId!==vault.ownerId||backupPrepared.sessionToken!==vault.sessionToken){backupPrepared=null;return;}
    const file={format:'connet-owner-v2',origin:location.origin,ownerId:vault.ownerId,sessionToken:vault.sessionToken,recoveryToken:backupPrepared.recoveryToken,pendingOperation:{operationId:backupPrepared.operationId,scope:`owner:${vault.ownerId}`,action:'enableRecoveryBackup'}};
    downloadPrivate('connet-owner-recovery.private.json',file);$('#backup-confirm').hidden=false;$('#backup-saved').checked=false;controls();message('请确认备用恢复文件已保存，再启用。它目前尚未生效。');
  }catch(error){fail(error);}
}
async function enableBackup(){
  if(!backupPrepared||!$('#backup-saved').checked||busy||vault.pendingOperation)return;
  if(backupPrepared.ownerId!==vault.ownerId||backupPrepared.sessionToken!==vault.sessionToken)return;
  try{vault.backupPreparation={recoveryToken:backupPrepared.recoveryToken};save();await command({action:'enableRecoveryBackup',path:'/owner/recovery-backups',targetId:null,operationId:backupPrepared.operationId,fields:{recoveryToken:backupPrepared.recoveryToken,credentialsSaved:true}});}catch(error){fail(error);}
}

async function importCredentials(event){
 const file=event.target.files?.[0];if(!file||busy||emailFlow.pending)return;const busyLease=setBusy(true);$('#origin-help').hidden=true;sessionOnlyBackup=null;$('#continue-management').hidden=true;
 try{
  if(file.size>32768)throw new BackupError('invalid_backup');const saved=parseOwnerBackup(await file.text(),location.origin);if(busyLease!==busyRevision)return;
  if(event.target.id==='recovery-source-import'){
   if(!pendingRecovery()||saved.ownerId!==vault.ownerId||!saved.recoveryToken)throw new BackupError('invalid_backup');
   await recoveryOwner(saved.recoveryToken,vault.ownerId);vault.sourceRecoveryToken=saved.recoveryToken;save();recoverySourceProof=saved.recoveryToken;message('已读取原备份，请继续同一次重设。');return;
  }
  if(assistance.token&&!vault.pendingOperation){
   if(saved.ownerId!==assistance.context?.ownerId)throw new BackupError('owner_mismatch');
   const previous=saved.pendingOperation,context=saved.assistanceContext;
   if(previous?.action==='recover'&&context?.assistanceToken===assistance.token){
    let originalResult;try{originalResult=await api(`/operations/${encodeURIComponent(previous.operationId)}?scope=${encodeURIComponent(previous.scope)}&action=recover`,{token:saved.sessionToken});}catch{/* An unknown current operation must retain its original continuation. */}
    if(originalResult){
     if(originalResult.ownerId!==saved.ownerId||originalResult.operationId!==previous.operationId)throw new BackupError('operation_mismatch');
     if(originalResult.requestId!==context.requestId){await useRecoveryBackup(saved);return;}
    }
   }
   // Downloads retain their original auth metadata after success. Verify the
   // independent recovery proof; never replay that historical registration/setup.
   if(!previous||(!context&&['registerOwner','completeSetup','recover','enableRecoveryBackup'].includes(previous.action))){if(!saved.recoveryToken)throw new BackupError('unavailable_backup');await useRecoveryBackup(saved);return;}
   if(context?.assistanceToken!==assistance.token){
    if(previous.action!=='recover'||!context||!saved.sessionToken)throw new BackupError('owner_mismatch');
    const result=await api(`/operations/${encodeURIComponent(previous.operationId)}?scope=${encodeURIComponent(previous.scope)}&action=recover`,{token:saved.sessionToken});
    if(result.ownerId!==saved.ownerId||result.requestId!==context.requestId)throw new BackupError('owner_mismatch');
    await useRecoveryBackup(saved);return;
   }
  }
  if(['unpublishProfile','rejectRecoveryRequest','enableRecoveryBackup'].includes(saved.pendingOperation?.action)&&vault.sessionToken&&!vault.pendingOperation){
   const active=vault;if(active.ownerId!==saved.ownerId)throw new BackupError('owner_mismatch');
   const [currentAccount,owned]=await Promise.all([api('/owner/account',{token:active.sessionToken}),api('/owner/agents',{token:active.sessionToken})]);
   if(busyLease!==busyRevision||vault!==active)return;
   if(currentAccount.ownerId!==saved.ownerId||owned.ownerId!==saved.ownerId||(saved.pendingOperation.action!=='enableRecoveryBackup'&&!owned.agents.some(agent=>agent.agentId===saved.pendingOperation.targetId)))throw new BackupError('owner_mismatch');
   // Keep the newly authenticated session and recovery material; import only the original command.
   vault={...active,pendingOperation:saved.pendingOperation,...(saved.pendingOperation.action==='enableRecoveryBackup'?{backupPreparation:{recoveryToken:saved.recoveryToken}}:{}),...(saved.assistanceContext?{assistanceContext:saved.assistanceContext}:{})};pendingPayload=null;recoveryIntent=false;save();await resume();return;
  }
  vault=saved;account=null;pendingPayload=null;setupInfo=null;setupPublicGeneration++;setupPublicAbort?.abort();setupPrepared=false;recoveryPrepared=null;save();
  if(vault.assistanceContext){recoveryIntent=false;await resume();return;}
  if(pendingUnpublish()){recoveryIntent=false;await resume();return;}
  if(recoveryIntent){
   if(vault.pendingOperation){
    try{await committed(await receipt(vault.pendingOperation),vault.pendingOperation);return;}catch(error){if(error instanceof BackupError)throw error;}
   }
   if(vault.recoveryToken){try{await useRecoveryBackup({...vault});return;}catch(error){if(error instanceof BackupError||isUnknown(error))throw error;}}
   if(pendingRecovery()){
    if(vault.sourceRecoveryToken)await recoveryOwner(vault.sourceRecoveryToken,vault.ownerId);
    showPendingRecovery();message(vault.sourceRecoveryToken?'已找到上次重设的进度，请继续。':'上次重设的进度已保留。请在下方选择上一次登录备份，继续同一次操作。','pending');return;
   }
   if(pendingSetup()&&vault.setupToken){try{await readSetup();message('上次设置尚未完成，请继续设置密码。');return;}catch(error){if(isUnknown(error))throw error;}}
   if(!vault.pendingOperation&&vault.sessionToken&&!vault.recoveryToken){await restorePasswordIntent();return;}
   throw new BackupError('unavailable_backup');
  }
  await resume();
 }catch(error){
  if(busyLease!==busyRevision)return;
  // Keep the imported command and its pre-saved proofs intact even when verification fails.
  if(event.target.id==='recovery-source-import'){showPendingRecovery(true);backupError(error.code==='authentication_failed'?new BackupError('unavailable_backup'):error);return;}
  if(error instanceof BackupError){if(vault.pendingOperation&&error.code==='unavailable_backup'){showPendingAuthentication();message('这份文件保留了上次进度，请先继续完成。找回密码还需要已生效的登录备份。','pending');return;}$('#recovery-pick-step').hidden=false;$('#recovery-form').hidden=true;backupError(error);}
  else if(vault.pendingOperation&&isUnknown(error)){showPendingAuthentication();message(authenticationPendingMessage(),'pending');}
  else{$('#recovery-pick-step').hidden=false;$('#recovery-form').hidden=true;backupError(error.code==='authentication_failed'?new BackupError('unavailable_backup'):error);}
 }finally{event.target.value='';setBusy(false,busyLease);}
}
function logout(){emailFlow?.clear();backupPrepared=null;clearAgentSelection();assistanceSession=null;assistance.clear();recoveryOwnerId='';recoverySourceProof='';recoveryIntent=false;sessionOnlyBackup=null;readGeneration++;selectionGeneration++;readAbort?.abort();agents=[];selectedId='';pendingPayload=null;setupInfo=null;setupPrepared=false;recoveryPrepared=null;runtimePrepared=null;invitePrepared=null;account=null;existingClaimIntent=false;setupPublicGeneration++;setupPublicAbort?.abort();resetAuthenticationExit();vault={format:'connet-owner-v2',origin:location.origin};for(const key of [storageKey,'connet.owner.progress.v2']){try{sessionStorage.removeItem(key);}catch{}}renderSavedProgress();$$('input[type=password]').forEach(input=>input.value='');$('#login-identifier').value='';recoveryOwnerId='';$$('#email-view input,#setup-account-fields input').forEach(input=>{input.value='';input.checked=false;});showSignIn();message('已退出本次登录，Agent 仍保留原身份。');controls();}
async function resume(){
  if(vault.pendingOperation){
    if(vault.assistanceContext){
      vault.pendingOperation=parseOwnerBackup(JSON.stringify(privateFile()),location.origin).pendingOperation;
      // Restore only the entry before querying the original receipt, not its executability.
      assistance.restore(vault.assistanceContext.assistanceToken);
    }
    if(pendingBackup()){vault.pendingOperation=parseOwnerBackup(JSON.stringify(privateFile()),location.origin).pendingOperation;const p=vault.pendingOperation;pendingPayload={token:vault.sessionToken,body:{operationId:p.operationId,recoveryToken:vault.backupPreparation?.recoveryToken||vault.recoveryToken,credentialsSaved:true}};}
    if(pendingRejection()){
      vault.pendingOperation=parseOwnerBackup(JSON.stringify(privateFile()),location.origin).pendingOperation;
      const p=vault.pendingOperation;pendingPayload={token:vault.recoveryToken||vault.sessionToken,body:{operationId:p.operationId,assistanceToken:vault.assistanceContext.assistanceToken,...p.input}};
    }
    if(pendingUnpublish()){
      // The imported command is allowlisted before reconstructing its fixed path/body.
      vault.pendingOperation=parseOwnerBackup(JSON.stringify(privateFile()),location.origin).pendingOperation;
      const pending=vault.pendingOperation;selectedId=pending.targetId;
      pendingPayload={token:vault.sessionToken,body:{operationId:pending.operationId,...pending.input}};
    }
    vault.pendingOperation.uncertain=true;save();showSignIn();message('正在继续上次操作，请稍等。','pending');controls();
    try{const result=await receipt(vault.pendingOperation);await committed(result,vault.pendingOperation);return;}
    catch(error){
      if(error.code==='operation_mismatch'){backupError(error);return;}
      if(vault.assistanceContext){try{await assistance.read(vault.assistanceContext.assistanceToken);}catch{}}
      if(pendingUnpublish()){try{await loadAgents();}catch(readError){if([401,403].includes(readError.status))error=readError;}message(unpublishPendingMessage(error),'pending');}
      if(pendingSetup()&&vault.setupToken){try{await readSetup();}catch{}}
      if(pendingAuthentication()){showPendingAuthentication();message(authenticationPendingMessage(),'pending');}
    }
    return;
  }
  if(vault.claimContext?.handoffToken&&!vault.claimContext.agentId){await previewHandoff();return;}
  if(vault.sessionToken){try{await loadAgents();return;}catch(error){if(![401,403].includes(error.status))throw error;}}
  if(vault.setupToken){try{await readSetup();message('请重新下载登录备份并确认保存，再继续上次设置。');return;}catch(error){if(![401,403].includes(error.status))throw error;const exchange=vault.setupExchange;if(exchange){setupInfo={ownerId:exchange.ownerId,agentId:exchange.agentId,generation:exchange.generation};vault.claimContext={agentId:exchange.agentId,generation:exchange.generation,handoffToken:exchange.handoffToken};save();renderSetup(false);message('原设置兑换尚未确认。继续时将使用同一次请求，不会重建身份。','pending');return;}}}
  if(vault.handoffToken||vault.claimContext?.handoffToken){await previewHandoff();return;}if(vault.recoveryToken){recoveryIntent=true;await useRecoveryBackup({...vault});return;}showSignIn();
}
// Account forms share the original receipt, pre-saved proof and backup machinery.
function pendingInput(action,body){
  if(action==='login'&&body.identifier)return{identifier:body.identifier};
  if(action==='registerOwner')return{attemptId:body.attemptId,username:body.username,email:body.email};
  if(action==='completeSetup'&&body.username!==undefined)return{username:body.username,email:body.email};
  if(action==='claimAgent')return{agentId:body.agentId,expectedGeneration:body.expectedGeneration};
  if(action==='unpublishProfile')return{expectedVersion:body.expectedVersion,expectedPolicyVersion:body.expectedPolicyVersion};
  if(action==='rejectRecoveryRequest')return{expectedVersion:body.expectedVersion};
}
function accountControls(){
  const p=vault.pendingOperation;
  $('#claim-confirm').disabled=busy||(Boolean(p)&&p.action!=='claimAgent')||!account||account.ownerId!==vault.ownerId;
  if(pendingLogin())$('#login-identifier').disabled=true;
}
function validateAccountForm(prefix){
  const username=$(`#${prefix}-username`),email=$(`#${prefix}-email`);
  try{const fields=accountFields(username.value,email.value);username.value=fields.username;email.value=fields.email;return fields;}
  catch(error){requestFocus(`#${prefix}-${error.field}`);throw error;}
}
function registrationTarget(){const context=vault.claimContext;if(!context?.agentId)return null;const ownerId=setupInfo?.agentId===context.agentId?setupInfo.ownerId:vault.setupExchange?.agentId===context.agentId?vault.setupExchange.ownerId:null;if(!ownerId)throw new BackupError('owner_mismatch');return{ownerId,...context};}
function showRegistration(){if(vault.pendingOperation)return;try{emailFlow.openRegistration(registrationTarget());}catch(error){fail(error);}}
async function readAccount(session,generation,ownerId){
  const result=await api('/owner/account',{token:session});if(session!==vault.sessionToken||generation!==readGeneration)return;
  if(result.ownerId!==ownerId)throw new BackupError('owner_mismatch');return result;
}
function keepClaimFromSetup(){
  if(!setupInfo)return false;
  const proof=vault.setupToken?{setupToken:vault.setupToken}:vault.claimContext?.handoffToken?{handoffToken:vault.claimContext.handoffToken}:vault.handoffToken?{handoffToken:vault.handoffToken}:null;
  if(!proof)return false;vault.claimContext={agentId:setupInfo.agentId,generation:setupInfo.generation,...proof};save();existingClaimIntent=true;return true;
}
function showClaim(){
  if(!vault.claimContext?.agentId)return;
  showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=true;$('#claim-view').hidden=false;
  $('#claim-account').textContent=account?.ownerId===vault.ownerId?`当前账号：${account.username||'当前主人账号'}`:'正在核对当前账号…';
  if(account?.ownerId!==vault.ownerId){const session=vault.sessionToken,ownerId=vault.ownerId;void api('/owner/account',{token:session}).then(result=>{if(session!==vault.sessionToken||result.ownerId!==ownerId||$('#claim-view').hidden)return;account=result;$('#claim-account').textContent=`当前账号：${result.username||'当前主人账号'}`;controls();}).catch(()=>{if(session===vault.sessionToken&&!$('#claim-view').hidden)$('#claim-account').textContent='暂时无法核对当前账号，请再试一次读取。';});}
  const target=vault.claimContext.agentId,summary=$('#claim-agent-summary');$('#claim-view').dataset.agentId=target;const targetNode=()=>{const node=el('p','mono',target);node.id='claim-agent-id';return node;};summary.replaceChildren(el('strong','','正在读取 Agent 公开名字…'));
  void api(`/public/agents/${encodeURIComponent(target)}`).then(result=>{if(vault.claimContext?.agentId!==target||$('#claim-view').hidden)return;summary.replaceChildren();if(result.profile?.avatar?.template==='basic')avatar(summary,result.profile,target);summary.append(el('strong','',result.profile?.displayName||'暂时无法显示公开名字'));const details=el('details','owner-context');details.append(el('summary','','查看居民编号'),targetNode());summary.append(details);}).catch(()=>{if(vault.claimContext?.agentId===target)summary.replaceChildren(el('p','','暂时无法显示公开名字，请核对居民编号。'),targetNode());});
  controls();requestFocus('#claim-confirm');
}
async function claimAgent(){
  if(busy||!vault.sessionToken||!vault.claimContext)return;const c=vault.claimContext,p=vault.pendingOperation;
  const fields={agentId:c.agentId,expectedGeneration:c.generation,...(c.handoffToken?{handoffToken:c.handoffToken}:{setupToken:c.setupToken})};
  if(p?.action==='claimAgent'){pendingPayload={token:vault.sessionToken,body:{operationId:p.operationId,...fields}};await executePending();return;}
  if(p)return;await command({action:'claimAgent',path:'/owner/agent-claims',targetId:c.agentId,fields});
}
function openInvite(){if(busy||vault.pendingOperation)return;$('#management-security').open=true;$('#invites-panel').scrollIntoView({block:'start',behavior:'instant'});$('#prepare-invite').focus({preventScroll:true});}

emailFlow=createOwnerEmailFlow({
  uiState:()=>({busy,mainPending:Boolean(vault.pendingOperation)}),lock:()=>setBusy(true),unlock:lease=>setBusy(false,lease),focus:requestFocus,
  show:node=>{clearCompletedTaskNotice();if(!vault.pendingOperation&&globalNotice.dataset.backupError)message('');showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=true;node.hidden=false;},
  targetName:agentId=>agentId===setupInfo?.agentId?vault.setupAgentName:agents.find(agent=>agent.agentId===agentId)?.profile.published?.displayName,
  registrationTarget,
  back:()=>{if(assistance.token)showAssistancePage();else showSignIn();},
  registered:async(result,progress)=>{
    if(vault.pendingOperation)throw new BackupError('operation_mismatch');
    const target=progress.target;
    if(result.ownerId!==(target?.ownerId||progress.attemptId)||result.sessionId!==tokenId(progress.sessionToken)||(target&&(result.agentId!==target.agentId||result.managementStatus!=='managed')))throw new BackupError('operation_mismatch');
    // Persist the actual session before discarding the email completion key.
    vault={format:'connet-owner-v2',origin:location.origin,ownerId:result.ownerId,sessionToken:progress.sessionToken,stage:'managed'};save();
    recoveryIntent=false;recoveryPrepared=null;setupInfo=null;setupPrepared=false;account=null;selectedId=target?.agentId||'';
    assistance.clear();try{await loadAgents();message(target?`账号已创建，${agents.find(agent=>agent.agentId===target.agentId)?.profile.published?.displayName||'Agent'}已关联。`:'账号已创建，邮箱已验证。你可以邀请自己的 Agent。','success');requestFocus('#page-title');}
    catch{showSignIn();message('账号已创建，但暂时无法读取列表。请用刚设置的用户名和密码正常登录。','pending');}
  },
  recovered:result=>{if(vault.ownerId===result.ownerId){vault={format:'connet-owner-v2',origin:location.origin};save();clearAgentSelection({ownerId:result.ownerId});}assistanceSession=null;},
  loginAfterRecovery:()=>{assistance.clear();recoveryIntent=false;showSignIn();message('请用刚设置的新密码登录原账号。');},
});
$('#prepare-backup').addEventListener('click',prepareBackup);$('#backup-saved').addEventListener('change',controls);$('#enable-backup').addEventListener('click',enableBackup);
$('#email-recovery-start').addEventListener('click',()=>{if(!busy&&!vault.pendingOperation&&assistance.ready&&!assistance.terminal)void emailFlow.openRecovery(assistance.snapshot());});

$('#setup-next').addEventListener('click',()=>{try{if(!$('#setup-account-fields').hidden&&!pendingSetup())validateAccountForm('setup');}catch(error){fail(error);return;}if(!$('#setup-password').reportValidity())return;clearResolvedValidation();$('#setup-password-step').hidden=true;$('#setup-backup-step').hidden=false;$('#credentials-download').focus();});
$('#recovery-next').addEventListener('click',()=>{if(!$('#recovery-password').reportValidity())return;if(!validToken(recoverySourceProof)){message('请先重新选择上一次备份，以继续这次操作。','error');return;}$('#recovery-password-step').hidden=true;$('#recovery-backup-step').hidden=false;$('#recovery-download').focus();});
$('#forgot-password').addEventListener('click',()=>showForgot());$('#import-help').addEventListener('click',()=>showForgot('manage'));
$('#back-to-login').addEventListener('click',async()=>{if(vault.pendingOperation){message('这次操作尚未确认，请保存进度后再退出。','pending');return;}const managed=hasAssistanceSession();assistanceSession=null;assistance.clear();delete vault.assistanceContext;save();recoveryIntent=false;if(!managed){showSignIn();return;}const busyLease=setBusy(true);try{await loadAgents();}catch(error){fail(error);showSignIn();}finally{setBusy(false,busyLease);}});
$('#reject-assistance').addEventListener('click',rejectAssistance);
$('#assistance-refresh').addEventListener('click',async()=>{if(busy||vault.pendingOperation)return;const busyLease=setBusy(true);try{assistanceSession=null;await assistance.read();await verifyAssistanceSession();showAssistancePage();}catch(error){fail(error);}finally{setBusy(false,busyLease);}});
$('#recovery-source-import').addEventListener('change',importCredentials);
$('#resume-saved-progress').addEventListener('click',()=>showForgot('manage'));
$('#continue-management').addEventListener('click',async()=>{if(!sessionOnlyBackup||busy)return;recoveryIntent=false;vault=sessionOnlyBackup;save();const busyLease=setBusy(true);try{await loadAgents();}catch(error){if(busyLease===busyRevision)fail(error);}finally{setBusy(false,busyLease);}});
const findPrompt=`我忘记了 ${location.origin} 的登录密码，希望保留原居民。请只读检查你已获准保存的原注册文件和私密交付记录，以原身份记录的网站为准。只告诉我主人登录备份的保存线索和适用网站；没有验证的有效性请明确说未验证。不要搜索其他目录，不要在聊天输出密码、token、完整私密链接或文件内容，不上传文件。只有 Agent 运行文件或失效初始交接时，请说明它们不能重设主人密码。不要重注册、覆盖身份、改权限或重置；由我在原网站选择登录备份继续。`;
$('#find-backup-prompt').textContent=findPrompt;$('#copy-find-backup').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(findPrompt);$('#copy-find-result').textContent='已复制。交给原 Agent 检查，找到备份后回到这里选择文件。';}catch{$('#copy-find-result').textContent='未能自动复制，请选择上方文字复制。';}});
$('#setup-start').addEventListener('click',startSetup);$('#credentials-download').addEventListener('click',prepareSetup);$('#setup-form').addEventListener('submit',completeSetup);$('#setup-saved').addEventListener('change',controls);
$('#login-form').addEventListener('submit',login);$('#recovery-form').addEventListener('submit',recover);$('#recovery-download').addEventListener('click',prepareRecovery);$('#recovery-saved').addEventListener('change',controls);$('#login-tab').addEventListener('click',()=>tab('login'));$('#recovery-tab').addEventListener('click',()=>tab('recovery'));$('#show-login').addEventListener('click',()=>{showSignIn();tab('login');});$('#credentials-import').addEventListener('change',importCredentials);
$('#check-result').addEventListener('click',checkResult);$('#retry-operation').addEventListener('click',()=>executePending());$('#refresh-agents').addEventListener('click',()=>refresh());$('#logout').addEventListener('click',()=>pendingUnpublish()||pendingRejection()||pendingBackup()?prepareAuthenticationExit():logout());$('#download-current').addEventListener('click',downloadVault);$('#agent-select').addEventListener('change',event=>selectAgent(event.target.value));
$('#prepare-auth-exit').addEventListener('click',prepareAuthenticationExit);$('#auth-exit-saved').addEventListener('change',controls);$('#confirm-auth-exit').addEventListener('click',exitPendingAuthentication);
$('#profile-form').addEventListener('submit',submitProfile);$('#publish-profile').addEventListener('click',publish);$('#unpublish-profile').addEventListener('click',unpublish);$('#reload-profile').addEventListener('click',()=>refresh(false));$('#policy-form').addEventListener('submit',policy);$('#join-agent').addEventListener('click',()=>membership('join'));$('#leave-agent').addEventListener('click',()=>membership('leave'));$('#pause-agent').addEventListener('click',pause);
$('#prepare-runtime').addEventListener('click',prepareRuntime);$('#runtime-saved').addEventListener('change',controls);$('#replace-runtime').addEventListener('click',replaceRuntime);$('#revoke-runtime').addEventListener('click',revokeRuntime);$('#prepare-invite').addEventListener('click',prepareInvite);$('#invite-saved').addEventListener('change',controls);$('#issue-invite').addEventListener('click',issueInvite);
$('#show-register').addEventListener('click',()=>showRegistration());
$('#setup-existing').addEventListener('click',()=>{if(keepClaimFromSetup())showSignIn();});
$('#claim-confirm').addEventListener('click',claimAgent);$('#claim-cancel').addEventListener('click',()=>{if(vault.pendingOperation)return;delete vault.claimContext;save();void refresh();});
$('#claim-switch').addEventListener('click',()=>{if(vault.pendingOperation)return;const context=vault.claimContext;logout();vault.claimContext=context;save();showSignIn();message('请登录要关联的主人账号。登录后仍需确认关联。');});
$('#add-agent').addEventListener('click',openInvite);$('#empty-invite').addEventListener('click',openInvite);
// A new private link can arrive while this very /owner document is open.
// Handle same-document navigation too, and remove its capability before requests.
window.addEventListener('hashchange',()=>{
  const fragment=location.hash,parameters=new URLSearchParams(fragment.slice(1)),proof=parameters.get('handoff'),target=parameters.get('agent'),assistanceProof=parameters.get('assistance');
  if(fragment)history.replaceState(null,'',location.pathname);
  if(assistanceProof&&!proof){
    if(busy||vault.pendingOperation||!emailFlow.canNavigate()){message('请先继续或保存当前操作，再重新打开新的协助入口。','pending');return;}
    const busyLease=setBusy(true);void openAssistance(assistanceProof).catch(error=>{if(busyLease===busyRevision)fail(error);}).finally(()=>setBusy(false,busyLease));
  }else if(proof){
    try{if(receiveHandoff(proof)){const busyLease=setBusy(true);const active=vault;void resume().catch(error=>{if(vault===active&&busyLease===busyRevision)fail(error);}).finally(()=>{if(vault===active)setBusy(false,busyLease);});}}catch(error){fail(error);}
  }else if(target&&vault.sessionToken&&!vault.pendingOperation&&emailFlow.canNavigate()){
    assistance.clear();delete vault.assistanceContext;
    requestedAgentId=target;clearCompletedTaskNotice();message('正在读取此 Agent 的获准资料。');const busyLease=setBusy(true);const active=vault,expectedRead=readGeneration+1;
    void loadAgents().catch(error=>{if(vault===active&&readGeneration===expectedRead){fail(error);if(error.status===401)showSignIn();}}).finally(()=>{if(vault===active&&readGeneration===expectedRead)setBusy(false,busyLease);});
  }else if(!vault.pendingOperation&&!vault.sessionToken&&emailFlow.canNavigate()){if(fragment==='#register')showRegistration();else if(fragment==='#login')showSignIn();}
});
if(incomingHandoff){try{receiveHandoff(incomingHandoff);}catch(error){fail(error);}}
try{renderSavedProgress();}catch(error){fail(error);}
if(!storageAvailable){showSignIn();message('浏览器无法保存当前标签页的私密续接材料。请启用会话存储后继续。','error');controls();}
else if(!vault.pendingOperation&&emailFlow.unfinished){void emailFlow.resume();}
else{const busyLease=setBusy(true);const assistanceProof=!incomingHandoff&&!requestedAgentId&&!vault.pendingOperation?(incomingAssistance||assistance.token):null;const start=assistanceProof?openAssistance(assistanceProof):resume();start.then(()=>{if(busyLease!==busyRevision)return;if(!assistanceProof&&incomingMode==='register'&&!vault.pendingOperation&&!vault.sessionToken&&!vault.claimContext)showRegistration();}).catch(error=>{if(busyLease===busyRevision){if(assistance.token)showAssistancePage();else showSignIn();fail(error);}}).finally(()=>setBusy(false,busyLease));}
