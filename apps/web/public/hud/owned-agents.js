// This private display projection never contains account or capability material.
export function projectOwnedAgents(state){
  if(state?.authenticated!==true||!['ready','refreshing'].includes(state.phase))return{agents:[],selectedAgentId:''};
  const seen=new Set(),agents=[];
  for(const agent of Array.isArray(state.agents)?state.agents:[]){
    if(typeof agent?.agentId!=='string'||!agent.agentId||seen.has(agent.agentId))continue;
    seen.add(agent.agentId);
    const mapped=agent.avatar?.template==='basic'&&['olive','cream','blue','coral'].includes(agent.avatar.color);
    agents.push({agentId:agent.agentId,name:typeof agent.name==='string'&&agent.name?agent.name:'未命名 Agent',avatar:{template:'basic',color:mapped?agent.avatar.color:'cream'},profileSource:agent.profileSource==='published'?'published':'draft'});
  }
  return{agents,selectedAgentId:seen.has(state.selectedAgentId)?state.selectedAgentId:''};
}

// A scene may finish loading after logout. Attach always applies the latest
// authenticated projection, rather than the state captured before asset loading.
export function createOwnedAgentBinding(session,onSelect=()=>{}){
  let projection={agents:[],selectedAgentId:''},scene=null,disposed=false;
  const apply=()=>scene?.setOwnedAgents(structuredClone(projection));
  const unsubscribe=session.subscribe(state=>{if(disposed)return;projection=projectOwnedAgents(state);apply();});
  return{
    attach(next){if(scene&&scene!==next)scene.setOwnedAgents({agents:[],selectedAgentId:''});scene=disposed?null:next;apply();},
    select(agentId,origin){if(!disposed&&projection.agents.some(agent=>agent.agentId===agentId))onSelect(agentId,origin);},
    dispose(){if(disposed)return;disposed=true;unsubscribe?.();projection={agents:[],selectedAgentId:''};apply();scene=null;},
  };
}
