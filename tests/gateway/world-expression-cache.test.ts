import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {WORLD_EXPRESSION_GUIDE} from '../../apps/platform/application/world-expression-guide.ts';
import {createPublicWorldReader,type PublicWorldBundle} from '../../apps/platform/application/public-world-read-cache.ts';
import {registerPublicWorldReadPool} from '../../apps/platform/domains/world/public-read-revision.ts';
import type {RuntimeReadContext,RuntimeStore} from '../../apps/platform/contracts/runtime-store.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';

const requests=[{id:'world.public_rules',input:{worldId:'default'}},{id:'world.public_scene',input:{worldId:'default',limit:50}}];
function fixture(){
 let wall=Date.UTC(2026,9,26),monotonic=0,generation=1,gate=true,active=0;
 const instanceId='expression-cache-fixture',recoveryEpoch='expression-cache-epoch';
 const store:RuntimeStore={instanceId,recoveryEpoch,async read(work){active++;try{return await work({instanceId,recoveryEpoch,now:()=>wall,repository:()=>({read:async()=>({instanceId,recoveryEpoch,writeGeneration:String(generation),writeGate:gate})})} as unknown as RuntimeReadContext);}finally{active--;}} ,async transaction(){throw Error('No fixture business writes');},async close(){}};
 registerPublicWorldReadPool(store,4);
 const expression=(remaining:number,kind='speech'):JsonObject=>({expressionId:'original-expression',kind,origin:'agent_authored',actor:{kind:'agent',id:'synthetic-agent'},worldId:'default',sceneId:'default:pixel-town-v2',createdAt:wall+remaining-(kind==='speech'?12000:6000),expiresAt:wall+remaining,text:kind==='speech'?'明确选择的公开短句':null,emoteId:kind==='emote'?'joy':null,sourceActivityId:null});
 const bundle=(expressions:JsonObject[]):PublicWorldBundle=>({instanceId,asOf:wall,results:{'world.public_rules':{worldId:'default',generation},'world.public_scene':{worldId:'default',asOf:wall,expressions:expressions.filter(e=>Number(e.expiresAt)>wall)}}});
 return{store,expression,bundle,now:()=>monotonic,advance:(n:number)=>{wall+=n;monotonic+=n;},advanceWall:(n:number)=>{wall+=n;},change:()=>{generation++;},gate:(v:boolean)=>{gate=v;generation++;},get active(){return active;}};
}
const expressions=(bundle:PublicWorldBundle)=>bundle.results['world.public_scene']!.expressions as JsonObject[];

test('cached expressions stop at their original earliest TTL; repeated reads never renew the payload',async()=>{
 for(const kind of ['speech','emote']){
  const f=fixture(),source=f.expression(120,kind);let builds=0;
  const reader=createPublicWorldReader(f.store,'expressions',async()=>{builds++;return f.bundle([source]);},f.now)!;
  try{
   const first=await reader.read(requests);f.advance(60);assert.deepEqual(await reader.read(requests),first);f.advance(59);assert.deepEqual(await reader.read(requests),first);assert.equal(builds,1);
   f.advance(1);assert.deepEqual(expressions(await reader.read(requests)),[]);assert.equal(builds,2);assert.equal(source.expiresAt,Number(source.createdAt)+(kind==='speech'?12000:6000));
  }finally{reader.close();}assert.equal(f.active,0);
 }
});

test('expression expiry respects both current server time and total build duration',async()=>{
 const f=fixture(),source=f.expression(80);let builds=0;
 const reader=createPublicWorldReader(f.store,'wall-jump',async()=>{builds++;return f.bundle([source]);},f.now)!;
 try{await reader.read(requests);f.advanceWall(80);assert.deepEqual(expressions(await reader.read(requests)),[]);assert.equal(builds,2,'Current guarded server time invalidates a still-young monotonic cache');}finally{reader.close();}
 const slow=fixture(),short=slow.expression(40);let slowBuilds=0;
 const delayed=createPublicWorldReader(slow.store,'slow',async()=>{slowBuilds++;const value=slow.bundle([short]);if(slowBuilds===1)slow.advance(50);return value;},slow.now)!;
 try{await delayed.read(requests);assert.equal(delayed.inspect().cacheEntries,0,'A build cannot retain an expression that expired while it ran');assert.deepEqual(expressions(await delayed.read(requests)),[]);assert.equal(slowBuilds,2);}finally{delayed.close();}
});

