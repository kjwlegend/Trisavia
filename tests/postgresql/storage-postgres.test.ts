import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test,{after,beforeEach} from 'node:test';
import type { M1ReadSession } from '../../apps/platform/contracts/store.ts';
import { openPostgresStore, setPostgresWriteGate } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { admin,options,applicationOptions,row,errorCode,resetFixture,testStore } from './storage-fixture.ts';

beforeEach(resetFixture);after(()=>admin.end());

test('real async DML role commits typed values and preserves missing/null/false/zero',async()=>{
  const store=await testStore();try{
    await store.transaction(async tx=>{await tx.insert('agents',row('a',{runtimeVersion:1,runtimeActive:false,createdAt:0,managementInitializedAt:null,worldAccess:{version:1,intervalSeconds:null}}));});
    assert.deepEqual(await store.read(tx=>tx.get('agents','a')),row('a',{runtimeVersion:1,runtimeActive:false,createdAt:0,managementInitializedAt:null,worldAccess:{version:1,intervalSeconds:null}}));
    assert.equal((await store.read(tx=>tx.find('agents',{managementInitializedAt:null}))).length,1);
    assert.equal((await store.read(tx=>tx.find('agents',{deliveryDeclaredAt:null}))).length,0);
    assert.equal((await store.read(tx=>tx.find('agents',{runtimeActive:false}))).length,1);
    assert.equal(await store.read(tx=>tx.count('agents',{},1)),1);
  }finally{await store.close();}
});

test('a failing callback rolls back state, facts, receipt and write generation',async()=>{
  const store=await testStore(),before=(await admin.query('SELECT write_generation FROM platform.instance_state')).rows[0].write_generation;
  try{await assert.rejects(store.transaction(async tx=>{await tx.insert('agents',row('a'));await tx.insert('facts',row('f',{action:'register'}));throw new Error('injected failure');}),/injected/);
    assert.equal(await store.read(tx=>tx.count('agents',{},10)),0);assert.equal(await store.read(tx=>tx.count('facts',{},10)),0);
    assert.equal((await admin.query('SELECT write_generation FROM platform.instance_state')).rows[0].write_generation,before);
  }finally{await store.close();}
});

test('CAS is conditional, keyset ordering is explicit C, and filters are SQL limited',async()=>{
  const store=await testStore();try{
    await store.transaction(async tx=>{for(const id of ['a','Z','é'])await tx.insert('agents',row(id,{runtimeVersion:1}));});
    assert.deepEqual((await store.read(tx=>tx.scan('agents',{}, {limit:2}))).map(item=>item.id),['Z','a']);
    assert.deepEqual((await store.read(tx=>tx.scan('agents',{}, {limit:2,afterId:'a'}))).map(item=>item.id),['é']);
    assert.equal(await store.transaction(tx=>tx.update('agents',row('a',{runtimeVersion:2},2),1)),true);
    assert.equal(await store.transaction(tx=>tx.update('agents',row('a',{runtimeVersion:2},2),1)),false);
    await assert.rejects(store.transaction(tx=>tx.update('agents',row('a',{},4),2)),errorCode('invalid_usage'));
    assert.equal(await store.read(tx=>tx.count('agents',{runtimeVersion:1},1)),1);
    assert.equal((await store.read(tx=>tx.scan('agents',{runtimeVersion:2},{limit:1})))[0]?.id,'a');
  }finally{await store.close();}
});

