import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assessArchiveCapacity, parseArchiveCapacity, type ArchiveCapacityInput } from '../../scripts/postgresql/archive-capacity.ts';
const GiB=1024**3;
const healthy:ArchiveCapacityInput={totalBytes:80*GiB,availableBytes:40*GiB,archiveBytes:27*GiB,pgWalBytes:350*1024**2,filesInspected:1684,rawSegments:1679,gzipSegments:0,metadataFiles:5,incompleteRawSegments:0,temporaryFiles:0,unrecognizedEntries:0,truncated:false};
test('capacity reserves give non-destructive bounded warning/critical signals without promising retention or archiver health',()=>{
  assert.equal(assessArchiveCapacity(healthy).status,'ok');
  assert.equal(assessArchiveCapacity({...healthy,availableBytes:8*GiB}).status,'warning');
  assert.equal(assessArchiveCapacity({...healthy,availableBytes:4*GiB}).status,'critical');
  assert.equal(assessArchiveCapacity({...healthy,incompleteRawSegments:1}).status,'critical');
  assert.equal(assessArchiveCapacity({...healthy,truncated:true}).status,'warning');
  assert.equal(assessArchiveCapacity(healthy).automatedDeletion,false);assert.equal(assessArchiveCapacity(healthy).archiverHealth,'not_checked');
  assert.throws(()=>assessArchiveCapacity({...healthy,availableBytes:NaN}));assert.throws(()=>assessArchiveCapacity({...healthy,availableBytes:81*GiB}));
});
test('metadata-only parser counts raw/gzip/metadata/partial files, bounds scans and rejects malformed observations',()=>{
  const disk='Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda 83886080 41943040 41943040 50% /var/lib/postgresql\n',wal='358400\t/var/lib/postgresql/18/docker/pg_wal\n';
  const listing=['000000010000000100000001 16777216 f','000000010000000100000002.gz 17000 f','00000002.history 341 f','.000000010000000100000003.tmp.Ab12Cd34 21 f','000000010000000100000004 9170944 f'].join('\n');
  const report=parseArchiveCapacity(disk,wal,listing);assert.equal(report.totalBytes,80*GiB);assert.equal(report.availableBytes,40*GiB);assert.equal(report.rawSegments,2);assert.equal(report.gzipSegments,1);assert.equal(report.metadataFiles,1);assert.equal(report.temporaryFiles,1);assert.equal(report.incompleteRawSegments,1);assert.equal(report.truncated,false);
  const bounded=parseArchiveCapacity(disk,wal,listing,2);assert.equal(bounded.filesInspected,2);assert.equal(bounded.truncated,true);
  assert.throws(()=>parseArchiveCapacity('unavailable',wal,listing));assert.throws(()=>parseArchiveCapacity(disk,wal,'unparseable file metadata'));assert.throws(()=>parseArchiveCapacity(disk,wal,listing,100001));
});
test('explicit capacity CLI emits only aggregate pressure and returns a nonzero warning without a scheduler or cleanup',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'connet-capacity-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));const tools=join(directory,'tools');await mkdir(tools);
  const runtime=join(directory,'runtime.json');await writeFile(runtime,JSON.stringify({format:'connet-postgresql-local-v1',context:'colima-agents-era-pg',project:'agents-era-pg-capacity-synthetic',host:'127.0.0.1',port:15439,privateDir:directory,image:'postgres:18.6-trixie@sha256:'+'0'.repeat(64),privateMarker:'must-not-be-emitted'}),{mode:0o600});
  await writeFile(join(tools,'docker'),`#!/bin/sh
case "$*" in
  *" df "*) printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/test 83886080 79691776 4194304 95%% /var/lib/postgresql\\n';;
  *" du "*) printf '358400 /var/lib/postgresql/18/docker/pg_wal\\n';;
  *"find "*) printf '000000010000000100000001.gz 17000 f\\n';;
  *) exit 1;;
esac
`,{mode:0o700});
  const observed=await new Promise<{code:number|null;text:string}>((done,reject)=>{const child=spawn(process.execPath,[resolve('scripts/postgresql/archive-capacity.ts'),runtime],{env:{...process.env,PATH:tools+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',chunk=>{text+=String(chunk);});child.stderr.resume();child.once('error',reject);child.once('close',code=>done({code,text}));});
  assert.equal(observed.code,2);const report=JSON.parse(observed.text);assert.equal(report.status,'critical');assert.equal(report.gzipSegments,1);assert.equal(report.automatedDeletion,false);assert.equal(observed.text.includes('must-not-be-emitted'),false);
});
