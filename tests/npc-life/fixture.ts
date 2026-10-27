import {readFile} from 'node:fs/promises';
import {lifeFixture} from '../life/fixture.ts';
import {NPC_LIFE_REPOSITORY,type NpcLifeRepository} from '../../apps/platform/domains/npc-life/repository.ts';
import type {CarePoint,CareIntroduction,CareFact,NpcLifeParticipant} from '../../apps/platform/domains/npc-life/types.ts';
import {gardenerDefinition} from '../../apps/platform/domains/npc-life/definition.ts';
import {createNpcLifeService} from '../../apps/platform/application/npc-life-service.ts';
import {townExpansionRules,TOWN_EXPANSION_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-expansion-v1.ts';
import {freshActor} from '../../apps/platform/domains/life/rules.ts';
const copy=<T>(v:T):T=>structuredClone(v);
/** Real frozen geometry/content; clock and identity are isolated synthetic fixtures. Extra source state participates in savepoint rollback. */
export async function npcLifeFixture(){
 const load=async(file:string)=>JSON.parse(await readFile(new URL('../../apps/web/public/'+file,import.meta.url),'utf8'));
 const rules=townExpansionRules(await load('world-life/world-map-expansion-v1.json'),TOWN_EXPANSION_LAYOUT_SHA256,await load('world-life/spatial-manifest-expansion-v1.json'));
 const d=gardenerDefinition(await load('npc-life-v1/spatial-addon-v1.json'),rules,Date.UTC(2026,9,21));
 let state={points:new Map<string,CarePoint>(),introductions:new Map<string,CareIntroduction>(),facts:new Map<string,CareFact>()};
 const save=<T extends{version:number}>(map:Map<string,T>,id:string,v:T,e:number|null)=>{if(e===null?map.has(id):map.get(id)?.version!==e)throw Error('Synthetic extra-source CAS');map.set(id,copy(v));};
 const repo:NpcLifeRepository={async getDefinition(){return copy(d);},async activateDefinition(){throw Error('Fixture is explicitly preactivated');},async lockPoint(){},async getPoint(id){return copy(state.points.get(id));},async listPoints(){return copy([...state.points.values()]);},async savePoint(v,e){save(state.points,v.pointId,v,e);},async getIntroduction(id){return copy(state.introductions.get(id));},async findIntroduction(plan,point){return copy([...state.introductions.values()].find(v=>v.planId===plan&&v.pointId===point));},async saveIntroduction(v,e){save(state.introductions,v.introductionId,v,e);},async lastCare(agent,point){return copy([...state.facts.values()].filter(v=>v.agentId===agent&&v.pointId===point).sort((a,b)=>b.completedAt-a.completedAt)[0]);},async getCare(id){return copy(state.facts.get(id));},async insertCare(v){if(state.facts.has(v.activityId))throw Error('Duplicate source');state.facts.set(v.activityId,copy(v));}};
 let service:ReturnType<typeof createNpcLifeService>;
 const proxy=new Proxy({}as NpcLifeParticipant,{get(_t,k){return (service.lifeExtension as any)[k];}});
 const x=await lifeFixture({npcLife:proxy,extension:{repository:port=>port===NPC_LIFE_REPOSITORY?repo:undefined,snapshot:()=>copy(state),restore:v=>{state=v as typeof state;}}});
 service=createNpcLifeService(x.identity,{life:()=>x.engine.npcLifeHost});
 Object.assign(x.c,{revision:3,map:d.map});
 await x.store.transaction(async ctx=>{await x.f.world.activateRuleset(rules,(await x.f.world.getWorld('default'))!.revision);await ctx.tasks.advanceGeneration('npc_life',0);for(const p of d.carePoints)await repo.savePoint({pointId:p.pointId,careKind:p.careKind,version:1,activeActivityId:null,lastCareAt:null,actorId:null,lastActivityId:null,nextEligibleAt:null,materialAvailable:p.initialMaterialAvailable},null);const n=d.npcs[0]!;await x.repo.saveActor(freshActor({kind:'npc',id:n.npcId},ctx.now()),null);await x.repo.saveNpc({npcId:n.npcId,version:1,position:n.initialPosition,motion:null,currentGoal:null,nextDecisionAt:ctx.now()+86400000,decisionSequence:0,recent:[],policyVersion:1,lastDwellAt:ctx.now()},null);});
 const input=async()=>({expectedCatalogRevision:3,deadlineAt:x.now+1800000,maxSpendByCurrency:{star_coin:0},maxConsumeByItem:{},steps:[{stepId:'go-intro',type:'move.to',placeId:d.npcs[0]!.placeId},{stepId:'intro',type:'act',actionId:'care.introduce',placeId:d.npcs[0]!.placeId,params:{pointId:d.carePoints[0]!.pointId,expectedPointVersion:(await repo.getPoint(d.carePoints[0]!.pointId))!.version,expectedDefinitionVersion:1,expectedNpcVersion:(await x.repo.getNpc('npc-gardener'))!.version}},{stepId:'go-care',type:'move.to',placeId:d.carePoints[0]!.placeId},{stepId:'care',type:'act',actionId:'care.perform',placeId:d.carePoints[0]!.placeId,params:{pointId:d.carePoints[0]!.pointId,expectedPointVersion:(await repo.getPoint(d.carePoints[0]!.pointId))!.version,introductionFrom:{stepId:'intro',output:'careIntroduction'}}}]});
 return {...x,service,d,rules,npcRepo:repo,input,get extra(){return state;},get now(){return x.now;},set now(v:number){x.now=v;},add:(id:string)=>x.add(id,d.npcs[0]!.receptionApproachCells[0]),async until(predicate:()=>Promise<boolean>,limit=100){for(let i=0;i<limit;i++){if(await predicate())return;const r=await x.run(500);if(r.failed)throw Error('Synthetic scheduler failed '+JSON.stringify(r));}throw Error('Synthetic wait exceeded');}};
}