test('controlled SQL expiry selection filters before its limit and preserves the timestamp boundaries',async()=>{
  const store=await testStore(),now=Date.now();
  const expiry={limit:200,cutoff:{field:'expiresAt' as const,at:now,inclusive:true}},retention={limit:200,cutoff:{field:'recordedAt' as const,at:now,inclusive:false}};
  try{
    await store.transaction(async tx=>{
      for(let index=0;index<200;index++){
        const suffix=String(index).padStart(3,'0'),session={kind:'list',actorId:'fixture-reader',actorKind:'agent',permissionVersion:'fixture',epoch:options.recoveryEpoch};
        await tx.insert('perception_sessions',row(`a-active-${suffix}`,{...session,expiresAt:now+60_000,records:[{ref:'still-valid'}]}));
        await tx.insert('perception_sessions',row(`z-expired-${suffix}`,{...session,expiresAt:now}));
        await tx.insert('perception_access',row(`a-current-${suffix}`,{recordedAt:now+1}));
        await tx.insert('perception_access',row(`z-expired-${suffix}`,{recordedAt:now-1}));
      }
      await tx.insert('perception_access',row('boundary',{recordedAt:now}));await tx.insert('perception_access',row('missing'));await tx.insert('perception_access',row('null',{recordedAt:null}));
    });
    const sessions=await store.read(tx=>tx.scan('perception_sessions',{},expiry)),access=await store.read(tx=>tx.scan('perception_access',{},retention));
    assert.equal(sessions.length,200);assert.ok(sessions.every(item=>item.id.startsWith('z-expired-')));
    assert.equal(access.length,200);assert.ok(access.every(item=>item.id.startsWith('z-expired-')));
    const inclusive={limit:2,cutoff:{field:'recordedAt' as const,at:now,inclusive:true}};assert.equal((await store.read(tx=>tx.scan('perception_access',{},inclusive)))[0]?.id,'boundary');
    const strict={limit:200,cutoff:{field:'expiresAt' as const,at:now,inclusive:false}};assert.equal((await store.read(tx=>tx.scan('perception_sessions',{},strict))).length,0);
    assert.deepEqual((await store.read(tx=>tx.get('perception_sessions','a-active-000')))?.data.records,[{ref:'still-valid'}]);
    for(const invalid of [{...expiry,cutoff:{...expiry.cutoff,at:NaN}},{...expiry,cutoff:{...expiry.cutoff,at:-1}},{...expiry,cutoff:{...expiry.cutoff,field:'recordedAt' as const}}])await assert.rejects(store.read(tx=>tx.scan('perception_sessions',{},invalid)),errorCode('invalid_usage'));
    await assert.rejects(store.read(tx=>tx.scan('agents',{},expiry)),errorCode('invalid_usage'));
  }finally{await store.close();}
});

test('write gate closes before application open while pure reads do not persist guard changes',async()=>{
  await setPostgresWriteGate(options,{enabled:false});const store=await testStore();
  try{const before=(await admin.query('SELECT * FROM platform.instance_state')).rows[0];
    assert.equal(await store.read(tx=>tx.count('wallet_accounts',{},1)),0);
    assert.deepEqual((await admin.query('SELECT * FROM platform.instance_state')).rows[0],before);
    await assert.rejects(store.transaction(tx=>tx.insert('agents',row('forbidden'))),errorCode('unavailable'));
    await setPostgresWriteGate(options,{enabled:true});await store.transaction(tx=>tx.insert('agents',row('allowed')));
  }finally{await store.close();}
});

test('a changed epoch fences existing clients and open does not rewrite it',async()=>{
  const store=await testStore();try{
    await admin.query("UPDATE platform.instance_state SET recovery_epoch='epoch-next',write_generation=write_generation+1");
    await assert.rejects(store.read(async()=>true),errorCode('conflict'));
    await assert.rejects(store.transaction(tx=>tx.insert('agents',row('forbidden'))),errorCode('conflict'));
    await assert.rejects(openPostgresStore(applicationOptions),errorCode('conflict'));
    const current=await openPostgresStore({...applicationOptions,recoveryEpoch:'epoch-next'});await current.close();
  }finally{await admin.query('UPDATE platform.instance_state SET recovery_epoch=$1,write_generation=write_generation+1',[options.recoveryEpoch]);await store.close();}
});

test('RR waiting reader retries before authorization callback after a committed revocation',async()=>{
  const store=await testStore(),writer=await admin.connect();let calls=0;
  try{await store.transaction(tx=>tx.insert('agents',row('a',{runtimeActive:true})));
    await writer.query('BEGIN');await writer.query('SELECT * FROM platform.instance_state WHERE singleton=1 FOR UPDATE');
    await writer.query('UPDATE platform.instance_state SET write_generation=write_generation+1');await writer.query("UPDATE iam.agents SET runtime_active=false WHERE id='a'");
    const pending=store.read(async tx=>{calls++;return (await tx.get('agents','a'))?.data.runtimeActive;});
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,0);await writer.query('COMMIT');
    assert.equal(await pending,false);assert.equal(calls,1);
  }finally{await writer.query('ROLLBACK');writer.release();await store.close();}
});

