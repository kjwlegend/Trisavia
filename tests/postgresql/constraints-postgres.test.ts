import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test,{after,beforeEach} from 'node:test';
import { Pool } from 'pg';
import type { JsonObject } from '../../apps/platform/contracts/store.ts';
import { admin,applicationOptions,row,errorCode,resetFixture,testStore } from './storage-fixture.ts';

const dml=new Pool({connectionString:applicationOptions.connectionString,max:2});
beforeEach(resetFixture);after(async()=>{await dml.end();await admin.end();});
const credential=(id:string,agentId:string,fingerprint=id)=>row(id,{fingerprint,kind:'runtime',verifier:'fixture-only',epoch:'epoch-test',active:true,agentId});
const wallet=(agentId:string,balance:number)=>row(`star_coin:${agentId}`,{agentId,currencyCode:'star_coin',currencyName:'星币',scale:0,balance,initializedAt:0,initializationSource:'registration'});
const message=(id:string,messageId=id,agentId='a')=>row(id,{messageId,contentVersion:1,sourceId:'fixture',sourceMessageKey:messageId,title:'标题',body:'正文 🧭',attachments:[],receivedAt:0,sender:{kind:'agent',ref:{moduleId:'agents',type:'agent',id:agentId},displayName:'Agent'}});
const session=(id:string,data:JsonObject)=>row(id,{kind:'list',actorId:'a',actorKind:'agent',permissionVersion:'permission-fixture',epoch:'epoch-test',expiresAt:Date.now()+60_000,...data});

test('real FK and independent credential, active-binding, membership and operation uniqueness',async()=>{
  const store=await testStore();try{
    await store.transaction(async tx=>{await tx.insert('agents',row('a'));await tx.insert('owners',row('o',{status:'active'}));await tx.insert('owners',row('o2',{status:'active'}));await tx.insert('credentials',credential('c','a','fingerprint'));await tx.insert('bindings',row('b',{agentId:'a',ownerId:'o',active:true}));await tx.insert('memberships',row('m',{agentId:'a',worldId:'world',state:'joined',ownerPaused:false,platformRestricted:true,ownerPauseVersion:0,platformVersion:1}));await tx.insert('operations',row('receipt',{scope:'owner:o',action:'bind',operationId:'same',epoch:'epoch-test'}));});
    await assert.rejects(store.transaction(tx=>tx.insert('credentials',credential('c2','a','fingerprint'))),errorCode('constraint'));
    await assert.rejects(store.transaction(tx=>tx.insert('bindings',row('b2',{agentId:'a',ownerId:'o2',active:true}))),errorCode('constraint'));
    await store.transaction(tx=>tx.insert('bindings',row('history',{agentId:'a',ownerId:'o2',active:false})));
    await assert.rejects(store.transaction(tx=>tx.insert('memberships',row('m2',{agentId:'a',worldId:'world',state:'joined'}))),errorCode('constraint'));
    await assert.rejects(store.transaction(tx=>tx.insert('operations',row('receipt2',{scope:'owner:o',action:'bind',operationId:'same',epoch:'epoch-test'}))),errorCode('constraint'));
    await assert.rejects(store.transaction(async tx=>{await tx.insert('facts',row('rollback',{action:'before-orphan'}));await tx.insert('bindings',row('orphan',{agentId:'missing',ownerId:'o',active:true}));}),errorCode('constraint'));
    assert.equal(await store.read(tx=>tx.get('facts','rollback')),undefined);
    assert.equal((await store.read(tx=>tx.get('memberships','m')))?.data.platformRestricted,true);
    await assert.rejects(dml.query("UPDATE iam.management_bindings SET agent_id='missing' WHERE id='b'"),errorCode('23503'));
  }finally{await store.close();}
});

