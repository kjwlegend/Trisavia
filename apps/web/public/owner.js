import {getLocale} from './i18n/core.js';
import {mountOwnerLocalePreferences} from './owner-ui-preferences.js';
import {accountNotice as notice,accountElement as el,accountMessage,accountLabel,accountText,accountAttribute} from './owner-i18n.js';
import {lifeReadInput,giftReadInput} from './hud/life-owner-input.js';
import {npcLifeReadInput} from './hud/npc-life-reader.js';
import {$ as query,$$ as queryAll,api,ApiError,errorMessage,isUnknown,credential,id,validToken,tokenId,stamp,downloadPrivate} from './common.js';
import {avatar} from './scene.js';
import {publicIdLabel,residentPath} from './public-id.js';
import {createOwnerAgentInvite} from './owner-agent-invite.js';
import {parseOwnerBackup,BackupError} from './owner-backup.js';
import {accountFields,normalizeIdentifier} from './owner-account.js';
import {readAgentSelection,rememberAgentSelection,clearAgentSelection} from './agent-selection.js';
import {createRecoveryAssistance} from './owner-recovery-assistance.js';
import {assertOwnerOperationResult} from './owner-operation-result.js';
import {createOwnerEmailFlow} from './owner-email-flow.js';
import {createOwnerReceiptReader,confirmUnknownOwnerOperation} from './owner-receipt.js';
import {managerActions,managerInput,managerRequest,assertManagerResult,parseIntervalSeconds} from './owner-manager-commands.js';
import {readFriendshipResult} from './hud/friendship-source.js';
import {worldAccessAdoptionText} from './world-access-status.js';
import {mountWorldActionPolicy} from './owner-world-action-policy.js';
import {mountOwnerWorldSummary} from './hud/owner-world-summary.js';
import {mountOwnerBehaviorLogs} from './hud/behavior-logs.js';
import {emitWorldAudio} from './world-audio.js';

export function createOwnerController(root,{entryStore,onState=()=>{},onView=()=>{},isVisible=()=>true,onLogout=()=>{},confirmAction=async()=>false,focusTitle=()=>{}}={}){
const $=(selector,scope=root)=>query(selector,scope);
const $$=(selector,scope=root)=>queryAll(selector.replaceAll('main ',''),scope);
let requestedAgentId='',unavailableAgentId='',appearanceRequiredAgentId='';
let sessionPhase='anonymous';const subscribers=new Set();let presentation=null,started=false;
let observationRevision=0,observationIdentity=null;
function unfinishedTask(){return Boolean(vault.pendingOperation||vault.stage==='recovered'||emailFlow?.unfinished||assistance.token||vault.claimContext||vault.setupToken||recoveryPrepared||(recoveryIntent&&!$('#recovery-form').hidden)||runtimePrepared||backupPrepared||presentation?.confirming);}
function authTaskVisible(){return !$('#auth-view').hidden&&(!$('#forgot-view').hidden||!$('#setup-view').hidden||!$('#claim-view').hidden||!$('#backup-recovered-view').hidden||(emailFlow?.active&&!$('#email-view').hidden));}
function accountIntent(){return hasPending()||unfinishedTask()||authTaskVisible()?'resume':'account';}
function summary(){const ready=authenticatedOwner();const identity=[ready,vault,ready?vault.sessionToken:'',ready?selectedId:''];if(!observationIdentity||identity.some((value,index)=>value!==observationIdentity[index])){observationIdentity=identity;observationRevision++;}return{authenticated:ready,observationRevision,phase:busy&&ready?'refreshing':ready?(sessionPhase==='error'?'error':'ready'):sessionPhase,username:ready?account.username:'',agents:ready?agents.map(agent=>{const profile=agent.profile.published||agent.profile.draft||{};return{agentId:agent.agentId,publicId:agent.publicId,name:profile.displayName||accountLabel("state.agent.unnamed"),bio:profile.bio||'',interests:profile.interests||[],avatar:agent.profile.publishedAppearance??agent.profile.published?.avatar??{},profileSource:agent.profile.published?'published':'draft',membership:agent.membership.state,ownerPaused:agent.membership.ownerPaused,platformRestricted:agent.membership.platformRestricted,asOf:agent.asOf};}):[],selectedAgentId:ready?selectedId:'',accountIntent:accountIntent(),interactionLocked:busy||Boolean(vault.pendingOperation)||Boolean(emailFlow?.pending)||Boolean(presentation?.confirming),continuation:unfinishedTask()||authTaskVisible()||entryStore?.pending?accountLabel("common:action.continue"):''};}
function safeTarget(){const context=emailFlow?.target||assistance.snapshot()||vault.claimContext;if(!context?.agentId)return null;const owned=agents.find(agent=>agent.agentId===context.agentId);return{agentId:context.agentId,publicId:owned?.publicId||context.publicId||(context.agentId===setupInfo?.agentId?setupInfo.publicId:undefined),name:context.agentId===setupInfo?.agentId?vault.setupAgentName||'':owned?.profile.published?.displayName||owned?.profile.draft?.displayName||'',avatar:context.agentId===setupInfo?.agentId?setupAvatar:owned?.profile.publishedAppearance??owned?.profile.published?.avatar,recovery:Boolean(context.recovery||assistance.token)};}
function emitState(){uiPreferences?.syncContext();inviteUI?.syncSession();presentation?.account(account);presentation?.target(safeTarget());const state=summary();presentation?.state(state);for(const listener of subscribers)listener(structuredClone(state));onState(state);presentation?.sync();onView();}
const storageKey='connet.owner.v2';
const freshAudioOperations=new Set();
let vault={format:'connet-owner-v2',origin:location.origin};
let storageAvailable=true;
try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.format==='connet-owner-v2'&&saved.origin===location.origin)vault=saved;}catch{storageAvailable=false;}
let agents=[],selectedId='',busy=false,busyRevision=0,selectionGeneration=0,readGeneration=0;
let setupInfo=null,setupPrepared=false,recoveryPrepared=null,runtimePrepared=null,inviteUI=null;
let setupAvatar=null;let setupPublicGeneration=0,setupPublicAbort=null;
let pendingPayload=null,view='auth',readAbort=null,authExitPrepared=null;
let recoveryIntent=false,sessionOnlyBackup=null,focusRequested=null,recoveryOwnerId='',recoverySourceProof='';
let account=null,accountSession='',existingClaimIntent=false,assistanceSession=null,emailFlow=null,backupPrepared=null,uiPreferences=null;
const assistance=createRecoveryAssistance(()=>controls(),root);
const globalNotice=$('#global-notice');let feedbackGeneration=0;

