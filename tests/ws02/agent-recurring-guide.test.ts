import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import Fastify from 'fastify';
import {FROZEN_HOURLY_HOST_GUIDE,FROZEN_HOURLY_HUMAN_GUIDE,HOURLY_HOST_GUIDE,CURRENT_HOURLY_AUTONOMY_GUIDE,CURRENT_HOURLY_HUMAN_GUIDE,CURRENT_RECURRING_HOST_GUIDE,RECURRING_JOB_BOOTSTRAP,HOST_PARTICIPATION_GUIDANCE} from '../../apps/platform/application/agent-hourly-participation-guide.ts';
import {worldGatewayGuide} from '../../apps/platform/application/agent-gateway-world.ts';
import {worldGatewayGuide as worldGuide11} from '../../apps/platform/application/agent-gateway-world-frozen-v11.ts';
import {initializePerceptionCatalog,publishPerceptionCatalog,publishRecurringBootstrapInTransaction,readRecurringBootstrapReceipt,publishProfilePersonalizationInTransaction,readProfilePersonalizationReceipt} from '../../apps/platform/application/perception-catalog.ts';
import {PROFILE_PERSONALIZATION_GUIDE,PROFILE_PERSONALIZATION_GUIDANCE} from '../../apps/platform/application/agent-profile-guide.ts';
import {verifyApplicationReadinessInSession} from '../../apps/platform/application/bootstrap.ts';
import {verifyLifeGuideCatalogForStartup} from '../../apps/platform/app.ts';
import {validateFields} from '../../apps/platform/domains/profile/profile-rules.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import {profileGuideConnection} from '../../scripts/agent-profile-guide.ts';
import {createPerceptionService} from '../../apps/platform/application/perception-service.ts';
import {registerPerceptionRoutes} from '../../apps/platform/transport/http/perception-routes.ts';
import {hashRuntimeRequest} from '../../apps/platform/domains/runtime/command.ts';
import {M1_TABLES,type M1Table,type StoredRow,type M1Store,type M1Transaction,type RetentionCutoff} from '../../apps/platform/contracts/store.ts';
import {createM1Service,type M1Service} from '../../apps/platform/application/m1-service.ts';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
/** In-memory metadata transaction only: no PG, listener, credentials or host scheduling tool. */
function memory(){
 let tables=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(t=>[t,new Map()]));
 const rows=(t:M1Table,filters:Record<string,unknown>={})=>[...tables.get(t)!.values()].filter(r=>Object.entries(filters).every(([k,v])=>r.data[k]===v)).sort((a,b)=>a.id.localeCompare(b.id)).map(r=>structuredClone(r));
 const tx={get:async(t:M1Table,id:string)=>structuredClone(tables.get(t)!.get(id)),find:async(t:M1Table,f:Record<string,unknown>)=>rows(t,f),scan:async(t:M1Table,f:Record<string,unknown>,o:{limit:number;afterId?:string;cutoff?:RetentionCutoff})=>rows(t,f).filter(r=>(!o.afterId||r.id>o.afterId)&&(!o.cutoff||Number(r.data[o.cutoff.field])<o.cutoff.at+(o.cutoff.inclusive?1:0))).slice(0,o.limit),count:async(t:M1Table,f:Record<string,unknown>,limit:number)=>Math.min(limit,rows(t,f).length),quotaCount:async()=>0,
  insert:async(t:M1Table,r:StoredRow)=>{assert(!tables.get(t)!.has(r.id));tables.get(t)!.set(r.id,structuredClone(r));},update:async(t:M1Table,r:StoredRow,v:number)=>{assert.equal(tables.get(t)!.get(r.id)?.version,v);tables.get(t)!.set(r.id,structuredClone(r));return true;},remove:async(t:M1Table,id:string,v:number)=>{assert.equal(tables.get(t)!.get(id)?.version,v);return tables.get(t)!.delete(id);}} as unknown as M1Transaction;
 const store={instanceId:'instance_recurring_test',recoveryEpoch:'epoch_recurring_test',read:async(work:(r:M1Transaction)=>Promise<unknown>)=>work(tx),transaction:async(work:(r:M1Transaction)=>Promise<unknown>)=>{const before=structuredClone(tables);try{return await work(tx);}catch(e){tables=before;throw e;}},close:async()=>{}} as unknown as M1Store;
 return{store,tx,rows,snapshot:()=>Object.fromEntries(M1_TABLES.map(t=>[t,rows(t)]))};
}
async function fixture(version:number){
 const f=memory();await f.store.transaction(initializePerceptionCatalog);const original=(await f.tx.get('perception_catalog','guide:world:3'))!.data.document as {text:string};
 await publishPerceptionCatalog(f.store,{revision:'catalog-avatar-assets-1',guideVersion:version,guideText:original.text+'\n'+HOURLY_HOST_GUIDE});
 await f.tx.insert('agents',{id:'synthetic-existing-agent',version:1,data:{createdAt:1,runtimeVersion:1,runtimeActive:true}});
 const options={instanceId:f.store.instanceId,recoveryEpoch:f.store.recoveryEpoch,operator:'isolated:recurring-guide',operationId:'recurring-bootstrap-test-'+version,expectedGuideVersion:version};
 return{...f,options};
}

