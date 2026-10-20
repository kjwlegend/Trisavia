import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import Fastify from 'fastify';
import {postgresFixture} from './postgresql-fixture.ts';
import {M1_TABLES,StorageError,type M1Store} from '../../apps/platform/contracts/store.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
const token=()=>`${randomUUID()}.${randomBytes(32).toString('base64url')}`;
test('a lost commit acknowledgement returns a safe unknown result and recovers the exact original operation without automatic replay',async t=>{
 const pg=await postgresFixture();t.after(()=>pg.dispose());let callbacks=0,lost=true;
 const port:M1Store={instanceId:pg.store.instanceId,recoveryEpoch:pg.store.recoveryEpoch,read:work=>pg.store.read(work),close:async()=>{},transaction:async work=>{callbacks++;const result=await pg.store.transaction(work);if(lost){lost=false;throw new StorageError('unknown_commit','Synthetic lost acknowledgement');}return result;}};
 const service=createM1Service(port),app=Fastify({logger:false});registerM1Routes(app,service);t.after(()=>app.close());
 const runtimeToken=token(),input={operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken:token()};
 const failed=await app.inject({method:'POST',url:'/v1/registrations',payload:input});assert.equal(failed.statusCode,503);assert.equal(failed.json().error.code,'commit_result_unknown');assert(!failed.body.includes(runtimeToken));assert.equal(callbacks,1);
 const snapshot=()=>pg.store.read(async tx=>{const all=[];for(const table of M1_TABLES)all.push(await tx.find(table));return JSON.stringify(all);});const before=await snapshot();
 const receipt=await service.invoke('receipt',{operationId:input.operationId,scope:`registration:${input.attemptId}`,action:'register'},runtimeToken);assert.equal(receipt.outcome,'committed');assert.equal(receipt.operationId,input.operationId);
 assert.deepEqual(await service.invoke('register',input),receipt);assert.equal(await snapshot(),before);assert.equal(await pg.store.read(async tx=>tx.count('operations',{operationId:input.operationId},10)),1);
});
