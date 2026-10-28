import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import Fastify from 'fastify';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {M1_TABLES,StorageError,type M1Store,type M1ReadSession,type M1Transaction,type M1Table,type StoredRow,type ExactFilters,type JsonObject} from '../../apps/platform/contracts/store.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import {openMail} from '../../apps/platform/domains/access/email-secrets.ts';
import {encode,decode} from '../../apps/platform/infrastructure/postgresql/codec.ts';
import {resolveModel,BASE_MODELS} from '../../apps/platform/infrastructure/postgresql/model.ts';
import {OWNER_UI_PREFERENCES_MIGRATION} from '../../apps/platform/infrastructure/postgresql/owner-ui-preferences-migration.ts';
import {FOUNDATION_HTTP_OPERATIONS} from '../../apps/platform/contracts/foundation-operations.ts';
import type {PoolClient} from 'pg';

const proof=()=>`${randomUUID()}.${randomBytes(32).toString('base64url')}`,copy=<T>(value:T):T=>structuredClone(value);
const mailConfig={mode:'resend' as const,resend:{apiKey:'synthetic-never-dispatched',from:'security@example.test',publicOrigin:'https://example.test',codeSecret:'synthetic-32-byte-mail-encryption-secret-for-tests'}};
/** Narrow isolated store: production codecs + real credential verification, no PG/listener/provider. */
async function fixture(t:TestContext){
 let state=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(table=>[table,new Map()]));
 const stats={reads:0,transactions:0},control={unknownAfterCommit:false};let now=1793192400000;
 const matches=(row:StoredRow,filters:ExactFilters)=>Object.entries(filters).every(([key,value])=>row.data[key]===value);
 const reader=():M1ReadSession=>({
  async get<T extends JsonObject>(table:M1Table,id:string){return copy(state.get(table)!.get(id)) as StoredRow<T>|undefined;},
  async find<T extends JsonObject>(table:M1Table,filters:ExactFilters={}){return copy([...state.get(table)!.values()].filter(row=>matches(row,filters))) as StoredRow<T>[];},
  async scan<T extends JsonObject>(table:M1Table,filters:ExactFilters,options:{limit:number;afterId?:string}){return (await this.find<T>(table,filters)).filter(row=>!options.afterId||row.id>options.afterId).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,options.limit);},
  async count(table,filters,limit){return Math.min(limit,(await this.find(table,filters)).length);},
  async quotaCount(query){
   if(query.kind==='email_attempts_recent')return Math.min(query.limit,[...state.get('email_attempts')!.values()].filter(row=>Number(row.data.createdAt)>=query.since&&(!query.sourceKeys||query.sourceKeys.includes(String(row.data.sourceKey)))).length);
   if(query.kind==='code_mail_recent')return Math.min(query.limit,[...state.get('mail_jobs')!.values()].filter(row=>row.data.purpose==='code'&&Number(row.data.createdAt)>=query.since&&(!query.related||row.data.ownerKey===query.related.ownerKey||row.data.ownerKey===query.related.emailKey)&&(!query.sourceKeys||query.sourceKeys.includes(String(row.data.sourceKey)))).length);
   return 0;
  },
 });
 const store:M1Store={instanceId:'isolated-owner-ui-instance',recoveryEpoch:'isolated-owner-ui-epoch',async read(work){stats.reads++;return work(reader());},async transaction(work){
  stats.transactions++;const before=copy(state),session:M1Transaction={...reader(),async insert(table,row){encode(resolveModel(table,row),row);if(state.get(table)!.has(row.id))throw new StorageError('constraint','Duplicate synthetic row');state.get(table)!.set(row.id,copy(row));},async update(table,row,version){encode(resolveModel(table,row),row);if(state.get(table)!.get(row.id)?.version!==version)return false;assert.equal(row.version,version+1);state.get(table)!.set(row.id,copy(row));return true;},async remove(table,id,version){if(state.get(table)!.get(id)?.version!==version)return false;return state.get(table)!.delete(id);}};
  let result;try{result=await work(session);}catch(error){state=before;throw error;}
  if(control.unknownAfterCommit){control.unknownAfterCommit=false;throw new StorageError('unknown_commit','Synthetic response lost after commit');}return result;
 },async close(){}};
 function seed(table:M1Table,row:StoredRow){encode(resolveModel(table,row),row);state.get(table)!.set(row.id,copy(row));}
 function credential(kind:string,metadata:JsonObject){const token=proof(),parsed=parseToken(token,true);seed('credentials',{id:parsed.id,version:1,data:{kind,fingerprint:parsed.fingerprint,verifier:verifier(kind,parsed),epoch:store.recoveryEpoch,active:true,agentId:null,ownerId:null,expiresAt:null,...metadata}});return token;}
 function owner(){const id=randomUUID();seed('owners',{id,version:4,data:{status:'active',epoch:store.recoveryEpoch,authVersion:1,email:id+'@example.test',emailKey:id+'@example.test',emailVerified:true,emailVersion:1}});return {id,session:credential('owner_session',{ownerId:id,ownerAuthVersion:1}),recovery:credential('owner_recovery',{ownerId:id,ownerAuthVersion:1})};}
 const ownerA=owner(),ownerB=owner(),agentId=randomUUID();seed('agents',{id:agentId,version:1,data:{runtimeVersion:1,runtimeActive:true,createdAt:now}});const runtime=credential('runtime',{agentId,runtimeVersion:1});
 const service=createM1Service(store,{now:()=>now,email:mailConfig}),app=Fastify({logger:false});registerM1Routes(app,service);t.after(()=>app.close());
 return {store,service,app,ownerA,ownerB,runtime,stats,control,credential,seed,rows:(table:M1Table)=>copy([...state.get(table)!.values()]),tick:(ms:number)=>{now+=ms;},now:()=>now};
}
const bearer=(token:string)=>({authorization:'Bearer '+token});

