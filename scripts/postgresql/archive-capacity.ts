import { pathToFileURL } from 'node:url';
import { archiveName, archiveTemporaryName, walSegmentBytes } from './wal-archive.ts';
import { docker, readRuntime, type RuntimeConfig } from './runtime.ts';

export interface ArchiveCapacityInput {
  totalBytes:number;availableBytes:number;archiveBytes:number;pgWalBytes:number;filesInspected:number;
  rawSegments:number;gzipSegments:number;metadataFiles:number;incompleteRawSegments:number;temporaryFiles:number;unrecognizedEntries:number;truncated:boolean;
}
const GiB=1024**3;
/** This is a pressure signal, never a retention/recyclability decision. */
export function assessArchiveCapacity(input:ArchiveCapacityInput){
  for(const [key,value]of Object.entries(input))if(key!=='truncated'&&(!Number.isSafeInteger(value)||(value as number)<0))throw new Error('Invalid capacity observation');
  if(input.totalBytes<=0||input.availableBytes>input.totalBytes||typeof input.truncated!=='boolean')throw new Error('Invalid filesystem capacity');
  const warningFreeBytes=Math.max(2*GiB,Math.ceil(input.totalBytes*0.10)),criticalFreeBytes=Math.max(512*1024**2,Math.ceil(input.totalBytes*0.05));
  const reasons:string[]=[];
  if(input.availableBytes<=warningFreeBytes)reasons.push('filesystem_free_below_warning_reserve');
  if(input.incompleteRawSegments)reasons.push('incomplete_raw_archive');
  if(input.unrecognizedEntries)reasons.push('unrecognized_archive_entries');
  if(input.truncated)reasons.push('archive_scan_limit_reached');
  const status=input.availableBytes<=criticalFreeBytes||input.incompleteRawSegments?'critical':reasons.length?'warning':'ok';
  return {...input,status,reasons,warningFreeBytes,criticalFreeBytes,automatedDeletion:false,archiverHealth:'not_checked',retentionStatus:'not_established'};
}
export function parseArchiveCapacity(disk:string,wal:string,listing:string,maxEntries=10000):ArchiveCapacityInput{
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>100000)throw new Error('Invalid capacity scan limit');
  const fields=disk.trim().split('\n').at(-1)!.trim().split(/\s+/),totalBytes=Number(fields.at(-5))*1024,availableBytes=Number(fields.at(-3))*1024;
  const pgWalBytes=Number(wal.trim().split(/\s+/)[0])*1024,lines=listing.trim()?listing.trimEnd().split('\n'):[];
  const observed:ArchiveCapacityInput={totalBytes,availableBytes,pgWalBytes,archiveBytes:0,filesInspected:0,rawSegments:0,gzipSegments:0,metadataFiles:0,incompleteRawSegments:0,temporaryFiles:0,unrecognizedEntries:0,truncated:lines.length>maxEntries};
  for(const line of lines.slice(0,maxEntries)){
    const match=/^(\S+) (\d+) ([fdl])$/.exec(line);if(!match)throw new Error('Invalid bounded archive metadata');
    const name=match[1]!,bytes=Number(match[2]);if(!Number.isSafeInteger(bytes))throw new Error('Invalid archive size');
    observed.filesInspected++;observed.archiveBytes+=bytes;
    if(match[3]!=='f'){observed.unrecognizedEntries++;continue;}
    if(archiveTemporaryName.test(name)){observed.temporaryFiles++;continue;}
    const gzip=name.endsWith('.gz'),logical=gzip?name.slice(0,-3):name;
    if(!archiveName.test(logical)){observed.unrecognizedEntries++;continue;}
    if(/^[0-9A-F]{24}$/.test(logical)){
      if(gzip)observed.gzipSegments++;else{observed.rawSegments++;if(bytes!==walSegmentBytes)observed.incompleteRawSegments++;}
    }else observed.metadataFiles++;
  }
  assessArchiveCapacity(observed);return observed;
}
/** Explicit read-only operator check. Reads names/sizes, never WAL contents. */
export async function archiveCapacity(config:RuntimeConfig){
  const [disk,wal,listing]=await Promise.all([
    docker(['exec',`${config.project}-server`,'df','-Pk','/var/lib/postgresql']),
    docker(['exec',`${config.project}-server`,'du','-sk','/var/lib/postgresql/18/docker/pg_wal']),
    // Preserve find errors; only the expected SIGPIPE from the bounded head is
    // acceptable. A missing/unreadable archive must not look like an empty one.
    docker(['exec',`${config.project}-server`,'bash','-c',"find /var/lib/postgresql/wal-archive -mindepth 1 -maxdepth 1 -printf '%f %s %y\\n' | head -n 10001; status=(\"${PIPESTATUS[@]}\"); (( status[1] == 0 && (status[0] == 0 || status[0] == 141) ))"]),
  ]);
  return {format:'connet-pg-archive-capacity-v1',at:Date.now(),project:config.project,context:config.context,...assessArchiveCapacity(parseArchiveCapacity(disk,wal,listing))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [file,...extra]=process.argv.slice(2);
  (async()=>{if(!file||extra.length)throw new Error('Usage: archive-capacity.ts RUNTIME_JSON');return archiveCapacity(await readRuntime(file));})()
    .then(result=>{process.stdout.write(JSON.stringify(result)+'\n');if(result.status!=='ok')process.exitCode=2;})
    .catch(()=>{process.stderr.write('postgresql_archive_capacity_failed: observation unavailable; no cleanup was attempted\n');process.exitCode=2;});
}
