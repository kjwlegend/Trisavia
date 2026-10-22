import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Fastify from 'fastify';
import {registerSiteRoutes} from '../../apps/platform/transport/http/site-routes.ts';

test('the production static route serves the original audio bytes and preserves its public-path boundary',async()=>{
 const app=Fastify();registerSiteRoutes(app);
 try{
  const response=await app.inject({method:'GET',url:'/assets/audio/town-v1/manifest.json'});assert.equal(response.statusCode,200);const manifest=response.json();assert.equal(Object.keys(manifest.sfx).length,12);
  for(const asset of [manifest.bgm,manifest.sfx['ui-confirm']])for(const source of asset.sources){const read=await app.inject({method:'GET',url:source.url});assert.equal(read.statusCode,200);assert.equal(read.headers['content-type'].split(';')[0],source.type.split(';')[0]);assert.equal(read.headers['x-content-type-options'],'nosniff');assert.equal(createHash('sha256').update(read.rawPayload).digest('hex'),source.sha256);}
  assert.equal((await app.inject({method:'GET',url:'/assets/%2e%2e/%2e%2e/package.json'})).statusCode,404);
  assert.equal((await app.inject({method:'GET',url:'/assets/audio/town-v1/missing.wav'})).statusCode,404);
 }finally{await app.close();}
});
