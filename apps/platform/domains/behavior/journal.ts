import type {OwnerAudienceProof} from '../access/public.ts';
import {hashRuntimeRequest} from '../runtime/command.ts';
import {fail,object} from '../common/errors.ts';
/** Agent-authored final statements; never a source of authoritative activity or economic results. */
export const JOURNAL_LIMITS=Object.freeze({codePoints:4000,utf8Bytes:16384,sourceRefs:8});
export interface JournalRelatedRef {recordId:string}
export interface BehaviorJournalEntry {entryId:string;version:1;agentId:string;clientEntryId:string;expectedAudienceRef:string|null;payloadHash:string;title:string|null;text:string;sourceRefs:JournalRelatedRef[];submittedAt:number;sourceEventId:string;ownerAudience:OwnerAudienceProof|null}
export interface AuthoredJournalView {kind:'agent_life_statement';version:1;clientEntryId:string;title:string|null;text:string;sourceRefs:JournalRelatedRef[];submittedAt:number}
export function journalAudienceRef(agentId:string,proof:OwnerAudienceProof|null){return proof?hashRuntimeRequest({agentId,bindingId:proof.bindingId,bindingVersion:proof.bindingVersion,sharingGeneration:proof.sharingGeneration}):null;}
export function parseJournalInput(input:unknown):{clientEntryId:string;expectedAudienceRef:string|null;title:string|null;text:string;sourceRefs:JournalRelatedRef[]}{
 const value=object(input,['clientEntryId','expectedAudienceRef','title','text','sourceRefs']);
 if(typeof value.text!=='string'||!value.text.trim()||Array.from(value.text).length>JOURNAL_LIMITS.codePoints||Buffer.byteLength(value.text,'utf8')>JOURNAL_LIMITS.utf8Bytes||/[\p{Cs}\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value.text))fail('journal_text_invalid',422,'Submit final plain text: at most4000 Unicode characters/16384 UTF8 bytes, with only LF/Tab controls');
 if(typeof value.clientEntryId!=='string'||!/^[A-Za-z0-9_.:-]{8,100}$/.test(value.clientEntryId)||value.expectedAudienceRef!==null&&(typeof value.expectedAudienceRef!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedAudienceRef)))fail('invalid_request',400,'Preserve the stable client entry ID and original submission audience');
 const title=value.title===undefined?null:value.title;if(title!==null&&(typeof title!=='string'||!title.trim()||Array.from(title).length>32||/[\p{Cc}\p{Cs}]/u.test(title)))fail('journal_title_invalid',422,'Use a final title of1to32 Unicode characters without controls');
 const refs=value.sourceRefs??[];if(!Array.isArray(refs)||refs.length>JOURNAL_LIMITS.sourceRefs)fail('invalid_request',400,'Use at most eight currently visible own record references');
 const sourceRefs=refs.map(v=>{const ref=object(v,['recordId']);if(typeof ref.recordId!=='string'||!/^[a-f0-9]{64}$/.test(ref.recordId))fail('invalid_request',400,'Use an existing own behavior record ID');return{recordId:ref.recordId};});
 if(new Set(sourceRefs.map(r=>r.recordId)).size!==sourceRefs.length)fail('invalid_request',400,'Each related record may occur only once');
 return{clientEntryId:value.clientEntryId,expectedAudienceRef:value.expectedAudienceRef,title:title as string|null,text:value.text,sourceRefs};
}
