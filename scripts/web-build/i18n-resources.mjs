import {readdir,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from '../../apps/web/public/i18n/vendor/formatjs.js';

const locales=['zh-CN','en'],namespacePattern=/^[a-z][a-z0-9-]{0,47}$/,keyPattern=/^[A-Za-z0-9_.:-]{1,200}$/;
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
 }
 return {manifest:{version:1,format:'icu-ast-v1',namespaces},keys};
}
