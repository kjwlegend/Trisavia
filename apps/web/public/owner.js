import {$,$$,el,api,ApiError,errorText,isUnknown,notice,credential,id,validToken,tokenId,stamp,downloadPrivate,brandHeader} from './common.js';
import {avatar,courtyard} from './scene.js';

// A fragment is never sent to the server. Remove it before any API request.
const incoming = new URLSearchParams(location.hash.slice(1));
const incomingHandoff = incoming.get('handoff');
if (location.hash) history.replaceState(null, '', location.pathname);
const storageKey='connet.owner.v1';
let vault={format:'connet-owner-v1',origin:location.origin};
let storageAvailable=true;
try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.format===vault.format&&saved.origin===location.origin)vault=saved;}catch{storageAvailable=false;}
let agents=[],selectedId='',busy=false,selectionGeneration=0,readGeneration=0;
let setupInfo=null,setupPrepared=false,recoveryPrepared=null,runtimePrepared=null,invitePrepared=null;
let pendingPayload=null,view='auth',readAbort=null;
const globalNotice=$('#global-notice');
brandHeader('owner');courtyard($('#auth-courtyard'));
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify(vault));}catch{storageAvailable=false;throw new ApiError('private_storage_unavailable',400);}}
function message(text,tone=''){notice(globalNotice,text,tone);}
function fail(error){message(error.code==='private_storage_unavailable'?'浏览器无法保存当前标签页的私密续接材料。请启用会话存储后再继续。':errorText(error),isUnknown(error)?'pending':'error');}
function setBusy(value){busy=value;document.querySelector('main').setAttribute('aria-busy',String(value));controls();}
function pendingRecovery(){return vault.pendingOperation?.action==='recover';}
function recoveryProofsReady(){return pendingRecovery()&&vault.pendingOperation.scope===`owner:${vault.ownerId}`&&validToken(vault.sessionToken)&&validToken(vault.recoveryToken);}
function controls(){
  const pending=Boolean(vault.pendingOperation);
  $$('main button').forEach(button=>{button.disabled=busy||(pending&&!['check-result','retry-operation','logout','show-login'].includes(button.id));});
  $$('main input,main textarea,main select').forEach(input=>{input.disabled=busy||pending;});
  $('#setup-saved').disabled=!setupPrepared||busy||pending;
  $('#setup-complete').disabled=busy||pending||!setupPrepared||!$('#setup-saved').checked;
  $('#recovery-saved').disabled=!recoveryPrepared||busy||pending;
  $('#recovery-submit').disabled=busy||pending||!recoveryPrepared||!$('#recovery-saved').checked;
  if(pendingRecovery()){
    const ready=recoveryProofsReady();
    $('#recovery-token').disabled=busy||!ready;$('#recovery-password').disabled=busy||!ready;
    $('#recovery-download').disabled=busy||!ready;$('#recovery-saved').disabled=busy||!ready;
    $('#recovery-submit').disabled=busy||!ready||!$('#recovery-saved').checked;
  }
  $('#runtime-saved').disabled=busy||pending;$('#replace-runtime').disabled=busy||pending||!runtimePrepared||!$('#runtime-saved').checked;
  $('#invite-saved').disabled=busy||pending;$('#issue-invite').disabled=busy||pending||!invitePrepared||!$('#invite-saved').checked;
  $('#check-result').disabled=busy;$('#retry-operation').disabled=busy||!pendingPayload;
  $('#unknown-controls').hidden=!pending;$('#retry-operation').hidden=!pendingPayload;
  $('#agent-select').disabled=busy;$('#credentials-import').disabled=busy||pending;
  if(selectedId){const agent=current();if(agent){$('#join-agent').disabled||=agent.membership.state==='joined';$('#leave-agent').disabled||=agent.membership.state==='left';$('#revoke-runtime').disabled||=!agent.runtimeActive;}}
}
function showAuth(){view='auth';$('#auth-view').hidden=false;$('#manage-view').hidden=true;$('#session-actions').hidden=true;$('#page-title').textContent='主人管理';$('#page-description').textContent='独立管理你的居民，Agent 无需保持在线。';}
function showSignIn(){showAuth();$('#setup-view').hidden=true;$('#sign-in-view').hidden=false;$('#login-owner').value=vault.ownerId||'';$('#recovery-owner').value=vault.ownerId||'';if(vault.recoveryToken&&!pendingRecovery())$('#recovery-token').value=vault.recoveryToken;$('#recovery-resume-info').hidden=!pendingRecovery();$('#recovery-download').textContent=pendingRecovery()?'重新下载已保存的下一代恢复文件':'下载下一代恢复文件';$('#recovery-submit').textContent=pendingRecovery()?'继续原恢复':'恢复管理访问';controls();}
function showPendingRecovery(preserveInputs=false){
  showSignIn();tab('recovery');recoveryPrepared=null;
  if(!preserveInputs){$('#recovery-token').value='';$('#recovery-password').value='';$('#recovery-saved').checked=false;}
  controls();
}
function tab(mode){$('#login-form').hidden=mode!=='login';$('#recovery-form').hidden=mode!=='recovery';$('#login-tab').setAttribute('aria-selected',String(mode==='login'));$('#recovery-tab').setAttribute('aria-selected',String(mode==='recovery'));}
function current(){return agents.find(agent=>agent.agentId===selectedId);}
function privateFile(){const result={format:'connet-owner-v1',origin:location.origin,ownerId:vault.ownerId};for(const key of ['sessionToken','recoveryToken','setupToken','pendingOperation'])if(vault[key])result[key]=vault[key];return result;}
function downloadVault(){downloadPrivate('connet-owner.private.json',privateFile());}
function beginPending({action,scope,path,method='POST',body,token,kind='owner',targetId}){
  const pending={operationId:body.operationId,scope,action,path,method,kind,...(targetId?{targetId}:{})};
  vault.pendingOperation=pending;save();pendingPayload={body,token};controls();return pending;
}
function clearPending(){delete vault.pendingOperation;pendingPayload=null;save();controls();}
async function receipt(pending){return api(`/operations/${encodeURIComponent(pending.operationId)}?scope=${encodeURIComponent(pending.scope)}&action=${encodeURIComponent(pending.action)}`,{token:vault.sessionToken});}
async function committed(result,pending){
  if(['completeSetup','recover','login'].includes(pending.action)){
    vault.ownerId=result.ownerId;vault.stage='managed';delete vault.setupToken;delete vault.handoffToken;setupPrepared=false;recoveryPrepared=null;
    $('#setup-password').value='';$('#login-password').value='';$('#recovery-password').value='';$('#recovery-token').value='';
  }
  clearPending();
  if(pending.action==='replaceRuntime'){runtimePrepared=null;$('#runtime-confirm').hidden=true;$('#runtime-saved').checked=false;}
  if(pending.action==='issueInvite'){invitePrepared=null;$('#invite-confirm').hidden=true;$('#invite-saved').checked=false;}
  save();
  try{await loadAgents({resetProfile:!pending.targetId||pending.targetId===selectedId});message('操作已完成，当前状态已重新读取。','success');}
  catch{message('操作已提交，但最新状态暂时无法读取。请刷新页面继续；无需重新提交该操作。','pending');}
}
async function executePending(pending=vault.pendingOperation){
  if(!pending||!pendingPayload)return;
  setBusy(true);
  try{const result=await api(pending.action==='recover'?'/owner/recoveries':pending.path,{method:pending.action==='recover'?'POST':pending.method,body:pendingPayload.body,token:pendingPayload.token});await committed(result,pending);}
  catch(error){
    if(isUnknown(error))fail(error);
    else{
      // A consumed setup/recovery token can mean the original commit succeeded.
      if(pending.action==='recover'||(['completeSetup','login'].includes(pending.action)&&error.status===401)){try{const result=await receipt(pending);await committed(result,pending);return;}catch{}}
      if(pending.action==='recover'){
        pendingPayload=null;showPendingRecovery(true);
        message(`原恢复仍待核对。${errorText(error)} 请核对旧恢复证明和原请求的新密码，再继续原恢复。`,'pending');return;
      }
      clearPending();fail(error);
      if(['version_conflict','state_conflict'].includes(error.code))$('#draft-note').textContent='有版本冲突。当前输入已保留；点击「读取最新状态」检查服务器版本后，再确认保存。';
    }
  }finally{setBusy(false);}
}
async function command({action,path,method='POST',fields={},targetId=selectedId,scope=`owner:${vault.ownerId}`,token=vault.sessionToken,kind='owner',operationId=id()}){
  if(busy||vault.pendingOperation)return;
  try{beginPending({action,path,method,body:{operationId,...fields},token,scope,kind,targetId});await executePending();}catch(error){fail(error);setBusy(false);}
}
async function checkResult(){
  if(busy||!vault.pendingOperation)return;setBusy(true);const pending=vault.pendingOperation;
  try{const result=await receipt(pending);await committed(result,pending);}
  catch(error){if(pending.action==='recover'){showPendingRecovery(true);message('尚未核对到原恢复回执。原操作和下一代证明已保留，请重新输入旧恢复证明与原请求的新密码，继续原恢复；也可稍后再次核对。','pending');}else message(error.status===404?'尚未查到原操作回执，结果仍未知。保留原操作；可在此标签页重试原操作，或稍后再核对。':errorText(error),'pending');}
  finally{setBusy(false);}
}

