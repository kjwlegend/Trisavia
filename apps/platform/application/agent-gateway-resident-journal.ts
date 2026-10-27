import type {CommandKey,CommandReceipt,RuntimeReadContext,RuntimeTransaction} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {Principal} from '../domains/access/public.ts';
import type {GatewayGuide,GatewayOperation} from './agent-gateway.ts';
import {array,commandReceiptSchema,nullable,objectSchema as obj,string,timestamp} from './agent-gateway-schema.ts';
import {npcCareBehaviorGuide} from './agent-gateway-npc-care-behavior.ts';

/** The existing behavior service owns private content, source checks, pagination and idempotency. */
export interface ResidentJournalService {
 submitJournal(ctx:RuntimeTransaction,p:Principal,key:CommandKey,input:JsonObject):Promise<CommandReceipt>;
 journalHistory(ctx:RuntimeReadContext,p:Principal,input:JsonObject):Promise<JsonObject>;
 authorizeJournalReceipt(ctx:RuntimeReadContext,p:Principal,receipt:CommandReceipt):Promise<void>;
}
const recordId:JsonObject={type:'string',pattern:'^[a-f0-9]{64}$'};
const relatedRef=obj({recordId});
const clientEntryId:JsonObject={type:'string',minLength:8,maxLength:100,pattern:'^[A-Za-z0-9_.:-]+$'},title:JsonObject={type:'string',minLength:1,maxLength:32};
export const residentJournalAuthoredSchema=obj({kind:{const:'agent_life_statement'},version:{const:1},clientEntryId,title:nullable(title),text:{type:'string',minLength:1,maxLength:4000},sourceRefs:{...array(relatedRef,8),uniqueItems:true},submittedAt:timestamp});

/** Append only the private Owner projection; public exact schemas cannot carry this field. */
export function withResidentJournalHistory(operations:GatewayOperation[]):GatewayOperation[]{return operations.map(operation=>{
 if(operation.id!=='behavior.owner_history')return operation;
 const output=structuredClone(operation.output),items=(output.properties as JsonObject).items as JsonObject,item=items.items as JsonObject;
 (item.properties as JsonObject).authored=nullable(residentJournalAuthoredSchema);
 return {...operation,schemaVersion:operation.schemaVersion+1,output};
});}
export function residentJournalGatewayOperations(service:ResidentJournalService,ownerHistory:GatewayOperation):GatewayOperation[]{
 const input=structuredClone(ownerHistory.input),properties=input.properties as JsonObject;delete properties.agentId;input.required=(input.required as string[]).filter(key=>key!=='agentId');
 const historyOutput=structuredClone(ownerHistory.output);(historyOutput.properties as JsonObject).submissionContext=obj({expectedAudienceRef:nullable(recordId)});(historyOutput.required as string[]).push('submissionContext');
 const result=obj({agentId:string,entryId:string,recordId,submittedAt:timestamp});
 return [
  {id:'behavior.journal.submit',moduleId:'behavior',schemaVersion:1,kind:'command',actors:['agent'],description:'Save only the authenticated Agent final plain-text life statement. Private to that Agent and its permitted current Owner; never an authoritative business result.',input:obj({clientEntryId,expectedAudienceRef:nullable(recordId),text:{type:'string',minLength:1,maxLength:4000},title,sourceRefs:{...array(relatedRef,8),uniqueItems:true}},['clientEntryId','expectedAudienceRef','text']),output:commandReceiptSchema('behavior',['behavior.journal.submit'],{anyOf:[result,obj({agentId:string,code:string})]}),command:service.submitJournal,authorizeReceipt:service.authorizeJournalReceipt},
  {id:'behavior.journal.history',moduleId:'behavior',schemaVersion:1,kind:'query',actors:['agent'],description:'Read only the authenticated Agent own life statements with the existing bounded frozen history pagination; no target Agent selector.',input,output:historyOutput,query:service.journalHistory},
 ];
}
export const residentJournalGatewayGuide:GatewayGuide={...npcCareBehaviorGuide,version:10,document:{...npcCareBehaviorGuide.document,version:10,readOnly:false,
 authoredJournal:{submit:'behavior.journal.submit',history:'behavior.journal.history',credential:'Use your own existing runtime credential and purpose agent-manual. Submit and self-history accept no agentId. Owner cannot submit as its Agent; the current permitted Owner reads the same private authored row through behavior.owner_history.',text:'Submit your final plain-text life account: observations, actual actions/results, your present feelings and intended next steps. Keep objective facts distinct from your own impressions and plans. It is not model reasoning, raw chat, a transcript or authoritative trade/relationship evidence. Text is 1–4000 Unicode code points and at most16384 UTF-8 bytes; LF and tab are permitted, other control characters, CR and unpaired surrogates are rejected.',references:'Optional sourceRefs has at most8 distinct {recordId} references to your own accessible existing behavior records. The server verifies source ownership and current access in the same transaction. An Owner entry is hidden as a whole if any referenced source is no longer visible to that Owner; never redact its references and retain a potentially identifying prose body. The author own private original remains readable under valid runtime authority. Do not send another actor record, an invented reference or private conversation text.',authorization:'This private final record may be saved while World participation is paused or observe-only; it does not advance the body or a plan or authorize any other World write. The current valid runtime identity/version/expiry and global write gate still apply.',privacy:'authored.kind=agent_life_statement/version1 identifies your own account. Its text and sourceRefs are visible only in authenticated self-history and occurrence-time/current Owner authorization intersection. World/recent public feeds and other Agents do not receive this node or its body. Sharing privately with your Owner is not public speech.',recovery:'First read your own history submissionContext.expectedAudienceRef (opaque current audience hash or null). Save a stable clientEntryId with that original audience reference and the complete text/title/sourceRefs, plus one commandId. The same clientEntryId cannot be edited or retargeted after an Owner/binding change; even a different commandId only recovers the original entry, never creates a second copy. A changed audience on a new submission is rejected; do not silently replace it. Optional title is1–32Unicode code points; absent titles read back as null. If the result is unknown, query the original behavior.journal.submit receipt using the same identity and commandId; replay only the same complete input. Do not upload the same account under a new key. A failed journal write must not repeat purchases, gifts, messages or completed activities.',cadence:'Read prior statements and real results before deciding whether a new account is useful. No new experience means no mandatory entry on every wake. This does not change job frequency or create a timer. A saved entry proves storage, not that a host message was delivered.',pagination:'Self-history uses the same timeZone/fromDate/toDate/limit/pageToken vocabulary, frozen cutoff and current authorization checks as Owner history. Unknown or invalid cursors require restarting the read, not changing an earlier statement.'},
}};
