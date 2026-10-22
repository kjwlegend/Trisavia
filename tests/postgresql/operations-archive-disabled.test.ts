import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const backupFile=resolve('scripts/postgresql/backup.ts');
async function fixture(t:{after:(work:()=>Promise<unknown>)=>void},mode='off'){
  const directory=await mkdtemp(join(tmpdir(),'connet-archive-disabled-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const tools=join(directory,'tools'),calls=join(directory,'docker-calls');await mkdir(tools);await writeFile(calls,'',{mode:0o600});
  await writeFile(join(tools,'docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$ARCHIVE_TEST_CALLS"
case "$*" in
  *"SHOW archive_mode"*) printf '%s\\n' "$ARCHIVE_TEST_MODE";;
  *) exit 7;;
esac
`,{mode:0o700});
  const config={format:'connet-postgresql-local-v1',context:'colima-agents-era-pg',project:'agents-era-pg-disabled-synthetic',host:'127.0.0.1',port:15439,privateDir:directory,image:'postgres:18.6-trixie@sha256:'+'0'.repeat(64)};
  const runtime=join(directory,'runtime.json');await writeFile(runtime,JSON.stringify(config),{mode:0o600});
  const env={...process.env,PATH:tools+':'+process.env.PATH,ARCHIVE_TEST_CALLS:calls,ARCHIVE_TEST_MODE:mode,ARCHIVE_TEST_CONFIG:JSON.stringify(config),ARCHIVE_TEST_DIRECTORY:directory};
  async function run(args:string[]):Promise<{code:number|null;stdout:string;stderr:string}>{
    return new Promise((done,reject)=>{const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});child.once('error',reject);child.once('close',code=>done({code,stdout,stderr}));});
  }
  return {directory,runtime,calls,run};
}

test('local development profile defaults to no continuous archive while retaining explicit archive helpers',async()=>{
  const text=await readFile('ops/postgresql/postgresql.conf','utf8');
  const settings=new Map(text.split('\n').map(line=>/^([a-z_]+)\s*=\s*(.+)$/.exec(line.trim())).filter(match=>match!==null).map(match=>[match[1],match[2]]));
  assert.equal(settings.get('archive_mode'),'off');assert.equal(settings.get('archive_timeout'),'0');assert.match(settings.get('archive_command')!,/\/archive\/command\.sh/);
});

test('archive and archive-backed backup fail before output/config copies, WAL switching or archive waits when effective mode is off',async t=>{
  const f=await fixture(t),result=await f.run(['--input-type=module','-e',`
import {archiveWal,backupRuntime} from ${JSON.stringify(pathToFileURL(backupFile).href)};
const config=Object.freeze(JSON.parse(process.env.ARCHIVE_TEST_CONFIG)),before=JSON.stringify(config),results=[];
for(const [name,action]of [['archive',()=>archiveWal(config,process.env.ARCHIVE_TEST_DIRECTORY+'/archive-output')],['backup',()=>backupRuntime(config,process.env.ARCHIVE_TEST_DIRECTORY+'/backup-output',{database:'connet',identityFile:'/must-not-read/identity',applicationConfigFile:'/must-not-read/application'})]]){
  try{await action();results.push({name,unexpectedSuccess:true});}catch(error){results.push({name,code:error.code});}
}
console.log(JSON.stringify({results,configurationUnchanged:JSON.stringify(config)===before}));
`]);
  assert.equal(result.code,0);assert.deepEqual(JSON.parse(result.stdout),{results:[{name:'archive',code:'archive_disabled'},{name:'backup',code:'archive_disabled'}],configurationUnchanged:true});
  const calls=(await readFile(f.calls,'utf8')).trim().split('\n');assert.equal(calls.length,2);assert(calls.every(line=>line.endsWith('SHOW archive_mode')));
  for(const name of ['archive-output','backup-output'])await assert.rejects(stat(join(f.directory,name)),{code:'ENOENT'});
});

test('explicit on/always modes pass the preflight and preserve the normal database failure instead of mislabeling it disabled',async t=>{
  for(const mode of ['on','always']){
    const f=await fixture(t,mode),result=await f.run(['--input-type=module','-e',`
import {archiveWal} from ${JSON.stringify(pathToFileURL(backupFile).href)};
try{await archiveWal(JSON.parse(process.env.ARCHIVE_TEST_CONFIG),process.env.ARCHIVE_TEST_DIRECTORY+'/output');process.exitCode=2;}
catch(error){console.log(JSON.stringify({disabled:error.code==='archive_disabled',databaseFailure:error.message.includes('docker failed')}));}
`]);
    assert.equal(result.code,0);assert.deepEqual(JSON.parse(result.stdout),{disabled:false,databaseFailure:true});
    const calls=(await readFile(f.calls,'utf8')).trim().split('\n');assert.equal(calls.length,2);assert(calls[0]!.endsWith('SHOW archive_mode'));assert.match(calls[1]!,/pg_current_wal_insert_lsn/);assert(!calls.some(line=>line.includes('pg_switch_wal')));
  }
});

test('operator CLI returns a safe explicit disabled error without creating a partial backup or accessing paired files',async t=>{
  const f=await fixture(t);
  for(const action of ['archive','backup']){
    const output=join(f.directory,action+'-cli'),args=[backupFile,action,f.runtime,output];if(action==='backup')args.push('/must-not-read/identity','/must-not-read/application');
    const result=await f.run(args);assert.equal(result.code,1);assert.equal(result.stdout,'');assert.match(result.stderr,/^postgresql_archive_disabled:/);assert(!result.stderr.includes('/must-not-read'));
    await assert.rejects(stat(output),{code:'ENOENT'});
  }
  const calls=(await readFile(f.calls,'utf8')).trim().split('\n');assert.equal(calls.length,2);assert(calls.every(line=>line.endsWith('SHOW archive_mode')));
});