test('human preferences GET is strictly read-only and self-scoped; POST keeps auth and uses an independent version',async t=>{
 const f=await fixture(t),before={...f.stats},read=await f.app.inject({url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session)});
 assert.equal(read.statusCode,200);assert.equal(read.headers['cache-control'],'no-store');assert.deepEqual(read.json(),{ownerId:f.ownerA.id,uiLocale:null,version:1,updatedAt:null,asOf:f.now()});assert.equal(f.stats.transactions,before.transactions);assert.equal(f.rows('operations').length,0);
 assert.equal((await f.app.inject('/v1/owner/ui-preferences')).statusCode,401);assert.equal((await f.app.inject({url:'/v1/owner/ui-preferences',headers:bearer(f.runtime)})).statusCode,403);
 assert.equal((await f.app.inject({url:'/v1/owner/ui-preferences?ownerId='+f.ownerB.id,headers:bearer(f.ownerA.session)})).statusCode,400);
 const input={operationId:randomUUID(),expectedVersion:1,uiLocale:'en'},saved=await f.app.inject({method:'POST',url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session),payload:input});
 assert.equal(saved.statusCode,200);assert.equal(saved.json().outcome,'committed');assert.equal(saved.json().version,2);assert.equal(saved.json().uiLocale,'en');assert.equal(saved.json().changed,true);
 const owner=f.rows('owners').find(row=>row.id===f.ownerA.id)!;assert.equal(owner.version,5);assert.equal(owner.data.authVersion,1);assert.equal(f.rows('credentials').find(row=>row.id===f.ownerA.session.split('.')[0])!.data.active,true);
 assert.equal((await f.app.inject({url:'/v1/owner/ui-preferences',headers:bearer(f.ownerB.session)})).json().uiLocale,null);
 for(const payload of [{...input,operationId:randomUUID(),uiLocale:'fr'},{...input,operationId:randomUUID(),uiLocale:null},{...input,operationId:randomUUID(),ownerId:f.ownerB.id}])assert.equal((await f.app.inject({method:'POST',url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session),payload})).statusCode,400);
 const stale=await f.app.inject({method:'POST',url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session),payload:{...input,operationId:randomUUID(),uiLocale:'zh-CN'}});assert.equal(stale.statusCode,409);assert.equal(stale.json().error.code,'version_conflict');
 const unchanged=await f.app.inject({method:'POST',url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session),payload:{...input,operationId:randomUUID(),expectedVersion:2}});assert.equal(unchanged.json().changed,false);assert.equal(unchanged.json().version,2);assert.equal(f.rows('owners').find(row=>row.id===f.ownerA.id)!.version,5);
 assert.equal(FOUNDATION_HTTP_OPERATIONS.some(row=>row.path.includes('ui-preferences')),false,'human preference APIs do not become Agent foundation capabilities');
});

