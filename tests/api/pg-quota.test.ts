import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import {postgresFixture} from './postgresql-fixture.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {payloadHash} from '../../apps/platform/domains/access/credentials.ts';
import type {M1Store,M1ReadSession,M1Transaction,QuotaCountQuery,StoredRow} from '../../apps/platform/contracts/store.ts';
const token=()=>`${randomUUID()}.${randomBytes(32).toString('base64url')}`;
const at=Date.UTC(2026,9,20),hour=3600000;
function observedStore(store:M1Store){
 const queries:QuotaCountQuery[]=[],reads:string[]=[],policy={blockHistory:false};
 const wrap=<T extends M1ReadSession>(tx:T):T=>new Proxy(tx,{get(target,key){
  if(key==='quotaCount')return async(query:QuotaCountQuery)=>{queries.push(query);return await tx.quotaCount(query);};
  if(key==='find')return async(table:Parameters<T['find']>[0],filters?:Parameters<T['find']>[1])=>{if(policy.blockHistory&&['email_attempts','mail_jobs'].includes(table))throw new Error('Quota must not fetch history rows');return await tx.find(table,filters);};
  if(key==='get')return async(table:Parameters<T['get']>[0],id:string)=>{if(table==='email_attempts'||table==='mail_jobs')reads.push(`${table}:${id}`);return await tx.get(table,id);};
  return Reflect.get(target,key);
 }});
 const port:M1Store={instanceId:store.instanceId,recoveryEpoch:store.recoveryEpoch,close:async()=>{},read:work=>store.read(tx=>work(wrap(tx))),transaction:work=>store.transaction(tx=>work(wrap(tx)))};
 return {port,queries,reads,policy};
}
async function pending(service:ReturnType<typeof createM1Service>,email:string,clientIp='source-a'){
 const browserToken=token(),attemptId=randomUUID();
 await service.invoke('startRegistration',{operationId:randomUUID(),attemptId,browserToken,username:`Q_${randomUUID().slice(0,8)}`,email},undefined,{clientIp});
 return {browserToken,attemptId};
}

test('start verification counts the strict hour and source without fetching historic attempts',async t=>{
 const pg=await postgresFixture();t.after(()=>pg.dispose());
 const seen=observedStore(pg.store),service=createM1Service(seen.port,{email:{mode:'experience'},now:()=>at});
 const first=await pending(service,'quota-first@example.test');
 const row=await pg.store.read(async tx=>(await tx.get('email_attempts',first.attemptId))!);
 const sourceKey=payloadHash([pg.options.instanceId,'source','source-a']);
 await pg.store.transaction(async tx=>{
  for(let n=0;n<250;n++){
   const id=randomUUID(),credential=randomUUID();
   await tx.insert('credentials',{id:credential,version:1,data:{fingerprint:randomUUID(),kind:'email_registration',verifier:'fixture-only',epoch:pg.options.recoveryEpoch,active:true}});
   await tx.insert('email_attempts',{id,version:1,data:{...row.data,browserCredentialId:credential,createdAt:at-hour-(n===0?0:1),sourceKey}});
  }
 });
 seen.queries.length=0;seen.reads.length=0;seen.policy.blockHistory=true;
 await pending(service,'quota-window@example.test');
 assert.deepEqual(seen.queries.map(q=>({kind:q.kind,limit:q.limit})),[{kind:'email_attempts_recent',limit:30},{kind:'email_attempts_recent',limit:1000}]);
 assert.equal(seen.reads.length,1,'only the explicitly requested new attempt is looked up');
 // Put the current source exactly at 30; window-boundary history never counts.
 await pg.store.transaction(async tx=>{
  for(let n=0;n<28;n++){
   const id=randomUUID(),credential=randomUUID();
   await tx.insert('credentials',{id:credential,version:1,data:{fingerprint:randomUUID(),kind:'email_registration',verifier:'fixture-only',epoch:pg.options.recoveryEpoch,active:true}});
   await tx.insert('email_attempts',{id,version:1,data:{...row.data,browserCredentialId:credential,createdAt:at-hour+1,sourceKey}});
  }
 });
 await assert.rejects(pending(service,'quota-blocked@example.test'),{code:'email_rate_limited'});
 await pending(service,'different-source@example.test','source-b');
});

test('sending uses bounded same-email and owner association counts, excludes old ciphertext and preserves send receipts',async t=>{
 const pg=await postgresFixture();t.after(()=>pg.dispose());
 const seen=observedStore(pg.store),service=createM1Service(seen.port,{email:{mode:'experience'},now:()=>at});
 const target=await pending(service,'same-email@example.test'),other=await pending(service,'same-email@example.test'),different=await pending(service,'other-email@example.test');
 const sourceKey=payloadHash([pg.options.instanceId,'source','source-a']);
 const insert=async(rows:{id:string;data:StoredRow['data']}[])=>pg.store.transaction(async tx=>{for(const row of rows)await tx.insert('mail_jobs',{...row,version:1});});
 const row=(data:StoredRow['data'])=>({id:randomUUID(),data:{purpose:'code',createdAt:at-120000,ownerKey:'unrelated-owner',sourceKey:'different-source',encryptedPayload:'opaque-not-to-be-loaded'.repeat(100),...data}});
 const history=Array.from({length:250},()=>row({createdAt:at-25*hour,ownerKey:'same-email@example.test',sourceKey}));
 // Another owner/attempt with the same email counts. Different email and a notification do not.
 await insert([...history,row({attemptId:other.attemptId}),row({attemptId:other.attemptId,createdAt:at-60000}),row({attemptId:different.attemptId,createdAt:at-1}),row({purpose:'notification',ownerKey:'same-email@example.test',createdAt:at-1})]);
 seen.queries.length=0;seen.reads.length=0;seen.policy.blockHistory=true;
 const input={operationId:randomUUID(),attemptId:target.attemptId};
 const sent=await service.invoke('sendRegistrationCode',input,target.browserToken,{clientIp:'source-a'});
 assert.equal(sent.attemptId,target.attemptId);
 assert.deepEqual(seen.queries.map(q=>q.limit),[1,3,10,20,1000]);
 assert(seen.reads.every(key=>!key.startsWith('email_attempts:')||key.endsWith(target.attemptId)),'no per-history-attempt get');
 assert.deepEqual(await service.invoke('sendRegistrationCode',input,target.browserToken,{clientIp:'source-a'}),sent,'the original send receipt remains exact');
 const fresh=await pending(service,'same-email@example.test');
 await assert.rejects(service.invoke('sendRegistrationCode',{operationId:randomUUID(),attemptId:fresh.attemptId},fresh.browserToken,{clientIp:'source-a'}),{code:'email_rate_limited'});
});
