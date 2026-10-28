import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const FORMATJS_VERSIONS=Object.freeze({'intl-messageformat':'12.1.4','@formatjs/icu-messageformat-parser':'3.5.22','@formatjs/fast-memoize':'3.1.7','@formatjs/icu-skeleton-parser':'2.1.12'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Explicit offline generation only. Serving a source page never builds dependencies.
export async function generateI18nVendor({repoRoot=root,dependencyRoot=repoRoot}={}){
 const require=createRequire(resolve(dependencyRoot,'package.json')),out=resolve(repoRoot,'apps/web/public/i18n/vendor');
 const packages=[];
 for(const [name,version]of Object.entries(FORMATJS_VERSIONS)){
  const directory=dirname(require.resolve(name)),pkg=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));
  if(pkg.name!==name||pkg.version!==version)throw new Error('Unexpected FormatJS dependency version: '+name);
  const license=await readFile(resolve(directory,'LICENSE.md'),'utf8');
  packages.push({name,version,license:pkg.license,licenseSha256:sha(Buffer.from(license)),text:license});
 }
 const result=await build({stdin:{contents:'export {IntlMessageFormat} from "intl-messageformat"; export {parse} from "@formatjs/icu-messageformat-parser";',resolveDir:dependencyRoot,sourcefile:'formatjs-vendor-entry.js'},bundle:true,write:false,format:'esm',minify:true,legalComments:'none',target:['chrome110','firefox115','safari16'],tsconfigRaw:{},logLevel:'silent'});
 const bytes=result.outputFiles[0].contents,notices=packages.map(p=>`${p.name}@${p.version} (${p.license})\n${p.text}`).join('\n\n');
 await mkdir(out,{recursive:true});await writeFile(resolve(out,'formatjs.js'),bytes);await writeFile(resolve(out,'LICENSES.txt'),notices);
 const provenance={version:1,generator:'scripts/web-build/i18n-vendor.mjs',file:'formatjs.js',sha256:sha(bytes),bytes:bytes.length,packages:packages.map(({text,...p})=>p),licensesSha256:sha(Buffer.from(notices))};
 await writeFile(resolve(out,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');return provenance;
}
export async function verifyI18nVendor(repoRoot=root){
 const directory=resolve(repoRoot,'apps/web/public/i18n/vendor'),p=JSON.parse(await readFile(resolve(directory,'provenance.json'),'utf8'));
 const bytes=await readFile(resolve(directory,'formatjs.js')),licenses=await readFile(resolve(directory,'LICENSES.txt'));
 if(p.version!==1||p.generator!=='scripts/web-build/i18n-vendor.mjs'||p.file!=='formatjs.js'||p.sha256!==sha(bytes)||p.bytes!==bytes.length||p.licensesSha256!==sha(licenses)||JSON.stringify(p.packages?.map(({name,version})=>[name,version]))!==JSON.stringify(Object.entries(FORMATJS_VERSIONS)))throw new Error('FormatJS vendor differs from reviewed generation');
 return p;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const provenance=await generateI18nVendor({dependencyRoot:process.argv[2]?resolve(process.argv[2]):root});
 console.info(JSON.stringify({file:provenance.file,bytes:provenance.bytes,sha256:provenance.sha256}));
}
