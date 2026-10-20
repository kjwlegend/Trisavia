import assert from 'node:assert/strict';
import test from 'node:test';
import { commitRuntimeCommandIn, hashRuntimeRequest } from '../../apps/platform/domains/runtime/command.ts';
import { RuntimeError, type CommandKey, type CommandReceipt, type RuntimeTransaction } from '../../apps/platform/contracts/runtime-store.ts';

const key:CommandKey={domain:'test',action:'submit',commandId:'once',principal:{kind:'agent',id:'a'},recoveryEpoch:'epoch'};
function fixture(){
  const receipts=new Map<string,CommandReceipt>();let state=0,authorized=true,checks=0;
  const context={recoveryEpoch:'epoch',now:()=>123,
    commands:{get:async()=>receipts.get('once'),insert:async(receipt:CommandReceipt)=>{receipts.set('once',structuredClone(receipt));}},
    attempt:async<T>(work:(context:RuntimeTransaction)=>Promise<T>)=>{const before=state;try{return await work(context as unknown as RuntimeTransaction);}catch(error){state=before;throw error;}},
  } as unknown as RuntimeTransaction;
  return {context,receipts,get state(){return state;},set state(value:number){state=value;},set authorized(value:boolean){authorized=value;},get checks(){return checks;},
    authorize:async()=>{checks++;if(!authorized)throw new Error('revoked');}};
}
test('normalized request identity; replay still authorizes, and a different body conflicts',async()=>{
  assert.equal(hashRuntimeRequest({b:2,a:{z:0,y:true}}),hashRuntimeRequest({a:{y:true,z:0},b:2}));
  const f=fixture(),options={key,requestHash:hashRuntimeRequest({x:1}),authorize:f.authorize,handle:async()=>{f.state++;return {result:{ok:true},eventIds:[]};}};
  const first=await commitRuntimeCommandIn(f.context,options);first.result.ok=false;
  assert.equal((await commitRuntimeCommandIn(f.context,options)).result.ok,true);assert.equal(f.state,1);assert.equal(f.checks,2);
  await assert.rejects(commitRuntimeCommandIn(f.context,{...options,requestHash:hashRuntimeRequest({x:2})}),(error:unknown)=>error instanceof RuntimeError&&error.code==='command_conflict');
  f.authorized=false;await assert.rejects(commitRuntimeCommandIn(f.context,options),/revoked/);
});
test('known rejection rolls back partial work before recording rejection; unknown failure remains uncommitted',async()=>{
  const f=fixture(),options={key,requestHash:hashRuntimeRequest({x:1}),authorize:f.authorize,handle:async()=>{f.state=42;throw new Error('business');},classifyRejection:(error:unknown)=>error instanceof Error&&error.message==='business'?{outcome:'rejected' as const,result:{code:'business_rejected'}}:undefined};
  assert.equal((await commitRuntimeCommandIn(f.context,options)).outcome,'rejected');assert.equal(f.state,0);assert.equal(f.receipts.size,1);
  const other=fixture();await assert.rejects(commitRuntimeCommandIn(other.context,{...options,authorize:other.authorize,handle:async()=>{other.state=5;throw new Error('database');}}),/database/);assert.equal(other.state,0);assert.equal(other.receipts.size,0);
});