test('current bootstrap follows discovery, authority, local experience, action and memory while all old frozen bytes stay fixed',async()=>{
 // Retained export/document hashes captured from the approved 016e83eb baseline.
 const frozen={FROZEN_HOURLY_HOST_GUIDE,FROZEN_HOURLY_HUMAN_GUIDE,HOURLY_HOST_GUIDE,CURRENT_HOURLY_AUTONOMY_GUIDE,CURRENT_HOURLY_HUMAN_GUIDE};
 assert.deepEqual(Object.fromEntries(Object.entries(frozen).map(([k,v])=>[k,sha(v)])),{
  FROZEN_HOURLY_HOST_GUIDE:'e0354cbc566f093d1999b79ccac3efaacb1041df4d21cb14af7b7ba2cea61990',FROZEN_HOURLY_HUMAN_GUIDE:'292254ca27ddfd7b94bcd977ccacf7f19173d0b0d83b1d8e88cdaedbbf7d4d39',HOURLY_HOST_GUIDE:'20214885b2dd60abf659c2bcab504a2a8bbbcea635ea689fbe0e96355d67325b',CURRENT_HOURLY_AUTONOMY_GUIDE:'2e08ab75f8e0170a3dcf3a1d78d27298d7bfa4af3f61fedfb1878d4f7b1fcbdb',CURRENT_HOURLY_HUMAN_GUIDE:'068ee1e47f84e3b6f3e4ebb507c4e891362307afca75d02949686cc37d1b0bd8',
 });
 assert.equal(hashRuntimeRequest(worldGuide11.document),'a3417be7b237083306109c04afc318664c4d531dc9a125f04e4c1c553d0bf91e');assert.equal(worldGuide11.document.hostParticipation,HOURLY_HOST_GUIDE);
 assert.equal(worldGatewayGuide.version,15);assert.equal(worldGatewayGuide.document.hostParticipation,CURRENT_RECURRING_HOST_GUIDE);assert.equal(HOST_PARTICIPATION_GUIDANCE.version,2);assert.equal(HOST_PARTICIPATION_GUIDANCE.serverCreatesJobs,false);
 const order=['原可信origin','实时capabilities和Gateway目录','精确版本指南/schema','当前授权','本地已保存的经历','有意义的行动','可靠保存到本地记忆','无变化且无需主人决定时静默'].map(s=>RECURRING_JOB_BOOTSTRAP.indexOf(s));assert(order.every((v,i)=>v>=0&&(i===0||v>order[i-1]!)));
 assert.match(RECURRING_JOB_BOOTSTRAP,/仅取得部分所需说明.*停止依赖这些说明的写入/);assert.match(RECURRING_JOB_BOOTSTRAP,/期望频率版本变化时才/);assert.match(CURRENT_RECURRING_HOST_GUIDE,/旧job只需原位更新一次/);assert.match(CURRENT_RECURRING_HOST_GUIDE,/停用job不因更新说明重新开启/);assert.match(CURRENT_RECURRING_HOST_GUIDE,/宿主原生持久任务工具的真实结果/);
 const entry=await readFile(new URL('../../docs/access/v1/entry.md',import.meta.url),'utf8'),prompt=await readFile(new URL('../../docs/access/v1/prompt.md',import.meta.url),'utf8'),setup=await readFile(new URL('../../docs/access/v1/local-setup.md',import.meta.url),'utf8');
 assert.equal(entry.split('### 周期任务的每轮bootstrap\n')[1]!.split('```text\n')[1]!.split('\n```')[0],RECURRING_JOB_BOOTSTRAP);assert.match(entry,/仅首次入镇且该步骤尚未完成/);assert.match(entry,/只有本次新注册、首次关联且确无已配置安排/);assert.match(entry,/旧启用job原位更新一次提示/);assert.match(entry,/每小时一次（3600秒，可改）/);assert.match(prompt,/按指南完成必要的首次入镇、主人关联与周期参与/);assert(!setup.includes('已加入 connet.ai'));assert.match(setup,/Trisavia.*可信origin/);
});

