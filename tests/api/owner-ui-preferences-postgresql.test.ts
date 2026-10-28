import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {createIsolatedDatabase,dropIsolatedDatabase} from '../../scripts/postgresql/database.ts';
import {docker,readRuntime,requirePrivateFile} from '../../scripts/postgresql/runtime.ts';
import {migratePostgres,POSTGRES_MIGRATIONS} from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import {OWNER_UI_PREFERENCES_MIGRATION} from '../../apps/platform/infrastructure/postgresql/owner-ui-preferences-migration.ts';
import {openPostgresStore,setPostgresWriteGate} from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import {createM1Service} from '../../apps/platform/application/m1-service.ts';
import {parseToken,verifier} from '../../apps/platform/domains/access/credentials.ts';
import type {M1Store,StoredRow} from '../../apps/platform/contracts/store.ts';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const historySql='SELECT * FROM platform.module_migrations ORDER BY module_id,migration_version';
const ownerWithoutNewColumns="SELECT to_jsonb(t)-ARRAY['ui_locale','ui_preferences_version','ui_preferences_updated_at']::text[] AS row FROM iam.human_accounts t WHERE id=$1";
const publicIdentitySql="SELECT * FROM public_identifiers.identities WHERE subject_kind='owner' AND subject_id=$1";

// Explicit opt-in only. TD executes this one new database; importing this file
// never reads a real Owner, starts a listener or dispatches an email.
test('iam@8 upgrades real legacy Owner rows and persists preferences through the application codec',async t=>{
 const runtimeFile=process.env.M1_POSTGRES_TEST_RUNTIME,requestedRoot=process.env.M1_OWNER_UI_BASELINE_ROOT;
 assert(runtimeFile,'Set M1_POSTGRES_TEST_RUNTIME to the existing private local runtime.json');
 assert(requestedRoot&&isAbsolute(requestedRoot),'Set M1_OWNER_UI_BASELINE_ROOT to the fixed 0.11.0 source root');
 const baselineRoot=await realpath(requestedRoot);
 assert.equal(JSON.parse(await readFile(join(baselineRoot,'package.json'),'utf8')).version,'0.11.0');
 const baselineMigrations=await import(pathToFileURL(join(baselineRoot,'apps/platform/infrastructure/postgresql/migrations.ts')).href) as typeof import('../../apps/platform/infrastructure/postgresql/migrations.ts');
 const baselineStore=await import(pathToFileURL(join(baselineRoot,'apps/platform/infrastructure/postgresql/postgres-store.ts')).href) as typeof import('../../apps/platform/infrastructure/postgresql/postgres-store.ts');
 const baselinePermissions=await import(pathToFileURL(join(baselineRoot,'scripts/postgresql/permissions.ts')).href) as typeof import('../../scripts/postgresql/permissions.ts');
 assert.equal(baselineMigrations.POSTGRES_MIGRATIONS.length,62);
 assert(!baselineMigrations.POSTGRES_MIGRATIONS.some(row=>row.moduleId==='iam'&&row.version===8));
 assert.equal(POSTGRES_MIGRATIONS.length,63);
 for(const old of baselineMigrations.POSTGRES_MIGRATIONS){
  assert.deepEqual(POSTGRES_MIGRATIONS.find(row=>row.moduleId===old.moduleId&&row.version===old.version),old,'applied migration source bytes must remain frozen');
 }
 assert.deepEqual(POSTGRES_MIGRATIONS.filter(row=>!baselineMigrations.POSTGRES_MIGRATIONS.some(old=>old.moduleId===row.moduleId&&old.version===row.version)),[OWNER_UI_PREFERENCES_MIGRATION]);

 const runtime=await readRuntime(runtimeFile),directory=await mkdtemp(join(tmpdir(),'owner-ui-pg-'));
 const database='connet_test_a_ui_'+randomBytes(8).toString('hex'),identity={instanceId:'instance_'+randomUUID(),recoveryEpoch:'epoch_'+randomUUID()},now=Date.UTC(2026,9,28,13);
 let connections:string|undefined,createdOid:number|undefined,inspection:Pool|undefined,application:Pool|undefined,store:M1Store|undefined;
 try{
  const made=await createIsolatedDatabase(runtime,database,join(directory,'connections'));connections=made.privateConnections;
  const created=JSON.parse(await requirePrivateFile(join(connections,'created-database.json'))) as {database:string;oid:number;owner:string};
  assert.equal(created.database,database);assert.equal(created.owner,'connet_migrator');assert(Number.isSafeInteger(created.oid));
  createdOid=created.oid;
  t.diagnostic(JSON.stringify({creator:'a',database,oid:created.oid,...identity,phase:'created'}));
  const migrationConnectionString=(await requirePrivateFile(join(connections,'migration-database-url'))).trim(),connectionString=(await requirePrivateFile(join(connections,'application-database-url'))).trim();
  const migrationOptions={connectionString:migrationConnectionString,...identity},appOptions={connectionString,...identity};
  inspection=new Pool({connectionString:migrationConnectionString,max:1});
  const actual=(await inspection.query('SELECT oid::bigint,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()')).rows[0]!;
  assert.equal(Number(actual.oid),created.oid);assert.equal(actual.owner,created.owner);

  // Establish the complete real old schema/permissions; never filter the new
  // migration array or reproduce production DDL inside this fixture.
  await baselineMigrations.migratePostgres(migrationOptions);
  await baselinePermissions.grantApplicationPermissions(runtime,database);
  await baselineStore.setPostgresWriteGate(migrationOptions,{enabled:true});
  store=await baselineStore.openPostgresStore(appOptions);
  const ownerId=randomUUID(),mail='synthetic-'+randomUUID()+'@example.test',token=randomUUID()+'.'+randomBytes(32).toString('base64url'),parsed=parseToken(token,true);
  const oldOwner:StoredRow={id:ownerId,version:7,data:{status:'active',epoch:identity.recoveryEpoch,authVersion:3,username:'Legacy_'+ownerId.slice(0,8),usernameKey:('Legacy_'+ownerId.slice(0,8)).toLowerCase(),email:mail,emailKey:mail,emailVerified:true,emailVersion:1,createdAt:now-86400000,passwordSalt:'synthetic-salt',passwordHash:'synthetic-password-hash'}};
  const oldCredential:StoredRow={id:parsed.id,version:1,data:{kind:'owner_session',fingerprint:parsed.fingerprint,verifier:verifier('owner_session',parsed),epoch:identity.recoveryEpoch,active:true,agentId:null,ownerId,expiresAt:now+86400000,ownerAuthVersion:3}};
  await store.transaction(async tx=>{await tx.insert('owners',oldOwner);await tx.insert('credentials',oldCredential);});
  assert.deepEqual(await store.read(tx=>tx.get('owners',ownerId)),oldOwner);
  await store.close();store=undefined;
  await baselineStore.setPostgresWriteGate(migrationOptions,{enabled:false});
  const before={history:(await inspection.query(historySql)).rows,owner:(await inspection.query('SELECT to_jsonb(t) AS row FROM iam.human_accounts t WHERE id=$1',[ownerId])).rows[0]!.row,credential:(await inspection.query('SELECT * FROM iam.credentials WHERE id=$1',[parsed.id])).rows,instance:(await inspection.query('SELECT * FROM platform.instance_state')).rows,publicId:(await inspection.query(publicIdentitySql,[ownerId])).rows};
  assert.equal(before.history.length,62);assert.equal(before.publicId.length,1);

  await migratePostgres(migrationOptions);
  const after=(await inspection.query(historySql)).rows;
  assert.equal(after.length,63);
  assert.deepEqual(after.filter(row=>!(row.module_id==='iam'&&row.migration_version===8)),before.history);
  const added=after.find(row=>row.module_id==='iam'&&row.migration_version===8)!;
  assert.equal(added.name,OWNER_UI_PREFERENCES_MIGRATION.name);assert.equal(added.checksum,sha(OWNER_UI_PREFERENCES_MIGRATION.sql));assert.deepEqual(added.dependencies,OWNER_UI_PREFERENCES_MIGRATION.dependencies);
  assert.deepEqual((await inspection.query(ownerWithoutNewColumns,[ownerId])).rows[0]!.row,before.owner);
  assert.deepEqual((await inspection.query('SELECT ui_locale,ui_preferences_version,ui_preferences_updated_at FROM iam.human_accounts WHERE id=$1',[ownerId])).rows[0],{ui_locale:null,ui_preferences_version:null,ui_preferences_updated_at:null});
  assert.deepEqual((await inspection.query('SELECT * FROM platform.instance_state')).rows,before.instance);
  assert.deepEqual((await inspection.query('SELECT * FROM iam.credentials WHERE id=$1',[parsed.id])).rows,before.credential);
  assert.deepEqual((await inspection.query(publicIdentitySql,[ownerId])).rows,before.publicId);

  // No new grant after ALTER: prove the old application's table grant covers
  // the new columns and the current production store/codec can use them.
  store=await openPostgresStore(appOptions);
  assert.deepEqual(await store.read(tx=>tx.get('owners',ownerId)),oldOwner);
  let service=createM1Service(store,{now:()=>now});
  assert.deepEqual(await service.invoke('readUiPreferences',{},token),{ownerId,uiLocale:null,version:1,updatedAt:null,asOf:now});
  await setPostgresWriteGate(migrationOptions,{enabled:true});
  const input={operationId:randomUUID(),expectedVersion:1,uiLocale:'zh-CN'},saved=await service.invoke('saveUiPreferences',input,token);
  assert.equal(saved.uiLocale,'zh-CN');assert.equal(saved.version,2);assert.equal(saved.updatedAt,now);assert.equal(saved.outcome,'committed');
  const expectedOwner:StoredRow={...oldOwner,version:8,data:{...oldOwner.data,uiLocale:'zh-CN',uiPreferencesVersion:2,uiPreferencesUpdatedAt:now}};
  assert.deepEqual(await store.read(tx=>tx.get('owners',ownerId)),expectedOwner);
  await store.close();store=await openPostgresStore(appOptions);service=createM1Service(store,{now:()=>now+1});
  assert.deepEqual(await store.read(tx=>tx.get('owners',ownerId)),expectedOwner);
  assert.deepEqual(await service.invoke('readUiPreferences',{},token),{ownerId,uiLocale:'zh-CN',version:2,updatedAt:now,asOf:now+1});

  application=new Pool({connectionString,max:1});
  assert.equal((await application.query('SELECT current_user AS role')).rows[0]!.role,'connet_app');
  await assert.rejects(()=>application!.query("UPDATE iam.human_accounts SET ui_locale='fr' WHERE id=$1",[ownerId]),(error:unknown)=>typeof error==='object'&&error!==null&&'code' in error&&error.code==='23514');
  assert.deepEqual(await store.read(tx=>tx.get('owners',ownerId)),expectedOwner);
  assert.equal(expectedOwner.data.authVersion,oldOwner.data.authVersion);
  assert.deepEqual((await inspection.query('SELECT * FROM iam.credentials WHERE id=$1',[parsed.id])).rows,before.credential);
  assert.deepEqual((await inspection.query(publicIdentitySql,[ownerId])).rows,before.publicId);
  assert.deepEqual((await inspection.query('SELECT instance_id,recovery_epoch FROM platform.instance_state')).rows,[{instance_id:identity.instanceId,recovery_epoch:identity.recoveryEpoch}]);
  assert.deepEqual((await inspection.query(historySql)).rows,after);
 }finally{
  const errors:unknown[]=[];
  for(const close of [()=>store?.close(),()=>application?.end(),()=>inspection?.end()])try{await close();}catch(error){errors.push(error);}
  let dropped=!connections;
  if(connections)try{
    await dropIsolatedDatabase(runtime,connections);
    const absent=(await docker(['exec',`${runtime.project}-server`,'psql','-X','-U','postgres','-d','postgres','-Atqc',`SELECT count(*) FROM pg_database WHERE datname='${database}'`])).trim();
    assert.equal(absent,'0');dropped=true;t.diagnostic(JSON.stringify({creator:'a',database,oid:createdOid,phase:'dropped',absent:true}));
   }catch(error){errors.push(error);}
  // Retain the private ownership manifest if cleanup needs operator attention.
  if(dropped)try{await rm(directory,{recursive:true,force:true});}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'Isolated Owner preference fixture cleanup failed');
 }
});
