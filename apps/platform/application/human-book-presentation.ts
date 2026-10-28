import {readFile} from 'node:fs/promises';
import type {JsonObject} from '../contracts/store.ts';
import {hashRuntimeRequest} from '../domains/runtime/command.ts';
import {M1Error} from '../domains/common/errors.ts';
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plain=(value:unknown,max:number)=>typeof value==='string'&&value.length>0&&[...value].length<=max&&!/[\p{Cs}\u0000-\u0008\u000b-\u001f\u007f-\u009f<>]/u.test(value);
const sourceFields=['bookId','version','authorDisplay','title','locale','readingScope','body'] as const;
const original=(reason:'source-changed'|'translation-unavailable'):JsonObject=>({status:'original',sourceLocale:'zh-CN',reason});
/** Called only after the original reader has authorized and returned this book.
 * The resource is server-only and no authorized read result is memoized. */
export async function humanBookPresentation(data:JsonObject,resource:unknown=undefined):Promise<JsonObject>{
 const book=data.book;
 if(!exact(data,['book','asOf'])||!Number.isSafeInteger(data.asOf)||!exact(book,[...sourceFields,'digest'])||!['qingzhou_life_guide','harbor_handbook'].includes(String(book.bookId))||book.version!==1||book.locale!=='zh-CN'||typeof book.title!=='string'||book.title.length<1||book.title.length>240||typeof book.authorDisplay!=='string'||book.authorDisplay.length<1||book.authorDisplay.length>240||typeof book.readingScope!=='string'||book.readingScope.length<1||book.readingScope.length>1000||typeof book.body!=='string'||book.body.length<300||book.body.length>10000||!digest(book.digest))throw new M1Error('source_unavailable',503,'The original book response is invalid');
 const source=Object.fromEntries(sourceFields.map(key=>[key,book[key]])) as JsonObject,sourceDigest=hashRuntimeRequest(source);
 if(sourceDigest!==book.digest)throw new M1Error('source_unavailable',503,'The complete original book digest differs');
 if(resource===undefined){try{const bytes=await readFile(new URL('../domains/life/locales/books/en.json',import.meta.url));resource=bytes.length<=128*1024?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)):null;}catch{resource=null;}}
 let presentation:JsonObject=original('translation-unavailable');
 if(exact(resource,['schemaVersion','distribution','sourceDigestContract','translationDigestContract','books'])&&resource.schemaVersion===1&&resource.distribution==='server-only'&&typeof resource.sourceDigestContract==='string'&&typeof resource.translationDigestContract==='string'&&Array.isArray(resource.books)&&resource.books.length<=2){
  const candidates=resource.books.filter(entry=>record(entry)&&entry.sourceId===book.bookId);
  if(candidates.length===1){
   const entry=candidates[0];
   if(exact(entry,['sourceId','sourceVersion','sourceLocale','sourceDigest','locale','translationRevision','translatedFields','digest'])&&entry.sourceLocale==='zh-CN'&&entry.locale==='en'&&Number.isSafeInteger(entry.sourceVersion)&&Number(entry.sourceVersion)>=1&&Number(entry.sourceVersion)<=2147483647&&Number.isSafeInteger(entry.translationRevision)&&Number(entry.translationRevision)>=1&&Number(entry.translationRevision)<=2147483647&&digest(entry.sourceDigest)&&digest(entry.digest)&&exact(entry.translatedFields,['title','authorDisplay','body'])&&plain(entry.translatedFields.title,240)&&plain(entry.translatedFields.authorDisplay,240)&&plain(entry.translatedFields.body,10000)){
    const {digest:expected,...unsigned}=entry;
    if(hashRuntimeRequest(unsigned as JsonObject)===expected)presentation=entry.sourceVersion===book.version&&entry.sourceDigest===sourceDigest?{status:'translated',translation:structuredClone(entry) as JsonObject}:original('source-changed');
   }
  }
 }
 if(Buffer.byteLength(JSON.stringify({originalData:data,presentation}),'utf8')>128*1024-2048)presentation=original('translation-unavailable');
 return {originalData:data,presentation};
}