test('named text publication preserves exact HTTP guides and digests, source states, schemas, facts and same-operation receipts',async()=>{
 for(const version of [9,16]){
  const f=await fixture(version),before=f.snapshot(),old=(await f.tx.get('perception_catalog',`guide:world:${version}`))!,current=(await f.tx.get('perception_catalog','current'))!;
  assert.equal(await readRecurringBootstrapReceipt(f.tx,f.options),undefined);assert.deepEqual(f.snapshot(),before);
  const result=await f.store.transaction(tx=>publishRecurringBootstrapInTransaction(tx,f.options)),published=f.snapshot();assert.equal(result.newGuideDocuments,7);assert.equal(result.newSchemaDocuments,0);assert.equal(result.guideVersion,version+1);assert.equal(result.catalogRevision,'catalog-recurring-bootstrap-1');assert.equal(result.schemaVersion,8);assert.equal(published.perception_catalog!.length,before.perception_catalog!.length+9);
  assert.deepEqual(await f.store.transaction(tx=>publishRecurringBootstrapInTransaction(tx,f.options)),result);assert.deepEqual(await readRecurringBootstrapReceipt(f.tx,f.options),result);assert.deepEqual(f.snapshot(),published);
  for(const row of before.perception_catalog!.filter(r=>/^(guide|schema):/.test(r.id)))assert.deepEqual(await f.tx.get('perception_catalog',row.id),row);
  assert.deepEqual((await f.tx.get('perception_catalog','current'))!.data.sourceStates,current.data.sourceStates);for(const table of M1_TABLES)if(table!=='perception_catalog')assert.deepEqual(f.rows(table),before[table]);
  const service=createPerceptionService(f.store,{authenticate:async(_tx,token)=>({id:'synthetic-'+token,version:1,data:token==='owner'?{kind:'owner_session',ownerId:'synthetic-owner',ownerAuthVersion:1}:{kind:'runtime',agentId:'synthetic-agent',runtimeVersion:1}})}),app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
  try{for(const token of ['owner','runtime'])for(const v of [version,version+1]){
   const response=await app.inject({method:'GET',url:`/v1/perception/guides/world?version=${v}`,headers:{authorization:'Bearer '+token}});assert.equal(response.statusCode,200,response.body);const data=response.json().data;assert.equal(sha(data.canonicalDocument),data.digest);assert.deepEqual(JSON.parse(data.canonicalDocument),data.document);
   if(v===version){assert.deepEqual(data.document,old.data.document);assert.equal(data.digest,old.data.digest);}else{assert(data.document.text.includes(RECURRING_JOB_BOOTSTRAP));assert.equal(data.version,version+1);}
  }const capabilities=await service.capabilities();assert.equal(capabilities.catalogRevision,'catalog-recurring-bootstrap-1');assert.equal(capabilities.skillCatalogRevision,'skills-catalog-recurring-bootstrap-1');const discovery=(await app.inject({method:'GET',url:'/v1/perception/discovery?limit=50',headers:{authorization:'Bearer runtime'}})).json().data;assert(discovery.skills.every((s:any)=>s.version===version+1&&s.guideRef.version===version+1));}finally{await app.close();}
  const stable=f.snapshot();await assert.rejects(f.store.transaction(tx=>publishRecurringBootstrapInTransaction(tx,{...f.options,expectedGuideVersion:version-1})),/payload changed/);assert.deepEqual(f.snapshot(),stable);
 }
});

test('occupied next exact guide rolls back the complete publication and retains the original operation for recovery',async()=>{
 const f=await fixture(16);await f.tx.insert('perception_catalog',{id:'guide:wallet:17',version:1,data:{document:{moduleId:'wallet',version:17,text:'occupied'},digest:'not-the-requested-publication'}});const before=f.snapshot();await assert.rejects(f.store.transaction(tx=>publishRecurringBootstrapInTransaction(tx,f.options)),/source or destination/);assert.deepEqual(f.snapshot(),before);assert.equal(await readRecurringBootstrapReceipt(f.tx,f.options),undefined);
});

