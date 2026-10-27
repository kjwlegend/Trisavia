import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Ajv} from 'ajv';
import {npcLifeGatewayOperations,npcLifePublicReads,npcLifeSchemas,type NpcLifeAccess} from '../../apps/platform/application/agent-gateway-npc-life.ts';
import {npcLifeGatewayGuide} from '../../apps/platform/application/npc-life-guide.ts';
import {autonomousWorldGuide,autonomousLifeGuide} from '../../apps/platform/application/agent-autonomous-life-guide.ts';
import {canonicalGatewayDocument} from '../../apps/platform/application/agent-gateway.ts';
// @ts-expect-error Pure browser contract; no service or credentials.
import {readNpcLifeDirectory,readNpcCareOptions,npcLifeReadInput,createNpcCareOptionsReader,buildNpcCareIntent} from '../../apps/web/public/hud/npc-life-reader.js';

/** Synthetic DTOs only. No claim of deployed art, actual arrival, authentication or completed care. */
function fixture(){
 const sha=(value:string)=>createHash('sha256').update(value).digest('hex'),body='隔离夹具园务说明，不是上线正文。',guide={id:'fixture-water-guide',version:1,digest:sha(body)},point={pointId:'fixture-water',version:1,careKind:'water',name:'夹具照料点',placeId:'fixture-care-place',cell:{x:0,y:0},approachCells:[{x:1,y:0}],available:true,reason:null,nextEligibleAt:null,lastCareAt:null,actorId:null,lastActivityId:null,guideRef:guide};
 const data={worldId:'default',definitionVersion:1,ruleVersion:1,map:{mapId:'pixel-town-v2',rulesetVersion:6,topologyVersion:6,geometryDigest:'a'.repeat(64)},spatialRef:{url:'/assets/fixture-spatial.json',revision:1,sha256:'b'.repeat(64)},npcs:[{npcId:'npc-gardener',version:1,name:'夹具青禾',role:'照料',position:{x:0,y:0},motion:null,appearance:{kind:'npc_sprite',version:1,assetId:'fixture-gardener',manifestUrl:'/assets/fixture-npc.json',digest:'c'.repeat(64)},present:true,busy:false}],carePoints:[point],guides:[{...guide,title:'夹具园务',body}],rules:{version:1,durationMs:120000,energyCost:6,pointCooldownMs:3600000,actorPointCooldownMs:86400000,maxIntroductionLifetimeMs:1800000},asOf:1000};
 const envelope=(data:unknown)=>({protocolVersion:1,requestId:'fixture-request',instanceId:'fixture-instance',serverTime:1000,data}),options={agentId:'fixture-agent',definitionVersion:1,energy:{available:100,required:6},points:[{pointId:point.pointId,version:1,available:true,reason:null,nextEligibleAt:null,introduction:null}],asOf:1000},rules={version:6,topologyVersion:6,mapManifest:{mapId:'pixel-town-v2',geometryDigest:'a'.repeat(64)},bounds:{minX:-5,minY:-5,maxX:5,maxY:5}};
 return{data,options,envelope,rules};
}

test('NPC-life schemas expose only named reads and keep published World21/Life4 bytes exact',async()=>{
 const f=fixture(),calls:any[]=[],service:NpcLifeAccess={async query(ctx,principal,operation,input){calls.push({ctx,principal,operation,input});return(operation==='npc_life.directory'?f.data:f.options) as any;}},ops=npcLifeGatewayOperations(service),reads=npcLifePublicReads(service),ajv=new Ajv({strict:false});
 assert.deepEqual(ops.map(o=>[o.id,o.kind,o.actors]),[['npc_life.directory','query',['agent','owner']],['npc_life.care.options','query',['agent','owner']]]);assert.equal(reads.length,1);assert.equal(reads[0]!.path,'/v1/world/npc-life/directory');assert.equal(npcLifeGatewayGuide.moduleId,'npc_life');
 const context={} as any;await reads[0]!.read(context,{});assert.deepEqual(calls,[{ctx:context,principal:null,operation:'npc_life.directory',input:{}}]);
 const validate=ajv.compile(npcLifeSchemas.directory);assert(validate(f.data),JSON.stringify(validate.errors));assert(!validate({...f.data,wallet:{balance:80}}));assert(!validate({...f.data,introduction:{agentId:'foreign'}}));
 const withoutActor=structuredClone(f.data);delete (withoutActor.carePoints[0] as any).actorId;assert(validate(withoutActor));assert.equal(ajv.compile(npcLifeSchemas.options)(f.options),true);
 const digest=(value:any)=>createHash('sha256').update(canonicalGatewayDocument(value)).digest('hex');assert.equal(digest(autonomousWorldGuide.document),'8b2d3f041899f50040ca258ae7c95cb9cf397225e3a84cefa174c4bf90d0ef0e');assert.equal(digest(autonomousLifeGuide.document),'10d5325e490494739651c2bfb6008618cfc024229bb77dc030007730079ba0a7');
});

