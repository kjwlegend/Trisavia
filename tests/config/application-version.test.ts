import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import Fastify from 'fastify';
import {APP_VERSION} from '../../apps/platform/version.ts';
import {registerHealthRoute} from '../../apps/platform/transport/http/health-routes.ts';

test('health reports the package application version separately from the API version and the lock stays aligned',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')),lock=JSON.parse(readFileSync(new URL('../../package-lock.json',import.meta.url),'utf8'));
 assert.equal(APP_VERSION,manifest.version);assert.equal(lock.version,manifest.version);assert.equal(lock.packages[''].version,manifest.version);
 const app=Fastify();let available=true;registerHealthRoute(app,async()=>{if(!available)throw new Error('Synthetic unavailable storage');return {instanceId:'version-test',worldCore:'ready'};});
 try{const healthy=await app.inject('/health');assert.equal(healthy.statusCode,200);assert.equal(healthy.json().appVersion,manifest.version);assert.equal(healthy.json().apiVersion,'1');assert.equal(healthy.json().instanceId,'version-test');assert.equal(healthy.json().worldCore,'ready');
  available=false;const unavailable=await app.inject('/health');assert.equal(unavailable.statusCode,503);assert.equal(unavailable.json().appVersion,manifest.version);assert.equal(unavailable.json().error.code,'storage_unavailable');
 }finally{await app.close();}
});
