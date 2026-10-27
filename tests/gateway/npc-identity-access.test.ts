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
 if(process.env.JOURNAL_SCHEMA_RECEIPT)writeFileSync(process.env.JOURNAL_SCHEMA_RECEIPT,JSON.stringify({retainedCount:retained.length,retainedBytes:358442,countLimit:74,byteLimit:393216,npcChangedIds:[...NPC_IDENTITY_CHANGED_IDS],documents:retained.map(row=>{const canonical=canonicalGatewayDocument(row.document);return{id:row.id,version:row.version,$id:row.document.$id,bytes:Buffer.byteLength(canonical),sha256:createHash('sha256').update(canonical).digest('hex')};})},null,2)+'\n');
 const f=coreFixture();assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[],retainedSchemas:Array(75).fill(retained[0]!)}),/Too many retained exact schemas/);const gateway=createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[residentWorldGuide,npcCareLifeGuide,residentJournalGatewayGuide,residentTownGuide,residentNpcLifeGuide],retainedGuides:[npcCareBehaviorGuide],retainedSchemas:retained});
 for(const row of retained)assert.equal(gateway.schema(row.id,String(row.version)).canonicalDocument,canonicalGatewayDocument(row.document));
 assert.throws(()=>gateway.schema('world.scene.output','999'),(e:any)=>e.code==='schema_version_not_available');
 assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[],retainedSchemas:[...retained,retained[0]!]}),/Invalid retained exact schema/);
 assert.throws(()=>createAgentGateway({store:f.store,identity:f.identity,operations,publicReads:reads,guides:[],retainedSchemas:[{...retained[0]!,document:{...retained[0]!.document,description:'x'.repeat(393216)}},...retained.slice(1)]}),/UTF-8 byte budget/);
});
test('identity is optional source data, validated once and retained by the current public NPC reader',()=>{
 assert.deepEqual(readNpcIdentity(identity,{name:identity.name,role:identity.role}),identity);
 assert.throws(()=>readNpcIdentity({...identity,privateTopic:'hidden'}));assert.throws(()=>readNpcIdentity({...identity,story:'x'.repeat(1201)}));assert.throws(()=>readNpcIdentity(identity,{name:'different'}));
 const row={npcId:'npc-fixture',name:identity.name,role:identity.role,position:{x:0,y:0},approachCells:[],serverManaged:true,countsAsAgent:false,actions:[],readOnly:true,status:'service_unavailable',appearance:{template:'basic',color:'olive'},identity},rules={version:1,topologyVersion:1,width:2,height:2};
 assert.deepEqual(readWorldNpcs([row],rules)[0]!.identity,identity);const legacy={...row} as any;delete legacy.identity;assert(!Object.hasOwn(readWorldNpcs([legacy],rules)[0],'identity'));
 const old={type:'object',additionalProperties:false,properties:{npcId:{type:'string'},name:{type:'string'},role:{type:'string'}},required:['npcId','name','role']},current=withNpcIdentitySchema(old as any),ajv=new Ajv({strict:false});
 assert(ajv.compile(current)({npcId:row.npcId,name:row.name,role:row.role,identity}));assert(!ajv.compile(old)({npcId:row.npcId,name:row.name,role:row.role,identity}));assert(!Object.hasOwn(old.properties,'identity'));
});