test('NPC-life reader requires current geometry, public references and the selected private actor',()=>{
 const f=fixture();assert.equal(readNpcLifeDirectory(f.envelope(f.data),f.rules).data.carePoints[0].lastCareAt,null);assert.equal(readNpcCareOptions(f.envelope(f.options),'fixture-agent').data.energy.available,100);
 const hidden=structuredClone(f.data);delete (hidden.carePoints[0] as any).actorId;assert(!Object.hasOwn(readNpcLifeDirectory(f.envelope(hidden),f.rules).data.carePoints[0],'actorId'));
 for(const mutate of [(d:any)=>d.map.geometryDigest='d'.repeat(64),(d:any)=>d.carePoints[0].guideRef.digest='e'.repeat(64),(d:any)=>d.npcs[0].wallet={balance:80},(d:any)=>d.carePoints[0].cell.x=6]){const value=structuredClone(f.data);mutate(value);assert.throws(()=>readNpcLifeDirectory(f.envelope(value),f.rules),{code:'npc_life_response_invalid'});}
 const withIntro=structuredClone(f.options) as any;withIntro.points[0].introduction={introductionId:'fixture-intro',version:1,npcId:'npc-gardener',agentId:'fixture-agent',planId:'fixture-plan',careKind:'water',pointId:'fixture-water',pointVersion:1,guideRef:f.data.carePoints[0]!.guideRef,createdAt:1000,expiresAt:10000,consumedByActivityId:null};assert.equal(readNpcCareOptions(f.envelope(withIntro),'fixture-agent').data.points[0].introduction.planId,'fixture-plan');assert.equal(new Ajv({strict:false}).compile(npcLifeSchemas.options)(withIntro),true);
 assert.throws(()=>readNpcCareOptions(f.envelope(f.options),'foreign-agent'));assert.deepEqual(npcLifeReadInput('care.options',{},'fixture-agent'),{agentId:'fixture-agent'});assert.throws(()=>npcLifeReadInput('care.perform',{},'fixture-agent'),{code:'insufficient_scope'});assert.throws(()=>npcLifeReadInput('care.options',{agentId:'foreign-agent'},'fixture-agent'),{code:'invalid_request'});
 const prompt=buildNpcCareIntent({origin:'https://own.invalid',agentLabel:'本人 A901',directory:f.data,point:f.data.carePoints[0],options:{...f.options,privateToken:'MUST-NOT-COPY'}});assert(prompt.includes('careIntroduction'));assert(prompt.includes('本计划真实产生'));assert(prompt.includes('最多6体力'));assert(prompt.includes('/agent/runtime.md'));assert(!prompt.includes('MUST-NOT-COPY'));assert(!prompt.includes('已完成照料'));assert.throws(()=>buildNpcCareIntent({origin:'https://user:secret@own.invalid',directory:f.data,point:f.data.carePoints[0],options:f.options}));
});

test('NPC-life private reader clears the previous actor on selection change and denied refresh',async()=>{
 const f=fixture();let listener:any,context:any={phase:'ready',authenticated:true,observationRevision:1,selectedAgentId:'fixture-agent',agents:[{agentId:'fixture-agent'},{agentId:'other-agent'}]},deny=false;const calls:any[]=[],session={snapshot:()=>context,subscribe(fn:any){listener=fn;return()=>{};}},read=async(operation:string,input:any)=>{calls.push({operation,input});if(deny)throw Object.assign(Error('forbidden'),{status:403});return f.envelope({...f.options,agentId:context.selectedAgentId});},reader=createNpcCareOptionsReader(session,{read,refreshMs:0,eventTarget:null});
 const settle=()=>new Promise(resolve=>setImmediate(resolve));try{reader.setActive(true);await settle();assert.equal(reader.snapshot().data.agentId,'fixture-agent');assert.deepEqual(calls[0],{operation:'npc_life.care.options',input:{}});context={...context,observationRevision:2,selectedAgentId:'other-agent'};listener(context);assert.equal(reader.snapshot().data,null);await settle();assert.equal(reader.snapshot().data.agentId,'other-agent');deny=true;await reader.refresh();assert.equal(reader.snapshot().phase,'forbidden');assert.equal(reader.snapshot().data,null);}finally{reader.dispose();}
});
