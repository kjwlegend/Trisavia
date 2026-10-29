import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import Fastify from 'fastify';
import {createM1Service,type M1Options} from '../../apps/platform/application/m1-service.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {M1_TABLES,StorageError,type M1Store,type M1ReadSession,type M1Transaction,type M1Table,type StoredRow,type ExactFilters,type JsonObject} from '../../apps/platform/contracts/store.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import {bindPublicIdentifierRepository,type PublicIdentifier} from '../../apps/platform/domains/public-identifiers/repository.ts';
import {encode} from '../../apps/platform/infrastructure/postgresql/codec.ts';
import {resolveModel} from '../../apps/platform/infrastructure/postgresql/model.ts';

const proof=()=>`${randomUUID()}.${randomBytes(32).toString('base64url')}`,copy=<T>(value:T):T=>structuredClone(value);
/** Narrow isolated store: production codecs + real credential verification, no PG/listener/provider. */
async function fixture(t:TestContext,email?:M1Options['email']){
 let state=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(table=>[table,new Map()]));
 const stats={reads:0,transactions:0},control={unknownAfterCommit:false};let now=1793192400000;
 const matches=(row:StoredRow,filters:ExactFilters)=>Object.entries(filters).every(([key,value])=>row.data[key]===value);
 let publicIds=new Map<string,PublicIdentifier>();
 const reader=():M1ReadSession=>{const session:M1ReadSession={
  async get<T extends JsonObject>(table:M1Table,id:string){return copy(state.get(table)!.get(id)) as StoredRow<T>|undefined;},
  async find<T extends JsonObject>(table:M1Table,filters:ExactFilters={}){return copy([...state.get(table)!.values()].filter(row=>matches(row,filters))) as StoredRow<T>[];},
  async scan<T extends JsonObject>(table:M1Table,filters:ExactFilters,options:{limit:number;afterId?:string}){return (await this.find<T>(table,filters)).filter(row=>!options.afterId||row.id>options.afterId).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,options.limit);},
  async count(table,filters,limit){return Math.min(limit,(await this.find(table,filters)).length);},
  async quotaCount(query){
   if(query.kind==='email_attempts_recent')return Math.min(query.limit,[...state.get('email_attempts')!.values()].filter(row=>Number(row.data.createdAt)>=query.since&&(!query.sourceKeys||query.sourceKeys.includes(String(row.data.sourceKey)))).length);
   if(query.kind==='code_mail_recent')return Math.min(query.limit,[...state.get('mail_jobs')!.values()].filter(row=>row.data.purpose==='code'&&Number(row.data.createdAt)>=query.since&&(!query.related||row.data.ownerKey===query.related.ownerKey||row.data.ownerKey===query.related.emailKey)&&(!query.sourceKeys||query.sourceKeys.includes(String(row.data.sourceKey)))).length);
   return 0;
  },
 };bindPublicIdentifierRepository(session,{get:async(kind,id)=>publicIds.get(kind+':'+id),find:async(id)=>[...publicIds.values()].find(row=>row.publicId===id)});return session;};
 const store:M1Store={instanceId:'isolated-owner-ui-instance',recoveryEpoch:'isolated-owner-ui-epoch',async read(work){stats.reads++;return work(reader());},async transaction(work){
  stats.transactions++;const before=copy(state),beforeIds=copy(publicIds),session:M1Transaction={...reader(),async insert(table,row){encode(resolveModel(table,row),row);if(state.get(table)!.has(row.id))throw new StorageError('constraint','Duplicate synthetic row');state.get(table)!.set(row.id,copy(row));},async update(table,row,version){encode(resolveModel(table,row),row);if(state.get(table)!.get(row.id)?.version!==version)return false;assert.equal(row.version,version+1);state.get(table)!.set(row.id,copy(row));return true;},async remove(table,id,version){if(state.get(table)!.get(id)?.version!==version)return false;return state.get(table)!.delete(id);}};
  bindPublicIdentifierRepository(session,{get:async(kind,id)=>publicIds.get(kind+':'+id),find:async(id)=>[...publicIds.values()].find(row=>row.publicId===id),ensure:async(kind,id)=>{const key=kind+':'+id;let row=publicIds.get(key);if(!row){row={kind,subjectId:id,publicId:(kind==='agent'?'A':kind==='owner'?'H':'N')+String(publicIds.size+1).padStart(3,'0')};publicIds.set(key,row);}return row;}});
  let result;try{result=await work(session);}catch(error){state=before;publicIds=beforeIds;throw error;}
  if(control.unknownAfterCommit){control.unknownAfterCommit=false;throw new StorageError('unknown_commit','Synthetic response lost after commit');}return result;
 },async close(){}};
 function seed(table:M1Table,row:StoredRow){encode(resolveModel(table,row),row);state.get(table)!.set(row.id,copy(row));}
 function credential(kind:string,metadata:JsonObject){const token=proof(),parsed=parseToken(token,true);seed('credentials',{id:parsed.id,version:1,data:{kind,fingerprint:parsed.fingerprint,verifier:verifier(kind,parsed),epoch:store.recoveryEpoch,active:true,agentId:null,ownerId:null,expiresAt:null,...metadata}});return token;}
 const service=createM1Service(store,{now:()=>now,...(email?{email}:{})}),app=Fastify({logger:false});registerM1Routes(app,service);t.after(()=>app.close());
 return {store,service,app,stats,control,credential,seed,rows:(table:M1Table)=>copy([...state.get(table)!.values()]),tick:(ms:number)=>{now+=ms;},now:()=>now};
}
const bearer=(token:string)=>({authorization:'Bearer '+token});
const password='synthetic registration password 123';
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function begin(f:Fixture,target:JsonObject={},fields:Partial<{username:string;email:string}>={}){
 const browserToken=proof(),attemptId=randomUUID(),username=fields.username??'Owner_'+randomUUID().slice(0,8),email=fields.email??randomUUID()+'@example.test';
 const input={operationId:randomUUID(),attemptId,browserToken,username,email,...target};
 const started=await f.app.inject({method:'POST',url:'/v1/owner/registration-attempts',payload:input});assert.equal(started.statusCode,200,started.body);
 assert.equal(started.json().status,'pending_registration');assert.equal(started.json().verificationMode,'none');assert.equal(started.json().emailVerificationRequired,false);
 const finish={operationId:randomUUID(),attemptId,password,sessionToken:proof(),...(target.handoffToken?{handoffToken:target.handoffToken}:target.setupToken?{setupToken:target.setupToken}:{})};
 return{input,view:started.json(),browserToken,attemptId,finish,username,email};
}
async function unclaimed(f:Fixture){
 const input={operationId:randomUUID(),attemptId:randomUUID(),runtimeToken:proof(),continuationToken:proof()},agent=await f.service.invoke('register',input),handoffToken=proof();
 const handoff=await f.service.invoke('issueHandoff',{operationId:randomUUID(),expectedGeneration:0,handoffToken},input.continuationToken);
 return {input,agent,handoffToken,target:{agentId:agent.agentId!,expectedGeneration:handoff.generation!,handoffToken}};
}
async function finish(f:Fixture,p:Awaited<ReturnType<typeof begin>>,target=false,input=p.finish){return f.app.inject({method:'POST',url:target?'/v1/owner/setup/complete':'/v1/owner/accounts',headers:bearer(p.browserToken),payload:input});}

