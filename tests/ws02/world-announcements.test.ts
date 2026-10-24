import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {buildApp} from '../../apps/platform/app.ts';
import {M1_TABLES} from '../../apps/platform/contracts/store.ts';
import {key,refId} from '../../apps/platform/domains/perception/protocol.ts';
import {publishWelcomeAnnouncement,WELCOME_ANNOUNCEMENT} from '../../apps/platform/application/world-announcements.ts';
import {runWorldAnnouncement} from '../../scripts/publish-world-announcement.ts';
import {postgresFixture} from '../api/postgresql-fixture.ts';
import {agentFixture,injectApi,ownerFixture} from '../../scripts/agent-manager-qa-fixture.ts';
import type {M1ReadSession} from '../../apps/platform/contracts/store.ts';
async function digests(tx:M1ReadSession){const rows:Record<string,string>={};for(const name of M1_TABLES)rows[name]=key(await tx.find(name));return rows;}

test('explicit maintenance appends one real announcement, retries retain its time, and anonymous/Agent readers share the same source',async t=>{
 const f=await postgresFixture(),app=await buildApp({...f.options,email:{mode:'experience'}});t.after(async()=>{try{await app.close();}finally{await f.dispose();}});
 const read=(path='/v1/world/announcements?worldId=default')=>app.inject({method:'GET',url:path});
 const initial=await read();assert.equal(initial.statusCode,200);assert.deepEqual(initial.json().data.items,[]);assert.equal(initial.json().data.complete,true);
 const before=await f.store.read(digests),directory=await realpath(f.directory);
 const args=['--connection',join(f.privateConnections,'application-database-url'),'--identity',f.identityPath,'--operator','isolated-announcement-maintainer','--expected-instance',f.options.instanceId,'--expected-epoch',f.options.recoveryEpoch];
 await assert.rejects(()=>runWorldAnnouncement([]));
 await assert.rejects(()=>publishWelcomeAnnouncement(f.store,{actorId:'isolated-announcement-maintainer',expectedInstanceId:'other-instance',expectedRecoveryEpoch:f.options.recoveryEpoch}),{code:'version_conflict'});
 const start=Date.now(),first=(await runWorldAnnouncement([...args,'--manifest',join(directory,'first-publication.json')])).receipt,end=Date.now();
 assert.equal(first.changed,true);assert.ok(Number(first.publishedAt)>=start&&Number(first.publishedAt)<=end);
 const retry=(await runWorldAnnouncement([...args,'--manifest',join(directory,'retry-publication.json')])).receipt;assert.equal(retry.changed,false);assert.equal(retry.publishedAt,first.publishedAt);
 assert.equal(JSON.parse(await readFile(join(directory,'retry-publication.json'),'utf8')).publishedAt,first.publishedAt);
 const after=await f.store.read(digests);for(const name of M1_TABLES)if(name!=='perception_objects')assert.equal(after[name],before[name],name+' is unchanged');
 const listing=await read();assert.equal(listing.statusCode,200);assert.equal(listing.headers['cache-control'],'no-store');const item=listing.json().data.items[0];assert.equal(item.title,WELCOME_ANNOUNCEMENT.title);assert.equal(item.author,'镇长');assert.equal(item.publishedAt,first.publishedAt);assert.equal(item.dataMode,'real');assert.equal(item.body,undefined);assert.equal(listing.json().data.items.length,1);
 const detail=await read('/v1/world/announcements/'+item.id);assert.equal(detail.statusCode,200);assert.equal(detail.json().data.item.body,WELCOME_ANNOUNCEMENT.body);assert.equal(detail.json().data.item.publishedAt,first.publishedAt);assert.doesNotMatch(detail.body,/administrator|isolated-announcement-maintainer/);
 const api=injectApi(app),owner=await ownerFixture(api,'Announce'),agent=await agentFixture(api,owner,'隔离公告读者','blue');
 const agentList=await app.inject({method:'POST',url:'/v1/perception/list',headers:{authorization:'Bearer '+agent.runtimeToken},payload:{protocolVersion:1,channel:'world',consumerId:'announcement-test',purpose:'agent-perception',categoryId:'announcements',limit:50}});assert.equal(agentList.statusCode,200);const same=agentList.json().data.records.find((row:any)=>row.ref.id===item.id);assert.equal(same.summary.title,item.title);assert.equal(same.summary.author,item.author);assert.equal(same.summary.source.publishedAt,item.publishedAt);assert.equal(same.summary.dataMode,'real');
 const agentDetail=await app.inject({method:'POST',url:'/v1/perception/detail',headers:{authorization:'Bearer '+agent.runtimeToken},payload:{protocolVersion:1,channel:'world',consumerId:'announcement-test',purpose:'agent-inspect',ref:same.ref}});assert.equal(agentDetail.statusCode,200);assert.equal(agentDetail.json().data.content.text,WELCOME_ANNOUNCEMENT.body);
 const id=refId(same.ref);await f.store.transaction(async tx=>{const row=(await tx.get('perception_objects',id))!;await tx.update('perception_objects',{...row,version:2,data:{...row.data,body:'An existing publication must not be overwritten.'}},row.version);});
 await assert.rejects(()=>runWorldAnnouncement([...args,'--manifest',join(directory,'conflict.json')]),{code:'publication_conflict'});assert.equal((await read('/v1/world/announcements/'+item.id)).json().data.item.body,'An existing publication must not be overwritten.');
});