async function previewHandoff(){
  if(!validToken(vault.handoffToken)){showSignIn();message('私密入口无效。请让 Agent 在首次管理完成前重新交付有效入口，或使用已有管理方式。','error');return;}
  setBusy(true);
  try{setupInfo=await api(`/owner-handoffs/${encodeURIComponent(tokenId(vault.handoffToken))}`,{token:vault.handoffToken});vault.ownerId=setupInfo.ownerId;save();renderSetup(false);message('这是交接预览。点击「开始设置」后才会兑换受限设置。');}
  catch(error){showSignIn();fail(error);}finally{setBusy(false);}
}
function renderSetup(restricted){showAuth();$('#setup-view').hidden=false;$('#sign-in-view').hidden=true;$('#setup-agent-id').textContent=setupInfo.agentId;$('#setup-owner-id').textContent=setupInfo.ownerId;$('#setup-expiry').textContent=stamp(setupInfo.expiresAt);$('#setup-preview').hidden=restricted;$('#setup-form').hidden=!restricted;controls();}
async function readSetup(){setupInfo=await api('/owner/setup',{token:vault.setupToken});vault.ownerId=setupInfo.ownerId;save();renderSetup(true);}
async function startSetup(){
  if(busy||vault.pendingOperation)return;setBusy(true);
  try{if(!vault.setupToken)vault.setupToken=credential('setup');vault.stage='restricted_setup';vault.exchangeOperationId??=id();save();
    try{setupInfo=await api('/owner-setups',{method:'POST',body:{operationId:vault.exchangeOperationId,setupToken:vault.setupToken},token:vault.handoffToken});}
    catch(error){if(!isUnknown(error))throw error;try{await readSetup();}catch{message('设置兑换结果未知。预存设置证明已保留，请重新读取受限设置。','pending');return;}}
    delete vault.handoffToken;save();renderSetup(true);message('现在请设置密码，并先下载、保存独立管理材料。');
  }catch(error){fail(error);}finally{setBusy(false);}
}
function prepareSetup(){
  if(busy||vault.pendingOperation)return;
  try{if(!setupPrepared){vault.sessionToken=credential('session');vault.recoveryToken=credential('recovery');vault.completeOperationId=id();vault.stage='setup_prepared';save();setupPrepared=true;}
    // This exact key is available if completing setup commits but loses its response.
    const file={...privateFile(),pendingOperation:{operationId:vault.completeOperationId,scope:`setup:${tokenId(vault.setupToken)}`,action:'completeSetup',kind:'setup'}};
    downloadPrivate('connet-owner.private.json',file);$('#setup-saved').disabled=false;message('已准备私密下载。请确认文件保存成功，再勾选确认。');controls();
  }catch(error){fail(error);}
}
async function completeSetup(event){event.preventDefault();if(!setupPrepared||!$('#setup-saved').checked)return;const password=$('#setup-password').value;if(password.length<12)return;
  await command({action:'completeSetup',path:'/owner/setup/complete',scope:`setup:${tokenId(vault.setupToken)}`,token:vault.setupToken,kind:'setup',operationId:vault.completeOperationId,targetId:null,fields:{password,recoveryToken:vault.recoveryToken,sessionToken:vault.sessionToken,credentialsSaved:true}});
}
async function login(event){event.preventDefault();if(busy||vault.pendingOperation)return;
  try{const ownerId=$('#login-owner').value.trim();if(vault.ownerId!==ownerId)delete vault.recoveryToken;vault.ownerId=ownerId;vault.sessionToken=credential('session');delete vault.setupToken;delete vault.handoffToken;vault.stage='login_prepared';save();await command({action:'login',path:'/owner/sessions',targetId:null,token:null,kind:'login',fields:{ownerId:vault.ownerId,password:$('#login-password').value,sessionToken:vault.sessionToken}});}catch(error){fail(error);}
}
function prepareRecovery(){
  if(busy)return;
  if(pendingRecovery()){
    if(!recoveryProofsReady())return;
    downloadPrivate('connet-owner-recovery.private.json',privateFile());
    message('已重新准备原恢复文件下载，原操作与下一代证明均未变化。请确认文件已保存。','pending');controls();return;
  }
  if(vault.pendingOperation)return;const ownerId=$('#recovery-owner').value.trim(),oldToken=$('#recovery-token').value.trim();
  if(!ownerId||!validToken(oldToken)){message('请填入私密管理文件中的主人 ID 和有效恢复证明。','error');return;}
  try{recoveryPrepared??={ownerId,oldToken,recoveryToken:credential('recovery'),sessionToken:credential('session'),operationId:id()};
    if(recoveryPrepared.ownerId!==ownerId||recoveryPrepared.oldToken!==oldToken){recoveryPrepared=null;prepareRecovery();return;}
    const file={format:'connet-owner-v1',origin:location.origin,ownerId,recoveryToken:recoveryPrepared.recoveryToken,sessionToken:recoveryPrepared.sessionToken,pendingOperation:{operationId:recoveryPrepared.operationId,scope:`owner:${ownerId}`,action:'recover',kind:'recovery'}};
    downloadPrivate('connet-owner-recovery.private.json',file);$('#recovery-saved').disabled=false;message('请先保存下一代恢复文件。确认恢复后，旧管理和恢复方式将失效。');controls();
  }catch(error){fail(error);}
}
async function recover(event){event.preventDefault();
  if(busy||!$('#recovery-saved').checked)return;
  if(pendingRecovery()){
    if(!recoveryProofsReady())return;
    const oldToken=$('#recovery-token').value.trim(),password=$('#recovery-password').value;
    if(!validToken(oldToken)||password.length<12){message('请重新输入有效的旧恢复证明和原请求使用的新管理密码。原操作仍保留。','pending');return;}
    const pending=vault.pendingOperation;
    pendingPayload={token:oldToken,body:{operationId:pending.operationId,password,recoveryToken:vault.recoveryToken,sessionToken:vault.sessionToken,credentialsSaved:true}};
    await executePending({...pending,path:'/owner/recoveries',method:'POST'});return;
  }
  if(!recoveryPrepared)return;
  if(recoveryPrepared.ownerId!==$('#recovery-owner').value.trim()||recoveryPrepared.oldToken!==$('#recovery-token').value.trim()){recoveryPrepared=null;$('#recovery-saved').checked=false;controls();message('恢复身份已变化，请重新下载对应的下一代恢复文件。','error');return;}
  try{const next=recoveryPrepared;vault.ownerId=next.ownerId;vault.sessionToken=next.sessionToken;vault.recoveryToken=next.recoveryToken;vault.stage='recovery_prepared';save();await command({action:'recover',path:'/owner/recoveries',targetId:null,token:next.oldToken,operationId:next.operationId,kind:'recovery',fields:{password:$('#recovery-password').value,recoveryToken:next.recoveryToken,sessionToken:next.sessionToken,credentialsSaved:true}});}catch(error){fail(error);}
}

