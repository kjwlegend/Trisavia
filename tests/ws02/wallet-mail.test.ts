import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { initializePerceptionCatalog } from '../../apps/platform/application/perception-catalog.ts';
import { authorizeWs02SeedOwnerObservation } from '../../apps/platform/application/perception-owner-observation.ts';
import { key, refId } from '../../apps/platform/domains/perception/protocol.ts';
import { fixture, requestBase } from './helpers.ts';

const agentRef=(id:string)=>({moduleId:'profiles',type:'profiles.agent@1',id});

test('detail schema4 supplies the authorized source title alongside the body and never leaks a title through an unauthorized known ref',async t=>{
 const f=await fixture(t);
 const items=await f.read('POST','/list',requestBase('world',{categoryId:'items',limit:50}));
 const item=items.records[0],read=await f.detail(item.ref,'world');
 assert.equal(read.final.content.title,item.summary.title);assert(read.segments.every(part=>part.content.title===item.summary.title));
 f.storage(store=>store.transaction(tx=>{const row=tx.get('perception_objects',refId(item.ref))!;tx.update('perception_objects',{...row,version:row.version+1,data:{...row.data,public:false}},row.version);}));
 const unavailable=await f.call('POST','/detail',{...requestBase('world',{purpose:'human-inspect'}),ref:item.ref},f.owner.sessionToken);
 assert.equal(unavailable.status,404);assert(!JSON.stringify(unavailable.envelope).includes(item.summary.title));
 f.storage(store=>authorizeWs02SeedOwnerObservation(store,{actorId:'isolated-title-administrator',operationId:randomUUID(),expectedSourceAdministrator:'isolated-test-administrator'}));
 const input={...requestBase('inbox',{purpose:'human-inspect'}),agentRef:agentRef(f.a.agentId),categoryId:'notifications',limit:50};
 const notifications=await f.read('POST','/list',input,f.owner.sessionToken),notification=notifications.records.find((row:any)=>row.detailAvailable);
 const detail={...requestBase('inbox',{purpose:'human-inspect'}),agentRef:agentRef(f.a.agentId),ref:notification.ref};
 assert.equal((await f.read('POST','/detail',detail,f.owner.sessionToken)).content.title,notification.summary.title);
 const denied=await f.call('POST','/detail',detail,f.otherOwner.sessionToken);assert.equal(denied.status,404);assert(!JSON.stringify(denied.envelope).includes(notification.summary.title));
});

test('schema3 and guide3 exact documents and frozen catalog digests remain intact when the next contract is registered',async t=>{
 const f=await fixture(t);
 f.storage(store=>store.transaction(tx=>{
  const legacySchema={type:'object',additionalProperties:false,properties:{legacySchemaVersion:{const:3}}};
  tx.insert('perception_catalog',{id:'schema:perception.detail-result:3',version:1,data:{document:legacySchema,digest:key(legacySchema)}});
  for(const moduleId of ['perception','world','profiles','items','inventory','mailbox']){const document={moduleId,version:3,text:'Frozen guide3 source bytes',http:{detail:{meaning:'Historical contract without title'}}};tx.insert('perception_catalog',{id:`guide:${moduleId}:3`,version:1,data:{document,digest:key(document)}});}
  tx.insert('perception_catalog',{id:`catalog-revision:${key('frozen-catalog-schema3')}`,version:1,data:{kind:'catalog_revision',catalogRevision:'frozen-catalog-schema3',digest:key({historicalDeclaration:'frozen before wallet/mail contract'})}});
  const row=tx.get('perception_catalog','current')!;tx.update('perception_catalog',{...row,version:row.version+1,data:{...row.data,schemaVersion:3,guideVersion:3,catalogRevision:'frozen-catalog-schema3',skillCatalogRevision:'skills-frozen-catalog-schema3'}},row.version);
 }));
 const before=f.storage(store=>store.read(tx=>tx.find('perception_catalog').filter(row=>row.id!=='current')));
 f.storage(store=>store.transaction(initializePerceptionCatalog));
 const after=f.storage(store=>store.read(tx=>tx.find('perception_catalog'))),byId=new Map(after.map(row=>[row.id,row]));
 for(const row of before)assert.deepEqual(byId.get(row.id),row);
 const directory=await f.read('GET','/discovery?limit=50');assert.equal(directory.catalogRevision,'frozen-catalog-schema3-schema-4');
 const old=await f.read('GET','/schemas/perception.detail-result?version=3');assert.equal(old.document.properties.legacySchemaVersion.const,3);
 assert.equal((await f.read('GET','/guides/world?version=3')).document.text,'Frozen guide3 source bytes');
 const current=await f.read('GET','/schemas/perception.detail-result?version=4');assert(current.document.properties.data.properties.content.properties.title);
});