test('human-first registration needs no mail configuration/challenge; exact replay and normal username/email login keep one unverified account',async t=>{
 const f=await fixture(t),p=await begin(f),created=await finish(f,p);assert.equal(created.statusCode,200,created.body);
 assert.equal(created.json().emailVerified,false);assert.equal(created.json().verificationSource,'unverified');assert.equal(created.json().verificationMode,'none');
 assert.deepEqual((await finish(f,p)).json(),created.json());
 const receipt=await f.app.inject({url:`/v1/operations/${p.finish.operationId}?scope=owner-registration:${p.attemptId}&action=registerOwner`,headers:bearer(p.browserToken)});assert.equal(receipt.statusCode,200);assert.deepEqual(receipt.json(),created.json());
 assert.equal(f.rows('owners').length,1);assert.equal(f.rows('bindings').length,0);assert.equal(f.rows('mail_jobs').length,0);
 const owner=f.rows('owners')[0]!;assert.equal(owner.data.emailVerified,false);assert.equal(owner.data.emailVerifiedAt,null);assert.equal(owner.data.emailVerificationMode,'none');assert.equal(owner.data.emailVerificationSource,'unverified');
 for(const identifier of [p.username.toUpperCase(),p.email.toUpperCase()]){const login=await f.app.inject({method:'POST',url:'/v1/owner/sessions',payload:{operationId:randomUUID(),identifier,password,sessionToken:proof()}});assert.equal(login.statusCode,200,login.body);assert.equal(login.json().ownerId,p.attemptId);}
 const changed=await finish(f,p,false,{...p.finish,password:'different synthetic password'});assert.equal(changed.statusCode,409);assert.equal(changed.json().error.code,'idempotency_payload_mismatch');
 const privateAccount=await f.service.invoke('readAccount',{},p.finish.sessionToken);assert.equal(privateAccount.emailVerified,false);
});

