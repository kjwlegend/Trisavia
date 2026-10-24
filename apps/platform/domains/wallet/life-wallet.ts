import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';

export interface WalletActorRef {kind:'agent'|'npc';id:string}
export type LifeCreditReason='life.work.reward'|'life.npc.initialization';
export interface LifeWalletAccount {actorRef:WalletActorRef;currencyCode:'star_coin';scale:0;balance:number;accountVersion:number}
export interface LifeWalletCredit {
 id:string;reason:LifeCreditReason;sourceId:string;actorRef:WalletActorRef;currencyCode:'star_coin';amount:number;
 catalogRevision:number;ruleVersion:number;jobId:string|null;sourceEventId:string|null;occurredAt:number;recordedAt:number;
 balanceBefore:number;balanceAfter:number;accountVersionBefore:number;accountVersionAfter:number;
}
/** The lifecycle domain returns its persisted completed row through this same-transaction read port. */
export interface WorkRewardSource {
 id:string;actorKind:'agent'|'npc';actorId:string;actionId:string;jobId:string|null;ruleVersion:number;catalogRevision:number;
 state:string;startedAt:number;scheduledEndAt:number;endedAt:number|null;resultId:string|null;sourceEventId:string|null;rewardAmount:number;
}
/** Financial fields from the one approved runtime life catalog, not caller-supplied reward parameters. */
export interface LifeWalletCatalog {
 revision:number;ruleVersion:number;currency:'star_coin';currencyScale:0;
 jobs:readonly {id:string;coinReward:number;durationSeconds:number}[];
 npcPolicy:{initialCoins:number};npcProfiles:readonly {id:string;stage:string}[];
}
export interface LifeWalletSources {
 catalog:LifeWalletCatalog;
 readCompletedWorkRewardSource(activityId:string):Promise<WorkRewardSource|undefined>;
}
export interface LifeWalletReader {
 getAccount(actorRef:WalletActorRef):Promise<LifeWalletAccount|undefined>;
 getWorkReward(activityId:string):Promise<LifeWalletCredit|undefined>;
 getNpcInitialization(npcId:string):Promise<LifeWalletCredit|undefined>;
}
/** Internal completion/initialization participant only. No transfer, debit or external mint operation. */
export interface LifeWalletRepository extends LifeWalletReader {
 rewardCompletedWork(input:{actorRef:WalletActorRef;activityId:string}):Promise<LifeWalletCredit>;
 initializeNpc(input:{actorRef:WalletActorRef}):Promise<LifeWalletCredit>;
}
export const LIFE_WALLET_REPOSITORY=defineRuntimeRepository<LifeWalletReader,LifeWalletRepository>('wallet.life');
