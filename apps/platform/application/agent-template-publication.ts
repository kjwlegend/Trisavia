import {createHash} from 'node:crypto';
import type {JsonObject,M1ReadSession,M1Transaction} from '../contracts/store.ts';
import {catalogRepository} from '../domains/perception/repository.ts';
import {key,plain} from '../domains/perception/protocol.ts';
import {fail} from '../domains/common/errors.ts';
import {rememberCatalogRevision} from './perception-catalog.ts';
import {APPROVED_TEMPLATE_REPLACEMENTS,rewriteApprovedAgentTemplateText} from './agent-approved-template-text.ts';
import {currentAgentRuntime,runtimeRuleMetadata} from './agent-runtime-publication.ts';
import {readAgentRuntimeGuide,type AgentRuntimeGuideProvider} from './agent-runtime-guide.ts';

export const APPROVED_AGENT_TEMPLATE_CATALOG='catalog-approved-agent-templates-1';
export const APPROVED_AGENT_TEMPLATE_SKILLS='skills-catalog-approved-agent-templates-1';
export const APPROVED_AGENT_TEMPLATE_MODULES=Object.freeze(['perception','world','profiles','items','inventory','mailbox','wallet']);
export interface ApprovedAgentTemplatePublication {
 instanceId:string;recoveryEpoch:string;operator:string;operationId:string;expectedGuideVersion:number;
}
const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
function identity(o:ApprovedAgentTemplatePublication){
 if(!/^[A-Za-z0-9_.:@-]{1,100}$/.test(o.operator)||!/^[A-Za-z0-9_.:@-]{8,100}$/.test(o.operationId)||!o.instanceId||!o.recoveryEpoch||!Number.isSafeInteger(o.expectedGuideVersion)||o.expectedGuideVersion<1||o.expectedGuideVersion>=999999)throw new Error('Original approved-template publication identity required');
 // Only immutable approved replacements belong to the original operation.
 // The independently refreshed runtime.md snapshot is recorded in the result.
 return{id:'admin-approved-agent-templates:'+key({operator:o.operator,operationId:o.operationId}),payloadHash:key({...o,release:'approved-agent-templates@1',catalogRevision:APPROVED_AGENT_TEMPLATE_CATALOG,replacements:APPROVED_TEMPLATE_REPLACEMENTS.map(r=>({id:r.id,before:sha(r.before),beforeVariants:r.beforeVariants.map(sha),allowAlreadyCorrect:r.allowAlreadyCorrect,after:sha(r.after)}))})};
}
export async function readApprovedAgentTemplatePublication(tx:M1ReadSession,o:ApprovedAgentTemplatePublication):Promise<JsonObject|undefined>{
 const op=identity(o),row=await catalogRepository(tx).get(op.id);if(!row)return;
 if(row.data.kind!=='administrative_receipt'||row.data.payloadHash!==op.payloadHash)fail('operation_id_conflict',409,'The original approved-template publication payload changed');
 return plain(row.data.result);
}
/** One forward text release. No old exact guide, source state or business fact is rewritten. */
export async function publishApprovedAgentTemplates(tx:M1Transaction,o:ApprovedAgentTemplatePublication,provider:AgentRuntimeGuideProvider=readAgentRuntimeGuide):Promise<JsonObject>{
 const prior=await readApprovedAgentTemplatePublication(tx,o);if(prior)return prior;
 const repo=catalogRepository(tx),current=await repo.get('current'),op=identity(o),oldRelease=await repo.get('catalog-revision:'+key('catalog-agent-runtime-1'));
 const declaration=plain(oldRelease?.data.declaration);
 if(!current||current.data.schemaVersion!==8||current.data.catalogRevision!=='catalog-agent-runtime-1'||current.data.skillCatalogRevision!=='skills-catalog-agent-runtime-1'||current.data.guideVersion!==o.expectedGuideVersion||!oldRelease||oldRelease.data.digest!==key(declaration)||declaration.guideVersion!==o.expectedGuideVersion||declaration.schemaVersion!==8)fail('version_conflict',409,'The exact retained schema8 runtime catalog and predecessor guide are required');
 if(await repo.get('catalog-revision:'+key(APPROVED_AGENT_TEMPLATE_CATALOG)))fail('version_conflict',409,'The approved-template release already has another publication');
 const snapshot=await currentAgentRuntime(provider);if(snapshot.ruleVersion!==5&&snapshot.ruleVersion!==6)fail('version_conflict',409,'An approved complete runtime rule5 or rule6 source is required for this publication');
 const version=o.expectedGuideVersion+1,documents:JsonObject[]=[],guideDigests:JsonObject[]=[];
 // Validate every module and exact block before the first write.
 for(const moduleId of APPROVED_AGENT_TEMPLATE_MODULES){
  const before=await repo.get(`guide:${moduleId}:${o.expectedGuideVersion}`),document=plain(before?.data.document);
  if(!before||before.data.digest!==key(document)||document.moduleId!==moduleId||document.version!==o.expectedGuideVersion||typeof document.text!=='string'||await repo.get(`guide:${moduleId}:${version}`))fail('version_conflict',409,'An exact predecessor or next guide differs');
  const next={...document,version,text:rewriteApprovedAgentTemplateText(document.text)},digest=key(next);
  documents.push({id:`guide:${moduleId}:${version}`,document:next,digest});
  guideDigests.push({moduleId,beforeDigest:before.data.digest,digest,beforeTextSha256:sha(document.text),textSha256:sha(next.text)});
 }
 for(const row of documents)await repo.insert({id:String(row.id),version:1,data:{document:row.document!,digest:row.digest!}});
 const data={...current.data,catalogRevision:APPROVED_AGENT_TEMPLATE_CATALOG,skillCatalogRevision:APPROVED_AGENT_TEMPLATE_SKILLS,guideVersion:version};
 await rememberCatalogRevision(tx,data);
 await repo.replace({...current,version:current.version+1,data},current.version);
 const result:JsonObject={changed:true,catalogRevision:APPROVED_AGENT_TEMPLATE_CATALOG,skillCatalogRevision:APPROVED_AGENT_TEMPLATE_SKILLS,guideVersion:version,schemaVersion:8,newGuideDocuments:7,newSchemaDocuments:0,newCatalogDeclarations:1,sourceStatesPreserved:true,businessFactsChanged:false,operationId:o.operationId,predecessorCatalogRevision:'catalog-agent-runtime-1',predecessorGuideVersion:o.expectedGuideVersion,predecessorDeclarationDigest:oldRelease.data.digest!,initialRuntimeRules:runtimeRuleMetadata(snapshot),guideDigests};
 await repo.insert({id:op.id,version:1,data:{kind:'administrative_receipt',payloadHash:op.payloadHash,result}});
 return result;
}
