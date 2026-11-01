import assert from 'node:assert/strict';
import test from 'node:test';
import {Ajv} from 'ajv';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';
import type {GatewayOperation,GatewayPublicRead} from '../../apps/platform/application/agent-gateway.ts';
import {createAgentGateway,gatewayOperationSchemas,gatewayPublicReadSchemas} from '../../apps/platform/application/agent-gateway.ts';
import {hashRuntimeRequest} from '../../apps/platform/domains/runtime/command.ts';
import {manualParticipationGuide,manualParticipationLifeOperations,manualParticipationLifeReads} from '../../apps/platform/application/agent-manual-participation.ts';
import {placeProfileWorldGuide} from '../../apps/platform/application/agent-gateway-place-profile-guide.ts';
import {approvedWorldGuide,approvedLifeGuide,APPROVED_LIFE_ACTION_IDS,withApprovedLifeOperations,withApprovedLifeReads} from '../../apps/platform/application/agent-approved-current-guides.ts';
import {interactionGatewayGuide} from '../../apps/platform/application/agent-gateway-interaction.ts';
import {decisionGatewayGuide} from '../../apps/platform/application/agent-gateway-decision.ts';
import {relationshipsGatewayGuide} from '../../apps/platform/application/agent-gateway-relationships.ts';
import {PARTICIPATION_MODE_GUIDE,PARTICIPATION_LIFE_AUTHORIZATION,PARTICIPATION_LIFE_INTENT_OPENING} from '../../apps/platform/application/agent-participation-guide.ts';
import {coreFixture} from '../world/runtime-fixture.ts';
import {residentDescriptorFixture} from './npc-identity-access.test.ts';
import {residentJournalGatewayGuide} from '../../apps/platform/application/agent-gateway-resident-journal.ts';
import {residentWorldGuide,residentTownGuide,residentNpcLifeGuide} from '../../apps/platform/application/agent-gateway-npc-identities.ts';
import {npcCareLifeGuide} from '../../apps/platform/application/agent-gateway-npc-care-life.ts';
import {runtimeWorldGuide} from '../../apps/platform/application/agent-runtime-publication.ts';
import {placeProfileGatewayOperations,placeProfilePublicReads} from '../../apps/platform/application/agent-gateway-place-profiles.ts';
import {createPublishedWorldPlaceProfilesService} from '../../apps/platform/application/world-place-profiles-source.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {currentNpcIdentity} from '../../apps/platform/domains/town-services/npc-identity.ts';

const previous=[placeProfileWorldGuide,approvedLifeGuide,interactionGatewayGuide,decisionGatewayGuide,relationshipsGatewayGuide];
const digests=[
 '273766207ad520a08594961e36959ad6afd266460f30a3947b47b8e5b86ea675',
 '8e54cbcfce4c21476b052cc2d9f4c9eac1651d916b28f591e129c605fac0d077',
 '173d91e725d83b8e86945ab7c4a17d1f8a62c201a652d356b8180a8c98edac01',
 '8a4d85e358f8554f66838946ec5576ebcff02028dadc5b094a1514dc8c9e0b62',
 '18829cd7cb21765b2d9a127e76d741773843a3a709659b7116ac3112dcad5941',
];
test('current compiled guides distinguish manual scheduling while every previous exact document remains unchanged and readable',()=>{
 const f=coreFixture(),before=structuredClone(previous),guides=previous.map(manualParticipationGuide);
 const operations:GatewayOperation[]=previous.map(guide=>({id:guide.moduleId+'.synthetic_read',moduleId:guide.moduleId,schemaVersion:1,kind:'query',actors:['agent'],description:'Synthetic registry-only read',input:{type:'object'},output:{type:'object'},query:async()=>({})}));
 const old=createAgentGateway({store:f.store,identity:f.identity,operations,guides:previous}),current=createAgentGateway({store:f.store,identity:f.identity,operations,guides,retainedGuides:previous});
 assert.notEqual(current.catalogRevision,old.catalogRevision);
 assert.deepEqual(guides.map(guide=>[guide.moduleId,guide.version]),[['world',26],['life',7],['interaction',5],['decision',3],['relationships',6]]);
 previous.forEach((guide,index)=>{
  assert.equal(hashRuntimeRequest(guide.document),digests[index]);
  assert.deepEqual(current.guide(guide.moduleId,String(guide.version)),old.guide(guide.moduleId,String(guide.version)));
  const next=current.guide(guide.moduleId,String(guide.version+1));assert.notEqual(next.digest,digests[index]);assert.equal(hashRuntimeRequest(next.document),next.digest);
  assert.deepEqual(next.document.participationPolicy,{version:2,modes:['autonomous','manual','observe'],legacyReadOnlyMode:'observe',schedulingVersion:1,adoptionPolicyVersionField:'expectedPolicyVersion',serverControlsJob:false});
  const instruction=next.document.autonomousParticipation;
  assert.equal(typeof instruction==='string'?instruction:(instruction as JsonObject).instruction,PARTICIPATION_MODE_GUIDE);
 });
 assert.deepEqual(previous,before);
 const world=guides[0]!.document,life=guides[1]!.document;
 assert.equal(((world.life as JsonObject).autonomousParticipation as string).startsWith(PARTICIPATION_LIFE_INTENT_OPENING),true);
 assert.equal(life.authorization,PARTICIPATION_LIFE_AUTHORIZATION);
 const untouched={moduleId:'future',version:1,document:{version:1}};assert.equal(manualParticipationGuide(untouched),untouched,'Unknown modules gain no policy or permission');
});

