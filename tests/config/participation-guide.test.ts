import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PARTICIPATION_HOST_GUIDANCE,PARTICIPATION_MODE_GUIDE,FROZEN_PARTICIPATION_JOB_BOOTSTRAP_V0130,PARTICIPATION_VISIBLE_EXPRESSION_GUIDANCE,CURRENT_PARTICIPATION_JOB_BOOTSTRAP,CURRENT_PARTICIPATION_REGISTRATION_PROMPT,CURRENT_PARTICIPATION_TASK_UPDATE_PROMPT,PARTICIPATION_LIFE_AUTHORIZATION,PARTICIPATION_LIFE_INTENT_OPENING} from '../../apps/platform/application/agent-participation-guide.ts';
import {readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
// @ts-expect-error Plain browser module, shared pure block extraction only.
import {extractOnboardingPrompt,extractRuntimeUpdatePrompt} from '../../apps/web/public/onboarding-prompt.js';

test('current participation entry, copy blocks, bootstrap and metadata share the new scheduling contract without executing jobs',async()=>{
 const load=(name:string)=>readFile(new URL('../../docs/access/v1/'+name,import.meta.url),'utf8');
 const [entry,prompt,api,setup,runtime]=await Promise.all([load('entry.md'),load('prompt.md'),load('http-api.md'),load('local-setup.md'),readAgentRuntimeGuide()]);
 assert.equal(runtime.ruleVersion,8);assert.equal(runtime.digest,createHash('sha256').update(runtime.text).digest('hex'));assert.equal(runtime.bytes,Buffer.byteLength(runtime.text));assert(runtime.bytes<=16384);
 assert.equal(extractOnboardingPrompt(prompt,'https://same-origin.invalid'),CURRENT_PARTICIPATION_REGISTRATION_PROMPT.replaceAll('{{ORIGIN}}','https://same-origin.invalid'));
 assert.equal(extractRuntimeUpdatePrompt(prompt,'https://same-origin.invalid'),CURRENT_PARTICIPATION_TASK_UPDATE_PROMPT.replaceAll('{{ORIGIN}}','https://same-origin.invalid'));
 assert(entry.includes(PARTICIPATION_MODE_GUIDE));assert(entry.includes(CURRENT_PARTICIPATION_JOB_BOOTSTRAP));assert(api.includes(PARTICIPATION_MODE_GUIDE));assert(!api.includes('mode仅autonomous或observe'));assert(api.includes('mode为autonomous、manual或旧observe'));assert(setup.includes('participation-plan --state'));
 assert(CURRENT_PARTICIPATION_JOB_BOOTSTRAP.startsWith('先读取本人当前world-action-policy和world-access。manual不继续自动周期行动'));
 assert(!CURRENT_PARTICIPATION_JOB_BOOTSTRAP.includes(PARTICIPATION_MODE_GUIDE),'bootstrap discovers the full rule instead of freezing it');
 for(const text of [PARTICIPATION_MODE_GUIDE,runtime.text]){for(const word of ['manual','autonomous','observe','expectedPolicyVersion','逻辑','pause/resume','delete/create','unsupported','unknown','私有日志窄例外'])assert(text.includes(word),word);}
 assert.equal(PARTICIPATION_HOST_GUIDANCE.version,6);assert.equal((PARTICIPATION_HOST_GUIDANCE.scheduling as any).serverControlsJob,false);assert.equal((PARTICIPATION_HOST_GUIDANCE.participationMode as any).grantsWorldActions,false);assert(String(PARTICIPATION_HOST_GUIDANCE.instruction).includes('当前autonomous且没有已配置安排'));
 assert(PARTICIPATION_LIFE_AUTHORIZATION.includes('no per-action Owner grant'));assert(PARTICIPATION_LIFE_INTENT_OPENING.includes('收到主人本次指令后再行动'));
});

test('visible expression review and the current bootstrap use the two exact approved paragraphs',async()=>{
 const runtime=await readAgentRuntimeGuide(),expected='发送前根据已核实结果重新组织生活分享：保留本次想做什么及简短选择理由，说清实际结果、受阻后的真实调整，以及继续或重新考虑的条件。检查事实、因果和指代；替代行动尚未发生、下一步尚未决定或原因未知时，保留这个缺口，不能补造一个合理的打算。错误码、请求和回执流水、规则校验、频率及宿主采用状态留在执行记录，不逐轮搬进生活分享；也不能把技术故障写成道路关闭、场所停业或他人拒绝。确需主人处理时先说明实际影响和所需帮助；确需主人排障或主人明确要求技术细节时，再单独提供必要诊断。内部校验、原结果查询、预算、权限与幂等要求照常执行。';
 const section=runtime.text.split('## 6. 自然表达\n')[1]!.split('\n## 7.')[0]!,bullets=section.split('\n').filter(line=>line.startsWith('- '));assert.equal(bullets[3],'- '+expected);assert.equal(runtime.text.split(expected).length,2);assert(!runtime.text.includes('发送前检查事实、因果、重要环节和指代'));
 const tail='上述核对、记录和采用报告是内部执行要求，不是给主人回复的栏目；所有可见正文，包括执行前言、进度说明、最终回复和不通知状态中的文字，均按最新runtime第6节表达。';
 assert.equal(PARTICIPATION_VISIBLE_EXPRESSION_GUIDANCE,tail);assert.equal(CURRENT_PARTICIPATION_JOB_BOOTSTRAP,FROZEN_PARTICIPATION_JOB_BOOTSTRAP_V0130+'\n\n'+tail);assert.equal(PARTICIPATION_HOST_GUIDANCE.bootstrap,CURRENT_PARTICIPATION_JOB_BOOTSTRAP);
 assert(runtime.text.endsWith('<!-- connet:runtime-rule:end -->\n'));assert(runtime.text.includes('未知先查原结果'));assert(runtime.text.includes('不重复提交花钱或消耗操作'));
});