test('personalization is explicit, local, confirmed once and discoverable without rewriting the recurring job',async()=>{
 assert.equal(worldGatewayGuide.document.profilePersonalization,PROFILE_PERSONALIZATION_GUIDE);
 assert.equal(PROFILE_PERSONALIZATION_GUIDANCE.existingAgents,'no automatic profile changes');
 const metadata=memory();await metadata.store.transaction(initializePerceptionCatalog);assert.deepEqual((await createM1Service(metadata.store,{email:{mode:'experience'}}).invoke('capabilities',{})).profilePersonalization,PROFILE_PERSONALIZATION_GUIDANCE);
 for(const text of ['主人明确指定','稳定昵称','中文、英文、多字和合理空格','没有历史或无读取权','不套固定名字池','固定三标签','一次简短本地预览','已授权自主设定','确认前不提交','原聊天和记忆原文留在本地','不重注册','原可信origin、实时capabilities和Gateway发现'])assert(PROFILE_PERSONALIZATION_GUIDE.includes(text),text);
 const entry=await readFile(new URL('../../docs/access/v1/entry.md',import.meta.url),'utf8'),prompt=await readFile(new URL('../../docs/access/v1/prompt.md',import.meta.url),'utf8'),setup=await readFile(new URL('../../docs/access/v1/local-setup.md',import.meta.url),'utf8');
 assert.match(entry,/<a id="role-personalization"><\/a>/);assert.match(entry,/中文、英文、多字及合理空格/);assert.match(entry,/一次简短预览/);assert.match(entry,/原聊天、记忆原文不上传/);assert(!entry.includes('不必读取聊天历史'));
 const copied=prompt.split('<!-- connet:copy-prompt:start -->')[1]!.split('<!-- connet:copy-prompt:end -->')[0]!;assert.match(copied,/仅新角色或我明确要求改资料/);assert.match(copied,/必要时集中确认一次/);assert.match(copied,/已获自主设定授权则按当前权限/);assert.equal(copied.trim().split(/\n\s*\n/u).length,3);assert(copied.trim().length<400);for(const detail of ['100星币','每小时','job','bootstrap','固定三标签'])assert(!copied.includes(detail),detail);assert.match(setup,/需要文案确认时必须先完成确认再运行/);assert.match(setup,/此示例只传名字与简介，不代表兴趣标签已经保存/);
});

test('personalization publication keeps real exact-guide reads and the startup catalog gate consistent; original receipts remain readable',async()=>{
 for(const priorVersion of [9,16]){
  const f=await fixture(priorVersion),recurring=await f.store.transaction(tx=>publishRecurringBootstrapInTransaction(tx,f.options)),version=priorVersion+1;
  const options={...f.options,operationId:'profile-personalization-test-'+version,expectedGuideVersion:version},before=f.snapshot(),old=(await f.tx.get('perception_catalog',`guide:profiles:${version}`))!;
  assert.equal(await readProfilePersonalizationReceipt(f.tx,options),undefined);const published=await f.store.transaction(tx=>publishProfilePersonalizationInTransaction(tx,options));assert.equal(published.guideVersion,version+1);assert.equal(published.catalogRevision,'catalog-profile-personalization-1');assert.equal(published.newGuideDocuments,7);assert.equal(published.newSchemaDocuments,0);
  await verifyApplicationReadinessInSession(f.tx);await verifyLifeGuideCatalogForStartup(f.store);
  const after=f.snapshot();assert.equal(after.perception_catalog!.length,before.perception_catalog!.length+9);for(const r of before.perception_catalog!.filter(r=>/^(guide|schema):/.test(r.id)))assert.deepEqual(await f.tx.get('perception_catalog',r.id),r);for(const table of M1_TABLES)if(table!=='perception_catalog')assert.deepEqual(f.rows(table),before[table]);
  assert.deepEqual((await f.tx.get('perception_catalog','current'))!.data.sourceStates,before.perception_catalog!.find(r=>r.id==='current')!.data.sourceStates);
  assert.deepEqual(await f.store.transaction(tx=>publishProfilePersonalizationInTransaction(tx,options)),published);assert.deepEqual(await readProfilePersonalizationReceipt(f.tx,options),published);assert.deepEqual(await readRecurringBootstrapReceipt(f.tx,f.options),recurring);assert.deepEqual(f.snapshot(),after);
  const service=createPerceptionService(f.store,{authenticate:async()=>({id:'synthetic-runtime',version:1,data:{kind:'runtime',agentId:'synthetic-agent',runtimeVersion:1}})}),app=Fastify();registerPerceptionRoutes(app,{invokeHttp:service.invoke} as unknown as M1Service);
  try{for(const v of [version,version+1]){const r=await app.inject({method:'GET',url:`/v1/perception/guides/profiles?version=${v}`,headers:{authorization:'Bearer synthetic-runtime'}});assert.equal(r.statusCode,200);const d=r.json().data;assert.equal(sha(d.canonicalDocument),d.digest);assert.deepEqual(JSON.parse(d.canonicalDocument),d.document);if(v===version){assert.deepEqual(d.document,old.data.document);assert.equal(d.digest,old.data.digest);}else{assert(d.document.text.includes(PROFILE_PERSONALIZATION_GUIDE));assert(d.document.text.includes(RECURRING_JOB_BOOTSTRAP));}}
   assert.equal((await service.capabilities()).catalogRevision,'catalog-profile-personalization-1');
  }finally{await app.close();}
  const afterReads=f.snapshot();await assert.rejects(f.store.transaction(tx=>publishProfilePersonalizationInTransaction(tx,{...options,expectedGuideVersion:version-1})),/payload changed/);assert.deepEqual(f.snapshot(),afterReads);
 }
 const occupied=await fixture(16);await occupied.store.transaction(tx=>publishRecurringBootstrapInTransaction(tx,occupied.options));const options={...occupied.options,operationId:'profile-personalization-occupied',expectedGuideVersion:17};await occupied.tx.insert('perception_catalog',{id:'guide:wallet:18',version:1,data:{document:{moduleId:'wallet',version:18,text:'occupied'},digest:'occupied'}});const before=occupied.snapshot();await assert.rejects(occupied.store.transaction(tx=>publishProfilePersonalizationInTransaction(tx,options)),/source or destination/);assert.deepEqual(occupied.snapshot(),before);assert.equal(await readProfilePersonalizationReceipt(occupied.tx,options),undefined);
});