test('wallet bounds are exact safe integers in both codec and relational constraints',async()=>{
  const store=await testStore();try{
    await store.transaction(async tx=>{await tx.insert('agents',row('zero'));await tx.insert('agents',row('max'));await tx.insert('wallet_accounts',wallet('zero',0));await tx.insert('wallet_accounts',wallet('max',Number.MAX_SAFE_INTEGER));});
    assert.equal((await store.read(tx=>tx.get('wallet_accounts','star_coin:zero')))?.data.balance,0);
    assert.equal((await store.read(tx=>tx.get('wallet_accounts','star_coin:max')))?.data.balance,Number.MAX_SAFE_INTEGER);
    for(const balance of [0.5,Number.MAX_SAFE_INTEGER+1,NaN])await assert.rejects(store.transaction(tx=>tx.update('wallet_accounts',row('star_coin:zero',{...wallet('zero',0).data,balance},2),1)),errorCode('invalid_usage'));
    for(const sql of ["UPDATE wallet.accounts SET balance=-1 WHERE id='star_coin:zero'","UPDATE wallet.accounts SET balance=9007199254740992 WHERE id='star_coin:zero'","UPDATE wallet.accounts SET currency_code='other' WHERE id='star_coin:zero'","UPDATE wallet.accounts SET id='wrong' WHERE id='star_coin:zero'"])await assert.rejects(dml.query(sql),errorCode('23514'));
    const outcomes=await Promise.allSettled([store.transaction(tx=>tx.insert('wallet_accounts',wallet('zero',0))),store.transaction(tx=>tx.insert('wallet_accounts',wallet('zero',0)))]);
    assert.equal(outcomes.filter(item=>item.status==='rejected').length,2);
    assert.equal(await store.read(tx=>tx.count('wallet_accounts',{agentId:'zero'},10)),1);
  }finally{await store.close();}
});

test('profile content and permissions are separate relations with exact optional shape',async()=>{
  const store=await testStore(),profile=row('profile',{agentId:'a',mode:'manual',policyVersion:1,publishedVersion:0,lockedFields:[],draft:{displayName:'名字',bio:null,interests:[],avatar:{template:'circle',color:'#123456'}},published:null});
  try{await store.transaction(async tx=>{await tx.insert('agents',row('a'));await tx.insert('profiles',profile);});
    assert.deepEqual(await store.read(tx=>tx.get('profiles','profile')),profile);
    assert.equal((await dml.query('SELECT count(*)::integer n FROM profiles.profile_contents')).rows[0].n,1);
    assert.equal((await dml.query('SELECT count(*)::integer n FROM profiles.field_policies')).rows[0].n,0);
    await assert.rejects(store.transaction(tx=>tx.insert('profiles',row('duplicate',{agentId:'a'}))),errorCode('constraint'));
    await assert.rejects(store.transaction(tx=>tx.update('profiles',row('profile',{...profile.data,draft:{displayName:'changed',unknown:'not-accepted'}},2),1)),errorCode('invalid_usage'));
    assert.deepEqual(await store.read(tx=>tx.get('profiles','profile')),profile);
  }finally{await store.close();}
});

test('mailbox sender identity, delivery relationships and confirmations remain independent',async()=>{
  const store=await testStore();try{
    await store.transaction(async tx=>{await tx.insert('agents',row('a'));await tx.insert('agents',row('recipient'));await tx.insert('mailbox_messages',message('v1','message'));await tx.insert('mailbox_messages',message('other-v1','other'));});
    const receipt=row('receipt',{messageId:'message',messageVersionId:'v1',agentId:'recipient',active:true,receivedAt:0,confirmedAt:null,confirmedContentVersion:null,stateVersion:0,ownerObservation:{existence:true,summary:false,body:false,attachments:false},ownerObservationAudience:'current_bound_owner'});
    await store.transaction(tx=>tx.insert('mailbox_receipts',receipt));assert.deepEqual(await store.read(tx=>tx.get('mailbox_receipts','receipt')),receipt);
    await assert.rejects(store.transaction(tx=>tx.insert('mailbox_receipts',row('wrong-pair',{...receipt.data,messageVersionId:'other-v1'}))),errorCode('constraint'));
    await assert.rejects(store.transaction(tx=>tx.insert('mailbox_messages',message('orphan-sender','orphan','missing'))),errorCode('constraint'));
    await assert.rejects(store.transaction(tx=>tx.insert('mailbox_messages',row('unverified',{...message('unverified').data,sender:{kind:'human',ref:{moduleId:'external',type:'identity',id:'upstream-user'},displayName:'Human'}}))),errorCode('constraint'));
    const human=row('verified',{...message('verified').data,sender:{kind:'human',ref:{moduleId:'external',type:'identity',id:'upstream-user'},displayName:'已验证姓名',nameSource:{kind:'upstream_identity',authorityId:'upstream',version:1}}});
    await store.transaction(tx=>tx.insert('mailbox_messages',human));assert.deepEqual(await store.read(tx=>tx.get('mailbox_messages','verified')),human);
    assert.equal(await store.read(tx=>tx.count('owners',{},10)),0);
    assert.equal((await dml.query('SELECT confirmed_content_version,confirmed_at FROM mailbox.agent_version_confirmations WHERE parent_id=$1',['receipt'])).rows[0].confirmed_at,null);
  }finally{await store.close();}
});