// These sources are explicit isolated upstream adapters. Their credentials are
// authenticated by the actual M1 service; neither input nor test rows claim an actor.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFile, readFile, realpath } from 'node:fs/promises';
import { M1_TABLES, type JsonObject } from '../../apps/platform/contracts/store.ts';
import { createM1Service } from '../../apps/platform/application/m1-service.ts';
import type { TrustedMailboxSource } from '../../apps/platform/application/mailbox-service.ts';
import { initializeWalletAccount, walletAccountId } from '../../apps/platform/domains/wallet/repository.ts';
import { mailboxRepository, saveMailboxReceipt, mailboxReceiptId } from '../../apps/platform/domains/mailbox/repository.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';
import { migrateDatabase, migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { updatePerceptionDemoObject } from '../../apps/platform/application/perception-admin.ts';
import { runSeed } from '../../scripts/ws02-demo-data.ts';
import { runOwnerObservation } from '../../scripts/ws02-owner-observation.ts';
import { agentFixture, ok, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
import type { TestContext } from 'node:test';

const stamp=Date.UTC(2026,9,20),newTables=['wallet_accounts','mailbox_messages','mailbox_receipts'];
const messages=(id?:string,extra:Json={})=>requestBase('inbox',{categoryId:'messages',...(id?{purpose:'human-inspect',agentRef:agentRef(id)}:{}),...extra});
async function messageFixture(t:TestContext){
 const recipients=new Set<string>(),humanNames=new Map<string,string>();let observe=true;
 const source:TrustedMailboxSource={sourceId:'isolated-authenticated-upstream',
  authenticate(tx,context,authenticate){const credential=authenticate(tx,(context as {token?:string}).token,['runtime','owner_session']);return credential.data.kind==='runtime'?{kind:'agent',ref:agentRef(String(credential.data.agentId))}:{kind:'human',ref:{moduleId:'identities',type:'identities.human@1',id:String(credential.data.ownerId)}};},
  authorizeRecipient(_tx,_actor,recipient){return recipients.has(recipient);},
  ownerObservation(){return {existence:observe,summary:observe,body:observe,attachments:observe};},
  humanIdentity(_tx,ar,recipient){const name=recipients.has(recipient)?humanNames.get(ar.id):undefined;return name?{ref:ar,displayName:name,authorityId:'isolated-explicit-disclosure',version:1}:null;},
 };
 const f=await fixture(t,{mailboxSources:[source],detailSegmentChars:32});recipients.add(f.a.agentId);recipients.add(f.sibling.agentId);
 const receive=(input:Json,token=f.sibling.runtimeToken)=>f.storage(store=>createM1Service(store,{now:()=>stamp,perception:{mailboxSources:[source]}}).receiveTrustedMessage(source.sourceId,input,{token}));
 const input=(extra:Json={})=>({sourceMessageKey:`source-${randomUUID()}`,recipientAgentId:f.a.agentId,title:'来自受信来源的合成来信',body:'Only an authenticated upstream may provide this original body. '.repeat(12),attachments:[{name:'Authorized attachment',description:'A bounded description.'}],...extra});
 return {...f,source,receive,input,recipients,humanNames,setObserve(value:boolean){observe=value;}};
}

test('wallet accounts are durable registration records; queries are pure reads, isolate actors, retain values across initialization/rebinding and never invent missing zero',async t=>{
 const f=await fixture(t),query={protocolVersion:1,consumerId:'wallet-browser',purpose:'human-inspect',agentRef:agentRef(f.a.agentId)};
 const snapshot=()=>f.storage(store=>store.read(tx=>key(M1_TABLES.map(table=>tx.find(table)))));
 const before=snapshot(),result=await f.m1('POST','/wallet/query',query,f.owner.sessionToken);assert.equal(result.status,200);assert.equal(result.body.protocolVersion,1);assert.equal(result.body.data.balance,0);assert.equal(result.body.data.initializationSource,'registration');assert.equal(result.body.data.dataMode,'platform');assert.equal(snapshot(),before);
 assert.equal((await f.m1('POST','/wallet/query',query,f.otherOwner.sessionToken)).status,404);
 assert.equal((await f.m1('POST','/wallet/query',{...query,agentRef:agentRef(f.b.agentId)},f.owner.sessionToken)).status,404);
 assert.equal((await f.m1('POST','/wallet/query',{...query,purpose:'agent-inspect',agentRef:agentRef(f.sibling.agentId)},f.a.runtimeToken)).status,404);
 const own=await f.m1('POST','/wallet/query',{protocolVersion:1,consumerId:'wallet-agent',purpose:'agent-inspect'},f.a.runtimeToken);assert.equal(own.status,200);assert.equal(own.body.data.balance,0);
 const a=await agentFixture(f.m1,f.owner,'新注册有真实零余额','blue');const account=f.storage(store=>store.read(tx=>tx.get('wallet_accounts',walletAccountId(a.agentId))!));assert.equal(account.data.balance,0);
 const command={operationId:a.operationId,attemptId:a.attemptId,runtimeToken:a.runtimeToken,continuationToken:a.continuationToken,inviteToken:a.inviteToken};
 await ok(f.m1,'POST','/registrations',command);assert.deepEqual(f.storage(store=>store.read(tx=>tx.get('wallet_accounts',account.id))),account);
 f.storage(store=>store.transaction(tx=>{const row=tx.get('wallet_accounts',walletAccountId(f.a.agentId))!;tx.update('wallet_accounts',{...row,version:row.version+1,data:{...row.data,balance:17}},row.version);initializeWalletAccount(tx,f.a.agentId,stamp+1000);}));
 await f.restart();assert.equal((await f.m1('POST','/wallet/query',query,f.owner.sessionToken)).body.data.balance,17);
 f.storage(store=>store.transaction(tx=>{const binding=tx.find('bindings',{agentId:f.a.agentId,active:true})[0]!;tx.update('bindings',{...binding,version:binding.version+1,data:{...binding.data,ownerId:f.otherOwner.ownerId}},binding.version);}));
 assert.equal((await f.m1('POST','/wallet/query',query,f.owner.sessionToken)).status,404);assert.equal((await f.m1('POST','/wallet/query',query,f.otherOwner.sessionToken)).body.data.balance,17);
 f.storage(store=>store.transaction(tx=>{const row=tx.get('wallet_accounts',walletAccountId(f.a.agentId))!;tx.remove('wallet_accounts',row.id,row.version);}));
 const missing=await f.m1('POST','/wallet/query',query,f.otherOwner.sessionToken);assert.equal(missing.status,409);assert.equal(missing.body.error.code,'wallet_not_initialized');assert(!JSON.stringify(missing.body).includes('balance'));assert.equal(f.storage(store=>store.read(tx=>tx.get('wallet_accounts',walletAccountId(f.a.agentId)))),undefined);
});

test('schema5 migration preserves the original 20 tables and migration checksums, creates real zero accounts, and legacy observation CLI refuses to migrate implicitly',async t=>{
 const f=await fixture(t),legacyPath=join(f.directory,'original-schema5.sqlite'),oldTables=M1_TABLES.filter(table=>!newTables.includes(table));
 f.storage(store=>updatePerceptionDemoObject(store,{actorId:'isolated-test-administrator',operationId:randomUUID(),ref:{moduleId:'mailbox',type:'mailbox.message@1',id:'test-message-09'},expectedVersion:1,body:'Keep the R03 exact second version.'}));
 const original=new DatabaseSync(f.options.databasePath,{readOnly:true}),legacy=new DatabaseSync(legacyPath);
 try{migrateDatabase(legacy,migrations.slice(0,5));legacy.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON');legacy.prepare('INSERT INTO instance_state VALUES(1,?,?)').run(f.options.instanceId,f.options.recoveryEpoch);for(const table of oldTables){const insert=legacy.prepare(`INSERT INTO ${table}(id,version,data) VALUES(?,?,?)`);for(const row of original.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all())insert.run(row.id!,row.version!,row.data!);}legacy.exec('COMMIT');}finally{original.close();legacy.close();}
 const snapshot=()=>{const db=new DatabaseSync(legacyPath,{readOnly:true});try{return {identity:db.prepare('SELECT * FROM instance_state').all(),migrations:db.prepare('SELECT * FROM schema_migrations WHERE version<=5 ORDER BY version').all(),tables:oldTables.map(table=>[table,db.prepare(`SELECT id,version,data FROM ${table} ORDER BY id`).all()])};}finally{db.close();}};
 const before=snapshot(),identity=join(f.directory,'paired-schema5.identity.json');await writeFile(identity,JSON.stringify({version:1,instanceId:f.options.instanceId,recoveryEpoch:f.options.recoveryEpoch}));
 const bytes=await readFile(legacyPath),identityBytes=await readFile(identity);await assert.rejects(runOwnerObservation(['--database',legacyPath,'--identity',identity,'--operator','isolated-admin','--source-administrator','isolated-test-administrator','--operation-id','must-not-implicitly-migrate','--manifest',join(await realpath(f.directory),'rejected-receipt.json')]));assert((await readFile(legacyPath)).equals(bytes));assert((await readFile(identity)).equals(identityBytes));assert.deepEqual(snapshot(),before);
 await assert.rejects(runSeed(['--database',legacyPath,'--identity',identity,'--operator','isolated-admin','--manifest',join(await realpath(f.directory),'rejected-seed-receipt.json')]));assert((await readFile(legacyPath)).equals(bytes));assert((await readFile(identity)).equals(identityBytes));assert.deepEqual(snapshot(),before);
 const migrated=openM1Store({...f.options,databasePath:legacyPath});try{assert.deepEqual(snapshot(),before);const accounts=migrated.read(tx=>tx.find('wallet_accounts'));assert.equal(accounts.length,3);assert(accounts.every(row=>row.data.balance===0&&row.data.initializationSource==='migration'));assert.equal(migrated.read(tx=>tx.count('mailbox_messages',{},10)),0);assert.equal(migrated.read(tx=>tx.count('mailbox_receipts',{},10)),0);}finally{migrated.close();}
 const db=new DatabaseSync(legacyPath,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get()!.n,6);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()!.n,23);assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');}finally{db.close();}
});

test('mailbox starts genuinely empty, accepts only authenticated registered sources, rejects spoofing, and replays the exact source receipt without rewriting content or inactive delivery',async t=>{
 const f=await messageFixture(t),empty=await f.read('POST','/list',messages(f.a.agentId),f.owner.sessionToken);assert.equal(empty.complete,true);assert.deepEqual(empty.records,[]);
 const old=()=>f.storage(store=>store.read(tx=>key({objects:tx.find('perception_objects'),grants:tx.find('perception_grants'),states:tx.find('perception_states')})));
 const before=old(),input=f.input();assert.throws(()=>f.receive({...input,sender:{kind:'agent',id:f.b.agentId}}),{code:'invalid_request'});assert.throws(()=>f.receive(input,'invalid-token'));
 assert.throws(()=>f.receive({...input,recipientAgentId:f.b.agentId}),{code:'target_not_accessible'});
 const received=f.receive(input);assert.deepEqual(f.receive(input),received);assert.throws(()=>f.receive({...input,body:'Changed same source key payload'}),{code:'operation_id_conflict'});
 const list=await f.read('POST','/list',messages(f.a.agentId),f.owner.sessionToken);assert.equal(list.records.length,1);assert.equal(list.records[0].summary.sender.displayName,'合成感知乙');assert.equal(list.records[0].summary.sender.ref.id,f.sibling.agentId);assert.equal(list.records[0].summary.dataMode,'real');assert.equal(list.records[0].agentReadState,undefined);
 const complete=await f.detail(received.ref as any,'inbox',f.owner.sessionToken,{purpose:'human-inspect',agentRef:agentRef(f.a.agentId)});assert.equal(complete.segments.map(row=>row.content.text).join(''),input.body);assert.equal(complete.final.completionToken,undefined);assert.equal(old(),before);
 f.storage(store=>store.transaction(tx=>{const row=mailboxRepository(tx).receipt((received.ref as Json).id,f.a.agentId)!;saveMailboxReceipt(tx,{...row,version:row.version+1,data:{...row.data,active:false}},row);}));
 assert.deepEqual(f.receive(input),received);assert.equal((await f.read('POST','/list',messages(f.a.agentId),f.owner.sessionToken)).records.length,0);
});

test('new message versions use independent receipt confirmation with full-body proof, exact receipt replay and rejected-key preservation',async t=>{
 const f=await messageFixture(t),input=f.input(),received=f.receive(input),ref=received.ref as any;
 const legacyRef={moduleId:'mailbox',type:'mailbox.message@1',id:'test-message-09'};
 f.storage(store=>updatePerceptionDemoObject(store,{actorId:'isolated-test-administrator',operationId:randomUUID(),ref:legacyRef,expectedVersion:1,body:'The legacy R03 notification remains version two.'}));
 const notifications=await f.read('POST','/list',requestBase('inbox',{categoryId:'notifications',limit:50}));
 for(const oldRef of [legacyRef,...notifications.records.filter((r:Json)=>r.detailAvailable&&r.ref.id!==legacyRef.id).slice(0,2).map((r:Json)=>r.ref)]){const oldBody=await f.detail(oldRef);await f.read('PUT','/agent-read-state',{protocolVersion:1,operationId:randomUUID(),ref:oldRef,contentVersion:oldBody.final.version,completionToken:oldBody.final.completionToken});}
 assert.equal((await f.unread()).count.value,27);
 const oldStates=()=>f.storage(store=>store.read(tx=>key(tx.find('perception_states'))));const before=oldStates();
 const first=await f.read('POST','/detail',{...requestBase('inbox',{purpose:'agent-inspect'}),ref});assert.equal(first.contentComplete,false);assert.equal(first.completionToken,undefined);
 const wrong={protocolVersion:1,operationId:randomUUID(),ref,contentVersion:1,completionToken:'invalid-completion-proof'};assert.equal((await f.call('PUT','/agent-read-state',wrong)).status,410);assert.equal((await f.queryState(ref)).confirmedContentVersion,null);
 const body=await f.detail(ref),confirm={protocolVersion:1,operationId:randomUUID(),ref,contentVersion:1,completionToken:body.final.completionToken};
 const state=await f.read('PUT','/agent-read-state',confirm);assert.equal(state.confirmedContentVersion,1);assert.equal(state.stateVersion,1);assert.equal(state.changed,true);assert.deepEqual(await f.read('PUT','/agent-read-state',confirm),state);
 assert.equal((await f.call('PUT','/agent-read-state',{...wrong,completionToken:body.final.completionToken})).status,409);
 const revised=f.receive({...input,contentVersion:2,body:'An immutable second original source version. '.repeat(5)});assert.equal((revised.ref as Json).id,ref.id);assert.equal((await f.queryState(ref)).currentContentVersion,2);assert.equal((await f.queryState(ref)).confirmedContentVersion,1);
 const next=await f.detail(ref),second=await f.read('PUT','/agent-read-state',{...confirm,operationId:randomUUID(),contentVersion:2,completionToken:next.final.completionToken});assert.equal(second.confirmedContentVersion,2);assert.equal(second.stateVersion,2);assert.equal(oldStates(),before);
 const versions=f.storage(store=>store.read(tx=>tx.find('mailbox_messages')));assert.equal(versions.length,2);assert.equal(versions[0]!.version,1);assert.equal(versions[1]!.version,1);
 assert.throws(()=>f.storage(store=>store.transaction(tx=>{const row=versions[0]!;tx.update('mailbox_messages',{...row,version:row.version+1,data:{...row.data,body:'Overwrite forbidden'}},row.version);})));assert.equal(oldStates(),before);
});

test('owner message observation and continuations require each current layer, binding, receipt and subject; human reads never confirm',async t=>{
 const f=await messageFixture(t);f.setObserve(false);const secret=f.receive(f.input({title:'Agent-only new message'}));f.setObserve(true);const one=f.receive(f.input()),two=f.receive(f.input());
 const input=messages(f.a.agentId,{limit:1}),first=await f.read('POST','/list',input,f.owner.sessionToken);assert.equal(first.records.length,1);assert(first.nextPageToken);assert(!JSON.stringify(first).includes('Agent-only'));
 const detail={...requestBase('inbox',{purpose:'human-inspect'}),agentRef:agentRef(f.a.agentId),ref:one.ref},part=await f.read('POST','/detail',detail,f.owner.sessionToken);
 assert.equal((await f.call('POST','/detail',{...detail,ref:secret.ref},f.owner.sessionToken)).status,404);
 assert.equal((await f.call('POST','/list',input,f.otherOwner.sessionToken)).status,404);
 assert.equal((await f.call('POST','/list',{...input,agentRef:agentRef(f.sibling.agentId),pageToken:first.nextPageToken},f.owner.sessionToken)).status,409);
 assert.equal((await f.call('POST','/detail',{...detail,agentRef:agentRef(f.sibling.agentId),contentToken:part.nextContentToken},f.owner.sessionToken)).status,404);
 f.storage(store=>store.transaction(tx=>{const row=mailboxRepository(tx).receipt((one.ref as Json).id,f.a.agentId)!;saveMailboxReceipt(tx,{...row,version:row.version+1,data:{...row.data,ownerObservation:{existence:true,summary:true,body:false,attachments:false}}},row);}));
 assert.equal((await f.call('POST','/detail',{...detail,contentToken:part.nextContentToken},f.owner.sessionToken)).status,404);
 const summary=await f.listAll(messages(f.a.agentId),f.owner.sessionToken);assert.equal(summary.records.find(row=>row.ref.id===(one.ref as Json).id)!.detailAvailable,false);
 const state=await f.queryState(two.ref as any);assert.equal(state.confirmedContentVersion,null);
 const human=await f.detail(two.ref as any,'inbox',f.owner.sessionToken,{purpose:'human-inspect',agentRef:agentRef(f.a.agentId)});assert.equal(human.final.completionToken,undefined);assert.deepEqual(await f.queryState(two.ref as any),state);
 f.storage(store=>store.transaction(tx=>{const row=tx.find('bindings',{agentId:f.a.agentId,active:true})[0]!;tx.update('bindings',{...row,version:row.version+1,data:{...row.data,active:false}},row.version);}));
 assert.equal((await f.call('POST','/list',messages(f.a.agentId),f.owner.sessionToken)).status,404);
});

test('human sender names need explicit audience disclosure and current Agent/human name revocation cannot leak snapshots or change body confirmation',async t=>{
 const f=await messageFixture(t),input=f.input();assert.throws(()=>f.receive(input,f.owner.sessionToken),{code:'sender_not_verified'});
 f.humanNames.set(f.owner.ownerId,'明确披露的合成人类称谓');const human=f.receive(input,f.owner.sessionToken);
 const initial=await f.read('POST','/list',messages(f.a.agentId),f.owner.sessionToken);assert.equal(initial.records[0].summary.sender.kind,'human');assert.equal(initial.records[0].summary.sender.displayName,'明确披露的合成人类称谓');assert(!JSON.stringify(initial).includes(f.owner.username));assert(!JSON.stringify(initial).includes(f.owner.email));
 const state=await f.queryState(human.ref as any);f.humanNames.delete(f.owner.ownerId);
 const restricted=await f.read('POST','/list',messages(f.a.agentId),f.owner.sessionToken);assert.deepEqual(restricted.records[0].summary.sender,{kind:'human',ref:null,displayName:null});assert(!JSON.stringify(restricted).includes('明确披露的合成人类称谓'));assert.equal(restricted.records[0].version,1);
 const body=await f.detail(human.ref as any,'inbox',f.owner.sessionToken,{purpose:'human-inspect',agentRef:agentRef(f.a.agentId)});assert.equal(body.final.content.sender.displayName,null);assert.equal(body.segments.map(row=>row.content.text).join(''),input.body);assert.deepEqual(await f.queryState(human.ref as any),state);
 const agent=f.receive(f.input()),profile=await ok(f.m1,'GET',`/agents/${f.sibling.agentId}/profile`,undefined,f.owner.sessionToken);await ok(f.m1,'POST',`/agents/${f.sibling.agentId}/profile/unpublish`,{operationId:randomUUID(),expectedVersion:profile.version,expectedPolicyVersion:profile.policyVersion},f.owner.sessionToken);
 const hidden=await f.detail(agent.ref as any,'inbox',f.owner.sessionToken,{purpose:'human-inspect',agentRef:agentRef(f.a.agentId)});assert.deepEqual(hidden.final.content.sender,{kind:'agent',ref:null,displayName:null});assert.equal(hidden.final.version,1);
});

test('source reception and new-message confirmation roll back immutable versions, receipts, operations and facts together on real SQL failure',async t=>{
 const f=await messageFixture(t),input=f.input(),snapshot=()=>f.storage(store=>store.read(tx=>key(M1_TABLES.map(table=>tx.find(table)))));
 const before=snapshot(),fault=new DatabaseSync(f.options.databasePath);try{fault.exec("CREATE TRIGGER isolated_message_fault BEFORE INSERT ON facts WHEN json_extract(NEW.data,'$.action')='receiveMailboxMessage' BEGIN SELECT RAISE(ABORT,'mailbox-source-fact-fault'); END");}finally{fault.close();}
 try{assert.throws(()=>f.receive(input));assert.equal(snapshot(),before);}finally{const db=new DatabaseSync(f.options.databasePath);try{db.exec('DROP TRIGGER isolated_message_fault');}finally{db.close();}}
 const received=f.receive(input),body=await f.detail(received.ref as any),confirm={protocolVersion:1,operationId:randomUUID(),ref:received.ref,contentVersion:1,completionToken:body.final.completionToken};
 const prior=snapshot(),confirmationFault=new DatabaseSync(f.options.databasePath);try{confirmationFault.exec("CREATE TRIGGER isolated_confirmation_fault BEFORE INSERT ON facts WHEN json_extract(NEW.data,'$.action')='confirmAgentRead' BEGIN SELECT RAISE(ABORT,'mailbox-confirmation-fact-fault'); END");}finally{confirmationFault.close();}
 try{const response=await f.call('PUT','/agent-read-state',confirm);assert(response.status>=500);assert.equal(snapshot(),prior);}finally{const db=new DatabaseSync(f.options.databasePath);try{db.exec('DROP TRIGGER isolated_confirmation_fault');}finally{db.close();}}
 const accepted=await f.read('PUT','/agent-read-state',confirm);assert.equal(accepted.confirmedContentVersion,1);assert.deepEqual(await f.read('PUT','/agent-read-state',confirm),accepted);
});

test('holding kinds and named publication associations require each target current visibility and do not disclose withdrawn names or refs',async t=>{
 const f=await fixture(t),holdings=await f.read('POST','/list',requestBase('inventory',{purpose:'human-inspect',agentRef:agentRef(f.a.agentId),categoryId:'holdings',limit:50}),f.owner.sessionToken);
 assert(holdings.records.every((r:Json)=>['work','prop'].includes(r.summary.itemKind)));
 const events=await f.read('POST','/list',requestBase('world',{purpose:'human-inspect',categoryId:'events',metricId:'occurrences',limit:50}),f.owner.sessionToken),publication=events.records.find((r:Json)=>r.sourceId==='platform-publications');assert(publication);
 const old=await f.detail(publication.ref,'world',f.owner.sessionToken,{purpose:'human-inspect'}),related=old.final.content.publication.relatedItems;assert(related.length>10);assert.equal(related.length,old.final.content.publication.publishedRefs.length);
 const item=holdings.records[0],itemId=refId(item.summary.itemRef);assert(related.some((r:Json)=>key(r.ref)===key(item.summary.itemRef)&&r.title===item.summary.title));
 const source=f.storage(store=>store.read(tx=>tx.get('perception_objects',itemId)!));
 f.storage(store=>store.transaction(tx=>tx.update('perception_objects',{...source,version:source.version+1,data:{...source.data,public:false}},source.version)));
 const current=await f.detail(publication.ref,'world',f.owner.sessionToken,{purpose:'human-inspect'}),serialized=JSON.stringify(current.final.content.publication);assert(!serialized.includes(item.summary.itemRef.id));assert(!serialized.includes(item.summary.title));
 const reread=await f.read('POST','/list',requestBase('inventory',{purpose:'human-inspect',agentRef:agentRef(f.a.agentId),categoryId:'holdings',limit:50}),f.owner.sessionToken),record=reread.records.find((r:Json)=>r.ref.id===item.ref.id);assert.equal(record.summary.itemKind,undefined);assert.equal(record.summary.itemRef,undefined);assert.equal(record.summary.title,'持有记录');
});

test('discovery publishes the wallet module and new message category with strict schemas that validate actual wallet and mailbox envelopes',async t=>{
 const f=await messageFixture(t),directory=await f.read('GET','/discovery?limit=50',undefined,f.owner.sessionToken),wallet=directory.operations.find((row:Json)=>row.id==='wallet-query');assert(wallet);assert.equal(wallet.path,'/v1/wallet/query');
 const walletModule=directory.modules.find((row:Json)=>row.moduleId==='wallet');assert(walletModule);const guide=await f.read('GET',`/guides/wallet?version=${walletModule.usageGuide.version}`);assert(JSON.stringify(guide.document).includes('/v1/wallet/query'));assert(directory.categories.some((row:Json)=>row.categoryId==='messages'));assert(directory.types.some((row:Json)=>row.type==='mailbox.direct-message@1'));
 const {createRequire}=await import('node:module'),Ajv2020=createRequire(import.meta.url)('ajv/dist/2020.js').default,ajv=new Ajv2020({strict:false,allErrors:true});
 const validate=async(schemaRef:Json,value:unknown)=>{const schema=await f.read('GET',`/schemas/${schemaRef.id}?version=${schemaRef.version}`);const run=ajv.compile({...schema.document,$id:`${schemaRef.id}-${randomUUID()}`});assert(run(value),JSON.stringify(run.errors));};
 const query={protocolVersion:1,consumerId:'wallet-schema-reader',purpose:'human-inspect',agentRef:agentRef(f.a.agentId)};await validate(wallet.inputSchema,query);const account=await f.m1('POST','/wallet/query',query,f.owner.sessionToken);assert.equal(account.status,200);await validate(wallet.outputSchema,account.body);
 const received=f.receive(f.input()),listOperation=directory.operations.find((row:Json)=>row.id==='list'),input=messages(f.a.agentId),listed=await f.call('POST','/list',input,f.owner.sessionToken);await validate(listOperation.inputSchema,input);await validate(listOperation.outputSchema,listed.envelope);await validate(listed.data.records[0].schema,listed.data.records[0].summary);
 const detailOperation=directory.operations.find((row:Json)=>row.id==='detail'),body={...requestBase('inbox',{purpose:'human-inspect'}),agentRef:agentRef(f.a.agentId),ref:received.ref},part=await f.call('POST','/detail',body,f.owner.sessionToken);await validate(detailOperation.inputSchema,body);await validate(detailOperation.outputSchema,part.envelope);await validate(part.data.schema,part.data.content);
});

test('wallet initialization is part of registration rollback and SQLite rejects fractional, negative or unsafe balances',async t=>{
 const f=await fixture(t),{credential,registrationCommand}=await import('../../scripts/agent-manager-qa-fixture.ts'),inviteToken=credential(),command=registrationCommand(inviteToken);
 await ok(f.m1,'POST','/owner/agent-invites',{operationId:randomUUID(),inviteToken},f.owner.sessionToken);
 const snapshot=()=>f.storage(store=>store.read(tx=>key(M1_TABLES.map(table=>tx.find(table))))),before=snapshot(),db=new DatabaseSync(f.options.databasePath);
 try{db.exec("CREATE TRIGGER isolated_wallet_fault BEFORE INSERT ON wallet_accounts BEGIN SELECT RAISE(ABORT,'wallet-registration-fault'); END");}finally{db.close();}
 try{const failed=await f.m1('POST','/registrations',command);assert(failed.status>=400);assert.equal(snapshot(),before);}finally{const db=new DatabaseSync(f.options.databasePath);try{db.exec('DROP TRIGGER isolated_wallet_fault');}finally{db.close();}}
 const registered=await ok(f.m1,'POST','/registrations',command),account=f.storage(store=>store.read(tx=>tx.get('wallet_accounts',walletAccountId(registered.agentId))!));assert.equal(account.data.balance,0);await ok(f.m1,'POST','/registrations',command);assert.deepEqual(f.storage(store=>store.read(tx=>tx.get('wallet_accounts',account.id))),account);
 for(const balance of [-1,0.5,Number.MAX_SAFE_INTEGER+1]){assert.throws(()=>f.storage(store=>store.transaction(tx=>tx.update('wallet_accounts',{...account,version:account.version+1,data:{...account.data,balance}},account.version))));assert.deepEqual(f.storage(store=>store.read(tx=>tx.get('wallet_accounts',account.id))),account);}
});
