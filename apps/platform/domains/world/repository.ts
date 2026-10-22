import type { WorldAvatar, WorldMovement, WorldRuleset, WorldState } from './types.ts';
import { defineRuntimeRepository } from '../../contracts/runtime-store.ts';

/** All methods participate in the caller's guarded transaction. No retained client. */
export interface WorldRepository {
  activateRuleset(ruleset:WorldRuleset,expectedWorldRevision:number):Promise<WorldState>;
  initialize(world: WorldState, ruleset: WorldRuleset): Promise<void>;
  getWorld(worldId: string): Promise<WorldState | undefined>;
  getRuleset(worldId: string, version: number): Promise<WorldRuleset | undefined>;
  /** Serializes capacity checks, position changes and the committed world cut. */
  lockWorld(worldId: string): Promise<WorldState | undefined>;
  advanceRevision(worldId: string, expectedRevision: number): Promise<number>;
  getAvatar(worldId: string, agentId: string): Promise<WorldAvatar | undefined>;
  saveAvatar(avatar: WorldAvatar, expectedVersion: number | null): Promise<void>;
  getMovement(id: string): Promise<WorldMovement | undefined>;
  getActiveMovement(worldId: string, agentId: string): Promise<WorldMovement | undefined>;
  getLatestMovement(worldId: string, agentId: string): Promise<WorldMovement | undefined>;
  saveMovement(movement: WorldMovement, expectedVersion: number | null): Promise<void>;
  countAtPlace(worldId: string, placeId: string, excludingAgentId: string): Promise<number>;
  listAvatars(worldId: string, options: { afterAgentId?: string; limit: number }): Promise<WorldAvatar[]>;
}
export type WorldReader = Pick<WorldRepository, 'getWorld' | 'getRuleset' | 'getAvatar' | 'getMovement' | 'getActiveMovement' | 'getLatestMovement' | 'listAvatars'>;
export const WORLD_REPOSITORY = defineRuntimeRepository<WorldReader, WorldRepository>('world');
