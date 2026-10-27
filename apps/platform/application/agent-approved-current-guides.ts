import type {JsonObject} from '../contracts/store.ts';
import type {GatewayGuide,GatewayOperation,GatewayPublicRead} from './agent-gateway.ts';
import {residentWorldGuide} from './agent-gateway-npc-identities.ts';
import {npcCareLifeGuide} from './agent-gateway-npc-care-life.ts';
import {APPROVED_PROFILE_RULES,APPROVED_RECURRING_JOB_BOOTSTRAP,APPROVED_RUNTIME_HOST_GUIDE,APPROVED_HUMAN_COMMUNICATION} from './agent-approved-prompts.ts';
import {fail} from '../domains/common/errors.ts';

const runtime='每次正常唤醒从原可信origin读取/agent/runtime.md完整最新正文，核对同实例、当前ruleVersion、更新时间、全UTF-8正文digest和唯一结束标记，通读后整份采用。不能只下载或比较hash，也不能因API未变而跳过。失败保留原完整内容，暂停依赖未核实规则的新世界写入；停止、必要只读和原未知结果查询仍按原许可。通用角色、生活选择和自然表达以当前完整规则为准，不沿历史精确指南的旧句数或旧资料准备模板覆盖当前规则。';
/** Append-only exact versions. All prior World23/Life5 objects remain unchanged. */
export const approvedWorldGuide:GatewayGuide={...residentWorldGuide,version:24,document:{...residentWorldGuide.document,version:24,
 runtimeRules:runtime,hostParticipation:APPROVED_RUNTIME_HOST_GUIDE,profilePersonalization:APPROVED_PROFILE_RULES,
 humanCommunication:{...(residentWorldGuide.document.humanCommunication as JsonObject),instruction:APPROVED_HUMAN_COMMUNICATION,continuity:'续接自己的角色设定、真实经历、感受和未完打算。想象身世与当前世界真实事实分开保存；普通唤醒不重塑资料。完整运行规则每轮实时读取。'},
}};
export const approvedLifeGuide:GatewayGuide={...npcCareLifeGuide,version:6,document:{...npcCareLifeGuide.document,version:6,human:APPROVED_HUMAN_COMMUNICATION,continuity:runtime,recurringBootstrap:APPROVED_RECURRING_JOB_BOOTSTRAP}};
export const APPROVED_LIFE_ACTION_IDS=new Set(['life.actions','life.public_actions']);
function schema(source:JsonObject):JsonObject {
 const walk=(value:any):any=>{if(Array.isArray(value))return value.map(walk);if(!value||typeof value!=='object')return value;const next=Object.fromEntries(Object.entries(value).map(([key,v])=>[key,walk(v)])) as any,p=next.properties;
  if(p?.moduleId?.const==='life'&&p?.version?.const===5)p.version={const:6};return next;
 };return walk(source);
}
function project(source:JsonObject):JsonObject {
 if(!Array.isArray(source.actions))fail('source_unavailable',503,'Exact current Life actions are required');
 return{...source,actions:source.actions.map(value=>{const row=value as JsonObject,ref=row.guideRef as JsonObject;if(ref?.moduleId==='npc_life')return row;if(ref?.moduleId!=='life'||ref.version!==5)fail('source_unavailable',503,'Exact prior Life5 action guidance is required');return{...row,guideRef:{...ref,version:6}};})};
}
export const withApprovedLifeOperations=(operations:GatewayOperation[]):GatewayOperation[]=>operations.map(operation=>operation.id!=='life.actions'?operation:{...operation,schemaVersion:6,output:schema(operation.output),query:async(ctx,p,input)=>project(await operation.query!(ctx,p,input))});
export const withApprovedLifeReads=(reads:GatewayPublicRead[]):GatewayPublicRead[]=>reads.map(read=>read.id!=='life.public_actions'?read:{...read,schemaVersion:6,output:schema(read.output),read:async(ctx,input)=>project(await read.read(ctx,input))});