test('private Agent signup atomically creates the account/session/binding and preserves runtime/identity; failed final write rolls everything back before same-key retry',async t=>{
 const f=await fixture(t),a=await unclaimed(f),p=await begin(f,a.target),before=f.rows('owners');
 const collision={...p.finish,sessionToken:p.browserToken},failed=await finish(f,p,true,collision);assert.equal(failed.statusCode,409);assert.equal(failed.json().error.code,'credential_conflict');assert.deepEqual(f.rows('owners'),before);assert.equal(f.rows('bindings').length,0);assert.equal(f.rows('email_attempts')[0]!.data.status,'pending_registration');
 const created=await finish(f,p,true);assert.equal(created.statusCode,200,created.body);assert.equal(created.json().agentId,a.agent.agentId);assert.equal(created.json().ownerId,a.agent.ownerId);assert.equal(created.json().managementStatus,'managed');assert.equal(created.json().emailVerified,false);
 assert.deepEqual((await finish(f,p,true)).json(),created.json());assert.equal(f.rows('bindings').length,1);assert.equal(f.rows('owners').length,1);assert.equal(f.rows('mail_jobs').length,0);assert.equal(f.rows('agents').length,1);
 assert.equal((await f.service.invoke('self',{},a.input.runtimeToken)).agentId,a.agent.agentId);
 assert.equal((await f.service.invoke('managedAgent',{agentId:a.agent.agentId},p.finish.sessionToken)).agentId,a.agent.agentId);
 assert.equal(f.rows('credentials').find(row=>row.id===a.handoffToken.split('.')[0])!.data.active,false);
});

test('uniqueness, target ownership/generation/expiry and unknown final-result recovery cannot bind an existing account or duplicate writes',async t=>{
 const f=await fixture(t),first=await begin(f);assert.equal((await finish(f,first)).statusCode,200);
 for(const field of ['username','email'] as const){const p=await begin(f,{}, {[field]:first[field]});const response=await finish(f,p);assert.equal(response.statusCode,409);assert.equal(response.json().error.code,field+'_unavailable');assert.equal(f.rows('owners').length,1);}
 const a=await unclaimed(f),wrong=await f.app.inject({method:'POST',url:'/v1/owner/registration-attempts',payload:{...first.input,operationId:randomUUID(),attemptId:randomUUID(),browserToken:proof(),...a.target,expectedGeneration:999}});assert.equal(wrong.statusCode,404);
 const p=await begin(f,a.target);f.tick(16*60000);const expired=await finish(f,p,true);assert.equal(expired.statusCode,410);assert.equal(f.rows('bindings').length,0);
 const next=await begin(f);f.control.unknownAfterCommit=true;const lost=await finish(f,next);assert.equal(lost.statusCode,503);assert.equal(lost.json().error.code,'commit_result_unknown');const rows=f.rows('operations').length;
 const recovered=await f.app.inject({url:`/v1/operations/${next.finish.operationId}?scope=owner-registration:${next.attemptId}&action=registerOwner`,headers:bearer(next.browserToken)});assert.equal(recovered.statusCode,200);assert.equal(recovered.json().ownerId,next.attemptId);assert.deepEqual((await finish(f,next)).json(),recovered.json());assert.equal(f.rows('operations').length,rows);assert.equal(f.rows('mail_jobs').length,0);
});