test('versioned documents, releases, history and message content reject raw DML rewrite and deletion',async()=>{
  const store=await testStore();try{
    const document={z:'后',a:'e\u0301',emoji:'🧭',nested:{absent:false,nothing:null,zero:0}},serialized=JSON.stringify(document),digest=createHash('sha256').update(serialized).digest('hex');
    const source=row('schema:test@1',{document,digest});
    await store.transaction(async tx=>{await tx.insert('agents',row('a'));await tx.insert('mailbox_messages',message('v1'));await tx.insert('perception_catalog',source);await tx.insert('perception_catalog',row('release',{kind:'catalog_revision',catalogRevision:'r1',schemaVersion:1,digest,declaration:{sources:[]}}));await tx.insert('perception_catalog',row('history',{kind:'object_history',objectId:'item',contentVersion:1,recordedAt:0,content:{ref:{moduleId:'items',type:'items.item@1',id:'item'},type:'items.item@1',title:'旧版'}}));});
    const restored=(await store.read(tx=>tx.get('perception_catalog',source.id)))!;assert.deepEqual(restored,source);assert.equal(JSON.stringify(restored.data.document),serialized);
    assert.equal((await dml.query('SELECT document_text FROM perception.documents WHERE id=$1',[source.id])).rows[0].document_text,serialized);
    for(const table of ['perception.documents','perception.catalog_releases','items.content_history','mailbox.message_versions']){
      await assert.rejects(dml.query(`UPDATE ${table} SET version=version`),errorCode('23514'));
      await assert.rejects(dml.query(`DELETE FROM ${table}`),errorCode('23514'));
    }
    await assert.rejects(store.transaction(tx=>tx.remove('perception_catalog',source.id,1)),errorCode('constraint'));
    assert.deepEqual(await store.read(tx=>tx.get('perception_catalog',source.id)),source);
  }finally{await store.close();}
});