async function loadAgents({resetProfile=true}={}){
  const generation=++readGeneration,session=vault.sessionToken;readAbort?.abort();readAbort=new AbortController();
  const result=await api('/owner/agents',{token:session,signal:readAbort.signal});
  if(generation!==readGeneration||session!==vault.sessionToken)return;
  if(vault.ownerId&&result.ownerId!==vault.ownerId)throw new ApiError('authentication_failed',401);
  vault.ownerId=result.ownerId;vault.stage='managed';save();agents=result.agents;
  view='managed';$('#auth-view').hidden=true;$('#manage-view').hidden=false;$('#session-actions').hidden=false;$('#page-title').textContent='我的居民';$('#page-description').textContent='当前授权下的居民与资料。状态按读取时间展示。';$('#owner-display').textContent=`主人 ID · ${vault.ownerId}`;$('#owner-display').className='mono';
  if(!agents.some(a=>a.agentId===selectedId)){selectedId=agents[0]?.agentId||'';selectionGeneration++;resetProfile=true;}
  renderList();renderAgent(resetProfile);await loadInvites(session,generation);controls();
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
  selectedId=agentId;selectionGeneration++;runtimePrepared=null;$('#runtime-confirm').hidden=true;$('#runtime-saved').checked=false;renderList();renderAgent(true);message('已切换居民，表单使用当前目标的草稿与版本。');controls();
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
  $('#selected-asof').textContent=`读取时间 · ${stamp(agent.asOf)} · 运行访问第 ${agent.runtimeVersion} 代`;
  const draftChanged=JSON.stringify(profile.draft)!==JSON.stringify(profile.published);$('#profile-state').textContent=!profile.published?'尚未公开':draftChanged?(profile.mode==='agent_autonomous'?'有未发布草稿':'有待主人确认的草稿'):'已公开';
  $('#confirmation-source').textContent=profile.confirmationSource==='owner_authenticated'?'当前公开资料确认来源：已认证主人发布。':profile.confirmationSource==='runtime_declaration'?'当前公开资料确认来源：Agent 自主发布／声明，不代表主人在网页确认。':'尚无公开资料确认记录。';
  const modeNames={agent_autonomous:'Agent 自主设定',owner_specified:'主人指定',proposal_required:'先提议后确认'},fieldNames={displayName:'名字',avatar:'形象',bio:'简介',interests:'兴趣'};
  $('#policy-current').textContent=`服务器当前政策：${modeNames[profile.mode]}；锁定字段：${profile.lockedFields.map(field=>fieldNames[field]).join('、')||'无'}。`;
  if(resetProfile){const draft=profile.draft||{};$('#display-name').value=draft.displayName||'';$('#bio').value=draft.bio||'';$('#interests').value=(draft.interests||[]).join('，');$('#avatar-color').value=draft.avatar?.color||'olive';$('#profile-mode').value=profile.mode;$$('input[name=lock]').forEach(input=>input.checked=profile.lockedFields.includes(input.value));$('#draft-note').textContent=`草稿版本 ${profile.version} · 字段政策版本 ${profile.policyVersion}。发布仅使用服务器已保存的草稿。`;}
  const preview=$('#published-preview');preview.replaceChildren();if(profile.published){preview.append(el('strong','',profile.published.displayName),el('p','',profile.published.bio||'尚未填写简介'));const tags=el('div','tag-row');tags.append(...(profile.published.interests||[]).map(text=>el('span','tag',text)));preview.append(tags);}else preview.append(el('p','','尚未发布。保存草稿后，点击「发布资料」才会更新公开版本。'));
  $('#pause-agent').textContent=member.ownerPaused?'恢复参与':'暂停参与';$('#member-description').textContent=member.platformRestricted?'当前存在平台限制。主人暂停开关不会解除平台限制。':`成员状态：${member.state==='joined'?'已加入':member.state==='left'?'已退出':'未加入'}。重新加入沿用同一身份，暂停状态独立保留。`;
}
async function refresh(resetProfile=false){if(busy)return;setBusy(true);try{await loadAgents({resetProfile});if(current()&&!resetProfile)$('#draft-note').textContent=`已读取服务器最新版本 ${current().profile.version}，表单输入仍保留。请核对目前公开版本，再确认保存。`;message('已读取最新状态，表单输入仍保留。','success');}catch(error){fail(error);if(error.status===401){showSignIn();}}finally{setBusy(false);}}
function fieldsFromForm(){return {displayName:$('#display-name').value.trim(),avatar:{template:'basic',color:$('#avatar-color').value},bio:$('#bio').value,interests:$('#interests').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean)};}
function submitProfile(event){event.preventDefault();const agent=current();if(!agent)return;const fields=fieldsFromForm();if(fields.interests.length>10||fields.interests.some(i=>i.length>40)){message('兴趣最多 10 项，每项最多 40 字。当前输入已保留。','error');return;}return command({action:'saveDraft',path:`/agents/${encodeURIComponent(agent.agentId)}/profile/draft`,method:'PUT',targetId:agent.agentId,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion,fields}});}
function publish(){const agent=current();if(!agent)return;return command({action:'publishProfile',path:`/agents/${encodeURIComponent(agent.agentId)}/profile/publish`,fields:{expectedVersion:agent.profile.version,expectedPolicyVersion:agent.profile.policyVersion}});}
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

