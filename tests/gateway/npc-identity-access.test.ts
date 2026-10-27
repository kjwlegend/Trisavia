import {placeProfileWorldGuide} from '../../apps/platform/application/agent-gateway-place-profile-guide.ts';
import {placeProfileGatewayOperations,placeProfilePublicReads} from '../../apps/platform/application/agent-gateway-place-profiles.ts';
import {createPublishedWorldPlaceProfilesService} from '../../apps/platform/application/world-place-profiles-source.ts';
import {createWorldService} from '../../apps/platform/application/world-service.ts';
import {currentNpcIdentity} from '../../apps/platform/domains/town-services/npc-identity.ts';
import {approvedWorldGuide,approvedLifeGuide,APPROVED_LIFE_ACTION_IDS,withApprovedLifeOperations,withApprovedLifeReads} from '../../apps/platform/application/agent-approved-current-guides.ts';
import {runtimeWorldGuide} from '../../apps/platform/application/agent-runtime-publication.ts';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Ajv} from 'ajv';
import {coreFixture} from '../world/runtime-fixture.ts';
import {worldCLifeOperations,worldCLifeReads,townCLifeOperations,townCLifeReads,behaviorCLifeOperations,behaviorCLifeReads} from '../../apps/platform/application/agent-gateway-life-c-projections.ts';
import {worldGatewayLegacyOperations} from '../../apps/platform/application/agent-gateway-world.ts';
import {withTownExpansionOperations,withTownExpansionPublicReads} from '../../apps/platform/application/agent-gateway-world-expansion.ts';
import {withExpressionOperations,withExpressionReads} from '../../apps/platform/application/agent-gateway-world-expressions.ts';
import {withAutonomousLifeOperations,withAutonomousLifeReads} from '../../apps/platform/application/agent-gateway-autonomous-life.ts';
import {lifeCGatewayOperations,lifeCPublicReads} from '../../apps/platform/application/agent-gateway-life-c.ts';
import {withNpcCareWorldOperations,withNpcCareWorldReads} from '../../apps/platform/application/agent-gateway-npc-care-world.ts';
import {withNpcCareLifeOperations,withNpcCareLifeReads,npcCareLifeGuide} from '../../apps/platform/application/agent-gateway-npc-care-life.ts';
import {withNpcCareBehaviorOperations,withNpcCareBehaviorReads,npcCareBehaviorGuide} from '../../apps/platform/application/agent-gateway-npc-care-behavior.ts';
import {withJournalOperations,withJournalReads} from '../../apps/platform/application/agent-gateway-journal.ts';
import {npcLifeGatewayOperations,npcLifePublicReads} from '../../apps/platform/application/agent-gateway-npc-life.ts';
import {NPC_IDENTITY_CHANGED_IDS,withNpcIdentitySchema,withNpcIdentityOperations,withNpcIdentityReads,residentWorldGuide,residentTownGuide,residentNpcLifeGuide} from '../../apps/platform/application/agent-gateway-npc-identities.ts';
import {withResidentJournalHistory,residentJournalGatewayOperations,residentJournalGatewayGuide} from '../../apps/platform/application/agent-gateway-resident-journal.ts';
import {canonicalGatewayDocument,createAgentGateway,gatewayOperationSchemas,gatewayPublicReadSchemas} from '../../apps/platform/application/agent-gateway.ts';
// @ts-expect-error Pure browser projection, exercised without a credential or DOM.
import {readNpcIdentity} from '../../apps/web/public/hud/npc-identity-reader.js';
// @ts-expect-error Pure browser projection, exercised without a credential or DOM.
import {readWorldNpcs} from '../../apps/web/public/hud/world-scene-projection.js';
const source=new Proxy({}, {get:()=>async()=>({})}) as any;
const identity={version:1,ref:'npc-personas-v1/npc-fixture',name:'原有专名',role:'原有角色',story:'这是已启用人物的公开故事。',digest:'a'.repeat(64)};