test('singleflight followers revalidate expression expiry after waiting without extending it',async()=>{
 const f=fixture(),source=f.expression(50);let release!:()=>void,entered!:()=>void,builds=0;
 const wait=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const reader=createPublicWorldReader(f.store,'followers',async()=>{builds++;const value=f.bundle([source]);if(builds===1){entered();await wait;}return value;},f.now)!;
 try{const first=reader.read(requests);await started;const second=reader.read(requests);await new Promise<void>(r=>setImmediate(r));f.advance(50);release();await first;assert.deepEqual(expressions(await second),[]);assert.equal(builds,2);assert.equal(reader.inspect().clients,0);assert.equal(f.active,0);}finally{release();reader.close();}
});

test('expression deadline does not replace generation, closed-gate, legacy or byte-limit protections',async()=>{
 const f=fixture(),source=f.expression(12000);let builds=0,visible=true,padding='';
 const reader=createPublicWorldReader(f.store,'guards',async()=>{builds++;const value=f.bundle(visible?[source]:[]);if(padding)value.results.padding={text:padding};return value;},f.now)!;
 try{
  await reader.read(requests);f.advance(249);await reader.read(requests);assert.equal(builds,1);f.advance(1);await reader.read(requests);assert.equal(builds,2,'The original 250ms ceiling still applies to a 12s speech');
  visible=false;f.change();assert.deepEqual(expressions(await reader.read(requests)),[]);assert.equal(builds,3);
  f.gate(false);await reader.read(requests);await reader.read(requests);assert.equal(builds,5);assert.equal(reader.inspect().cacheEntries,0);
  f.gate(true);padding='x'.repeat(1_048_576);await reader.read(requests);await reader.read(requests);assert.equal(reader.inspect().cacheEntries,0);assert.equal(reader.inspect().cacheBytes,0);
 }finally{reader.close();}
 const legacy=fixture();let legacyBuilds=0;
 const old=createPublicWorldReader(legacy.store,'legacy',async()=>{legacyBuilds++;const v=legacy.bundle([]);delete v.results['world.public_scene']!.expressions;return v;},legacy.now)!;
 try{await old.read(requests);legacy.advance(249);await old.read(requests);assert.equal(legacyBuilds,1);legacy.advance(1);await old.read(requests);assert.equal(legacyBuilds,2);}finally{old.close();}
});

test('invalid or unbounded expression expiration sources never enter the shared cache',async()=>{
 for(const invalid of [null,[{expiresAt:'untrusted'}],Array.from({length:17},()=>({expiresAt:1})),[{expiresAt:1,text:'x'.repeat(8192)}]]){
  const f=fixture(),reader=createPublicWorldReader(f.store,'invalid',async()=>{const value=f.bundle([]);value.results['world.public_scene']!.expressions=invalid;return value;},f.now)!;
  try{for(let i=0;i<2;i++)await assert.rejects(reader.read(requests),(e:{code?:string})=>e.code==='invalid_usage');assert.equal(reader.inspect().cacheEntries,0);assert.equal(f.active,0);}finally{reader.close();}
 }
});


test('expression guide matches the frozen semantic contract and uses only the existing discovery/command/receipt transport',async()=>{
 const policy=JSON.parse(await readFile(new URL('../../docs/workstreams/ws03-interaction/life-journal-v1/event-expression-map.json',import.meta.url),'utf8'));
 assert.equal(policy.expressionKinds.speech.ttlMs,12000);for(const kind of ['emote','status','ambient'])assert.equal(policy.expressionKinds[kind].ttlMs,6000);
 for(const emote of policy.emotes)assert(WORLD_EXPRESSION_GUIDE.includes(`${emote.id}（${emote.label}）`));
 assert(WORLD_EXPRESSION_GUIDE.includes('say的input是{worldId,intentExpiresAt,text}'));assert(WORLD_EXPRESSION_GUIDE.includes('emote的input是{worldId,intentExpiresAt,emoteId}'));
 for(const term of ['world.expression.say','world.expression.emote','inputSchema','outputSchema','usageGuide','CommandReceipt.result.expression','expressionId／createdAt／expiresAt','12秒','6秒','30秒间隔','5分钟最多4次','60秒内相同','16项且8KiB','2／1／0'])assert(WORLD_EXPRESSION_GUIDE.includes(term),term);
 assert.deepEqual([...WORLD_EXPRESSION_GUIDE.matchAll(/(?:GET|POST) (\/v1\/[a-z_/]+)/g)].map(m=>m[1]),['/v1/gateway/discovery','/v1/gateway/commands','/v1/gateway/receipts/query']);
 assert(!WORLD_EXPRESSION_GUIDE.includes('logicVersion'));assert(WORLD_EXPRESSION_GUIDE.includes('不重建宿主job'));assert(WORLD_EXPRESSION_GUIDE.includes('不逐句问主人'));assert(WORLD_EXPRESSION_GUIDE.includes('表达不进入生活日志'));
});
