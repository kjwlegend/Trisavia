import type {CareSnapshot,CareResult,CareIntroductionView} from '../npc-life/types.ts';
import type {LifeCActivitySnapshot,LifeCResult,LifeCTradeTerms,LifeCActionId,LifeCOutputReference} from './c-types.ts';
import type {GridPoint,WorldMotion} from '../world/types.ts';
import type {OwnerAudienceProof,ExecutionAuthority} from '../access/public.ts';
import type {LifeTradeTerms,LifeFishingResult,LifeBudget,LifeOutputReference} from './b-types.ts';
export type LifeActorRef={kind:'agent'|'npc';id:string};
export const LIFE_COMMANDS=['life.activities.start','life.activities.cancel','life.plans.submit','life.plans.cancel'] as const;
export const LIFE_QUERIES=['life.actions','life.options','life.state','life.activities.get','life.plans.get','life.shop.quote','life.items','life.books.get'] as const;
export type LifeActionId='work.shift'|'rest.bench'|'npc.duty'|'rest.voucher'|'shop.buy'|'shop.sell'|'fish.session'|'meal.prepare'|'meal.eat'|'rest.inn'|'book.read'|'visit.place'|'care.introduce'|'care.perform';
export type LifeState='active'|'completed'|'cancelled'|'interrupted';
export type LifeQualification={moduleGeneration:number;recoveryEpoch:string;runtimeVersion:number;membershipVersion:number;policyVersion:number;ownerPauseVersion:number;platformVersion:number;sharingGeneration:number;authority:ExecutionAuthority};
export interface LifeStation {id:string;actionIds:LifeActionId[];capacity:number;cells:GridPoint[];approachCells?:GridPoint[];facing?:string;physical?:boolean}
export interface LifePlace {placeId:string;name:string;parentSceneId:string;anchorBuildingId:string|null;cells:GridPoint[];entrances:GridPoint[];approachCells:GridPoint[];waitingCells:GridPoint[];shopApproachCells?:GridPoint[];stations:LifeStation[]}
export interface LifeNpcProfile {id:string;name:string;stage:'A'|'B'|'C';role:string;buildingId:string|null;lookId:string;hairColorId?:string;clothingColorId?:string;initialPosition:GridPoint;dutyPlaceId:string|null;preferences:Partial<Record<string,number>>}
export interface LifeCatalog {revision:1|2|3;ruleVersion:1;activatedAt:number;currency:'star_coin';currencyScale:0;map:{mapId:string;geometryDigest:string;rulesetVersion:number;topologyVersion:number};places:LifePlace[];jobs:{id:'harbor_shift'|'tavern_shift';placeId:string;name:string;durationSeconds:number;coinReward:number;energyCost:number}[];npcPolicy:{initialCoins:number;initialEnergy:number;decisionIntervalSeconds:number;minDwellSeconds:number};npcProfiles:LifeNpcProfile[];npcLife?:{definitionVersion:1}}
export interface LifeBody {kind:'activity'|'plan'|'town_rest';id:string;until:number|null}
export interface LifeActor {actorKind:'agent'|'npc';actorId:string;version:number;energy:number;reservedEnergy:number;quota:{day:string;starts:number}[];fishingQuota?:{day:string;casts:number}[];body:LifeBody|null;activePlanId:string|null;queuedPlanId:string|null;taskId?:string|null;createdAt:number;updatedAt:number}
export interface LifeResult {resultId:string;state:LifeState;code:string;completedAt:number;energyBefore:number;energyAfter:number;energySpent:number;energyRestored:number;coinReward:number;quotaRefunded:boolean;sourceEventId:string;care?:CareResult;careIntroduction?:CareIntroductionView;c?:LifeCResult;trade?:{effectId:string;moneyDelta:number;itemIds:string[]};fishing?:LifeFishingResult&{unstartedCasts:number}}
export interface LifeActivity {
 id:string;version:number;actorKind:'agent'|'npc';actorId:string;actionId:LifeActionId;jobId:string|null;ruleVersion:number;catalogRevision:number;
 placeId:string;stationId:string;seat:number;planId:string|null;stepId:string|null;state:LifeState;startedAt:number;scheduledEndAt:number;endedAt:number|null;
 reservedEnergy:number;rewardAmount:number;energyGain:number;startDay:string;qualification:LifeQualification|null;moduleGeneration:number;ownerAudience:OwnerAudienceProof|null;
 resultId:string|null;sourceEventId:string|null;result:LifeResult|null;
 care?:CareSnapshot;
 cSource?:LifeCActivitySnapshot;
 cTrade?:LifeCTradeTerms;
 trade?:LifeTradeTerms;
}
export type LifeStep={stepId:string;type:'wait.result';giftId:string;acceptedStates:['accepted']}|{stepId:string;type:'move.to';placeId:string}|{stepId:string;type:'act';actionId:'work.shift'|'rest.bench'|'shop.buy'|'shop.sell'|'fish.session'|LifeCActionId|'care.introduce'|'care.perform';placeId:string;params?:Record<string,unknown>;introductionFrom?:{stepId:string;output:'careIntroduction'};itemsFrom?:LifeOutputReference;itemFrom?:LifeCOutputReference;ifEmpty?:'skip';jobId?:'harbor_shift'|'tavern_shift';waitForSeatSeconds?:number};
export type LifePlanState='queued'|'running'|'waiting_condition'|'completed'|'partially_completed'|'failed'|'cancelled'|'expired';
export interface LifePlan {id:string;version:number;actorKind:'agent'|'npc';actorId:string;catalogRevision:number;ruleVersion:number;budget?:LifeBudget;steps:LifeStep[];nextStep:number;state:LifePlanState;createdAt:number;deadlineAt:number;endedAt:number|null;qualification:LifeQualification|null;moduleGeneration:number;ownerAudience:OwnerAudienceProof|null;remoteWait?:{giftId:string;acceptedStates:['accepted'];enteredAt:number;readyAt:number|null}|null;currentActivityId:string|null;movementId:string|null;route:GridPoint[];routeIndex:number;waitUntil:number|null;results:{stepId:string;activityId:string|null;resultId:string|null;completedAt:number}[];stopCode:string|null}
export interface LifeNpc {npcId:string;version:number;position:GridPoint;motion:WorldMotion|null;currentGoal:{actionId:LifeActionId|'idle';placeId:string|null}|null;nextDecisionAt:number;decisionSequence:number;recent:{actionId:string;placeId:string;completedAt:number;durationMs:number}[];policyVersion:1;lastDwellAt:number}
export interface LifeSeat {stationId:string;seat:number;actor:LifeActorRef;activityId:string;placeId:string}
export const actorKey=(a:LifeActorRef)=>a.kind+':'+a.id;