export function residentDescriptorFixture(){
 const rawWorld=withExpressionOperations(worldCLifeOperations(source)),rawPublic=withExpressionReads(worldCLifeReads(source)),world=withTownExpansionOperations(rawWorld),publicWorld=withTownExpansionPublicReads(rawPublic),life=lifeCGatewayOperations(source),publicLife=lifeCPublicReads(source),previousLife=withAutonomousLifeOperations(life),previousLifeReads=withAutonomousLifeReads(publicLife),behavior=withJournalOperations(behaviorCLifeOperations(source)),publicBehavior=withJournalReads(behaviorCLifeReads(source));
 const changed=new Set(['world.scene','world.npcs','world.public_scene','world.public_npcs','life.actions','life.public_actions','life.plans.submit','life.activities.get','life.activities.cancel','life.state','behavior.owner_history','behavior.public_world','behavior.public_recent']);
 const original=[...worldGatewayLegacyOperations(source).filter(o=>['world.movement','world.avatar.create','world.avatar.move','world.avatar.leave','world.movement.stop'].includes(o.id)).flatMap(gatewayOperationSchemas),...rawWorld.filter(o=>['world.rules','world.map_manifest'].includes(o.id)).flatMap(gatewayOperationSchemas),...rawPublic.filter(r=>['world.public_rules','world.public_map_manifest'].includes(r.id)).flatMap(gatewayPublicReadSchemas),...life.filter(o=>o.id==='life.actions').flatMap(gatewayOperationSchemas),...publicLife.filter(r=>r.id==='life.public_actions').flatMap(gatewayPublicReadSchemas),...[...world,...previousLife,...behavior].filter(o=>changed.has(o.id)).flatMap(gatewayOperationSchemas),...[...publicWorld,...previousLifeReads,...publicBehavior].filter(r=>changed.has(r.id)).flatMap(gatewayPublicReadSchemas)];
 const currentBehavior=withNpcCareBehaviorOperations(behavior),previousOwner=currentBehavior.find(o=>o.id==='behavior.owner_history')!,updatedBehavior=withResidentJournalHistory(currentBehavior),owner=updatedBehavior.find(o=>o.id==='behavior.owner_history')!;
 const operations=[...withNpcCareWorldOperations(world),...withNpcCareLifeOperations(life),...updatedBehavior,...townCLifeOperations(source),...npcLifeGatewayOperations(source),...residentJournalGatewayOperations(source,owner)],reads=[...withNpcCareWorldReads(publicWorld),...withNpcCareLifeReads(publicLife),...withNpcCareBehaviorReads(publicBehavior),...townCLifeReads(source),...npcLifePublicReads(source)];
 const retained=[...original,...gatewayOperationSchemas(previousOwner),...operations.filter(o=>NPC_IDENTITY_CHANGED_IDS.has(o.id)).flatMap(gatewayOperationSchemas),...reads.filter(r=>NPC_IDENTITY_CHANGED_IDS.has(r.id)).flatMap(gatewayPublicReadSchemas)];
 return {original,retained,operations:withNpcIdentityOperations(operations),reads:withNpcIdentityReads(reads)};
}
test('all source-owned NPC identity projections preserve 70 exact documents within one fixed UTF-8 bound',()=>{
 const {original,retained,operations,reads}=residentDescriptorFixture();assert.equal(original.length,48);assert.equal(original.reduce((n,d)=>n+Buffer.byteLength(canonicalGatewayDocument(d.document)),0),254678);
 assert.equal(retained.length,70);assert.equal(new Set(retained.map(row=>row.id+':'+row.version)).size,70);assert.equal(retained.reduce((n,d)=>n+Buffer.byteLength(canonicalGatewayDocument(d.document)),0),358442);
 if(process.env.JOURNAL_SCHEMA_RECEIPT)writeFileSync(process.env.JOURNAL_SCHEMA_RECEIPT,JSON.stringify({retainedCount:retained.length,retainedBytes:358442,countLimit:74,byteLimit:425984,npcChangedIds:[...NPC_IDENTITY_CHANGED_IDS],documents:retained.map(row=>{const canonical=canonicalGatewayDocument(row.document);return{id:row.id,version:row.version,$id:row.document.$id,bytes:Buffer.byteLength(canonical),sha256:createHash('sha256').update(canonical).digest('hex')};})},null,2)+'\n');
 const f=coreFixture();assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[],retainedSchemas:Array(75).fill(retained[0]!)}),/Too many retained exact schemas/);const gateway=createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[residentWorldGuide,npcCareLifeGuide,residentJournalGatewayGuide,residentTownGuide,residentNpcLifeGuide],retainedGuides:[npcCareBehaviorGuide],retainedSchemas:retained});
 for(const row of retained)assert.equal(gateway.schema(row.id,String(row.version)).canonicalDocument,canonicalGatewayDocument(row.document));
 assert.throws(()=>gateway.schema('world.scene.output','999'),(e:any)=>e.code==='schema_version_not_available');
 assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[],retainedSchemas:[...retained,retained[0]!]}),/Invalid retained exact schema/);
 assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[],retainedSchemas:[{...retained[0]!,document:{...retained[0]!.document,description:'x'.repeat(425984)}},...retained.slice(1)]}),/UTF-8 byte budget/);
});
test('identity is optional source data, validated once and retained by the current public NPC reader',()=>{
 assert.deepEqual(readNpcIdentity(identity,{name:identity.name,role:identity.role}),identity);
 assert.throws(()=>readNpcIdentity({...identity,privateTopic:'hidden'}));assert.throws(()=>readNpcIdentity({...identity,story:'x'.repeat(1201)}));assert.throws(()=>readNpcIdentity(identity,{name:'different'}));
 const row={npcId:'npc-fixture',name:identity.name,role:identity.role,position:{x:0,y:0},approachCells:[],serverManaged:true,countsAsAgent:false,actions:[],readOnly:true,status:'service_unavailable',appearance:{template:'basic',color:'olive'},identity},rules={version:1,topologyVersion:1,width:2,height:2};
 assert.deepEqual(readWorldNpcs([row],rules)[0]!.identity,identity);const legacy={...row} as any;delete legacy.identity;assert(!Object.hasOwn(readWorldNpcs([legacy],rules)[0],'identity'));
 const old={type:'object',additionalProperties:false,properties:{npcId:{type:'string'},name:{type:'string'},role:{type:'string'}},required:['npcId','name','role']},current=withNpcIdentitySchema(old as any),ajv=new Ajv({strict:false});
 assert(ajv.compile(current)({npcId:row.npcId,name:row.name,role:row.role,identity}));assert(!ajv.compile(old)({npcId:row.npcId,name:row.name,role:row.role,identity}));assert(!Object.hasOwn(old.properties,'identity'));
});
test('current Town accepts eight live NPCs with only the reviewed gardener sprite branch',()=>{
 const old=townCLifeOperations(source).find(operation=>operation.id==='town_services.npcs')!,current=withNpcIdentityOperations([old])[0]!,ajv=new Ajv({strict:false}),rowSchema=((current.output.properties as any).npcs.items),validRow=ajv.compile(rowSchema);
 const gardener={npcId:'npc-gardener',definitionVersion:1,version:1,actorKind:'npc',name:'青禾',role:'园务',buildingId:null,position:{x:-17,y:44},approachCells:[{x:-16,y:44}],appearance:{kind:'npc_sprite',version:1,assetId:'pixel-crawler-qinghe-v1',manifestUrl:'/assets/npc-life-v1/manifest.json',digest:'2c6070d6c36d335194f31633c5a30237297ea8a779434b75f2c2469560acfdb4'},serverManaged:true,countsAsAgent:false,readOnly:false,status:'available',serviceIds:[],actions:['life.plans.submit'],motion:null,motionVersion:null,activity:null,providerPresent:true,nextCheckAt:1000};
 assert(validRow(gardener),JSON.stringify(validRow.errors));assert(!validRow({...gardener,npcId:'unreviewed-npc'}));assert(!ajv.compile((old.output.properties as any).npcs.items)(gardener));
 assert.equal((old.output.properties as any).npcs.maxItems,7);assert.equal((current.output.properties as any).npcs.maxItems,8);assert.equal(current.schemaVersion,7);
 const rules={version:6,topologyVersion:6,bounds:{minX:-100,maxX:100,minY:-100,maxY:100}};assert.equal(readWorldNpcs([gardener],rules)[0]!.appearance.kind,'npc_sprite');
});