function save(source=vault){try{sessionStorage.setItem(storageKey,JSON.stringify(source));}catch{storageAvailable=false;throw new ApiError('private_storage_unavailable',400);}finally{if(source===vault&&accountSession&&(accountSession!==vault.sessionToken||account?.ownerId!==vault.ownerId))emitState();}}
function expireAuthenticatedSession(source,session,generation){
  if(vault!==source||vault.sessionToken!==session||generation!==readGeneration)return;
  clearAgentSelection({ownerId:source.ownerId});account=null;accountSession='';assistanceSession=null;agents=[];selectedId='';sessionPhase='expired';emitState();
}
function message(text,tone=''){delete globalNotice.dataset.backupError;notice(globalNotice,text,tone);presentation?.sync();}
function clearFlowFeedback(){if(vault.pendingOperation||emailFlow?.pending)return;feedbackGeneration++;message('');notice($('#setup-feedback'),'');}
function clearCompletedTaskNotice(){if(!vault.pendingOperation&&globalNotice.classList.contains('success'))notice(globalNotice,'');}
function clearResolvedValidation(){if(vault.pendingOperation)return;if(globalNotice.classList.contains('error'))notice(globalNotice,'');for(const prefix of ['setup'])notice($(`#${prefix}-feedback`),'');}
function fail(error){
  const field=error.field||error.details?.field,unknown=!error.field&&isUnknown(error);
  const text=error.code==='authentication_failed'?(!$('#auth-view').hidden&&!$('#sign-in-view').hidden?accountMessage("error.signIn.credentialsInvalid"):accountMessage("error.signIn.sessionExpired")):(error.field||error.code==='invalid_request')&&['username','email'].includes(field)?field==='username'?accountMessage("email.validation.username"):accountMessage("error.account.emailInvalid"):error.code==='private_storage_unavailable'?accountMessage("error.storage.tabUnavailable"):errorMessage(error);
  if(!unknown&&error.code==='profile_validation_failed'&&field==='avatar'&&current()&&!current().profile.published){appearanceRequiredAgentId=selectedId;$('#profile-appearance-needed').hidden=false;message(accountMessage("error.profile.appearanceRequired"),'error');return;}
  message(text,unknown?'pending':'error');
  if(!unknown)for(const prefix of ['setup']){const form=$(`#${prefix}-form`);if(!form.closest('[hidden]')&&!form.hidden){const feedback=$(`#${prefix}-feedback`);notice(feedback,text,'error');feedback.scrollIntoView({block:'nearest',behavior:'instant'});break;}}
}
// Only the async workflow that acquired the current lease can unlock its UI.
function setBusy(value,lease){if(value)lease=++busyRevision;else if(lease!==busyRevision)return;busy=value;root.setAttribute('aria-busy',String(value));controls();if(!value&&focusRequested&&isVisible()){const input=$(focusRequested);focusRequested=null;if(input&&!input.disabled)input.focus();}return lease;}
function requestFocus(selector){if(!isVisible())return;if(selector==='#page-title'||selector==='#email-title'){focusTitle();return;}if(busy)focusRequested=selector;else $(selector)?.focus();}
function pendingRecovery(){return vault.pendingOperation?.action==='recover';}
function pendingLogin(){return vault.pendingOperation?.action==='login';}
function pendingSetup(){return vault.pendingOperation?.action==='completeSetup';}
function pendingUnpublish(){return vault.pendingOperation?.action==='unpublishProfile';}
function pendingRejection(){return vault.pendingOperation?.action==='rejectRecoveryRequest';}
function pendingBackup(){return vault.pendingOperation?.action==='enableRecoveryBackup';}
function pendingAuthentication(){return pendingRecovery()||pendingLogin()||pendingSetup()||pendingRejection()||pendingBackup()||['registerOwner','claimAgent'].includes(vault.pendingOperation?.action);}
function pendingManagement(){return managerActions.has(vault.pendingOperation?.action);}
function pendingExportable(){return pendingAuthentication()||pendingUnpublish()||pendingManagement();}
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
    $('#recovery-password').disabled=busy||!ready;$('#recovery-password-confirm').disabled=busy||!ready;
    $('#recovery-download').disabled=busy||!ready;$('#recovery-saved').disabled=busy||!ready;
    $('#recovery-submit').disabled=busy||!ready||!$('#recovery-saved').checked;
  }
  $('#runtime-saved').disabled=busy||pending;$('#replace-runtime').disabled=busy||pending||!runtimePrepared||!$('#runtime-saved').checked;
  inviteUI?.controls(busy||pending||emailPending);
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
  accountText($('#recovery-submit'),()=>(vault.assistanceContext?accountMessage("state.recovery.resetAndComplete"):accountMessage("recoveryView.confirmReset")));
  $('#reject-assistance').hidden=!assistance.token||(!assistance.verified&&!hasAssistanceSession())||assistance.terminal;
  $('#reject-assistance').disabled=busy||pending||(!assistance.verified&&!hasAssistanceSession())||!assistance.ready;
  accountText($('#back-to-login'),()=>(hasAssistanceSession()?accountMessage("state.navigation.backToAgents"):accountMessage("auth.backToSignIn")));
  if(assistance.token){$('#credentials-import').disabled||=!assistance.ready||assistance.terminal;$('#continue-management').hidden=true;if(assistance.terminal&&!pending){$('#recovery-pick-step').hidden=true;$('#recovery-form').hidden=true;}}
  if(emailPending)$$('main button,main input,main textarea,main select').filter(control=>!$('#email-view').contains(control)).forEach(control=>control.disabled=true);
  emitState();
  if(selectedId){const agent=current();if(agent){
    const restricted=agent.membership.platformRestricted,fields=fieldsFromForm(),access=agent.worldAccess;
    const validProfile=Boolean(fields.displayName)&&fields.displayName.length<=60&&fields.bio.length<=500&&fields.interests.length<=10&&fields.interests.every(value=>value.length<=40);
    $('#join-agent').disabled||=agent.membership.state==='joined'||!agent.profile.published||restricted||Boolean(presentation?.dirty());$('#legacy-unsaved-note').hidden=!presentation?.dirty()||!agent.profile.published;$('#revoke-runtime').disabled||=!agent.runtimeActive;
    $('#save-profile').disabled||=agent.membership.state!=='joined'||restricted||!validProfile||!(presentation?.dirty('profile-form')||(!agent.profile.published&&presentation?.dirty('appearance-form')));
    $('#save-appearance').disabled||=agent.membership.state!=='joined'||restricted||!presentation?.dirty('appearance-form')||!presentation?.selectedAppearance?.()||(!agent.profile.published&&!validProfile);accountText($('#save-appearance'),()=>(agent.profile.published?.avatar?.kind==='custom'?accountMessage("avatar.action.restoreBuiltin"):agent.profile.published?accountMessage("manager.saveAppearance"):accountMessage("state.appearance.saveWithProfile")));
    $('#save-policy').disabled||=restricted||!presentation?.dirty('policy-form');$('#pause-agent').disabled||=restricted||Boolean(presentation?.dirty());
    $('#publish-profile').disabled||=restricted||!agent.profile.draft?.displayName||!agent.profile.draft?.avatar||Boolean(presentation?.dirty());$('#proposal-unsaved-note').hidden=!presentation?.dirty('policy-form');
    $('#prepare-legacy-profile').disabled||=restricted||!validProfile;
    let validInterval=true;try{validInterval=parseIntervalSeconds($('#world-access-interval').value,$('#world-access-unit').value)!==access?.intervalSeconds;}catch{validInterval=false;}
    $('#save-world-access').disabled||=access?.agentId!==agent.agentId||(!Number.isSafeInteger(access?.version)||access.version<1)||!validInterval||!presentation?.dirty('world-access-form');
  }}
}
function showAuth(){presentation?.auth();for(const selector of ['#email-view','#claim-view','#backup-recovered-view'])$(selector).hidden=true;view='auth';$('#auth-view').hidden=false;$('#manage-view').hidden=true;$('#session-actions').hidden=true;accountText($('#page-title'),()=>(accountMessage("auth.title")));accountText($('#page-description'),()=>(accountMessage("auth.description")));}
function showRecoveryCompleted(){showAuth();for(const selector of ['#setup-view','#sign-in-view','#forgot-view'])$(selector).hidden=true;$('#backup-recovered-view').hidden=false;view='recovered';message(accountMessage("state.recovery.completed"),'success');controls();requestFocus('#page-title');}
function finishRecovery(result,pending){
  // The pre-generated session remains a receipt proof, not a password login.
  const next={...vault,stage:'recovered',recoveredOperation:structuredClone(pending)};delete next.pendingOperation;
  try{save(next);}catch(error){error.recoveryReceiptConfirmed=true;throw error;}
  vault=next;pendingPayload=null;resetAuthenticationExit();readGeneration++;readAbort?.abort();selectionGeneration++;
  account=null;accountSession='';agents=[];selectedId='';unavailableAgentId='';requestedAgentId='';sessionPhase='recovered';
  recoveryIntent=false;recoveryPrepared=null;recoveryOwnerId='';recoverySourceProof='';setupInfo=null;runtimePrepared=null;backupPrepared=null;
  clearAgentSelection({ownerId:result.ownerId});entryStore?.clearTarget();emailFlow?.endRequest(result.ownerId,result.requestId);assistanceSession=null;assistance.clear();
  $$('[data-owner-password]').forEach(input=>input.value='');$('#agent-list').replaceChildren();$('#agent-select').replaceChildren();
  showRecoveryCompleted();
}
function showSignIn({fresh=false}={}){if(fresh)clearFlowFeedback();showAuth();$('#setup-view').hidden=true;$('#forgot-view').hidden=true;$('#sign-in-view').hidden=false;
  $('#login-identifier').value=vault.pendingOperation?.input?.identifier||$('#login-identifier').value;
  $('#login-resume-info').hidden=!pendingLogin();accountText($('#login-submit'),()=>(pendingLogin()?accountMessage("state.signIn.continue"):accountMessage("auth.signIn")));controls();requestFocus(pendingLogin()?'#login-password':'#login-identifier');
}
function showForgot(purpose='recover'){
  if(vault.pendingOperation){showPendingAuthentication();return;}
  clearFlowFeedback();recoveryIntent=purpose==='recover';sessionOnlyBackup=null;showAuth();
  $('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=false;
  $('#recovery-pick-step').hidden=false;$('#recovery-form').hidden=true;$('#origin-help').hidden=true;
  $('#recovery-choices').hidden=purpose==='manage';$('#recovery-backup-choice').hidden=purpose!=='manage';$('#recovery-email-help').hidden=true;
  $('#continue-management').hidden=true;accountText($('#recovery-title'),()=>(purpose==='manage'?accountMessage("state.recovery.backupOrProgress"):accountMessage("recoveryView.title")));renderVerificationMode();void emailFlow.readCapabilities();controls();requestFocus(purpose==='manage'?'#credentials-import':'#recovery-mail-help');
}
function recoveryForm(resuming=false){
  showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=false;
  $('#recovery-pick-step').hidden=true;$('#recovery-form').hidden=false;accountText($('#recovery-title'),()=>(resuming?accountMessage("state.recovery.resumeReset"):accountMessage("state.recovery.setNewPassword")));
  $('#recovery-resume-info').hidden=!resuming;$('#recovery-password-step').hidden=false;$('#recovery-backup-step').hidden=true;
  $('#recovery-password').value='';$('#recovery-password-confirm').value='';$('#recovery-saved').checked=false;controls();requestFocus('#recovery-password');
}
function showAssistancePage(){
  showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=false;
  accountText($('#recovery-title'),()=>(accountMessage("state.recovery.verifyOwner")));$('#recovery-pick-step').hidden=pendingRejection()||assistance.terminal;
  $('#recovery-choices').hidden=true;$('#recovery-email-help').hidden=true;$('#recovery-backup-choice').hidden=false;
  $('#recovery-form').hidden=true;$('#origin-help').hidden=true;$('#continue-management').hidden=true;renderVerificationMode();void emailFlow.readCapabilities();controls();
}
async function openAssistance(proof){
  if(vault.pendingOperation){showPendingAuthentication();message(accountMessage("state.recovery.finishBeforeNewRequest"),'pending');return;}
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
async function rejectAssistance(){
  const context=vault.assistanceContext||assistance.snapshot(),sessionAuthorized=hasAssistanceSession();
  if(busy||vault.pendingOperation||(!assistance.verified&&!sessionAuthorized)||!context||context.assistanceToken!==assistance.token)return;
  const confirmation=confirmationSnapshot();
  if(!await confirmAction(accountMessage("recoveryView.rejectAssistance"),accountMessage("state.recovery.rejectConfirmation")))return;
  if(!sameConfirmation(confirmation)||context.assistanceToken!==assistance.token||(!assistance.verified&&!hasAssistanceSession()))return;
  try{vault.assistanceContext=context;save();}catch(error){fail(error);return;}
  return command({action:'rejectRecoveryRequest',path:'/owner/recovery-assistance/reject',scope:`owner:${context.ownerId}`,targetId:context.agentId,token:sessionAuthorized?vault.sessionToken:recoverySourceProof||vault.recoveryToken,fields:{assistanceToken:context.assistanceToken,expectedVersion:context.version}});
}
function backupError(error){
 const messages={agent_material:accountMessage("error.backup.agentMaterial"),invalid_backup:accountMessage("error.backup.invalid"),different_origin:accountMessage("error.backup.differentOrigin"),unavailable_backup:accountMessage("error.backup.unavailable"),inactive_backup:accountMessage("error.backup.inactive"),owner_mismatch:accountMessage("error.backup.ownerMismatch"),operation_mismatch:accountMessage("error.operation.targetMismatch")};
 message(messages[error.code]||errorMessage(error),'error');
 globalNotice.dataset.backupError=error.code;
 if(error.originalOrigin){accountText($('#origin-message'),()=>(error.originalOrigin==='https://38.207.178.31'?accountMessage("error.backup.originalIpSite"):accountMessage("error.backup.originalRecommendedSite")));$('#original-origin').href=error.originalOrigin+'/owner';$('#origin-help').hidden=false;}
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
    const label=name=>{accountText(restore,()=>(accountMessage("registration.saved.continue",{name:name})));accountText(download,()=>(accountMessage("registration.saved.download",{name:name})));};label(source.setupAgentName||accountMessage("email.target.fallback"));
    const target=progressTarget(source);
    if(!source.setupAgentName&&target)void api(`/public/agents/${encodeURIComponent(target.agentId)}`).then(result=>{const name=result?.profile?.displayName?.trim();if(row.isConnected&&name)label(name);}).catch(()=>{});
    row.append(restore,download);list.append(row);
  }
}
function receiveHandoff(proof){
  if(emailFlow&&!emailFlow.canNavigate())return false;
  if(vault.pendingOperation){message(accountMessage("state.operation.finishBeforeHandoff"),'pending');return false;}
  // A new handoff ends the previously browsed recovery view, not an issued command.
  recoveryIntent=false;sessionOnlyBackup=null;recoveryPrepared=null;recoveryOwnerId='';recoverySourceProof='';focusRequested=null;
  $('#recovery-password').value='';$('#recovery-password-confirm').value='';$('#recovery-saved').checked=false;
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
  vault.claimContext={handoffToken:proof};setupInfo=null;setupAvatar=null;setupPrepared=false;pendingPayload=null;readGeneration++;readAbort?.abort();setupPublicGeneration++;setupPublicAbort?.abort();
  $('#setup-saved').checked=false;$$('#setup-account-fields input,#setup-password').forEach(input=>input.value='');save();return true;
}
async function useRecoveryBackup(source){
 const context=assistance.token?await assistance.verify(source):null;
 if(!context)await recoveryOwner(source.recoveryToken,source.ownerId);archiveImportedProgress();
 if(!vault.pendingOperation&&globalNotice.dataset.backupError&&globalNotice.classList.contains('error'))message(accountMessage("state.backup.verifiedBeforeReset"));
 // A valid recovery proof is independent of the expired setup/session recorded in an old download.
 vault={format:'connet-owner-v2',origin:location.origin,ownerId:source.ownerId,recoveryToken:source.recoveryToken,...(context?{assistanceContext:context}:{})};
 pendingPayload=null;setupPrepared=false;recoveryPrepared=null;save();
 recoveryOwnerId=source.ownerId;recoverySourceProof=source.recoveryToken;
 recoveryForm();accountText($('#recovery-file-status'),()=>(context?accountMessage("state.backup.assistanceTargetVerified"):accountMessage("state.backup.read")));
}
async function restorePasswordIntent(){
 if(validToken(vault.recoveryToken))return useRecoveryBackup({...vault});
 if(validToken(vault.sessionToken)){
  const result=await api('/owner/agents',{token:vault.sessionToken});if(result.ownerId!==vault.ownerId)throw new BackupError('owner_mismatch');
  sessionOnlyBackup={...vault};showForgot('recover');sessionOnlyBackup={...vault};$('#continue-management').hidden=false;
  message(accountMessage("state.backup.sessionOnly"),'pending');return;
 }
 throw new BackupError('unavailable_backup');
}

function showPendingRecovery(preserveInputs=false){
 const password=$('#recovery-password').value;recoveryForm(true);if(preserveInputs)$('#recovery-password').value=password;recoveryOwnerId=vault.ownerId||'';recoverySourceProof=vault.sourceRecoveryToken||'';recoveryPrepared=null;
 if(!preserveInputs){$('#recovery-password').value='';$('#recovery-saved').checked=false;}controls();
}
function showPendingAuthentication(preserveInputs=false){
  if(pendingBackup()){showSignIn();message(accountMessage("state.backup.activationUnconfirmed"),'pending');return;}
  if(pendingRejection()){showAssistancePage();return;}
  if(pendingRecovery()){showPendingRecovery(preserveInputs);return;}
  if(vault.pendingOperation?.action==='registerOwner'){showSignIn();message(accountMessage("state.registration.progressRetained"),'pending');return;}
  if(vault.pendingOperation?.action==='claimAgent'){showClaim();return;}
  if(pendingSetup()){renderSetup(true);if(!preserveInputs){$('#setup-password').value='';$('#setup-saved').checked=false;}}
  else if(pendingLogin()){showSignIn();tab('login');if(!preserveInputs)$('#login-password').value='';}
  controls();
}
function authenticationPendingMessage(){
  return accountMessage("state.operation.authenticationUnknown");
}
function tab(mode){if(mode==='recovery')showForgot();else showSignIn();}
function current(){return agents.find(agent=>agent.agentId===selectedId);}
function privateFile(source=vault){const result={format:'connet-owner-v2',origin:location.origin,...(source.ownerId?{ownerId:source.ownerId}:{})};for(const key of ['sessionToken','recoveryToken','setupToken','sourceRecoveryToken','pendingOperation','claimContext','setupExchange','assistanceContext'])if(source[key])result[key]=source[key];if(source.stage==='recovered'&&source.recoveredOperation&&!result.pendingOperation)result.pendingOperation=source.recoveredOperation;if(source.pendingOperation?.action==='enableRecoveryBackup'&&source.backupPreparation?.recoveryToken)result.recoveryToken=source.backupPreparation.recoveryToken;return result;}
function downloadVault(){downloadPrivate('connet-owner.private.json',privateFile());}
function authenticationExitKey(){const pending=vault.pendingOperation;return pendingExportable()?JSON.stringify([pending.scope,pending.action,pending.operationId,pending.targetId,pending.input,vault.sessionToken,vault.recoveryToken,vault.setupToken,vault.claimContext,vault.assistanceContext]):null;}
function resetAuthenticationExit(){authExitPrepared=null;$('#auth-exit-confirm').hidden=true;$('#auth-exit-saved').checked=false;}
function prepareAuthenticationExit(){
  if(busy||!pendingExportable())return;
  downloadPrivate('connet-auth-pending.private.json',privateFile());authExitPrepared=authenticationExitKey();
  $('#auth-exit-saved').checked=false;$('#auth-exit-confirm').hidden=false;
  message(accountMessage("state.operation.exitFilePrepared"),'pending');controls();
}
function exitPendingAuthentication(){
  if(busy||!pendingExportable()||authExitPrepared!==authenticationExitKey()||!$('#auth-exit-saved').checked)return;
  logout();message(accountMessage("state.operation.exitFileHandedOver"),'pending');
}
function beginPending({action,scope,path,method='POST',body,token,kind='owner',targetId}){
  const input=pendingInput(action,body);
  const pending={operationId:body.operationId,scope,action,path,method,kind,...(input?{input}:{}),...(targetId?{targetId}:{})};
  vault.pendingOperation=pending;save();pendingPayload={body,token};controls();return pending;
}
function clearPending(){delete vault.pendingOperation;pendingPayload=null;resetAuthenticationExit();save();controls();}
const receipt=createOwnerReceiptReader({request:api,context:()=>({source:vault,ownerId:vault.ownerId,sessionToken:vault.sessionToken,recoveryToken:vault.recoveryToken,generation:readGeneration,authenticated:authenticatedOwner()}),expire:({source,sessionToken,generation})=>expireAuthenticatedSession(source,sessionToken,generation)});
function assertBackupReceipt(result,pending,ownerId,proof){
  if(!validToken(proof)||result.ownerId!==ownerId||result.recoveryId!==tokenId(proof)||result.operationId!==pending.operationId||pending.scope!==`owner:${ownerId}`)throw new BackupError('operation_mismatch');
}
async function currentBackupProof(proof,ownerId){
  try{return await recoveryOwner(proof,ownerId);}catch(error){if([401,403,404].includes(error.status))throw new BackupError('inactive_backup');throw error;}
}
async function committed(result,pending){
  assertOwnerOperationResult(result,pending,vault);assertManagerResult(result,pending,vault.ownerId);
  if(pending.action==='recover'){finishRecovery(result,pending);return;}
  if(pending.action==='enableRecoveryBackup'){
    const source=vault,proof=source.backupPreparation?.recoveryToken||source.recoveryToken;
    assertBackupReceipt(result,pending,source.ownerId,proof);
    try{await currentBackupProof(proof,source.ownerId);}catch(error){error.backupReceiptConfirmed=true;throw error;}
    if(vault!==source||source.pendingOperation?.operationId!==pending.operationId)throw new BackupError('operation_mismatch');
    vault.recoveryToken=proof;delete vault.backupPreparation;backupPrepared=null;$('#backup-confirm').hidden=true;$('#backup-saved').checked=false;
  }
  if(pending.action==='rejectRecoveryRequest'){emailFlow?.endRequest(result.ownerId,result.requestId);assistance.showResult(result);clearPending();delete vault.assistanceContext;save();showAssistancePage();message(accountMessage("state.recovery.requestRejected"),'success');return;}
  const setupTarget=pending.action==='completeSetup'?(result.agentId||setupInfo?.agentId):null;
  if(['completeSetup','login','registerOwner'].includes(pending.action)){
    if(vault.ownerId&&result.ownerId!==vault.ownerId)throw new BackupError('owner_mismatch');
    vault.ownerId=result.ownerId;vault.format='connet-owner-v2';vault.stage='managed';delete vault.setupToken;delete vault.handoffToken;delete vault.sourceRecoveryToken;setupPrepared=false;recoveryPrepared=null;
    $('#email-password').value='';$('#email-password-confirm').value='';$('#setup-password').value='';$('#login-password').value='';$('#recovery-password').value='';$('#recovery-password-confirm').value='';recoverySourceProof='';
  }
  if(pending.action==='completeSetup'){delete vault.setupExchange;delete vault.exchangeOperationId;delete vault.claimContext;delete vault.setupAccount;delete vault.completeOperationId;}
  // Only a completed login resets the selection; routine list refreshes retain it.
  if(pending.action==='login'){const intention=entryStore?.target();clearAgentSelection();selectedId='';selectionGeneration++;unavailableAgentId='';if(intention?.agentId&&(!intention.ownerId||intention.ownerId===result.ownerId))requestedAgentId=intention.agentId;else{requestedAgentId='';entryStore?.clearTarget();}}
  if(pending.action==='claimAgent'){unavailableAgentId='';selectedId=pending.targetId;selectionGeneration++;delete vault.claimContext;setupInfo=null;existingClaimIntent=false;}
  clearPending();
  if(pending.action==='replaceRuntime'){runtimePrepared=null;$('#runtime-confirm').hidden=true;$('#runtime-saved').checked=false;}

  save();
  if(recoveryIntent){await restorePasswordIntent();return;}
  const readOwner=vault,expectedRead=readGeneration+1;
  const keepWorldInputs=['saveWorldActionPolicy','saveWorldAccess'].includes(pending.action);
  const keepProfileInputs=pending.action==='unpublishProfile'&&view==='managed'&&pending.targetId===selectedId;
  try{const loaded=await loadAgents({resetProfile:keepWorldInputs?false:pending.action==='unpublishProfile'?!keepProfileInputs:!pending.targetId||pending.targetId===selectedId});if(loaded&&readOwner===vault&&expectedRead===readGeneration){
    if(pending.action==='saveWorldActionPolicy')await worldActionSettings.refresh({reset:true});
    if(pending.action==='saveWorldAccess'){resetWorldAccess(current());presentation?.rememberForm('world-access-form');}
    if(pending.action==='completeSetup'){
      const agent=agents.find(agent=>agent.agentId===setupTarget),name=agent?.profile.published?.displayName||agent?.profile.draft?.displayName||'Agent';
      message(agent?accountMessage("registration.complete.linked",{name:name}):accountMessage("state.registration.createdLinkUnconfirmed"),agent?'success':'pending');presentation?.success({title:agent?accountMessage("registration.complete.linkedTitle",{name:name}):accountMessage("state.registration.createdTitle"),username:account?.username||'',agentName:name,agentLinked:Boolean(agent),bindingUnavailable:!agent,worldAccess:agent?.worldAccess});requestFocus('#page-title');
    }else if(pending.action==='claimAgent'){const agent=agents.find(agent=>agent.agentId===pending.targetId);presentation?.success({title:agent?accountMessage("state.link.completedTitle"):accountMessage("state.link.unconfirmedTitle"),username:account?.username||'',agentName:agent?.profile.published?.displayName||agent?.profile.draft?.displayName||'Agent',agentLinked:Boolean(agent),bindingUnavailable:!agent,worldAccess:agent?.worldAccess});message(agent?accountMessage("state.link.completed"):accountMessage("state.link.currentStateUnavailable"),agent?'success':'pending');}
    else if(managerActions.has(pending.action)){const texts={saveProfile:Object.keys(pending.input.fields||{}).length===1&&pending.input.fields?.avatar?accountMessage("state.appearance.saved"):accountMessage("state.profile.saved"),saveWorldActionPolicy:accountMessage("state.participation.modeSaved"),saveWorldAccess:pending.input.intervalSeconds===null?accountMessage("state.access.stopPreferenceSaved"):accountMessage("state.access.scheduleSaved"),saveDraft:accountMessage("state.profile.restoreDraftPrepared"),publishProfile:accountMessage("state.profile.proposalPublished"),join:accountMessage("state.membership.restored"),profilePolicy:accountMessage("state.policy.saved"),participation:pending.input.paused?accountMessage("state.participation.paused"):accountMessage("state.participation.resumed")};message(texts[pending.action],'success');if(pending.action==='saveDraft')presentation?.navigate('policy');}
    else message(pending.action==='unpublishProfile'?accountMessage("state.profile.unpublished"):pending.action==='enableRecoveryBackup'?accountMessage("state.backup.activated"):accountMessage("state.operation.completedAndRefreshed"),'success');
  }}
  catch{if(readOwner===vault&&expectedRead===readGeneration)message(accountMessage("state.operation.submittedRefreshUnavailable"),'pending');}
}
async function executePending(pending=vault.pendingOperation){
 if(!pending||!pendingPayload)return;const busyLease=setBusy(true);const payload=pendingPayload;
 const managerCall=managerRequest(pending);
 const path=managerCall?.path||(pending.action==='unpublishProfile'?`/agents/${encodeURIComponent(pending.targetId)}/profile/unpublish`:{login:'/owner/sessions',completeSetup:'/owner/setup/complete',recover:'/owner/recoveries',registerOwner:'/owner/accounts',claimAgent:'/owner/agent-claims',rejectRecoveryRequest:'/owner/recovery-assistance/reject',enableRecoveryBackup:'/owner/recovery-backups'}[pending.action]);
 const hadUnknown=Boolean(pending.uncertain),authSource=vault,authSession=vault.sessionToken,authGeneration=readGeneration,audible=freshAudioOperations.delete(pending.operationId);
 try{const result=await api(path||pending.path,{method:managerCall?.method||(path?'POST':pending.method),body:payload.body,token:payload.token});await committed(result,pending);if(audible&&!hadUnknown&&authSource===vault&&authSession===vault.sessionToken&&(!pending.targetId||pending.targetId===selectedId))emitWorldAudio(result.changed===false?'result-notice':'result-success',`${pending.scope}:${pending.action}:${pending.operationId}:${result.version??''}`);}
 catch(error){
  if(audible&&authSource===vault&&authSession===vault.sessionToken&&(!pending.targetId||pending.targetId===selectedId))emitWorldAudio(isUnknown(error)?'result-notice':'result-error',`${pending.scope}:${pending.action}:${pending.operationId}:unconfirmed`);
  if(error.status===401&&payload.token===authSession)expireAuthenticatedSession(authSource,authSession,authGeneration);
  if(error.recoveryReceiptConfirmed){message(accountMessage("state.recovery.receiptReadCompletionUnsaved"),'pending');return;}
  if(pending.action==='enableRecoveryBackup'&&error.code==='inactive_backup'){pending.uncertain=true;save();backupError(error);return;}
  if(pending.action==='enableRecoveryBackup'&&error.backupReceiptConfirmed){pending.uncertain=true;save();message(accountMessage("state.backup.receiptReadValidityUnknown"),'pending');return;}
  if(error.code==='operation_mismatch'){pending.uncertain=true;save();backupError(error);return;}
  if(pendingAuthentication()){
   // A first, explicit rejection cannot have committed this newly generated command.
   if(!hadUnknown&&!isUnknown(error)){
    const action=pending.action,oldRecovery=payload.token;clearPending();
    if(action==='login'){delete vault.sessionToken;save();showSignIn();message(error.code==='authentication_failed'?accountMessage("error.signIn.credentialsRetry"):errorMessage(error),'error');}
    else if(action==='recover'){delete vault.sessionToken;vault.recoveryToken=oldRecovery;delete vault.sourceRecoveryToken;save();showForgot();if(vault.assistanceContext&&['recovery_request_closed','recovery_request_expired'].includes(error.code)){try{await assistance.read(vault.assistanceContext.assistanceToken);}catch{}}message(error.code==='authentication_failed'?accountMessage("error.backup.expiredOrUsed"):errorMessage(error),'error');}
    else if(action==='enableRecoveryBackup'){delete vault.backupPreparation;backupPrepared=null;$('#backup-confirm').hidden=true;save();fail(error);}
    else if(action==='registerOwner'){showSignIn();fail(error);}
    else if(action==='claimAgent'){showClaim();fail(error);}
    else if(action==='rejectRecoveryRequest'){if(error.status===401)assistanceSession=null;if(['recovery_request_closed','recovery_request_expired'].includes(error.code)){try{await assistance.read(vault.assistanceContext.assistanceToken);}catch{}}showAssistancePage();fail(error);}
    else{setupPrepared=false;delete vault.completeOperationId;delete vault.setupAccount;save();$('#setup-saved').checked=false;renderSetup(true);fail(error);}return;
   }
   pending.uncertain=true;vault.pendingOperation=pending;save();
   message(accountMessage("state.operation.checkingCompletion"),'pending');
   if(await confirmUnknownOwnerOperation(pending,{receipt,committed}))return;
   showPendingAuthentication(true);message(authenticationPendingMessage(),'pending');
  }else if(isUnknown(error)||((pendingUnpublish()||pendingManagement())&&hadUnknown)){if(pendingUnpublish()||pendingManagement()){pending.uncertain=true;save();}message(accountMessage("state.operation.checkingSave"),'pending');if(await confirmUnknownOwnerOperation(pending,{receipt,committed}))return;if(pendingUnpublish())message(unpublishPendingMessage(error),'pending');else if(pendingManagement())message(accountMessage("state.operation.originalResultUnknown"),'pending');else fail(error);}
  else{clearPending();fail(error);if(['version_conflict','state_conflict'].includes(error.code))accountText($('#draft-note'),()=>(accountMessage("error.profile.versionConflict")));}
 }finally{setBusy(false,busyLease);}
}
async function command({action,path,method='POST',fields={},targetId=selectedId,scope=`owner:${vault.ownerId}`,token=vault.sessionToken,kind='owner',operationId=id()}){
  if(busy||vault.pendingOperation||emailFlow?.pending)return;
  try{beginPending({action,path,method,body:{operationId,...fields},token,scope,kind,targetId});if(managerActions.has(action))freshAudioOperations.add(operationId);await executePending();}catch(error){freshAudioOperations.delete(operationId);fail(error);controls();}
}
async function checkResult(){
 if(busy||!vault.pendingOperation)return;const busyLease=setBusy(true);const pending=vault.pendingOperation;
 try{await committed(await receipt(pending),pending);}
 catch(error){if(['operation_mismatch','inactive_backup'].includes(error.code)){backupError(error);return;}if(pendingBackup()&&error.backupReceiptConfirmed){message(accountMessage("state.backup.activationConfirmedValidityUnknown"),'pending');return;}if(pendingPayload){setBusy(false,busyLease);await executePending(pending);return;}if(pendingAuthentication()){showPendingAuthentication(true);message(authenticationPendingMessage(),'pending');}else message(accountMessage("state.operation.resultUnknownRetry"),'pending');}
 finally{setBusy(false,busyLease);}
}
async function previewHandoff(){
  const source=vault,proof=source.claimContext?.handoffToken||source.handoffToken;
  if(!validToken(proof)){delete vault.claimContext;save();showSignIn();message(accountMessage("error.entry.expired"),'error');return;}
  const busyLease=setBusy(true),feedback=feedbackGeneration;let previewRead=false;
  try{const result=await api(`/owner-handoffs/${encodeURIComponent(tokenId(proof))}`,{token:proof});if(vault!==source||busyLease!==busyRevision||feedback!==feedbackGeneration)return;
    previewRead=true;
    setupInfo=result;const saved=findSetupProgress({agentId:result.agentId,generation:result.generation});if(saved){activateSavedSetup(saved);const active=vault;try{await resume();}finally{if(vault===active)setBusy(false,busyLease);}return;}vault.claimContext={agentId:result.agentId,generation:result.generation,handoffToken:proof};save();
    if(vault.sessionToken){try{const loaded=await loadAgents();if(loaded&&vault===source)showClaim();return;}catch(error){if(![401,403].includes(error.status))throw error;}}
    if(vault!==source)return;renderSetup(false);emailFlow.openRegistration(registrationTarget());message(accountMessage("state.registration.reviewAgent"));
  }catch(error){if(vault!==source||busyLease!==busyRevision)return;if(!isUnknown(error)&&!vault.claimContext?.agentId){delete vault.claimContext;save();}if(feedback!==feedbackGeneration)return;showSignIn();if(!previewRead&&!isUnknown(error)&&['authentication_failed','insufficient_scope','target_not_accessible','generation_conflict'].includes(error.code))message(accountMessage("error.entry.expired"),'error');else fail(error);}
  finally{if(vault===source)setBusy(false,busyLease);}
}
async function readSetupPublic(){
  const info=setupInfo,generation=++setupPublicGeneration;
  setupPublicAbort?.abort();const controller=new AbortController();setupPublicAbort=controller;
  const picture=$('#setup-public-avatar'),name=$('#setup-public-name'),hint=$('#setup-public-hint');
  picture.replaceChildren();picture.hidden=true;hint.hidden=true;accountText(name,()=>(accountMessage("registration.targetLoading")));
  setupAvatar=null;
  const current=()=>generation===setupPublicGeneration&&setupInfo===info&&view==='auth'&&(!$('#setup-view').hidden||(emailFlow.active&&emailFlow.target?.agentId===info?.agentId));
  const unavailable=()=>{accountText(name,()=>(accountMessage("state.profile.publicNameUnavailable")));hint.hidden=false;emitState();};
  if(!info?.agentId){unavailable();return;}
  try{
    // This anonymous projection never receives the private handoff or setup proof.
    const result=await api(`/public/agents/${encodeURIComponent(info.agentId)}`,{signal:controller.signal});
    if(!current())return;
    if(result?.agentId!==info.agentId){unavailable();return;}
    const profile=result.profile,publicName=typeof profile?.displayName==='string'?profile.displayName.trim():'';
    accountText(name,()=>(publicName||accountMessage("state.profile.publicNameUnavailable")));hint.hidden=Boolean(publicName);if(publicName){vault.setupAgentName=publicName;save();}
    if(profile?.avatar){
      setupAvatar=result.appearance??profile.avatar;avatar(picture,{...profile,appearance:setupAvatar},info.agentId);picture.hidden=false;
    }
    emitState();
  }catch{if(current())unavailable();}
}
function renderSetup(restricted){
  showAuth();$('#setup-view').hidden=false;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=true;
  accountText($('#setup-agent-id'),()=>(publicIdLabel(setupInfo?.publicId)));
  accountText($('#setup-expiry'),()=>(typeof setupInfo?.expiresAt==='number'?(restricted?accountMessage("registration.expiry.completeBy",{time:stamp(setupInfo.expiresAt)}):accountMessage("registration.expiry.validUntil",{time:stamp(setupInfo.expiresAt)})):accountMessage("state.setup.expiryUnknown")));
  $('#setup-preview').hidden=restricted;$('#setup-form').hidden=!restricted;$('#setup-resume-info').hidden=!pendingSetup();
  accountText($('#credentials-download'),()=>(pendingSetup()?accountMessage("state.backup.downloadAgain"):accountMessage("backup.download")));accountText($('#setup-complete'),()=>(pendingSetup()?accountMessage("state.setup.continue"):accountMessage("state.registration.createAndLink")));
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
  try{const target=registrationTarget();if(!target){message(accountMessage("error.setup.handoffPreviewRequired"),'error');return;}emailFlow.openRegistration(target);}catch(error){fail(error);}
}
function prepareSetup(){
  if(busy)return;
  if(pendingSetup()){if(!setupProofsReady())return;downloadPrivate('connet-owner.private.json',privateFile());message(accountMessage("state.backup.sameBackupPrepared"),'pending');controls();return;}
  if(vault.pendingOperation)return;
  try{const fields=accountFields($('#setup-username').value,$('#setup-email').value);if(!setupPrepared||JSON.stringify(fields)!==JSON.stringify(vault.setupAccount)){vault.setupAccount=fields;vault.sessionToken=credential('session');vault.recoveryToken=credential('recovery');vault.completeOperationId=id();vault.stage='setup_prepared';save();setupPrepared=true;}
    // This exact key is available if completing setup commits but loses its response.
    const file={...privateFile(),pendingOperation:{operationId:vault.completeOperationId,scope:`setup:${tokenId(vault.setupToken)}`,action:'completeSetup',kind:'setup',input:vault.setupAccount}};
    downloadPrivate('connet-owner.private.json',file);$('#setup-saved').disabled=false;message(accountMessage("state.setup.confirmBackupBeforeAgents"));controls();
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
    message(accountMessage("state.backup.sameNewBackupPrepared"),'pending');controls();return;
  }
  if(vault.pendingOperation)return;const ownerId=recoveryOwnerId.trim(),oldToken=recoverySourceProof.trim();
  if(!ownerId||!validToken(oldToken)){message(accountMessage("error.backup.selectValid"),'error');return;}
  try{recoveryPrepared??={uiLocale:getLocale(),ownerId,oldToken,recoveryToken:credential('recovery'),sessionToken:credential('session'),operationId:id()};
    if(recoveryPrepared.ownerId!==ownerId||recoveryPrepared.oldToken!==oldToken){recoveryPrepared=null;prepareRecovery();return;}
    const file={format:'connet-owner-v2',origin:location.origin,ownerId,recoveryToken:recoveryPrepared.recoveryToken,sessionToken:recoveryPrepared.sessionToken,sourceRecoveryToken:recoveryPrepared.oldToken,...(vault.assistanceContext?{assistanceContext:vault.assistanceContext}:{}),pendingOperation:{operationId:recoveryPrepared.operationId,scope:`owner:${ownerId}`,action:'recover',kind:'recovery',input:{uiLocale:recoveryPrepared.uiLocale}}};
    downloadPrivate('connet-owner-recovery.private.json',file);$('#recovery-saved').disabled=false;message(accountMessage("state.recovery.saveNewBackup"));controls();
  }catch(error){fail(error);}
}
async function recover(event){event.preventDefault();
  if(busy||!$('#recovery-saved').checked)return;
  if(pendingRecovery()){
    if(!recoveryProofsReady())return;
    const oldToken=recoverySourceProof.trim(),password=$('#recovery-password').value;
    if(!validToken(oldToken)||password.length<12){message(accountMessage("state.recovery.resumeWithPreviousBackup"),'pending');return;}
    const pending=vault.pendingOperation;recoveryIntent=false;
    pendingPayload={token:oldToken,body:{operationId:pending.operationId,password,recoveryToken:vault.recoveryToken,sessionToken:vault.sessionToken,credentialsSaved:true,...(pending.input?.uiLocale===undefined?{}:{uiLocale:pending.input.uiLocale}),...(vault.assistanceContext?{assistanceToken:vault.assistanceContext.assistanceToken}:{})}};
    await executePending({...pending,path:'/owner/recoveries',method:'POST'});return;
  }
  if(!recoveryPrepared)return;
  if(recoveryPrepared.ownerId!==recoveryOwnerId.trim()||recoveryPrepared.oldToken!==recoverySourceProof.trim()){recoveryPrepared=null;$('#recovery-saved').checked=false;controls();message(accountMessage("error.recovery.identityChanged"),'error');return;}
  try{const next=recoveryPrepared;vault.ownerId=next.ownerId;vault.sessionToken=next.sessionToken;vault.recoveryToken=next.recoveryToken;vault.sourceRecoveryToken=next.oldToken;vault.stage='recovery_prepared';recoveryIntent=false;save();await command({action:'recover',path:'/owner/recoveries',targetId:null,token:next.oldToken,operationId:next.operationId,kind:'recovery',fields:{uiLocale:next.uiLocale,password:$('#recovery-password').value,recoveryToken:next.recoveryToken,sessionToken:next.sessionToken,credentialsSaved:true,...(vault.assistanceContext?{assistanceToken:vault.assistanceContext.assistanceToken}:{})}});}catch(error){fail(error);}
}

async function loadAgents({resetProfile=true}={}){
  if(vault.stage==='recovered'){showRecoveryCompleted();return false;}
  let explicitTarget=false;
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
    vault.ownerId=result.ownerId;vault.stage='managed';save();agents=result.agents;account=nextAccount;accountSession=session;sessionPhase='ready';
    accountText($('#account-name'),()=>(account.username));
    accountText($('#backup-capability'),()=>(validToken(vault.recoveryToken)?accountMessage("state.backup.browserHasRecovery"):accountMessage("state.backup.sessionCannotRecover")));
    view='managed';$('#auth-view').hidden=true;$('#manage-view').hidden=false;$('#session-actions').hidden=false;accountText($('#page-title'),()=>(accountMessage("manager.myAgents")));accountText($('#page-description'),()=>(accountMessage("state.account.agentsDescription")));
    if(requestedAgentId){
      const intention=entryStore?.target();if(intention?.ownerId&&intention.ownerId!==result.ownerId){requestedAgentId='';unavailableAgentId='';entryStore.clearTarget();}
    }
    if(requestedAgentId){
      explicitTarget=true;
      entryStore?.rememberTarget(result.ownerId,requestedAgentId);
      if(agents.some(agent=>agent.agentId===requestedAgentId)){if(selectedId!==requestedAgentId)selectionGeneration++;selectedId=requestedAgentId;unavailableAgentId='';message('');}
      else{unavailableAgentId=requestedAgentId;selectedId='';selectionGeneration++;message(accountMessage("error.agent.unavailable"),'error');}
      requestedAgentId='';
    }
    if(unavailableAgentId)selectedId='';
    else if(!agents.some(a=>a.agentId===selectedId)){selectedId=readAgentSelection(result.ownerId,agents)||agents[0]?.agentId||'';selectionGeneration++;resetProfile=true;}
    if(selectedId)rememberAgentSelection(result.ownerId,agents,selectedId);
    renderList();renderAgent(resetProfile);await loadInvites(session,generation);
    if(!currentRead())return false;presentation?.managed();controls();if(unavailableAgentId)presentation?.unavailable(unavailableAgentId);else if(explicitTarget)presentation?.navigate('overview');if(vault.claimContext)showClaim();return true;
  }catch(error){if(!currentRead())return false;if(error.status===401)expireAuthenticatedSession(source,session,generation);else{sessionPhase='error';emitState();}throw error;}
}
async function loadInvites(){await inviteUI.refresh();}
function renderList(){
  accountText($('#agent-count'),()=>(String(agents.length)));$('#agent-list').replaceChildren();$('#agent-select').replaceChildren();
  for(const agent of agents){const profile=agent.profile.published||agent.profile.draft||{},name=profile.displayName||accountMessage("state.agent.unnamedResident");
    const option=el('option','',`${name} · ${publicIdLabel(agent.publicId)}`);option.value=agent.agentId;option.selected=selectedId===agent.agentId;$('#agent-select').append(option);
    const button=el('button');button.type='button';button.setAttribute('aria-pressed',String(selectedId===agent.agentId));button.dataset.agentId=agent.agentId;
    const image=el('div','avatar-wrap');avatar(image,{displayName:name,appearance:agent.profile.publishedAppearance??agent.profile.published?.avatar??null},agent.agentId);const info=el('span');info.append(el('strong','',name),el('small','mono',publicIdLabel(agent.publicId)));button.append(image,info);button.addEventListener('click',()=>selectAgent(agent.agentId));$('#agent-list').append(button);
  }
}
async function selectAgent(agentId){if(hasPending()||!authenticatedOwner()||emailFlow.unfinished||assistance.token||vault.claimContext||recoveryPrepared||!agents.some(a=>a.agentId===agentId))return;
  if(agentId===selectedId){return navigateManager('overview');}
  if(runtimePrepared||backupPrepared){message(accountMessage("state.file.confirmBeforeSwitch"),'pending');return;}
  const confirmation=confirmationSnapshot();
  if(presentation?.dirty()&&!await confirmAction(accountMessage("manager.switchAgent"),accountMessage("state.agent.switchUnsavedConfirmation"),accountMessage("state.agent.discardAndSwitch")))return;
  if(!sameConfirmation(confirmation)||!agents.some(agent=>agent.agentId===agentId))return;
  const focused=document.activeElement;
  const focusRoot=$('#agent-list').contains(focused)?$('#agent-list'):null;
  const focusedAgent=focused?.dataset?.agentId;
  unavailableAgentId='';entryStore?.clearTarget();selectedId=agentId;rememberAgentSelection(vault.ownerId,agents,selectedId);selectionGeneration++;runtimePrepared=null;$('#runtime-confirm').hidden=true;$('#runtime-saved').checked=false;renderList();renderAgent(true);message(accountMessage("state.agent.switched"));controls();
  presentation?.navigate('overview');emitState();
  if(focusRoot&&focusedAgent){const replacement=$$('[data-agent-id]',focusRoot).find(button=>button.dataset.agentId===focusedAgent);replacement?.focus({preventScroll:true});}
}
function resetWorldAccess(agent){const access=agent?.worldAccess,seconds=agent&&access?.agentId===agent.agentId?access.intervalSeconds:null,unit=seconds&&seconds%3600===0?3600:seconds&&seconds%60===0?60:seconds===null?60:1;$('#world-access-unit').value=String(unit);$('#world-access-interval').value=seconds===null?'':String(seconds/unit);}
function renderAgent(resetProfile=true){
  const agent=current();$('#empty-agents').hidden=Boolean(agent)||agents.length>0;
  for(const selector of ['#agent-summary','#profile-panel','#policy-panel','#membership-panel','#runtime-panel'])$(selector).hidden=!agent;
  presentation?.agent(agent);
  if(!agent)return;const profile=agent.profile,p=profile.published||{},member=agent.membership;if(profile.published)appearanceRequiredAgentId='';$('#profile-appearance-needed').hidden=appearanceRequiredAgentId!==agent.agentId;
  accountText($('#selected-name'),()=>(p.displayName||`Agent ${publicIdLabel(agent.publicId)}`));accountText($('#selected-id'),()=>(accountMessage("identity.numberSummary",{publicId:publicIdLabel(agent.publicId)})));avatar($('#selected-avatar'),{...p,appearance:profile.publishedAppearance??p.avatar},agent.agentId);
  const publicPath=residentPath(agent.publicId);if(publicPath)$('#profile-link').href=publicPath;else $('#profile-link').removeAttribute('href');
  $('#status-row').replaceChildren(...(member.platformRestricted?[el('span','status warn',accountMessage("manager.platformRestricted"))]:[]));
  accountText($('#profile-state'),()=>(profile.published?accountMessage("state.profile.active"):accountMessage("state.profile.restorationNeeded")));$('#draft-required-hint').hidden=true;
  accountText($('#confirmation-source'),()=>(profile.confirmationSource==='platform_default'?accountMessage("state.profile.platformDefaultPublic"):''));
  const modeNames={agent_autonomous:accountMessage("manager.modeAutonomous"),owner_specified:accountMessage("manager.modeOwner"),proposal_required:accountMessage("manager.modeProposal")},fieldNames={displayName:accountMessage("manager.name"),avatar:accountMessage("manager.appearance"),bio:accountMessage("manager.bio"),interests:accountMessage("manager.interests")};
  accountText($('#policy-current'),()=>(accountMessage("policy.currentSummary",{mode:modeNames[profile.mode],fields:profile.lockedFields.map(field=>fieldNames[field]).join('、')||accountMessage("state.policy.noLockedFields")})));
  const access=agent.worldAccess,accessReady=access?.agentId===agent.agentId&&Number.isSafeInteger(access.version)&&access.version>0&&(access.intervalSeconds===null||(Number.isSafeInteger(access.intervalSeconds)&&access.intervalSeconds>0));
  accountText($('#world-access-current'),()=>(!accessReady?accountMessage("state.access.unavailable"):access.intervalSeconds===null?accountMessage("state.access.noInterval"):access.intervalSeconds%3600===0?accountMessage("access.interval.hours",{count:access.intervalSeconds/3600}):access.intervalSeconds%60===0?accountMessage("access.interval.minutes",{count:access.intervalSeconds/60}):accountMessage("access.interval.seconds",{count:access.intervalSeconds})));
  accountText($('#world-access-adoption'),()=>(worldAccessAdoptionText(access)));
  if(resetProfile){
    $('#display-name').value=p.displayName||'';$('#bio').value=p.bio||'';$('#interests').value=(p.interests||[]).join('，');$('#profile-mode').value=profile.mode;$$('input[name=lock]').forEach(input=>input.checked=profile.lockedFields.includes(input.value));
    resetWorldAccess(accessReady?agent:null);worldActionSettings?.resetInputs();accountText($('#draft-note'),()=>(''));
    presentation?.rememberForm();
  }
  const preview=$('#published-preview');preview.replaceChildren();if(profile.published){preview.append(el('strong','',p.displayName),el('p','',p.bio||accountMessage("state.profile.bioEmpty")));const tags=el('div','tag-row');tags.append(...(p.interests||[]).map(text=>el('span','tag',text)));preview.append(tags);}else preview.append(el('p','',member.state==='joined'?accountMessage("state.profile.unavailableWhileJoined"):accountMessage("state.profile.unavailableWhileExited")));
  const draft=profile.draft||{},hasDraft=Boolean(draft.displayName&&draft.avatar),proposal=Boolean(profile.proposalPending)||(!profile.published&&hasDraft);
  $('#proposal-review').hidden=!proposal;const proposalBody=$('#proposal-review-body');proposalBody.replaceChildren();if(proposal){const picture=el('div');avatar(picture,{...draft,appearance:profile.draftAppearance??draft.avatar},agent.agentId);proposalBody.append(picture,el('strong','',draft.displayName),el('p','',draft.bio||accountMessage("state.profile.bioEmpty")),el('p','',accountMessage("profile.interestsSummary",{interests:(draft.interests||[]).join('、')||accountMessage("state.profile.interestsEmpty")})));}
  const legacy=member.state!=='joined';$('#legacy-world-state').hidden=!legacy;$('#join-agent').hidden=!legacy||!profile.published;$('#prepare-legacy-profile').hidden=!legacy||Boolean(profile.published);
  accountText($('#legacy-world-description'),()=>(profile.published?accountMessage("state.membership.exitedWithProfile"):accountMessage("state.membership.exitedWithoutProfile")));
  accountText($('#pause-agent'),()=>(member.ownerPaused?accountMessage("state.participation.resumeAction"):accountMessage("manager.pause")));accountText($('#member-description'),()=>(member.platformRestricted?accountMessage("state.restriction.ownerCannotLift"):''));
}
async function refresh(resetProfile=false){
  if(hasPending()||emailFlow.unfinished||assistance.token||vault.claimContext||recoveryPrepared)return;const retainedDraft=!resetProfile&&Boolean(presentation?.dirty()),previousAgentId=selectedId,previousVersion=current()?.profile.version,busyLease=setBusy(true);
  try{const loaded=await loadAgents({resetProfile});if(!loaded||busyLease!==busyRevision)return;
    if(unavailableAgentId){message(accountMessage("error.agent.unavailable"),'error');return;}
    const concurrentUpdate=!resetProfile&&current()?.agentId===previousAgentId&&current()?.profile.version!==previousVersion,retainedInput=retainedDraft||concurrentUpdate;
    accountText($('#draft-note'),()=>(retainedInput?accountMessage("state.profile.inputKeptReview"):''));
    message(retainedInput?accountMessage("state.profile.refreshedInputKept"):current()?accountMessage("state.profile.upToDate"):accountMessage("state.account.stateUpToDate"),'success');
  }catch(error){if(busyLease!==busyRevision)return;fail(error);if(error.status===401)showSignIn();}
  finally{setBusy(false,busyLease);}
}
function refreshSummary(){
  // A browser focus event is not navigation into management or a recovery step.
  if(view!=='managed'||!$('#auth-view').hidden||!vault.sessionToken||unfinishedTask()||presentation?.dirty()||busy)return;
  return refresh(false);
}
function fieldsFromForm(){return {displayName:$('#display-name').value.trim(),bio:$('#bio').value,interests:$('#interests').value.split(/[,，]/).map(value=>value.trim()).filter(Boolean)};}
function explicitlyEnteredProfile(agent){const fields=fieldsFromForm();if(agent.profile.published)return fields;return{displayName:fields.displayName,...(fields.bio?{bio:fields.bio}:{}),...(fields.interests.length?{interests:fields.interests}:{}),...(presentation?.dirty('appearance-form')&&presentation?.selectedAppearance?.()?{avatar:presentation.selectedAppearance()}:{})};}
function profileFields(fields){const removeFields=[];if(fields.bio===''){delete fields.bio;removeFields.push('bio');}if(fields.interests?.length===0){delete fields.interests;removeFields.push('interests');}return{fields,...(removeFields.length?{removeFields}:{})};}
function submitProfile(event){event.preventDefault();const agent=current();if(!agent)return;const fields=fieldsFromForm();if(!fields.displayName||fields.displayName.length>60){message(accountMessage("error.profile.nameInvalid"),'error');return;}if(fields.interests.length>10||fields.interests.some(value=>value.length>40)){message(accountMessage("error.profile.interestsInvalid"),'error');return;}return command({action:'saveProfile',path:`/agents/${encodeURIComponent(agent.agentId)}/profile`,method:'PUT',targetId:agent.agentId,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,...profileFields(explicitlyEnteredProfile(agent))}});}
async function publishProfile(){const agent=current();if(!agent||hasPending()||!agent.profile.draft?.displayName||!agent.profile.draft.avatar)return;if(presentation?.dirty()){message(accountMessage("state.profile.saveBeforeAdopting"),'pending');return;}const confirmation=confirmationSnapshot();if(!await confirmAction(accountMessage("state.profile.adoptTitle"),accountMessage("state.profile.adoptConfirmation"),accountMessage("state.profile.adoptAndPublish"))||!sameConfirmation(confirmation))return;return command({action:'publishProfile',path:`/agents/${encodeURIComponent(agent.agentId)}/profile/publish`,targetId:agent.agentId,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion}});}
async function prepareLegacyProfile(){const agent=current();if(!agent||agent.membership.state==='joined'||agent.profile.published||hasPending())return;const fields={...fieldsFromForm(),avatar:presentation?.selectedAppearance?.()},confirmation=confirmationSnapshot();try{managerInput('saveDraft',{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,fields});}catch{message(accountMessage("error.profile.restoreFieldsInvalid"),'error');return;}if(!await confirmAction(accountMessage("manager.prepareRestore"),accountMessage("state.profile.prepareRestorationIntro")+(agent.profile.proposalPending?accountMessage("state.profile.replaceExistingProposal"):'')+accountMessage("state.profile.prepareRestorationNext"),accountMessage("state.profile.prepareRestorationAction"))||!sameConfirmation(confirmation))return;return command({action:'saveDraft',path:`/agents/${encodeURIComponent(agent.agentId)}/profile/draft`,method:'PUT',targetId:agent.agentId,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,fields}});}
function saveWorldAccess(event){event.preventDefault();const agent=current(),access=agent?.worldAccess;if(!agent||access?.agentId!==agent.agentId||(!Number.isSafeInteger(access.version)||access.version<1))return;let intervalSeconds;try{intervalSeconds=parseIntervalSeconds($('#world-access-interval').value,$('#world-access-unit').value);}catch{message(accountMessage("error.access.intervalInvalid"),'error');return;}return command({action:'saveWorldAccess',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/world-access`,method:'PUT',targetId:agent.agentId,fields:{expectedVersion:access.version,intervalSeconds}});}
function unpublishPendingMessage(error){return [401,403].includes(error?.status)?accountMessage("state.profile.unpublishUnknownSessionExpired"):accountMessage("state.profile.unpublishUnknown");}
function policy(event){event.preventDefault();const agent=current();if(!agent)return;return command({action:'profilePolicy',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/profile-policy`,method:'PUT',fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,mode:$('#profile-mode').value,lockedFields:$$('input[name=lock]:checked').map(i=>i.value)}});}
async function membership(){const agent=current();if(!agent||!agent.profile.published||agent.membership.state==='joined'||hasPending())return;if(presentation?.dirty()){message(accountMessage("state.membership.saveBeforeRestoring"),'pending');return;}const confirmation=confirmationSnapshot();if(!await confirmAction(accountMessage("manager.returnToWorld"),accountMessage("state.membership.restoreConfirmation"),accountMessage("state.membership.restoreAction"))||!sameConfirmation(confirmation))return;return command({action:'join',path:`/agents/${encodeURIComponent(agent.agentId)}/membership/join`,targetId:agent.agentId,fields:{expectedVersion:agent.membership.version,expectedProfileVersion:agent.profile.version}});}
async function pause(){const agent=current();if(!agent||hasPending()||presentation?.dirty())return;const confirmation=confirmationSnapshot();if(!await confirmAction(agent.membership.ownerPaused?accountMessage("state.participation.resumeAction"):accountMessage("manager.pause"),accountMessage("state.participation.pauseConfirmation"),accountMessage("common:action.confirm"))||!sameConfirmation(confirmation))return;return command({action:'participation',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/participation`,method:'PUT',fields:{expectedVersion:agent.membership.version,paused:!agent.membership.ownerPaused}});}
function prepareRuntime(){const agent=current();if(!agent||busy||vault.pendingOperation)return;
  runtimePrepared={agentId:agent.agentId,expectedVersion:agent.runtimeVersion,runtimeToken:credential('runtime'),operationId:id()};
  downloadPrivate('connet-runtime.private.json',{format:'connet-runtime-v1',origin:location.origin,...runtimePrepared});$('#runtime-saved').checked=false;accountText($('#runtime-confirm-description'),()=>(accountMessage("runtime.replaceTarget",{name:agent.profile.published?.displayName||agent.profile.draft?.displayName||accountMessage("state.agent.unnamedResident")})));
  $('#runtime-confirm').hidden=false;controls();
}
function replaceRuntime(){const agent=current();if(!runtimePrepared||!agent||!$('#runtime-saved').checked)return;if(runtimePrepared.agentId!==agent.agentId||runtimePrepared.expectedVersion!==agent.runtimeVersion){runtimePrepared=null;$('#runtime-confirm').hidden=true;message(accountMessage("error.runtime.targetOrGenerationChanged"),'error');return;}return command({action:'replaceRuntime',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/runtime-access/replace`,operationId:runtimePrepared.operationId,fields:{expectedVersion:runtimePrepared.expectedVersion,runtimeToken:runtimePrepared.runtimeToken}});}
async function revokeRuntime(){const agent=current();if(!agent)return;const confirmation=confirmationSnapshot();if(!await confirmAction(accountMessage("runtime.revoke"),accountMessage("runtime.revokeTarget",{name:agent.profile.published?.displayName||agent.profile.draft?.displayName||publicIdLabel(agent.publicId)})))return;if(!sameConfirmation(confirmation)||current()?.agentId!==agent.agentId)return;return command({action:'revokeRuntime',path:`/owner/agents/${encodeURIComponent(agent.agentId)}/runtime-access/revoke`,fields:{expectedVersion:agent.runtimeVersion}});}
function authenticatedOwner(){return Boolean(account&&account.ownerId===vault.ownerId&&accountSession===vault.sessionToken&&vault.sessionToken&&!recoveryIntent&&!pendingRecovery()&&vault.stage!=='recovered');}

