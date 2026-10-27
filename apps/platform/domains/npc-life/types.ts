import type {GridPoint,WorldMotion} from '../world/types.ts';
import type {LifeQualification,LifeActivity,LifeCatalog,LifeActorRef} from '../life/types.ts';
import type {OwnerAudienceProof} from '../access/public.ts';
import type {RuntimeReadContext,RuntimeTransaction} from '../../contracts/runtime-store.ts';
export const NPC_LIFE_RULES=Object.freeze({version:1,durationMs:120000,energyCost:6,pointCooldownMs:3600000,actorPointCooldownMs:86400000,maxIntroductionLifetimeMs:1800000});
export type CareKind='water'|'clear';
export interface NpcLifeSprite {kind:'npc_sprite';version:1;assetId:string;manifestUrl:string;digest:string}
export interface NpcLifeMessage {ref:string;version:1;speaker:'npc-gardener'|'system';audience:'public'|'participant';text:string;digest:string}
export interface CareGuide {id:string;version:number;digest:string;title:string;body:string}
export interface CarePointDefinition {pointId:string;careKind:CareKind;name:string;placeId:string;cell:GridPoint;approachCells:GridPoint[];guideRef:{id:string;version:number;digest:string};enabled:boolean;initialMaterialAvailable:boolean}
export interface NpcLifeProfile {npcId:'npc-gardener';name:string;role:string;appearance:NpcLifeSprite;initialPosition:GridPoint;receptionCells:GridPoint[];receptionApproachCells:GridPoint[];placeId:string}
export interface NpcLifeDefinition {id:string;version:1;activatedAt:number;enabledRefs:string[];map:{mapId:'pixel-town-v2';rulesetVersion:6;topologyVersion:6;geometryDigest:string};spatialRef:{url:string;revision:number;sha256:string};npcs:NpcLifeProfile[];carePoints:CarePointDefinition[];guides:CareGuide[]}
export interface CarePoint {pointId:string;version:number;activeActivityId:string|null;lastCareAt:number|null;careKind:CareKind;materialAvailable:boolean;actorId:string|null;lastActivityId:string|null;nextEligibleAt:number|null}
export interface CareIntroduction {introductionId:string;version:number;agentId:string;npcId:'npc-gardener';pointId:string;pointVersion:number;planId:string;careKind:CareKind;definitionVersion:1;guideRef:{id:string;version:number;digest:string};createdAt:number;expiresAt:number;sourceActivityId:string;sourceEventId:string;consumedByActivityId:string|null;qualification:LifeQualification;ownerAudience:OwnerAudienceProof|null}
export interface CareSnapshot {definitionVersion:1;pointId:string;pointVersion:number;careKind:CareKind;introductionId:string;guideRef:{id:string;version:number;digest:string}}
export interface CareResult {pointId:string;careKind:CareKind;completed:boolean;pointVersion:number|null;lastCareAt:number|null;nextEligibleAt:number|null;message:NpcLifeMessage}
export interface CareFact {activityId:string;pointId:string;agentId:string;careKind:CareKind;completedAt:number;pointVersion:number;sourceEventId:string;publicSharingGeneration:number|null;ownerAudience:OwnerAudienceProof|null}
export interface CarePointView {pointId:string;version:number;careKind:CareKind;name:string;placeId:string;cell:GridPoint;approachCells:GridPoint[];available:boolean;reason:string|null;nextEligibleAt:number|null;lastCareAt:number|null;actorId?:string;guideRef:{id:string;version:number;digest:string}}
export interface CareIntroductionView {message:NpcLifeMessage;introductionId:string;version:number;npcId:'npc-gardener';agentId:string;planId:string;careKind:CareKind;pointId:string;pointVersion:number;guideRef:{id:string;version:number;digest:string};createdAt:number;expiresAt:number;consumedByActivityId:string|null}
export interface NpcLifeDirectory {worldId:'default';definitionVersion:1;ruleVersion:1;map:NpcLifeDefinition['map'];spatialRef:NpcLifeDefinition['spatialRef'];npcs:NpcLifePublicActor[];carePoints:CarePointView[];guides:CareGuide[];rules:typeof NPC_LIFE_RULES;asOf:number}
export interface CareOptions {agentId:string;definitionVersion:1;energy:{available:number;required:6};points:{pointId:string;version:number;available:boolean;reason:string|null;nextEligibleAt:number|null;introduction:CareIntroductionView|null}[];asOf:number}
/** Only the Life application calls these hooks inside its existing transaction/authorization chain. */
export interface NpcLifeParticipant {
 extendDirectory(ctx:RuntimeReadContext,value:import('../../contracts/store.ts').JsonObject):Promise<import('../../contracts/store.ts').JsonObject>;
 supportsNpc(ctx:RuntimeReadContext,npcId:string):Promise<boolean>;
 advanceNpc(ctx:RuntimeTransaction,npcId:string):Promise<boolean>;
 currentNpcs(ctx:RuntimeReadContext):Promise<import('../town-services/types.ts').CurrentTownNpc[]>;
 npcIdentity(ctx:RuntimeReadContext,npcId:string):Promise<{name:string;appearance:NpcLifeSprite;publishedVersion:number;publicId?:string}|null>;
 effectiveCatalog(ctx:RuntimeReadContext,catalog:LifeCatalog):Promise<LifeCatalog>;
 lockIntroduction(ctx:RuntimeTransaction):Promise<void>;
 introduce(ctx:RuntimeTransaction,activity:LifeActivity,input:unknown):Promise<CareIntroductionView>;
 careTerms(ctx:RuntimeTransaction,actor:LifeActorRef,input:{placeId:string;params:unknown;planId?:string},qualification:LifeQualification|null):Promise<CareSnapshot>;
 reserveCare(ctx:RuntimeTransaction,activity:LifeActivity):Promise<void>;
 careResult(ctx:RuntimeTransaction,activity:LifeActivity):Promise<CareResult>;
 settleCare(ctx:RuntimeTransaction,activity:LifeActivity):Promise<void>;
}
export interface NpcLifePublicActor {identity?:import('../town-services/npc-identity.ts').NpcIdentity;npcId:'npc-gardener';version:number;name:string;role:string;position:GridPoint;motion:WorldMotion|null;appearance:NpcLifeSprite;present:boolean;busy:boolean}
