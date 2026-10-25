import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {worldFixture} from '../runtime/postgresql-fixture.ts';
import {bootstrapWorld,createWorldService} from '../../apps/platform/application/world-service.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {worldGatewayGuide,worldGatewayOperations,worldPublicReads} from '../../apps/platform/application/agent-gateway-world.ts';
import {publicWorldReadStatus} from '../../apps/platform/application/public-world-read-cache.ts';
import {publicWorldReadPool} from '../../apps/platform/domains/world/public-read-revision.ts';

test('real PG production runtime metadata reaches Gateway; two public scopes leave a private and writer connection, then a real leave invalidates the cut',{skip:!process.env.WORLD_CORE_TEST_RUNTIME},async()=>{
 const f=await worldFixture({bootstrap:false});let release!:()=>void,entered!:()=>void;const blocker=new Promise<void>(r=>release=r),both=new Promise<void>(r=>entered=r);let blocked=0,hold=true;
 try{const resource=JSON.parse(await readFile(join(f.privateConnections,'created-database.json'),'utf8'));console.info(JSON.stringify({publicReadPgResource:{database:f.database,oid:resource.oid,creator:resource.creator}}));await f.runtime.transaction(bootstrapWorld);const a=await f.register(),world=createWorldService(f.access);assert.deepEqual(publicWorldReadPool(f.runtime),{poolMax:4,publicConcurrency:2});
  const gateway=createAgentGateway({store:f.runtime,identity:f.access,operations:worldGatewayOperations(world),publicReads:worldPublicReads(world).map(read=>({...read,read:async(ctx,input)=>{if(hold&&read.id==='world.public_scene'){if(++blocked===2)entered();await blocker;}return read.read(ctx,input);}})),guides:[worldGatewayGuide]});
  const body=(operation:string,input:object,commandId=randomUUID())=>({protocolVersion:1,consumerId:'pg-public-read-pool',purpose:'agent-manual',operation,input,commandId});
  const created=await gateway.command(body('world.avatar.create',{worldId:'default',expectedRulesetVersion:1}),a.runtimeToken,()=>true);assert.equal(created.outcome,'committed');
  const one=gateway.publicRead('world.public_scene',{worldId:'default',limit:1},()=>true),two=gateway.publicRead('world.public_scene',{worldId:'default',limit:2},()=>true);await both;
  assert.equal((publicWorldReadStatus(f.runtime) as any).active,2,'Production store identity hits the registered coordinator, not the fixture fallback');
  const privateRead=await Promise.race([f.runtime.read(async ctx=>({instanceId:ctx.instanceId,receipt:await ctx.commands.get({domain:'world',action:'world.avatar.create',commandId:created.key.commandId,principal:created.key.principal,recoveryEpoch:f.identity.recoveryEpoch})})),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Private reader could not obtain its reserved runtime connection')),2000);timer.unref();})]);assert.equal(privateRead.receipt!.outcome,'committed');
  let writerFinished=false;const writer=gateway.command(body('world.avatar.leave',{worldId:'default',expectedVersion:1}),a.runtimeToken,()=>true).then(r=>{writerFinished=true;return r;});
  let waiting=0;for(let n=0;n<15;n++){const rows=await f.appQuery("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'");waiting=rows[0]!.n;if(waiting)break;await new Promise(r=>setTimeout(r,20));}assert.equal(waiting,1,'The writer has a real backend connection and waits on the original snapshot lock, not the pool');assert.equal(writerFinished,false);
  hold=false;release();const [first,second,left]=await Promise.all([one,two,writer]);assert.equal(left.outcome,'committed');assert.equal((first.avatars as unknown[]).length,1);assert.equal((second.avatars as unknown[]).length,1);
  const after=await gateway.publicRead('world.public_scene',{worldId:'default',limit:1},()=>true);assert.deepEqual(after.avatars,[],'Committed participation change invalidates even an unexpired completed public cut');
  const stats=publicWorldReadStatus(f.runtime) as any;assert.equal(stats.poolMax,4);assert.equal(stats.publicConcurrency,2);assert.equal(stats.maximumActive,2);assert.equal(stats.active,0);assert.equal(stats.queued,0);assert.equal(stats.clients,0);gateway.closePublicWorldReads();
  console.info(JSON.stringify({publicReadPgEvidence:{poolMax:4,publicMaximum:2,privateConnectionSucceeded:true,writerBackendObserved:true,actualLeaveInvalidated:true,fixtureFallback:false}}));
 }finally{hold=false;release?.();await f.dispose();}
});