test('approved World24/Life6 preserve old exact documents and retain current action guide5 bytes',()=>{
 const base=residentDescriptorFixture(),previous=[...base.operations.filter(o=>APPROVED_LIFE_ACTION_IDS.has(o.id)).flatMap(gatewayOperationSchemas),...base.reads.filter(r=>APPROVED_LIFE_ACTION_IDS.has(r.id)).flatMap(gatewayPublicReadSchemas)],retained=[...base.retained,...previous];
 const bytes=retained.reduce((n,row)=>n+Buffer.byteLength(canonicalGatewayDocument(row.document)),0);
 assert.equal(retained.length,74);assert.equal(bytes,401868);assert(bytes<=425984,String(bytes));
 const f=coreFixture(),gateway=createAgentGateway({store:f.store,identity:f.identity,operations:withApprovedLifeOperations(base.operations),publicReads:withApprovedLifeReads(base.reads),guides:[approvedWorldGuide,approvedLifeGuide,residentJournalGatewayGuide,residentTownGuide,residentNpcLifeGuide],retainedGuides:[residentWorldGuide,npcCareLifeGuide,runtimeWorldGuide],retainedSchemas:retained});
 for(const row of retained)assert.equal(gateway.schema(row.id,String(row.version)).canonicalDocument,canonicalGatewayDocument(row.document));
 for(const [module,version,expected] of [['world',23,'bea974eaea33b2accc8f33ce6116f2bbf084f6b770ca72021f5a258d4a0731a3'],['life',5,'16630ffe377591332404b1dcd35af14c3cfd8963ed0a0f3ef9d60e84da1781a2'],['world',19,'9c069d7b318d380c07310b4f036298e36f2700821a83481569cc45498d19a7c3']] as const)assert.equal(gateway.guide(module,String(version)).digest,expected);
 assert.equal(gateway.guide('world','24').document.profilePersonalization,approvedWorldGuide.document.profilePersonalization);
 assert(!canonicalGatewayDocument(approvedWorldGuide.document).includes('通常1–3句'));assert(!canonicalGatewayDocument(approvedLifeGuide.document).includes('通常1–3句'));
 assert.equal(withApprovedLifeOperations(base.operations).find(o=>o.id==='life.actions')!.schemaVersion,6);
 console.log(JSON.stringify({approvedTemplateRetainedCount:retained.length,approvedTemplateRetainedUtf8Bytes:bytes,limitCount:74,limitUtf8Bytes:425984}));
});


