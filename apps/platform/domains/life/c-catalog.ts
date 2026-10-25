import {LIFE_B_RUNTIME_RULES,catalogFromSpatial} from './catalog.ts';
import type {WorldRuleset} from '../world/types.ts';import type {TownCatalog} from '../town-services/types.ts';
export {LIFE_C_RULES,LIFE_C_SPATIAL_SHA256} from './c-values.ts';
export const LIFE_C_RUNTIME_RULES={...structuredClone(LIFE_B_RUNTIME_RULES),revision:3 as const,npcProfiles:[...LIFE_B_RUNTIME_RULES.npcProfiles,{id:'npc-librarian',stage:'C' as const},{id:'npc-neighbor',stage:'C' as const}]};

export function lifeCCatalogFromSpatial(spatial:Record<string,any>,rules:WorldRuleset,town:TownCatalog,activatedAt:number){return catalogFromSpatial(spatial,rules,town,activatedAt,3);}
