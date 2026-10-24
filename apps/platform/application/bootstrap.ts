import type { M1Store,M1ReadSession } from '../contracts/store.ts';
import { catalogRepository } from '../domains/perception/repository.ts';
import { PERCEPTION_SCHEMA_VERSION } from '../domains/perception/schemas.ts';
import { initializePerceptionCatalog } from './perception-catalog.ts';
/** Explicit local DML bootstrap. Never called by buildApp, health or a request. */
export async function bootstrapPlatformCatalog(store:M1Store):Promise<void> {await store.transaction(initializePerceptionCatalog);}
/** Startup/ready performs no catalog publication, schema migration, seed or identity write. */
export async function verifyApplicationReadiness(store:M1Store):Promise<void> {await store.read(verifyApplicationReadinessInSession);}
export async function verifyApplicationReadinessInSession(tx:M1ReadSession):Promise<void>{
 const catalog=await catalogRepository(tx).get('current');
 if(!catalog||catalog.data.schemaVersion!==PERCEPTION_SCHEMA_VERSION)throw new Error('The exact supported catalog must be initialized explicitly before startup');
 for(const moduleId of ['perception','world','profiles','items','inventory','mailbox','wallet'])if(!await catalogRepository(tx).get(`guide:${moduleId}:${catalog.data.guideVersion}`))throw new Error('A required exact guide is missing');
}