function prepareBackup(){
  if(busy||vault.pendingOperation||emailFlow.pending||!vault.sessionToken)return;
  try{backupPrepared??={ownerId:vault.ownerId,sessionToken:vault.sessionToken,recoveryToken:credential('recovery'),operationId:id()};
    if(backupPrepared.ownerId!==vault.ownerId||backupPrepared.sessionToken!==vault.sessionToken){backupPrepared=null;return;}
    const file={format:'connet-owner-v2',origin:location.origin,ownerId:vault.ownerId,sessionToken:vault.sessionToken,recoveryToken:backupPrepared.recoveryToken,pendingOperation:{operationId:backupPrepared.operationId,scope:`owner:${vault.ownerId}`,action:'enableRecoveryBackup'}};
    downloadPrivate('connet-owner-recovery.private.json',file);$('#backup-confirm').hidden=false;$('#backup-saved').checked=false;controls();message(accountMessage("state.backup.confirmBeforeActivation"));
  }catch(error){fail(error);}
}
async function enableBackup(){
  if(!backupPrepared||!$('#backup-saved').checked||busy||vault.pendingOperation)return;
  if(backupPrepared.ownerId!==vault.ownerId||backupPrepared.sessionToken!==vault.sessionToken)return;
  try{vault.backupPreparation={recoveryToken:backupPrepared.recoveryToken};save();await command({action:'enableRecoveryBackup',path:'/owner/recovery-backups',targetId:null,operationId:backupPrepared.operationId,fields:{recoveryToken:backupPrepared.recoveryToken,credentialsSaved:true}});}catch(error){fail(error);}
}