test('all persisted read-session shapes retain number/hash authority and ordered large frozen pages',async()=>{
  const store=await testStore(),hash='a'.repeat(64),large='正文🧭'.repeat(6000);
  const samples=[session('old',{kind:'detail',grantVersion:3,ref:{moduleId:'mailbox',type:'mailbox.message@1',id:'old'}}),session('new',{kind:'detail',grantVersion:hash,ref:{moduleId:'mailbox',type:'mailbox.message@1',id:'new'}}),session('completion',{kind:'completion',grantVersion:hash,readSessionId:'new',contentVersion:2}),session('list',{kind:'list',offset:0,limit:1,records:[{id:'second',body:large},{id:'first',body:null}],grantVersions:{old:3,new:hash,none:null}}),session('discovery',{kind:'discovery',offset:1,limit:1,snapshot:{catalogRevision:'r1',skillCatalogRevision:'s1',modules:[{id:'b'},{id:'a'}],categories:[],schemaReader:{url:'/schema'},notEnabled:[]}}),session('activity',{kind:'activity',cut:0,records:[],context:null}),session('missing',{}),session('null',{grantVersion:null})];
  try{await store.transaction(async tx=>{for(const source of samples)await tx.insert('perception_sessions',source);});
    for(const source of samples)assert.deepEqual(await store.read(tx=>tx.get('perception_sessions',source.id)),source);
    assert.equal((await dml.query("SELECT grant_version_number::text,grant_version_hash FROM perception.read_sessions WHERE id='new'")).rows[0].grant_version_hash,hash);
    assert.ok((await dml.query("SELECT octet_length(entry_text)::integer bytes FROM perception.read_session_items WHERE parent_id='list' AND ordinal=0")).rows[0].bytes>16_384);
    assert.equal((await store.read(tx=>tx.find('perception_sessions',{grantVersion:hash}))).length,2);
    await assert.rejects(store.transaction(tx=>tx.insert('perception_sessions',session('bad-hash',{grantVersion:'123'}))),errorCode('invalid_usage'));
    await assert.rejects(store.transaction(tx=>tx.insert('perception_sessions',session('bad-snapshot',{kind:'discovery',snapshot:{futureUnknown:[]}}))),errorCode('invalid_usage'));
    assert.equal(await store.read(tx=>tx.get('perception_sessions','bad-snapshot')),undefined);
  }finally{await store.close();}
});

test('access targets and related records are ordered child relations, with no mirror row',async()=>{
  const store=await testStore(),access=row('access',{recordId:'record',agentId:'a',recordedAt:0,receivedAt:0,scopePrivate:false,actor:{kind:'agent',id:'a'},result:{status:'ok'},targets:[{ref:{moduleId:'items',type:'items.item@1',id:'z'},projection:{visible:false}},{ref:{moduleId:'items',type:'items.item@1',id:'a'},projection:null}],relatedRecordIds:['second','first']});
  try{await store.transaction(tx=>tx.insert('perception_access',access));assert.deepEqual(await store.read(tx=>tx.get('perception_access','access')),access);
    assert.equal((await dml.query("SELECT count(*)::integer n FROM perception.access_targets WHERE parent_id='access'")).rows[0].n,2);
    assert.deepEqual((await dml.query("SELECT entry_text FROM perception.access_related_records WHERE parent_id='access' ORDER BY ordinal")).rows.map(item=>JSON.parse(item.entry_text)),['second','first']);
    const columns=(await dml.query("SELECT column_name FROM information_schema.columns WHERE table_schema='perception' AND table_name='access_facts'")).rows.map(item=>item.column_name);assert.equal(columns.includes('data'),false);assert.equal(columns.includes('targets'),false);
  }finally{await store.close();}
});

test('emailVerified source declaration is typed and unknown source kinds/fields roll back completely',async()=>{
  const store=await testStore();try{
    await store.transaction(async tx=>{await tx.insert('agents',row('a'));await tx.insert('credentials',row('browser',{fingerprint:'browser',kind:'email_registration',verifier:'fixture-only',epoch:'epoch-test',active:true}));await tx.insert('email_attempts',row('attempt',{browserCredentialId:'browser',purpose:'registration',emailVerified:false,email:'synthetic@example.invalid',emailKey:'synthetic@example.invalid',generation:0}));});
    assert.equal((await store.read(tx=>tx.get('email_attempts','attempt')))?.data.emailVerified,false);
    assert.equal((await dml.query("SELECT email_verified FROM iam.email_attempts WHERE id='attempt'")).rows[0].email_verified,false);
    for(const [table,source] of [['perception_objects',row('future',{type:'future.object@1'})],['perception_grants',row('future',{kind:'future'})],['perception_catalog',row('future',{kind:'future'})],['agents',row('future',{unmapped:true})]] as const){
      await assert.rejects(store.transaction(async tx=>{await tx.insert('facts',row('before',{action:'before-invalid-source'}));await tx.insert(table,source);}),errorCode('invalid_usage'));
      assert.equal(await store.read(tx=>tx.get('facts','before')),undefined);
    }
  }finally{await store.close();}
});
