import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {avatarFixture} from './fixture.ts';
const base=new URL('../../apps/web/public/avatar-authoring/v1/',import.meta.url);
async function pack(){return {manifest:JSON.parse(await readFile(new URL('sample.manifest.json',base),'utf8')),files:await Promise.all(['idle.png','walk.png'].map(async name=>({name,dataBase64:(await readFile(new URL(name,base))).toString('base64')})))};}
const source=(t:any)=>({taskId:t.taskId,expectedTaskVersion:t.version}),application=(f:ReturnType<typeof avatarFixture>,t:any,a:any)=>({ ...source(t),assetId:a.assetId,expectedVersion:1,expectedProfileVersion:f.state.profiles.get(f.agentId)!.version,expectedPolicyVersion:f.state.profiles.get(f.agentId)!.data.policyVersion});
function policy(f:ReturnType<typeof avatarFixture>,mode:string,locked:string[]=[]){const p=f.state.profiles.get(f.agentId)!;p.data.mode=mode;p.data.lockedFields=locked;}

test('Agent direct avatar authority runs the complete API path, independently of world observe mode',async()=>{
 const f=avatarFixture(),participation=f.f.state.participants.get(f.agentId)!;f.f.state.participants.set(f.agentId,{...participation,actionPolicy:{...participation.actionPolicy,mode:'observe'}});
 const task=(await f.execute(f.agent,'avatar_assets.tasks.create',{})).result.task as any;assert.equal(task.preparedBy,'agent');assert.equal(f.state.tasks.get(task.taskId)!.creatorId,f.agentId);
 const image=await readFile(new URL('idle.png',base));assert.equal((await f.execute(f.agent,'avatar_assets.drafts.create',{...source(task),kind:'reference',files:[{name:'reference.png',dataBase64:image.toString('base64')}]})).outcome,'committed');
 const payload={...source(task),kind:'avatar',...await pack()},a=(await f.execute(f.agent,'avatar_assets.drafts.create',payload)).result.draft as any;
 const applied=await f.execute(f.agent,'avatar_assets.apply',application(f,task,a));assert.equal(applied.outcome,'committed');assert.equal(f.state.profiles.get(f.agentId)!.data.confirmationSource,'runtime_declaration');
 const a2=(await f.execute(f.agent,'avatar_assets.drafts.create',payload)).result.draft as any;assert.equal((await f.execute(f.agent,'avatar_assets.apply',application(f,task,a2))).outcome,'committed');await assert.rejects(f.service.publicFile(f.ctx,a.assetId,(applied.result.appearance as any).digest,'manifest.json'));
 const p=f.state.profiles.get(f.agentId)!;assert.equal((await f.execute(f.agent,'avatar_assets.restore_builtin',{expectedProfileVersion:p.version,expectedPolicyVersion:p.data.policyVersion,avatar:{template:'basic',color:'blue'}})).outcome,'committed');assert.equal((await f.execute(f.agent,'avatar_assets.tasks.revoke',{taskId:task.taskId,expectedVersion:1})).outcome,'committed');
});

test('Owner-limited preparation never grants direct publication under Owner/proposal/locked avatar policies',async()=>{
 for(const [mode,locked,code]of [['owner_specified',[],'confirmation_required'],['proposal_required',[],'confirmation_required'],['agent_autonomous',['avatar'],'field_locked']] as const){
  const f=avatarFixture();policy(f,mode,[...locked]);assert.equal((await f.execute(f.agent,'avatar_assets.tasks.create',{})).result.code,code);
  const task=(await f.execute(f.owner,'avatar_assets.tasks.create',{})).result.task as any;assert.equal(task.preparedBy,'owner');const a=(await f.execute(f.agent,'avatar_assets.drafts.create',{...source(task),kind:'avatar',...await pack()})).result.draft as any;assert.equal(a.validation.valid,true);
  assert.equal((await f.execute(f.agent,'avatar_assets.apply',application(f,task,a))).result.code,code);const p=f.state.profiles.get(f.agentId)!;assert.equal((await f.execute(f.agent,'avatar_assets.restore_builtin',{expectedProfileVersion:p.version,expectedPolicyVersion:p.data.policyVersion,avatar:{template:'basic',color:'blue'}})).result.code,code);assert.equal((await f.execute(f.agent,'avatar_assets.tasks.revoke',{taskId:task.taskId,expectedVersion:1})).result.code,code);
  assert.equal((await f.execute(f.owner,'avatar_assets.apply',application(f,task,a))).outcome,'committed');
 }
});

