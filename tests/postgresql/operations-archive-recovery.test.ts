import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { archiveWal, backupRuntime, restoreDrill, stopRestoreDrill, type RestoreDrill } from '../../scripts/postgresql/backup.ts';
import { archiveCapacity } from '../../scripts/postgresql/archive-capacity.ts';
import { docker, initializeRuntime, privateFile, readRuntime, requirePrivateFile } from '../../scripts/postgresql/runtime.ts';

test('isolated PG18 raw then gzip archives continuously restore post-basebackup commits without mounting the active cluster', {timeout:180000},async()=>{
  const originalFile=process.env.PG_ARCHIVE_TEST_RUNTIME;if(!originalFile)throw new Error('Explicit private runtime supplies only the existing pinned image/context, never its database');
  const existing=await readRuntime(originalFile),project='agents-era-pg-archive-b-c5e821a4',container=project+'-server',volume=project+'-data',id=randomUUID();
  const root=resolve('outputs/postgresql/archive-capacity'),directory=join(root,'private-c5e821a4',id);await mkdir(directory,{recursive:true,mode:0o700});
  const names=(await docker(['ps','-a','--format','{{.Names}}'])).trim().split('\n'),volumes=(await docker(['volume','ls','--format','{{.Name}}'])).trim().split('\n');
  if(names.includes(container)||volumes.includes(volume))throw new Error('Registered disposable resource name is already in use');
  const config=await readRuntime(await initializeRuntime(join(directory,'runtime'),project,15439,existing.image));
  const sourceConfiguration=join(config.privateDir,'source-postgresql.conf');
  await privateFile(sourceConfiguration,(await readFile(resolve('ops/postgresql/postgresql.conf'),'utf8')).replace(/^archive_command = .*$/m,"archive_command = 'test ! -f /var/lib/postgresql/wal-archive/%f && cp %p /var/lib/postgresql/wal-archive/%f'"));
  const labels=['--label',`io.connet.project=${project}`,'--label','io.connet.purpose=archive-capacity-test','--label',`io.connet.archive-run=${id}`];
  const resourceFile=join(directory,'resources.private.json');await privateFile(resourceFile,JSON.stringify({project,container,volume,id,network:'none',hostPorts:[],sourceVolumeMounted:false,restorePrefix:project+'-restore-'})+'\n');
  let createdVolume=false,createdContainer=false,drill:RestoreDrill|undefined,completed=false;
  const sql=async(statement:string)=>(await docker(['exec',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','connet','-Atqc',statement])).trim();
  try{
    await docker(['volume','create',...labels,volume]);createdVolume=true;
    const mounts=['--mount',`type=volume,source=${volume},target=/var/lib/postgresql`,
      '--mount',`type=bind,source=${sourceConfiguration},target=/etc/postgresql/connet.conf,readonly`,
      '--mount',`type=bind,source=${resolve('ops/postgresql/archive')},target=/etc/postgresql/archive,readonly`,
      '--mount',`type=bind,source=${resolve('ops/postgresql/init/10-roles.sh')},target=/docker-entrypoint-initdb.d/10-roles.sh,readonly`];
    for(const kind of ['admin','migration','application','backup'])mounts.push('--mount',`type=bind,source=${join(config.privateDir,kind+'-password')},target=/run/secrets/${kind}-password,readonly`);
    await docker(['run','-d','--name',container,...labels,'--network','none',...mounts,'-e','POSTGRES_USER=postgres','-e','POSTGRES_DB=postgres','-e','POSTGRES_PASSWORD_FILE=/run/secrets/admin-password','-e','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --data-checksums',config.image,'postgres','-c','config_file=/etc/postgresql/connet.conf']);createdContainer=true;
    const ready=Date.now()+60000;let started=false;
    while(Date.now()<ready){try{await sql('SELECT 1');started=true;break;}catch{await delay(250);}}
    if(!started)throw new Error('Disposable source did not become ready');
    const identity={version:1,instanceId:'synthetic-archive-'+id,recoveryEpoch:'synthetic-epoch-'+id},identityFile=join(directory,'identity.json'),appFile=join(directory,'application.env');
    await privateFile(identityFile,JSON.stringify(identity)+'\n');await privateFile(appFile,'M1_EMAIL_MODE=experience\n');
    await sql(`CREATE SCHEMA platform; CREATE TABLE platform.instance_state(singleton integer PRIMARY KEY,instance_id text,recovery_epoch text); INSERT INTO platform.instance_state VALUES(1,'${identity.instanceId}','${identity.recoveryEpoch}'); CREATE TABLE public.archive_probe(id integer PRIMARY KEY); INSERT INTO public.archive_probe VALUES(1)`);
    const backup=await backupRuntime(config,join(directory,'backup'),{database:'connet',identityFile,applicationConfigFile:appFile});
    // Exercise a historical raw-only v1 manifest before appending new gzip WAL.
    const legacyManifest=JSON.parse(await requirePrivateFile(backup.manifest));assert.equal(legacyManifest.format,'connet-pg-physical-backup-v2');
    await writeFile(backup.manifest,JSON.stringify({...legacyManifest,format:'connet-pg-physical-backup-v1'})+'\n',{mode:0o600});
    await sql('INSERT INTO public.archive_probe VALUES(2)');const raw=await archiveWal(config,backup.directory);
    assert(raw.files.some(file=>file.name===raw.throughFile&&file.format==='raw'));
    assert.equal(JSON.parse(await requirePrivateFile(backup.manifest)).format,'connet-pg-physical-backup-v1');
    await sql(`ALTER SYSTEM SET archive_command = 'sh /etc/postgresql/archive/command.sh "%p" "%f" /var/lib/postgresql/wal-archive'`);await sql('SELECT pg_reload_conf()');
    let switched=false;for(let attempt=0;attempt<20;attempt++){if((await sql('SHOW archive_command')).includes('/archive/command.sh')){switched=true;break;}await delay(50);}assert(switched);
    await sql('INSERT INTO public.archive_probe VALUES(3)');const mixed=await archiveWal(config,backup.directory);
    assert(mixed.files.some(file=>file.name===mixed.throughFile&&file.format==='gzip'));assert(mixed.files.some(file=>file.name===raw.throughFile&&file.format==='raw'));
    // Re-archiving an already durable gzip from the same synthetic source is successful.
    await docker(['exec','-u','postgres',container,'sh','/etc/postgresql/archive/command.sh','/var/lib/postgresql/18/docker/pg_wal/'+mixed.throughFile,mixed.throughFile,'/var/lib/postgresql/wal-archive']);
    const capacity=await archiveCapacity(config);assert(capacity.rawSegments>0);assert(capacity.gzipSegments>0);
    // restoreDrill persists its exact UUID/container/volume manifest before creating them.
    drill=await restoreDrill(config,backup.directory);
    const recovered=await docker(['exec',drill.container,'psql','-X','-U','postgres','-d','connet','-Atqc','SELECT json_agg(id ORDER BY id) FROM public.archive_probe']);assert.deepEqual(JSON.parse(recovered),[1,2,3]);
    const host=JSON.parse(await docker(['inspect',drill.container,'--format','{{json .HostConfig}}']));assert.equal(host.NetworkMode,'none');assert.deepEqual(host.PortBindings??{},{});
    const manifest=JSON.parse(await requirePrivateFile(backup.manifest));assert.equal(manifest.format,'connet-pg-physical-backup-v2');assert.equal(manifest.pairedIdentityIncluded,true);assert.equal(manifest.applicationConfigurationIncluded,true);assert(manifest.wal.files.some((file:{format?:string})=>file.format==='raw'));assert(manifest.wal.files.some((file:{format?:string})=>file.format==='gzip'));
    const retained=await readdir(join(backup.directory,'private-config'));assert(retained.includes('archive-command.sh'));assert(retained.includes('archive-restore.sh'));
    await privateFile(join(directory,'verification.private.json'),JSON.stringify({format:'archive-capacity-recovery-evidence-v1',project,source:container,sourceVolume:volume,restore:drill,rawThenGzipRecovered:true,probeIds:[1,2,3],capacity,sourceVolumeMountedByRestore:false,network:'none',hostPorts:[],pairedIdentityIncluded:true})+'\n');
    completed=true;console.info(JSON.stringify({project,source:container,sourceVolume:volume,restore:drill.container,restoredSyntheticCommits:3,rawAndGzip:true,network:'none',hostPorts:[],evidence:join(directory,'verification.private.json')}));
  }finally{
    if(!drill){
      // A failed restore may already have recorded/created its disposable pair.
      // Resolve only this run's exact pre-creation manifests, never a name prefix alone.
      const backup=join(directory,'backup');let files:string[]=[];try{files=await readdir(backup);}catch{}
      for(const file of files.filter(value=>/^restore-drill-[a-f0-9-]+\.private\.json$/.test(value))){
        const recorded=JSON.parse(await requirePrivateFile(join(backup,file))) as RestoreDrill;
        if(recorded.project!==project||recorded.container!==project+'-restore-'+recorded.id||recorded.volume!==recorded.container+'-data')throw new Error('Disposable restore record mismatch');
        const containers=(await docker(['ps','-a','--format','{{.Names}}'])).trim().split('\n');
        if(containers.includes(recorded.container)){await stopRestoreDrill(config,recorded,true);drill=recorded;}
        else{const remaining=(await docker(['volume','ls','--format','{{.Name}}'])).trim().split('\n');if(remaining.includes(recorded.volume)){const observed=JSON.parse(await docker(['volume','inspect',recorded.volume,'--format','{{json .Labels}}']));if(observed['io.connet.project']!==project||observed['io.connet.drill']!==recorded.id)throw new Error('Disposable restore volume ownership changed');await docker(['volume','rm',recorded.volume]);}}
      }
    }else await stopRestoreDrill(config,drill,true);
    if(createdContainer){const observed=JSON.parse(await docker(['inspect',container,'--format','{{json .Config.Labels}}']));if(observed['io.connet.project']!==project||observed['io.connet.archive-run']!==id)throw new Error('Disposable container ownership changed');await docker(['stop','--time','60',container]);await docker(['rm',container]);}
    if(createdVolume){const observed=JSON.parse(await docker(['volume','inspect',volume,'--format','{{json .Labels}}']));if(observed['io.connet.project']!==project||observed['io.connet.archive-run']!==id)throw new Error('Disposable volume ownership changed');await docker(['volume','rm',volume]);}
    await writeFile(join(directory,'lifecycle.private.json'),JSON.stringify({project,completed,sourceClosed:true,sourceVolumeRemoved:true,restoreClosed:Boolean(drill),sourceVolumeMountedByRestore:false})+'\n',{mode:0o600});
  }
});
