import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyLifeGuideCatalogForStartup} from '../../apps/platform/app.ts';
import type {M1ReadSession} from '../../apps/platform/contracts/store.ts';

test('Life startup accepts the recurring text-only successor and retains the exact catalog gate',async()=>{
 let revision:string|undefined='catalog-recurring-bootstrap-1',reads=0;
 const session={get:async(table:string,id:string)=>{assert.equal(table,'perception_catalog');assert.equal(id,'current');return revision===undefined?undefined:{id:'current',version:1,data:{schemaVersion:8,guideVersion:17,catalogRevision:revision}};}} as unknown as M1ReadSession;
 const store={read:async<T>(work:(reader:M1ReadSession)=>Promise<T>)=>{reads++;return work(session);}};
 await verifyLifeGuideCatalogForStartup(store);
 for(revision of ['catalog-life-a-1','catalog-avatar-assets-1','catalog-avatar-assets-fresh-1'])await verifyLifeGuideCatalogForStartup(store);
 for(revision of [undefined,'catalog-unpublished','catalog-recurring-bootstrap-2'])await assert.rejects(verifyLifeGuideCatalogForStartup(store),(e:any)=>e.code==='life_not_enabled'&&e.statusCode===503);
 assert.equal(reads,7);
});