async function importCredentials(event){const file=event.target.files?.[0];if(!file)return;setBusy(true);try{if(file.size>32_768)throw new Error('invalid');const saved=JSON.parse(await file.text());if(saved.format!=='connet-owner-v1'||saved.origin!==location.origin||typeof saved.ownerId!=='string')throw new Error('invalid');for(const key of ['sessionToken','recoveryToken','setupToken'])if(saved[key]!==undefined&&!validToken(saved[key]))throw new Error('invalid');
    const next={format:saved.format,origin:saved.origin,ownerId:saved.ownerId};for(const key of ['sessionToken','recoveryToken','setupToken'])if(saved[key])next[key]=saved[key];
    if(saved.pendingOperation){const p=saved.pendingOperation;if(!['completeSetup','recover'].includes(p.action)||typeof p.operationId!=='string'||!((p.action==='recover'&&p.scope===`owner:${saved.ownerId}`)||(p.action==='completeSetup'&&saved.setupToken&&p.scope===`setup:${tokenId(saved.setupToken)}`)))throw new Error('invalid');next.pendingOperation={operationId:p.operationId,scope:p.scope,action:p.action,kind:p.kind};}
    vault=next;pendingPayload=null;save();setupPrepared=false;recoveryPrepared=null;await resume();
  }catch(error){showSignIn();message(error instanceof ApiError?errorText(error):'文件不符合当前服务的私密管理格式。请使用由此服务下载的正确文件。','error');}finally{event.target.value='';setBusy(false);}}
