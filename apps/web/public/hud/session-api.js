import {api} from '../common.js';
const sessionKey='connet.owner.v2',progressKey='connet.owner.progress.v2';
// The UI receives a safe projection, never the private vault or account email.
export function createSessionApi(){
  let state={phase:'anonymous',username:'',agents:[],selectedAgentId:''},generation=0,controller=null,activeProof='',selection='';const listeners=new Set();
  const publish=next=>{state=next;for(const listener of listeners)listener(structuredClone(state));};
  function readVault(){try{const saved=JSON.parse(sessionStorage.getItem(sessionKey)||'null');return saved?.format==='connet-owner-v2'&&saved.origin===location.origin?saved:null;}catch{return null;}}
  async function refresh(){const vault=readVault(),revision=++generation;controller?.abort();controller=new AbortController();
    if(vault?.pendingOperation){activeProof='';publish({phase:'pending',username:'',agents:[],selectedAgentId:''});return;}
    if(!vault?.sessionToken){activeProof='';selection='';publish({phase:'anonymous',username:'',agents:[],selectedAgentId:''});return;}
    if(activeProof!==vault.sessionToken){selection='';state={phase:'loading',username:'',agents:[],selectedAgentId:''};}activeProof=vault.sessionToken;const proof=activeProof;
    publish({...state,phase:state.phase==='ready'?'refreshing':'loading'});
    try{const account=await api('/owner/account',{token:proof,signal:controller.signal});if(revision!==generation||readVault()?.sessionToken!==proof)return;const result=await api('/owner/agents',{token:proof,signal:controller.signal});
      if(revision!==generation||readVault()?.sessionToken!==proof)return;
      if(account.ownerId!==result.ownerId||account.ownerId!==vault.ownerId)throw new Error('account_mismatch');
      const agents=result.agents.map(agent=>{const profile=agent.profile.published||agent.profile.draft||{};return{agentId:agent.agentId,name:profile.displayName||'未命名 Agent',bio:profile.bio||'',interests:profile.interests||[],avatar:profile.avatar||{},membership:agent.membership.state,ownerPaused:agent.membership.ownerPaused,platformRestricted:agent.membership.platformRestricted,asOf:agent.asOf};});
      selection=agents.some(agent=>agent.agentId===selection)?selection:agents[0]?.agentId||'';publish({phase:'ready',username:account.username,agents,selectedAgentId:selection});
    }catch(error){if(revision!==generation||error.name==='AbortError')return;publish({phase:error.status===401?'expired':'error',username:'',agents:[],selectedAgentId:''});}
  }
  function select(agentId){if(!['ready','refreshing'].includes(state.phase)||!state.agents.some(agent=>agent.agentId===agentId))return;selection=agentId;publish({...state,selectedAgentId:selection});}
  function logout(){generation++;controller?.abort();activeProof='';selection='';for(const key of [sessionKey,progressKey])sessionStorage.removeItem(key);publish({phase:'anonymous',username:'',agents:[],selectedAgentId:''});}
  return{refresh,select,logout,snapshot:()=>structuredClone(state),subscribe(listener){listeners.add(listener);listener(structuredClone(state));return()=>listeners.delete(listener);}};
}
