import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {M1_TABLES,type M1Table,type M1Transaction,type StoredRow,type JsonObject} from '../../apps/platform/contracts/store.ts';
import {key} from '../../apps/platform/domains/perception/protocol.ts';
import {rememberCatalogRevision,catalogData} from '../../apps/platform/application/perception-catalog.ts';
import {APPROVED_TEMPLATE_REPLACEMENTS,rewriteApprovedAgentTemplateText} from '../../apps/platform/application/agent-approved-template-text.ts';
import {AGENT_RUNTIME_MIGRATION_GUIDE,readAgentRuntimeGuide} from '../../apps/platform/application/agent-runtime-guide.ts';
import {publishApprovedAgentTemplates,readApprovedAgentTemplatePublication,APPROVED_AGENT_TEMPLATE_MODULES,APPROVED_AGENT_TEMPLATE_CATALOG} from '../../apps/platform/application/agent-template-publication.ts';

const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
async function fixture(){
 const tables=new Map<M1Table,Map<string,StoredRow>>(M1_TABLES.map(table=>[table,new Map()]));
 const tx={async count(table:M1Table,filter:Record<string,unknown>,limit:number){return Math.min(limit,[...tables.get(table)!.values()].filter(row=>Object.entries(filter).every(([name,value])=>row.data[name]===value)).length);},async get(table:M1Table,id:string){return structuredClone(tables.get(table)!.get(id));},async insert(table:M1Table,row:StoredRow){assert(!tables.get(table)!.has(row.id));tables.get(table)!.set(row.id,structuredClone(row));},async update(table:M1Table,row:StoredRow,expected:number){assert.equal(tables.get(table)!.get(row.id)?.version,expected);tables.get(table)!.set(row.id,structuredClone(row));return true;}} as unknown as M1Transaction;
 const current={schemaVersion:8,guideVersion:22,catalogRevision:'catalog-agent-runtime-1',skillCatalogRevision:'skills-catalog-agent-runtime-1',sourceStates:{'npc-service-items':'enabled',untouched:'not_enabled'},seedObjectIds:['preserved-seed-ref']};
 const source='unchanged source and permissions\n'+APPROVED_TEMPLATE_REPLACEMENTS.map(row=>row.before).join('\nunchanged protocol block\n')+'\n'+AGENT_RUNTIME_MIGRATION_GUIDE+'\nunchanged recovery';
 await tx.insert('perception_catalog',{id:'current',version:9,data:current});
 for(const moduleId of APPROVED_AGENT_TEMPLATE_MODULES){const document={moduleId,version:22,text:source,execution:'host',automaticExecution:false,unrelated:{scope:'preserved'}};await tx.insert('perception_catalog',{id:`guide:${moduleId}:22`,version:1,data:{document,digest:key(document)}});}
 await rememberCatalogRevision(tx,current);
 await tx.insert('perception_catalog',{id:'admin-agent-runtime:retained-original-receipt',version:1,data:{kind:'administrative_receipt',payloadHash:'0'.repeat(64),result:{guideVersion:22,immutable:'original 071 payload and result'}}});
 const options={instanceId:'fixture-template-instance',recoveryEpoch:'fixture-template-epoch',operator:'test:approved-agent',operationId:'approved-agent-original-operation',expectedGuideVersion:22};
 return{tables,tx,current,source,options};
}

