import test from 'node:test';import assert from 'node:assert/strict';
import {createOwnerLocaleSync} from '../../apps/web/public/owner-ui-preferences.js';
import {readEmailProgress} from '../../apps/web/public/owner-email-state.js';
import {parseOwnerBackup} from '../../apps/web/public/owner-backup.js';
const store=()=>{const data=new Map;return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),data};};
function language(){let current='en',source='browser',listener=()=>{},applied=[];return{getLocale:()=>current,getLocaleSource:()=>source,onLocaleChange(fn){listener=fn;return()=>{listener=()=>{}};},async setLocale(value,options){if(options.isCurrent&&!options.isCurrent())return false;applied.push(value);current=value;source=options.source;listener();return true;},change(value,why='explicit'){current=value;source=why;listener();},applied};}
const view=(ownerId,version=1,uiLocale=null)=>({ownerId,version,uiLocale,updatedAt:uiLocale?1000:null,asOf:1000});
const committed=(ownerId,body)=>({...view(ownerId,body.expectedVersion+1,body.uiLocale),operationId:body.operationId,outcome:'committed',receiptId:'receipt-test',changed:true,serverTime:1000});
const error=(status,code)=>Object.assign(Error(code),{status,code});

test('account/browser merges are read only; only a later explicit human change saves',async()=>{
 const storage=store(),locale=language(),calls=[],owner={authenticated:true,ownerId:'owner-aaa',sessionToken:'synthetic-session'},service=createOwnerLocaleSync({storage,origin:'https://test.invalid',locale,context:()=>owner,operationId:()=> 'original-op-001',request:async(path,options)=>{calls.push({path,...options});return options.method==='POST'?committed(owner.ownerId,options.body):view(owner.ownerId,4,'zh-CN');}});
 await service.syncContext();assert.deepEqual(locale.applied,['zh-CN']);assert.equal(calls.filter(x=>x.method==='POST').length,0);locale.change('en','browser');await service.settled();assert.equal(calls.length,1);locale.change('en');await service.settled();assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.deepEqual(calls[1].body,{operationId:'original-op-001',expectedVersion:4,uiLocale:'en'});assert.equal(storage.data.size,0);service.dispose();
});

test('unknown preference write recovers the original operation and frozen locale after reload',async()=>{
 const storage=store(),locale=language(),owner={authenticated:true,ownerId:'owner-aaa',sessionToken:'synthetic-session'},posts=[];let first=true;
 const request=async(path,options)=>{if(options.method==='POST'){posts.push({...options.body});if(first)throw error(503,'network_unknown');return committed(owner.ownerId,options.body);}if(path.startsWith('/operations/'))throw error(404,'not_found');return view(owner.ownerId,7,'en');};
 let service=createOwnerLocaleSync({storage,origin:'https://test.invalid',locale,context:()=>owner,operationId:()=> 'original-op-002',request});await service.syncContext();locale.change('zh-CN');await service.settled();assert.equal(service.snapshot().phase,'pending');const original=service.snapshot().pending;service.dispose();locale.change('en');
 service=createOwnerLocaleSync({storage,origin:'https://test.invalid',locale,context:()=>owner,operationId:()=>{throw Error('must not create a new operation');},request});await service.syncContext();assert.equal(posts.length,1);assert.deepEqual(service.snapshot().pending,original);first=false;await service.retry();assert.equal(posts.length,2);assert.deepEqual(posts[1],posts[0]);assert.equal(posts[1].uiLocale,'zh-CN');assert.equal(storage.data.size,0);service.dispose();
});

test('late reads and receipt results cannot change another Owner context',async()=>{
 const storage=store(),locale=language();let owner={authenticated:true,ownerId:'owner-aaa',sessionToken:'session-A'},release;
 const service=createOwnerLocaleSync({storage,origin:'https://test.invalid',locale,context:()=>owner,request:async()=>owner.ownerId==='owner-aaa'?new Promise(resolve=>release=resolve):view('owner-bbb',1,null)});
 const first=service.syncContext();await new Promise(setImmediate);owner={authenticated:true,ownerId:'owner-bbb',sessionToken:'session-B'};await service.syncContext();release(view('owner-aaa',1,'zh-CN'));await first;assert.deepEqual(locale.applied,[]);assert.equal(service.snapshot().phase,'ready');service.dispose();
});

test('legacy and new recovery progress preserve optional locale without importing a new target',()=>{
 const savedStorage=globalThis.sessionStorage,savedLocation=globalThis.location,storage=store();Object.defineProperty(globalThis,'sessionStorage',{value:storage,configurable:true});Object.defineProperty(globalThis,'location',{value:{origin:'https://test.invalid'},configurable:true});
 try{const source={format:'connet-email-progress-v1',origin:location.origin,kind:'registration',attemptId:'93fcedcb-2f06-40d1-986f-a56e26240af3',browserToken:'browser_test.'+'a'.repeat(43),username:'sample_owner',email:'sample@example.test',started:true,sendOperationId:'send-original-001',sendUiLocale:'zh-CN',pending:{operationId:'send-original-001',scope:'owner-registration:93fcedcb-2f06-40d1-986f-a56e26240af3',action:'sendRegistrationCode',uiLocale:'zh-CN'}};storage.setItem('connet.owner.email.v1',JSON.stringify(source));assert.equal(readEmailProgress().pending.uiLocale,'zh-CN');assert.equal(readEmailProgress().sendUiLocale,'zh-CN');delete source.sendUiLocale;delete source.pending.uiLocale;storage.setItem('connet.owner.email.v1',JSON.stringify(source));assert.ok(!Object.hasOwn(readEmailProgress().pending,'uiLocale'));source.pending.uiLocale='fr';storage.setItem('connet.owner.email.v1',JSON.stringify(source));assert.throws(()=>readEmailProgress());
 const backup={format:'connet-owner-v2',origin:location.origin,ownerId:'93fcedcb-2f06-40d1-986f-a56e26240af3',sessionToken:'session_test.'+'s'.repeat(43),recoveryToken:'recovery_test.'+'r'.repeat(43),sourceRecoveryToken:'recovery_old.'+'o'.repeat(43),pendingOperation:{operationId:'recover-original-001',scope:'owner:93fcedcb-2f06-40d1-986f-a56e26240af3',action:'recover',input:{uiLocale:'en'}}};assert.equal(parseOwnerBackup(JSON.stringify(backup),location.origin).pendingOperation.input.uiLocale,'en');delete backup.pendingOperation.input;assert.ok(!Object.hasOwn(parseOwnerBackup(JSON.stringify(backup),location.origin).pendingOperation,'input'));
 }finally{Object.defineProperty(globalThis,'sessionStorage',{value:savedStorage,configurable:true});Object.defineProperty(globalThis,'location',{value:savedLocation,configurable:true});}
});

test('the account locale commit guard expires during asynchronous dictionary loading',async()=>{
 const storage=store(),locale=language();let owner={authenticated:true,ownerId:'owner-aaa',sessionToken:'session-A'},finish;const applied=[];
 locale.setLocale=(value,options)=>new Promise(resolve=>{finish=()=>{if(!options.isCurrent()){resolve(false);return;}applied.push(value);resolve(true);};});
 const service=createOwnerLocaleSync({storage,origin:'https://test.invalid',locale,context:()=>owner,request:async()=>view('owner-aaa',1,'zh-CN')});const old=service.syncContext();await new Promise(setImmediate);owner={authenticated:false};await service.syncContext();finish();await old;assert.deepEqual(applied,[]);assert.equal(service.snapshot().phase,'idle');service.dispose();
});