test('reader that acquired guard first completes its valid snapshot before a writer',async()=>{
  const store=await testStore();let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  try{await store.transaction(tx=>tx.insert('agents',row('a',{runtimeActive:true})));
    const reading=store.read(async tx=>{const first=await tx.get('agents','a');entered();await hold;const second=await tx.get('agents','a');assert.equal(second?.data.runtimeActive,first?.data.runtimeActive);return first?.data.runtimeActive;});
    await ready;let wrote=false;const writing=store.transaction(async tx=>{const current=(await tx.get('agents','a'))!;await tx.update('agents',row('a',{runtimeActive:false},current.version+1),current.version);wrote=true;});
    await new Promise(resolve=>setTimeout(resolve,25));assert.equal(wrote,false);release();assert.equal(await reading,true);await writing;
    assert.equal((await store.read(tx=>tx.get('agents','a')))?.data.runtimeActive,false);
  }finally{release?.();await store.close();}
});

test('scoped handles, read mutation, nested use and close are bounded',async()=>{
  const store=await testStore();let escaped!:M1ReadSession;
  await store.read(async tx=>{escaped=tx;assert.equal('insert'in tx,false);await assert.rejects(store.transaction(async()=>true),errorCode('invalid_usage'));await assert.rejects(store.close(),errorCode('invalid_usage'));});
  await assert.rejects(escaped.get('agents','a'),errorCode('closed'));
  await store.close();await store.close();await assert.rejects(store.read(async()=>true),errorCode('closed'));
});

test('DML role cannot migrate, alter deployment identity, or enable the write gate',async()=>{
  const connection=new (await import('pg')).Pool({connectionString:applicationOptions.connectionString});
  try{await assert.rejects(connection.query('CREATE TABLE iam.forbidden(id text)'),errorCode('42501'));
    await assert.rejects(connection.query("UPDATE platform.instance_state SET recovery_epoch='forbidden'"),errorCode('42501'));
    await assert.rejects(connection.query('UPDATE platform.instance_state SET writes_enabled=true'),errorCode('42501'));
    await assert.rejects(connection.query("DELETE FROM platform.module_migrations"),errorCode('42501'));
  }finally{await connection.end();}
});

test('40001 retries the complete callback at most three times and leaves no partial receipt',async()=>{
  const store=await testStore();let callbacks=0;
  await admin.query(`CREATE FUNCTION platform.storage_test_serialization_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='retry-exhausted' THEN RAISE EXCEPTION 'isolated serialization fixture' USING ERRCODE='40001'; END IF; RETURN NEW; END;
    $$;
    CREATE TRIGGER storage_test_serialization_failure BEFORE INSERT ON iam.agents FOR EACH ROW EXECUTE FUNCTION platform.storage_test_serialization_failure();`);
  try{
    await store.transaction(tx=>tx.insert('agents',row('retry-cache',{runtimeActive:true})));
    const before=(await admin.query('SELECT write_generation FROM platform.instance_state')).rows[0].write_generation;
    await assert.rejects(store.transaction(async tx=>{callbacks++;assert.equal((await tx.get('agents','retry-cache'))?.data.runtimeActive,true);await tx.update('agents',row('retry-cache',{runtimeActive:false},2),1);assert.equal((await tx.get('agents','retry-cache'))?.data.runtimeActive,false);await tx.insert('operations',row('before-retry',{scope:'test',action:'retry',operationId:'same-operation',epoch:options.recoveryEpoch}));await tx.insert('agents',row('retry-exhausted'));}),errorCode('busy'));
    assert.equal(callbacks,3);assert.equal(await store.read(tx=>tx.get('operations','before-retry')),undefined);
    assert.equal((await admin.query('SELECT write_generation FROM platform.instance_state')).rows[0].write_generation,before);
    await store.transaction(tx=>tx.insert('agents',row('usable-after-exhaustion')));
    assert.ok(await store.read(tx=>tx.get('agents','usable-after-exhaustion')));
  }finally{await admin.query('DROP TRIGGER storage_test_serialization_failure ON iam.agents; DROP FUNCTION platform.storage_test_serialization_failure()');await store.close();}
});

