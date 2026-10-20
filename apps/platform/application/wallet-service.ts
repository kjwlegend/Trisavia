import { randomUUID } from 'node:crypto';
import type { JsonObject, M1ReadSession, M1Store, StoredRow } from '../contracts/store.ts';
import { fail, object, text } from '../domains/common/errors.ts';
import { key, ref } from '../domains/perception/protocol.ts';
import { walletRepository } from '../domains/wallet/repository.ts';
export const walletCapability={protocolVersion:1,query:{operationId:'wallet-query',method:'POST',path:'/v1/wallet/query'},readOnly:true,currency:{code:'star_coin',displayName:'星币',scale:0}};
export function createWalletService(store:M1Store,authenticate:(tx:M1ReadSession,token:unknown,kinds:readonly string[])=>StoredRow,now:()=>number){
 return {capabilities:()=>walletCapability,query:(raw:unknown,token:unknown):JsonObject=>store.read(tx=>{
  const input=object(raw,['protocolVersion','consumerId','purpose','agentRef']);if(input.protocolVersion!==1)fail('protocol_unsupported',422,'Protocol major 1 is required');text(input.consumerId,'consumerId',1,100);
  const actor=authenticate(tx,token,['runtime','owner_session']),runtime=actor.data.kind==='runtime';
  const purpose=text(input.purpose,'purpose',1,60);if(!(runtime?['agent-inspect','agent-perception']:['human-inspect']).includes(purpose))fail('insufficient_scope',403,'Purpose is not permitted');
  let agentId:string,binding:StoredRow|undefined;
  if(runtime){agentId=String(actor.data.agentId);if(input.agentRef!==undefined){const ar=ref(input.agentRef);if(ar.moduleId!=='profiles'||ar.type!=='profiles.agent@1'||ar.id!==agentId)fail('target_not_accessible',404,'Target is not accessible');}}
  else{if(input.agentRef===undefined)fail('target_not_accessible',404,'Target is not accessible');const ar=ref(input.agentRef);if(ar.moduleId!=='profiles'||ar.type!=='profiles.agent@1')fail('target_not_accessible',404,'Target is not accessible');agentId=ar.id;binding=tx.scan('bindings',{agentId,ownerId:String(actor.data.ownerId),active:true},{limit:1})[0];if(!binding)fail('target_not_accessible',404,'Target is not accessible');}
  const account=walletRepository(tx).get(agentId);if(!account)fail('wallet_not_initialized',409,'Wallet account is not initialized');
  return {protocolVersion:1,instanceId:store.instanceId,requestId:`request_${randomUUID()}`,permissionVersion:key({actorId:runtime?actor.data.agentId:actor.data.ownerId,kind:actor.data.kind,generation:actor.data.runtimeVersion??actor.data.ownerAuthVersion,binding:binding?{id:binding.id,version:binding.version}:null,epoch:store.recoveryEpoch}),data:{agentRef:{moduleId:'profiles',type:'profiles.agent@1',id:agentId},accountVersion:account.version,currency:{code:account.data.currencyCode,displayName:account.data.currencyName,scale:account.data.scale},balance:account.data.balance,dataMode:'platform',source:{kind:'account_initialization'},initializationSource:account.data.initializationSource,initializedAt:account.data.initializedAt,asOf:now()}};
 })};
}