test('anonymous list/detail recheck current source and public active available filters with bounded continuation',async t=>{
 const f=await postgresFixture(),app=await buildApp(f.options);t.after(async()=>{try{await app.close();}finally{await f.dispose();}});
 await f.store.transaction(async tx=>{for(let n=0;n<33;n++){const id='isolated-announcement-'+n,ref={moduleId:'world',type:'world.announcement@1',id};await tx.insert('perception_objects',{id:refId(ref),version:1,data:{ref,categoryId:'announcements',channel:'world',sourceId:n===32?'unrelated-source':'demo-announcements',title:'隔离公告 '+n,body:'隔离正文',author:'合成发布者',public:n!==29,active:n!==30,available:n!==31,dataMode:'real',source:{kind:'administrative_publication',publishedAt:Date.now()},attachments:[]}});}});
 const read=(path='/v1/world/announcements')=>app.inject({method:'GET',url:path});
 const page=(await read()).json().data;assert.equal(page.items.length,25);assert.equal(page.complete,false);assert.match(page.nextAfterId,/^[a-f0-9]{64}$/);
 const second=(await read('/v1/world/announcements?afterId='+page.nextAfterId)).json().data;assert.equal(second.items.length,4);assert.equal(second.complete,true);assert.equal(second.nextAfterId,null);assert.equal(new Set([...page.items,...second.items].map(row=>row.id)).size,29);
 for(const n of [29,30,31,32])assert.equal((await read('/v1/world/announcements/isolated-announcement-'+n)).statusCode,404);
 assert.equal((await read('/v1/world/announcements?worldId=elsewhere')).statusCode,404);assert.equal((await read('/v1/world/announcements?agentId=private-agent')).statusCode,400);assert.equal((await read('/v1/world/announcements?afterId=invalid')).statusCode,400);
 const before=await f.store.read(async tx=>key(await tx.find('perception_objects')));await read();await read('/v1/world/announcements/isolated-announcement-0');assert.equal(await f.store.read(async tx=>key(await tx.find('perception_objects'))),before,'Anonymous reads do not write');
 for(const [sourceState,status]of [['unavailable',503],['not_enabled',409]] as const){await f.store.transaction(async tx=>{const row=(await tx.get('perception_catalog','current'))!;await tx.update('perception_catalog',{...row,version:row.version+1,data:{...row.data,sourceStates:{...row.data.sourceStates as object,'demo-announcements':sourceState}}},row.version);});assert.equal((await read()).statusCode,status);assert.equal((await read('/v1/world/announcements/isolated-announcement-0')).statusCode,status);}
});