test('direct Agent authority revokes only tasks created by that Agent; Owner can revoke both task sources',async()=>{
 const f=avatarFixture(),ownerTask=(await f.execute(f.owner,'avatar_assets.tasks.create',{})).result.task as any,selfTask=(await f.execute(f.agent,'avatar_assets.tasks.create',{})).result.task as any;
 const visible=await f.service.query(f.ctx,f.agent,f.agentId,f.origin,'avatar_assets.tasks',{}),tasks=visible.tasks as any[];
 assert.ok(!tasks.find(t=>t.taskId===ownerTask.taskId).allowedActions.includes('avatar_assets.tasks.revoke'));
 assert.ok(tasks.find(t=>t.taskId===selfTask.taskId).allowedActions.includes('avatar_assets.tasks.revoke'));
 const denied=await f.execute(f.agent,'avatar_assets.tasks.revoke',{taskId:ownerTask.taskId,expectedVersion:1});assert.equal(denied.outcome,'rejected');assert.equal(denied.result.code,'avatar_task_creator_required');assert.equal(f.state.tasks.get(ownerTask.taskId)!.state,'active');assert.equal(f.state.tasks.get(ownerTask.taskId)!.version,1);
 assert.equal((await f.execute(f.agent,'avatar_assets.tasks.revoke',{taskId:selfTask.taskId,expectedVersion:1})).outcome,'committed');
 const secondSelf=(await f.execute(f.agent,'avatar_assets.tasks.create',{})).result.task as any;
 for(const t of [ownerTask,secondSelf])assert.equal((await f.execute(f.owner,'avatar_assets.tasks.revoke',{taskId:t.taskId,expectedVersion:1})).outcome,'committed');
});

test('withdrawn direct authority hides self-task materials on every private read while preserving Owner-limited preparation',async()=>{
 const f=avatarFixture(),selfTask=(await f.execute(f.agent,'avatar_assets.tasks.create',{})).result.task as any,ownerTask=(await f.execute(f.owner,'avatar_assets.tasks.create',{})).result.task as any,png=await pack();
 const upload=async(t:any)=>(await f.execute(f.agent,'avatar_assets.drafts.create',{...source(t),kind:'avatar',...png})).result.draft as any,selfDraft=await upload(selfTask),ownerDraft=await upload(ownerTask),saved=structuredClone(f.state.tasks.get(selfTask.taskId));
 policy(f,'owner_specified');
 const tasks=(await f.service.query(f.ctx,f.agent,f.agentId,f.origin,'avatar_assets.tasks',{})).tasks as any[],drafts=(await f.service.query(f.ctx,f.agent,f.agentId,f.origin,'avatar_assets.drafts',{})).drafts as any[];
 assert.deepEqual(tasks.map(t=>t.taskId),[ownerTask.taskId]);assert.deepEqual(drafts.map(d=>d.assetId),[ownerDraft.assetId]);
 for(const [operation,input] of [['avatar_assets.task',{taskId:selfTask.taskId}],['avatar_assets.draft',{assetId:selfDraft.assetId}],['avatar_assets.drafts',{taskId:selfTask.taskId}]] as const)await assert.rejects(f.service.query(f.ctx,f.agent,f.agentId,f.origin,operation,input),{code:'confirmation_required'});
 await assert.rejects(f.service.privateFile(f.ctx,f.agent,f.agentId,f.origin,selfDraft.assetId,'idle.png'),{code:'confirmation_required'});
 assert.equal((await f.execute(f.agent,'avatar_assets.drafts.create',{...source(selfTask),kind:'avatar',...png})).result.code,'confirmation_required');assert.equal((await f.execute(f.agent,'avatar_assets.tasks.revoke',{taskId:selfTask.taskId,expectedVersion:1})).result.code,'confirmation_required');
 assert.deepEqual(f.state.tasks.get(selfTask.taskId),saved);
 assert.equal((await f.service.query(f.ctx,f.owner,f.agentId,f.origin,'avatar_assets.draft',{assetId:selfDraft.assetId})).draft!==null,true);
 const current=(await f.service.query(f.ctx,f.agent,f.agentId,f.origin,'avatar_assets.task',{taskId:ownerTask.taskId})).task as any;assert.deepEqual(current.allowedActions,['avatar_assets.drafts.create']);
 assert.ok((await f.service.privateFile(f.ctx,f.agent,f.agentId,f.origin,ownerDraft.assetId,'idle.png')).bytes.length);assert.equal((await upload(ownerTask)).validation.valid,true);assert.equal((await f.execute(f.agent,'avatar_assets.apply',application(f,ownerTask,ownerDraft))).result.code,'confirmation_required');
});

