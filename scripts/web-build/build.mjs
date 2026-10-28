import {build,transform} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rm,rename,mkdtemp,readdir,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildLocaleResources} from './i18n-resources.mjs';
import {verifyI18nVendor,FORMATJS_VERSIONS} from './i18n-vendor.mjs';
const defaultRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),posix=path=>path.split(sep).join('/');
function attributes(tag){return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]]));}
function completeMessageLiteral(text,match){
 const suffix=text.slice(match.index+match[0].length).replace(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*/,'');
 return !suffix.startsWith('+')&&!/^\.concat\s*\(/.test(suffix);
}
async function filesIn(directory){const out=[];for(const e of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const path=resolve(directory,e.name);if(e.isDirectory())out.push(...await filesIn(path));else if(e.isFile())out.push(path);else throw new Error('Build sources cannot be links: '+e.name);}return out;}
/** Production outputs are derived only from this checkout. Never reads serving files or a saved bundle. */
export async function buildWeb({root=defaultRoot}={}){
 root=await realpath(resolve(root));const publicRoot=resolve(root,'apps/web/public'),dist=resolve(root,'dist'),output=resolve(dist,'web');
 for(const path of [dist,output]){try{if((await lstat(path)).isSymbolicLink())throw new Error('Refuse linked build destination');}catch(e){if(e.code!=='ENOENT')throw e;}}
 await mkdir(dist,{recursive:true});await rm(output,{recursive:true,force:true});const temporary=await mkdtemp(resolve(dist,'.web-')),sources=new Map(),assets=[],pages={},aliases=new Map();await mkdir(resolve(temporary,'build'));
 const references=new Set(),quotedKeys=new Set();
 const source=async path=>{const full=resolve(path),name=posix(relative(root,full));if(name.startsWith('../')||name==='..'||(await lstat(full)).isSymbolicLink())throw new Error('Build input must be a regular checkout file');const bytes=await readFile(full);sources.set(name,sha(bytes));
  if(name.startsWith('apps/web/public/')&&/\.(?:html|js)$/.test(name)){
   const text=bytes.toString('utf8');for(const match of text.matchAll(/\b(?:t|msg)\(\s*(['"])([a-z][a-z0-9-]{0,47}:[A-Za-z0-9_.:\/-]{1,200})\1/g))if(completeMessageLiteral(text,match))references.add(match[2]);
   for(const match of text.matchAll(/data-i18n(?:-(?:placeholder|title|aria-label))?\s*=\s*(['"])([a-z][a-z0-9-]{0,47}:[A-Za-z0-9_.:\/-]{1,200})\1/g))references.add(match[2]);
   for(const match of text.matchAll(/(['"])([a-z][a-z0-9-]{0,47}:[A-Za-z0-9_.:\/-]{1,200})\1/g))if(completeMessageLiteral(text,match))quotedKeys.add(match[2]);
  }
  return bytes;};
 const publicFile=url=>{if(!url.startsWith('/assets/')||/[?#\u0000-\u0020]/u.test(url))throw new Error('Expected an exact source /assets/ path');const full=resolve(publicRoot,url.slice('/assets/'.length));if(!full.startsWith(publicRoot+sep))throw new Error('Asset path escapes public root');return full;};
 const emit=async(name,extension,bytes,contentType)=>{const digest=sha(bytes),file=`build/${name}-${digest.slice(0,16)}.${extension}`,url='/assets/'+file;await writeFile(resolve(temporary,file),bytes);assets.push({url,file,sha256:digest,contentType,bytes:bytes.length});return url;};
 try{
  // Runtime-fetched life geometry is an explicit build input, not a bundled import.
  await source(resolve(publicRoot,'world-map-life-v1.json'));
  await source(resolve(publicRoot,'world-life/world-map-life-b-v1.json'));
  await source(resolve(publicRoot,'world-life/world-map-life-c-v1.json'));
  await source(resolve(publicRoot,'world-life/world-map-expansion-v1.json'));
  await source(resolve(publicRoot,'world-life/spatial-manifest-expansion-v1.json'));
  await source(resolve(publicRoot,'world-life/spatial-manifest-c-v1.json'));
  // NPC life add-ons are verified at runtime and must invalidate a stale build.
  await source(resolve(publicRoot,'npc-life-v1/manifest.json'));
  await source(resolve(publicRoot,'npc-life-v1/spatial-addon-v1.json'));
  const pkg=JSON.parse(await source(resolve(root,'package.json'))),lock=JSON.parse(await source(resolve(root,'package-lock.json')));await source(resolve(root,'scripts/build-web.mjs'));for(const path of await filesIn(resolve(root,'scripts/web-build')))await source(path);
  const localeBuild=await buildLocaleResources({publicRoot,source,emit:async(...args)=>{
   const url=await emit(...args),asset=assets.find(a=>a.url===url);return {url,sha256:asset.sha256,bytes:asset.bytes};
  }});
  const localeResources=localeBuild?.manifest;
  let localeManifest;
  if(localeResources){
   await verifyI18nVendor(root);
   for(const [name,version]of Object.entries(FORMATJS_VERSIONS))if(lock.packages?.['node_modules/'+name]?.version!==version)throw new Error('FormatJS lock input differs: '+name);
   if(pkg.dependencies?.['intl-messageformat']!==FORMATJS_VERSIONS['intl-messageformat']||pkg.devDependencies?.['@formatjs/icu-messageformat-parser']!==FORMATJS_VERSIONS['@formatjs/icu-messageformat-parser'])throw new Error('Exact reviewed FormatJS declarations required');
   for(const name of ['formatjs.js','provenance.json','LICENSES.txt'])await source(resolve(publicRoot,'i18n/vendor',name));
   localeManifest=await emit('i18n-manifest','json',Buffer.from(JSON.stringify(localeResources)),'application/json; charset=utf-8');
  }
  const brandDir=resolve(publicRoot,'brand/trisavia-02'),exports=JSON.parse(await source(resolve(brandDir,'performance-exports.json')));if(exports.version!==1||exports.exports.length!==2)throw new Error('Exact approved brand performance exports required');let brandBytes=0;
  for(const entry of exports.exports){if(!/^trisavia-(nav-lockup|small-mark-framed)\.svg$/.test(entry.source)||entry.file!==entry.source.replace('.svg','.performance.svg'))throw new Error('Unexpected brand export');const original=await source(resolve(brandDir,entry.source)),bytes=await source(resolve(brandDir,entry.file));if(sha(original)!==entry.sourceSha256||sha(bytes)!==entry.sha256||bytes.length!==entry.bytes)throw new Error('Brand performance export is stale');brandBytes+=bytes.length;const url=await emit(entry.file.replace('.performance.svg',''), 'svg',bytes,'image/svg+xml');for(const name of [entry.source,entry.file])aliases.set('/assets/brand/trisavia-02/'+name,url);}
  if(brandBytes>50*1024)throw new Error('Navigation and favicon performance exports exceed 50 KiB');
  const plugins=[{name:'original-public-paths',setup(api){
   api.onLoad({filter:/\.m?js$/},async args=>{if(!args.path.startsWith(publicRoot+sep))throw new Error('Browser JS dependency escapes public root');let contents=(await source(args.path)).toString('utf8');for(const [before,after]of aliases)contents=contents.split(before).join(after);
    if(/\bimport\.meta\.url\b/.test(contents)){const name='__trisaviaModuleUrl_'+sha(Buffer.from(posix(relative(publicRoot,args.path)))).slice(0,10),url='/assets/'+posix(relative(publicRoot,args.path));const parsed=await transform(contents,{loader:'js',format:'esm',define:{'import.meta.url':name},sourcefile:url});contents=`const ${name}=new URL(${JSON.stringify(url)},globalThis.location.origin).href;\n`+parsed.code;}
    return {contents,loader:'js',resolveDir:dirname(args.path)};
   });
   api.onLoad({filter:/\.json$/},async args=>{if(!args.path.startsWith(publicRoot+sep))throw new Error('Browser JSON dependency escapes public root');return {contents:(await source(args.path)).toString('utf8'),loader:'json',resolveDir:dirname(args.path)};});
   api.onLoad({filter:/\.css$/},async args=>({contents:(await source(args.path)).toString('utf8'),loader:'css',resolveDir:dirname(args.path)}));
   api.onResolve({filter:/.*/},async args=>{if(args.kind!=='url-token')return;if(/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(args.path))return {path:args.path,external:true};const match=args.path.match(/^([^?#]*)([\s\S]*)$/),path=match[1],suffix=match[2],full=resolve(args.resolveDir,path);if(!full.startsWith(publicRoot+sep))throw new Error('CSS resource escapes public root');await lstat(full);return {path:'/assets/'+posix(relative(publicRoot,full))+suffix,external:true};});
  }}];
  // Pin browser semantics here: esbuild must not discover checkout or parent tsconfig files.
  const options={absWorkingDir:root,tsconfigRaw:{compilerOptions:{alwaysStrict:true}},bundle:true,write:false,minify:true,metafile:true,legalComments:'none',target:['chrome110','firefox115','safari16'],logLevel:'silent',plugins};
  for(const name of ['index','resident','releases','kanban']){
   let html=(await source(resolve(publicRoot,name+'.html'))).toString('utf8');const tags=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]).filter(tag=>attributes(tag).rel==='stylesheet');if(!tags.length)throw new Error('Page has no ordered stylesheets: '+name);
   const css=tags.map(tag=>{const a=attributes(tag);return '@import '+JSON.stringify('./'+posix(relative(publicRoot,publicFile(a.href))))+(a.media?' '+a.media:'')+';';}).join('\n');
   const cssBuild=await build({...options,stdin:{contents:css,loader:'css',resolveDir:publicRoot,sourcefile:name+'-ordered.css'},outfile:resolve(temporary,name+'.css')}),cssUrl=await emit(name,'css',cssBuild.outputFiles[0].contents,'text/css; charset=utf-8');let first=true;for(const tag of tags){html=html.replace(tag,first?`<link rel="stylesheet" href="${cssUrl}">`:'');first=false;}
   const scripts=[...html.matchAll(/<script\b[^>]*>\s*<\/script>/gi)].map(m=>m[0]).filter(tag=>attributes(tag).type==='module');if(scripts.length!==1)throw new Error('One explicit module entry per page required: '+name);const tag=scripts[0],entry=attributes(tag).src;if(!entry)throw new Error('External module entry required');const jsBuild=await build({...options,entryPoints:[publicFile(entry)],format:'esm',splitting:false,outfile:resolve(temporary,name+'.js')});
   if(Object.values(jsBuild.metafile.outputs).some(o=>o.imports.length))throw new Error('Unbundled browser imports are not production-ready');const jsUrl=await emit(name,'js',jsBuild.outputFiles[0].contents,'text/javascript; charset=utf-8');html=html.replace(tag,tag.replace(entry,jsUrl));for(const [before,after]of aliases)html=html.split(before).join(after);
   const bytes=Buffer.from(html);await writeFile(resolve(temporary,name+'.html'),bytes);pages[name]={file:name+'.html',sha256:sha(bytes),bytes:bytes.length};
  }
  for(const key of quotedKeys)if(localeResources?.namespaces[key.split(':')[0]])references.add(key);
  for(const key of references)if(!localeBuild?.keys.has(key))throw new Error('Declared i18n message is not available in both languages: '+key);
  const manifest={version:1,appVersion:pkg.version,pages,assets:assets.sort((a,b)=>a.url.localeCompare(b.url,'en')),sources:[...sources].sort(([a],[b])=>a.localeCompare(b,'en')).map(([file,sha256])=>({file,sha256})),...(localeManifest?{i18n:{manifestUrl:localeManifest}}:{})};
  await writeFile(resolve(temporary,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await rename(temporary,output);return manifest;
 }catch(e){await rm(temporary,{recursive:true,force:true});throw e;}
}
