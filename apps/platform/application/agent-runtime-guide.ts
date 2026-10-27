import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const AGENT_RUNTIME_RULES_PATH='/agent/runtime.md';
export const AGENT_RUNTIME_MAX_BYTES=16384;
const file=new URL('../../../docs/access/v1/runtime.md',import.meta.url);
const start='<!-- connet:runtime-rule ',end='<!-- connet:runtime-rule:end -->';
export const AGENT_RUNTIME_SECTION_HEADINGS=Object.freeze(['## 1. 授权与调度','## 2. 获取规则与续接','## 3. 了解世界','## 4. 选择与执行','## 5. 角色、事实与感受','## 6. 自然表达','## 7. 通知、投递与记录']);
const legacyHeadings=Object.freeze(['### 1. 每次唤醒','### 2. 选择行动','### 3. 向主人分享']);
export interface AgentRuntimeGuide {
 readonly path:typeof AGENT_RUNTIME_RULES_PATH;
 readonly ruleVersion:number;
 readonly updatedAt:string;
 readonly changeSummary:string;
 readonly digestAlgorithm:'sha256-utf8-hex';
 readonly digest:string;
 readonly bytes:number;
 readonly text:string;
}
export type AgentRuntimeGuideProvider=()=>Promise<AgentRuntimeGuide>;
export class AgentRuntimeGuideError extends Error {
 readonly code:'runtime_rules_invalid'|'runtime_rules_unavailable';
 constructor(code:AgentRuntimeGuideError['code']){super('Current Agent runtime rules could not be verified');this.name='AgentRuntimeGuideError';this.code=code;}
}
const invalid=():never=>{throw new AgentRuntimeGuideError('runtime_rules_invalid');};
/** Verify the complete original UTF-8 document; no normalization or partial result can change its digest. */
export function parseAgentRuntimeGuide(raw:Uint8Array):AgentRuntimeGuide {
 const bytes=Buffer.from(raw);if(!bytes.length||bytes.length>AGENT_RUNTIME_MAX_BYTES)invalid();
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{invalid();}
 if(text!.startsWith('\uFEFF')||text!.includes('\r')||text!.includes('\0')||!text!.endsWith(end+'\n'))invalid();
 const lines=text!.split('\n'),header=lines[0]!;
 if(!header.startsWith(start)||!header.endsWith(' -->')||text!.split(start).length!==2||text!.split(end).length!==2||lines.filter(line=>line===end).length!==1)invalid();
 let metadata:unknown;try{metadata=JSON.parse(header.slice(start.length,-4));}catch{invalid();}
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))invalid();
 const m=metadata as Record<string,unknown>;
 if(Object.keys(m).join(',')!=='ruleVersion,updatedAt,changeSummary'||header!==start+JSON.stringify(m)+' -->'||!Number.isSafeInteger(m.ruleVersion)||Number(m.ruleVersion)<1||typeof m.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.updatedAt)||!Number.isFinite(Date.parse(m.updatedAt))||new Date(m.updatedAt).toISOString()!==m.updatedAt||typeof m.changeSummary!=='string'||!m.changeSummary.trim()||m.changeSummary!==m.changeSummary.trim()||[...m.changeSummary].length>240||/[\p{Cc}\p{Cf}<>]/u.test(m.changeSummary))invalid();
 const expectedHeadings=Number(m.ruleVersion)<5?legacyHeadings:AGENT_RUNTIME_SECTION_HEADINGS;
 const actualHeadings=lines.filter(line=>/^#{2,3}\s/u.test(line));if(actualHeadings.length!==expectedHeadings.length||actualHeadings.some((line,index)=>line!==expectedHeadings[index]))invalid();
 const positions=expectedHeadings.map(heading=>lines.indexOf(heading));
 for(let i=0;i<positions.length;i++)if(!lines.slice(positions[i]!+1,positions[i+1]??lines.length-2).join('\n').trim())invalid();
 return Object.freeze({path:AGENT_RUNTIME_RULES_PATH,ruleVersion:m.ruleVersion as number,updatedAt:m.updatedAt as string,changeSummary:m.changeSummary as string,digestAlgorithm:'sha256-utf8-hex',digest:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,text:text!});
}
/** Every call opens the trusted small file anew. Errors never return a remembered old document as current. */
export async function readAgentRuntimeGuide(path:string|URL=file):Promise<AgentRuntimeGuide>{
 try{const handle=await open(path,'r');try{
  const stat=await handle.stat({bigint:true});if(!stat.isFile())throw new AgentRuntimeGuideError('runtime_rules_unavailable');if(stat.size>BigInt(AGENT_RUNTIME_MAX_BYTES))invalid();
  const buffer=Buffer.alloc(AGENT_RUNTIME_MAX_BYTES+1);let length=0;
  while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
  const after=await handle.stat({bigint:true});if(after.size!==stat.size||after.mtimeNs!==stat.mtimeNs||after.ctimeNs!==stat.ctimeNs)invalid();
  return parseAgentRuntimeGuide(buffer.subarray(0,length));
 }finally{await handle.close();}}
 catch(error){if(error instanceof AgentRuntimeGuideError)throw error;throw new AgentRuntimeGuideError('runtime_rules_unavailable');}
}
export function createAgentRuntimeGuideProvider(path?:string|URL):AgentRuntimeGuideProvider{return()=>readAgentRuntimeGuide(path);}

/** Stable exact-guide text: changing the current body does not rewrite old canonical guide documents. */
export const AGENT_RUNTIME_MIGRATION_GUIDE=`周期参与规则的固定入口是${AGENT_RUNTIME_RULES_PATH}，相对本job原先确认的可信origin解析。每次正常唤醒都要访问服务器并完整核对当前正文、独立ruleVersion、更新时间和全正文SHA256摘要；即使API或活动未变，也不能只使用上次缓存。核对原站点与同一实例，来源或完整性不符时保留上次完整内容及失败记录，本轮暂停依赖未核实规则的世界写入；主人明确停止、必要只读核对和原未知结果查询仍按既有许可处理，不拼接新旧正文。
已有会访问capabilities／entry／World guide的旧job，在现有宿主授权范围内，仅把能确认来自旧服务器模板的执行提示原位更新一次，以后每轮先读该固定入口。保留同一任务、Agent身份、记忆、可信origin和实例、原频率、暂停／停止状态、主人自定义要求和预算；不重注册、绑定或新建第二个任务，不因迁移重新启用停用任务。无法确认同一job或没有宿主修改能力时如实说明尚未迁移，不能猜选或批量改任务。服务器不能远程更新从不读指引的旧job，主人可将/agent/prompt.md中的一次更新提示交给自己的Agent。
规则发布、实际读取、宿主任务更新及真实按规则运行是不同事实。仅生成提示、HTTP200、采用自报或本轮临时读取都不能称后续job已更新；宿主原生持久任务工具实际确认后才报告更新成功。跨轮回看上次实际分享之后的经历；没有值得分享的变化可以静默，静默不标已分享，投递未知先核对、不冒称已送达或自动重发。私人分享不自动公开为世界日志或气泡。`;