test('self-prepared authority is rechecked after policy, pause or target changes; shared Owner does not share asset rights',async()=>{
 const f=avatarFixture(),task=(await f.execute(f.agent,'avatar_assets.tasks.create',{})).result.task as any,payload={...source(task),kind:'avatar',...await pack()},a=(await f.execute(f.agent,'avatar_assets.drafts.create',payload)).result.draft as any;
 policy(f,'owner_specified');assert.equal((await f.execute(f.agent,'avatar_assets.drafts.create',payload)).result.code,'confirmation_required');await assert.rejects(f.service.privateFile(f.ctx,f.agent,f.agentId,f.origin,a.assetId,'idle.png'));
 policy(f,'agent_autonomous');f.f.membership(f.agentId,{ownerPaused:true});assert.equal((await f.execute(f.agent,'avatar_assets.apply',application(f,task,a))).result.code,'participation_paused');f.f.membership(f.agentId,{ownerPaused:false});
 const other=f.addTarget('avatar-sibling-agent');await assert.rejects(f.service.privateFile(f.ctx,other,f.agentId,f.origin,a.assetId,'idle.png'));const siblingTask=await f.store.transaction(ctx=>f.service.execute(ctx,other,other.kind==='agent'?other.agentId:'',f.origin,'avatar_assets.tasks.create',{operationId:'sibling-create-task'}));assert.equal(siblingTask.outcome,'committed');
 const siblingId=other.kind==='agent'?other.agentId:'',t=siblingTask.result.task as any,attempt=await f.store.transaction(ctx=>f.service.execute(ctx,other,siblingId,f.origin,'avatar_assets.apply',{operationId:'sibling-apply-known-id',...source(t),assetId:a.assetId,expectedVersion:1,expectedProfileVersion:1,expectedPolicyVersion:1}));assert.equal(attempt.outcome,'rejected');assert.equal(attempt.result.code,'target_not_accessible');const ownerAttempt=await f.store.transaction(ctx=>f.service.execute(ctx,f.owner,siblingId,f.origin,'avatar_assets.apply',{operationId:'owner-sibling-known-id',...source(t),assetId:a.assetId,expectedVersion:1,expectedProfileVersion:1,expectedPolicyVersion:1}));assert.equal(ownerAttempt.result.code,'target_not_accessible');await assert.rejects(f.service.privateFile(f.ctx,{...f.owner,kind:'owner',ownerId:'unrelated-owner'},f.agentId,f.origin,a.assetId,'idle.png'));
 const applied=await f.execute(f.agent,'avatar_assets.apply',application(f,task,a)),ref=applied.result.appearance as any;assert.equal(applied.outcome,'committed');const saved=structuredClone(f.state.profiles.get(f.agentId));f.binding={...f.binding,bindingVersion:2};await assert.rejects(f.service.publicFile(f.ctx,a.assetId,ref.digest,'manifest.json'));assert.deepEqual(f.state.profiles.get(f.agentId),saved);
});

test('revoked or expired tasks expose only an original minimal receipt, including POST retries without material resurrection',async()=>{
 for(const expired of [false,true]){
  const f=avatarFixture(),t=(await f.execute(f.agent,'avatar_assets.tasks.create',{},'minimal-create-task')).result.task as any,payload={...source(t),kind:'avatar',...await pack()},uploaded=await f.execute(f.agent,'avatar_assets.drafts.create',payload,'minimal-upload-original');
  if(expired)f.f.now+=8*86400000;else await f.execute(f.agent,'avatar_assets.tasks.revoke',{taskId:t.taskId,expectedVersion:1});policy(f,'owner_specified');
  const r=await f.service.receipt(f.ctx,f.agent,f.agentId,f.origin,'minimal-upload-original','avatar_assets.drafts.create');assert.equal(r.outcome,uploaded.outcome);assert.deepEqual(r.result,{agentId:f.agentId,taskId:t.taskId,assetId:(uploaded.result.draft as any).assetId,taskState:expired?'expired':'revoked',materialsAccessible:false});assert.deepEqual(await f.execute(f.agent,'avatar_assets.drafts.create',payload,'minimal-upload-original'),r);await assert.rejects(f.service.privateFile(f.ctx,f.agent,f.agentId,f.origin,(uploaded.result.draft as any).assetId,'idle.png'));assert.equal(f.state.assets.size,1);
 }
});

test('HTTP Agent credentials can prepare and apply without an Owner UI round trip, then restore',async()=>{
 const {default:Fastify}=await import('fastify'),{registerAvatarAssetRoutes}=await import('../../apps/platform/transport/http/avatar-assets-routes.ts'),f=avatarFixture(),app=Fastify({ajv:{customOptions:{coerceTypes:false,removeAdditional:false,useDefaults:false}}});registerAvatarAssetRoutes(app,f.store,f.identity,f.service);
 try{const prefix=`/v1/agents/${f.agentId}/avatar-assets`,headers={authorization:'Bearer synthetic-agent'},post=async(path:string,body:any)=>{const r=await app.inject({method:'POST',url:prefix+path,headers,payload:body});assert.equal(r.statusCode,200,r.body);return r.json().data;};
  const task=(await post('/tasks',{operationId:'http-autonomous-prepare'})).result.task;assert.equal(task.preparedBy,'agent');
  const draft=(await post('/drafts',{operationId:'http-autonomous-upload',...source(task),kind:'avatar',...await pack()})).result.draft;
  const applied=await post('/apply',{operationId:'http-autonomous-apply',...application(f,task,draft)});assert.equal(applied.outcome,'committed');const ref=applied.result.appearance,r=await app.inject(ref.manifestUrl);assert.equal(r.statusCode,200);assert.equal(r.headers['cache-control'],'no-store');
  const p=f.state.profiles.get(f.agentId)!;assert.equal((await post('/restore-builtin',{operationId:'http-autonomous-restore',expectedProfileVersion:p.version,expectedPolicyVersion:p.data.policyVersion,avatar:{template:'basic',color:'blue'}})).outcome,'committed');assert.equal((await app.inject(ref.manifestUrl)).statusCode,404);
 }finally{await app.close();}
});
