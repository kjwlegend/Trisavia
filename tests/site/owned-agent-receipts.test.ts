import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {createOwnerReceiptReader,confirmUnknownOwnerOperation} from '../../apps/web/public/owner-receipt.js';
// @ts-expect-error Browser module is intentionally plain JS.
import {createOwnedAgentBinding} from '../../apps/web/public/hud/owned-agents.js';

// Transport faults drive the receipt functions used by both production unknown
// branches and the existing map binding; this does not mount controller or DOM.
type Pending={operationId:string;scope:string;action:string;path?:string;method?:string;targetId?:string;input?:Record<string,unknown>;uncertain?:boolean};
type Vault={ownerId:string;sessionToken:string;recoveryToken?:string;pendingOperation?:Pending};
type Context={source:Vault;ownerId:string;sessionToken:string;recoveryToken:string|undefined;generation:number;authenticated:boolean};
type Projection={agents:Array<{agentId:string}>;selectedAgentId:string};
type RequestOptions={token?:string;method?:string;body?:Record<string,unknown>};
const ownerA='11111111-1111-4111-8111-111111111111',ownerB='22222222-2222-4222-8222-222222222222';
const agentA='agent_receipt_a',agentB='agent_receipt_b';
const proof=(id:string,letter:string)=>`${id}.${letter.repeat(43)}`;
const tokenA=proof('session_receipt_a','a'),tokenB=proof('session_receipt_b','b');
const unauthorized=()=>Object.assign(new Error('Synthetic unauthorized response'),{status:401,code:'authentication_failed'});
const pending=(ownerId=ownerA,agentId=agentA):Pending=>({operationId:'operation_receipt_unknown_01',scope:`owner:${ownerId}`,action:'unpublishProfile',
 path:`/agents/${agentId}/profile/unpublish`,method:'POST',targetId:agentId,input:{expectedVersion:3,expectedPolicyVersion:1},uncertain:true});
const context=(source:Vault,generation=1,authenticated=true):Context=>({source,ownerId:source.ownerId,sessionToken:source.sessionToken,recoveryToken:source.recoveryToken,generation,authenticated});
const safeSummary=(agentId:string)=>({authenticated:true,phase:'ready',agents:[{agentId,name:'合成 Agent',avatar:{template:'basic',color:'blue'},profileSource:'published'}],selectedAgentId:agentId});

function summaryChannel(initial:Record<string,unknown>){
 let value=initial;const listeners=new Set<(state:Record<string,unknown>)=>void>();
 return{
  subscribe(listener:(state:Record<string,unknown>)=>void){listeners.add(listener);listener(value);return()=>listeners.delete(listener);},
  publish(next:Record<string,unknown>){value=next;for(const listener of listeners)listener(next);},
 };
}
function mapScene(){const calls:Projection[]=[];return{calls,setOwnedAgents(value:Projection){calls.push(structuredClone(value));}};}
const last=(scene:ReturnType<typeof mapScene>)=>scene.calls.at(-1);
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
 const promise=new Promise<T>((resolvePromise,rejectPromise)=>{resolve=resolvePromise;reject=rejectPromise;});
 return{promise,resolve,reject};
}

test('unknown management POST followed by its automatic receipt 401 clears the map without losing the command',async()=>{
 const original=pending(),vault:Vault={ownerId:ownerA,sessionToken:tokenA,recoveryToken:proof('recovery_receipt_a','r'),pendingOperation:original};
 const payload={body:{operationId:original.operationId,...original.input},token:tokenA},savedVault=structuredClone(vault),savedBody=structuredClone(payload.body);
 const channel=summaryChannel(safeSummary(agentA)),scene=mapScene(),selections:string[]=[],expired:Array<{source:Vault;sessionToken:string;generation:number}>=[];
 const binding=createOwnedAgentBinding(channel,(id:string)=>selections.push(id));binding.attach(scene);
 assert.equal(last(scene)?.selectedAgentId,agentA);
 const calls:Array<{path:string;options:RequestOptions}>=[],unknown=Object.assign(new Error('Synthetic transport uncertainty'),{status:0,code:'network_unknown'}),receiptError=unauthorized();
 const request=async(path:string,options:RequestOptions={})=>{
  calls.push({path,options});if(options.method==='POST')throw unknown;throw receiptError;
 };
 // The production unknown-result function owns the automatic GET. This adapter
 // models the existing controller's expiry publication, with no copied guard.
 const receipt=createOwnerReceiptReader({request,context:()=>context(vault),expire:(value:{source:Vault;sessionToken:string;generation:number})=>{
  expired.push(value);channel.publish({authenticated:false,phase:'expired',agents:[],selectedAgentId:''});
 }});
 let committed=0;
 await assert.rejects(request(original.path!,{method:'POST',body:payload.body,token:payload.token}),(error:unknown)=>error===unknown);
 const confirmed=await confirmUnknownOwnerOperation(original,{receipt,committed:()=>{committed++;}});
 assert.equal(confirmed,false);assert.equal(committed,0);assert.equal(calls.length,2);
 assert.equal(calls[1]?.path,`/operations/${original.operationId}?scope=${encodeURIComponent(original.scope)}&action=${original.action}`);
 assert.equal(calls[1]?.options.token,tokenA);assert.equal(expired.length,1);
 assert.equal(expired[0]?.source,vault);assert.equal(expired[0]?.sessionToken,tokenA);assert.equal(expired[0]?.generation,1);
 assert.deepEqual(last(scene),{agents:[],selectedAgentId:''});binding.select(agentA,{});assert.deepEqual(selections,[]);
 assert.equal(vault.pendingOperation,original);assert.deepEqual(vault,savedVault);assert.deepEqual(payload.body,savedBody);assert.equal(payload.token,tokenA);
 binding.dispose();
});

