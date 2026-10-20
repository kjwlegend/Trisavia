import {readPhase} from './world-read-provider.js';
const blank=phase=>({phase,data:null,errorCode:''});
export function createWalletReadProvider(session,directory){
  let state=blank('idle'),identity=session.snapshot().observationRevision,generation=0,request=null,disposed=false;
  const listeners=new Set(),snapshot=()=>structuredClone(state),emit=()=>{for(const listener of listeners)listener(snapshot());};
  function clear(phase='idle',errorCode=''){generation++;request?.abort();request=null;state={...blank(phase),errorCode};emit();}
  const stopSession=session.subscribe(value=>{if(value.observationRevision===identity)return;identity=value.observationRevision;clear(!value.authenticated?'session':!value.selectedAgentId?'no_agent':'idle');});
  const stopScope=directory.subscribe((key,value)=>{if(['holdings','messages','notifications'].includes(key)&&['denied','session'].includes(value.phase))clear(value.phase==='session'?'session':'idle',value.errorCode);});
  async function load(){
    if(disposed)return;clear('loading');const epoch=generation,selected=session.snapshot().selectedAgentId;
    if(!session.snapshot().authenticated){clear('session');return;}if(!selected){clear('no_agent');return;}
    const controller=new AbortController();request=controller;
    const current=()=>!disposed&&epoch===generation&&request===controller;
    try{
      const meta=await directory.prepareOperation('wallet-query','wallet',{signal:controller.signal});if(!current())return;
      const capability=meta.capabilities.walletApi,declaration=meta.catalog.operations.find(value=>value.id==='wallet-query');
      const inputSchema=meta.documents.get(JSON.stringify(['schema',declaration?.inputSchema]));
      if(capability?.protocolVersion!==1||capability?.readOnly!==true||capability?.query?.operationId!=='wallet-query'||capability.query.method!=='POST'||capability.query.path!=='/v1/wallet/query'||declaration?.path!=='/v1/wallet/query'||declaration?.method!=='POST'||!inputSchema?.properties?.agentRef)throw Object.assign(new Error('channel_not_enabled'),{code:'channel_not_enabled'});
      const envelope=await session.readWallet({signal:controller.signal});if(!current())return;const data=envelope?.data;
      if(envelope?.protocolVersion!==1||envelope.instanceId!==meta.instanceId||typeof envelope.permissionVersion!=='string'||!envelope.permissionVersion||data?.agentRef?.moduleId!=='profiles'||data.agentRef.type!=='profiles.agent@1'||data.agentRef.id!==selected||!Number.isSafeInteger(data.accountVersion)||data.accountVersion<1||data.currency?.code!=='star_coin'||data.currency.scale!==0||typeof data.currency.displayName!=='string'||!data.currency.displayName.trim()||!Number.isSafeInteger(data.balance)||data.balance<0||data.dataMode!=='platform'||data.source?.kind!=='account_initialization'||!['migration','registration'].includes(data.initializationSource)||!Number.isSafeInteger(data.initializedAt)||data.initializedAt<0||!Number.isSafeInteger(data.asOf)||data.asOf<0)throw Object.assign(new Error('response_unknown'),{code:'response_unknown'});
      state={phase:'ready',data:structuredClone(data),errorCode:''};emit();
    }catch(error){if(!current()||error.name==='AbortError')return;const phase=error.code==='wallet_not_initialized'?'not_initialized':readPhase(error);if(['denied','session'].includes(phase))directory.invalidatePrivate(error);state={...blank(phase),errorCode:error.code||'response_unknown'};emit();}
    finally{if(request===controller)request=null;}
  }
  return{snapshot,load,cancel(){if(request)clear('idle');},subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},dispose(){disposed=true;stopSession();stopScope();clear();listeners.clear();}};
}