async function importBackupProgress(saved,busyLease){
  const active=vault,pending=saved.pendingOperation,candidate=saved.recoveryToken;
  if(active.ownerId&&active.ownerId!==saved.ownerId)throw new BackupError('owner_mismatch');
  const previous=active.pendingOperation;
  if(previous&&(previous.action!==pending.action||previous.scope!==pending.scope||previous.operationId!==pending.operationId||(active.backupPreparation?.recoveryToken||active.recoveryToken)!==candidate))throw new BackupError('operation_mismatch');
  if(recoveryIntent&&!previous){
    let usable=false;try{await currentBackupProof(candidate,saved.ownerId);usable=true;}catch(error){if(error.code!=='inactive_backup')throw error;}
    if(vault!==active||busyLease!==busyRevision)return;
    // An active independent proof needs no live historical session to recover.
    if(usable){await useRecoveryBackup(saved);return;}
  }
  const session=active.ownerId===saved.ownerId&&active.sessionToken?active.sessionToken:saved.sessionToken;
  const accountView=await api('/owner/account',{token:session});
  if(vault!==active||busyLease!==busyRevision)return;
  if(accountView.ownerId!==saved.ownerId)throw new BackupError('owner_mismatch');
  let originalResult;
  try{originalResult=await api(`/operations/${encodeURIComponent(pending.operationId)}?scope=${encodeURIComponent(pending.scope)}&action=enableRecoveryBackup`,{token:session});}
  catch(error){if(error.status!==404&&!isUnknown(error))throw error;}
  if(vault!==active||busyLease!==busyRevision)return;
  if(originalResult){
    assertBackupReceipt(originalResult,pending,saved.ownerId,candidate);
    // Reject a historical, now revoked file before it can replace the vault.
    try{await currentBackupProof(candidate,saved.ownerId);}catch(error){if(error instanceof BackupError||!isUnknown(error))throw error;}
    if(vault!==active||busyLease!==busyRevision)return;
  }
  const base=active.ownerId===saved.ownerId?active:{format:'connet-owner-v2',origin:location.origin,ownerId:saved.ownerId};
  vault={...base,sessionToken:session,pendingOperation:pending,backupPreparation:{recoveryToken:candidate}};
  pendingPayload={token:session,body:{operationId:pending.operationId,recoveryToken:candidate,credentialsSaved:true}};recoveryIntent=false;save();
  if(originalResult)await committed(originalResult,pending);else await resume();
}

