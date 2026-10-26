import {createWorldExpressionRepository} from './world-expressions-repository.ts';
import {createLifeCObservationRepository,readLifeCActivitySource,readLifeCTradeSource} from './life-c-repository.ts';
import {createRelationshipGiftRepository,readRelationshipGiftSource} from './relationships-gifts-repository.ts';
import {createLifeCCommerceRepository} from './life-c-commerce-repository.ts';
import {LIFE_C_RULES,LIFE_C_RUNTIME_RULES} from '../../domains/life/c-catalog.ts';
import {createLifeFishingRepository,readLifeTradeSource,readLifeFishingSessionSource,readLifeFishingCastSource} from './life-b-repository.ts';
import {createLifeCommerceRepository} from './life-commerce-repository.ts';
import {createPublicWorldReadRevisionRepository} from './public-world-read-revision-repository.ts';
import {registerPublicWorldReadPool} from '../../domains/world/public-read-revision.ts';
import {LIFE_ASSET_RULES} from '../../domains/life/b-catalog.ts';
import {createAvatarAssetRepository} from './avatar-assets-repository.ts';
import {createLifeRepository,readCompletedWorkRewardSource} from './life-repository.ts';
import {createLifeWalletRepository} from './life-wallet-repository.ts';
import {createPublicIdentifierRepository} from './public-identifiers-repository.ts';
import {createResidentGiftRepository} from './resident-gift-repository.ts';
import {createWelcomeCreditRepository} from './welcome-credit-repository.ts';
import {createBehaviorRepository} from './behavior-repository.ts';
import {createTownRepository} from './town-services-repository.ts';
import {createServiceInventoryRepository} from './service-inventory-repository.ts';
import {createOwnerMailboxRepository} from './owner-mailbox-repository.ts';
import { StorageError, type M1ReadSession } from '../../contracts/store.ts';
import type { RuntimeStore, RuntimeReadContext, RuntimeTransaction, RuntimeRepositoryPort } from '../../contracts/runtime-store.ts';
import { openPostgresTransactionHost, type OpenPostgresStoreOptions, type PostgresScope } from './transaction-host.ts';
import { createPostgresReadSession, createPostgresSession, invalidatePostgresSession } from './postgres-store.ts';
import { createRuntimeRepositories } from './runtime-repositories.ts';
import { runtimeSql } from './runtime-sql.ts';
import { createWorldRepository } from './world-repository.ts';
import { createInteractionRepository } from './interaction-repository.ts';
import { createDecisionRepository } from './decision-repository.ts';
import { createRelationshipsRepository } from './relationships-repository.ts';

