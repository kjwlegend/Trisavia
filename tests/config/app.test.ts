import {M1_TABLES} from '../../apps/platform/contracts/store.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { test } from 'node:test';
import { buildApp } from '../../apps/platform/app.ts';
import { postgresFixture } from '../api/postgresql-fixture.ts';
const proof = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
await test('PG factory protects parser/not-found responses and leaves catalog and write generation unchanged on startup/health', async () => { const pg = await postgresFixture(); let app: Awaited<ReturnType<typeof buildApp>> | undefined; const pool = new Pool({ connectionString: pg.migrationConnectionString, max: 1 }); try {
    const before = await pool.query('SELECT write_generation FROM platform.instance_state');
    const catalog = await pg.store.read(async (tx) => await tx.get('perception_catalog', 'current'));
    app = await buildApp(pg.options);
    const health = await app.inject('/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().instanceId, pg.options.instanceId);
    assert.deepEqual((await pool.query('SELECT write_generation FROM platform.instance_state')).rows, before.rows);
    assert.deepEqual(await pg.store.read(async (tx) => await tx.get('perception_catalog', 'current')), catalog);
    const missing = await app.inject('/not-a-route?secret=should-not-reflect');
    assert.equal(missing.statusCode, 404);
    assert(!missing.body.includes('should-not-reflect'));
    const invalid = await app.inject({ method: 'POST', url: '/v1/registrations', headers: { 'content-type': 'application/json' }, payload: '{"sensitive":"should-not-reflect"' });
    assert.equal(invalid.statusCode, 400);
    assert(!invalid.body.includes('should-not-reflect'));
}
finally {
    try {
        if (app)
            await app.close();
    }
    finally {
        await pool.end();
        await pg.dispose();
    }
} });
await test('PG app reopens the same authority and old open apps are fenced after an explicit isolated deployment identity change', async () => { const pg = await postgresFixture(), pool = new Pool({ connectionString: pg.migrationConnectionString, max: 1 }), runtimeToken = proof(); let app = await buildApp(pg.options); try {
    const registered = await app.inject({ method: 'POST', url: '/v1/registrations', payload: { operationId: randomUUID(), attemptId: randomUUID(), runtimeToken, continuationToken: proof() } });
    assert.equal(registered.statusCode, 200);
    await app.close();
    app = await buildApp(pg.options);
    const self = await app.inject({ url: '/v1/agent/self', headers: { authorization: `Bearer ${runtimeToken}` } });
    assert.equal(self.statusCode, 200);
    assert.equal(self.json().agentId, registered.json().agentId);
    await pool.query("UPDATE platform.instance_state SET recovery_epoch='isolated-new-epoch' WHERE singleton=1");
    assert.equal((await app.inject('/health')).statusCode, 503);
    assert.notEqual((await app.inject({ url: '/v1/agent/self', headers: { authorization: `Bearer ${runtimeToken}` } })).statusCode, 200);
    await assert.rejects(buildApp(pg.options));
}
finally {
    await app.close();
    await pool.end();
    await pg.dispose();
} });
await test('closed business writes permit startup, readiness, health and initialized wallet reads without persistent changes',async()=>{
 const pg=await postgresFixture(),pool=new Pool({connectionString:pg.migrationConnectionString,max:1});let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  const runtimeToken=proof();await createM1Service(pg.store).invoke('register',{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken,continuationToken:proof()});
  const snapshot=()=>pg.store.read(async tx=>{const rows=[];for(const table of M1_TABLES)rows.push(await tx.find(table));return JSON.stringify(rows);});const before=await snapshot();
  await pool.query('UPDATE platform.instance_state SET writes_enabled=false WHERE singleton=1');app=await buildApp(pg.options);assert.equal((await app.inject('/health')).statusCode,200);
  const generation=(await pool.query('SELECT write_generation FROM platform.instance_state')).rows;
  const wallet=await app.inject({method:'POST',url:'/v1/wallet/query',headers:{authorization:`Bearer ${runtimeToken}`},payload:{protocolVersion:1,consumerId:'closed-gate-wallet',purpose:'agent-inspect'}});assert.equal(wallet.statusCode,200);assert.equal(wallet.json().data.balance,0);assert.equal(await snapshot(),before);assert.deepEqual((await pool.query('SELECT write_generation FROM platform.instance_state')).rows,generation);
  const rejected=await app.inject({method:'POST',url:'/v1/registrations',payload:{operationId:randomUUID(),attemptId:randomUUID(),runtimeToken:proof(),continuationToken:proof()}});assert.equal(rejected.statusCode,503);assert.equal((await pool.query('SELECT writes_enabled FROM platform.instance_state')).rows[0].writes_enabled,false);
 }finally{if(app)await app.close();await pool.end();await pg.dispose();}
});
await test('the actual application role cannot perform DDL, migration, gate or deployment identity writes',async()=>{
 const pg=await postgresFixture(),pool=new Pool({connectionString:pg.options.connectionString,max:1});try{
  assert.equal((await pool.query('SELECT current_user AS role')).rows[0].role,'connet_app');for(const query of ["CREATE TABLE iam.isolated_forbidden(id integer)","UPDATE platform.instance_state SET writes_enabled=true WHERE singleton=1","UPDATE platform.instance_state SET instance_id='forbidden' WHERE singleton=1","DELETE FROM platform.module_migrations"])await assert.rejects(pool.query(query),(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code==='42501');
 }finally{await pool.end();await pg.dispose();}
});