function logout(){readGeneration++;selectionGeneration++;readAbort?.abort();agents=[];selectedId='';pendingPayload=null;setupInfo=null;setupPrepared=false;recoveryPrepared=null;runtimePrepared=null;invitePrepared=null;vault={format:'connet-owner-v1',origin:location.origin};try{sessionStorage.removeItem(storageKey);}catch{}$$('input[type=password]').forEach(input=>input.value='');$('#login-owner').value='';$('#recovery-owner').value='';showSignIn();message('已退出当前标签页的管理访问。已下载的私密文件请继续妥善保存。');controls();}
async function resume(){
  if(vault.pendingOperation){showSignIn();message('检测到待核对的原操作。请先核对回执，避免重复提交。','pending');controls();try{const result=await receipt(vault.pendingOperation);await committed(result,vault.pendingOperation);return;}catch{if(pendingRecovery()){showPendingRecovery();message('尚未核对到原恢复回执。原操作和下一代证明已保留，请重新输入旧恢复证明与原请求的新密码，继续原恢复；也可稍后再次核对。','pending');}else if(vault.pendingOperation.action==='completeSetup'&&vault.setupToken){try{await readSetup();vault.completeOperationId=vault.pendingOperation.operationId;clearPending();setupPrepared=true;$('#setup-saved').checked=false;message('首次设置尚未完成。原操作与预存凭据已保留，请保存文件、填写密码后继续。');controls();}catch{}}}return;}
  if(vault.sessionToken){try{await loadAgents();return;}catch(error){if(![401,403].includes(error.status))throw error;}}
  if(vault.setupToken){try{await readSetup();message('已恢复受限设置。请重新下载管理文件并确认保存，再完成设置。');return;}catch(error){if(![401,403].includes(error.status))throw error;}}
  if(vault.handoffToken){await previewHandoff();return;}showSignIn();
}
$('#setup-start').addEventListener('click',startSetup);$('#credentials-download').addEventListener('click',prepareSetup);$('#setup-form').addEventListener('submit',completeSetup);$('#setup-saved').addEventListener('change',controls);
$('#login-form').addEventListener('submit',login);$('#recovery-form').addEventListener('submit',recover);$('#recovery-download').addEventListener('click',prepareRecovery);$('#recovery-saved').addEventListener('change',controls);$('#login-tab').addEventListener('click',()=>tab('login'));$('#recovery-tab').addEventListener('click',()=>tab('recovery'));$('#show-login').addEventListener('click',()=>{showSignIn();tab('login');});$('#credentials-import').addEventListener('change',importCredentials);
$('#check-result').addEventListener('click',checkResult);$('#retry-operation').addEventListener('click',()=>executePending());$('#refresh-agents').addEventListener('click',()=>refresh());$('#logout').addEventListener('click',logout);$('#download-current').addEventListener('click',downloadVault);$('#agent-select').addEventListener('change',event=>selectAgent(event.target.value));
$('#profile-form').addEventListener('submit',submitProfile);$('#publish-profile').addEventListener('click',publish);$('#reload-profile').addEventListener('click',()=>refresh(false));$('#policy-form').addEventListener('submit',policy);$('#join-agent').addEventListener('click',()=>membership('join'));$('#leave-agent').addEventListener('click',()=>membership('leave'));$('#pause-agent').addEventListener('click',pause);
$('#prepare-runtime').addEventListener('click',prepareRuntime);$('#runtime-saved').addEventListener('change',controls);$('#replace-runtime').addEventListener('click',replaceRuntime);$('#revoke-runtime').addEventListener('click',revokeRuntime);$('#prepare-invite').addEventListener('click',prepareInvite);$('#invite-saved').addEventListener('change',controls);$('#issue-invite').addEventListener('click',issueInvite);
if(incomingHandoff){vault={format:'connet-owner-v1',origin:location.origin,handoffToken:incomingHandoff};try{save();}catch(error){fail(error);}}
if(!storageAvailable){showSignIn();message('浏览器无法保存当前标签页的私密续接材料。请启用会话存储后继续。','error');controls();}
else{setBusy(true);resume().catch(error=>{showSignIn();fail(error);}).finally(()=>setBusy(false));}
