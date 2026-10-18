import {api} from '../common.js';
import {readAgentSelection,rememberAgentSelection,clearAgentSelection} from '../agent-selection.js';
const sessionKey='connet.owner.v2',progressKey='connet.owner.progress.v2';
// The UI receives a safe projection, never the private vault or account email.
export function createSessionApi(){
  let state={phase:'anonymous',username:'',agents:[],selectedAgentId:''},generation=0,controller=null,activeProof='',activeOwnerId='',selection='';const listeners=new Set();
  const publish=next=>{state=next;for(const listener of listeners)listener(structuredClone(state));};
  function readVault(){try{const saved=JSON.parse(sessionStorage.getItem(sessionKey)||'null');return saved?.format==='connet-owner-v2'&&saved.origin===location.origin?saved:null;}catch{return null;}}
  async function refresh(){const vault=readVault(),revision=++generation;controller?.abort();controller=new AbortController();
    if(vault?.pendingOperation){activeProof='';activeOwnerId='';publish({phase:'pending',username:'',agents:[],selectedAgentId:''});return;}
    if(!vault?.sessionToken){activeProof='';activeOwnerId='';selection='';clearAgentSelection();publish({phase:'anonymous',username:'',agents:[],selectedAgentId:''});return;}
    if(activeProof!==vault.sessionToken){activeOwnerId='';selection='';state={phase:'loading',username:'',agents:[],selectedAgentId:''};}activeProof=vault.sessionToken;const proof=activeProof;
    publish({...state,phase:['ready','refreshing'].includes(state.phase)?'refreshing':'loading'});
    try{const account=await api('/owner/account',{token:proof,signal:controller.signal});if(revision!==generation||readVault()?.sessionToken!==proof)return;const result=await api('/owner/agents',{token:proof,signal:controller.signal});
      if(revision!==generation||readVault()?.sessionToken!==proof)return;
      if(account.ownerId!==result.ownerId||account.ownerId!==vault.ownerId)throw new Error('account_mismatch');
      const agents=result.agents.map(agent=>{const profile=agent.profile.published||agent.profile.draft||{};return{agentId:agent.agentId,name:profile.displayName||'未命名 Agent',bio:profile.bio||'',interests:profile.interests||[],avatar:profile.avatar||{},membership:agent.membership.state,ownerPaused:agent.membership.ownerPaused,platformRestricted:agent.membership.platformRestricted,asOf:agent.asOf};});
      const preferred=readAgentSelection(account.ownerId,agents)||selection;
      selection=agents.some(agent=>agent.agentId===preferred)?preferred:agents[0]?.agentId||'';activeOwnerId=account.ownerId;rememberAgentSelection(activeOwnerId,agents,selection);publish({phase:'ready',username:account.username,agents,selectedAgentId:selection});
    }catch(error){if(revision!==generation||error.name==='AbortError'||readVault()?.sessionToken!==proof)return;if(error.status===401){activeOwnerId='';selection='';clearAgentSelection({ownerId:vault.ownerId});}publish({phase:error.status===401?'expired':'error',username:'',agents:[],selectedAgentId:''});}
  }
  function select(agentId){if(!['ready','refreshing'].includes(state.phase)||!state.agents.some(agent=>agent.agentId===agentId))return;selection=agentId;rememberAgentSelection(activeOwnerId,state.agents,selection);publish({...state,selectedAgentId:selection});}
  function logout(){generation++;controller?.abort();activeProof='';activeOwnerId='';selection='';clearAgentSelection();for(const key of [sessionKey,progressKey,'connet.owner.assistance.v1','connet.owner.email.v1'])sessionStorage.removeItem(key);publish({phase:'anonymous',username:'',agents:[],selectedAgentId:''});}
  return{refresh,select,logout,snapshot:()=>structuredClone(state),subscribe(listener){listeners.add(listener);listener(structuredClone(state));return()=>listeners.delete(listener);}};
}
