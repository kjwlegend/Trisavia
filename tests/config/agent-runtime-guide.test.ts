import {APPROVED_REGISTRATION_PROMPT,APPROVED_TASK_UPDATE_PROMPT,APPROVED_RECURRING_JOB_BOOTSTRAP,APPROVED_RUNTIME_HOST_GUIDE} from '../../apps/platform/application/agent-approved-prompts.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AGENT_RUNTIME_MAX_BYTES,AGENT_RUNTIME_RULES_PATH,AGENT_RUNTIME_MIGRATION_GUIDE,AgentRuntimeGuideError,createAgentRuntimeGuideProvider,parseAgentRuntimeGuide,readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
import {CURRENT_RUNTIME_JOB_BOOTSTRAP,CURRENT_RUNTIME_HOST_GUIDE} from '../../apps/platform/application/agent-hourly-participation-guide.ts';

const root=new URL('../../',import.meta.url),end='<!-- connet:runtime-rule:end -->\n';
const source=()=>readFile(new URL('docs/access/v1/runtime.md',root));
const code=(expected:string)=>(error:unknown)=>error instanceof AgentRuntimeGuideError&&error.code===expected&&error.message==='Current Agent runtime rules could not be verified';
function revision(text:string,ruleVersion:number){return text.replace(/^.*\n/,`<!-- connet:runtime-rule ${JSON.stringify({ruleVersion,updatedAt:'2026-10-27T00:00:00.000Z',changeSummary:'分享规则单独更新；业务API不变。'})} -->\n`).replace('普通经历也可以值得分享','跨轮普通经历也可以值得分享');}

test('current autonomous runtime keeps complete sections and exact current guide text',async()=>{
 const raw=await source(),guide=await readAgentRuntimeGuide();
 assert.equal(guide.path,AGENT_RUNTIME_RULES_PATH);assert.equal(guide.ruleVersion,5);assert(Object.isFrozen(guide));
 assert.equal(guide.bytes,raw.length);assert.equal(guide.text,raw.toString('utf8'));assert.equal(guide.digestAlgorithm,'sha256-utf8-hex');assert.equal(guide.digest,createHash('sha256').update(raw).digest('hex'));assert(raw.length<AGENT_RUNTIME_MAX_BYTES);
 assert.match(guide.text,/## 1. 授权与调度/);assert.match(guide.text,/## 7. 通知、投递与记录/);assert.match(guide.text,/长度随内容，不强压成一至三句/);

});

test('same provider freshly discovers a rule-only update and never serves old or partial text as current after failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'trisavia-runtime-guide-')),file=join(dir,'runtime.md');
 try{
  const original=await source();await writeFile(file,original);const provider=createAgentRuntimeGuideProvider(file),first=await provider();
  const next=revision(first.text,first.ruleVersion+1);await writeFile(file,next);const updated=await provider();
  assert.equal(updated.path,first.path);assert.equal(updated.ruleVersion,first.ruleVersion+1);assert.notEqual(updated.digest,first.digest);assert.equal(updated.text,next);assert.equal(first.text,original.toString('utf8'));
  await writeFile(file,next.slice(0,-end.length));await assert.rejects(provider,code('runtime_rules_invalid'));
  // The caller can retain its immutable last complete snapshot; failure returns no adoptable new snapshot.
  assert.equal(updated.text,next);assert.equal(updated.ruleVersion,first.ruleVersion+1);
  await writeFile(file,revision(first.text,first.ruleVersion+2));assert.equal((await provider()).ruleVersion,first.ruleVersion+2);
  await rm(file);await assert.rejects(provider,code('runtime_rules_unavailable'));await assert.rejects(readAgentRuntimeGuide(dir),code('runtime_rules_unavailable'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('incomplete, malformed and unbounded runtime documents fail as whole documents',async()=>{
 const text=(await source()).toString('utf8'),header=text.split('\n')[0]!;
 const malformed=[
  '',text.slice(0,-1),text.replace(end,''),text+end,text.replace('## 2. 获取规则与续接','## 缺失'),
  text.replace('## 2. 获取规则与续接','## 1. 授权与调度'),text.replaceAll('\n','\r\n'),'\uFEFF'+text,text+'\0',
  text.replace(/"ruleVersion":\d+/,'"ruleVersion":0'),text.replace(/"ruleVersion":\d+/,'"ruleVersion":1,"ruleVersion":2'),
  text.replace(header,header.replace(/"updatedAt":"[^"]+"/,'"updatedAt":"2026-02-30T00:00:00.000Z"')),
  text.replace('"changeSummary":','"extra":true,"changeSummary":'),text.replace(/"changeSummary":"[^"]+"/,'"changeSummary":""'),
 ];
 for(const value of malformed)assert.throws(()=>parseAgentRuntimeGuide(Buffer.from(value)),code('runtime_rules_invalid'));
 assert.throws(()=>parseAgentRuntimeGuide(Buffer.from([0xc3,0x28])),code('runtime_rules_invalid'));
 assert.throws(()=>parseAgentRuntimeGuide(Buffer.alloc(AGENT_RUNTIME_MAX_BYTES+1)),code('runtime_rules_invalid'));
});

test('join and one-time update prompts point to the same rules without executing or claiming to migrate any host job',async()=>{
 const prompt=await readFile(new URL('docs/access/v1/prompt.md',root),'utf8'),entry=await readFile(new URL('docs/access/v1/entry.md',root),'utf8');
 const block=(name:string)=>{const start=`<!-- connet:${name}:start -->`,finish=`<!-- connet:${name}:end -->`;assert.equal(prompt.split(start).length,2);assert.equal(prompt.split(finish).length,2);return prompt.split(start)[1]!.split(finish)[0]!;};
 const joinPrompt=block('copy-prompt'),update=block('runtime-update');
 for(const value of [joinPrompt,update])assert(value.includes('{{ORIGIN}}'+AGENT_RUNTIME_RULES_PATH));
 assert.equal(joinPrompt.trim(),APPROVED_REGISTRATION_PROMPT);assert.equal(update.trim(),APPROVED_TASK_UPDATE_PROMPT);
 assert(!/runtimeToken|ownerId|agentId|managementUrl|https?:\/\//.test(update));
 assert.equal(entry.split('### 周期任务的每轮bootstrap\n')[1]!.split('```text\n')[1]!.split('\n```')[0],APPROVED_RECURRING_JOB_BOOTSTRAP);
 assert.match(APPROVED_RUNTIME_HOST_GUIDE,/首次真实关联/);assert.match(APPROVED_RUNTIME_HOST_GUIDE,/旧null不猜作未配置/);assert.match(AGENT_RUNTIME_MIGRATION_GUIDE,/服务器不能远程更新从不读指引的旧job/);assert.match(AGENT_RUNTIME_MIGRATION_GUIDE,/宿主原生持久任务工具实际确认后/);
});
