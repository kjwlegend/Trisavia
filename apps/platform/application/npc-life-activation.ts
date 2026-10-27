import type {M1Transaction,JsonObject} from '../contracts/store.ts';
import type {RuntimeTransaction} from '../contracts/runtime-store.ts';
import {catalogRepository} from '../domains/perception/repository.ts';
import {key,plain} from '../domains/perception/protocol.ts';
import {fail} from '../domains/common/errors.ts';
import {WORLD_REPOSITORY} from '../domains/world/repository.ts';
import {TOWN_REPOSITORY} from '../domains/town-services/repository.ts';
import {LIFE_REPOSITORY} from '../domains/life/repository.ts';
import {NPC_LIFE_REPOSITORY} from '../domains/npc-life/repository.ts';
import {freshActor} from '../domains/life/rules.ts';
import {effectiveLifeCatalogForWorld} from '../domains/life/current-spatial.ts';
import {validateNpcLifeDefinition} from '../domains/npc-life/rules.ts';
import {NPC_LIFE_CONTENT,NPC_LIFE_ART_SHA256,NPC_LIFE_SPATIAL_SHA256} from '../domains/npc-life/definition.ts';
import type {NpcLifeDefinition} from '../domains/npc-life/types.ts';
export interface NpcLifeActivation {instanceId:string;recoveryEpoch:string;operator:string;operationId:string;expectedGuideVersion:number}
function operation(o:NpcLifeActivation){
 if(!/^[A-Za-z0-9_.:@-]{1,100}$/.test(o.operator)||!/^.{8,100}$/u.test(o.operationId)||!Number.isSafeInteger(o.expectedGuideVersion)||o.expectedGuideVersion<1)throw Error('Original NPC life operation and expected guide required');
 return{id:'admin-npc-life:'+key({operator:o.operator,operationId:o.operationId}),payloadHash:key({...o,release:'npc-life-gardener@1',art:NPC_LIFE_ART_SHA256,spatial:NPC_LIFE_SPATIAL_SHA256,content:NPC_LIFE_CONTENT.sourceSha256,enabledRefs:NPC_LIFE_CONTENT.enabledRefs})};
}
export async function readNpcLifeActivation(tx:M1Transaction,o:NpcLifeActivation){const k=operation(o),r=await catalogRepository(tx).get(k.id);if(!r)return;if(r.data.payloadHash!==k.payloadHash)fail('operation_id_conflict',409,'Recover the original NPC life operation and payload');return plain(r.data.result);}
/** Only a paired closed migrator calls this. No old catalog, actor, wallet, task or generation is rewritten. */
export async function activateNpcLife(ctx:RuntimeTransaction,tx:M1Transaction,d:NpcLifeDefinition,o:NpcLifeActivation){
 const prior=await readNpcLifeActivation(tx,o);if(prior)return prior;
 const world=ctx.repository(WORLD_REPOSITORY),w=await world.lockWorld('default'),rules=w&&await world.getRuleset('default',w.rulesetVersion),town=await ctx.repository(TOWN_REPOSITORY).getCatalog(),life=ctx.repository(LIFE_REPOSITORY),c=await life.getCatalog(),source=ctx.repository(NPC_LIFE_REPOSITORY),repo=catalogRepository(tx),current=await repo.get('current');
 if(ctx.instanceId!==o.instanceId||ctx.recoveryEpoch!==o.recoveryEpoch||!w?.active||!rules||w.rulesetVersion!==6||town?.version!==6||c?.revision!==3||c.npcProfiles.length!==7||current?.data.schemaVersion!==8||current.data.catalogRevision!=='catalog-agent-runtime-1'||current.data.guideVersion!==o.expectedGuideVersion)fail('version_conflict',409,'The paired World6/Town6/Life3 and original current runtime guide are required');
 effectiveLifeCatalogForWorld(c,rules);validateNpcLifeDefinition(d,rules);
 if(d.spatialRef.sha256!==NPC_LIFE_SPATIAL_SHA256||d.spatialRef.revision!==2||d.npcs[0]?.appearance.digest!==NPC_LIFE_ART_SHA256||key(d.enabledRefs)!==key(NPC_LIFE_CONTENT.enabledRefs)||d.carePoints.filter(p=>p.enabled).length!==1||!d.carePoints.some(p=>p.enabled&&p.careKind==='water'))throw Error('Only the frozen water slice may activate');
 if(await source.getDefinition()||await ctx.tasks.currentGeneration('npc_life')!==0||await ctx.tasks.currentGeneration('life')!==1)fail('version_conflict',409,'This extension is occupied without the original receipt');
 const profile=d.npcs[0]!,ref={kind:'npc' as const,id:profile.npcId};if(await life.getActor(ref)||await life.getNpc(ref.id))fail('version_conflict',409,'The new independent NPC identity is already occupied');
 // Source repository registers the real town NPC before its FK-dependent Life actor. Public ID trigger allocates only this new N.
 await source.activateDefinition(d);for(const p of d.carePoints)await source.savePoint({pointId:p.pointId,version:1,careKind:p.careKind,activeActivityId:null,lastCareAt:null,actorId:null,lastActivityId:null,nextEligibleAt:null,materialAvailable:p.initialMaterialAvailable},null);
 await ctx.tasks.advanceGeneration('npc_life',0);
 const taskId='life-tick:npc:'+ref.id+':npc-life-1',actor={...freshActor(ref,ctx.now()),taskId};await life.saveActor(actor,null);
 await life.saveNpc({npcId:ref.id,version:1,position:profile.initialPosition,motion:null,currentGoal:null,nextDecisionAt:ctx.now()+c.npcPolicy.minDwellSeconds*1000,decisionSequence:0,recent:[],policyVersion:1,lastDwellAt:ctx.now()},null);
 await ctx.tasks.schedule({taskId,domain:'life',kind:'life.actor.tick',handlerVersion:1,dedupeKey:taskId,target:{type:'npc',id:ref.id,version:1},timeKind:'utc',dueAt:ctx.now()+c.npcPolicy.minDwellSeconds*1000,generation:1,maxAttempts:4,payloadVersion:1,payload:{actorKind:'npc',actorId:ref.id}});
 const result:JsonObject={changed:true,operationId:o.operationId,definitionVersion:1,npcLifeGeneration:1,addedNpcActors:[ref.id],createdWalletAccounts:0,createdCredits:0,createdAgents:0,carePointCount:2,enabledCareKinds:['water'],rulesetVersion:6,townCatalogVersion:6,lifeCatalogRevision:3,schemaVersion:8,guideVersion:o.expectedGuideVersion,catalogRevision:current.data.catalogRevision,newGuideDocuments:0,newSchemaDocuments:0,oldBusinessFactsRewritten:false};const k=operation(o);await repo.insert({id:k.id,version:1,data:{kind:'administrative_receipt',payloadHash:k.payloadHash,result}});return result;
}