async function importCredentials(event){
 const file=event.target.files?.[0];if(!file||busy||emailFlow.pending)return;const busyLease=setBusy(true);$('#origin-help').hidden=true;sessionOnlyBackup=null;$('#continue-management').hidden=true;
 try{
  if(file.size>32768)throw new BackupError('invalid_backup');const saved=parseOwnerBackup(await file.text(),location.origin);if(busyLease!==busyRevision)return;
  if(event.target.id==='recovery-source-import'){
   if(!pendingRecovery()||saved.ownerId!==vault.ownerId||!saved.recoveryToken)throw new BackupError('invalid_backup');
   await recoveryOwner(saved.recoveryToken,vault.ownerId);vault.sourceRecoveryToken=saved.recoveryToken;save();recoverySourceProof=saved.recoveryToken;message(accountMessage("state.recovery.originalBackupRead"));return;
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
  if(saved.pendingOperation?.action==='enableRecoveryBackup'){await importBackupProgress(saved,busyLease);return;}
  if((['unpublishProfile','rejectRecoveryRequest'].includes(saved.pendingOperation?.action)||managerActions.has(saved.pendingOperation?.action))&&vault.sessionToken&&!vault.pendingOperation){
   const active=vault;if(active.ownerId!==saved.ownerId)throw new BackupError('owner_mismatch');
   const [currentAccount,owned]=await Promise.all([api('/owner/account',{token:active.sessionToken}),api('/owner/agents',{token:active.sessionToken})]);
   if(busyLease!==busyRevision||vault!==active)return;
   if(currentAccount.ownerId!==saved.ownerId||owned.ownerId!==saved.ownerId||!owned.agents.some(agent=>agent.agentId===saved.pendingOperation.targetId))throw new BackupError('owner_mismatch');
   // Keep the newly authenticated session and recovery material; import only the original command.
   vault={...active,pendingOperation:saved.pendingOperation,...(saved.assistanceContext?{assistanceContext:saved.assistanceContext}:{})};pendingPayload=null;recoveryIntent=false;save();await resume();return;
  }
  vault=saved;account=null;pendingPayload=null;setupInfo=null;setupPublicGeneration++;setupPublicAbort?.abort();setupPrepared=false;recoveryPrepared=null;save();
  if(vault.assistanceContext){recoveryIntent=false;await resume();return;}
  if(pendingUnpublish()||pendingManagement()){recoveryIntent=false;await resume();return;}
  if(recoveryIntent){
   if(vault.pendingOperation){
    try{await committed(await receipt(vault.pendingOperation),vault.pendingOperation);return;}catch(error){if(error instanceof BackupError)throw error;}
   }
   if(vault.recoveryToken){try{await useRecoveryBackup({...vault});return;}catch(error){if(error instanceof BackupError||isUnknown(error))throw error;}}
   if(pendingRecovery()){
    if(vault.sourceRecoveryToken)await recoveryOwner(vault.sourceRecoveryToken,vault.ownerId);
    showPendingRecovery();message(vault.sourceRecoveryToken?accountMessage("state.recovery.previousProgressFound"):accountMessage("state.recovery.previousProgressKept"),'pending');return;
   }
   if(pendingSetup()&&vault.setupToken){try{await readSetup();message(accountMessage("state.setup.previousIncomplete"));return;}catch(error){if(isUnknown(error))throw error;}}
   if(!vault.pendingOperation&&vault.sessionToken&&!vault.recoveryToken){await restorePasswordIntent();return;}
   throw new BackupError('unavailable_backup');
  }
  await resume();
 }catch(error){
  if(busyLease!==busyRevision)return;
  // Keep the imported command and its pre-saved proofs intact even when verification fails.
  if(event.target.id==='recovery-source-import'){showPendingRecovery(true);backupError(error.code==='authentication_failed'?new BackupError('unavailable_backup'):error);return;}
  if(error instanceof BackupError){if(vault.pendingOperation&&error.code==='unavailable_backup'){showPendingAuthentication();message(accountMessage("state.backup.containsPendingProgress"),'pending');return;}$('#recovery-pick-step').hidden=false;$('#recovery-form').hidden=true;backupError(error);}
  else if(vault.pendingOperation&&isUnknown(error)){showPendingAuthentication();message(authenticationPendingMessage(),'pending');}
  else{$('#recovery-pick-step').hidden=false;$('#recovery-form').hidden=true;backupError(error.code==='authentication_failed'?new BackupError('unavailable_backup'):error);}
 }finally{event.target.value='';setBusy(false,busyLease);}
}
function logout({keepPanelOpen=false}={}){inviteUI.clear();appearanceRequiredAgentId='';entryStore?.clear();emailFlow?.clear();sessionPhase='anonymous';backupPrepared=null;clearAgentSelection();assistanceSession=null;assistance.clear();recoveryOwnerId='';recoverySourceProof='';recoveryIntent=false;sessionOnlyBackup=null;readGeneration++;selectionGeneration++;readAbort?.abort();agents=[];selectedId='';pendingPayload=null;setupInfo=null;setupPrepared=false;recoveryPrepared=null;runtimePrepared=null;account=null;accountSession='';unavailableAgentId='';requestedAgentId='';presentation?.account(null);$('#agent-list').replaceChildren();$('#agent-select').replaceChildren();$('#published-preview').replaceChildren();accountText($('#selected-name'),()=>(''));accountText($('#selected-id'),()=>(''));$('#selected-avatar').replaceChildren();$('#claim-agent-summary').replaceChildren();$('#invite-list').replaceChildren();accountText($('#account-name'),()=>(''));accountText($('#agent-count'),()=>('0'));for(const selector of ['#runtime-confirm','#backup-confirm'])$(selector).hidden=true;for(const selector of ['#runtime-saved','#backup-saved'])$(selector).checked=false;presentation?.reset();$$('#profile-form input,#profile-form textarea').forEach(input=>input.value='');existingClaimIntent=false;setupPublicGeneration++;setupPublicAbort?.abort();resetAuthenticationExit();vault={format:'connet-owner-v2',origin:location.origin};for(const key of [storageKey,'connet.owner.progress.v2']){try{sessionStorage.removeItem(key);}catch{}}renderSavedProgress();$$('[data-owner-password]').forEach(input=>{input.value='';input.type='password';const toggle=root.querySelector(`[aria-controls="${input.id}"][data-password-toggle]`);if(toggle){accountText(toggle,()=>(accountMessage("auth.show")));accountAttribute(toggle,'aria-label',()=>(accountMessage("auth.showPassword")));toggle.setAttribute('aria-pressed','false');}});$('#login-identifier').value='';recoveryOwnerId='';$$('#email-view input,#setup-account-fields input').forEach(input=>{input.value='';input.checked=false;});showSignIn();message(accountMessage("state.signIn.signedOut"));controls();if(!keepPanelOpen)onLogout();}
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
    if(pendingUnpublish()||pendingManagement()){
      // The imported command is allowlisted before reconstructing its fixed path/body.
      vault.pendingOperation=parseOwnerBackup(JSON.stringify(privateFile()),location.origin).pendingOperation;
      const pending=vault.pendingOperation;unavailableAgentId='';selectedId=pending.targetId;
      pendingPayload={token:vault.sessionToken,body:{operationId:pending.operationId,...pending.input}};
    }
    vault.pendingOperation.uncertain=true;save();showSignIn();message(accountMessage("state.operation.resuming"),'pending');controls();
    try{const result=await receipt(vault.pendingOperation);await committed(result,vault.pendingOperation);return;}
    catch(error){
      if(['operation_mismatch','inactive_backup'].includes(error.code)){backupError(error);return;}
      if(pendingBackup()&&error.backupReceiptConfirmed){showPendingAuthentication();message(accountMessage("state.backup.receiptReadValidityPending"),'pending');return;}
      if(vault.assistanceContext){try{await assistance.read(vault.assistanceContext.assistanceToken);}catch{}}
      if(pendingUnpublish()||pendingManagement()){try{await loadAgents();}catch(readError){if([401,403].includes(readError.status))error=readError;}message(pendingUnpublish()?unpublishPendingMessage(error):accountMessage("state.operation.targetAndProgressKept"),'pending');}
      if(pendingSetup()&&vault.setupToken){try{await readSetup();}catch{}}
      if(pendingAuthentication()){showPendingAuthentication();message(authenticationPendingMessage(),'pending');}
    }
    return;
  }
  if(vault.stage==='recovered'){showRecoveryCompleted();return;}
  if(vault.claimContext?.handoffToken&&!vault.claimContext.agentId){await previewHandoff();return;}
  if(vault.sessionToken){try{await loadAgents();return;}catch(error){if(![401,403].includes(error.status))throw error;}}
  if(vault.setupToken){try{await readSetup();message(accountMessage("state.setup.redownloadBeforeResuming"));return;}catch(error){if(![401,403].includes(error.status))throw error;const exchange=vault.setupExchange;if(exchange){setupInfo={ownerId:exchange.ownerId,agentId:exchange.agentId,generation:exchange.generation};vault.claimContext={agentId:exchange.agentId,generation:exchange.generation,handoffToken:exchange.handoffToken};save();renderSetup(false);message(accountMessage("state.setup.exchangeUnconfirmed"),'pending');return;}}}
  if(vault.handoffToken||vault.claimContext?.handoffToken){await previewHandoff();return;}if(vault.recoveryToken){recoveryIntent=true;await useRecoveryBackup({...vault});return;}showSignIn();
}
// Account forms share the original receipt, pre-saved proof and backup machinery.
function pendingInput(action,body){
  if(managerActions.has(action))return managerInput(action,body);
  if(action==='recover'&&body.uiLocale!==undefined)return{uiLocale:body.uiLocale};
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
function showRegistration(){if(vault.pendingOperation)return;if(!emailFlow.unfinished)clearFlowFeedback();try{emailFlow.openRegistration(registrationTarget());}catch(error){fail(error);}}
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
  accountText($('#claim-account'),()=>(account?.ownerId===vault.ownerId?accountMessage("auth.currentAccount",{username:account.username||accountMessage("state.account.currentFallback")}):accountMessage("state.account.checking")));
  if(account?.ownerId!==vault.ownerId){const session=vault.sessionToken,ownerId=vault.ownerId;void api('/owner/account',{token:session}).then(result=>{if(session!==vault.sessionToken||result.ownerId!==ownerId||$('#claim-view').hidden)return;account=result;accountSession=session;accountText($('#claim-account'),()=>(accountMessage("auth.currentAccount",{username:result.username||accountMessage("state.account.currentFallback")})));controls();}).catch(()=>{if(session===vault.sessionToken&&!$('#claim-view').hidden)accountText($('#claim-account'),()=>(accountMessage("state.account.checkUnavailable")));});}
  const target=vault.claimContext.agentId,summary=$('#claim-agent-summary');$('#claim-view').dataset.agentId=target;const targetNode=()=>{const node=el('p','mono',target);node.id='claim-agent-id';return node;};summary.replaceChildren(el('strong','',accountMessage("state.profile.loadingPublicName")));
  void api(`/public/agents/${encodeURIComponent(target)}`).then(result=>{if(vault.claimContext?.agentId!==target||$('#claim-view').hidden)return;summary.replaceChildren();if(result.profile?.avatar)avatar(summary,{...result.profile,appearance:result.appearance??result.profile.avatar},target);summary.append(el('strong','',result.profile?.displayName||accountMessage("state.profile.publicNameUnavailable")));const details=el('details','owner-context');details.append(el('summary','',accountMessage("state.agent.viewResidentId")),targetNode());summary.append(details);}).catch(()=>{if(vault.claimContext?.agentId===target)summary.replaceChildren(el('p','',accountMessage("state.profile.publicNameUnavailableCheckId")),targetNode());});
  controls();requestFocus('#claim-confirm');
}
async function claimAgent(){
  if(busy||!vault.sessionToken||!vault.claimContext)return;const c=vault.claimContext,p=vault.pendingOperation;
  const fields={agentId:c.agentId,expectedGeneration:c.generation,...(c.handoffToken?{handoffToken:c.handoffToken}:{setupToken:c.setupToken})};
  if(p?.action==='claimAgent'){pendingPayload={token:vault.sessionToken,body:{operationId:p.operationId,...fields}};await executePending();return;}
  if(p)return;await command({action:'claimAgent',path:'/owner/agent-claims',targetId:c.agentId,fields});
}
async function openInvite(){await navigateManager('invite');if(presentation?.page==='invite')$('#prepare-invite').focus({preventScroll:true});}

