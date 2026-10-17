// A non-secret view preference, never a capability or a source of account data.
// Callers supply the current session-verified owner's complete Agent list.
const key='connet.owner.agent-selection.v1';
export function clearAgentSelection(scope){try{if(scope){const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(!scope.ownerId||saved?.origin!==location.origin||saved.ownerId!==scope.ownerId)return;}sessionStorage.removeItem(key);}catch{}}
export function readAgentSelection(ownerId,agents){
  try{
    const saved=JSON.parse(sessionStorage.getItem(key)||'null');
    if(saved?.origin===location.origin&&saved.ownerId===ownerId&&Array.isArray(agents)&&agents.some(agent=>agent.agentId===saved.agentId))return saved.agentId;
    clearAgentSelection();
  }catch{clearAgentSelection();}
  return '';
}
export function rememberAgentSelection(ownerId,agents,agentId){
  if(!ownerId||!Array.isArray(agents)||!agents.some(agent=>agent.agentId===agentId)){clearAgentSelection();return;}
  try{sessionStorage.setItem(key,JSON.stringify({origin:location.origin,ownerId,agentId}));}catch{}
}
