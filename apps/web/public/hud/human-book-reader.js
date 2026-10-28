import {readLifeBook} from './life-c-contract.js';
const invalid=()=>Object.assign(Error('life_response_invalid'),{code:'life_response_invalid'}),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const sourceFields=['bookId','version','authorDisplay','title','locale','readingScope','body'];
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(value=>value.toString(16).padStart(2,'0')).join('');
const plain=(value,max,body=false)=>typeof value==='string'&&value.trim()&&[...value].length<=max&&!/[<>\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value)&&(body||!/[\n\t]/u.test(value))&&![...value].some(char=>char.length===1&&char.charCodeAt(0)>=0xd800&&char.charCodeAt(0)<=0xdfff);
/** The original decoder remains authoritative. Invalid translation metadata can
 * only remove the translation, never turn an original read failure into a book. */
export async function readHumanLifeBook(value,expected){
 const accepted=readLifeBook(value?.original,expected),book=accepted.data.book;
 if(!exact(value,['schema','version','original','presentation'])||value.schema!=='human-book'||value.version!==1||!exact(book,[...sourceFields,'digest']))throw invalid();
 let sourceDigest;try{sourceDigest=await digest(Object.fromEntries(sourceFields.map(key=>[key,book[key]])));}catch{throw invalid();}if(sourceDigest!==book.digest)throw invalid();
 const original=reason=>({instanceId:accepted.instanceId,data:{...accepted.data,presentation:{status:'original',sourceLocale:'zh-CN',reason}}});
 let bytes;try{bytes=new TextEncoder().encode(JSON.stringify(value)).byteLength;}catch{return original('translation-unavailable');}
 if(bytes>131072)return original('translation-unavailable');
 const p=value.presentation;
 if(p?.status==='original')return exact(p,['status','sourceLocale','reason'])&&p.sourceLocale==='zh-CN'&&['source-changed','translation-unavailable'].includes(p.reason)?original(p.reason):original('translation-unavailable');
 if(!exact(p,['status','translation'])||p.status!=='translated')return original('translation-unavailable');
 const t=p.translation;
 if(!exact(t,['sourceId','sourceVersion','sourceLocale','sourceDigest','locale','translationRevision','translatedFields','digest'])||typeof t.sourceId!=='string'||!t.sourceId||t.sourceId.length>100||!Number.isSafeInteger(t.sourceVersion)||t.sourceVersion<1||t.sourceVersion>2147483647||t.sourceLocale!=='zh-CN'||t.locale!=='en'||!Number.isSafeInteger(t.translationRevision)||t.translationRevision<1||t.translationRevision>2147483647||!hash(t.sourceDigest)||!hash(t.digest)||!exact(t.translatedFields,['title','authorDisplay','body'])||!plain(t.translatedFields.title,240)||!plain(t.translatedFields.authorDisplay,240)||!plain(t.translatedFields.body,10000,true))return original('translation-unavailable');
 if(t.sourceId!==book.bookId||t.sourceVersion!==book.version||book.locale!=='zh-CN')return original('source-changed');
 if(sourceDigest!==t.sourceDigest)return original('source-changed');
 try{
  const unsigned=Object.fromEntries(Object.entries(t).filter(([key])=>key!=='digest'));if(await digest(unsigned)!==t.digest)return original('translation-unavailable');
 }catch{return original('translation-unavailable');}
 return{instanceId:accepted.instanceId,data:{...accepted.data,presentation:{status:'translated',translation:structuredClone(t)}}};
}
export function humanBookDisplayFields(data,locale){
 const book=data.book;
 return locale==='en'&&data.presentation.status==='translated'?data.presentation.translation.translatedFields:{title:book.title,authorDisplay:book.authorDisplay,body:book.body};
}
