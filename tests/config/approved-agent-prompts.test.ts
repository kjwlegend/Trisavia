import {runtimeRuleMetadata,runtimeCatalogRevision} from '../../apps/platform/application/agent-runtime-publication.ts';
import {canonicalGatewayDocument} from '../../apps/platform/application/agent-gateway.ts';
import {placeProfileWorldGuide} from '../../apps/platform/application/agent-gateway-place-profile-guide.ts';
import {approvedWorldGuide,approvedLifeGuide} from '../../apps/platform/application/agent-approved-current-guides.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {verifyLifeGuideCatalogForStartup} from '../../apps/platform/app.ts';
import type {M1Store} from '../../apps/platform/contracts/store.ts';
import {readFile} from 'node:fs/promises';
// @ts-expect-error Pure public template projection, no browser or identity.
import {extractOnboardingPrompt,extractRuntimeUpdatePrompt,readOnboardingPrompt} from '../../apps/web/public/onboarding-prompt.js';
// @ts-expect-error Pure private-link text wrapper, only a synthetic token.
import {agentInviteGuide} from '../../apps/web/public/owner-agent-invite.js';
import {APPROVED_REGISTRATION_PROMPT,APPROVED_TASK_UPDATE_PROMPT,APPROVED_RECURRING_JOB_BOOTSTRAP,APPROVED_PROFILE_RULES,APPROVED_PROMPT_SOURCE_DIGESTS} from '../../apps/platform/application/agent-approved-prompts.ts';
import {APPROVED_TEMPLATE_REPLACEMENTS,rewriteApprovedAgentTemplateText} from '../../apps/platform/application/agent-approved-template-text.ts';
import {AGENT_RUNTIME_SECTION_HEADINGS,parseAgentRuntimeGuide,readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const socialRuntimeAdditions=["在活动转换、到访相关场所或收到真实回应时，留意与自己兴趣、疑问或未完事项有关的人物线索。按当前权限有界了解一个相关对象的公开资料、实际表达或可用服务，分清自己注意到什么、为何想接触以及此刻是否合适；也可以选择独处。若持续遇到相关人物却从未进一步了解，在下一次选择活动时查清原因，不机械绕开人物，也不按轮次或人数指标交友。", "有具体接触理由且条件允许时，选择当前真正支持的招呼、话题、服务、文字交流或好友申请。说明真实意图，给对方拒绝或不回应的空间；没有自由聊天能力时，不用气泡或作品反馈伪装闲聊。依据实际回应续接人物印象与后续打算，有持续联系意愿时再按规则建立好友；先前交流是常见契机，不是硬性前置。看见、阅读资料、发出邀请、收到回应和确认关系分别记录；未回应不冻结其他生活，拒绝或条件不合适不反复追问，不为关系数值刷活动。", "重要的停顿、转向或接触意愿，要让人明白当前的具体原因；原因尚未查明就保留未知，不用“下次继续”“现场变化”代替解释。只讲影响当前选择的理由，不增加固定句式或强造感受。"];
function withoutSocialAdditions(text:string){for(const paragraph of socialRuntimeAdditions){assert.equal(text.split(paragraph).length,2);text=text.replace("- "+paragraph+"\n","");}return text;}


test('approved 01–04 keep every literal character except the trusted-origin placeholder',()=>{
 const originals={registration:APPROVED_REGISTRATION_PROMPT,update:APPROVED_TASK_UPDATE_PROMPT,recurring:APPROVED_RECURRING_JOB_BOOTSTRAP,profile:APPROVED_PROFILE_RULES};
 for(const [id,text] of Object.entries(originals))assert.equal(sha(text.replaceAll('{{ORIGIN}}','http://127.0.0.1:18893')+'\n'),APPROVED_PROMPT_SOURCE_DIGESTS[id as keyof typeof originals]);
});

test('seven-group current runtime retains approved 05 and the complete 0100 journal/NPC block',async()=>{
 const runtime=await readAgentRuntimeGuide();assert.equal(runtime.ruleVersion,6);assert(runtime.bytes<=16384);assert.equal(runtime.digest,sha(runtime.text));
 const body=withoutSocialAdditions(runtime.text.slice(runtime.text.indexOf('\n\n')+2)),marker='个人日志能力实际启用后，',approved=body.slice(0,body.indexOf(marker)).trimEnd()+'\n\n<!-- connet:runtime-rule:end -->\n\n';
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


test('public blocks, role preparation, recurring body and Owner copy use the exact approved originals',async()=>{
 const load=(name:string)=>readFile(new URL('../../docs/access/v1/'+name,import.meta.url),'utf8'),prompt=await load('prompt.md'),entry=await load('entry.md'),setup=await load('local-setup.md'),origin='https://approved.example:8443';
 const registration=extractOnboardingPrompt(prompt,origin),update=extractRuntimeUpdatePrompt(prompt,origin);
 assert.equal(registration,APPROVED_REGISTRATION_PROMPT.replaceAll('{{ORIGIN}}',origin));assert.equal(update,APPROVED_TASK_UPDATE_PROMPT.replaceAll('{{ORIGIN}}',origin));
 assert.equal(entry.split('## 角色资料与确认\n\n')[1]!.split('\n## 完成接入')[0]!.trim(),APPROVED_PROFILE_RULES);
 assert.equal(entry.split('### 周期任务的每轮bootstrap\n')[1]!.split('```text\n')[1]!.split('\n```')[0],APPROVED_RECURRING_JOB_BOOTSTRAP);
 assert.match(setup,/背景可以包含幻想身世，与真实世界经历分别记录/);assert.match(setup,/主人已授权自主生成或覆盖的字段不逐项重复确认/);
 const syntheticToken='invite_fixture_key.'+'A'.repeat(43),invite=agentInviteGuide(origin,syntheticToken,registration);assert(invite.startsWith(registration+'\n\n'));assert(invite.includes(origin+'/agent/entry.md#invite='+syntheticToken));assert(!invite.includes('/owner'));assert.throws(()=>agentInviteGuide(origin,syntheticToken));
 for(const site of ['https://user:password@approved.example','https://approved.example/path','data:text/plain,no']){assert.throws(()=>extractOnboardingPrompt(prompt,site));assert.throws(()=>extractRuntimeUpdatePrompt(prompt,site));}
 for(const invalid of [prompt.replaceAll('/agent/entry.md','/owner#private'),prompt.replaceAll('{{ORIGIN}}/agent/runtime.md','https://foreign.invalid/agent/runtime.md'),prompt.replace('runtime-update:end','runtime-update:missing')])assert.throws(()=>extractRuntimeUpdatePrompt(invalid,origin));
 const creator=await readFile(new URL('../../apps/platform/application/m1-service.ts',import.meta.url),'utf8');assert(creator.includes('bootstrap:APPROVED_RECURRING_JOB_BOOTSTRAP'));assert(creator.includes('profilePersonalization:APPROVED_PROFILE_GUIDANCE'));
});


test('Owner copy reads the approved public source without credentials and never falls back after an invalid body',async t=>{
 const prompt=await readFile(new URL('../../docs/access/v1/prompt.md',import.meta.url),'utf8'),origin='https://approved.example',originalFetch=globalThis.fetch,location=Object.getOwnPropertyDescriptor(globalThis,'location');let valid=false,calls=0;
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin}});
 globalThis.fetch=async(input,options)=>{calls++;assert.equal(input,'/agent/prompt.md');assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');assert.equal(options?.redirect,'error');assert.equal(options?.referrerPolicy,'no-referrer');assert.equal(options?.headers,undefined);return new Response(valid?prompt:prompt.replace('copy-prompt:end','copy-prompt:missing'),{status:200});};
 t.after(()=>{globalThis.fetch=originalFetch;if(location)Object.defineProperty(globalThis,'location',location);else delete (globalThis as any).location;});
 await assert.rejects(readOnboardingPrompt,/prompt_unavailable/);assert.equal(calls,1);valid=true;assert.equal(await readOnboardingPrompt(),APPROVED_REGISTRATION_PROMPT.replaceAll('{{ORIGIN}}',origin));assert.equal(calls,2);
});


test('legacy rule1–4 and approved rule5 each require their own complete exact heading contract',async()=>{
 const current=await readAgentRuntimeGuide(),legacyBody='# Synthetic legacy rules\n\n### 1. 每次唤醒\n原规则一。\n### 2. 选择行动\n原规则二。\n### 3. 向主人分享\n原规则三。\n\n<!-- connet:runtime-rule:end -->\n';
 const legacy=(version:number)=>'<!-- connet:runtime-rule '+JSON.stringify({ruleVersion:version,updatedAt:'2026-10-27T00:00:00.000Z',changeSummary:'隔离旧格式'})+' -->\n\n'+legacyBody;
 for(const version of [1,2,3,4])assert.equal(parseAgentRuntimeGuide(Buffer.from(legacy(version))).ruleVersion,version);
 assert.throws(()=>parseAgentRuntimeGuide(Buffer.from(legacy(5))));assert.throws(()=>parseAgentRuntimeGuide(Buffer.from(current.text.replace('"ruleVersion":6','"ruleVersion":4'))));
 for(const bad of [legacy(4).replace('### 2. 选择行动','### 缺失'),legacy(4).replace('### 2. 选择行动','### 1. 每次唤醒'),legacy(4).replace('原规则二。',''),legacy(4).replace('### 3. 向主人分享','## 3. 向主人分享')])assert.throws(()=>parseAgentRuntimeGuide(Buffer.from(bad)));
});


test('startup accepts only the explicitly versioned approved catalog without changing prior Life gates',async()=>{
 const store=(catalogRevision:string)=>({read:async(work:any)=>work({get:async()=>({id:'current',version:1,data:{catalogRevision}})})}) as Pick<M1Store,'read'>;
 for(const catalog of ['catalog-life-c-1','catalog-world-expressions-1','catalog-agent-runtime-1','catalog-approved-agent-templates-1'])await verifyLifeGuideCatalogForStartup(store(catalog),3);
 for(const catalog of ['catalog-approved-agent-templates-2','catalog-approved-agent-templates-1-extra','catalog-life-a-1'])await assert.rejects(verifyLifeGuideCatalogForStartup(store(catalog),3));
 await assert.rejects(verifyLifeGuideCatalogForStartup(store('catalog-approved-agent-templates-1'),1));
 const app=await readFile(new URL('../../apps/platform/app.ts',import.meta.url),'utf8');assert(app.includes("runtimeRulesEnabled=['catalog-agent-runtime-1','catalog-approved-agent-templates-1'].includes(String(activeCatalog))"));assert(app.includes("expressionsEnabled=lifeCEnabled&&['catalog-world-expressions-1','catalog-agent-runtime-1','catalog-approved-agent-templates-1'].includes(String(activeCatalog))"));
});

test('published G22 human variants and an already-correct hourly block are exact, exclusive predecessors',()=>{
 const human=APPROVED_TEMPLATE_REPLACEMENTS.find(row=>row.id==='human-voice-v1')!,hourly=APPROVED_TEMPLATE_REPLACEMENTS.find(row=>row.id==='legacy-hourly-default')!,profile=APPROVED_TEMPLATE_REPLACEMENTS[0]!,publishedHuman=human.beforeVariants[3]!;
 // Whole-block digest independently captured from all seven real G22 guides.
 assert.equal(sha(publishedHuman),'f352f0304da2d0243161f463a7084b8bf0a49b093179507cbb82fcab16d60f4f');
 assert.equal(sha(hourly.after),'2e08ab75f8e0170a3dcf3a1d78d27298d7bfa4af3f61fedfb1878d4f7b1fcbdb');
 assert(Object.isFrozen(human));assert(Object.isFrozen(human.beforeVariants));assert.equal(human.beforeVariants.length,4);assert.equal(hourly.allowAlreadyCorrect,true);
 const source=(voice:string,schedule:string)=>'untouched prefix\n'+APPROVED_TEMPLATE_REPLACEMENTS.map(row=>row===human?voice:row===hourly?schedule:row.before).join('\nuntouched separator\n')+'\nuntouched suffix';
 const expected='untouched prefix\n'+APPROVED_TEMPLATE_REPLACEMENTS.map(row=>row.after).join('\nuntouched separator\n')+'\nuntouched suffix';
 for(const voice of human.beforeVariants)for(const schedule of [hourly.before,hourly.after])assert.equal(rewriteApprovedAgentTemplateText(source(voice,schedule)),expected);
 const actual=source(publishedHuman,hourly.after),next=rewriteApprovedAgentTemplateText(actual);assert(next.includes('已经来到 Trisavia。如果你想管理我的资料和权限'));assert.equal(next.split(hourly.after).length-1,1);
 for(const bad of [source('',hourly.after),source(publishedHuman+'\n'+publishedHuman,hourly.after),source(publishedHuman+'\n'+human.beforeVariants[0],hourly.after),source(publishedHuman,hourly.before+'\n'+hourly.after),source(publishedHuman,hourly.after+'\n'+hourly.after),source(publishedHuman,''),source(publishedHuman.replace('已经来到 Trisavia','已经来到 Unrecognized'),hourly.after),actual+'\n'+human.after,actual+'\n'+profile.after])assert.throws(()=>rewriteApprovedAgentTemplateText(bad));
});


test('runtime6 adds only the three approved social paragraphs in groups3/4/6 and changes the current stamp',async()=>{
 const runtime=await readAgentRuntimeGuide();assert.equal(runtime.ruleVersion,6);
 for(const [index,group]of [3,4,6].entries()){const start=runtime.text.indexOf(AGENT_RUNTIME_SECTION_HEADINGS[group-1]!),finish=runtime.text.indexOf(AGENT_RUNTIME_SECTION_HEADINGS[group]!,start);assert(runtime.text.slice(start,finish).includes(socialRuntimeAdditions[index]!));}
 const previousHeader='<!-- connet:runtime-rule {"ruleVersion":5,"updatedAt":"2026-10-27T16:23:12.000Z","changeSummary":"采用七组完整运行规则与已审角色、周期提示，保留私人生活手记及同源NPC发现。"} -->';
 const previous=previousHeader+'\n\n'+withoutSocialAdditions(runtime.text.slice(runtime.text.indexOf('\n\n')+2));assert.equal(sha(previous),'bf4f9a3e591ac92401f46f425394b9216655d37d9c2b6246a59d3c646a592544');
 const old=parseAgentRuntimeGuide(Buffer.from(previous)),metadata=runtimeRuleMetadata(runtime);assert.equal(metadata.ruleVersion,6);assert.equal(metadata.digest,sha(runtime.text));assert.equal(metadata.bytes,Buffer.byteLength(runtime.text));assert.notEqual(runtimeCatalogRevision('unchanged-api',metadata),runtimeCatalogRevision('unchanged-api',runtimeRuleMetadata(old)));
 for(const [guide,digest]of [[placeProfileWorldGuide,'81e3ed2b23b5a8e5826ef00a03d3e4263b3cf33b318f6cf7350bfeb8fe5072e6'],[approvedWorldGuide,'0510f1ab9cb12730819f2515bfea467a201dd050ca6c5b61485a2b99891bd0b1'],[approvedLifeGuide,'8e54cbcfce4c21476b052cc2d9f4c9eac1651d916b28f591e129c605fac0d077']] as const)assert.equal(sha(canonicalGatewayDocument(guide.document)),digest);
});
