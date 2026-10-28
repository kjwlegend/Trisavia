import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerEntryStore} from '../../apps/web/public/owner-entry.js';

// Only synchronous browser-state fixtures. No network, dictionaries or identity service.
function fixture(path,{state=null,storageFailure=false}={},work){
 const originals=new Map(['location','history','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),data=new Map(),events=[];
 let location=new URL(path,'https://account.example.test');
 const history={state,replaceState(next,_unused,url){events.push('replace');this.state=next;location=new URL(url,location);Object.defineProperty(globalThis,'location',{value:location,configurable:true});}};
 Object.defineProperty(globalThis,'location',{value:location,configurable:true});
 Object.defineProperty(globalThis,'history',{value:history,configurable:true});
 Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:key=>data.get(key)??null,setItem(key,value){if(storageFailure)throw Error('synthetic storage unavailable');data.set(key,value);events.push('save');},removeItem:key=>data.delete(key)},configurable:true});
 try{return work({store:createOwnerEntryStore(),events,history,data,get location(){return location;}});}
 finally{for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

for(const [path,prefix]of [['/owner','/'],['/en/owner','/en/'],['/zh-CN/owner','/zh-CN/']]){
 test(`${path} opens the account and keeps its explicit locale through normalization`,()=>{
  for(const hash of ['','#login','#register'])fixture(path+hash,{},f=>{
   const intent=f.store.capture();assert.deepEqual(intent,{mode:hash==='#login'?'login':hash==='#register'?'register':'account',agentId:''});
   assert.equal(f.location.pathname,prefix);assert.equal(f.location.hash,hash||'#account');assert.equal(f.history.state,null);assert.equal(f.data.size,0);
  });
  const proof='handoff_fixture.'+'s'.repeat(43);
  fixture(path+'#handoff='+proof,{},f=>{assert.equal(f.store.capture().mode,'account');assert.deepEqual(f.events,['save','replace']);assert.deepEqual(f.store.peek(),{kind:'handoff',proof});assert.equal(f.location.pathname,prefix);assert.equal(f.location.hash,'#account');assert.ok(!JSON.stringify(f.history.state).includes(proof));});
 });
}

test('private capture failures retain the original fragment; only recognized prefixes are used',()=>{
 const proof='assistance_fixture.'+'a'.repeat(43);
 fixture('/en/owner#assistance='+proof,{storageFailure:true},f=>{assert.throws(()=>f.store.capture(),error=>error.code==='private_storage_unavailable');assert.deepEqual(f.events,[]);assert.equal(f.location.hash,'#assistance='+proof);});
 for(const path of ['/fr/owner','/enough/owner'])fixture(path,{},f=>{assert.deepEqual(f.store.capture(),{mode:'',agentId:''});assert.equal(f.location.pathname,path);assert.deepEqual(f.events,[]);});
 fixture('/zh-CN/owner#account',{state:{accountTarget:{agentId:'synthetic-agent'}}},f=>{assert.deepEqual(f.store.capture(),{mode:'profile',agentId:'synthetic-agent'});assert.equal(f.location.pathname,'/zh-CN/');assert.deepEqual(f.history.state,{accountTarget:{agentId:'synthetic-agent'}});});
});
