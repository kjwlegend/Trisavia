import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PARTICIPATION_HOST_GUIDANCE,PARTICIPATION_MODE_GUIDE,CURRENT_PARTICIPATION_JOB_BOOTSTRAP,CURRENT_PARTICIPATION_REGISTRATION_PROMPT,CURRENT_PARTICIPATION_TASK_UPDATE_PROMPT,PARTICIPATION_LIFE_AUTHORIZATION,PARTICIPATION_LIFE_INTENT_OPENING} from '../../apps/platform/application/agent-participation-guide.ts';
import {readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
// @ts-expect-error Plain browser module, shared pure block extraction only.
import {extractOnboardingPrompt,extractRuntimeUpdatePrompt} from '../../apps/web/public/onboarding-prompt.js';

test('current participation entry, copy blocks, bootstrap and metadata share the new scheduling contract without executing jobs',async()=>{
 const load=(name:string)=>readFile(new URL('../../docs/access/v1/'+name,import.meta.url),'utf8');
 const [entry,prompt,api,setup,runtime]=await Promise.all([load('entry.md'),load('prompt.md'),load('http-api.md'),load('local-setup.md'),readAgentRuntimeGuide()]);
 assert.equal(runtime.ruleVersion,7);assert.equal(runtime.digest,createHash('sha256').update(runtime.text).digest('hex'));assert.equal(runtime.bytes,Buffer.byteLength(runtime.text));assert(runtime.bytes<=16384);
 assert.equal(extractOnboardingPrompt(prompt,'https://same-origin.invalid'),CURRENT_PARTICIPATION_REGISTRATION_PROMPT.replaceAll('{{ORIGIN}}','https://same-origin.invalid'));
 assert.equal(extractRuntimeUpdatePrompt(prompt,'https://same-origin.invalid'),CURRENT_PARTICIPATION_TASK_UPDATE_PROMPT.replaceAll('{{ORIGIN}}','https://same-origin.invalid'));
 assert(entry.includes(PARTICIPATION_MODE_GUIDE));assert(entry.includes(CURRENT_PARTICIPATION_JOB_BOOTSTRAP));assert(api.includes(PARTICIPATION_MODE_GUIDE));assert(setup.includes('participation-plan --state'));
 assert(CURRENT_PARTICIPATION_JOB_BOOTSTRAP.startsWith('先读取本人当前world-action-policy和world-access。manual不继续自动周期行动'));
 assert(!CURRENT_PARTICIPATION_JOB_BOOTSTRAP.includes(PARTICIPATION_MODE_GUIDE),'bootstrap discovers the full rule instead of freezing it');
 for(const text of [PARTICIPATION_MODE_GUIDE,runtime.text]){for(const word of ['manual','autonomous','observe','expectedPolicyVersion','逻辑','pause/resume','delete/create','unsupported','unknown','私有日志窄例外'])assert(text.includes(word),word);}
 assert.equal(PARTICIPATION_HOST_GUIDANCE.version,5);assert.equal((PARTICIPATION_HOST_GUIDANCE.scheduling as any).serverControlsJob,false);assert.equal((PARTICIPATION_HOST_GUIDANCE.participationMode as any).grantsWorldActions,false);assert(String(PARTICIPATION_HOST_GUIDANCE.instruction).includes('当前autonomous且没有已配置安排'));
 assert(PARTICIPATION_LIFE_AUTHORIZATION.includes('no per-action Owner grant'));assert(PARTICIPATION_LIFE_INTENT_OPENING.includes('收到主人本次指令后再行动'));
});