test('a delayed old-owner receipt 401 cannot expire a newer authenticated owner or restore the old target',async()=>{
 const original=pending(),sourceA:Vault={ownerId:ownerA,sessionToken:tokenA,pendingOperation:original},savedA=structuredClone(sourceA);
 const sourceB:Vault={ownerId:ownerB,sessionToken:tokenB},savedB=structuredClone(sourceB);
 let current=context(sourceA,4);const response=deferred<unknown>(),started=deferred<void>();
 const channel=summaryChannel(safeSummary(agentA)),scene=mapScene(),expired:unknown[]=[],selections:string[]=[];
 const binding=createOwnedAgentBinding(channel,(id:string)=>selections.push(id));binding.attach(scene);
 const receipt=createOwnerReceiptReader({context:()=>current,request:async(_path:string,options:RequestOptions)=>{
  assert.equal(options.token,tokenA);started.resolve(undefined);return response.promise;
 },expire:(value:unknown)=>{expired.push(value);channel.publish({authenticated:false,phase:'expired',agents:[],selectedAgentId:''});}});
 let committed=0;const confirmation=confirmUnknownOwnerOperation(original,{receipt,committed:()=>{committed++;}});
 await started.promise;current=context(sourceB,5);channel.publish(safeSummary(agentB));
 response.reject(unauthorized());assert.equal(await confirmation,false);
 assert.deepEqual(expired,[]);assert.equal(committed,0);assert.equal(current.source,sourceB);
 assert.deepEqual(last(scene)?.agents.map(agent=>agent.agentId),[agentB]);assert.equal(last(scene)?.selectedAgentId,agentB);
 binding.select(agentA,{});assert.deepEqual(selections,[]);binding.select(agentB,{});assert.deepEqual(selections,[agentB]);
 assert.deepEqual(sourceA,savedA);assert.equal(sourceA.pendingOperation,original);assert.deepEqual(sourceB,savedB);binding.dispose();
});

test('recovery, registration and email-browser receipt failures do not revoke the displayed owner session',async()=>{
 const recovery=proof('recovery_receipt_b','r'),registrationBrowser=proof('registration_browser','c'),emailBrowser=proof('email_browser_proof','e');
 const active:Vault={ownerId:ownerB,sessionToken:tokenB,recoveryToken:recovery},saved=structuredClone(active);
 const cases=[
  {name:'independent recovery capability',action:'rejectRecoveryRequest',scope:`owner:${ownerB}`,snapshot:context(active),expectedToken:recovery},
  {name:'password recovery authentication action',action:'recover',scope:`owner:${ownerB}`,snapshot:context(active),expectedToken:tokenB},
  {name:'registration browser capability',action:'registerOwner',scope:'owner-registration:registration_attempt',snapshot:context({ownerId:ownerB,sessionToken:registrationBrowser},1,false),expectedToken:registrationBrowser},
  {name:'email recovery browser capability',action:'verifyRecoveryEmail',scope:'owner-email-recovery:email_attempt',snapshot:context({ownerId:ownerB,sessionToken:emailBrowser},1,false),expectedToken:emailBrowser},
 ];
 for(const item of cases){
  const original:Pending={operationId:'operation_non_management_01',action:item.action,scope:item.scope},savedPending=structuredClone(original);
  const channel=summaryChannel(safeSummary(agentB)),scene=mapScene(),expired:unknown[]=[],error=unauthorized();
  const binding=createOwnedAgentBinding(channel);binding.attach(scene);
  const receipt=createOwnerReceiptReader({context:()=>item.snapshot,request:async(_path:string,options:RequestOptions)=>{assert.equal(options.token,item.expectedToken,item.name);throw error;},
   expire:(value:unknown)=>{expired.push(value);channel.publish({authenticated:false,phase:'expired',agents:[],selectedAgentId:''});}});
  await assert.rejects(receipt(original),(actual:unknown)=>actual===error,item.name);
  assert.deepEqual(expired,[],item.name);assert.equal(last(scene)?.selectedAgentId,agentB,item.name);
  assert.deepEqual(last(scene)?.agents.map(agent=>agent.agentId),[agentB],item.name);
  assert.deepEqual(original,savedPending,item.name);assert.deepEqual(active,saved,item.name);binding.dispose();
 }
});
