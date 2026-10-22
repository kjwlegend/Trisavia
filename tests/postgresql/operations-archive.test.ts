import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { copyWalArchive, inspectWalArchiveFile, listWalArchives, verifyBackupWal, walSegmentBytes } from '../../scripts/postgresql/wal-archive.ts';

const command=resolve('ops/postgresql/archive/command.sh'),restore=resolve('ops/postgresql/archive/restore.sh'),name='000000010000000100000001';
const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
async function run(script:string,args:string[],env=process.env):Promise<{code:number|null;error:string}>{
  return new Promise((done,reject)=>{const child=spawn('sh',[script,...args],{env,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',chunk=>{error+=String(chunk);});child.once('error',reject);child.once('close',code=>done({code,error}));});
}
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'connet-archive-synthetic-')),archive=join(directory,'archive'),destination=join(directory,'restore');await mkdir(archive,{mode:0o700});await mkdir(destination,{mode:0o700});const source=join(directory,name),bytes=Buffer.alloc(walSegmentBytes);bytes.write('Synthetic archive test material only');await writeFile(source,bytes,{mode:0o600});return {directory,archive,destination,source,bytes,dispose:()=>rm(directory,{recursive:true,force:true})};}

test('atomic gzip archive is compact, deterministic, idempotent and compatible with retained raw files',async t=>{
  const f=await fixture();t.after(f.dispose);
  assert.equal((await run(command,[f.source,name,f.archive])).code,0);
  const compressed=await readFile(join(f.archive,name+'.gz')),firstHash=digest(compressed);
  assert(compressed.length<f.bytes.length/100,'zero padding in synthetic low-traffic segments is compressed');
  assert.equal((await stat(join(f.archive,name+'.gz'))).mode&0o777,0o600);
  assert.equal((await run(command,[f.source,name,f.archive])).code,0);
  assert.equal(digest(await readFile(join(f.archive,name+'.gz'))),firstHash);
  await writeFile(join(f.archive,name),f.bytes,{mode:0o600});
  assert.equal((await run(command,[f.source,name,f.archive])).code,0);
  const target=join(f.destination,'RECOVERYXLOG');assert.equal((await run(restore,[name,target,f.archive])).code,0);assert((await readFile(target)).equals(f.bytes));
  assert.equal((await listWalArchives(f.archive)).length,2);
  assert.equal((await readdir(f.archive)).some(value=>value.startsWith('.')),false);
  console.info(JSON.stringify({syntheticSegmentBytes:f.bytes.length,gzipBytes:compressed.length,existingSameContentAccepted:true}));
});

test('existing truncated/different archives and failed restores never overwrite retained data',async t=>{
  const f=await fixture();t.after(f.dispose);const truncated=f.bytes.subarray(0,9170944);
  await writeFile(join(f.archive,name),truncated,{mode:0o600});
  const failure=await run(command,[f.source,name,f.archive]);assert.equal(failure.code,1);assert.match(failure.error,/existing_raw_content/);
  assert((await readFile(join(f.archive,name))).equals(truncated));assert.equal((await readdir(f.archive)).includes(name+'.gz'),false);
  const old=await run('-c',['test ! -f "$2" && cp "$1" "$2"','archive-old-retry',f.source,join(f.archive,name)]);
  assert.equal(old.code,1);console.info(JSON.stringify({oldCpPatternExistingTargetExit:old.code,truncatedTargetBytes:truncated.length,sourceUnchanged:digest(await readFile(f.source))===digest(f.bytes)}));
  const target=join(f.destination,'RECOVERYXLOG'),previous=Buffer.from('previous restore destination');await writeFile(target,previous);
  assert.equal((await run(restore,[name,target,f.archive])).code,1);assert((await readFile(target)).equals(previous));
  await rm(join(f.archive,name));await writeFile(join(f.archive,name+'.gz'),gzipSync(Buffer.alloc(walSegmentBytes,1)));
  assert.match((await run(command,[f.source,name,f.archive])).error,/existing_gzip_content/);
  await writeFile(join(f.archive,name+'.gz'),Buffer.from('partial gzip'));
  assert.match((await run(command,[f.source,name,f.archive])).error,/existing_gzip_integrity/);
  assert.equal((await run(restore,[name,target,f.archive])).code,1);assert((await readFile(target)).equals(previous));
});

test('compression/fsync failure leaves no final partial archive and concurrent same-content publication is safe',async t=>{
  const f=await fixture();t.after(f.dispose);const tools=join(f.directory,'tools');await mkdir(tools);
  await writeFile(join(tools,'gzip'),'#!/bin/sh\nprintf partial\nexit 1\n',{mode:0o700});
  let result=await run(command,[f.source,name,f.archive],{...process.env,PATH:tools+':'+process.env.PATH});
  assert.equal(result.code,1);assert.match(result.error,/compression/);assert.deepEqual(await readdir(f.archive),[]);
  await rm(join(tools,'gzip'));await writeFile(join(tools,'sync'),'#!/bin/sh\nexit 1\n',{mode:0o700});
  result=await run(command,[f.source,name,f.archive],{...process.env,PATH:tools+':'+process.env.PATH});
  assert.equal(result.code,1);assert.match(result.error,/temporary_sync/);assert.deepEqual(await readdir(f.archive),[]);
  await rm(join(tools,'sync'));await writeFile(join(tools,'ln'),'#!/bin/sh\nmkdir "$2"\nexec /bin/ln "$1" "$2"\n',{mode:0o700});
  result=await run(command,[f.source,name,f.archive],{...process.env,PATH:tools+':'+process.env.PATH});
  assert.equal(result.code,1);assert.match(result.error,/existing_gzip_type/);assert.equal((await stat(join(f.archive,name+'.gz'))).isDirectory(),true);
  await rm(join(tools,'ln'));await rm(join(f.archive,name+'.gz'),{recursive:true});
  const concurrent=await Promise.all([run(command,[f.source,name,f.archive]),run(command,[f.source,name,f.archive])]);assert.deepEqual(concurrent.map(value=>value.code),[0,0],JSON.stringify(concurrent));
  assert.equal((await inspectWalArchiveFile(join(f.archive,name+'.gz'))).uncompressedSha256,digest(f.bytes));
  assert.deepEqual(await readdir(f.archive),[name+'.gz']);assert((await readFile(f.source)).equals(f.bytes));
});

test('raw/gzip history and backup metadata restore; dual-representation conflicts, missing and traversal fail safely',async t=>{
  const f=await fixture();t.after(f.dispose);
  for(const entry of ['00000002.history',name+'.00000028.backup']){
    const metadata=Buffer.from('Synthetic backup/timeline metadata only\n'),source=join(f.directory,entry),target=join(f.destination,entry);await writeFile(source,metadata);
    await writeFile(join(f.archive,entry),metadata);assert.equal((await run(command,[source,entry,f.archive])).code,0);assert.equal((await run(restore,[entry,target,f.archive])).code,0);assert((await readFile(target)).equals(metadata));
    await rm(join(f.archive,entry));assert.equal((await run(command,[source,entry,f.archive])).code,0);assert.equal((await run(restore,[entry,target,f.archive])).code,0);assert((await readFile(target)).equals(metadata));
  }
  await writeFile(join(f.archive,name),f.bytes);await writeFile(join(f.archive,name+'.gz'),gzipSync(Buffer.alloc(walSegmentBytes,2)));
  assert.match((await run(command,[f.source,name,f.archive])).error,/existing_gzip_content/);
  assert.match((await run(restore,[name,join(f.destination,'target'),f.archive])).error,/representation_conflict/);
  assert.equal((await run(command,[f.source,'../escape',f.archive])).code,1);assert.equal((await run(restore,['00000003.history',join(f.destination,'missing'),f.archive])).code,1);
});

test('backup transfers validate full content, preserve legacy manifests and ignore only private in-flight archive names',async t=>{
  const f=await fixture();t.after(f.dispose);await writeFile(join(f.archive,name),f.bytes);
  assert.equal((await run(command,[f.source,name,f.archive])).code,0); // Existing raw is retained without converting it.
  const next='000000010000000100000002';assert.equal((await run(command,[f.source,next,f.archive])).code,0);
  await writeFile(join(f.archive,'.'+next+'.tmp.Ab12Cd34'),'incomplete unpublished data');
  const files=await listWalArchives(f.archive);assert.equal(files.length,2);assert.deepEqual(files.map(item=>item.format),['raw','gzip']);
  for(const file of files)await copyWalArchive(join(f.archive,file.archiveFile),join(f.destination,file.archiveFile),file);
  await verifyBackupWal(f.destination,files);await verifyBackupWal(f.destination,[{name,sha256:files[0]!.sha256}]);
  await copyWalArchive(join(f.archive,name),join(f.destination,name),files[0]!);
  await writeFile(join(f.destination,name),Buffer.alloc(walSegmentBytes,3));
  await assert.rejects(copyWalArchive(join(f.archive,name),join(f.destination,name),files[0]!),/changed content/);
  await assert.rejects(verifyBackupWal(f.destination,files),/missing or changed/);
  await writeFile(join(f.archive,'unexpected'),'unknown');await assert.rejects(listWalArchives(f.archive),/Unexpected archive entry/);
});
