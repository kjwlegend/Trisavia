import {readdir,lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from '../../apps/web/public/i18n/vendor/formatjs.js';

const locales=['zh-CN','en'],namespacePattern=/^[a-z][a-z0-9-]{0,47}$/,keyPattern=/^[A-Za-z0-9_.:-]{1,200}$/;
const officialNamespaces=new Set(['world-content','life-content']),digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const string=(value,max=2048)=>typeof value==='string'&&value.length>0&&value.length<=max&&!value.includes('\0');
const keys=(value,required,optional=[])=>record(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const flat=value=>record(value)&&Object.keys(value).length<=32&&Object.entries(value).every(([key,v])=>string(key,160)&&(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||string(v)));
const sourcePath=value=>string(value,512)&&!value.startsWith('/')&&!/[\\\0]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
async function contentSourceIndex(publicRoot,namespace,messageKeys,source){
 const path=resolve(publicRoot,'i18n/content-sources',namespace+'.json');
 if(await realpath(path)!==path||!(await lstat(path)).isFile())throw new Error('Official content indices must be regular contained source files');
 const bytes=await source(path);if(bytes.length>1048576)throw new Error('Official content source index exceeds 1 MiB');
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),bad=()=>{throw new Error('Invalid official content source index: '+namespace);};
 if(!keys(value,['schemaVersion','namespace','sourceBaseline','digestContract','resources','groups','files'])||value.schemaVersion!==1||value.namespace!==namespace)bad();
 if(!keys(value.sourceBaseline,['commit','appVersion','checkedDate'])||!/^[a-f0-9]{40}$/.test(value.sourceBaseline.commit)||!/^\d+\.\d+\.\d+$/.test(value.sourceBaseline.appVersion)||!/^\d{4}-\d{2}-\d{2}$/.test(value.sourceBaseline.checkedDate))bad();
 if(!keys(value.digestContract,['algorithm','encoding','canonicalization','coverage','mismatch','missingVersion'])||value.digestContract.algorithm!=='sha256'||value.digestContract.encoding!=='UTF-8'||Object.values(value.digestContract).some(v=>!string(v)))bad();
 if(!keys(value.resources,locales))bad();
 for(const locale of locales){
  const resource=value.resources[locale];if(!keys(resource,['path','sha256'])||resource.path!==`../../locales/${namespace}/${locale}.json`||!digest(resource.sha256))bad();
  if(createHash('sha256').update(await source(resolve(publicRoot,'locales',namespace,locale+'.json'))).digest('hex')!==resource.sha256)throw new Error('Official content dictionary digest differs: '+namespace+'/'+locale);
 }
 if(!Array.isArray(value.groups)||!value.groups.length||value.groups.length>512||!Array.isArray(value.files)||!value.files.length||value.files.length>128)bad();
 for(const group of value.groups){
  if(!keys(group,['sourceId','sourceRef','version','sourceDigest','digestFields','fields','locations','versionKind'],['access','currentSource','nativeStoryDigest','stateGuards','selector'])||!string(group.sourceId,160)||!string(group.sourceRef,512)||group.version!==null&&(!Number.isSafeInteger(group.version)||group.version<1)||!digest(group.sourceDigest)||!string(group.versionKind,512)||!record(group.fields)||!record(group.locations)||!Array.isArray(group.digestFields))bad();
  const fields=Object.keys(group.fields).sort();if(!fields.length||fields.length>32||JSON.stringify(fields)!==JSON.stringify([...group.digestFields].sort())||JSON.stringify(fields)!==JSON.stringify(Object.keys(group.locations).sort()))bad();
  for(const [field,key]of Object.entries(group.fields)){
   if(!string(field,160)||typeof key!=='string'||!messageKeys.has(namespace+':'+key))bad();const location=group.locations[field];
   if(!keys(location,['path'],['pointer','selector','context'])||!sourcePath(location.path)||Object.hasOwn(location,'pointer')===Object.hasOwn(location,'selector')||!string(location.pointer??location.selector)||location.context!==undefined&&!flat(location.context))bad();
  }
  if(group.nativeStoryDigest!==undefined&&!digest(group.nativeStoryDigest)||group.access!==undefined&&!string(group.access)||['stateGuards','selector'].some(key=>group[key]!==undefined&&!flat(group[key])))bad();
  if(group.currentSource!==undefined&&(!keys(group.currentSource,['operation','record'],['targetId','selector'])||!string(group.currentSource.operation,160)||!string(group.currentSource.record,160)||group.currentSource.targetId!==undefined&&!string(group.currentSource.targetId,160)||group.currentSource.selector!==undefined&&!flat(group.currentSource.selector)))bad();
 }
 for(const file of value.files)if(!keys(file,['path','sha256','meaning'])||!sourcePath(file.path)||!digest(file.sha256)||!string(file.meaning))bad();
}
function parameters(ast,out=new Set()){
 for(const element of ast){if([1,2,3,4,5,6,8].includes(element.type))out.add(element.value);if(element.options)for(const option of Object.values(element.options))parameters(option.value,out);if(element.children)parameters(element.children,out);}return [...out].sort();
}
function compile(bytes){
 if(bytes.length>262144)throw new Error('i18n dictionary exceeds 256 KiB');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
 if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length||Object.keys(value).length>4000)throw new Error('Expected a nonempty flat i18n dictionary');
 const messages={},contracts={};
 for(const [key,message]of Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en'))){
  if(!keyPattern.test(key)||['__proto__','constructor','prototype'].includes(key)||typeof message!=='string'||!message.length||message.length>16384||message.includes('\0'))throw new Error('Invalid explicit i18n message');
  messages[key]=parse(message,{ignoreTag:true,captureLocation:false});contracts[key]=parameters(messages[key]);
 }
 return {messages,contracts};
}
/** All content stays in independent selected-language resources, never JS imports. */
export async function buildLocaleResources({publicRoot,source,emit}){
 let entries;try{entries=await readdir(resolve(publicRoot,'locales'),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(entries.length>32)throw new Error('Too many i18n namespaces');
 const namespaces={},keys=new Set();
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(!entry.isDirectory()||!namespacePattern.test(entry.name))throw new Error('Invalid i18n namespace directory');
  const directory=resolve(publicRoot,'locales',entry.name),files=await readdir(directory);
  if(files.sort().join(',')!=='en.json,zh-CN.json')throw new Error('Each i18n namespace requires exactly zh-CN and en JSON');
  let expected;namespaces[entry.name]={};
  for(const locale of locales){
   const path=resolve(directory,locale+'.json');if(!(await lstat(path)).isFile())throw new Error('i18n dictionaries must be regular files');
   const compiled=compile(await source(path)),contract=JSON.stringify(compiled.contracts);
   if(expected!==undefined&&expected!==contract)throw new Error('i18n keys or named parameters differ between languages: '+entry.name);
   expected=contract;const body=Buffer.from(JSON.stringify({version:1,locale,namespace:entry.name,messages:compiled.messages}));
   for(const key of Object.keys(compiled.messages))keys.add(entry.name+':'+key);
   if(body.length>262144)throw new Error('Compiled i18n dictionary exceeds 256 KiB');
   namespaces[entry.name][locale]=await emit(`i18n-${entry.name}-${locale}`,'json',body,'application/json; charset=utf-8');
  }
  if(officialNamespaces.has(entry.name))await contentSourceIndex(publicRoot,entry.name,keys,source);
 }
 return {manifest:{version:1,format:'icu-ast-v1',namespaces},keys};
}