emailFlow=createOwnerEmailFlow({
  root,onView:()=>{presentation?.sync();onView();},modeChanged:()=>renderVerificationMode(),
  uiState:()=>({busy,mainPending:Boolean(vault.pendingOperation)}),lock:()=>setBusy(true),unlock:lease=>setBusy(false,lease),focus:requestFocus,
  show:node=>{clearCompletedTaskNotice();if(!vault.pendingOperation&&globalNotice.dataset.backupError)message('');showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=true;$('#forgot-view').hidden=true;node.hidden=false;},
  targetName:agentId=>agentId===setupInfo?.agentId?vault.setupAgentName:agents.find(agent=>agent.agentId===agentId)?.profile.published?.displayName,
  registrationTarget,
  back:()=>{if(assistance.token)showAssistancePage();else showSignIn({fresh:true});},
  registered:async(result,progress)=>{
    if(vault.pendingOperation)throw new BackupError('operation_mismatch');
    const target=progress.target,mode=result.verificationMode||'resend',exp=mode==='experience';
    if(mode!==(progress.verificationMode||'resend')||!['experience','resend'].includes(mode)||result.emailVerified!==!exp||result.ownerId!==(target?.ownerId||progress.attemptId)||result.sessionId!==tokenId(progress.sessionToken)||(target&&(result.agentId!==target.agentId||result.managementStatus!=='managed')))throw new BackupError('operation_mismatch');
    // Persist the actual session before discarding the email completion key.
    vault={format:'connet-owner-v2',origin:location.origin,ownerId:result.ownerId,sessionToken:progress.sessionToken,stage:'managed'};save();
    recoveryIntent=false;recoveryPrepared=null;setupInfo=null;setupPrepared=false;account=null;accountSession='';unavailableAgentId='';requestedAgentId='';selectedId=target?.agentId||'';
    assistance.clear();try{await loadAgents();const agent=target&&agents.find(agent=>agent.agentId===target.agentId),created=agent?accountMessage("registration.complete.linked",{name:agent.profile.published?.displayName||'Agent'}):target?accountMessage("state.registration.createdLinkUnconfirmed"):accountMessage("state.registration.createdCanInvite");message(accountMessage("registration.complete.verified",{result:created,verification:exp?accountMessage("state.registration.trialVerifiedEmailUnverified"):accountMessage("state.registration.emailVerified")}),target&&!agent?'pending':'success');presentation?.success({title:accountMessage("state.registration.createdTitle"),username:account?.username||'',agentName:agent?.profile.published?.displayName||agent?.profile.draft?.displayName||'',agentLinked:Boolean(agent),bindingUnavailable:Boolean(target&&!agent),worldAccess:agent?.worldAccess});requestFocus('#page-title');}
    catch{showSignIn();message(accountMessage("state.registration.createdListUnavailable"),'pending');}
  },
  recovered:result=>{if(vault.ownerId===result.ownerId){vault={format:'connet-owner-v2',origin:location.origin};save();clearAgentSelection({ownerId:result.ownerId});}assistanceSession=null;},
  loginAfterRecovery:()=>{assistance.clear();recoveryIntent=false;showSignIn();message(accountMessage("state.recovery.signInWithNewPassword"));},
});
$('#prepare-backup').addEventListener('click',prepareBackup);$('#backup-saved').addEventListener('change',controls);$('#enable-backup').addEventListener('click',enableBackup);
$('#email-recovery-start').addEventListener('click',()=>{if(!busy&&!vault.pendingOperation&&assistance.ready&&!assistance.terminal)void emailFlow.openRecovery(assistance.snapshot());});