test('registration challenge writes are not a hidden requirement, while recovery retains its original challenge proof',async t=>{
 const f=await fixture(t,{mode:'experience'}),a=await unclaimed(f),p=await begin(f,a.target);
 const send=await f.app.inject({method:'POST',url:`/v1/owner/registration-attempts/${p.attemptId}/email-challenges`,headers:bearer(p.browserToken),payload:{operationId:randomUUID()}});assert.equal(send.statusCode,409);assert.equal(send.json().error.code,'registration_verification_not_required');assert.equal(f.rows('mail_jobs').length,0);
 assert.equal((await finish(f,p,true)).statusCode,200);
 const assistanceToken=proof(),request=await f.service.invoke('createRecoveryRequest',{operationId:randomUUID(),assistanceToken},a.input.runtimeToken),browserToken=proof(),attemptId=browserToken.split('.')[0]!;
 await f.service.invoke('startEmailRecovery',{operationId:randomUUID(),browserToken},assistanceToken);
 await assert.rejects(f.service.invoke('recoverByEmail',{operationId:randomUUID(),attemptId,password,sessionToken:proof()},browserToken),{code:'email_verification_required'});
 const sent=await f.service.invoke('sendRecoveryCode',{operationId:randomUUID(),attemptId},browserToken);assert.equal(sent.deliveryStatus,'not_sent');assert.equal(f.rows('mail_jobs').length,1);assert.ok(request.requestId);
});

test('legacy unfinished registration can finish only in its original lifetime; historical completed receipt and verified facts stay byte-identical',async t=>{
 const f=await fixture(t),p=await begin(f),row=f.rows('email_attempts')[0]!;
 f.seed('email_attempts',{...row,data:{...row.data,verificationMode:'resend',status:'email_proved',grantExpiresAt:f.now()-1}});
 const verifiedNewWrite=await f.app.inject({method:'POST',url:`/v1/owner/registration-attempts/${p.attemptId}/email-verifications`,headers:bearer(p.browserToken),payload:{operationId:randomUUID(),sendOperationId:randomUUID(),code:'1234'}});assert.equal(verifiedNewWrite.statusCode,409);assert.equal(verifiedNewWrite.json().error.code,'registration_verification_not_required');
 const created=await finish(f,p);assert.equal(created.statusCode,200);assert.equal(created.json().emailVerified,false);
 const owner=f.rows('owners')[0]!,operation=f.rows('operations').find(row=>row.data.action==='registerOwner')!,oldResult={...(operation.data.result as JsonObject),emailVerified:true,verificationMode:'resend',verificationSource:'registration_code'};
 f.seed('owners',{...owner,data:{...owner.data,emailVerified:true,emailVerifiedAt:f.now()-1000,emailVerificationSource:'registration_code',emailVerificationMode:'resend'}});
 f.seed('operations',{...operation,data:{...operation.data,result:oldResult}});const historical=f.rows('owners');
 assert.deepEqual((await finish(f,p)).json(),oldResult);assert.deepEqual(f.rows('owners'),historical);assert.equal(f.rows('mail_jobs').length,0);
 const cancelled=await begin(f);await f.service.invoke('cancelRegistration',{attemptId:cancelled.attemptId,operationId:randomUUID()},cancelled.browserToken);assert.equal((await finish(f,cancelled)).statusCode,409);
 const expired=await begin(f);f.tick(31*60000);assert.equal((await finish(f,expired)).statusCode,410);
});
