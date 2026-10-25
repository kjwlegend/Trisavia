import {createHash} from 'node:crypto';
import {realpath,stat} from 'node:fs/promises';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';

export const WEB_MIME:Readonly<Record<string,string>>={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8',
 '.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg',
 '.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg',
};
export interface VerifiedWebFile {root:string;file:string;sha256:string;bytes:number;contentType:string}
export interface ProductionWebAssets {pages:{index:VerifiedWebFile;resident:VerifiedWebFile;releases:VerifiedWebFile;kanban:VerifiedWebFile};assets:ReadonlyMap<string,VerifiedWebFile>}
export const webSha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const record=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid web manifest object');
 return value as Record<string,unknown>;
};
const digest=(value:unknown):string=>{
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('Invalid web manifest digest');
 return value;
};
const size=(value:unknown):number=>{
 if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('Invalid web manifest byte count');
 return Number(value);
};
/** Real paths are checked again for reads; a release cannot redirect a declared file outside its root. */
export async function containedWebPath(root:string,name:string):Promise<string>{
 if(!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid web asset path');
 const base=await realpath(root),path=await realpath(resolve(base,name));
 if(!path.startsWith(base+sep)||!(await stat(path)).isFile())throw new Error('Invalid web asset path');
 return path;
}
function productionPath(root:string,name:string):string{
 if(!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid web asset path');
 const base=realpathSync(root),path=realpathSync(resolve(base,name));
 if(!path.startsWith(base+sep)||!statSync(path).isFile())throw new Error('Invalid web asset path');
 return path;
}
function checkedFile(root:string,value:unknown,expectedName?:string):VerifiedWebFile{
 const file=record(value),name=file.file;
 if(typeof name!=='string'||expectedName!==undefined&&name!==expectedName)throw new Error('Invalid web manifest file');
 const path=productionPath(root,name),sha256=digest(file.sha256),bytes=size(file.bytes),body=readFileSync(path),contentType=WEB_MIME[extname(name)];
 if(!contentType||body.length!==bytes||webSha256(body)!==sha256)throw new Error('Web manifest file differs');
 return {root,file:name,sha256,bytes,contentType};
}
/** No request or readiness check builds, repairs or falls back from an invalid production release. */
export function loadProductionWebAssets(repoRoot:string,buildRoot:string):ProductionWebAssets{
 try{
  const raw=readFileSync(productionPath(buildRoot,'manifest.json'));
  if(raw.length>2*1024*1024)throw new Error('Web manifest is too large');
  const manifest=record(JSON.parse(raw.toString('utf8'))),pkg=record(JSON.parse(readFileSync(resolve(repoRoot,'package.json'),'utf8')));
  if(manifest.version!==1||manifest.appVersion!==pkg.version||typeof manifest.appVersion!=='string')throw new Error('Web build version differs');
  const pageEntries=record(manifest.pages);
  const pages={index:checkedFile(buildRoot,pageEntries.index,'index.html'),resident:checkedFile(buildRoot,pageEntries.resident,'resident.html'),releases:checkedFile(buildRoot,pageEntries.releases,'releases.html'),kanban:checkedFile(buildRoot,pageEntries.kanban,'kanban.html')};
  if(!Array.isArray(manifest.assets)||!manifest.assets.length||manifest.assets.length>2000||!Array.isArray(manifest.sources)||!manifest.sources.length||manifest.sources.length>5000)throw new Error('Web build declarations are absent');
  const assets=new Map<string,VerifiedWebFile>(),files=new Set<string>();
  for(const value of manifest.assets){
   const item=record(value),file=item.file,sha256=digest(item.sha256);
   if(typeof file!=='string'||!/^build\/[A-Za-z0-9_.-]+$/.test(file)||!file.endsWith('-'+sha256.slice(0,16)+extname(file))||item.url!=='/assets/'+file||files.has(file)||assets.has(String(item.url)))throw new Error('Invalid immutable web asset identity');
   const verified=checkedFile(buildRoot,item);
   if(verified.contentType!==item.contentType||extname(file)==='.html')throw new Error('Invalid web asset content type');
   files.add(file);assets.set(String(item.url),verified);
  }
  for(const page of Object.values(pages)){
   const html=readFileSync(productionPath(page.root,page.file),'utf8');
   const urls=[...html.matchAll(/(?:src|href)=["'](\/assets\/build\/[^"'?#]+)["']/g)].map(match=>match[1]!);
   if(!urls.some(url=>url.endsWith('.js'))||!urls.some(url=>url.endsWith('.css'))||urls.some(url=>!assets.has(url)))throw new Error('A production page references an undeclared asset');
  }
  const sources=new Set<string>();
  for(const value of manifest.sources){
   const input=record(value),file=input.file;
   if(typeof file!=='string'||sources.has(file)||!(/^(apps\/web\/public\/|scripts\/web-build\/)/.test(file)||['package.json','package-lock.json','scripts/build-web.mjs'].includes(file)))throw new Error('Invalid web build input');
   if(webSha256(readFileSync(productionPath(repoRoot,file)))!==digest(input.sha256))throw new Error('Web build input differs');
   sources.add(file);
  }
  for(const required of ['package.json','package-lock.json','scripts/build-web.mjs','apps/web/public/index.html','apps/web/public/resident.html','apps/web/public/releases.html','apps/web/public/kanban.html'])if(!sources.has(required))throw new Error('Required web build input is absent');
  return {pages,assets};
 }catch{throw new Error('Production web assets are missing or invalid; build dist/web from this exact source before startup');}
}