test('Life action directory references and exact output schemas advance together, preserve other modules, and retain predecessor bytes',async()=>{
 const f=coreFixture(),input:JsonObject={type:'object'},ref:JsonObject={type:'object',additionalProperties:false,required:['moduleId','version'],properties:{moduleId:{const:'life'},version:{const:6}}};
 const output:JsonObject={type:'object',additionalProperties:false,required:['actions'],properties:{actions:{type:'array',items:{type:'object',additionalProperties:false,required:['guideRef'],properties:{guideRef:{anyOf:[ref,{type:'object',additionalProperties:false,required:['moduleId','version'],properties:{moduleId:{const:'npc_life'},version:{const:1}}}]}}}}}};
 const source:JsonObject={actions:[{guideRef:{moduleId:'life',version:6}},{guideRef:{moduleId:'npc_life',version:1}}]},before=structuredClone(source);
 const op:GatewayOperation={id:'life.actions',moduleId:'life',schemaVersion:6,kind:'query',actors:['agent'],description:'Synthetic exact directory',input,output,query:async()=>source};
 const read:GatewayPublicRead={id:'life.public_actions',moduleId:'life',schemaVersion:6,path:'/v1/life/actions',description:op.description,input,output,read:async()=>source};
 const operations=manualParticipationLifeOperations([op],6),reads=manualParticipationLifeReads([read],6),current=createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[manualParticipationGuide(approvedLifeGuide)],retainedGuides:[approvedLifeGuide],retainedSchemas:[...gatewayOperationSchemas(op),...gatewayPublicReadSchemas(read)]});
 const data=await operations[0]!.query!(f.context,{} as never,{}),publicData=await reads[0]!.read(f.context,{}),ajv=new Ajv({strict:false});
 assert.deepEqual(data,{actions:[{guideRef:{moduleId:'life',version:7}},{guideRef:{moduleId:'npc_life',version:1}}]});assert.deepEqual(publicData,data);
 assert(ajv.compile(operations[0]!.output)(data));assert.equal(ajv.compile(output)(data),false);assert.equal(ajv.compile(operations[0]!.output)(source),false);assert.deepEqual(source,before);
 for(const previous of [...gatewayOperationSchemas(op),...gatewayPublicReadSchemas(read)])assert.deepEqual(current.schema(previous.id,'6').document,previous.document);
 assert.equal(current.discovery().operations.find(row=>row.id==='life.actions')!.usageGuide.version,7);
 assert.equal(current.discovery().operations.find(row=>row.id==='life.public_actions')!.outputSchema.version,7);
 source.actions=[{guideRef:{moduleId:'life',version:5}}];await assert.rejects(operations[0]!.query!(f.context,{} as never,{}),{code:'source_unavailable'});
});

test('the complete current composition retains all 78 predecessor schemas and enforces both exact registry bounds',()=>{
 const base=residentDescriptorFixture(),f=coreFixture(),profiles=createPublishedWorldPlaceProfilesService(createWorldService(f.identity),currentNpcIdentity);
 const previousOperations=[...withApprovedLifeOperations(base.operations),...placeProfileGatewayOperations(profiles)],previousReads=[...withApprovedLifeReads(base.reads),...placeProfilePublicReads(profiles)];
 const retained=[...base.retained,...base.operations.filter(o=>APPROVED_LIFE_ACTION_IDS.has(o.id)).flatMap(gatewayOperationSchemas),...base.reads.filter(r=>APPROVED_LIFE_ACTION_IDS.has(r.id)).flatMap(gatewayPublicReadSchemas),...previousOperations.filter(o=>o.id==='life.actions').flatMap(gatewayOperationSchemas),...previousReads.filter(r=>r.id==='life.public_actions').flatMap(gatewayPublicReadSchemas)];
 const operations=manualParticipationLifeOperations(previousOperations,6),publicReads=manualParticipationLifeReads(previousReads,6),guides=[placeProfileWorldGuide,approvedLifeGuide,residentJournalGatewayGuide,residentTownGuide,residentNpcLifeGuide];
 const options={store:f.store,identity:f.identity,operations,publicReads,guides:guides.map(manualParticipationGuide),retainedGuides:[approvedWorldGuide,residentWorldGuide,npcCareLifeGuide,runtimeWorldGuide,placeProfileWorldGuide,approvedLifeGuide],retainedSchemas:retained};
 assert.equal(retained.length,78);const bytes=retained.reduce((n,row)=>n+Buffer.byteLength(JSON.stringify(row.document)),0);assert.equal(bytes,445294);
 const current=createAgentGateway(options);for(const row of retained)assert.equal(current.schema(row.id,String(row.version)).digest,hashRuntimeRequest(row.document));
 assert.throws(()=>createAgentGateway({...options,retainedSchemas:[...retained,retained[0]!]}),/Too many retained exact schemas/);
 assert.throws(()=>createAgentGateway({...options,retainedSchemas:[{...retained[0]!,document:{...retained[0]!.document,description:'x'.repeat(448*1024)}},...retained.slice(1)]}),/UTF-8 byte budget/);
 console.info(JSON.stringify({purpose:'manual-participation-exact-registry',retainedCount:retained.length,retainedUtf8Bytes:bytes,countLimit:78,byteLimit:448*1024}));
});
