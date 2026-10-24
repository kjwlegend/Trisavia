import {api,credential,id,tokenId,validToken,el,stamp} from './common.js';

const states={active:'可使用',expired:'已过期',consumed:'已使用',revoked:'已撤销'};
const invalid=()=>Object.assign(new Error('response_unknown'),{code:'response_unknown'});
function inviteRow(value){if(typeof value?.inviteId!=='string'||!value.inviteId||!Number.isSafeInteger(value.version)||value.version<1||!Object.hasOwn(states,value.state)||typeof value.active!=='boolean'||typeof value.consumed!=='boolean'||value.active!==(value.state==='active')||value.consumed!==(value.state==='consumed')||!Number.isSafeInteger(value.expiresAt)||!Number.isSafeInteger(value.asOf)||value.limit!==1)throw invalid();return value;}
export function agentInviteGuide(origin,token){if(!validToken(token))throw invalid();return `请阅读 ${origin}/agent/entry.md，使用此私密一次性关联授权：${origin}/agent/entry.md#invite=${encodeURIComponent(token)}。已有身份直接沿用，用自己的运行凭据按指南完成关联；没有身份才注册。请核实真实结果后简短告诉我，授权内容不要公开。`;}

export function createOwnerAgentInvite(root,{context,setBusy,fail}={}){
 const $=selector=>root.querySelector(selector);let current=null,rows=[],scope='',generation=0,locked=false,verified=false;
 const storageKey=ownerId=>`connet.owner.agent-invite.v1:${JSON.stringify([location.origin,ownerId])}`;
 function save(){sessionStorage.setItem(storageKey(scope),JSON.stringify(current));}
 function restore(ownerId){if(scope===ownerId)return;generation++;scope=ownerId;current=null;rows=[];verified=false;try{const saved=JSON.parse(sessionStorage.getItem(storageKey(ownerId))||'null');if(saved?.ownerId===ownerId&&validToken(saved.inviteToken)&&typeof saved.operationId==='string'&&saved.operationId&&(!saved.row||saved.row.inviteId===tokenId(saved.inviteToken))){if(saved.row)inviteRow(saved.row);current=saved;}}catch{}render();}
 function render(){
  const row=rows.find(row=>row.inviteId===tokenId(current?.inviteToken||''))||current?.row;
  $('#invite-current').hidden=!current?.row;$('#agent-guide').value=verified&&row?.state==='active'?agentInviteGuide(location.origin,current.inviteToken):'';$('#invite-current-state').textContent=row?`本次授权：${verified?states[row.state]:'状态尚未核实'} · 有效期至 ${stamp(row.expiresAt)}`:'';
  $('#invite-list').replaceChildren();for(const row of rows){const node=el('div','invite-row');node.append(el('p','small-text',`单次关联授权 · ${states[row.state]} · 有效期至 ${stamp(row.expiresAt)}`));if(row.state==='active'){const revoke=el('button','small','撤销授权');revoke.type='button';revoke.disabled=locked;revoke.addEventListener('click',()=>void run(async c=>{await revokeRow(row,c);await refresh();}));node.append(revoke);}$('#invite-list').append(node);}
  if(!rows.length)$('#invite-list').append(el('p','small-text','尚无关联授权。'));controls(locked);
 }
 function controls(value){locked=value;const active=verified&&current?.row?.state==='active';$('#prepare-invite').disabled=locked;$('#prepare-invite').textContent=current&&!current.row?'继续生成并复制':'生成并复制指引';$('#copy-agent-guide').disabled=locked||!active;$('#regenerate-agent-guide').disabled=locked||Boolean(current&&!current.row);for(const button of $('#invite-list').querySelectorAll('button'))button.disabled=locked;}
 function validContext(c){const next=context();return c.authenticated&&next.authenticated&&c.ownerId===next.ownerId&&c.sessionToken===next.sessionToken;}
 async function refresh(){const c=context();if(!c.authenticated)return;restore(c.ownerId);const turn=++generation;$('#invite-list').textContent='正在读取关联授权…';try{const result=await api('/owner/agent-invites',{token:c.sessionToken});if(turn!==generation||!validContext(c))return;if(result?.ownerId!==c.ownerId||!Array.isArray(result.invites)||!Number.isSafeInteger(result.asOf))throw invalid();rows=result.invites.map(inviteRow);verified=true;const row=rows.find(row=>row.inviteId===tokenId(current?.inviteToken||''));if(row&&current){current.row=row;save();}render();}catch(error){if(turn!==generation||!validContext(c))return;verified=false;render();$('#invite-list').textContent='授权状态暂时无法读取，请读取最新状态重试。';if(error.status===401)fail(error);}}
 async function copy(){const row=current?.row;if(!verified||!row||row.state!=='active')return;try{await navigator.clipboard.writeText(agentInviteGuide(location.origin,current.inviteToken));$('#invite-feedback').textContent='指引已复制，请私密发给自己的 Agent。';}catch{$('#invite-feedback').textContent='授权已生成，但暂时无法复制。请手动选择下方指引复制，或点击“复制指引”重试。';}}
 async function issue(c){
  if(!current){current={ownerId:c.ownerId,inviteToken:credential('invite'),operationId:id()};save();}
  if(current.row?.state==='active'){if(!verified)await refresh();await copy();return;}
  if(current.row){current={ownerId:c.ownerId,inviteToken:credential('invite'),operationId:id()};save();}
  save();const pending=current,result=await api('/owner/agent-invites',{method:'POST',token:c.sessionToken,body:{operationId:pending.operationId,inviteToken:pending.inviteToken}});if(!validContext(c)||current!==pending)return;
  if(result?.ownerId!==c.ownerId||result.operationId!==pending.operationId||result.inviteId!==tokenId(pending.inviteToken))throw invalid();current.row=inviteRow(result);verified=true;save();render();await copy();await refresh();
 }
 async function revokeRow(row,c){
  const key=storageKey(c.ownerId)+':revoke:'+row.inviteId;let pending;try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}if(!pending||pending.inviteId!==row.inviteId||pending.expectedVersion!==row.version)pending={inviteId:row.inviteId,expectedVersion:row.version,operationId:id()};sessionStorage.setItem(key,JSON.stringify(pending));
  const result=await api(`/owner/agent-invites/${encodeURIComponent(row.inviteId)}/revoke`,{method:'POST',token:c.sessionToken,body:{operationId:pending.operationId,expectedVersion:pending.expectedVersion}});if(!validContext(c))return;if(result?.ownerId!==c.ownerId||result.operationId!==pending.operationId||result.inviteId!==row.inviteId)throw invalid();const updated=inviteRow(result);if(updated.state==='active')throw invalid();if(current?.row?.inviteId===row.inviteId){current.row=updated;save();}sessionStorage.removeItem(key);$('#invite-feedback').textContent='这份关联授权已撤销。';render();
 }
 async function run(action){const c=context();if(locked||!c.authenticated)return;restore(c.ownerId);const lease=setBusy(true);$('#invite-feedback').textContent='正在处理关联授权…';try{await action(c);}catch(error){if(validContext(c)){$('#invite-feedback').textContent='暂时无法确认结果。原请求已保留，重试会继续同一次操作。';fail(error);}}finally{setBusy(false,lease);}}
 $('#prepare-invite').addEventListener('click',()=>void run(issue));$('#copy-agent-guide').addEventListener('click',()=>void copy());$('#regenerate-agent-guide').addEventListener('click',()=>void run(async c=>{if(current&&!current.row){await issue(c);return;}if(current?.row?.state==='active')await revokeRow(current.row,c);if(!validContext(c))return;current=null;save();await issue(c);}));
 return{refresh,controls,syncSession(){if(!context().authenticated){generation++;verified=false;$('#agent-guide').value='';$('#copy-agent-guide').disabled=true;}},clear(){generation++;try{if(scope){const key=storageKey(scope);for(const name of Object.keys(sessionStorage))if(name===key||name.startsWith(key+':revoke:'))sessionStorage.removeItem(name);}}catch{}scope='';current=null;rows=[];verified=false;$('#invite-feedback').textContent='';render();}};
}