test('unknown preference saves recover by the original Owner receipt and immutable operation body',async t=>{
 const f=await fixture(t),input={operationId:randomUUID(),expectedVersion:1,uiLocale:'zh-CN'};f.control.unknownAfterCommit=true;
 const lost=await f.app.inject({method:'POST',url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session),payload:input});assert.equal(lost.statusCode,503);assert.equal(lost.json().error.code,'commit_result_unknown');
 const path=`/v1/operations/${input.operationId}?scope=owner:${f.ownerA.id}&action=saveUiPreferences`,receipt=await f.app.inject({url:path,headers:bearer(f.ownerA.session)});assert.equal(receipt.statusCode,200);assert.equal(receipt.json().version,2);
 assert.equal((await f.app.inject({url:path,headers:bearer(f.ownerB.session)})).statusCode,404);
 const replay=await f.app.inject({method:'POST',url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session),payload:input});assert.deepEqual(replay.json(),receipt.json());assert.equal(f.rows('operations').length,1);assert.equal(f.rows('facts').length,1);
 const changed=await f.app.inject({method:'POST',url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session),payload:{...input,uiLocale:'en'}});assert.equal(changed.statusCode,409);assert.equal(changed.json().error.code,'idempotency_payload_mismatch');
});

test('localized challenges freeze approved complete mail bodies while original code, expiry and operation recovery remain unchanged',async t=>{
 const f=await fixture(t);
 for(const uiLocale of [undefined,'zh-CN','en'] as const){
  const attemptId=randomUUID(),browserToken=proof();await f.service.invoke('startRegistration',{operationId:randomUUID(),attemptId,browserToken,username:'Test_'+attemptId.slice(0,8),email:attemptId+'@example.test'});
  const input={operationId:randomUUID(),attemptId,...(uiLocale?{uiLocale}:{})},sent=await f.service.invoke('sendRegistrationCode',input,browserToken),job=f.rows('mail_jobs').find(row=>row.data.attemptId===attemptId)!,encrypted=job.data.encryptedPayload as string,payload=openMail(mailConfig.resend.codeSecret,encrypted),code=payload.text.match(/\b\d{8}\b/)?.[0];assert(code);
  assert.equal(sent.codeExpiresAt,f.now()+600000);assert.equal(sent.resendAfter,f.now()+60000);assert(payload.text.includes(mailConfig.resend.publicOrigin));assert.equal(job.data.state,'queued');
  if(uiLocale==='zh-CN'){assert.equal(payload.subject,'Trisavia · 注册验证码');assert(payload.text.includes('\n\n'));assert(payload.text.includes('10 分钟'));}else if(uiLocale==='en')assert.equal(payload.subject,'Trisavia · Registration verification code');else assert.equal(payload.subject,'connet.ai · registration code');
  assert.deepEqual(await f.service.invoke('sendRegistrationCode',input,browserToken),sent);assert.equal(f.rows('mail_jobs').find(row=>row.id===job.id)!.data.encryptedPayload,encrypted);
  await assert.rejects(()=>f.service.invoke('sendRegistrationCode',{...input,uiLocale:uiLocale==='en'?'zh-CN':'en'},browserToken),error=>error instanceof Error&&'code' in error&&error.code==='idempotency_payload_mismatch');
  const verified=await f.service.invoke('verifyRegistrationEmail',{operationId:randomUUID(),attemptId,sendOperationId:input.operationId,code},browserToken);assert.equal(verified.verification,'valid');
 }
 assert.equal(f.rows('mail_jobs').length,3); // service.invoke queues only; no provider/HTTP dispatch is called.
});

