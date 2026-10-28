import {realpath,lstat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {createHash} from 'node:crypto';

export const INTRO_PACKAGE_ROOT='docs/marketing/trisavia-introduction-20261024';
export const INTRO_PUBLISH_FILES=Object.freeze([
 'index.html','en/index.html','zh-CN/index.html','sources.html','en/sources.html','zh-CN/sources.html',
 'style.css','deck.js','content.js','sources.md','sources.en.md','sources.zh-CN.md',
 'assets/human-base-idle.png','assets/human-curlyhair-idle.png','assets/human-longhair-idle.png','assets/human-shorthair-idle.png',
 'assets/town-development.png','assets/town-live.png','assets/trisavia-nav-lockup.svg','assets/trisavia-primary.png','assets/trisavia-small-mark-framed.svg',
]);
export const INTRO_SOURCE_FILES=Object.freeze([INTRO_PACKAGE_ROOT+'/ROUTES.md',...INTRO_PUBLISH_FILES.map(file=>INTRO_PACKAGE_ROOT+'/publish/'+file)]);
export const INTRO_ROUTES=Object.freeze(INTRO_PUBLISH_FILES.flatMap(file=>{
 const locale=file.startsWith('en/')?'en':file.startsWith('zh-CN/')?'zh-CN':null,leaf=locale?file.slice(locale.length+1):file,prefix=locale?'/'+locale+'/intro':'/intro';
 return leaf==='index.html'?[{url:prefix,file},{url:prefix+'/',file}]:[{url:prefix+'/'+leaf,file}];
}));
export const introContentType=file=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/markdown; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'})[extname(file)];
/** The authored publish package is copied byte-for-byte. No generator executes in a build or request. */
export async function copyPublishedIntro({root,destination,source}){
 const directory=resolve(root,INTRO_PACKAGE_ROOT,'publish');
 try{if(await realpath(directory)!==directory||!(await lstat(directory)).isDirectory())throw new Error('Intro publish root must be a regular checkout directory');}catch(error){if(error.code==='ENOENT')return undefined;throw error;}
 await source(resolve(root,INTRO_PACKAGE_ROOT,'ROUTES.md'));const files=[];let total=0;
 for(const name of INTRO_PUBLISH_FILES){
  const path=resolve(directory,name);if(await realpath(path)!==path||!(await lstat(path)).isFile())throw new Error('Intro publish inputs must be regular contained files');
  const bytes=await source(path);total+=bytes.length;if(bytes.length>8*1024*1024||total>20*1024*1024)throw new Error('Intro publish package exceeds its bounded size');
  const file='intro/'+name;await mkdir(dirname(resolve(destination,file)),{recursive:true});await writeFile(resolve(destination,file),bytes);
  files.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,contentType:introContentType(name)});
 }
 return {version:1,files};
}
