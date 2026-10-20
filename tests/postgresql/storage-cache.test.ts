import assert from 'node:assert/strict';
import test,{after,beforeEach} from 'node:test';
import { Pool } from 'pg';
import { createPostgresSession } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { admin,applicationOptions,row,resetFixture,testStore } from './storage-fixture.ts';

beforeEach(resetFixture);after(()=>admin.end());
test('RR scope get cache is lazy, coalesces misses and hits, clones values and invalidates on mutations',async()=>{
  const store=await testStore();await store.transaction(tx=>tx.insert('agents',row('a',{runtimeActive:true})));
  const pool=new Pool({connectionString:applicationOptions.connectionString,max:1}),client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query('SELECT singleton FROM platform.instance_state WHERE singleton=1 FOR UPDATE');await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1');
    const original=client.query.bind(client);let queries=0;
    client.query=((...args:unknown[])=>{queries++;return Reflect.apply(original,client,args);}) as typeof client.query;
    const tx=createPostgresSession(client,true,()=>true);assert.equal(queries,0);
    const [first,second]=await Promise.all([tx.get('agents','a'),tx.get('agents','a')]);assert.equal(queries,1);assert.deepEqual(first,second);
    first!.data.runtimeActive=false;assert.equal((await tx.get('agents','a'))?.data.runtimeActive,true);assert.equal(queries,1);
    await Promise.all([tx.get('agents','missing'),tx.get('agents','missing')]);assert.equal(queries,2);assert.equal(await tx.get('agents','missing'),undefined);assert.equal(queries,2);
    const list=await tx.find('agents');const beforeGet=queries;list[0]!.data.runtimeActive=false;assert.equal((await tx.get('agents','a'))?.data.runtimeActive,true);assert.equal(queries,beforeGet);
    await tx.update('agents',row('a',{runtimeActive:false},2),1);assert.equal((await tx.get('agents','a'))?.data.runtimeActive,false);
    await tx.insert('agents',row('missing',{runtimeActive:true}));assert.equal((await tx.get('agents','missing'))?.data.runtimeActive,true);
    const scanned=await tx.scan('agents',{}, {limit:10}),afterScan=queries;scanned[0]!.data.runtimeActive=true;assert.equal((await tx.get('agents','a'))?.data.runtimeActive,false);assert.equal(queries,afterScan);
    assert.equal(await tx.update('agents',row('a',{runtimeActive:true},2),1),false);assert.equal((await tx.get('agents','a'))?.data.runtimeActive,false);
    assert.equal(await tx.remove('agents','a',2),true);assert.equal(await tx.get('agents','a'),undefined);const afterMiss=queries;assert.equal(await tx.get('agents','a'),undefined);assert.equal(queries,afterMiss);
    client.query=original;await client.query('ROLLBACK');
  }finally{client.release();await pool.end();await store.close();}
});

test('store scopes never reuse the previous authorization scope get cache',async()=>{
  const store=await testStore();try{
    await store.transaction(tx=>tx.insert('agents',row('a',{runtimeActive:true})));
    const old=await store.read(async tx=>{const value=(await tx.get('agents','a'))!;value.data.runtimeActive=false;assert.equal((await tx.get('agents','a'))?.data.runtimeActive,true);return value;});assert.equal(old.data.runtimeActive,false);
    await store.transaction(async tx=>{const before=(await tx.get('agents','a'))!;await tx.update('agents',row('a',{runtimeActive:false},before.version+1),before.version);assert.equal((await tx.get('agents','a'))?.data.runtimeActive,false);});
    assert.equal((await store.read(tx=>tx.get('agents','a')))?.data.runtimeActive,false);
  }finally{await store.close();}
});
