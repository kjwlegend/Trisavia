import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {APPROVED_REGISTRATION_PROMPT,APPROVED_TASK_UPDATE_PROMPT,APPROVED_RECURRING_JOB_BOOTSTRAP,APPROVED_PROFILE_RULES,APPROVED_PROMPT_SOURCE_DIGESTS} from '../../apps/platform/application/agent-approved-prompts.ts';
import {APPROVED_TEMPLATE_REPLACEMENTS,rewriteApprovedAgentTemplateText} from '../../apps/platform/application/agent-approved-template-text.ts';
import {AGENT_RUNTIME_SECTION_HEADINGS,parseAgentRuntimeGuide,readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

test('approved 01–04 keep every literal character except the trusted-origin placeholder',()=>{
 const originals={registration:APPROVED_REGISTRATION_PROMPT,update:APPROVED_TASK_UPDATE_PROMPT,recurring:APPROVED_RECURRING_JOB_BOOTSTRAP,profile:APPROVED_PROFILE_RULES};
 for(const [id,text] of Object.entries(originals))assert.equal(sha(text.replaceAll('{{ORIGIN}}','http://127.0.0.1:18893')+'\n'),APPROVED_PROMPT_SOURCE_DIGESTS[id as keyof typeof originals]);
});

test('seven-group current runtime retains approved 05 and the complete 0100 journal/NPC block',async()=>{
 const runtime=await readAgentRuntimeGuide();assert.equal(runtime.ruleVersion,5);assert(runtime.bytes<=16384);assert.equal(runtime.digest,sha(runtime.text));
 const body=runtime.text.slice(runtime.text.indexOf('\n\n')+2),marker='个人日志能力实际启用后，',approved=body.slice(0,body.indexOf(marker)).trimEnd()+'\n\n<!-- connet:runtime-rule:end -->\n\n';
 assert.equal(sha(approved),APPROVED_PROMPT_SOURCE_DIGESTS.runtime);
 const oldBlock=body.slice(body.indexOf(marker),body.indexOf('\n\n当前个人日志的纯文本正文'));
 assert.equal(sha(oldBlock),'1112496eced9e2ee6cdac47fa2239f28939ca6b87215e8e137dda09e8bd3afef');
 for(const text of ['expectedAudienceRef','可能为null','sourceRefs','4000','16KiB','跨command','任一失权整篇不展示','observe或暂停','不覆盖主人明确禁止写入或立即停止'])assert(runtime.text.includes(text),text);
 const lines=runtime.text.split('\n');assert.deepEqual(lines.filter(line=>/^## /u.test(line)),AGENT_RUNTIME_SECTION_HEADINGS);
 for(const heading of AGENT_RUNTIME_SECTION_HEADINGS)assert.throws(()=>parseAgentRuntimeGuide(Buffer.from(runtime.text.replace(heading,'## 缺失'))));
 for(const malformed of [runtime.text.replace(AGENT_RUNTIME_SECTION_HEADINGS[1]!,AGENT_RUNTIME_SECTION_HEADINGS[0]!),runtime.text.replace('## 2. 获取规则与续接\n\n','## 2. 获取规则与续接\n\n## 多余\n'),runtime.text.replace('## 3. 了解世界','### 3. 了解世界'),runtime.text.replace('<!-- connet:runtime-rule:end -->','inline <!-- connet:runtime-rule:end -->\n<!-- connet:runtime-rule:end -->')])assert.throws(()=>parseAgentRuntimeGuide(Buffer.from(malformed)));
});

test('M2 versioned text copies replace exact approved blocks, preserve unrelated content and fail closed on ambiguity',()=>{
 const source='unchanged protocol before\n'+APPROVED_TEMPLATE_REPLACEMENTS.map(row=>row.before).join('\nunchanged source guard\n')+'\nunchanged protocol after';
 const next=rewriteApprovedAgentTemplateText(source);assert(next.startsWith('unchanged protocol before\n'));assert(next.endsWith('\nunchanged protocol after'));assert.equal(next.split('unchanged source guard').length,4);
 for(const replacement of APPROVED_TEMPLATE_REPLACEMENTS)assert(next.includes(replacement.after));
 for(const row of APPROVED_TEMPLATE_REPLACEMENTS){assert.throws(()=>rewriteApprovedAgentTemplateText(source.replace(row.before,'')));assert.throws(()=>rewriteApprovedAgentTemplateText(source+'\n'+row.before));}
 assert(!next.includes('接下来，你想让我去哪里看看'));assert(!next.includes('我已经走到{{OTHER_AGENT_NAME}}附近了'));
 assert(next.includes('首次交接附当前可信官网和有效同源私密管理入口'));
});