$('#setup-next').addEventListener('click',()=>{try{if(!$('#setup-account-fields').hidden&&!pendingSetup())validateAccountForm('setup');}catch(error){fail(error);return;}if(!$('#setup-password').reportValidity())return;clearResolvedValidation();$('#setup-password-step').hidden=true;$('#setup-backup-step').hidden=false;$('#credentials-download').focus();});
$('#recovery-next').addEventListener('click',()=>{if(!$('#recovery-password').reportValidity()||!$('#recovery-password-confirm').reportValidity())return;if($('#recovery-password').value!==$('#recovery-password-confirm').value){message(accountMessage("email.validation.passwordMismatch"),'error');return;}if(!validToken(recoverySourceProof)){message(accountMessage("error.recovery.previousBackupRequired"),'error');return;}$('#recovery-password-step').hidden=true;$('#recovery-backup-step').hidden=false;$('#recovery-download').focus();});
$('#forgot-password').addEventListener('click',()=>showForgot());$('#import-help').addEventListener('click',()=>showForgot('manage'));
$('#backup-recovered-login').addEventListener('click',()=>{showSignIn();message(accountMessage("state.recovery.signInWithNewPassword"));});$('#backup-recovered-world').addEventListener('click',()=>presentation?.hide());
$('#recovery-mail-help').addEventListener('click',()=>{$('#recovery-choices').hidden=true;$('#recovery-backup-choice').hidden=true;$('#recovery-email-help').hidden=false;accountText($('#recovery-title'),()=>(accountMessage("recoveryView.askAgent")));emitState();});
$('#recovery-use-backup').addEventListener('click',()=>{$('#recovery-choices').hidden=true;$('#recovery-email-help').hidden=true;$('#recovery-backup-choice').hidden=false;accountText($('#recovery-title'),()=>(accountMessage("recoveryView.backupAction")));emitState();});
$('#recovery-choices-back').addEventListener('click',()=>showForgot());
function emailHelpPrompt(){return `我忘记了 ${location.origin} 的主人登录密码。请为你当前正式绑定的主人创建登录找回请求，并通过安全私密方式把入口交给我。${emailFlow.verificationMode==='experience'?'当前为体验阶段，我会在网页自行输入体验验证码。':'我会在网页自行收取和输入原邮箱验证码。'}不要接收、代收或保存我的验证码、密码或主人恢复文件，也不要重新注册或改变绑定。`;}
function renderVerificationMode(){const exp=emailFlow?.verificationMode==='experience';accountText($('#recovery-mail-help'),()=>(exp?accountMessage("state.recovery.viaTrialCode"):accountMessage("recoveryView.originalEmail")));accountText($('#email-recovery-start'),()=>(exp?accountMessage("state.recovery.viaTrialCode"):accountMessage("recoveryView.emailAction")));for(const key of ['#recovery-mode-note','#recovery-choice-mode-note']){$(key).hidden=!exp;accountText($(key),()=>(exp?accountMessage("state.recovery.trialCodeNotice"):''));}accountText($('#assistance-guidance'),()=>(exp?accountMessage("state.recovery.trialGuidance"):accountMessage("recoveryView.methodsHint")));accountText($('#assistance-proof-note'),()=>(exp?accountMessage("state.recovery.trialProofNote"):accountMessage("recoveryView.noBackupHint")));accountText($('#email-help-intro'),()=>(exp?accountMessage("state.recovery.trialHelpIntro"):accountMessage("state.recovery.emailHelpIntro")));accountText($('#email-help-prompt'),()=>(emailHelpPrompt()));}
accountText($('#email-help-prompt'),()=>(emailHelpPrompt()));$('#copy-email-help').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(emailHelpPrompt());accountText($('#email-help-status'),()=>(accountMessage("state.recovery.helpPromptCopied")));}catch{accountText($('#email-help-status'),()=>(accountMessage("state.recovery.helpPromptCopyManually")));}});
$('#back-to-login').addEventListener('click',async()=>{if(vault.pendingOperation){message(accountMessage("state.operation.saveBeforeExit"),'pending');return;}const managed=hasAssistanceSession();assistanceSession=null;assistance.clear();delete vault.assistanceContext;save();recoveryIntent=false;recoveryPrepared=null;recoveryOwnerId='';recoverySourceProof='';$('#recovery-password').value='';$('#recovery-password-confirm').value='';if(!managed){showSignIn({fresh:true});return;}const busyLease=setBusy(true);try{await loadAgents();presentation?.navigate('agents');}catch(error){fail(error);showSignIn();}finally{setBusy(false,busyLease);}});
$('#reject-assistance').addEventListener('click',rejectAssistance);
$('#assistance-refresh').addEventListener('click',async()=>{if(busy||vault.pendingOperation)return;const busyLease=setBusy(true);try{assistanceSession=null;await assistance.read();await verifyAssistanceSession();showAssistancePage();}catch(error){fail(error);}finally{setBusy(false,busyLease);}});
$('#recovery-source-import').addEventListener('change',importCredentials);
$('#resume-saved-progress').addEventListener('click',()=>showForgot('manage'));
$('#continue-management').addEventListener('click',async()=>{if(!sessionOnlyBackup||busy)return;recoveryIntent=false;vault=sessionOnlyBackup;save();const busyLease=setBusy(true);try{await loadAgents();}catch(error){if(busyLease===busyRevision)fail(error);}finally{setBusy(false,busyLease);}});
const findPrompt=`我忘记了 ${location.origin} 的登录密码，希望保留原居民。请只读检查你已获准保存的原注册文件和私密交付记录，以原身份记录的网站为准。只告诉我主人登录备份的保存线索和适用网站；没有验证的有效性请明确说未验证。不要搜索其他目录，不要在聊天输出密码、token、完整私密链接或文件内容，不上传文件。只有 Agent 运行文件或失效初始交接时，请说明它们不能重设主人密码。不要重注册、覆盖身份、改权限或重置；由我在原网站选择登录备份继续。`;
accountText($('#find-backup-prompt'),()=>(findPrompt));$('#copy-find-backup').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(findPrompt);accountText($('#copy-find-result'),()=>(accountMessage("state.backup.findPromptCopied")));}catch{accountText($('#copy-find-result'),()=>(accountMessage("state.backup.findPromptCopyManually")));}});
$('#setup-start').addEventListener('click',startSetup);$('#credentials-download').addEventListener('click',prepareSetup);$('#setup-form').addEventListener('submit',completeSetup);$('#setup-saved').addEventListener('change',controls);
$('#login-form').addEventListener('submit',login);$('#recovery-form').addEventListener('submit',recover);$('#recovery-download').addEventListener('click',prepareRecovery);$('#recovery-saved').addEventListener('change',controls);$('#login-tab').addEventListener('click',()=>tab('login'));$('#recovery-tab').addEventListener('click',()=>tab('recovery'));$('#show-login').addEventListener('click',()=>{showSignIn({fresh:true});tab('login');});$('#credentials-import').addEventListener('change',importCredentials);
$('#check-result').addEventListener('click',checkResult);$('#retry-operation').addEventListener('click',()=>executePending());$('#refresh-agents').addEventListener('click',()=>refresh());$('#logout').addEventListener('click',requestLogout);$('#download-current').addEventListener('click',downloadVault);$('#agent-select').addEventListener('change',event=>selectAgent(event.target.value));
$('#prepare-auth-exit').addEventListener('click',prepareAuthenticationExit);$('#auth-exit-saved').addEventListener('change',controls);$('#confirm-auth-exit').addEventListener('click',exitPendingAuthentication);
$('#profile-form').addEventListener('submit',submitProfile);$('#publish-profile').addEventListener('click',publishProfile);$('#prepare-legacy-profile').addEventListener('click',prepareLegacyProfile);$('#reload-profile').addEventListener('click',()=>refresh(false));$('#policy-form').addEventListener('submit',policy);$('#join-agent').addEventListener('click',membership);$('#world-access-form').addEventListener('submit',saveWorldAccess);$('#world-access-refresh').addEventListener('click',()=>refresh(false));$('#pause-agent').addEventListener('click',pause);
$('#prepare-runtime').addEventListener('click',prepareRuntime);$('#runtime-saved').addEventListener('change',controls);$('#replace-runtime').addEventListener('click',replaceRuntime);$('#revoke-runtime').addEventListener('click',revokeRuntime);
$('#show-register').addEventListener('click',()=>showRegistration());
$('#setup-existing').addEventListener('click',()=>{if(keepClaimFromSetup())showSignIn();});
$('#claim-confirm').addEventListener('click',claimAgent);$('#claim-cancel').addEventListener('click',()=>{if(hasPending())return;delete vault.claimContext;setupInfo=null;save();presentation?.navigate('agents');presentation?.hide();void refresh();});
$('#claim-switch').addEventListener('click',async()=>{if(hasPending())return;const confirmation=confirmationSnapshot(),context=vault.claimContext;if(!await confirmAction(accountMessage("form.switchAccount"),accountMessage("state.account.switchConfirmation"),accountMessage("form.switchAccount"))||!sameConfirmation(confirmation)||vault.claimContext!==context)return;logout({keepPanelOpen:true});vault.claimContext=context;save();showSignIn();message(accountMessage("state.link.signInToTargetAccount"));});
$('#add-agent').addEventListener('click',openInvite);$('#empty-invite').addEventListener('click',openInvite);
function confirmationSnapshot(){return{source:vault,session:vault.sessionToken,selectedId,selection:selectionGeneration,read:readGeneration};}
function sameConfirmation(snapshot){return vault===snapshot.source&&vault.sessionToken===snapshot.session&&selectedId===snapshot.selectedId&&selectionGeneration===snapshot.selection&&readGeneration===snapshot.read&&!hasPending();}
function hasPending(){return Boolean(presentation?.confirming)||busy||Boolean(vault.pendingOperation)||Boolean(emailFlow.pending);}
async function navigateManager(next){
  if(!authenticatedOwner()){if(next==='entry')presentation?.entry();else showSignIn();return;}
  if(hasPending()){message(accountMessage("state.operation.confirmBeforeNavigation"),'pending');return;}
  if(emailFlow.unfinished||assistance.token||vault.claimContext||recoveryPrepared){emitState();return;}
  if(next==='refresh'){await refresh(false);return;}
  if(next==='repair-appearance'&&appearanceRequiredAgentId===selectedId&&current()&&!current().profile.published){presentation?.navigate('appearance');controls();return;}
  if(next==='discard-appearance'){if(presentation?.dirty('appearance-form')){const confirmation=confirmationSnapshot();if(!await confirmAction(accountMessage("state.appearance.discardTitle"),accountMessage("state.appearance.discardConfirmation"),accountMessage("manager.discardChanges"))||!sameConfirmation(confirmation))return;presentation.resetAppearance();controls();}return;}
  if(!['agents','overview','profile','appearance','logs','participation','policy','runtime','invite','security','public-preview','unavailable','entry'].includes(next))return;
  if(next===presentation?.page)return;
  if(runtimePrepared||backupPrepared){message(accountMessage("state.file.confirmBeforeNavigation"),'pending');return;}
  const requiresAgent=!['agents','invite','security','unavailable','entry'].includes(next);
  if(requiresAgent&&!current()){presentation?.navigate(unavailableAgentId?'unavailable':'agents');return;}
  const confirmation=confirmationSnapshot();
  // These two tabs form one explicit correction when no public profile exists.
  // Retain only the Owner's inputs; an Agent proposal is never copied into them.
  const correctingAppearance=current()&&!current().profile.published&&['appearance','profile'].includes(next)&&['appearance','profile'].includes(presentation?.page);
  if(presentation?.dirty()&&!correctingAppearance){
    if(!await confirmAction(accountMessage("state.editor.leaveTitle"),accountMessage("state.editor.leaveConfirmation"),accountMessage("state.editor.discardAndLeave"))||!sameConfirmation(confirmation))return;
    renderAgent(true);
  }
  if(!sameConfirmation(confirmation))return;
  clearCompletedTaskNotice();presentation?.navigate(next);controls();
}
async function leaveEditing(){
  if(hasPending()||runtimePrepared||backupPrepared){message(accountMessage("state.operation.confirmBeforeNavigation"),'pending');return false;}
  const confirmation=confirmationSnapshot();
  if(presentation?.dirty()){
    if(!await confirmAction(accountMessage("state.editor.leaveTitle"),accountMessage("state.editor.leaveConfirmation"),accountMessage("state.editor.discardAndLeave"))||!sameConfirmation(confirmation))return false;
    renderAgent(true);
  }
  return sameConfirmation(confirmation);
}
async function requestLogout(){if(busy||emailFlow.pending){message(accountMessage("state.signOut.confirmOperationFirst"),'pending');return;}if(vault.pendingOperation){prepareAuthenticationExit();return;}const confirmation=confirmationSnapshot();if((presentation?.dirty()||runtimePrepared||backupPrepared)&&!await confirmAction(accountMessage("state.signOut.title"),accountMessage("state.signOut.unsavedConfirmation"),accountMessage("auth.signOut")))return;if(!sameConfirmation(confirmation))return;logout();}
$('#appearance-form').addEventListener('submit',event=>{event.preventDefault();const agent=current();if(!agent||hasPending()||!presentation?.selectedAppearance?.())return;if(agent.profile.published?.avatar?.kind==='custom'){void presentation.restoreBuiltin();return;}void command({action:'saveProfile',path:`/agents/${encodeURIComponent(agent.agentId)}/profile`,method:'PUT',targetId:agent.agentId,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,...(agent.profile.published?{fields:{avatar:presentation.selectedAppearance()}}:{fields:explicitlyEnteredProfile(agent)})}});});
async function handleEntry(){
  const entry=entryStore?.peek();if(!entry)return false;
  const protectedTask=vault.stage==='recovered'||emailFlow.unfinished||assistance.token||recoveryPrepared||(recoveryIntent&&!$('#recovery-form').hidden)||runtimePrepared||backupPrepared;
  const unarchivableClaim=vault.claimContext&&!vault.claimContext.handoffToken&&!vault.setupToken;
  if(hasPending()||protectedTask||unarchivableClaim){message(accountMessage("state.agent.finishTaskBeforeSwitch"),'pending');return true;}
  if(presentation?.dirty()){const confirmation=confirmationSnapshot();if(!await confirmAction(accountMessage("state.agent.openNewTaskTitle"),accountMessage("state.agent.openNewTaskConfirmation"),accountMessage("state.action.discardAndContinue"))||!sameConfirmation(confirmation))return true;}
  const lease=setBusy(true),feedback=feedbackGeneration;
  try{
    if(vault.claimContext?.handoffToken&&vault.claimContext.handoffToken!==entry.proof)entryStore.retain({kind:'handoff',proof:vault.claimContext.handoffToken});
    if(entry.kind==='handoff'){
      if(!receiveHandoff(entry.proof))return true;
      entryStore.consume(entry);await resume();
    }else{
      if(hasRestrictedSetup(vault))archiveProgress(vault);
      await openAssistance(entry.proof);entryStore.consume(entry);
    }
  }catch(error){if(!isUnknown(error)&&error.code!=='private_storage_unavailable')entryStore.consume(entry);if(feedback===feedbackGeneration)fail(error);}
  finally{setBusy(false,lease);}
  return true;
}
async function open(mode='account',agentId=''){const feedback=feedbackGeneration;try{await navigateAccount(mode,agentId);}catch(error){if(feedback===feedbackGeneration)fail(error);}}
async function navigateAccount(mode='account',agentId=''){
  if(!started)return;
  if(mode==='resume'){if(entryStore?.pending&&!hasPending()&&!unfinishedTask()&&!presentation?.dirty())await handleEntry();emitState();return;}
  if(hasPending()){presentation?.sync();message(accountMessage("state.operation.progressKeptConfirm"),'pending');return;}
  // Opening account/security is navigation only when no active task owns the view.
  // In particular, registration owns it before its first email request exists.
  if(mode==='account'&&!entryStore?.pending&&(unfinishedTask()||authTaskVisible())){emitState();return;}
  if(await handleEntry())return;
  if(emailFlow.unfinished){await emailFlow.resume();return;}
  if(mode!=='login'&&mode!=='register'&&(assistance.token||vault.claimContext||vault.setupToken||recoveryPrepared||(recoveryIntent&&!$('#recovery-form').hidden))){emitState();return;}
  if(mode==='register'){showRegistration();return;}
  if(mode==='login'){showSignIn({fresh:true});return;}
  if(mode==='recover'){showForgot();return;}
  if(mode==='entry'){if(authenticatedOwner())await navigateManager('entry');else presentation?.entry();return;}
  if(authenticatedOwner()&&!agentId){await navigateManager(mode==='account'?'security':['profile','overview','appearance'].includes(mode)?mode:'agents');return;}
  if(authenticatedOwner()&&agentId===selectedId){await navigateManager('overview');return;}
  if(agentId&&agentId!==selectedId&&(runtimePrepared||backupPrepared)){message(accountMessage("state.file.confirmBeforeTargetChange"),'pending');return;}
  if(vault.sessionToken){if(agentId&&agentId!==selectedId&&presentation?.dirty()){const confirmation=confirmationSnapshot();if(!await confirmAction(accountMessage("manager.switchAgent"),accountMessage("state.agent.loadAnotherConfirmation"),accountMessage("state.action.discardAndContinue"))||!sameConfirmation(confirmation))return;}const source=vault,lease=setBusy(true);try{if(agentId){entryStore?.rememberTarget(undefined,agentId);requestedAgentId=agentId;}const loaded=await loadAgents({resetProfile:!presentation?.dirty()||Boolean(agentId&&agentId!==selectedId)});if(loaded&&vault===source&&lease===busyRevision&&!vault.claimContext)presentation?.navigate(mode==='account'?'security':['profile','overview','appearance'].includes(mode)?(unavailableAgentId?'unavailable':mode):'agents');}catch(error){if(vault===source&&lease===busyRevision){fail(error);if(error.status===401)showSignIn();}}finally{setBusy(false,lease);}return;}
  showSignIn({fresh:true});
}
async function start(intent={}){if(started)return;started=true;
  try{renderSavedProgress();}catch(error){fail(error);}
  if(!storageAvailable){showSignIn();message(accountMessage("error.storage.unavailable"),'error');return;}
  if(vault.pendingOperation){const lease=setBusy(true);try{await resume();}catch(error){fail(error);}finally{setBusy(false,lease);}return;}
  if(emailFlow.unfinished){await emailFlow.resume();return;}
  if(vault.stage==='recovered'){showRecoveryCompleted();return;}
  if(assistance.token||vault.claimContext||vault.setupToken){const lease=setBusy(true);try{if(assistance.token)await openAssistance(assistance.token);else await resume();}catch(error){fail(error);}finally{setBusy(false,lease);}if(entryStore?.pending)await handleEntry();return;}
  if(await handleEntry())return;
  if(intent.agentId)requestedAgentId=intent.agentId;
  const lease=setBusy(true);sessionPhase=vault.sessionToken?'loading':'anonymous';emitState();
  try{await resume();}catch(error){fail(error);}finally{setBusy(false,lease);}
}
// The HUD can request only this read projection. Credentials never leave this controller.
async function readPerception(operation,input={}, {signal}={}){
  if(operation==='capabilities')return api('/capabilities',{signal});
  const source=vault,session=vault.sessionToken,generation=readGeneration,target=selectedId,revision=summary().observationRevision;
  const current=()=>source===vault&&session===vault.sessionToken&&target===selectedId&&revision===summary().observationRevision&&authenticatedOwner();
  if(!current())throw new ApiError(sessionPhase==='expired'?'session_expired':'authentication_required',401);
  let path,method='GET',body;
  if(operation==='discovery'){
    const query=new URLSearchParams({limit:'50'});if(input.pageToken)query.set('pageToken',input.pageToken);path=`/perception/discovery?${query}`;
  }else if(operation==='schema'||operation==='guide'){
    const name=operation==='schema'?input.schemaId:input.moduleId;
    if(typeof name!=='string'||!/^[a-zA-Z0-9.@_-]{1,100}$/.test(name)||!Number.isSafeInteger(input.version)||input.version<1)throw new ApiError('invalid_request',422);
    path=`/perception/${operation==='schema'?'schemas':'guides'}/${encodeURIComponent(name)}?version=${input.version}`;
  }else if(operation==='list'||operation==='detail'){
    const channel=input.channel,category=input.categoryId;
    if(!['world','inventory','inbox'].includes(channel))throw new ApiError('invalid_request',422);
    if(operation==='list'&&!(channel==='world'?['items','announcements','events'].includes(category):channel==='inventory'?category==='holdings':['messages','notifications'].includes(category)))throw new ApiError('invalid_request',422);
    if(channel!=='world'&&(!target||!agents.some(agent=>agent.agentId===target)))throw new ApiError('agent_required',409);
    body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',channel,...(channel!=='world'?{agentRef:{moduleId:'profiles',type:'profiles.agent@1',id:target}}:{})};
    if(operation==='list')Object.assign(body,{categoryId:category,limit:20,...(typeof input.pageToken==='string'?{pageToken:input.pageToken}:{})});
    else{
      const ref=input.ref;if(!ref||!['moduleId','type','id'].every(key=>typeof ref[key]==='string'&&ref[key].length>0&&ref[key].length<=180))throw new ApiError('invalid_request',422);
      Object.assign(body,{ref:{moduleId:ref.moduleId,type:ref.type,id:ref.id},...(typeof input.contentToken==='string'?{contentToken:input.contentToken}:{}),...(Number.isSafeInteger(input.knownVersion)?{knownVersion:input.knownVersion}:{})});
    }
    path=`/perception/${operation}`;method='POST';
  }else throw new ApiError('insufficient_scope',403);
  try{const result=await api(path,{method,body,token:session,signal});if(!current())throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(current()&&error.status===401)expireAuthenticatedSession(source,session,generation);throw error;}
}
// Only the four read-only Owner interaction queries are exposed to the HUD.
async function readInteraction(operation,input={}, {signal}={}){
  const source=vault,session=vault.sessionToken,generation=readGeneration,target=selectedId,revision=summary().observationRevision;
  const current=()=>source===vault&&session===vault.sessionToken&&target===selectedId&&revision===summary().observationRevision&&authenticatedOwner();
  if(!current())throw new ApiError(sessionPhase==='expired'?'session_expired':'authentication_required',401);
  if(!target||!agents.some(agent=>agent.agentId===target))throw new ApiError('agent_required',409);
  if(!['artifacts','artifact','exchanges','exchange'].includes(operation))throw new ApiError('insufficient_scope',403);
  const fields={agentId:target},validId=value=>typeof value==='string'&&value.length>0&&value.length<=180;
  if(['artifacts','exchanges'].includes(operation)){
    fields.limit=20;if(input.cursor!==undefined){if(typeof input.cursor!=='string'||!input.cursor||input.cursor.length>2048)throw new ApiError('invalid_request',422);fields.cursor=input.cursor;}
  }
  if(operation==='exchanges'){if(!['sent','received'].includes(input.direction))throw new ApiError('invalid_request',422);fields.direction=input.direction;}
  if(operation==='artifact'||operation==='exchanges'&&input.artifact!==undefined){if(!validId(input.artifact?.artifactId)||!Number.isSafeInteger(input.artifact.revision)||input.artifact.revision<1)throw new ApiError('invalid_request',422);fields.artifact={artifactId:input.artifact.artifactId,revision:input.artifact.revision};}
  if(operation==='exchange'){if(!validId(input.invitationId))throw new ApiError('invalid_request',422);fields.invitationId=input.invitationId;}
  const body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:`interaction.owner_${operation}`,input:fields};
  try{const result=await api('/gateway/query',{method:'POST',body,token:session,signal});if(!current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(current()&&error.status===401)expireAuthenticatedSession(source,session,generation);throw error;}
}
const friendshipPending=new Map(),friendshipWrites=new Map();
function friendshipContext(){
  const source=vault,session=vault.sessionToken,generation=readGeneration,target=selectedId,revision=summary().observationRevision,ownerId=account?.ownerId;
  const current=()=>source===vault&&session===vault.sessionToken&&target===selectedId&&revision===summary().observationRevision&&authenticatedOwner();
  if(!current())throw new ApiError(sessionPhase==='expired'?'session_expired':'authentication_required',401);
  if(!target||!agents.some(agent=>agent.agentId===target))throw new ApiError('agent_required',409);
  return{source,session,generation,target,ownerId,current};
}

async function avatarAssetRequest(path,{binary=false,signal,...options}={}){
 const ctx=friendshipContext(),base=`/v1/agents/${encodeURIComponent(ctx.target)}/avatar-assets`,url=new URL(path.startsWith('/v1/')?path:'/v1'+path,location.origin);
 if(url.origin!==location.origin||url.hash||!url.pathname.startsWith(base+'/'))throw new ApiError('insufficient_scope',403);
 try{
  let result;if(binary){const active=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),response=await fetch(url.pathname+url.search,{headers:{Authorization:'Bearer '+ctx.session},credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:active});if(!response.ok)throw new ApiError('avatar_asset_unavailable',response.status);result=await response.arrayBuffer();}
  else result=await api(url.pathname.slice(3)+url.search,{...options,token:ctx.session,signal});
  if(!ctx.current()||signal?.aborted)throw new DOMException('Avatar context changed','AbortError');return result;
 }catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}

