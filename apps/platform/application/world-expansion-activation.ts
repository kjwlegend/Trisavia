import type {JsonObject,M1Transaction} from '../contracts/store.ts';
import type {RuntimeTransaction} from '../contracts/runtime-store.ts';
import type {WorldRuleset} from '../domains/world/types.ts';
import {WORLD_REPOSITORY} from '../domains/world/repository.ts';
import {LIFE_REPOSITORY} from '../domains/life/repository.ts';
import {TOWN_REPOSITORY} from '../domains/town-services/repository.ts';
import {catalogRepository} from '../domains/perception/repository.ts';
import {key,plain} from '../domains/perception/protocol.ts';
import {fail} from '../domains/common/errors.ts';
import {assertCell,worldBounds} from '../domains/world/rules.ts';
import {effectiveLifeCatalogForWorld} from '../domains/life/current-spatial.ts';
import {TOWN_EXPANSION_GEOMETRY_DIGEST,TOWN_EXPANSION_LAYOUT_SHA256,TOWN_EXPANSION_SPATIAL_SHA256} from '../domains/world/town-expansion-v1.ts';
export interface ExpansionActivation {instanceId:string;recoveryEpoch:string;operator:string;operationId:string;expectedGuideVersion:number}
function identity(o:ExpansionActivation){if(!/^[A-Za-z0-9_.:@-]{1,100}$/.test(o.operator)||!/^.{8,100}$/u.test(o.operationId)||!Number.isSafeInteger(o.expectedGuideVersion)||o.expectedGuideVersion<1)throw new Error('Original expansion activation identity required');return{id:'admin-town-expansion:'+key({operator:o.operator,operationId:o.operationId}),payloadHash:key({...o,release:'town-expansion@1',layout:TOWN_EXPANSION_LAYOUT_SHA256,spatial:TOWN_EXPANSION_SPATIAL_SHA256,geometry:TOWN_EXPANSION_GEOMETRY_DIGEST})};}
export async function readTownExpansionActivation(tx:M1Transaction,o:ExpansionActivation){const id=identity(o),row=await catalogRepository(tx).get(id.id);if(!row)return;if(row.data.payloadHash!==id.payloadHash)fail('operation_id_conflict',409,'Original expansion payload differs');return plain(row.data.result);}
/** Checks the original logical surface, entrances and physical service definitions, not preview pixels. */
export function assertTownExpansionPreserves(old:WorldRuleset,next:WorldRuleset){
 if(old.version!==5||old.topologyVersion!==5||old.mapManifest?.layoutSha256!=='c025fbdce5cd5fba4a33c1013fb6a49847be55a68c7c12edcdaa0a37524d7b08'||next.version!==6||next.topologyVersion!==6||next.mapManifest?.geometryDigest!==TOWN_EXPANSION_GEOMETRY_DIGEST)throw new Error('The exact C5 to expansion6 transition is required');
 const blocked=new Set(next.blocked.map(c=>c.x+','+c.y)),oldBlocked=new Set(old.blocked.map(c=>c.x+','+c.y)),oldUnopened=new Set(old.unopened?.map(c=>c.x+','+c.y)),bounds=worldBounds(old);
 for(let y=bounds.minY;y<=bounds.maxY;y++)for(let x=bounds.minX;x<=bounds.maxX;x++){const id=x+','+y;if(oldBlocked.has(id)){if(!blocked.has(id))throw new Error('An original physical obstruction moved');}else if(!oldUnopened.has(id))assertCell(next,{x,y});}
 for(const field of ['spawn','places','maxPathLength'] as const)if(key(old[field] as unknown as JsonObject)!==key(next[field] as unknown as JsonObject))throw new Error('An original world authority field changed');
 for(const field of ['buildings','bridges','stairs','npcs'] as const)if(key(old.mapManifest[field] as unknown as JsonObject)!==key(next.mapManifest![field] as unknown as JsonObject))throw new Error('An original service or navigation anchor changed');
}
/** Caller supplies the paired CLOSED single transaction. No identity, economic or task source is rewritten. */
export async function activateTownExpansion(ctx:RuntimeTransaction,tx:M1Transaction,rules:WorldRuleset,o:ExpansionActivation){
 const prior=await readTownExpansionActivation(tx,o);if(prior)return prior;
 const world=ctx.repository(WORLD_REPOSITORY),life=await ctx.repository(LIFE_REPOSITORY).getCatalog(),town=ctx.repository(TOWN_REPOSITORY),oldTown=await town.getCatalog(),w=await world.lockWorld('default'),repo=catalogRepository(tx),current=await repo.get('current');
 if(ctx.instanceId!==o.instanceId||ctx.recoveryEpoch!==o.recoveryEpoch||!w?.active||w.rulesetVersion!==5||oldTown?.version!==5||life?.revision!==3||current?.data.schemaVersion!==8||current.data.catalogRevision!=='catalog-agent-runtime-1'||current.data.guideVersion!==o.expectedGuideVersion)fail('version_conflict',409,'The paired exact current C5 world and runtime guide are required');
 const old=await world.getRuleset('default',5);if(!old||await world.getRuleset('default',6)||await town.getCatalog(6))fail('version_conflict',409,'The expansion version is already occupied without this original receipt');
 assertTownExpansionPreserves(old,rules);effectiveLifeCatalogForWorld(life,rules);
 if(oldTown.map.geometryDigest!==old.mapManifest!.geometryDigest||life.map.geometryDigest!==old.mapManifest!.geometryDigest)fail('version_conflict',409,'The original Life and Town references differ');
 for(const p of life.places)for(const c of [...p.cells,...p.approachCells,...p.waitingCells,...p.stations.flatMap(s=>[...s.cells,...s.approachCells??[]])])assertCell(rules,c);
 for(const n of life.npcProfiles)assertCell(rules,n.initialPosition);
 const activated=await world.activateRuleset(rules,w.revision);
 await town.activateCatalog({...oldTown,version:6,activatedAt:ctx.now(),map:{...oldTown.map,rulesetVersion:6,topologyVersion:6,layoutSha256:TOWN_EXPANSION_LAYOUT_SHA256,geometryDigest:TOWN_EXPANSION_GEOMETRY_DIGEST}});
 const result:JsonObject={changed:true,operationId:o.operationId,rulesetVersion:6,topologyVersion:6,mapManifestVersion:6,worldRevision:activated.revision,townCatalogVersion:6,lifeCatalogRevision:3,geometryDigest:TOWN_EXPANSION_GEOMETRY_DIGEST,catalogRevision:current.data.catalogRevision,guideVersion:current.data.guideVersion,schemaVersion:8,newGuideDocuments:0,newSchemaDocuments:0,oldBusinessFactsRewritten:false};
 const id=identity(o);await repo.insert({id:id.id,version:1,data:{kind:'administrative_receipt',payloadHash:id.payloadHash,result}});return result;
}