export interface OpenRuntimeStoreOptions extends OpenPostgresStoreOptions { now?:()=>number }
const identities=new WeakMap<object,{scope:PostgresScope;session:M1ReadSession}>();
/** Composition-root resolver only. Domains/Gateway receive IdentityAccess, never generic M1 tables. */
export function runtimeIdentitySession(context:RuntimeReadContext):M1ReadSession{
 const found=identities.get(context);if(!found)throw new StorageError('invalid_usage','Unknown runtime context');
 if(!found.scope.alive())throw new StorageError('closed','Runtime scope has ended');return found.session;
}
/** Composition only: caller owns the guarded client/transaction and write-gate validation. */
export function createPostgresRuntimeContext(scope:PostgresScope,options:OpenRuntimeStoreOptions):RuntimeTransaction{
 const sql=runtimeSql(scope,options.now??Date.now),legacy=createPostgresSession(scope.client,false,scope.alive);
 const core=createRuntimeRepositories(sql,options.recoveryEpoch);
 const adapters=[createWorldExpressionRepository(sql),createPublicWorldReadRevisionRepository(sql),createAvatarAssetRepository(sql),createLifeRepository(sql),createLifeCObservationRepository(sql),createRelationshipGiftRepository(sql),createLifeCCommerceRepository(sql,{catalog:LIFE_C_RULES,readTradeSource:id=>readLifeCTradeSource(sql,id),readCActivitySource:id=>readLifeCActivitySource(sql,id),readGiftSource:id=>readRelationshipGiftSource(sql,id)}),createLifeFishingRepository(sql),createLifeCommerceRepository(sql,{catalog:LIFE_ASSET_RULES,readTradeSource:id=>readLifeTradeSource(sql,id),readFishingSessionSource:id=>readLifeFishingSessionSource(sql,id),readFishingCastSource:id=>readLifeFishingCastSource(sql,id)}),createLifeWalletRepository(sql,{catalog:LIFE_C_RUNTIME_RULES,readCompletedWorkRewardSource:id=>readCompletedWorkRewardSource(sql,id)}),createPublicIdentifierRepository(scope.client,scope.write,scope.alive),createWorldRepository(sql),createInteractionRepository(sql),createDecisionRepository(sql,options.recoveryEpoch),createRelationshipsRepository(sql),createBehaviorRepository(sql),createTownRepository(sql),createServiceInventoryRepository(sql),createOwnerMailboxRepository(sql),createWelcomeCreditRepository(sql),createResidentGiftRepository(sql)];
 const repositories=new Map<object,{reader:unknown;writer:unknown}>();
 for(const adapter of adapters)repositories.set(adapter.port,{reader:Object.freeze(adapter.reader),writer:Object.freeze(adapter.writer)});
 const base={instanceId:options.instanceId,recoveryEpoch:options.recoveryEpoch,now:sql.now,
  repository<R,W extends R>(port:RuntimeRepositoryPort<R,W>):R|W{sql.alive();const registered=repositories.get(port);if(!registered)throw new StorageError('invalid_usage','Unregistered runtime repository');return (scope.write?registered.writer:registered.reader) as R|W;},
  commands:scope.write?core.commands:Object.freeze({get:core.commands.get}),
  events:scope.write?core.events:Object.freeze({get:core.events.get,list:core.events.list}),
  tasks:scope.write?core.tasks:Object.freeze({get:core.tasks.get,list:core.tasks.list,currentGeneration:core.tasks.currentGeneration}),
  outbox:scope.write?core.outbox:Object.freeze({get:core.outbox.get,list:core.outbox.list}),
 };
 const context=Object.freeze(scope.write?{...base,validateBeforeCommit(check:(ctx:RuntimeTransaction)=>Promise<void>){sql.writable();if(typeof check!=='function')throw new StorageError('invalid_usage','A commit validator is required');scope.beforeCommit(()=>check(context));},async attempt<T>(work:(context:RuntimeTransaction)=>Promise<T>):Promise<T>{sql.writable();invalidatePostgresSession(legacy);try{return await scope.attempt(()=>work(context as RuntimeTransaction));}finally{invalidatePostgresSession(legacy);}}}:base) as RuntimeTransaction;
 identities.set(context,{scope,session:createPostgresReadSession(legacy)});
 return context;
}
/** Verifies existing module history and instance identity. Never migrates, seeds, or opens the write gate. */
export async function openRuntimeStore(options:OpenRuntimeStoreOptions):Promise<RuntimeStore>{
 if(options.now!==undefined&&typeof options.now!=='function')throw new StorageError('invalid_usage','A clock must be a function');
 const host=await openPostgresTransactionHost(options);
 function invoke<T>(scope:PostgresScope,work:(context:RuntimeTransaction)=>Promise<T>):Promise<T>{if(typeof work!=='function')throw new StorageError('invalid_usage','A runtime callback is required');const value=work(createPostgresRuntimeContext(scope,options));if(!value||typeof value.then!=='function')throw new StorageError('invalid_usage','Runtime callbacks must be asynchronous');return value;}
 const store=Object.freeze({instanceId:host.instanceId,recoveryEpoch:host.recoveryEpoch,
  read:<T>(work:(context:RuntimeReadContext)=>Promise<T>)=>host.read(scope=>invoke(scope,work)),
  transaction:<T>(work:(context:RuntimeTransaction)=>Promise<T>)=>host.transaction(scope=>invoke(scope,work)),close:()=>host.close()});
 registerPublicWorldReadPool(store,options.poolMax??4);return store;
}
export const openPostgresRuntimeStore=openRuntimeStore;