function friendshipInput(operation,input,target){
  const fields={agentId:target},validId=value=>typeof value==='string'&&value.length>0&&value.length<=180;
  if(['friends','inbox'].includes(operation)){
    fields.limit=input.limit??20;if(!Number.isSafeInteger(fields.limit)||fields.limit<1||fields.limit>100)throw new ApiError('invalid_request',422);
    if(input.cursor!==undefined){if(typeof input.cursor!=='string'||!input.cursor||input.cursor.length>2048)throw new ApiError('invalid_request',422);fields.cursor=input.cursor;}
    if(input.search!==undefined){if(typeof input.search!=='string'||Array.from(input.search).length>100)throw new ApiError('invalid_request',422);fields.search=input.search;}
    if(input.order!==undefined){if(!['newest','oldest'].includes(input.order))throw new ApiError('invalid_request',422);fields.order=input.order;}
    if(operation==='inbox'&&input.state!==undefined){if(!['all','pending','accepted','declined','cancelled','expired'].includes(input.state))throw new ApiError('invalid_request',422);fields.state=input.state;}
  }
  if(operation==='inbox'){if(!['received','sent'].includes(input.direction))throw new ApiError('invalid_request',422);fields.direction=input.direction;}
  if(operation==='pair'){if(!validId(input.otherAgentId))throw new ApiError('invalid_request',422);fields.otherAgentId=input.otherAgentId;}
  if(operation==='invitation'||['accept','decline','cancel'].includes(operation)){if(!validId(input.requestId))throw new ApiError('invalid_request',422);fields.requestId=input.requestId;}
  if(['accept','decline','cancel'].includes(operation)){if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new ApiError('invalid_request',422);fields.expectedVersion=input.expectedVersion;}
  if(operation==='send'){if(!validId(input.toAgentId)||typeof input.message!=='string'||Array.from(input.message).length>120)throw new ApiError('invalid_request',422);fields.toAgentId=input.toAgentId;fields.message=input.message;}
  return fields;
}
async function readFriendship(operation,input={}, {signal}={}){
  if(!['overview','pair','friends','inbox','invitation'].includes(operation))throw new ApiError('insufficient_scope',403);const ctx=friendshipContext(),body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:`relationships.${operation}`,input:friendshipInput(operation,input,ctx.target)};
  try{const result=await api('/gateway/query',{method:'POST',body,token:ctx.session,signal});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
// Town services remain Agent-only writes. The Owner can inspect only the
// currently selected, still-bound Agent through this restricted read facade.
async function readTownService(operation,input={}, {signal}={}){
  if(!['progress','inventory','relationships','operation'].includes(operation))throw new ApiError('insufficient_scope',403);
  const ctx=friendshipContext(),fields={agentId:ctx.target};
  if(['inventory','relationships'].includes(operation)){fields.limit=50;const key=operation==='inventory'?'afterId':'afterNpcId';if(input[key]!==undefined){if(typeof input[key]!=='string'||!input[key]||input[key].length>180)throw new ApiError('invalid_request',422);fields[key]=input[key];}}
  if(operation==='operation'){if(typeof input.operationId!=='string'||!input.operationId||input.operationId.length>180)throw new ApiError('invalid_request',422);fields.operationId=input.operationId;}
  const body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:`town_services.${operation}`,input:fields};
  try{const result=await api('/gateway/query',{method:'POST',body,token:ctx.session,signal});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
// Life actions stay Agent-only. This facade exposes current-owner inspection of
// the selected Agent; it cannot submit activities, plans or cancellations.
async function readLife(operation,input={}, {signal}={}){
  const ctx=friendshipContext(),fields=lifeReadInput(operation,input,ctx.target);
  const body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:`life.${operation}`,input:fields};
  try{const result=await api('/gateway/query',{method:'POST',body,token:ctx.session,signal});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
// NPC life is observational for this Owner and always uses the selected binding.
async function readNpcLife(operation,input={}, {signal}={}){
  const ctx=friendshipContext(),fields=npcLifeReadInput(operation,input,ctx.target),body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:'npc_life.care.options',input:fields};
  try{const result=await api('/gateway/query',{method:'POST',body,token:ctx.session,signal});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
async function readGifts(operation,input={}, {signal}={}){
  const ctx=friendshipContext(),fields=giftReadInput(operation,input,ctx.target),body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:`relationships.gifts.${operation}`,input:fields};
  try{const result=await api('/gateway/query',{method:'POST',body,token:ctx.session,signal});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}

async function commandFriendship(operation,input={}){
  if(!['send','accept','decline','cancel'].includes(operation))throw new ApiError('insufficient_scope',403);const ctx=friendshipContext(),fields=friendshipInput(operation,input,ctx.target),action=`relationships.invitation.${operation}`,scope=JSON.stringify([ctx.ownerId,ctx.target,action,fields.toAgentId||fields.requestId]),storageKey=`connet.owner.friendship.pending.v1:${scope}`;
  if(friendshipWrites.has(scope))return friendshipWrites.get(scope);
  let saved=friendshipPending.get(scope);if(!saved)try{const raw=sessionStorage.getItem(storageKey);if(raw)saved=JSON.parse(raw);}catch{throw new ApiError('private_storage_unavailable',0);}
  const original=saved?.body;
  if(original&&(original.operation!==action||JSON.stringify(original.input)!==JSON.stringify(fields)||typeof original.commandId!=='string'))throw new ApiError('friendship_operation_pending',409,{pending:original.input});
  const replay=Boolean(original),body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:action,commandId:original?.commandId||id(),input:fields};
  try{sessionStorage.setItem(storageKey,JSON.stringify({body}));}catch{throw new ApiError('private_storage_unavailable',0);}friendshipPending.set(scope,{body});
  const task=(async()=>{
    try{
      let result;if(replay)try{result=await api('/gateway/receipts/query',{method:'POST',token:ctx.session,body:{protocolVersion:1,consumerId:body.consumerId,purpose:'human-inspect',operation:action,commandId:body.commandId}});}catch(error){if(error.status!==404)throw error;}
      result??=await api('/gateway/commands',{method:'POST',token:ctx.session,body});const receipt=result?.data;
      if(result?.protocolVersion!==1||receipt?.key?.domain!=='relationships'||receipt.key.action!==action||receipt.key.commandId!==body.commandId||receipt.key.principal?.kind!=='owner'||receipt.key.principal.id!==ctx.ownerId||!['committed','rejected','conflict','expired'].includes(receipt.outcome))throw new ApiError('response_unknown',0);
      const projected=receipt.outcome==='committed'?readFriendshipResult(receipt.result,ctx.target):null;
      friendshipPending.delete(scope);sessionStorage.removeItem(storageKey);
      if(!ctx.current())throw new DOMException('Context changed','AbortError');
      if(receipt.outcome!=='committed')throw new ApiError(receipt.result?.code||'state_conflict',409);
      if(!replay)emitWorldAudio(['accepted','declined','cancelled'].includes(projected.disposition)?'result-success':'result-notice',`${scope}:${body.commandId}:${projected.request?.version??projected.relationship?.version??''}`);
      return{protocolVersion:result.protocolVersion,instanceId:result.instanceId,data:projected};
    }catch(error){if(error.status>=400&&error.status<500&&!['unknown_commit','commit_result_unknown','response_unknown','retry_same_operation'].includes(error.code)){friendshipPending.delete(scope);try{sessionStorage.removeItem(storageKey);}catch{}}if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
    finally{friendshipWrites.delete(scope);}
  })();friendshipWrites.set(scope,task);return task;
}
// Exactly one authorized mailbox page; the view owns search and continuation.
async function readMailbox(input={}, {signal}={}){
  const ctx=friendshipContext(),body={box:input.box,limit:input.limit??20};
  if(!['received','sent'].includes(body.box)||!Number.isSafeInteger(body.limit)||body.limit<1||body.limit>50)throw new ApiError('invalid_request',422);
  if(input.search!==undefined){if(typeof input.search!=='string'||Array.from(input.search).length>100)throw new ApiError('invalid_request',422);body.search=input.search;}
  if(input.order!==undefined){if(!['newest','oldest'].includes(input.order))throw new ApiError('invalid_request',422);body.order=input.order;}
  if(input.cursor!==undefined){if(typeof input.cursor!=='string'||!input.cursor||input.cursor.length>4096)throw new ApiError('invalid_request',422);body.cursor=input.cursor;}
  try{const result=await api(`/owner/agents/${encodeURIComponent(ctx.target)}/mailbox/query`,{method:'POST',body,token:ctx.session,signal});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
async function readWorldActionPolicy({signal}={}){
  const ctx=friendshipContext();
  try{const value=await api(`/agents/${encodeURIComponent(ctx.target)}/world-action-policy`,{token:ctx.session,signal});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return value;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
async function readFriends({signal,search,order,cursor,limit}={}){
  const source=vault,session=vault.sessionToken,generation=readGeneration,target=selectedId,revision=summary().observationRevision;
  const current=()=>source===vault&&session===vault.sessionToken&&target===selectedId&&revision===summary().observationRevision&&authenticatedOwner();
  if(!current())throw new ApiError(sessionPhase==='expired'?'session_expired':'authentication_required',401);
  if(!target||!agents.some(agent=>agent.agentId===target))throw new ApiError('agent_required',409);
  const fields=friendshipInput('friends',{search,order,cursor,limit},target),query=new URLSearchParams();for(const [key,value]of Object.entries(fields))if(key!=='agentId')query.set(key,String(value));
  try{const result=await api(`/owner/agents/${encodeURIComponent(target)}/friends?${query}`,{token:session,signal});if(!current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(current()&&error.status===401)expireAuthenticatedSession(source,session,generation);throw error;}
}
async function readWallet({signal}={}){
  const source=vault,session=vault.sessionToken,generation=readGeneration,target=selectedId,revision=summary().observationRevision;
  const current=()=>source===vault&&session===vault.sessionToken&&target===selectedId&&revision===summary().observationRevision&&authenticatedOwner();
  if(!current())throw new ApiError(sessionPhase==='expired'?'session_expired':'authentication_required',401);
  if(!target||!agents.some(agent=>agent.agentId===target))throw new ApiError('agent_required',409);
  const body={protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',agentRef:{moduleId:'profiles',type:'profiles.agent@1',id:target}};
  try{const result=await api('/wallet/query',{method:'POST',body,token:session,signal});if(!current())throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(current()&&error.status===401)expireAuthenticatedSession(source,session,generation);throw error;}
}
async function readBehaviorHistory(input={}, {signal}={}){
  const ctx=friendshipContext(),fields={agentId:ctx.target,timeZone:input.timeZone,limit:20};
  if(typeof fields.timeZone!=='string'||fields.timeZone.length>100)throw new ApiError('invalid_request',422);
  try{new Intl.DateTimeFormat('en',{timeZone:fields.timeZone});}catch{throw new ApiError('invalid_request',422);}
  for(const key of ['fromDate','toDate'])if(input[key]!==undefined){if(typeof input[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input[key]))throw new ApiError('invalid_request',422);fields[key]=input[key];}
  if(fields.fromDate&&fields.toDate&&fields.fromDate>fields.toDate)throw new ApiError('invalid_request',422);
  if(input.pageToken!==undefined){if(typeof input.pageToken!=='string'||!input.pageToken||input.pageToken.length>4096)throw new ApiError('invalid_request',422);fields.pageToken=input.pageToken;}
  try{const result=await api('/gateway/query',{method:'POST',token:ctx.session,signal,body:{protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',operation:'behavior.owner_history',input:fields}});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
async function readHumanBehaviorHistory(input={}, {signal}={}){
  const ctx=friendshipContext(),fields={agentId:ctx.target,timeZone:input.timeZone,limit:20};
  if(typeof fields.timeZone!=='string'||fields.timeZone.length>100)throw new ApiError('invalid_request',422);
  try{new Intl.DateTimeFormat('en',{timeZone:fields.timeZone});}catch{throw new ApiError('invalid_request',422);}
  for(const key of ['fromDate','toDate'])if(input[key]!==undefined){if(typeof input[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input[key]))throw new ApiError('invalid_request',422);fields[key]=input[key];}
  if(fields.fromDate&&fields.toDate&&fields.fromDate>fields.toDate)throw new ApiError('invalid_request',422);
  if(input.pageToken!==undefined){if(typeof input.pageToken!=='string'||!input.pageToken||input.pageToken.length>4096)throw new ApiError('invalid_request',422);fields.pageToken=input.pageToken;}
  try{const result=await api('/human/behavior/owner-history',{method:'POST',token:ctx.session,signal,body:{protocolVersion:1,consumerId:'connet.owner.hud.v1',purpose:'human-inspect',input:fields}});if(!ctx.current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(ctx.current()&&error.status===401)expireAuthenticatedSession(ctx.source,ctx.session,ctx.generation);throw error;}
}
async function readOwnerWorldSummary(operation,input={}, {signal}={}){
  const source=vault,session=vault.sessionToken,generation=readGeneration,target=selectedId,revision=summary().observationRevision;
  const current=()=>source===vault&&session===vault.sessionToken&&target===selectedId&&revision===summary().observationRevision&&authenticatedOwner();
  if(!current())throw new ApiError(sessionPhase==='expired'?'session_expired':'authentication_required',401);
  if(!target||!agents.some(agent=>agent.agentId===target))throw new ApiError('agent_required',409);
  let path,options={signal};
  if(operation==='capabilities')path='/capabilities';
  else if(operation==='discovery')path='/gateway/discovery';
  else if(operation==='schema'||operation==='guide'){
    if(!Number.isSafeInteger(input.version)||input.version<1||input.version>1000000)throw new ApiError('invalid_request',422);
    if(operation==='schema'&&!['interaction.owner_summary.input','interaction.owner_summary.output'].includes(input.schemaId)||operation==='guide'&&input.moduleId!=='interaction')throw new ApiError('insufficient_scope',403);
    path=operation==='schema'?`/gateway/schemas/${encodeURIComponent(input.schemaId)}?version=${input.version}`:`/gateway/guides/interaction?version=${input.version}`;
  }
  else if(operation==='summary'){
    if(input.cursor!==undefined&&(typeof input.cursor!=='string'||input.cursor.length<1||input.cursor.length>2048))throw new ApiError('invalid_request',422);
    path='/gateway/query';options={...options,method:'POST',token:session,body:{protocolVersion:1,consumerId:'connet.owner.world-summary.v1',purpose:'human-inspect',operation:'interaction.owner_summary',input:{agentId:target,limit:20,...(input.cursor?{cursor:input.cursor}:{})}}};
  }else throw new ApiError('insufficient_scope',403);
  try{const result=await api(path,options);if(!current()||signal?.aborted)throw new DOMException('Context changed','AbortError');return result;}
  catch(error){if(current()&&error.status===401)expireAuthenticatedSession(source,session,generation);throw error;}
}
inviteUI=createOwnerAgentInvite(root,{context:()=>({ownerId:vault.ownerId,sessionToken:vault.sessionToken,authenticated:authenticatedOwner()}),setBusy,fail});
uiPreferences=mountOwnerLocalePreferences($('#owner-language-preferences'),{request:api,context:()=>({authenticated:authenticatedOwner(),ownerId:vault.ownerId,sessionToken:vault.sessionToken,source:vault,generation:readGeneration}),onExpired:({source,sessionToken,generation})=>expireAuthenticatedSession(source,sessionToken,generation)});
const worldActionSettings=mountWorldActionPolicy($('#world-autonomy-form'),{session:{snapshot:()=>structuredClone(summary()),readWorldActionPolicy,subscribe(listener){subscribers.add(listener);listener(structuredClone(summary()));return()=>subscribers.delete(listener);}},changed:controls,dirty:()=>presentation?.dirty('world-autonomy-form'),remember:()=>presentation?.rememberForm('world-autonomy-form'),onSave:({agentId,expectedVersion,mode})=>{if(agentId!==selectedId||hasPending())return;return command({action:'saveWorldActionPolicy',path:`/owner/agents/${encodeURIComponent(agentId)}/world-action-policy`,method:'PUT',targetId:agentId,fields:{expectedVersion,mode}});}});
const behaviorLogs=mountOwnerBehaviorLogs($('#owner-behavior-logs'),{snapshot:()=>structuredClone(summary()),readBehaviorHistory,readHumanBehaviorHistory,subscribe(listener){subscribers.add(listener);listener(structuredClone(summary()));return()=>subscribers.delete(listener);}});
const worldSummary=mountOwnerWorldSummary($('#owner-world-summary'),{read:readOwnerWorldSummary,subscribe(listener){subscribers.add(listener);listener(structuredClone(summary()));return()=>subscribers.delete(listener);}});
window.addEventListener('pagehide',event=>{if(!event.persisted){uiPreferences.dispose();behaviorLogs.dispose();worldSummary.dispose();worldActionSettings.dispose();}});
return{start,open,select:selectAgent,refresh:refreshSummary,readPerception,readWallet,readFriends,readInteraction,readFriendship,readMailbox,readTownService,readLife,readNpcLife,readGifts,readBehaviorHistory,readHumanBehaviorHistory,commandFriendship,snapshot:()=>structuredClone(summary()),subscribe(listener){subscribers.add(listener);listener(structuredClone(summary()));return()=>subscribers.delete(listener);},
  hudContext(){if(authenticatedOwner()&&['ready','refreshing'].includes(summary().phase))return{kind:'owner',ownerId:account.ownerId,agentId:agents.some(agent=>agent.agentId===selectedId)?selectedId:''};return sessionPhase==='anonymous'&&!vault.sessionToken?{kind:'guest',ownerId:'',agentId:''}:null;},
  attachPresentation(value){presentation=value;value.setNavigator(navigateManager);value.connectAvatarStudio({request:avatarAssetRequest,context:()=>{const ctx=friendshipContext(),agent=current();return{ownerId:ctx.ownerId,agentId:ctx.target,profileVersion:agent.profile.version,policyVersion:agent.profile.policyVersion};},refresh:async()=>{await loadAgents({resetProfile:false});presentation?.resetAppearance();}});},
  notifyPresentation:controls,
  requestLogout,leaveEditing,
  isPending:hasPending,getTitle(){if(presentation?.confirming||!$('#manage-view').hidden)return presentation?.title()||accountMessage("manager.myAgents");if(!$('#backup-recovered-view').hidden)return accountMessage("recoveryView.resetComplete");if(!$('#email-view').hidden)return $('#email-title').textContent;if(!$('#setup-view').hidden)return accountMessage("link.title");if(!$('#claim-view').hidden)return accountMessage("link.title");if(!$('#forgot-view').hidden)return $('#recovery-title').textContent;return accountMessage("auth.signInTitle");},
};
}