test('place profiles add only eight new current schema1 documents and retain all 74 prior exact schemas',()=>{
 const base=residentDescriptorFixture(),retained=[...base.retained,...base.operations.filter(o=>APPROVED_LIFE_ACTION_IDS.has(o.id)).flatMap(gatewayOperationSchemas),...base.reads.filter(r=>APPROVED_LIFE_ACTION_IDS.has(r.id)).flatMap(gatewayPublicReadSchemas)],f=coreFixture(),profiles=createPublishedWorldPlaceProfilesService(createWorldService(f.identity),currentNpcIdentity),placeOps=placeProfileGatewayOperations(profiles),placeReads=placeProfilePublicReads(profiles),newDocs=[...placeOps.flatMap(gatewayOperationSchemas),...placeReads.flatMap(gatewayPublicReadSchemas)];
 const operations=[...withApprovedLifeOperations(base.operations),...placeOps],publicReads=[...withApprovedLifeReads(base.reads),...placeReads],currentDocs=[...operations.flatMap(gatewayOperationSchemas),...publicReads.flatMap(gatewayPublicReadSchemas)];
 assert.equal(retained.length,74);assert.equal(retained.reduce((n,d)=>n+Buffer.byteLength(canonicalGatewayDocument(d.document)),0),401868);assert.equal(newDocs.length,8);assert(newDocs.every(doc=>doc.version===1));assert.equal(new Set(newDocs.map(doc=>doc.id)).size,8);
 const gateway=createAgentGateway({store:f.store,identity:f.identity,operations,publicReads,guides:[placeProfileWorldGuide,approvedLifeGuide,residentJournalGatewayGuide,residentTownGuide,residentNpcLifeGuide],retainedGuides:[approvedWorldGuide,residentWorldGuide,npcCareLifeGuide,runtimeWorldGuide],retainedSchemas:retained});
 for(const doc of retained)assert.equal(gateway.schema(doc.id,String(doc.version)).canonicalDocument,canonicalGatewayDocument(doc.document));
 for(const doc of newDocs)assert.equal(gateway.schema(doc.id,'1').canonicalDocument,canonicalGatewayDocument(doc.document));
 assert.equal(gateway.guide('world','24').canonicalDocument,canonicalGatewayDocument(approvedWorldGuide.document));assert.equal(gateway.guide('world','25').document.version,25);
 console.log(JSON.stringify({placeProfileNewCurrentSchemaCount:newDocs.length,placeProfileNewCurrentSchemaUtf8Bytes:newDocs.reduce((n,d)=>n+Buffer.byteLength(canonicalGatewayDocument(d.document)),0),allCurrentCount:currentDocs.length,allCurrentUtf8Bytes:currentDocs.reduce((n,d)=>n+Buffer.byteLength(canonicalGatewayDocument(d.document)),0),retainedCount:74,retainedUtf8Bytes:401868,countLimit:74,byteLimit:425984}));
});