test('recovery notification locale changes no recovery authority or stored interface preference',async t=>{
 const f=await fixture(t);await f.service.invoke('saveUiPreferences',{operationId:randomUUID(),expectedVersion:1,uiLocale:'en'},f.ownerA.session);
 const sessionToken=proof(),recoveryToken=proof(),input={operationId:randomUUID(),password:'synthetic replacement password',sessionToken,recoveryToken,credentialsSaved:true,uiLocale:'zh-CN'};
 const recovered=await f.service.invoke('recover',input,f.ownerA.recovery),job=f.rows('mail_jobs').find(row=>row.data.purpose==='notification')!,payload=openMail(mailConfig.resend.codeSecret,job.data.encryptedPayload as string);
 assert.equal(payload.subject,'Trisavia · 账号恢复完成');assert(payload.text.includes(mailConfig.resend.publicOrigin));assert(!payload.text.includes(input.password));assert(!payload.text.includes(sessionToken));assert.equal(recovered.ownerAuthVersion,2);
 const owner=f.rows('owners').find(row=>row.id===f.ownerA.id)!;assert.equal(owner.data.authVersion,2);assert.equal(owner.data.uiLocale,'en');assert.equal(owner.data.uiPreferencesVersion,2);
 assert.equal((await f.app.inject({url:'/v1/owner/ui-preferences',headers:bearer(f.ownerA.session)})).statusCode,401);assert.equal((await f.app.inject({url:'/v1/owner/ui-preferences',headers:bearer(sessionToken)})).json().uiLocale,'en');
 const receipt=await f.service.invoke('receipt',{operationId:input.operationId,scope:'owner:'+f.ownerA.id,action:'recover'},sessionToken);assert.deepEqual(receipt,recovered);assert.equal(f.rows('mail_jobs').length,1);
});

test('the additive Owner codec preserves old rows and maps only the three new preference columns',async()=>{
 const row:StoredRow={id:'codec-owner',version:7,data:{status:'active',epoch:'codec-epoch',authVersion:3,email:'synthetic@example.test'}},model=resolveModel('owners',row),old=encode(model,row);
 const next:StoredRow={...row,version:8,data:{...row.data,uiLocale:'zh-CN',uiPreferencesVersion:2,uiPreferencesUpdatedAt:1793192400000}},encoded=encode(model,next),stored=Object.fromEntries(encoded.columns.map((column,index)=>[column,encoded.values[index]]));
 const decoded=await decode({query(){throw new Error('Owner codec must not need another domain query');}} as unknown as PoolClient,model,stored);assert.deepEqual(decoded,next);assert.equal(old.columns.includes('ui_locale'),true);assert.equal(old.values[old.columns.indexOf('ui_locale')],null);
 assert(!BASE_MODELS.find(model=>model.logical==='owners')!.fields.some(field=>field.path==='uiLocale'),'applied base DDL remains frozen');assert.equal(OWNER_UI_PREFERENCES_MIGRATION.version,8);assert.equal(OWNER_UI_PREFERENCES_MIGRATION.moduleId,'iam');assert(!OWNER_UI_PREFERENCES_MIGRATION.sql.includes('UPDATE '));
});
