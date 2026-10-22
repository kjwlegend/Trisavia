import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import { chmod, copyFile, link, lstat, open, readdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const walSegmentBytes=16*1024*1024;
export const archiveName=/^(?:[0-9A-F]{24}(?:\.[0-9A-F]{8}\.backup)?|[0-9A-F]{8}\.history)$/;
export const archiveTemporaryName=/^\.(?:[0-9A-F]{24}(?:\.[0-9A-F]{8}\.backup)?|[0-9A-F]{8}\.history)\.tmp\.[A-Za-z0-9]{8}$/;
export interface WalArchiveFile {
  /** PostgreSQL's original name, retained for existing backup callers. */
  name:string;sha256:string;archiveFile:string;format:'raw'|'gzip';uncompressedSha256:string;uncompressedBytes:number;
}
export async function inspectWalArchiveFile(file:string,storedName=basename(file)):Promise<WalArchiveFile>{
  const gzip=storedName.endsWith('.gz'),name=gzip?storedName.slice(0,-3):storedName;
  if(!archiveName.test(name))throw new Error('Unexpected archive entry');
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>2*walSegmentBytes)throw new Error('Archive entry must be a bounded regular file');
  const storedHash=createHash('sha256'),contentHash=createHash('sha256');let bytes=0;
  const stored=new Transform({transform(chunk:Buffer,_encoding,done){storedHash.update(chunk);done(null,chunk);}});
  const content=new Writable({write(chunk:Buffer,_encoding,done){bytes+=chunk.length;if(bytes>walSegmentBytes){done(new Error('Archive content exceeds the configured segment size'));return;}contentHash.update(chunk);done();}});
  if(gzip)await pipeline(createReadStream(file),stored,createGunzip(),content);else await pipeline(createReadStream(file),stored,content);
  if(/^[0-9A-F]{24}$/.test(name)&&bytes!==walSegmentBytes)throw new Error('Archived WAL segment has the wrong size');
  return {name,archiveFile:storedName,format:gzip?'gzip':'raw',sha256:storedHash.digest('hex'),uncompressedSha256:contentHash.digest('hex'),uncompressedBytes:bytes};
}
export async function listWalArchives(directory:string):Promise<WalArchiveFile[]>{
  const output:WalArchiveFile[]=[];
  for(const name of (await readdir(directory)).sort()){
    if(archiveTemporaryName.test(name))continue; // Never copy/publish an in-flight archive.
    output.push(await inspectWalArchiveFile(join(directory,name)));
  }
  // An archive with both representations must describe one unambiguous segment.
  const contents=new Map<string,string>();for(const item of output){const prior=contents.get(item.name);if(prior&&prior!==item.uncompressedSha256)throw new Error('Raw and compressed archives disagree');contents.set(item.name,item.uncompressedSha256);}
  return output;
}
export async function syncDirectory(directory:string):Promise<void>{const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
/** Publish only a fully checked local copy; an existing artifact is immutable. */
export async function copyWalArchive(source:string,destination:string,expected:WalArchiveFile):Promise<void>{
  async function identical():Promise<boolean>{
    try{const present=await inspectWalArchiveFile(destination);if(present.sha256!==expected.sha256)throw new Error('An archived WAL filename changed content');
      const handle=await open(destination,'r');try{await handle.sync();}finally{await handle.close();}await syncDirectory(dirname(destination));return true;}
    catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return false;throw error;}
  }
  if(await identical())return;
  const temporary=join(dirname(destination),'.wal-copy-'+randomUUID()+'.tmp');
  try{
    await copyFile(source,temporary,constants.COPYFILE_EXCL);await chmod(temporary,0o600);
    if((await inspectWalArchiveFile(temporary,expected.archiveFile)).sha256!==expected.sha256)throw new Error('Archive source changed during transfer');
    const handle=await open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
    try{await link(temporary,destination);}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'&&await identical()))throw error;}
    await syncDirectory(dirname(destination));
  }finally{await unlink(temporary).catch(error=>{if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;});}
}
export async function verifyBackupWal(directory:string,expected:{name:string;sha256:string;archiveFile?:string}[]):Promise<void>{
  const actual=await listWalArchives(directory);
  for(const item of expected){const name=item.archiveFile??item.name;if(!actual.some(file=>file.archiveFile===name&&file.sha256===item.sha256))throw new Error('A retained backup WAL artifact is missing or changed');}
}
