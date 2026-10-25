import {randomUUID} from 'node:crypto';
import type {RuntimeReadContext,RuntimeTransaction,CommandReceipt,CommandKey} from '../contracts/runtime-store.ts';
import {RuntimeError} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {M1Error,fail,object,text,version} from '../domains/common/errors.ts';
import {commitRuntimeCommandIn,hashRuntimeRequest} from '../domains/runtime/command.ts';
import {createWorldCursor} from '../domains/world/cursor.ts';
import {validateAvatarInput} from '../domains/profile/appearance.ts';
import {assertProfileBusinessWrite,assertProfileDirectSave,assertProfilePublicationFields} from '../domains/profile/publication-policy.ts';
import {AVATAR_ASSET_REPOSITORY,type AvatarFiles} from '../domains/avatar-assets/repository.ts';
import {AVATAR_ASSET_LIMITS as LIMITS,AVATAR_ASSET_ACTIONS,publicAvatarFilePath,type AvatarTask,type AvatarAsset,type AvatarAssetAction,type CustomAvatar} from '../domains/avatar-assets/types.ts';
import {decodeAvatarPng,validateAvatarPackage} from '../domains/avatar-assets/validation.ts';
import {decodeAvatarReference} from '../domains/avatar-assets/reference.ts';
function absent():never{return fail('target_not_accessible',404,'该素材当前不可访问。');}
const json=(v:unknown)=>JSON.parse(JSON.stringify(v??null)) as JsonObject;
export function canonicalAvatarDocument(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 return Array.isArray(value)?'['+value.map(canonicalAvatarDocument).join(',')+']':'{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonicalAvatarDocument(v)).join(',')+'}';
}
export function createAvatarAssetService(identity:IdentityAccess<RuntimeReadContext>,files:AvatarFiles){
 const cursors=createWorldCursor();
 const ref=(a:AvatarAsset):CustomAvatar=>({kind:'custom',assetId:a.id,version:1,digest:a.digest,manifestUrl:publicAvatarFilePath(a.id,a.digest,'manifest.json')});
 async function context(ctx:RuntimeReadContext,p:Principal,id:string,origin:string){
  await identity.authorizeAgent(ctx,p,id);
  const binding=await identity.readCurrentManagementBinding?.(ctx,id);
  if(!binding)fail('avatar_owner_binding_required',409,'请先完成当前Agent与主人关联，再使用本用户的形象素材。');
  if(p.kind==='owner'&&p.ownerId!==binding.ownerId)absent();
  const profile=await ctx.repository(AVATAR_ASSET_REPOSITORY).getProfile(id);if(!profile)absent();
  return {binding,profile,origin};
 }
 function sameTaskScope(ctx:RuntimeReadContext,t:AvatarTask,id:string,origin:string,binding:{ownerId:string;bindingId:string;bindingVersion:number}){
  return t.agentId===id&&t.ownerId===binding.ownerId&&t.bindingId===binding.bindingId&&t.bindingVersion===binding.bindingVersion&&t.recoveryEpoch===ctx.recoveryEpoch&&t.origin===origin;
 }
 async function business(ctx:RuntimeReadContext,p:Principal,id:string){
  const participation=await identity.readParticipation(ctx,id);
  if(p.kind==='agent'&&!participation.runtimeActive)fail('authentication_failed',401,'当前运行身份已失效。');
  assertProfileBusinessWrite(participation.membership,p.kind);
  if(p.kind==='agent'&&participation.membership.state!=='joined')fail('role_not_public',409,'请先恢复当前参与状态。');
  return participation;
 }
 async function direct(ctx:RuntimeReadContext,p:Principal,id:string,profile:JsonObject){
  const participation=await business(ctx,p,id);
  assertProfileDirectSave(profile,participation.membership,p.kind);
  assertProfilePublicationFields(profile,p.kind,['avatar']);
 }
 async function task(ctx:RuntimeReadContext,p:Principal,id:string,taskId:unknown,origin:string,inactiveOwner=false){
  const current=await context(ctx,p,id,origin),t=await ctx.repository(AVATAR_ASSET_REPOSITORY).getTask(text(taskId,'taskId',8,100));
  if(!t||!sameTaskScope(ctx,t,id,origin,current.binding))absent();
  const inactive=t.state!=='active'||t.expiresAt<=ctx.now();
  if(inactive&&!(inactiveOwner&&p.kind==='owner'))fail('avatar_task_inactive',410,'准备任务已撤回或到期。',{fix:'按当前形象权限重新准备，或请主人提供有限制作任务。'});
  if(p.kind==='agent'){
   await business(ctx,p,id);
   // Self-prepared tasks never become an enduring Owner grant after policy changes.
   if(t.creatorKind==='agent')await direct(ctx,p,id,current.profile.data);
   else if(t.creatorKind!=='owner')absent();
  }
  return {...current,task:t};
 }
 async function taskView(ctx:RuntimeReadContext,p:Principal,t:AvatarTask){
  const active=t.state==='active'&&t.expiresAt>ctx.now(),assets=active?await ctx.repository(AVATAR_ASSET_REPOSITORY).listAssets({agentId:t.agentId,ownerId:t.ownerId,bindingId:t.bindingId,bindingVersion:t.bindingVersion,taskId:t.id,asOf:ctx.now(),limit:LIMITS.assetsPerTask}):[];
  let canManage=p.kind==='owner',canUpload=false;
  if(active){try{await business(ctx,p,t.agentId);if(p.kind==='agent'&&t.creatorKind==='agent'){const profile=await ctx.repository(AVATAR_ASSET_REPOSITORY).getProfile(t.agentId);if(!profile)absent();await direct(ctx,p,t.agentId,profile.data);}canUpload=true;}catch(e){if(!(e instanceof M1Error)||e.statusCode>=500)throw e;}}
  if(!canManage&&active){try{const profile=await ctx.repository(AVATAR_ASSET_REPOSITORY).getProfile(t.agentId);if(profile){await direct(ctx,p,t.agentId,profile.data);canManage=true;}}catch(e){if(!(e instanceof M1Error)||e.statusCode>=500)throw e;}}
  return {taskId:t.id,agentId:t.agentId,version:t.version,state:t.state==='revoked'?'revoked':active?'active':'expired',preparedBy:t.creatorKind,origin:t.origin,createdAt:t.createdAt,expiresAt:t.expiresAt,instruction:t.instruction,materialAssetIds:assets.map(a=>a.id),allowedActions:active?[...(canManage?['avatar_assets.tasks.revoke']:[]),...(canUpload?['avatar_assets.drafts.create']:[])]:[]};
 }
 async function draftView(ctx:RuntimeReadContext,a:AvatarAsset){
  const profile=await ctx.repository(AVATAR_ASSET_REPOSITORY).getProfile(a.agentId),active=(profile?.data.published as JsonObject|null)?.avatar as JsonObject|undefined;
  return {assetId:a.id,agentId:a.agentId,taskId:a.taskId,version:a.version,kind:a.kind,status:active?.kind==='custom'&&active.assetId===a.id?'published':'draft',createdAt:a.createdAt,validation:a.validation,manifest:a.manifest,files:a.files.map(f=>({name:f.name,digest:f.sha256,bytes:f.bytes,width:f.width,height:f.height,contentType:f.contentType,path:`/v1/agents/${a.agentId}/avatar-assets/drafts/${a.id}/files/${f.name}`}))};
 }
 async function draft(ctx:RuntimeReadContext,p:Principal,id:string,assetId:unknown,origin:string){
  const a=await ctx.repository(AVATAR_ASSET_REPOSITORY).getAsset(text(assetId,'assetId',8,100));if(!a||a.agentId!==id)absent();
  await task(ctx,p,id,a.taskId,origin);return a;
 }
 async function receipt(ctx:RuntimeReadContext,p:Principal,id:string,origin:string,operationId:string,action:string){
  const current=await context(ctx,p,id,origin);if(!AVATAR_ASSET_ACTIONS.includes(action as AvatarAssetAction))fail('invalid_request',400,'操作类型无效。');
  const r=await ctx.commands.get({domain:'avatar_assets',action,commandId:operationId,principal:{kind:p.kind,id:p.kind==='owner'?p.ownerId:p.agentId},recoveryEpoch:ctx.recoveryEpoch});
  if(!r||r.result.agentId!==id)absent();const result=r.result as Record<string,any>;
  const asset=result.draft?.assetId?await ctx.repository(AVATAR_ASSET_REPOSITORY).getAsset(result.draft.assetId):typeof result.assetId==='string'?await ctx.repository(AVATAR_ASSET_REPOSITORY).getAsset(result.assetId):undefined;
  const taskId=result.task?.taskId??result.draft?.taskId??asset?.taskId;
  if(typeof taskId==='string'){
   const source=await ctx.repository(AVATAR_ASSET_REPOSITORY).getTask(taskId);
   if(!source||!sameTaskScope(ctx,source,id,origin,current.binding))absent();
   if(source.state!=='active'||source.expiresAt<=ctx.now())return {...r,result:{agentId:id,taskId,assetId:asset?.id??null,taskState:source.state==='revoked'?'revoked':'expired',materialsAccessible:false}};
   await task(ctx,p,id,taskId,origin);
  }
  return r;
 }
 async function execute(ctx:RuntimeTransaction,p:Principal,id:string,origin:string,action:AvatarAssetAction,raw:unknown):Promise<CommandReceipt>{
  if(!AVATAR_ASSET_ACTIONS.includes(action))fail('invalid_request',400,'操作类型无效。');
  const input=object(raw,action==='avatar_assets.tasks.create'?['operationId','instruction']:action==='avatar_assets.tasks.revoke'?['operationId','taskId','expectedVersion']:action==='avatar_assets.drafts.create'?['operationId','taskId','expectedTaskVersion','kind','manifest','files']:action==='avatar_assets.apply'?['operationId','taskId','expectedTaskVersion','assetId','expectedVersion','expectedProfileVersion','expectedPolicyVersion']:['operationId','expectedProfileVersion','expectedPolicyVersion','avatar']),operationId=text(input.operationId,'operationId',8,100);
  const key:CommandKey={domain:'avatar_assets',action,commandId:operationId,principal:{kind:p.kind,id:p.kind==='owner'?p.ownerId:p.agentId},recoveryEpoch:ctx.recoveryEpoch},requestHash=hashRuntimeRequest(json({agentId:id,origin,input}));
  await context(ctx,p,id,origin);
  const prior=await ctx.commands.get(key);
  if(prior){if(prior.requestHash!==requestHash)throw new RuntimeError('command_conflict','Command identity already has a different request');return receipt(ctx,p,id,origin,operationId,action);}
  return commitRuntimeCommandIn(ctx,{key,requestHash,authorize:async current=>{await context(current,p,id,origin);},classifyRejection:e=>e instanceof M1Error&&e.statusCode<500?{outcome:e.statusCode===409?'conflict':'rejected',result:json({agentId:id,code:e.code,message:e.message,details:e.details??null})}:undefined,handle:async current=>{
   const repo=current.repository(AVATAR_ASSET_REPOSITORY);await repo.lockAgent(id);const source=await context(current,p,id,origin);
   // Each named action selects its actual publication/preparation authority.
   if(action!=='avatar_assets.drafts.create'&&(p.kind==='agent'||action!=='avatar_assets.tasks.revoke'))await direct(current,p,id,source.profile.data);
   else if(action==='avatar_assets.drafts.create')await business(current,p,id);
   current.validateBeforeCommit(async fresh=>{const c=await context(fresh,p,id,origin);if(action!=='avatar_assets.drafts.create'&&(p.kind==='agent'||action!=='avatar_assets.tasks.revoke'))await direct(fresh,p,id,c.profile.data);else if(action==='avatar_assets.drafts.create')await business(fresh,p,id);});
   if(action==='avatar_assets.tasks.create'){
    if((await repo.usage(id)).tasks>=LIMITS.tasksPerAgent)fail('avatar_storage_limit',409,'该Agent的准备记录已达上限。');
    const t:AvatarTask={id:randomUUID(),version:1,agentId:id,...source.binding,creatorKind:p.kind,creatorId:p.kind==='owner'?p.ownerId:p.agentId,creationPolicyVersion:Number(source.profile.data.policyVersion),origin,recoveryEpoch:ctx.recoveryEpoch,state:'active',instruction:input.instruction===undefined?'':text(input.instruction,'instruction',0,1000),createdAt:ctx.now(),expiresAt:ctx.now()+LIMITS.taskLifetimeMs,revokedAt:null};
    await repo.saveTask(t,null);return {result:json({agentId:id,task:await taskView(current,p,t)}),eventIds:[]};
   }
   if(action==='avatar_assets.tasks.revoke'){
    const {task:t}=await task(current,p,id,input.taskId,origin,true);if(version(input.expectedVersion)!==t.version)fail('version_conflict',409,'准备任务已变化，请重读。');
    const next=t.state==='revoked'?t:{...t,state:'revoked' as const,version:t.version+1,revokedAt:current.now()};if(next!==t)await repo.saveTask(next,t.version);
    return {result:json({agentId:id,task:await taskView(current,p,next)}),eventIds:[]};
   }
   if(action==='avatar_assets.drafts.create'){
    const {task:t}=await task(current,p,id,input.taskId,origin);if(version(input.expectedTaskVersion)!==t.version)fail('version_conflict',409,'准备任务版本已变化。');
    if(!['reference','avatar'].includes(String(input.kind))||!Array.isArray(input.files)||input.files.length<1||input.files.length>LIMITS.files)fail('avatar_files_invalid',422,'使用参考图或完整的PNG动画包。');
    const kind=input.kind as 'reference'|'avatar',decoded=input.files.map(f=>{const v=object(f,['name','dataBase64']);return kind==='reference'?decodeAvatarReference(v.name,v.dataBase64):decodeAvatarPng(v.name,v.dataBase64);}),validated=validateAvatarPackage(kind,input.manifest,decoded),usage=await repo.usage(id),scoped=await repo.listAssets({agentId:id,ownerId:t.ownerId,bindingId:t.bindingId,bindingVersion:t.bindingVersion,taskId:t.id,asOf:ctx.now(),limit:LIMITS.assetsPerTask});
    if(usage.assets>=LIMITS.assetsPerAgent||scoped.length>=LIMITS.assetsPerTask||usage.bytes+decoded.reduce((n,f)=>n+f.bytes.length,0)>LIMITS.bytesPerAgent)fail('avatar_storage_limit',409,'该Agent的私有素材空间已达上限。');
    const assetId=randomUUID(),metadata=decoded.map(f=>f.file),document=kind==='avatar'&&validated.validation.valid?json({version:1,manifest:validated.manifest,files:metadata.map(f=>({...f,url:publicAvatarFilePath(assetId,f.sha256,f.name)}))}):null,a:AvatarAsset={id:assetId,version:1,taskId:t.id,agentId:id,creatorKind:p.kind,creatorId:p.kind==='owner'?p.ownerId:p.agentId,kind,createdAt:ctx.now(),...validated,files:metadata,digest:hashRuntimeRequest(document??json({kind,manifest:validated.manifest,files:metadata})),publicDocument:document};
    for(const f of decoded)await files.put(f.file.sha256,f.bytes);await repo.insertAsset(a);current.validateBeforeCommit(async fresh=>{await task(fresh,p,id,t.id,origin);});
    return {result:json({agentId:id,draft:await draftView(current,a)}),eventIds:[]};
   }
   const profile=source.profile;
   if(version(input.expectedProfileVersion)!==profile.version||version(input.expectedPolicyVersion)!==profile.data.policyVersion)fail('version_conflict',409,'形象或资料权限已变化，请重读后确认。');
   if(!profile.data.published||typeof profile.data.published!=='object'||Array.isArray(profile.data.published))fail('role_not_public',409,'请先恢复公开资料，再应用形象。');
   const published=profile.data.published as JsonObject;let avatar:JsonObject,assetId:string|null=null;
   if(action==='avatar_assets.apply'){
    const a=await draft(current,p,id,input.assetId,origin),t=(await task(current,p,id,input.taskId,origin)).task;
    if(a.taskId!==t.id||version(input.expectedTaskVersion)!==t.version||version(input.expectedVersion)!==a.version)fail('version_conflict',409,'当前预览或准备任务已变化。');
    if(a.kind!=='avatar'||!a.validation.valid||!a.publicDocument)fail('avatar_validation_required',422,'尚未获得可应用的完整动画包。',{errors:a.validation.errors});
    for(const f of a.files)await files.read(f.sha256);await repo.publish({assetId:a.id,agentId:id,publishedAt:ctx.now(),ownerId:source.binding.ownerId,bindingId:source.binding.bindingId,bindingVersion:source.binding.bindingVersion});
    avatar=ref(a);assetId=a.id;current.validateBeforeCommit(async fresh=>{await task(fresh,p,id,t.id,origin);});
   }else avatar=validateAvatarInput(input.avatar);
   const changed=hashRuntimeRequest(json(published.avatar))!==hashRuntimeRequest(avatar);
   if(changed){
    const draftFields=profile.data.draft&&typeof profile.data.draft==='object'&&!Array.isArray(profile.data.draft)?profile.data.draft as JsonObject:null,updateDraft=draftFields&&hashRuntimeRequest(json(draftFields.avatar))===hashRuntimeRequest(json(published.avatar));
    await repo.saveProfile({...profile,version:profile.version+1,data:{...profile.data,published:{...published,avatar},publishedVersion:Number(profile.data.publishedVersion)+1,confirmationSource:p.kind==='agent'?'runtime_declaration':'owner_authenticated',...(updateDraft?{draft:{...draftFields!,avatar}}:{})}},profile.version);
   }
   const updated=(await repo.getProfile(id))!;
   return {result:json({agentId:id,assetId,profileVersion:updated.version,publishedVersion:updated.data.publishedVersion,policyVersion:updated.data.policyVersion,appearance:avatar,changed}),eventIds:[]};
  }});
 }
 async function query(ctx:RuntimeReadContext,p:Principal,id:string,origin:string,operation:string,input:JsonObject):Promise<JsonObject>{
  const c=await context(ctx,p,id,origin),repo=ctx.repository(AVATAR_ASSET_REPOSITORY);
  if(operation==='avatar_assets.task'){const t=(await task(ctx,p,id,input.taskId,origin,p.kind==='owner')).task;return json({agentId:id,task:await taskView(ctx,p,t),asOf:ctx.now()});}
  if(operation==='avatar_assets.draft'){const a=await draft(ctx,p,id,input.assetId,origin);return json({agentId:id,draft:await draftView(ctx,a),asOf:ctx.now()});}
  if(!['avatar_assets.tasks','avatar_assets.drafts'].includes(operation))absent();
  if(p.kind==='agent')await business(ctx,p,id);
  if(operation==='avatar_assets.drafts'&&input.taskId!==undefined)await task(ctx,p,id,input.taskId,origin);
  const limit=input.limit===undefined?20:Number(input.limit);if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail('invalid_request',400,'每页1至50条。');
  const scope={instanceId:ctx.instanceId,recoveryEpoch:ctx.recoveryEpoch,worldId:hashRuntimeRequest(json({operation,origin,principal:{kind:p.kind,id:p.kind==='owner'?p.ownerId:p.agentId},...c.binding,taskId:input.taskId??null})),agentId:id,limit},afterId=input.cursor===undefined?undefined:cursors.decode(text(input.cursor,'cursor',1,2048),scope,ctx.now());
  const rows=operation==='avatar_assets.tasks'?await repo.listTasks({agentId:id,...c.binding,activeOnly:p.kind==='agent',asOf:ctx.now(),...(afterId?{afterId}:{}),limit:limit+1}):await repo.listAssets({agentId:id,...c.binding,...(input.taskId?{taskId:String(input.taskId)}:{}),...(afterId?{afterId}:{}),asOf:ctx.now(),limit:limit+1}),complete=rows.length<=limit,candidates=rows.slice(0,limit),shown:JsonObject[]=[];
  for(const row of candidates){try{await task(ctx,p,id,operation==='avatar_assets.tasks'?row.id:(row as AvatarAsset).taskId,origin,p.kind==='owner');shown.push(json(operation==='avatar_assets.tasks'?await taskView(ctx,p,row as AvatarTask):await draftView(ctx,row as AvatarAsset)));}catch(e){if(!(e instanceof M1Error)||e.statusCode>=500)throw e;}}
  return json({agentId:id,[operation==='avatar_assets.tasks'?'tasks':'drafts']:shown,complete,nextCursor:complete?null:cursors.encode(candidates.at(-1)!.id,scope,ctx.now()),asOf:ctx.now()});
 }
 async function privateFile(ctx:RuntimeReadContext,p:Principal,id:string,origin:string,assetId:string,name:string){const a=await draft(ctx,p,id,assetId,origin),file=a.files.find(f=>f.name===name);if(!file)absent();return {bytes:await files.read(file.sha256),contentType:file.contentType};}
 async function publicFile(ctx:RuntimeReadContext,assetId:string,digest:string,name:string){
  const repo=ctx.repository(AVATAR_ASSET_REPOSITORY),a=await repo.getAsset(assetId),publication=await repo.getPublication(assetId);
  if(!a||a.kind!=='avatar'||!a.validation.valid||!a.publicDocument||!publication)absent();
  const profile=await repo.getProfile(a.agentId),status=await repo.getPublicStatus(a.agentId),active=(profile?.data.published as JsonObject|null)?.avatar as JsonObject|undefined,binding=await identity.readCurrentManagementBinding?.(ctx,a.agentId),source=await repo.getTask(a.taskId);
  if(!binding||!source||source.ownerId!==binding.ownerId||source.bindingId!==binding.bindingId||source.bindingVersion!==binding.bindingVersion||publication.ownerId!==binding.ownerId||publication.bindingId!==binding.bindingId||publication.bindingVersion!==binding.bindingVersion||!status.joined||status.restricted||active?.kind!=='custom'||active.assetId!==a.id||active.digest!==a.digest)absent();
  // Task expiry/revocation alone never rolls back a still-authorized applied version.
  if(name==='manifest.json'){if(digest!==a.digest)absent();return {bytes:Buffer.from(canonicalAvatarDocument(a.publicDocument)),contentType:'application/json; charset=utf-8'};}
  const file=a.files.find(f=>f.name===name&&f.sha256===digest);if(!file)absent();return {bytes:await files.read(file.sha256),contentType:file.contentType};
 }
 return {execute,query,receipt,privateFile,publicFile};
}
