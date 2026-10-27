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
  bounds?:WorldBounds;
  unopened?:GridPoint[];
  mapManifest?:WorldMapManifest;
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
  motion?:WorldMotion|null;
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
export type WorldAction = 'world.avatar.create' | 'world.avatar.move' | 'world.avatar.leave' | 'world.movement.stop';
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
/** Frozen deterministic development policy, independent of screen animation or Agent/model timers. */
export const MOVEMENT_POLICY_V1 = Object.freeze({ version: 1, stepIntervalMs: 1000 });
export interface WorldMovement {
  id: string; worldId: string; agentId: string; avatarId: string; version: number;
  state: 'pending' | 'running' | 'completed' | 'stopped';
  origin: GridPoint; path: GridPoint[]; nextStep: number; expectedAvatarVersion: number;
  rulesetVersion: number; topologyVersion: number; policyVersion: number; stepIntervalMs: number;
  createdAt: number; updatedAt: number; nextDueAt: number | null; completedAt: number | null; stoppedCode: string | null;
  commandId: string; recoveryEpoch: string;
  qualification: { runtimeVersion: number; ownerPauseVersion: number; platformVersion: number; sharingGeneration: number };
}

export interface WorldBounds { minX:number; minY:number; maxX:number; maxY:number }
export interface WorldNpc { npcId:string;name:string;role:string;position:GridPoint;approachCells:GridPoint[];appearance:{lookId:string;catalogVersion:string};serverManaged:true;readOnly:true;actions:never[];status:'service_unavailable';countsAsAgent:false }
export interface WorldMapManifest {
 mapId:string;version:number;layoutUrl:string;layoutSha256:string;geometryDigest:string;
 layoutId?:string;
 walkingRegions?:{id:string;name:string;description:string;roamTargets:GridPoint[]}[];
 source:{width:number;height:number};tileSize:number;origin:GridPoint;bounds:WorldBounds;
 counts:{walkable:number;physicalBlocked:number;unopened:number};singleSurface:true;visualElevationOnly:true;
 buildings:{id:string;name:string;entrance:GridPoint;interior:false}[];
 bridges:{id:string;name:string;deckCells:GridPoint[];bankApproachCells:GridPoint[]}[];
 stairs:{id:string;name:string;cells:GridPoint[];lowerEndpoint:GridPoint;upperEndpoint:GridPoint}[];
 npcs:WorldNpc[];
}
export interface WorldMotion { segmentId:string;movementId:string|null;source:'explicit'|'idle';from:GridPoint;to:GridPoint;startedAt:number;arriveAt:number;rulesetVersion:number;topologyVersion:number;status:'committed' }
