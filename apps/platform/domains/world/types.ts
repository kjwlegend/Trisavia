export interface GridPoint { x: number; y: number }
export interface WorldPlace {
  id: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  access: 'members' | 'closed';
  capacity: number | null;
}
/** Logical cells; no screen pixels, rendering clock or inferred presence. */
export interface WorldRuleset {
  worldId: string;
  version: number;
  topologyVersion: number;
  width: number;
  height: number;
  spawn: GridPoint;
  blocked: GridPoint[];
  places: WorldPlace[];
  maxPathLength: number;
}
export interface WorldState {
  worldId: string;
  active: boolean;
  rulesetVersion: number;
  revision: number;
}
export interface WorldAvatar {
  id: string;
  worldId: string;
  agentId: string;
  version: number;
  status: 'idle' | 'suspended' | 'left';
  position: GridPoint;
  placeId: string | null;
  rulesetVersion: number;
  createdAt: number;
  updatedAt: number;
}
export interface CreateAvatarInput { worldId: string; expectedRulesetVersion: number }
export interface MoveAvatarInput {
  worldId: string;
  expectedVersion: number;
  expectedRulesetVersion: number;
  expectedTopologyVersion: number;
  path: GridPoint[];
}
export interface LeaveAvatarInput { worldId: string; expectedVersion: number }
export type WorldAction = 'world.avatar.create' | 'world.avatar.move' | 'world.avatar.leave';
export interface WorldFact {
  kind: 'world.avatar.created' | 'world.avatar.moved' | 'world.avatar.left';
  worldId: string;
  avatarId: string;
  agentId: string;
  avatarVersion: number;
  rulesetVersion: number;
  worldRevision: number;
  at: number;
}
