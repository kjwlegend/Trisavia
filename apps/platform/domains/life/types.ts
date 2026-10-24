import type {GridPoint,WorldMotion} from '../world/types.ts';
import type {OwnerAudienceProof,ExecutionAuthority} from '../access/public.ts';
export type LifeActorRef={kind:'agent'|'npc';id:string};
export const LIFE_COMMANDS=['life.activities.start','life.activities.cancel','life.plans.submit','life.plans.cancel'] as const;
export const LIFE_QUERIES=['life.actions','life.options','life.state','life.activities.get','life.plans.get'] as const;
export type LifeActionId='work.shift'|'rest.bench'|'npc.duty'|'rest.voucher';
export type LifeState='active'|'completed'|'cancelled'|'interrupted';
export type LifeQualification={moduleGeneration:number;recoveryEpoch:string;runtimeVersion:number;membershipVersion:number;policyVersion:number;ownerPauseVersion:number;platformVersion:number;sharingGeneration:number;authority:ExecutionAuthority};
export interface LifeStation {id:string;actionIds:LifeActionId[];capacity:number;cells:GridPoint[];approachCells?:GridPoint[];facing?:string;physical?:boolean}
export interface LifePlace {placeId:string;name:string;parentSceneId:string;anchorBuildingId:string|null;cells:GridPoint[];entrances:GridPoint[];approachCells:GridPoint[];waitingCells:GridPoint[];stations:LifeStation[]}
export interface LifeNpcProfile {id:string;name:string;stage:'A';role:string;buildingId:string;lookId:string;initialPosition:GridPoint;dutyPlaceId:string|null;preferences:Partial<Record<string,number>>}
export interface LifeCatalog {revision:1;ruleVersion:1;activatedAt:number;currency:'star_coin';currencyScale:0;map:{mapId:string;geometryDigest:string;rulesetVersion:number;topologyVersion:number};places:LifePlace[];jobs:{id:'harbor_shift'|'tavern_shift';placeId:string;name:string;durationSeconds:number;coinReward:number;energyCost:number}[];npcPolicy:{initialCoins:number;initialEnergy:number;decisionIntervalSeconds:number;minDwellSeconds:number};npcProfiles:LifeNpcProfile[]}
export interface LifeBody {kind:'activity'|'plan'|'town_rest';id:string;until:number|null}
export interface LifeActor {actorKind:'agent'|'npc';actorId:string;version:number;energy:number;reservedEnergy:number;quota:{day:string;starts:number}[];body:LifeBody|null;activePlanId:string|null;queuedPlanId:string|null;taskId?:string|null;createdAt:number;updatedAt:number}
export interface LifeResult {resultId:string;state:LifeState;code:string;completedAt:number;energyBefore:number;energyAfter:number;energySpent:number;energyRestored:number;coinReward:number;quotaRefunded:boolean;sourceEventId:string}
export interface LifeActivity {
 id:string;version:number;actorKind:'agent'|'npc';actorId:string;actionId:LifeActionId;jobId:string|null;ruleVersion:number;catalogRevision:number;
 placeId:string;stationId:string;seat:number;planId:string|null;stepId:string|null;state:LifeState;startedAt:number;scheduledEndAt:number;endedAt:number|null;
 reservedEnergy:number;rewardAmount:number;energyGain:number;startDay:string;qualification:LifeQualification|null;moduleGeneration:number;ownerAudience:OwnerAudienceProof|null;
 resultId:string|null;sourceEventId:string|null;result:LifeResult|null;
}
export type LifeStep={stepId:string;type:'move.to';placeId:string}|{stepId:string;type:'act';actionId:'work.shift'|'rest.bench';placeId:string;jobId?:'harbor_shift'|'tavern_shift';waitForSeatSeconds?:number};
export type LifePlanState='queued'|'running'|'waiting_condition'|'completed'|'partially_completed'|'failed'|'cancelled'|'expired';
export interface LifePlan {id:string;version:number;actorKind:'agent'|'npc';actorId:string;catalogRevision:number;ruleVersion:number;steps:LifeStep[];nextStep:number;state:LifePlanState;createdAt:number;deadlineAt:number;endedAt:number|null;qualification:LifeQualification|null;moduleGeneration:number;ownerAudience:OwnerAudienceProof|null;currentActivityId:string|null;movementId:string|null;route:GridPoint[];routeIndex:number;waitUntil:number|null;results:{stepId:string;activityId:string|null;resultId:string|null;completedAt:number}[];stopCode:string|null}
export interface LifeNpc {npcId:string;version:number;position:GridPoint;motion:WorldMotion|null;currentGoal:{actionId:LifeActionId|'idle';placeId:string|null}|null;nextDecisionAt:number;decisionSequence:number;recent:{actionId:string;placeId:string;completedAt:number;durationMs:number}[];policyVersion:1;lastDwellAt:number}
export interface LifeSeat {stationId:string;seat:number;actor:LifeActorRef;activityId:string;placeId:string}
export const actorKey=(a:LifeActorRef)=>a.kind+':'+a.id;