test('approved seven-guide publication appends a distinct declaration and changes only the four approved text blocks',async()=>{
 const f=await fixture(),before=structuredClone(f.tables);assert.equal(await readApprovedAgentTemplatePublication(f.tx,f.options),undefined);
 const result=await publishApprovedAgentTemplates(f.tx,f.options);assert.equal(result.guideVersion,23);assert.equal(result.newGuideDocuments,7);assert.equal(result.newSchemaDocuments,0);assert.equal((result.initialRuntimeRules as JsonObject).ruleVersion,5);
 for(const[id,row]of before.get('perception_catalog')!)if(id!=='current')assert.deepEqual(await f.tx.get('perception_catalog',id),row);
 assert.deepEqual((await f.tx.get('perception_catalog','current'))!,{id:'current',version:10,data:{...f.current,guideVersion:23,catalogRevision:APPROVED_AGENT_TEMPLATE_CATALOG,skillCatalogRevision:'skills-'+APPROVED_AGENT_TEMPLATE_CATALOG}});
 const digests=result.guideDigests as JsonObject[];assert.equal(digests.length,7);
 for(const moduleId of APPROVED_AGENT_TEMPLATE_MODULES){const old=(await f.tx.get('perception_catalog',`guide:${moduleId}:22`))!,next=(await f.tx.get('perception_catalog',`guide:${moduleId}:23`))!,document=old.data.document as JsonObject;assert.deepEqual(next.data.document,{...document,version:23,text:rewriteApprovedAgentTemplateText(f.source)});assert.equal(next.data.digest,key(next.data.document));assert.deepEqual(digests.find(row=>row.moduleId===moduleId),{moduleId,beforeDigest:old.data.digest,digest:next.data.digest,beforeTextSha256:sha(f.source),textSha256:sha(rewriteApprovedAgentTemplateText(f.source))});}
 const oldDeclaration=(await f.tx.get('perception_catalog','catalog-revision:'+key('catalog-agent-runtime-1')))!,nextDeclaration=(await f.tx.get('perception_catalog','catalog-revision:'+key(APPROVED_AGENT_TEMPLATE_CATALOG)))!;assert.equal((oldDeclaration.data.declaration as JsonObject).guideVersion,22);assert.equal((nextDeclaration.data.declaration as JsonObject).guideVersion,23);
 const discovery=await catalogData(f.tx);assert.equal(discovery.catalogRevision,APPROVED_AGENT_TEMPLATE_CATALOG);assert.equal(f.tables.get('perception_catalog')!.size,before.get('perception_catalog')!.size+9);
});

test('every exact predecessor block is checked before any write; missing, duplicate, corrupt and occupied next documents fail closed',async()=>{
 for(const mode of ['missing','duplicate','bad-digest','next-occupied'] as const){
  const f=await fixture(),id='guide:wallet:22',row=(await f.tx.get('perception_catalog',id))!,document=row.data.document as JsonObject;
  if(mode==='next-occupied')await f.tx.insert('perception_catalog',{id:'guide:wallet:23',version:1,data:{document:{moduleId:'wallet',version:23,text:'another release'},digest:'0'.repeat(64)}});
  else{const changed:JsonObject={...document,text:mode==='missing'?String(document.text).replace(APPROVED_TEMPLATE_REPLACEMENTS[0]!.before,''):mode==='duplicate'?String(document.text)+'\n'+APPROVED_TEMPLATE_REPLACEMENTS[0]!.before:document.text!};await f.tx.update('perception_catalog',{...row,data:{document:changed,digest:mode==='bad-digest'?'0'.repeat(64):key(changed)}},row.version);}
  const before=structuredClone(f.tables);await assert.rejects(publishApprovedAgentTemplates(f.tx,f.options));assert.deepEqual(f.tables,before,mode);
 }
});

test('original publication and receipt replay use frozen payload and result even if later runtime prose is unavailable',async()=>{
 const f=await fixture(),first=await publishApprovedAgentTemplates(f.tx,f.options),before=structuredClone(f.tables),unavailable=async()=>{throw Error('Later mutable runtime file is unavailable');};
 assert.deepEqual(await publishApprovedAgentTemplates(f.tx,f.options,unavailable),first);assert.deepEqual(await readApprovedAgentTemplatePublication(f.tx,f.options),first);assert.deepEqual(f.tables,before);
 await assert.rejects(readApprovedAgentTemplatePublication(f.tx,{...f.options,expectedGuideVersion:23}),{code:'operation_id_conflict'});assert.deepEqual(f.tables,before);
 const newKey={...f.options,operationId:'another-original-operation'};await assert.rejects(publishApprovedAgentTemplates(f.tx,newKey),{code:'version_conflict'});
});

test('a first publication requires the complete approved current runtime5 snapshot without advancing old source metadata',async()=>{
 const f=await fixture(),before=structuredClone(f.tables),snapshot=await readAgentRuntimeGuide();await assert.rejects(publishApprovedAgentTemplates(f.tx,f.options,async()=>({...snapshot,ruleVersion:4})),{code:'version_conflict'});assert.deepEqual(f.tables,before);
});
