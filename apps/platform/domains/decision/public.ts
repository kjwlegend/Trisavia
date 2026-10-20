import type {JsonObject} from '../../contracts/store.ts';
import type {CommandKey,CommandReceipt,RuntimeActor,RuntimeReadContext,RuntimeSource,RuntimeTransaction} from '../../contracts/runtime-store.ts';
import type {Principal} from '../access/public.ts';
import type {DecisionIntent,DecisionRequest} from './repository.ts';
export interface DecisionOrigin {actor:RuntimeActor;source:RuntimeSource;commandId:string;correlationId:string}
export interface DecisionIntentSink {
 ensure(context:RuntimeTransaction,intent:DecisionIntent,origin:DecisionOrigin):Promise<{decisionId:string;version:number}>;
 cancel(context:RuntimeTransaction,agentId:string,deduplicationKey:string,code:string,origin:DecisionOrigin):Promise<void>;
}
export interface DecisionTarget {
 /** Current visibility, business state/version, rules and membership must all still permit this stage. */
 inspect(context:RuntimeReadContext,principal:Principal,request:DecisionRequest):Promise<{intent:DecisionIntent;actionable:boolean}|null>;
 /** Original domain owns validation and its stable command receipt, in this caller's transaction. */
 execute(context:RuntimeTransaction,principal:Principal,key:CommandKey,action:string,input:JsonObject):Promise<CommandReceipt>;
}
export interface DecisionDispatchPolicy {version:number;agentDailyLimit:number;platformDailyLimit:number;maxListSize:number}
export const INITIAL_DISPATCH_POLICY:Readonly<DecisionDispatchPolicy>=Object.freeze({version:1,agentDailyLimit:20,platformDailyLimit:1000,maxListSize:50});
