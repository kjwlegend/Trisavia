import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresFixture, testApplication } from '../api/postgresql-fixture.ts';
import { buildApp } from '../../apps/platform/app.ts';
import { seedWs02DemoData } from '../../apps/platform/application/perception-seed.ts';
import { agentFixture, injectApi, ownerFixture } from '../../scripts/agent-manager-qa-fixture.ts';

test('same origin serves readable agent Markdown with private response and document security defaults', async () => {
  const app = await testApplication();
  try {
    for (const name of ['entry.md', 'http-api.md', 'local-setup.md', 'prompt.md']) {
      const response = await app.inject(`/agent/${name}`);
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type']!, /^text\/markdown/);
      assert.match(response.body, /^#/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
    }
    const health = await app.inject('/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('five waves of four real HTTP content lists stay complete inside the fixed read capacity', {timeout:30_000}, async t=>{
  const pg=await postgresFixture();let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try{
    app=await buildApp({...pg.options,email:{mode:'experience'}});const api=injectApi(app),owner=await ownerFixture(api,'Capacity'),agent=await agentFixture(api,owner,'隔离容量 Agent','blue');
    await seedWs02DemoData(pg.store,{actorId:'site-capacity-fixture'});const origin=await app.listen({host:'127.0.0.1',port:0}),headers={authorization:`Bearer ${agent.runtimeToken}`,'content-type':'application/json'};
    const capabilities=await fetch(`${origin}/v1/capabilities`,{headers,redirect:'error'});assert.equal(capabilities.status,200);const discovery=await fetch(`${origin}/v1/perception/discovery`,{headers,redirect:'error'});assert.equal(discovery.status,200);
    const input={protocolVersion:1,channel:'world',categoryId:'items',consumerId:'site-capacity-http',purpose:'agent-perception',limit:50};
    async function read(){const started=performance.now(),response=await fetch(`${origin}/v1/perception/list`,{method:'POST',headers,body:JSON.stringify(input),redirect:'error'}),body=await response.json() as {error?:{code?:string};data?:{complete:boolean;records:{ref:{id:string}}[]}};assert.equal(response.status,200,body.error?.code??'list must remain available');assert.equal(body.data?.complete,true);return {ids:body.data!.records.map(record=>record.ref.id),elapsed:performance.now()-started};}
    const baseline=await read();assert.equal(baseline.ids.length,14);const durations:number[]=[];
    for(let wave=0;wave<5;wave++){const group=await Promise.all(Array.from({length:4},()=>read()));for(const result of group){assert.deepEqual(result.ids,baseline.ids);durations.push(result.elapsed);}}
    const p95=durations.toSorted((a,b)=>a-b)[Math.ceil(durations.length*.95)-1]!;assert.ok(p95<=5000,`HTTP list p95 ${p95}ms exceeds the fixed 5s capacity`);
    t.diagnostic(JSON.stringify({transport:'real loopback HTTP',applicationRole:'connet_app',waves:5,concurrency:4,requests:durations.length,status200:durations.length,p95Ms:Math.round(p95*100)/100,maximumMs:Math.round(Math.max(...durations)*100)/100,contentDeadlineMs:250}));
  }finally{try{await app?.close();}finally{await pg.dispose();}}
});

test('site does not expose repository files, credential files, or traversal through asset routes', async () => {
  const app = await testApplication();
  try {
    for (const url of [
      '/.env', '/package.json', '/docs/planning/session-registry.md',
      '/assets/..%2F..%2F..%2Fpackage.json', '/assets/..%2F..%2F..%2F.env',
      '/agent/..%2F..%2Fpackage.json', '/assets/index.html',
    ]) {
      const response = await app.inject(url);
      assert.equal(response.statusCode, 404);
      assert.ok(!response.body.includes('schema_migrations'));
    }
  } finally { await app.close(); }
});