test('the actual profile route accepts Unicode and multiword fields; strict offline publication URL guards reject role/target overrides',async()=>{
 const app=Fastify();registerM1Routes(app,{invokeHttp:async(action:string,body:unknown)=>{assert.equal(action,'saveProfile');return{fields:validateFields((body as any).fields)};}} as unknown as M1Service);
 try{for(const name of ['清昼拾光','Aster North','小镇里的回声']){const fields={displayName:name,bio:'我习惯把看到的光影记下来。',interests:['海边写生','旧地图']};const result=await app.inject({method:'PUT',url:'/v1/agents/synthetic-agent/profile',payload:{operationId:'synthetic-op',expectedVersion:1,expectedPolicyVersion:1,fields}});assert.equal(result.statusCode,200);assert.deepEqual(result.json().fields,fields);}
  assert.equal((await app.inject({method:'PUT',url:'/v1/agents/synthetic-agent/profile',payload:{fields:{displayName:'bad\nname'}}})).statusCode,400);
 }finally{await app.close();}
 const database='world_core_b_1234567890abcdefabcd',url='postgresql://connet_app:synthetic-only@127.0.0.1:5432/'+database;
 assert.equal(profileGuideConnection(url,database,'connet_app'),url);
 for(const bad of [url+'?host=other',url+'#override',url+'\nignored',url.replace('connet_app','connet_migrator'),url.replace(database,'world_core_b_abcdef1234567890abcd'),url.replace('127.0.0.1','localhost')])assert.throws(()=>profileGuideConnection(bad,database,'connet_app'));
});

test('the published shell example omits an unset/empty biography and preserves a nonempty biography as one argument',async()=>{
 const setup=await readFile(new URL('../../docs/access/v1/local-setup.md',import.meta.url),'utf8'),example=setup.split('```sh\n')[1]!.split('\n```')[0]!;
 // Execute the actual published shell snippet with transport/CLI capture functions. No download, state file or HTTP.
 const capture='curl(){ :; }; node(){ "$PROFILE_EXAMPLE_NODE" -e \'process.stdout.write(JSON.stringify(process.argv.slice(1)))\' "$@"; };\n'+example;
 for(const bio of [undefined,'','我喜欢夜里写下海边的风声。']){
  const env:NodeJS.ProcessEnv={...process.env,ORIGIN:'https://example.invalid',AGENT_STATE:'/unused-profile-example-state',AGENT_NAME:'清昼拾光',PROFILE_EXAMPLE_NODE:process.execPath};
  delete env.AGENT_BIO;if(bio!==undefined)env.AGENT_BIO=bio;
  const {stdout,stderr}=await promisify(execFile)('sh',['-c',capture],{env});assert.equal(stderr,'');
  const expected=['m1-agent.ts','onboard','--url',env.ORIGIN,'--state',env.AGENT_STATE,'--name',env.AGENT_NAME,...(bio?['--bio',bio]:[])];assert.deepEqual(JSON.parse(stdout),expected);
 }
});
