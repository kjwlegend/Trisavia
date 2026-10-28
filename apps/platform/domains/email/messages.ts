import en from './locales/en.json' with {type:'json'};
import zhCN from './locales/zh-CN.json' with {type:'json'};
import type {OwnerUiLocale} from '../access/owner-ui-preferences.ts';

const dictionaries={'zh-CN':zhCN,en};
function format(template:string,values:Record<string,string|number>):string{
 return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g,(_match,key:string)=>{
  if(!Object.hasOwn(values,key))throw new Error('A security email template parameter is missing');
  return String(values[key]);
 });
}
export function localizedChallenge(locale:OwnerUiLocale,purpose:'registration'|'recovery',values:{code:string;requestedAt:string;publicOrigin:string;minutes:number}){
 const dictionary=dictionaries[locale];return {subject:dictionary[`${purpose}.subject`],text:format(dictionary[`${purpose}.text`],values)};
}
export function localizedRecoveryNotice(locale:OwnerUiLocale,values:{completedAt:string;publicOrigin:string}){
 const dictionary=dictionaries[locale];return {subject:dictionary['recoveryCompleted.subject'],text:format(dictionary['recoveryCompleted.text'],values)};
}
