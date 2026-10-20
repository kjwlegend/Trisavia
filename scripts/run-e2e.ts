import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const root=fileURLToPath(new URL('../',import.meta.url));
const cli=fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url));
interface Spec { id:string; tests:Array<{projectName:string}>; }
interface Suite { specs?:Spec[]; suites?:Suite[]; }
interface Report { suites:Suite[]; errors:unknown[]; }
const args=['test','--fully-parallel','--workers=1','--retries=0'];
async function isolatedPort():Promise<string>{
 const probe=createServer();await new Promise<void>((done,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',done);});
 const address=probe.address();if(!address||typeof address==='string')throw new Error('Could not allocate an isolated browser port');
 await new Promise<void>((done,reject)=>probe.close(error=>error?reject(error):done()));return String(address.port);
}
const collectionEnv={...process.env,M1_E2E_PORT:await isolatedPort()};

function collect(extra:string[]=[]):string[]{
 const result=spawnSync(process.execPath,[cli,...args,...extra,'--list','--reporter=json'],{
  cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,env:collectionEnv,
 });
 if(result.error||result.status!==0)throw new Error('Could not enumerate the complete browser suite');
 const report=JSON.parse(result.stdout) as Report;
 if(report.errors.length)throw new Error('Browser test collection failed');
 const entries:string[]=[];
 const visit=(suite:Suite)=>{
  for(const spec of suite.specs??[])for(const test of spec.tests)entries.push(`${test.projectName}:${spec.id}`);
  for(const child of suite.suites??[])visit(child);
 };
 for(const suite of report.suites)visit(suite);
 return entries;
}

// Every Playwright process gets e2e-server's fresh disposable PostgreSQL database. Keeping
// four cases per process avoids synthetic aggregate traffic consuming the real
// 240/minute client quota; production limits and individual cases stay intact.
// Fully-parallel enables individual-test sharding; workers=1 still runs serially.
const all=collect();
if(!all.length||new Set(all).size!==all.length)throw new Error('Expected a non-empty unique browser suite');
const count=Math.ceil(all.length/4),planned=new Set<string>();
const shards=Array.from({length:count},(_,index)=>`${index+1}/${count}`);
for(const shard of shards){
 const selected=collect(['--shard',shard]);
 if(!selected.length||selected.length>4)throw new Error('Browser shard exceeds the isolated test batch size');
 for(const id of selected){
  if(!all.includes(id)||planned.has(id))throw new Error('Browser shard coverage is incomplete or duplicated');
  planned.add(id);
 }
}
if(planned.size!==all.length)throw new Error('Browser shard coverage is incomplete');
console.log(`Running all ${all.length} browser cases in ${count} isolated service processes.`);
for(const shard of shards){
 console.log(`Browser batch ${shard}`);
 const result=spawnSync(process.execPath,[cli,...args,'--shard',shard],{cwd:root,stdio:'inherit',env:{...process.env,M1_E2E_PORT:await isolatedPort()}});
 if(result.error)throw new Error('Browser test process could not start');
 if(result.status!==0)process.exit(result.status??1);
}
