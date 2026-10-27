import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {Ajv} from 'ajv';
import {behaviorCLifeOperations,behaviorCLifeReads} from '../../apps/platform/application/agent-gateway-life-c-projections.ts';
import {withJournalOperations,withJournalReads} from '../../apps/platform/application/agent-gateway-journal.ts';
import {npcCareBehaviorGuide,withNpcCareBehaviorOperations,withNpcCareBehaviorReads} from '../../apps/platform/application/agent-gateway-npc-care-behavior.ts';
import {residentJournalGatewayGuide,residentJournalGatewayOperations,withResidentJournalHistory} from '../../apps/platform/application/agent-gateway-resident-journal.ts';
import {canonicalGatewayDocument,gatewayOperationSchemas} from '../../apps/platform/application/agent-gateway.ts';
// @ts-expect-error Pure browser projection, exercised without a credential or DOM.
import {readAuthoredJournal,readBehaviorLogs} from '../../apps/web/public/hud/behavior-log-reader.js';
import {readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
const stub=new Proxy({}, {get:()=>async()=>({})}) as any;
const previous=()=>withNpcCareBehaviorOperations(withJournalOperations(behaviorCLifeOperations(stub))).find(operation=>operation.id==='behavior.owner_history')!;
const authored={kind:'agent_life_statement',version:1,clientEntryId:'fixture-entry-1',title:null,text:'今天在花圃浇了水。\n我有点期待下次回来看看。',sourceRefs:[{recordId:'a'.repeat(64)}],submittedAt:1000};
function page(){return{protocolVersion:1,data:{worldId:'default',agentId:'fixture-agent',timeZone:'UTC',items:[{id:'b'.repeat(64),agent:{agentId:'fixture-agent',displayName:'隔离角色',publicId:null,publishedVersion:null,appearance:null},title:'生活自述',action:'记录生活',result:'本人生活自述',occurredAt:1000,date:'2026-10-27',time:'12:00',source:{domain:'life',node:'life.journal.authored',detail:null,label:'生活自述'},details:null,authored:structuredClone(authored)}],historyCoverage:{from:0,to:1000,complete:true,gaps:[]},partial:false,nextPageToken:null,asOf:1000}};}

test('journal descriptors preserve the prior exact Owner and all public schemas',()=>{
 const old=previous(),before=canonicalGatewayDocument(old.output),[current]=withResidentJournalHistory([old]),ops=residentJournalGatewayOperations(stub,current!),ajv=new Ajv({strict:false});
 assert.equal(old.schemaVersion,8);assert.equal(current!.schemaVersion,9);assert.equal(canonicalGatewayDocument(old.output),before);
 const history=ops.find(operation=>operation.id==='behavior.journal.history')!,submit=ops.find(operation=>operation.id==='behavior.journal.submit')!;
 assert.deepEqual(submit.actors,['agent']);assert.deepEqual(history.actors,['agent']);
 for(const operation of ops){assert(!ajv.compile(operation.input)({text:'真实自述',agentId:'another-agent'}));assert(!Object.hasOwn((operation.input.properties as any),'agentId'));}
 assert(ajv.compile(submit.input)({clientEntryId:authored.clientEntryId,expectedAudienceRef:null,text:authored.text,sourceRefs:authored.sourceRefs}));assert(!ajv.compile(submit.input)({text:'正文',thoughts:'private reasoning'}));assert(!ajv.compile(submit.input)({text:'正文',sourceRefs:[{recordId:'invented'}]}));
 const validate=ajv.compile(current!.output);assert(validate(page().data),JSON.stringify(validate.errors));assert(!ajv.compile(old.output)(page().data));
 for(const read of withNpcCareBehaviorReads(withJournalReads(behaviorCLifeReads(stub)))){assert.equal(read.schemaVersion,8);assert(!ajv.compile(read.output)(page().data),'The public exact shape cannot transport authored content');}
 assert.deepEqual(gatewayOperationSchemas(old).map(row=>row.version),[8,8]);
 assert.equal(createHash('sha256').update(canonicalGatewayDocument(npcCareBehaviorGuide.document)).digest('hex'),'e5e82b1091961298cb399a0a26e42dac9e4dbca82bbd0d49ae985eed0de3e282');
 assert.equal(residentJournalGatewayGuide.version,10);
});

test('private strict reader keeps final prose distinct and refuses public or malformed authored bodies',()=>{
 assert.deepEqual(readBehaviorLogs(page(),{mode:'owner',agentId:'fixture-agent',timeZone:'UTC'}).items[0].authored,authored);
 for(const mode of ['world','recent']){const input=page();if(mode==='world')input.data.agentId=null as any;assert.throws(()=>readBehaviorLogs(input,{mode,agentId:'fixture-agent',timeZone:'UTC'}));}
 for(const patch of [{kind:'authoritative_result'},{text:'x'.repeat(4001)},{text:'bad\rline'},{text:'\ud800'},{text:' '},{sourceRefs:[{recordId:'a'.repeat(64)},{recordId:'a'.repeat(64)}]},{sourceRefs:[{recordId:'b'.repeat(64),privateBody:'hidden'}]},{submittedAt:999}]){
  const input=page();Object.assign(input.data.items[0]!.authored,patch);assert.throws(()=>readBehaviorLogs(input,{mode:'owner',agentId:'fixture-agent',timeZone:'UTC'}));
 }
 const noBody=page();delete (noBody.data.items[0] as any).authored;assert.throws(()=>readBehaviorLogs(noBody,{mode:'owner',agentId:'fixture-agent',timeZone:'UTC'}));
 const wrongSource=page();wrongSource.data.items[0]!.source.node='life.work.completed';assert.throws(()=>readBehaviorLogs(wrongSource,{mode:'owner',agentId:'fixture-agent',timeZone:'UTC'}));
 assert(readAuthoredJournal({...authored,text:'🙂'.repeat(4000)}));
 assert.throws(()=>readAuthoredJournal({...authored,text:'正文',reasoning:'not permitted'}));
});

test('current fixed runtime freshly exposes private final-account guidance without changing jobs',async()=>{
 const current=await readAgentRuntimeGuide();assert.equal(current.ruleVersion,6);assert(current.bytes<=16384);
 assert.match(current.text,/behavior\.journal\.submit/);assert.match(current.text,/behavior\.journal\.history/);
 assert.match(current.text,/同步失败只补日志，不重做业务/);assert.match(current.text,/无值得记录的新内容不强造日志/);
 assert.match(current.text,/服务器保存和宿主送达分别核实/);assert.match(current.text,/不自行改频率/);const block=current.text.slice(current.text.indexOf('个人日志能力实际启用后，'),current.text.indexOf('\n\n当前个人日志的纯文本正文'));assert.equal(createHash('sha256').update(block).digest('hex'),'1112496eced9e2ee6cdac47fa2239f28939ca6b87215e8e137dda09e8bd3afef');
});