test('close rejects new scopes and drains active and already queued app-role scopes before resolving',async()=>{
  const store=await openPostgresStore({...applicationOptions,poolMax:1});let release!:()=>void,entered!:()=>void,closed=false;
  const ready=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  try{await store.transaction(tx=>tx.insert('agents',row('a')));
    const reading=store.read(async tx=>{entered();await hold;return tx.get('agents','a');});await ready;
    let queuedEntered=false;const queued=store.read(async tx=>{queuedEntered=true;return tx.get('agents','a');});
    const closing=store.close().then(()=>{closed=true;});await assert.rejects(store.read(async()=>true),errorCode('closed'));
    await new Promise(resolve=>setTimeout(resolve,25));assert.equal(closed,false);assert.equal(queuedEntered,false);release();assert.equal((await reading)?.id,'a');assert.equal((await queued)?.id,'a');await closing;assert.equal(closed,true);assert.equal(queuedEntered,true);await store.close();
  }finally{release?.();await store.close();}
});

test('lost real COMMIT acknowledgement is unknown_commit and original receipt remains exactly once',async()=>{
  const destination=new URL(applicationOptions.connectionString),sockets=new Set<net.Socket>();let dropped=false;
  const proxy=net.createServer(front=>{
    const back=net.connect({host:destination.hostname,port:Number(destination.port)});sockets.add(front);sockets.add(back);
    let pending=false,frontBytes=Buffer.alloc(0),backBytes=Buffer.alloc(0),startup=true;
    front.on('error',()=>back.destroy());back.on('error',()=>front.destroy());front.on('close',()=>{sockets.delete(front);back.destroy();});back.on('close',()=>{sockets.delete(back);front.destroy();});
    front.on('data',chunk=>{
      frontBytes=Buffer.concat([frontBytes,chunk]);
      for(;;){if(frontBytes.length<(startup?4:5))break;const length=startup?frontBytes.readInt32BE(0):frontBytes.readInt32BE(1)+1;if(frontBytes.length<length)break;const packet=frontBytes.subarray(0,length);frontBytes=frontBytes.subarray(length);if(!startup&&packet[0]===81&&packet.subarray(5).toString().replace(/\0$/,'')==='COMMIT'&&!dropped)pending=true;startup=false;back.write(packet);}
    });
    back.on('data',chunk=>{
      backBytes=Buffer.concat([backBytes,chunk]);for(;;){if(backBytes.length<5)break;const length=backBytes.readInt32BE(1)+1;if(backBytes.length<length)break;const packet=backBytes.subarray(0,length);backBytes=backBytes.subarray(length);if(pending&&packet[0]===67&&packet.subarray(5).toString()==='COMMIT\0'){dropped=true;front.destroy();back.destroy();break;}front.write(packet);}
    });
  });
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const address=proxy.address() as net.AddressInfo,proxied=new URL(destination);proxied.hostname='127.0.0.1';proxied.port=String(address.port);proxied.searchParams.set('sslmode','disable');
  const store=await openPostgresStore({...applicationOptions,connectionString:proxied.toString()});let callbacks=0;
  try{await assert.rejects(store.transaction(async tx=>{callbacks++;await tx.insert('operations',row('receipt-unknown',{scope:'test',action:'commit',operationId:'original-operation',epoch:options.recoveryEpoch,result:{receiptId:'fixed',outcome:'committed'}}));}),errorCode('unknown_commit'));
    assert.equal(dropped,true);assert.equal(callbacks,1);
    const direct=await testStore();try{assert.equal(await direct.read(tx=>tx.count('operations',{operationId:'original-operation'},10)),1);}finally{await direct.close();}
  }finally{await store.close();for(const socket of sockets)socket.destroy();proxy.close();await once(proxy,'close');}
});
